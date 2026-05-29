import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ConversationStatus } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { decryptSafe } from '../../config/encryption.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { scopedWhere } from '../../middlewares/scope.middleware.js'
import { backfillConversationsForInstance } from './conversation.service.js'
import { ensureConversationForMessage } from './conversation.service.js'
import { logConversationEvent } from './conversation-events.service.js'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'
import { handleCsatOnResolve, clearCsatCache } from '../channel-settings/channel-settings.service.js'

const listParamsSchema = z.object({
  instanceId: z.string().uuid(),
})

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(ConversationStatus).optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const updateStatusBodySchema = z.object({
  status: z.nativeEnum(ConversationStatus),
  snoozedUntil: z.string().datetime().optional(),
})

const updateAssignmentBodySchema = z.object({
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
})

const conversationIdParamsSchema = z.object({
  conversationId: z.string().uuid(),
})

export async function conversationRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    app.get('/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = listParamsSchema.parse((request as any).params)
      const query = listQuerySchema.parse((request as any).query)

      const instance = await prisma.instance.findFirst({
        where: {
          id: params.instanceId,
          companyId: request.user.companyId,
          isActive: true,
        },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      await backfillConversationsForInstance(instance.id, instance.companyId)

      const where: any = {
        ...scopedWhere(request, 'conversations'),
        instanceId: params.instanceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.includeDeleted === 'true' ? {} : { deletedAt: null }),
      }

      if (query.search) {
        where.OR = [
          { remoteJid: { contains: query.search, mode: 'insensitive' } },
          {
            contact: {
              is: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          },
        ]
      }

      const skip = (query.page - 1) * query.limit

      const [records, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: [
            { pinnedAt: { sort: 'desc', nulls: 'last' } },
            { lastActivityAt: 'desc' },
          ],
          skip,
          take: query.limit,
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                profilePicture: true,
              },
            },
            assignee: {
              select: { id: true, name: true, email: true },
            },
            team: {
              select: { id: true, name: true },
            },
            _count: {
              select: { messages: true },
            },
          },
        }),
        prisma.conversation.count({ where }),
      ])

      // Mascarar telefone se usuário não tem contacts:view_phone
      const canViewPhone = request.user.permissions.includes('contacts:view_phone')
      const maskedRecords = canViewPhone ? records : records.map((r: any) => ({
        ...r,
        contact: r.contact ? {
          ...r.contact,
          phoneNumber: r.contact.phoneNumber
            ? '•'.repeat(Math.max(r.contact.phoneNumber.length - 4, 0)) + r.contact.phoneNumber.slice(-4)
            : r.contact.phoneNumber,
        } : r.contact,
      }))

      return reply.send({
        conversations: maskedRecords,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      })
    })

    app.patch('/:conversationId/status', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const body = updateStatusBodySchema.parse((request as any).body)

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: params.conversationId,
          companyId: request.user.companyId,
        },
        select: { id: true, status: true, instanceId: true, remoteJid: true },
      })

      if (!conversation) {
        return reply.status(404).send({ error: 'Conversation not found' })
      }

      const oldStatus = conversation.status

      const updated = await prisma.conversation.update({
        where: { id: params.conversationId },
        data: {
          status: body.status,
          ...(body.status === ConversationStatus.SNOOZED
            ? { snoozedUntil: body.snoozedUntil ? new Date(body.snoozedUntil) : null }
            : { snoozedUntil: null }),
          lastActivityAt: new Date(),
        },
      })

      const statusLabels: Record<string, string> = { OPEN: 'Aberta', PENDING: 'Pendente', SNOOZED: 'Adiada', RESOLVED: 'Resolvida' }
      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'status_changed',
        description: `${userName} alterou o status de ${statusLabels[oldStatus] || oldStatus} para ${statusLabels[body.status] || body.status}`,
        actorType: 'user',
        actorName: userName,
        metadata: { oldStatus, newStatus: body.status },
      })

      // Disparar CSAT quando conversa é resolvida (non-blocking)
      if (body.status === ConversationStatus.RESOLVED) {
        handleCsatOnResolve(conversation.id).catch(err =>
          console.error('[CSAT] Erro ao disparar pesquisa:', err.message)
        )
      }

      // Limpar cache CSAT ao reabrir para permitir nova pesquisa no próximo ciclo
      if (body.status === ConversationStatus.OPEN || body.status === ConversationStatus.PENDING) {
        clearCsatCache(conversation.id)
      }

      return reply.send({ conversation: updated })
    })

    app.patch('/:conversationId/assignment', { preHandler: [requirePermission('conversations:assign')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const body = updateAssignmentBodySchema.parse((request as any).body)

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: params.conversationId,
          companyId: request.user.companyId,
        },
        select: { id: true, companyId: true, instanceId: true, remoteJid: true, assigneeId: true, teamId: true },
      })

      if (!conversation) {
        return reply.status(404).send({ error: 'Conversation not found' })
      }

      if (body.assigneeId) {
        const assignee = await prisma.user.findFirst({
          where: {
            id: body.assigneeId,
            companyId: request.user.companyId,
            isActive: true,
          },
          select: { id: true },
        })

        if (!assignee) {
          return reply.status(400).send({ error: 'Invalid assignee for this company' })
        }
      }

      if (body.teamId) {
        const team = await prisma.team.findFirst({
          where: {
            id: body.teamId,
            companyId: request.user.companyId,
          },
          select: { id: true },
        })

        if (!team) {
          return reply.status(400).send({ error: 'Invalid team for this company' })
        }
      }

      const updated = await prisma.conversation.update({
        where: { id: params.conversationId },
        data: {
          ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
          ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
          lastActivityAt: new Date(),
        },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      })

      const userName = request.user.name || 'Usuário'
      if (body.assigneeId !== undefined && body.assigneeId !== conversation.assigneeId) {
        const assigneeName = updated.assignee?.name || 'Ninguém'
        logConversationEvent({
          conversationId: conversation.id,
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          eventType: 'assignee_changed',
          description: body.assigneeId ? `${userName} atribuiu a conversa para ${assigneeName}` : `${userName} removeu a atribuição da conversa`,
          actorType: 'user',
          actorName: userName,
          metadata: { assigneeId: body.assigneeId, assigneeName: updated.assignee?.name || null },
        })
      }
      if (body.teamId !== undefined && body.teamId !== conversation.teamId) {
        const teamName = updated.team?.name || 'Nenhum'
        logConversationEvent({
          conversationId: conversation.id,
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          eventType: 'team_changed',
          description: body.teamId ? `${userName} atribuiu a conversa para o time ${teamName}` : `${userName} removeu o time da conversa`,
          actorType: 'user',
          actorName: userName,
          metadata: { teamId: body.teamId, teamName: updated.team?.name || null },
        })
      }

      return reply.send({ conversation: updated })
    })

    // GET /events/:instanceId/:remoteJid — Buscar eventos de uma conversa
    app.get('/events/:instanceId/:remoteJid', { preHandler: [requirePermission('conversations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { instanceId, remoteJid } = z.object({
        instanceId: z.string(),
        remoteJid: z.string(),
      }).parse((request as any).params)

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
        select: { id: true },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      const events = await prisma.conversationEvent.findMany({
        where: { instanceId, remoteJid },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })

      return reply.send({ events })
    })

    // DELETE /:conversationId — Soft-delete (marca deletedAt, preserva histórico)
    app.delete('/:conversationId', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: params.conversationId,
          companyId: request.user.companyId,
          deletedAt: null,
        },
        select: { id: true, instanceId: true, remoteJid: true },
      })

      if (!conversation) {
        return reply.status(404).send({ error: 'Conversation not found' })
      }

      await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { deletedAt: new Date() },
      })

      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'conversation_deleted',
        description: `${userName} apagou a conversa`,
        actorType: 'user',
        actorName: userName,
        metadata: {},
      })

      return reply.send({ success: true })
    })

    // POST /:conversationId/restore — Restaurar conversa deletada
    app.post('/:conversationId/restore', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: params.conversationId,
          companyId: request.user.companyId,
          deletedAt: { not: null },
        },
        select: { id: true, instanceId: true, remoteJid: true },
      })

      if (!conversation) {
        return reply.status(404).send({ error: 'Conversation not found or not deleted' })
      }

      const updated = await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { deletedAt: null },
      })

      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'conversation_restored',
        description: `${userName} restaurou a conversa`,
        actorType: 'user',
        actorName: userName,
        metadata: {},
      })

      return reply.send({ conversation: updated })
    })

    // POST /:conversationId/pin — Fixar conversa
    app.post('/:conversationId/pin', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { id: true, instanceId: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      const updated = await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { pinnedAt: new Date() },
      })

      const io = request.server.io
      io?.to(`instance:${conversation.instanceId}`).emit('conversation-pinned', {
        conversationId: params.conversationId,
        pinnedAt: updated.pinnedAt,
      })

      return reply.send({ conversation: updated })
    })

    // POST /:conversationId/unpin — Desafixar conversa
    app.post('/:conversationId/unpin', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { id: true, instanceId: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      const updated = await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { pinnedAt: null },
      })

      const io = request.server.io
      io?.to(`instance:${conversation.instanceId}`).emit('conversation-pinned', {
        conversationId: params.conversationId,
        pinnedAt: null,
      })

      return reply.send({ conversation: updated })
    })

    // ═══════════════════════════════════════════════
    // ATRIBUIÇÃO DE AGENTE DE I.A. À CONVERSA
    // ═══════════════════════════════════════════════

    const assignAiBodySchema = z.object({
      agentId: z.string().uuid(),
    })

    // POST /:conversationId/assign-ai — Atribuir agente de IA à conversa (cria/reabre sessão)
    app.post('/:conversationId/assign-ai', { preHandler: [requirePermission('conversations:assign')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const body = assignAiBodySchema.parse((request as any).body)

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { id: true, instanceId: true, remoteJid: true, companyId: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      const agent = await prisma.aIAgent.findFirst({
        where: { id: body.agentId, companyId: request.user.companyId, status: 'ACTIVE' },
        select: { id: true, name: true },
      })
      if (!agent) return reply.status(400).send({ error: 'AI Agent not found or inactive' })

      // Fechar qualquer sessão aberta de outro agente para este remoteJid
      await prisma.aISession.updateMany({
        where: {
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          status: { in: ['OPENED', 'PAUSED'] },
        },
        data: { status: 'CLOSED', closedAt: new Date() },
      })

      // Criar nova sessão aberta
      const session = await prisma.aISession.create({
        data: {
          agentId: body.agentId,
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          status: 'OPENED',
          startedAt: new Date(),
          lastActivity: new Date(),
        },
      })

      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'ai_agent_assigned',
        description: `${userName} atribuiu o agente de I.A. "${agent.name}" à conversa`,
        actorType: 'user',
        actorName: userName,
        metadata: { agentId: body.agentId, agentName: agent.name, sessionId: session.id },
      })

      // Emitir evento via Socket.IO
      const { io } = await import('../../server.js')
      io?.to(`instance:${conversation.instanceId}`).emit('ai-session-update', {
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        status: 'OPENED',
        sessionId: session.id,
        agentName: agent.name,
        agentId: body.agentId,
      })

      return reply.send({ success: true, session: { id: session.id, agentId: body.agentId, agentName: agent.name, status: 'OPENED' } })
    })

    // DELETE /:conversationId/assign-ai — Remover agente de IA da conversa (fechar sessão)
    app.delete('/:conversationId/assign-ai', { preHandler: [requirePermission('conversations:assign')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { id: true, instanceId: true, remoteJid: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      // Fechar todas as sessões abertas/pausadas para este remoteJid
      const result = await prisma.aISession.updateMany({
        where: {
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          status: { in: ['OPENED', 'PAUSED'] },
        },
        data: { status: 'CLOSED', closedAt: new Date() },
      })

      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'ai_agent_removed',
        description: `${userName} removeu o agente de I.A. da conversa`,
        actorType: 'user',
        actorName: userName,
        metadata: { closedSessions: result.count },
      })

      // Emitir evento via Socket.IO
      const { io } = await import('../../server.js')
      io?.to(`instance:${conversation.instanceId}`).emit('ai-session-update', {
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        status: 'CLOSED',
      })

      return reply.send({ success: true })
    })

    // GET /:conversationId/ai-session — Obter sessão de IA ativa da conversa
    app.get('/:conversationId/ai-session', { preHandler: [requirePermission('conversations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { instanceId: true, remoteJid: true, aiPaused: true, aiPausedAt: true, aiPausedReason: true, aiPausedByUserId: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      const session = await prisma.aISession.findFirst({
        where: {
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          status: { in: ['OPENED', 'PAUSED'] },
        },
        include: {
          agent: { select: { id: true, name: true, status: true } },
        },
        orderBy: { lastActivity: 'desc' },
      })

      return reply.send({
        session: session ? {
          id: session.id,
          agentId: session.agentId,
          agentName: session.agent.name,
          status: session.status,
          messageCount: session.messageCount,
          tokensUsed: session.tokensUsed,
          startedAt: session.startedAt,
          lastActivity: session.lastActivity,
        } : null,
        aiPaused: conversation.aiPaused,
        aiPausedAt: conversation.aiPausedAt,
        aiPausedReason: conversation.aiPausedReason,
      })
    })

    // ═══════════════════════════════════════════════
    // PAUSE/RESUME IA por conversa (independente de sessão)
    // ═══════════════════════════════════════════════
    const aiPauseBodySchema = z.object({
      paused: z.boolean(),
      reason: z.string().max(120).optional(),
    })

    app.patch('/:conversationId/ai-pause', { preHandler: [requirePermission('conversations:assign')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const params = conversationIdParamsSchema.parse((request as any).params)
      const body = aiPauseBodySchema.parse(request.body)

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.conversationId, companyId: request.user.companyId },
        select: { id: true, instanceId: true, remoteJid: true, aiPaused: true },
      })
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: body.paused
          ? {
              aiPaused: true,
              aiPausedAt: new Date(),
              aiPausedReason: body.reason || 'manual',
              aiPausedByUserId: request.user.id,
            }
          : {
              aiPaused: false,
              aiPausedAt: null,
              aiPausedReason: null,
              aiPausedByUserId: null,
            },
      })

      // Se está despausando, também reabre qualquer AISession PAUSED desta conversa
      if (!body.paused) {
        const pausedSessions = await prisma.aISession.findMany({
          where: { instanceId: conversation.instanceId, remoteJid: conversation.remoteJid, status: 'PAUSED' },
          select: { id: true },
        })
        for (const s of pausedSessions) {
          await prisma.aISession.update({
            where: { id: s.id },
            data: { status: 'OPENED', lastActivity: new Date() },
          })
        }
      } else {
        // Se está pausando, também pausa sessões OPENED existentes
        await prisma.aISession.updateMany({
          where: { instanceId: conversation.instanceId, remoteJid: conversation.remoteJid, status: 'OPENED' },
          data: { status: 'PAUSED', followUpCount: 0, lastFollowUpAt: null, followUpStartedAt: null },
        })
      }

      try {
        await logConversationEvent({
          conversationId: conversation.id,
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          eventType: body.paused ? 'ai_session_paused' : 'ai_session_resumed',
          description: body.paused
            ? `IA pausada manualmente${body.reason ? `: ${body.reason}` : ''}`
            : 'IA reativada manualmente',
          actorType: 'user',
          actorId: request.user.id,
        })
      } catch (e) {
        console.warn('[AI] failed to log conversation event:', (e as Error).message)
      }

      const io = request.server.io
      io?.to(`instance:${conversation.instanceId}`).emit('conversation-ai-pause', {
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        conversationId: conversation.id,
        aiPaused: body.paused,
      })

      return reply.send({ success: true, aiPaused: body.paused })
    })

    // ═══════════════════════════════════════════════
    // VERIFICAR NÚMERO NO WHATSAPP
    // ═══════════════════════════════════════════════

    const checkNumberSchema = z.object({
      instanceId: z.string().uuid(),
      phoneNumber: z.string().min(10).max(20),
    })

    app.post('/check-number', { preHandler: [requirePermission('conversations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = checkNumberSchema.parse(request.body)

        const instance = await prisma.instance.findFirst({
          where: { id: body.instanceId, companyId: request.user.companyId, isActive: true },
        })

        if (!instance) return reply.status(404).send({ error: 'Instance not found' })
        if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })

        // Limpar número (apenas dígitos)
        const cleanNumber = body.phoneNumber.replace(/\D/g, '')

        if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          console.log(`[check-number] Checking ${cleanNumber} on Evo Go (instance=${instance.id})`)
          const result = await evoGo.checkIsOnWhatsApp([cleanNumber])
          console.log(`[check-number] Evo Go result:`, JSON.stringify(result))

          // Evo Go v3 retorna: { message: "success", data: { Users: [{ Query, IsInWhatsapp, JID, VerifiedName, ... }] } }
          const users = result?.data?.Users || result?.Users || (Array.isArray(result) ? result : [])
          const found = users.find((r: any) =>
            r.IsInWhatsapp === true || r.isInWhatsapp === true ||
            r.exists === true || r.IsOnWhatsApp === true
          )

          if (found) {
            const jid = found.JID || found.jid || found.RemoteJID || `${cleanNumber}@s.whatsapp.net`
            // Número real retornado pela API (pode ser diferente do digitado — ex: sem nono dígito)
            const realNumber = jid.replace(/@.*/, '').replace(/\D/g, '')

            // Buscar conversa existente — por JID, número digitado OU número real da API
            const existingConv = await prisma.conversation.findFirst({
              where: {
                instanceId: body.instanceId,
                deletedAt: null,
                OR: [
                  { remoteJid: jid },
                  { remoteJid: `${cleanNumber}@s.whatsapp.net` },
                  { remoteJid: `${realNumber}@s.whatsapp.net` },
                  { contact: { phoneNumber: cleanNumber } },
                  { contact: { phoneNumber: realNumber } },
                ],
              },
              select: { id: true, remoteJid: true, contact: { select: { name: true, profilePicture: true } } },
            })

            console.log(`[check-number] input=${cleanNumber}, realNumber=${realNumber}, JID=${jid}, existingConv=${existingConv?.id || 'none'}`)

            return reply.send({
              exists: true,
              jid: existingConv?.remoteJid || jid,
              number: realNumber,
              name: existingConv?.contact?.name || found.VerifiedName || found.verifiedName || null,
              profilePicture: existingConv?.contact?.profilePicture || null,
              existingConversation: !!existingConv,
            })
          }

          return reply.send({ exists: false, number: cleanNumber })
        } else {
          const remoteJid = `${cleanNumber}@s.whatsapp.net`
          const existingConv = await prisma.conversation.findFirst({
            where: {
              instanceId: body.instanceId,
              deletedAt: null,
              OR: [
                { remoteJid },
                { contact: { phoneNumber: cleanNumber } },
              ],
            },
            select: { id: true, remoteJid: true, contact: { select: { name: true, profilePicture: true } } },
          })

          return reply.send({
            exists: true,
            jid: existingConv?.remoteJid || remoteJid,
            number: cleanNumber,
            name: existingConv?.contact?.name || null,
            profilePicture: existingConv?.contact?.profilePicture || null,
            existingConversation: !!existingConv,
          })
        }
      } catch (error: any) {
        console.error('[check-number] Error:', error.message, error.stack)
        return reply.status(500).send({ error: 'Erro ao verificar n�mero no WhatsApp' })
      }
    })

    // ═══════════════════════════════════════════════
    // INICIAR NOVA CONVERSA
    // ═══════════════════════════════════════════════

    const startConversationSchema = z.object({
      instanceId: z.string().uuid(),
      phoneNumber: z.string().min(10).max(20),
      contactName: z.string().optional(),
    })

    app.post('/start', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = startConversationSchema.parse(request.body)

      const instance = await prisma.instance.findFirst({
        where: { id: body.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })

      const cleanNumber = body.phoneNumber.replace(/\D/g, '')
      const remoteJid = `${cleanNumber}@s.whatsapp.net`

      try {
        // Cria ou recupera conversa + contato
        const conversation = await ensureConversationForMessage({
          companyId: request.user.companyId,
          instanceId: body.instanceId,
          remoteJid,
          contactName: body.contactName || undefined,
        })

        // Atualizar nome do contato se fornecido e diferente
        if (body.contactName) {
          const contact = await prisma.contact.findFirst({
            where: { companyId: request.user.companyId, phoneNumber: cleanNumber },
          })
          if (contact && contact.name === cleanNumber) {
            await prisma.contact.update({
              where: { id: contact.id },
              data: { name: body.contactName },
            })
          }
        }

        // Buscar conversa completa com dados do contato
        const fullConversation = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: {
            contact: {
              select: { id: true, name: true, phoneNumber: true, profilePicture: true },
            },
          },
        })

        return reply.send({
          conversation: fullConversation,
          remoteJid,
          isNew: !!(conversation as any)._isNew,
        })
      } catch (error: any) {
        console.error('[start-conversation] Error:', error.message)
        return reply.status(500).send({ error: 'Failed to start conversation' })
      }
    })
  })
}
