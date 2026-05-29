/**
 * Fleet Routes — REST API para o módulo IMPA Fleet
 * Prefixo: /api/fleet
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import * as fleet from './fleet.service.js'
import * as builder from './fleet-builder.service.js'
import { DEFAULT_CRON_TIMEZONE, tryHeuristicCron, getNextRunAt, isValidCron } from './cron-nlp.service.js'
import { prisma } from '../../config/database.js'

// ──────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────

const departmentCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  order: z.coerce.number().int().optional(),
})
const departmentUpdateSchema = departmentCreateSchema.partial()

const memberCreateSchema = z.object({
  name: z.string().min(1).max(100),
  displayRole: z.string().min(1).max(100),
  providerId: z.string().uuid(),
  model: z.string().min(1).max(100),
  systemPrompt: z.string().max(20000).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().min(100).max(32000).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  toolsConfig: z.any().optional(),
  departmentId: z.string().uuid().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  emoji: z.string().max(8).optional().nullable(),
  colorTag: z.string().max(20).optional().nullable(),
  assignedRoleId: z.string().uuid().optional().nullable(),
  allowAutonomousActions: z.boolean().optional(),
  notificationUserIds: z.array(z.string().uuid()).optional(),
})
const memberUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayRole: z.string().min(1).max(100).optional(),
  providerId: z.string().uuid().optional(),
  model: z.string().min(1).max(100).optional(),
  systemPrompt: z.string().min(1).max(20000).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().min(100).max(32000).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  toolsConfig: z.any().optional(),
  departmentId: z.string().uuid().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  emoji: z.string().max(8).optional().nullable(),
  colorTag: z.string().max(20).optional().nullable(),
  assignedRoleId: z.string().uuid().optional().nullable(),
  allowAutonomousActions: z.boolean().optional(),
  notificationUserIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
})

const missionCreateSchema = z.object({
  memberId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  instruction: z.string().min(1),
  cronExpr: z.string().optional(),
  cronNl: z.string().optional(),
  cronTimezone: z.string().optional(),
  runOnceAt: z.string().optional(),
  executionMode: z.enum(['AUTONOMOUS', 'REQUIRE_APPROVAL']).optional(),
  maxRuns: z.coerce.number().int().min(1).optional(),
  notifyOnSuccess: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  notifyUserIds: z.array(z.string().uuid()).optional(),
})
const missionUpdateSchema = missionCreateSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
})

const chatMessageSchema = z.object({
  memberId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
  thinkingMode: z.boolean().optional(),
})

const cronPreviewSchema = z.object({
  nl: z.string().optional(),
  cronExpr: z.string().optional(),
  count: z.coerce.number().int().min(1).max(20).optional(),
  cronTimezone: z.string().optional(),
})

const operationApproveSchema = z.object({
  instruction: z.string().min(1).max(8000).optional(),
})

const operationRejectSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
})

const builderChatSchema = z.object({
  providerId: z.string().uuid(),
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(8000),
  })).max(40),
  currentConfig: z.any().optional(),
})

const builderCreateSchema = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1),
  config: z.object({
    name: z.string().min(1),
    displayRole: z.string().min(1),
    systemPrompt: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(200).max(8000).optional(),
    suggestedTools: z.array(z.string()).optional(),
    emoji: z.string().optional(),
    colorTag: z.string().optional(),
  }),
  departmentId: z.string().uuid().optional().nullable(),
})

// ──────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────

export async function fleetRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // ========== DEPARTMENTS ==========
    app.get('/departments', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const list = await fleet.listDepartments(req.user.companyId)
      return reply.send(list)
    })

    app.post('/departments', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = departmentCreateSchema.parse(req.body)
      const dep = await fleet.createDepartment({ companyId: req.user.companyId, ...body })
      return reply.code(201).send(dep)
    })

    app.patch('/departments/:id', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const body = departmentUpdateSchema.parse(req.body)
      const dep = await fleet.updateDepartment(req.user.companyId, id, body)
      return reply.send(dep)
    })

    app.delete('/departments/:id', { preHandler: [requirePermission('fleet:delete')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      await fleet.deleteDepartment(req.user.companyId, id)
      return reply.code(204).send()
    })

    // ========== MEMBERS ==========
    app.get('/members', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { departmentId?: string; status?: string }
      try {
        const list = await fleet.listMembers(req.user.companyId, q)
        return reply.send(list)
      } catch (e: any) {
        req.log.error({ err: e, stack: e?.stack, code: e?.code, meta: e?.meta }, '[Fleet] listMembers failed')
        return reply.code(500).send({ error: e?.message || 'Erro ao listar membros', code: e?.code })
      }
    })

    app.get('/members/:id', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const member = await fleet.getMember(req.user.companyId, id)
      if (!member) return reply.code(404).send({ error: 'Membro não encontrado' })
      return reply.send(member)
    })

    app.post('/members', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = memberCreateSchema.parse(req.body)
      try {
        const m = await fleet.createMember({
          companyId: req.user.companyId,
          ...body,
          departmentId: body.departmentId || undefined,
          avatarUrl: body.avatarUrl || undefined,
          emoji: body.emoji || undefined,
          colorTag: body.colorTag || undefined,
          assignedRoleId: body.assignedRoleId || undefined,
        })
        return reply.code(201).send(m)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.patch('/members/:id', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const body = memberUpdateSchema.parse(req.body)
      try {
        const m = await fleet.updateMember(req.user.companyId, id, body as any)
        return reply.send(m)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.delete('/members/:id', { preHandler: [requirePermission('fleet:delete')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      try {
        await fleet.deleteMember(req.user.companyId, id)
        return reply.code(204).send()
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // ========== MISSIONS ==========
    app.get('/missions', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { memberId?: string; status?: string }
      const list = await fleet.listMissions(req.user.companyId, q)
      return reply.send(list)
    })

    app.post('/missions', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = missionCreateSchema.parse(req.body)
      try {
        const m = await fleet.createMission({
          companyId: req.user.companyId,
          createdBy: req.user.id,
          ...body,
        })
        return reply.code(201).send(m)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.patch('/missions/:id', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const body = missionUpdateSchema.parse(req.body)
      try {
        const m = await fleet.updateMission(req.user.companyId, id, body as any)
        return reply.send(m)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.delete('/missions/:id', { preHandler: [requirePermission('fleet:delete')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      try {
        await fleet.deleteMission(req.user.companyId, id)
        return reply.code(204).send()
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // Disparar manualmente
    app.post('/missions/:id/run', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      // valida que pertence à company
      const m = await fleet.listMissions(req.user.companyId, {})
      if (!m.find(x => x.id === id)) return reply.code(404).send({ error: 'Missão não encontrada' })
      try {
        const opId = await fleet.executeMission(id, { manualUserId: req.user.id })
        return reply.send({ operationId: opId })
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // ========== OPERATIONS ==========
    app.get('/operations', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { memberId?: string; missionId?: string; status?: string; limit?: string }
      const list = await fleet.listOperations(req.user.companyId, {
        memberId: q.memberId,
        missionId: q.missionId,
        status: q.status,
        limit: q.limit ? Number(q.limit) : undefined,
      })
      return reply.send(list)
    })

    app.post('/operations/:id/approve', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const body = operationApproveSchema.parse(req.body || {})
      try {
        const result = await fleet.approveOperation({
          companyId: req.user.companyId,
          userId: req.user.id,
          operationId: id,
          instruction: body.instruction,
        })
        return reply.send(result)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.post('/operations/:id/reject', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const body = operationRejectSchema.parse(req.body || {})
      try {
        const result = await fleet.rejectOperation({
          companyId: req.user.companyId,
          userId: req.user.id,
          operationId: id,
          reason: body.reason,
        })
        return reply.send(result)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // ========== CRITIC REVIEWS (Raven) ==========
    app.get('/critic-reviews', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { riskLevel?: string; recommendation?: string; page?: string; limit?: string }
      const where: any = { companyId: req.user.companyId }
      if (q.riskLevel) where.riskLevel = q.riskLevel
      if (q.recommendation) where.recommendation = q.recommendation
      const page = q.page ? Math.max(1, parseInt(q.page)) : 1
      const limit = q.limit ? Math.min(200, Math.max(1, parseInt(q.limit))) : 50
      const [items, total] = await Promise.all([
        prisma.fleetCriticReview.findMany({
          where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
          include: { operation: { select: { id: true, instruction: true, status: true, memberId: true, member: { select: { id: true, name: true, displayRole: true } } } } },
        }),
        prisma.fleetCriticReview.count({ where }),
      ])
      return reply.send({ items, total, page, totalPages: Math.ceil(total / limit) })
    })

    app.get('/operations/:id/critic-review', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      const review = await prisma.fleetCriticReview.findFirst({ where: { operationId: id, companyId: req.user.companyId } })
      if (!review) return reply.code(404).send({ error: 'Sem review' })
      return reply.send(review)
    })

    // ========== CHATS ==========
    app.get('/chats', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { memberId?: string }
      const list = await fleet.listChats(req.user.companyId, req.user.id, q)
      return reply.send(list)
    })

    app.get('/chats/:id/messages', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      try {
        const data = await fleet.getChatMessages(req.user.companyId, req.user.id, id)
        return reply.send(data)
      } catch (e: any) {
        return reply.code(404).send({ error: e.message })
      }
    })

    // Runtime status — usado para polling enquanto a IA está respondendo.
    // Retorna { running: boolean, operationId: string|null, startedAt: ... }.
    // Frontend faz polling enquanto running=true e mostra indicador "pensando".
    app.get('/chats/:id/runtime', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      try {
        const data = await fleet.getChatRuntimeStatus({
          companyId: req.user.companyId,
          userId: req.user.id,
          chatId: id,
        })
        return reply.send(data)
      } catch (e: any) {
        return reply.code(404).send({ error: e.message })
      }
    })

    app.post('/chats/:id/archive', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      await fleet.archiveChat(req.user.companyId, req.user.id, id)
      return reply.code(204).send()
    })

    // Abrir/criar chat com membro (sem enviar mensagem)
    // Usado especialmente para membros não-onboardados: dispara a saudação inicial automática
    app.post('/chats/open', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ memberId: z.string().uuid() }).parse(req.body)
      try {
        const result = await fleet.getOrCreateChat({
          companyId: req.user.companyId,
          userId: req.user.id,
          memberId: body.memberId,
        })
        return reply.send(result)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // Enviar mensagem ao membro (cria chat se não existir)
    app.post('/chats/message', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = chatMessageSchema.parse(req.body)
      try {
        const result = await fleet.sendChatMessage({
          companyId: req.user.companyId,
          userId: req.user.id,
          memberId: body.memberId,
          chatId: body.chatId,
          message: body.message,
          thinkingMode: body.thinkingMode,
        })
        return reply.send(result)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // ========== BUILDER (criar membro conversacionalmente) ==========
    app.post('/builder/chat', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = builderChatSchema.parse(req.body)
        const result = await builder.builderChat({
          companyId: req.user.companyId,
          providerId: body.providerId,
          model: body.model,
          messages: body.messages,
          currentConfig: body.currentConfig,
        })
        return reply.send(result)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    app.post('/builder/create', { preHandler: [requirePermission('fleet:write')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = builderCreateSchema.parse(req.body)
        const payload = builder.buildCreatePayload(body.config, body.providerId, body.model)
        const member = await fleet.createMember({
          companyId: req.user.companyId,
          ...payload,
          departmentId: body.departmentId || undefined,
        })
        return reply.code(201).send(member)
      } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    })

    // ========== CRON HELPER ==========
    app.post('/cron/preview', { preHandler: [requirePermission('fleet:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = cronPreviewSchema.parse(req.body)
      const count = body.count ?? 5
      let cronExpr: string | null = null
      let description: string | null = null

      if (body.cronExpr) {
        if (!isValidCron(body.cronExpr)) return reply.code(400).send({ error: `Cron inválido: "${body.cronExpr}"` })
        cronExpr = body.cronExpr
        description = body.cronExpr
      } else if (body.nl) {
        const heur = tryHeuristicCron(body.nl)
        if (!heur) return reply.code(400).send({ error: `Não consegui interpretar: "${body.nl}". Tente algo como "todo dia 9h" ou "a cada 30 minutos".` })
        cronExpr = heur.cronExpr
        description = heur.description
      } else {
        return reply.code(400).send({ error: 'Forneça "nl" ou "cronExpr"' })
      }

      const nextRuns: Date[] = []
      let cursor = new Date()
      const cronTimezone = body.cronTimezone || DEFAULT_CRON_TIMEZONE
      for (let i = 0; i < count; i++) {
        const next = getNextRunAt(cronExpr!, cursor, cronTimezone)
        if (!next) break
        nextRuns.push(next)
        cursor = new Date(next.getTime() + 60_000)
      }

      return reply.send({ cronExpr, description, cronTimezone, nextRuns })
    })
  })
}
