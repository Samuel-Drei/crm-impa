import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../../config/database.js'
import { Prisma } from '@prisma/client'
import { authMiddleware, apiTokenMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { baileysManager, io } from '../../server.js'
import { CloudAPIProvider } from '../../providers/cloud-api/cloud-api.provider.js'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'
import { decryptSafe } from '../../config/encryption.js'
import { checkRateLimit } from '../../middlewares/rate-limit.middleware.js'
import { runHistoryImport } from './import-history.helper.js'
import { backfillConversationsForInstance, ensureConversationForMessage } from '../conversations/conversation.service.js'
import { instanceRoom } from '../../config/socket-rooms.js'
import { scopedWhere } from '../../middlewares/scope.middleware.js'
import { pauseAISessionOnHumanReply } from '../ai/whatsapp.integration.js'
import {
  sendInteractiveSchema,
  validateInteractiveMessage,
  sendInteractiveViaProvider,
  interactiveContentSummary,
  interactiveToText,
  type InteractiveMessage,
} from './interactive-messages.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Avatar caching helper ──
// __dirname = src/modules/messages/ → uploads is at project root
const UPLOADS_BASE = path.join(__dirname, '..', '..', '..', 'uploads')

/**
 * Download and cache an avatar image locally.
 * Returns the local path like /uploads/<companyId>/avatars/<sanitized_jid>.jpg or null.
 */
async function cacheAvatar(jid: string, imageUrl: string, companyId: string): Promise<string | null> {
  try {
    const avatarsDir = path.join(UPLOADS_BASE, companyId, 'avatars')
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true })
    // Sanitize jid for filename: replace @ and . with _
    const safeJid = jid.replace(/[@.]/g, '_')
    const fileName = `${safeJid}.jpg`
    const filePath = path.join(avatarsDir, fileName)
    const localUrl = `/uploads/${companyId}/avatars/${fileName}`

    // Download the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024, // 5MB max
    })

    fs.writeFileSync(filePath, Buffer.from(response.data))

    // Update contact profilePicture in DB
    await prisma.contact.updateMany({
      where: { companyId, phoneNumber: jid },
      data: { profilePicture: localUrl },
    })

    return localUrl
  } catch (err: any) {
    console.error(`[cacheAvatar] Failed for ${jid}:`, err.message)
    return null
  }
}

/**
 * Fetch avatar URL from Evo Go API and cache it locally.
 * Returns cached local path or null.
 */
async function fetchAndCacheAvatar(
  evoGo: EvoGoProvider,
  jid: string,
  companyId: string
): Promise<string | null> {
  try {
    const result = await evoGo.getAvatar(jid)
    const data = result?.data || result
    const remoteUrl = data?.URL || data?.url || null
    if (!remoteUrl) return null
    return await cacheAvatar(jid, remoteUrl, companyId)
  } catch {
    return null
  }
}

// Helper to persist outbound message and emit socket event
async function persistOutboundMessage(instance: any, to: string, text: string, messageId: string, sentByUserId?: string) {
  try {
    const conversation = await ensureConversationForMessage({
      companyId: instance.companyId,
      instanceId: instance.id,
      remoteJid: to,
      lastActivityAt: new Date(),
      firstReplyAt: new Date(),
    })

    await prisma.message.create({
      data: {
        instanceId: instance.id,
        conversationId: conversation.id,
        remoteJid: to,
        messageId: messageId || `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        direction: 'OUTBOUND',
        status: 'SENT',
        type: 'text',
        content: text,
        sentAt: new Date(),
        ...(sentByUserId ? { sentByUserId } : {}),
      },
    })
    await prisma.instance.update({
      where: { id: instance.id },
      data: { messagesSent: { increment: 1 } },
    })
    io.to(instanceRoom(instance.companyId, instance.id)).emit('message-sent', {
      instanceId: instance.id,
      from: to,
      messageId: messageId || undefined,
      direction: 'OUTBOUND',
      content: text,
      type: 'text',
      timestamp: new Date(),
    })
  } catch (err: any) {
    if (err.code !== 'P2002') console.error('[persistOutboundMessage]', err.message)
  }
}



// Helper para disparar webhook após envio de mensagem
async function triggerSendWebhook(instance: any, data: { to: string; content: string; type: string; messageId?: string }) {
  if (!instance.webhookUrl || !instance.webhookEvents?.includes('message.sent')) {
    return
  }

  try {
    await axios.post(instance.webhookUrl, {
      event: 'message.sent',
      instanceId: instance.id,
      instanceName: instance.name,
      to: data.to,
      content: data.content,
      type: data.type,
      messageId: data.messageId,
      timestamp: new Date().toISOString(),
    }, { timeout: 5000 })
  } catch (error) {
    console.error('Webhook send error:', error)
  }
}

const sendTextSchema = z.object({
  instanceId: z.string().uuid().optional(),
  to: z.string().min(10),
  text: z.string().min(1),
})

const sendMediaSchema = z.object({
  instanceId: z.string().uuid().optional(),
  to: z.string().min(10),
  mediaType: z.enum(['image', 'video', 'audio', 'document']),
  mediaUrl: z.string().url(),
  caption: z.string().optional(),
  fileName: z.string().optional(),
})

const sendTemplateSchema = z.object({
  instanceId: z.string().uuid().optional(),
  to: z.string().min(10),
  templateName: z.string(),
  language: z.string().default('pt_BR'),
  components: z.array(z.any()).optional(),
})

// Schema para envio de fatura (formato SjnetworkAPI)
const sendInvoiceSchema = z.object({
  to: z.string().min(10),
  templateName: z.string().default('fatura_pagamento'),
  language: z.string().default('pt_BR'),
  documentUrl: z.string().url().optional(),
  documentFilename: z.string().optional(),
  invoiceNumber: z.string(),
  customerName: z.string(),
  amount: z.string(),
  dueDate: z.string(),
  pixCode: z.string(),
  boletoCode: z.string().optional(),
})

// Schema para template fora_do_horario (formato simplificado)
const foraDoHorarioSchema = z.object({
  To: z.string().min(10),
  Nome: z.string(),
  Telefone: z.string(),
  CPF: z.string(),
  Assiante: z.string(),
  setor: z.string(),
})

const sendButtonsSchema = z.object({
  instanceId: z.string().uuid().optional(),
  to: z.string().min(10),
  text: z.string().min(1),
  buttons: z.array(z.object({
    id: z.string(),
    text: z.string().max(20),
  })).min(1).max(3),
  footer: z.string().optional(),
  header: z.string().optional(),
})

const sendListSchema = z.object({
  instanceId: z.string().uuid().optional(),
  to: z.string().min(10),
  text: z.string().min(1),
  buttonText: z.string().default('Menu'),
  sections: z.array(z.object({
    title: z.string(),
    rows: z.array(z.object({
      id: z.string(),
      title: z.string().max(24),
      description: z.string().optional(),
    })).min(1),
  })).min(1),
  footer: z.string().optional(),
  header: z.string().optional(),
})

const sendGroupSchema = z.object({
  instanceId: z.string().uuid(),
  groupId: z.string().min(5),
  text: z.string().min(1),
})

export async function messageRoutes(fastify: FastifyInstance) {
  // API Documentation endpoint
  fastify.get('/docs', async (_request, reply) => {
    return reply.send({
      name: 'IMPA CRM API',
      version: '2.0.1',
      endpoints: {
        messages: {
          'POST /api/messages/send': {
            description: 'Enviar mensagem de texto',
            auth: 'JWT Token',
            body: { instanceId: 'uuid', to: '5511999999999', text: 'Mensagem' }
          },
          'POST /api/messages/send-group': {
            description: 'Enviar mensagem para grupo',
            auth: 'JWT Token',
            body: { instanceId: 'uuid', groupId: '120363012345678901@g.us', text: 'Mensagem' }
          },
          'GET /api/messages/groups/:instanceId': {
            description: 'Listar grupos da instância',
            auth: 'JWT Token'
          },
          'POST /api/messages/api/send': {
            description: 'Enviar mensagem via API Token',
            auth: 'x-api-token header',
            body: { to: '5511999999999 ou groupId@g.us', text: 'Mensagem' }
          }
        },
        automations: {
          'POST /api/automations/trigger/:token': {
            description: 'Disparar automação',
            auth: 'Token na URL',
            body: { telefone: '5511999999999', nome: 'João', valor: '100.00' }
          }
        }
      }
    })
  })

  // Authenticated routes (via JWT)
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // ── Transcrever áudio de mensagem ──
    app.post<{ Params: { messageId: string } }>('/transcribe/:messageId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { messageId } = request.params
      const companyId = request.user.companyId

      // 1. Buscar a mensagem
      const message = await prisma.message.findFirst({
        where: {
          messageId,
          instance: { companyId },
        },
        include: { instance: true },
      })

      if (!message) {
        return reply.status(404).send({ error: 'Mensagem não encontrada' })
      }

      if (message.type !== 'audio') {
        return reply.status(400).send({ error: 'Esta mensagem não é um áudio' })
      }

      if (!message.mediaUrl) {
        return reply.status(400).send({ error: 'Áudio não disponível (sem mediaUrl)' })
      }

      // 2. Verificar se já tem transcrição salva
      const meta = (message.metadata || {}) as any
      if (meta.transcription) {
        return reply.send({
          text: meta.transcription,
          cached: true,
          provider: meta.transcriptionProvider || 'cached',
          costUsd: 0,
        })
      }

      // 3. Buscar provider com capability de ASR
      const provider = await prisma.aIProvider.findFirst({
        where: {
          companyId,
          isActive: true,
          type: 'OPENAI', // Whisper é OpenAI
        },
      })

      if (!provider) {
        // Tentar Whisper local
        const localUrl = process.env.WHISPER_ENDPOINT || process.env.WHISPER_LOCAL_URL
        if (!localUrl) {
          return reply.status(400).send({
            error: 'Nenhum provedor OpenAI configurado para transcrição. Configure um provedor OpenAI ou Whisper local.',
          })
        }
      }

      try {
        const { transcribeAudioFromUrl, transcribeAudioBuffer, logAsrCostMessage } = await import('../ai/rag/asr.service.js')

        // Resolver URL do áudio — ler do disco se for local (evita 401 do auth)
        let audioUrl = message.mediaUrl
        const isLocalUpload = audioUrl.startsWith('/uploads/')

        // Determinar config
        const localUrl = process.env.WHISPER_ENDPOINT || process.env.WHISPER_LOCAL_URL
        const { decryptSafe } = await import('../../config/encryption.js')
        const config = provider
          ? { provider: 'openai' as const, apiKey: decryptSafe(provider.apiKey) as string, model: 'whisper-1' }
          : { provider: 'local' as const, baseUrl: localUrl! }

        let result
        if (isLocalUpload) {
          // Ler direto do filesystem — evita HTTP 401
          const fs = await import('fs/promises')
          const path = await import('path')
          const filePath = path.join(__dirname, '..', '..', '..', audioUrl)
          const buffer = await fs.readFile(filePath)
          result = await transcribeAudioBuffer(buffer, config, {
            fileName: path.basename(audioUrl),
          })
          // Registrar custo via AITokenReport
          if (result.costUsd > 0) {
            await logAsrCostMessage(companyId, result, message.instanceId)
          }
        } else {
          result = await transcribeAudioFromUrl(audioUrl, config, companyId, {
            instanceId: message.instanceId,
          })
        }

        // 4. Salvar transcrição na mensagem
        await prisma.message.update({
          where: { id: message.id },
          data: {
            metadata: {
              ...(message.metadata as any || {}),
              transcription: result.text,
              transcriptionProvider: result.provider,
              transcriptionModel: result.model,
              transcriptionLanguage: result.language,
              transcriptionDuration: result.durationSeconds,
              transcriptionCost: result.costUsd,
              transcribedAt: new Date().toISOString(),
            },
          },
        })

        return reply.send({
          text: result.text,
          cached: false,
          provider: result.provider,
          model: result.model,
          language: result.language,
          durationSeconds: result.durationSeconds,
          costUsd: result.costUsd,
        })
      } catch (error: any) {
        console.error('[Transcribe] Erro:', error)
        return reply.status(500).send({ error: 'Erro na transcrição' })
      }
    })

    // Find conversation by phone number across all instances
    app.get<{ Params: { phone: string } }>('/find-by-phone/:phone', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { phone } = request.params
      const companyId = (request as any).userData.companyId
      const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`
      const conv = await prisma.conversation.findFirst({
        where: { companyId, remoteJid: jid, deletedAt: null },
        orderBy: { lastActivityAt: 'desc' },
        select: { id: true, instanceId: true, remoteJid: true }
      })
      return reply.send({ conversation: conv })
    })

    // List conversations (distinct remoteJids with last message) for an instance
    app.get<{ Params: { instanceId: string }; Querystring: { search?: string; deleted?: string } }>('/conversations/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId } = request.params
      const search = request.query.search
      const showDeleted = request.query.deleted === 'true'

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      await backfillConversationsForInstance(instance.id, instance.companyId)

      // Build scope filter for conversations
      const userId = (request.user as any).id || request.user.sub
      const convScope = (request.user as any).conversationScope || 'OWN'
      const teamIds: string[] = (request.user as any).teamIds || []

      // Build parameterized scope condition (SEC-01 fix: eliminates SQL injection surface)
      let scopeCondition = Prisma.sql`TRUE`
      if (convScope === 'OWN') {
        scopeCondition = Prisma.sql`(conv."assigneeId" = ${userId} OR conv."assigneeId" IS NULL)`
      } else if (convScope === 'TEAM' && teamIds.length > 0) {
        scopeCondition = Prisma.sql`(conv."teamId" = ANY(${teamIds}) OR conv."assigneeId" = ${userId} OR conv."assigneeId" IS NULL)`
      }
      // COMPANY scope = no extra filter (TRUE)

      const deletedCondition = showDeleted
        ? Prisma.sql`conv."deletedAt" IS NOT NULL`
        : Prisma.sql`conv."deletedAt" IS NULL`

      // Read from the conversation table while keeping the response shape expected by the UI.
      const conversations: any[] = await prisma.$queryRaw`
        SELECT
          conv."id" as "conversationId",
          conv."remoteJid",
          conv."status",
          conv."priority",
          conv."assigneeId",
          conv."teamId",
          conv."pinnedAt",
          assignee."name" as "assigneeName",
          team."name" as "teamName",
          lm."lastMessage",
          lm."lastMessageType",
          lm."lastDirection",
          COALESCE(lm."lastMessageAt", conv."lastActivityAt") as "lastMessageAt",
          lm."metadata",
          c."name" as "contactName",
          c."profilePicture" as "profilePicture",
          COALESCE(u."unreadCount", 0) as "unreadCount",
          COALESCE(lbls."labels", '[]'::json) as "labels",
          ais."aiSessionStatus",
          ais."aiAgentName"
        FROM conversations conv
        LEFT JOIN contacts c ON c."id" = conv."contactId"
        LEFT JOIN users assignee ON assignee."id" = conv."assigneeId"
        LEFT JOIN teams team ON team."id" = conv."teamId"
        LEFT JOIN LATERAL (
          SELECT
            m."content" as "lastMessage",
            m."type" as "lastMessageType",
            m."direction" as "lastDirection",
            m."createdAt" as "lastMessageAt",
            m."metadata"
          FROM messages m
          WHERE m."instanceId" = conv."instanceId"
            AND (m."remoteJid" = conv."remoteJid"
              OR m."remoteJid" = conv."remoteJid" || '@s.whatsapp.net'
              OR m."remoteJid" || '@s.whatsapp.net' = conv."remoteJid")
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) lm ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int as "unreadCount"
          FROM messages m
          WHERE m."instanceId" = conv."instanceId"
            AND (m."remoteJid" = conv."remoteJid"
              OR m."remoteJid" = conv."remoteJid" || '@s.whatsapp.net'
              OR m."remoteJid" || '@s.whatsapp.net' = conv."remoteJid")
            AND m."direction" = 'INBOUND'
            AND m."status" != 'READ'
        ) u ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('id', l."id", 'title', l."title", 'color', l."color")) as "labels"
          FROM conversation_labels cl
          JOIN labels l ON l."id" = cl."labelId"
          WHERE cl."conversationId" = conv."id"
        ) lbls ON true
        LEFT JOIN LATERAL (
          SELECT ais2."status" as "aiSessionStatus", ag."name" as "aiAgentName"
          FROM ai_sessions ais2
          JOIN ai_agents ag ON ag."id" = ais2."agentId"
          WHERE ais2."instanceId" = conv."instanceId"
            AND ais2."remoteJid" = conv."remoteJid"
            AND ais2."status" IN ('OPENED', 'PAUSED')
          ORDER BY ais2."lastActivity" DESC
          LIMIT 1
        ) ais ON true
        WHERE conv."instanceId" = ${instanceId} AND ${deletedCondition} AND ${scopeCondition}
      `

      // Sort: pinned first, then by last message time
      conversations.sort((a: any, b: any) => {
        const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
        const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
        if (bPinned !== aPinned) return bPinned - aPinned
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      })

      // Apply search filter if provided
      let filtered = conversations
      if (search) {
        const term = search.toLowerCase()
        filtered = conversations.filter((c: any) =>
          c.remoteJid.toLowerCase().includes(term) ||
          (c.contactName && c.contactName.toLowerCase().includes(term)) ||
          (c.lastMessage && c.lastMessage.toLowerCase().includes(term))
        )
      }

      return reply.send({ conversations: filtered })
    })

    // Get group metadata (name, description, participants) from Evo Go
    app.get<{ Params: { instanceId: string; groupJid: string } }>('/group-info/:instanceId/:groupJid', { preHandler: [requirePermission('groups:read')] }, async (request, reply) => {
      const { instanceId, groupJid } = request.params

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance not connected or not Evo Go' })
      }

      try {
        const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
        const result = await evoGo.getGroupInfo(groupJid)
        const info = result?.data || result

        // /group/info returns uppercase keys: Name, Topic, ParticipantCount; lowercase: profilePicUrl, pictureId
        const groupName: string | undefined = info?.Name || info?.GroupName?.Name
        const groupPicUrl: string | undefined = info?.profilePicUrl || info?.ProfilePicUrl
        const groupPicId: string | undefined = info?.pictureId || info?.PictureID

        if (instance.companyId) {
          const existing = await prisma.contact.findFirst({
            where: { companyId: instance.companyId, phoneNumber: groupJid },
            select: { pictureId: true, profilePicture: true },
          })

          let localAvatar: string | null = existing?.profilePicture || null
          if (groupPicUrl && (groupPicId !== existing?.pictureId || !existing?.profilePicture)) {
            try {
              const cached = await cacheAvatar(groupJid, groupPicUrl, instance.companyId)
              if (cached) localAvatar = cached
            } catch { /* avatar download failed, skip */ }
          }

          const updateData: any = { whatsappSyncedAt: new Date() }
          if (groupName) updateData.name = groupName
          if (groupPicId) updateData.pictureId = groupPicId
          if (localAvatar) updateData.profilePicture = localAvatar

          await prisma.contact.upsert({
            where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: groupJid } },
            update: updateData,
            create: {
              companyId: instance.companyId,
              phoneNumber: groupJid,
              name: groupName || `Grupo ${groupJid}`,
              ...(groupPicId ? { pictureId: groupPicId } : {}),
              ...(localAvatar ? { profilePicture: localAvatar } : {}),
              whatsappSyncedAt: new Date(),
            },
          })

          // Expose local avatar path to frontend so it can update avatarCache
          if (localAvatar) info.profilePicture = localAvatar
        }

        return reply.send({ groupInfo: info })
      } catch (error: any) {
        console.error('[group-info] Error:', error.message)
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Get avatar/profile picture for a contact or group (with local caching)
    app.get<{ Params: { instanceId: string; jid: string } }>('/avatar/:instanceId/:jid', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId, jid } = request.params

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      // Check if we already have a cached avatar
      const contact = await prisma.contact.findFirst({
        where: { companyId: instance.companyId, phoneNumber: jid },
        select: { profilePicture: true },
      })
      if (contact?.profilePicture) {
        // Verify file still exists on disk
        const diskPath = path.join(__dirname, '..', '..', '..', contact.profilePicture)
        if (fs.existsSync(diskPath)) {
          return reply.send({ avatar: contact.profilePicture })
        }
      }

      if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
        return reply.send({ avatar: null })
      }

      try {
        const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
        const localPath = await fetchAndCacheAvatar(evoGo, jid, instance.companyId)
        return reply.send({ avatar: localPath })
      } catch (error: any) {
        return reply.send({ avatar: null })
      }
    })

    // Sync avatars for all conversations (fetch from API + cache locally)
    app.post<{ Params: { instanceId: string }; Body: { jids?: string[] } }>('/sync-avatars/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId } = request.params
      const body = request.body as { jids?: string[] } || {}

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
        return reply.send({ synced: 0 })
      }

      const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
      let jidsToSync = body.jids || []

      // If no specific jids, get all contacts without profilePicture
      if (jidsToSync.length === 0) {
        const contacts = await prisma.contact.findMany({
          where: {
            companyId: instance.companyId,
            profilePicture: null,
          },
          select: { phoneNumber: true },
          take: 50, // Process in batches of 50
        })
        jidsToSync = contacts.map(c => c.phoneNumber)
      }

      let synced = 0
      const results: Record<string, string | null> = {}
      for (const jid of jidsToSync) {
        const localPath = await fetchAndCacheAvatar(evoGo, jid, instance.companyId)
        results[jid] = localPath
        if (localPath) synced++
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200))
      }

      return reply.send({ synced, total: jidsToSync.length, results })
    })

    // Get contact/user info (combines DB data + Evo Go API data with caching)
    app.get<{ Params: { instanceId: string; jid: string }; Querystring: { refresh?: string } }>('/contact-info/:instanceId/:jid', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId, jid } = request.params
      const forceRefresh = request.query.refresh === 'true'

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      // Get DB contact data + custom attribute definitions in parallel
      const [contact, customAttrDefs] = await Promise.all([
        prisma.contact.findFirst({
          where: { companyId: instance.companyId, phoneNumber: jid },
        }),
        prisma.customAttributeDefinition.findMany({
          where: { companyId: instance.companyId, attributeModel: 'CONTACT' },
          orderBy: { attributeDisplayName: 'asc' },
        }),
      ])

      // Check if contact is a lead or customer
      let leadProfile: any = null
      let customerAccount: any = null
      if (contact) {
        const [lead, custMember] = await Promise.all([
          prisma.leadProfile.findUnique({
            where: { contactId: contact.id },
            select: { id: true, status: true, temperature: true, score: true, convertedAt: true },
          }),
          prisma.customerAccountContact.findFirst({
            where: { contactId: contact.id },
            include: { customerAccount: { select: { id: true, billingName: true, status: true, accountType: true } } },
          }),
        ])
        leadProfile = lead
        customerAccount = custMember?.customerAccount || null
      }

      const info: any = {
        contactId: contact?.id || null,
        name: contact?.name || null,
        email: contact?.email || null,
        tags: contact?.tags || [],
        profilePicture: contact?.profilePicture || null,
        metadata: contact?.metadata || {},
        status: contact?.whatsappStatus || null,
        verifiedName: contact?.verifiedName || null,
        isBusiness: contact?.isBusiness ?? null,
        isOnWhatsApp: null,
        customAttributeDefinitions: customAttrDefs,
        leadProfile,
        customerAccount,
      }

      // ALWAYS return DB data immediately — never block on Evo Go API
      // Only block on Evo Go if user explicitly requests refresh
      if (forceRefresh && instance.channel === 'EVO_GO' && instance.status === 'CONNECTED') {
        try {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          const fetchPromise = evoGo.getUserInfo([phone])
          const userInfoResult = await Promise.race([fetchPromise, timeoutPromise]) as any
          const userData = userInfoResult?.data || userInfoResult
          // evo-go returns data.users as an array with lowercase field names
          const usersArr: any[] = Array.isArray(userData?.users) ? userData.users : []
          const userEntry = usersArr.find((u: any) => u.jid === jid || u.jid === `${phone}@s.whatsapp.net` || u.number === phone) || usersArr[0]
          if (userEntry) {
            info.status = userEntry.status || null
            info.verifiedName = userEntry.verifiedName || null
            info.isBusiness = userEntry.isBusiness ?? null
            info.pictureId = userEntry.pictureId || null
            info.devices = userEntry.devices || []

            // Resolve best name: verified (WA Business) > businessName > fullName > pushName
            const syncedName = userEntry.verifiedName || userEntry.businessName || userEntry.fullName || userEntry.pushName || null
            if (syncedName) info.name = syncedName

            if (contact) {
              const updateData: any = {
                whatsappStatus: info.status,
                verifiedName: info.verifiedName,
                isBusiness: info.isBusiness,
                pictureId: userEntry.pictureId || null,
                whatsappSyncedAt: new Date(),
              }
              if (syncedName) updateData.name = syncedName

              // Download avatar if URL available and pictureId changed or no local copy
              if (userEntry.profilePicUrl) {
                const needsDownload = userEntry.pictureId !== contact.pictureId || !contact.profilePicture
                if (needsDownload) {
                  const localPath = await cacheAvatar(phone, userEntry.profilePicUrl, instance.companyId)
                  if (localPath) {
                    updateData.profilePicture = localPath
                    info.profilePicture = localPath
                  }
                }
              }

              await prisma.contact.update({
                where: { id: contact.id },
                data: updateData,
              })
            }
          }
        } catch (err: any) {
          console.error(`[contact-info] Evo Go refresh error:`, err.message)
        }
      } else if (instance.channel === 'EVO_GO' && instance.status === 'CONNECTED') {
        // Background sync: fire-and-forget — don't block the response
        const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour
        const isCacheStale = !contact?.whatsappSyncedAt ||
          (Date.now() - new Date(contact.whatsappSyncedAt).getTime()) > STALE_THRESHOLD_MS
        if (isCacheStale && contact) {
          // Fire and forget — response is already sent, this runs in background
          const bgInstance = instance
          const bgContact = contact
          setImmediate(async () => {
            try {
              const evoGo = new EvoGoProvider({ ...bgInstance, evoApiKey: decryptSafe(bgInstance.evoApiKey) as string })
              const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
              const fetchPromise = evoGo.getUserInfo([phone])
              const userInfoResult = await Promise.race([fetchPromise, timeoutPromise]) as any
              const userData = userInfoResult?.data || userInfoResult
              const bgUsersArr: any[] = Array.isArray(userData?.users) ? userData.users : []
              const userEntry = bgUsersArr.find((u: any) => u.jid === jid || u.jid === `${phone}@s.whatsapp.net` || u.number === phone) || bgUsersArr[0]
              if (userEntry) {
                const bgUpdateData: any = {
                  whatsappStatus: userEntry.status || null,
                  verifiedName: userEntry.verifiedName || null,
                  isBusiness: userEntry.isBusiness ?? null,
                  pictureId: userEntry.pictureId || null,
                  whatsappSyncedAt: new Date(),
                }
                if (userEntry.profilePicUrl && (userEntry.pictureId !== bgContact.pictureId || !bgContact.profilePicture)) {
                  const localPath = await cacheAvatar(phone, userEntry.profilePicUrl, bgInstance.companyId)
                  if (localPath) bgUpdateData.profilePicture = localPath
                }
                await prisma.contact.update({
                  where: { id: bgContact.id },
                  data: bgUpdateData,
                })
              }
            } catch (err: any) {
              console.error(`[contact-info] Background sync error for ${jid}:`, err.message)
            }
          })
        }
      }

      return reply.send({ contactInfo: info })
    })

    // Fetch all group metadata in bulk (for conversation list) + cache avatars
    app.get<{ Params: { instanceId: string } }>('/groups-metadata/:instanceId', { preHandler: [requirePermission('groups:read')] }, async (request, reply) => {
      const { instanceId } = request.params

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
        return reply.send({ groups: {} })
      }

      try {
        const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
        const result = await evoGo.listGroups()
        const groupsList = result?.data || result || []

        // Get existing cached avatars from DB
        const existingContacts = await prisma.contact.findMany({
          where: {
            companyId: instance.companyId,
            phoneNumber: { endsWith: '@g.us' },
          },
          select: { phoneNumber: true, profilePicture: true },
        })
        const cachedAvatars: Record<string, string | null> = {}
        for (const c of existingContacts) {
          cachedAvatars[c.phoneNumber] = c.profilePicture
        }

        const groupsMap: Record<string, { name: string; description?: string; participantCount: number; profilePicture?: string | null }> = {}
        const groupsNeedingAvatar: string[] = []

        for (const g of groupsList) {
          const jid = g.JID || ''
          const name = g.Name || g.GroupName?.Name || ''
          const description = g.Topic || g.GroupTopic?.Topic || ''
          const participantCount = g.ParticipantCount || g.Participants?.length || 0
          if (jid) {
            groupsMap[jid] = {
              name,
              description,
              participantCount,
              profilePicture: cachedAvatars[jid] || null,
            }
            // Mark groups without cached avatar for background fetch
            if (!cachedAvatars[jid]) {
              groupsNeedingAvatar.push(jid)
            }
          }
        }

        // Send response immediately, update DB in background
        reply.send({ groups: groupsMap })

        // Background: update contact names in DB (don't block response)
        ;(async () => {
          const upsertPromises = groupsList
            .filter((g: any) => (g.Name || g.GroupName?.Name) && (g.JID))
            .map((g: any) => {
              const jid = g.JID || ''
              const name = g.Name || g.GroupName?.Name || ''
              return prisma.contact.upsert({
                where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: jid } },
                update: { name },
                create: { companyId: instance.companyId, phoneNumber: jid, name },
              }).catch(() => {})
            })
          await Promise.allSettled(upsertPromises)

        })()

        // Fetch avatars for groups that don't have one yet (in background, don't wait)
        if (groupsNeedingAvatar.length > 0) {
          ;(async () => {
            for (const jid of groupsNeedingAvatar.slice(0, 30)) {
              try {
                await fetchAndCacheAvatar(evoGo, jid, instance.companyId)
              } catch {}
              await new Promise(r => setTimeout(r, 300)) // Rate limit
            }
          })()
        }
      } catch (error: any) {
        console.error('[groups-metadata] Error:', error.message)
        return reply.send({ groups: {} })
      }
    })

    // Get newsletter/channel metadata (name, description, subscriberCount)
    app.get<{ Params: { instanceId: string } }>('/newsletters-metadata/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId } = request.params

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
        return reply.send({ newsletters: {} })
      }

      try {
        const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
        const result = await evoGo.listNewsletters()
        const newslettersList = result?.data || result || []

        const newslettersMap: Record<string, { name: string; description?: string; subscriberCount?: number; profilePicture?: string | null }> = {}
        const upsertItems: { jid: string; name: string }[] = []

        for (const nl of newslettersList) {
          // Evo Go (whatsmeow) retorna: { id, thread_metadata: { name: { text }, description: { text }, ... } }
          const jid = nl.id || nl.ID || nl.JID || ''
          const name = nl.thread_metadata?.name?.text || nl.Name || nl.name || ''
          const description = nl.thread_metadata?.description?.text || nl.Description || nl.description || ''
          const subscriberCount = nl.thread_metadata?.subscriber_count || nl.SubscriberCount || nl.subscriberCount || 0

          if (jid) {
            const normalizedJid = jid.includes('@newsletter') ? jid : `${jid}@newsletter`
            newslettersMap[normalizedJid] = {
              name,
              description,
              subscriberCount,
              profilePicture: null,
            }
            if (name) upsertItems.push({ jid: normalizedJid, name })
          }
        }

        // Send response immediately, update DB in background
        reply.send({ newsletters: newslettersMap })

        // Background: update contact names in DB
        if (upsertItems.length > 0 && instance.companyId) {
          ;(async () => {
            await Promise.allSettled(upsertItems.map(item =>
              prisma.contact.upsert({
                where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: item.jid } },
                update: { name: item.name },
                create: { companyId: instance.companyId, phoneNumber: item.jid, name: item.name },
              }).catch(() => {})
            ))
          })()
        }
      } catch (error: any) {
        console.error('[newsletters-metadata] Error:', error.message)
        return reply.send({ newsletters: {} })
      }
    })

    // Mark messages as read when opening a chat
    app.post<{ Params: { instanceId: string }; Body: { remoteJid: string } }>('/mark-read/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId } = request.params
      const { remoteJid } = request.body as { remoteJid: string }
      if (!remoteJid) return reply.status(400).send({ error: 'remoteJid is required' })

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      const updated = await prisma.message.updateMany({
        where: {
          instanceId,
          remoteJid,
          direction: 'INBOUND',
          status: { not: 'READ' },
        },
        data: {
          status: 'READ',
          readAt: new Date(),
        },
      })

      return reply.send({ updated: updated.count })
    })

    // List groups for instance
    app.get<{ Params: { instanceId: string } }>('/groups/:instanceId', { preHandler: [requirePermission('groups:read')] }, async (request, reply) => {
      const { instanceId } = request.params

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      if (instance.channel !== 'BAILEYS') {
        return reply.status(400).send({ error: 'Groups are only available for Baileys instances' })
      }

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        const groups = await baileysManager.getGroups(instance.id)
        return reply.send({ groups })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Send message to group
    app.post('/send-group', { preHandler: [requirePermission('groups:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendGroupSchema.parse(request.body)

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      if (instance.channel !== 'BAILEYS') {
        return reply.status(400).send({ error: 'Groups are only available for Baileys instances' })
      }

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        // Ensure groupId has @g.us suffix
        let groupJid = data.groupId
        if (!groupJid.includes('@')) {
          groupJid = `${groupJid}@g.us`
        }

        console.log(`[send-group] Sending to group: ${groupJid}`)
        const result = await baileysManager.sendTextMessage(instance.id, groupJid, data.text, { sentByUserId: request.user.id })
        console.log(`[send-group] Result:`, result?.key)

        return reply.send({
          success: true,
          messageId: result?.key.id,
          groupId: groupJid
        })
      } catch (error: any) {
        console.error(`[send-group] Error:`, error)
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Get messages for instance (last 3 days only)
    app.get<{ Params: { instanceId: string }; Querystring: { page?: string; limit?: string; remoteJid?: string; before?: string } }>('/:instanceId', { preHandler: [requirePermission('conversations:read')] }, async (request, reply) => {
      const { instanceId } = request.params
      const page = parseInt(request.query.page || '1')
      const limit = Math.min(parseInt(request.query.limit || '50'), 200)
      const remoteJid = request.query.remoteJid
      const before = request.query.before // ISO date — load messages older than this

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      // When filtering by remoteJid (chat view), don't limit to 3 days and order ascending
      const where: any = { instanceId }
      if (remoteJid) {
        // Match both formats: digits-only and with @s.whatsapp.net suffix (legacy Baileys data)
        const isGroup = remoteJid.includes('@g.us') || remoteJid.includes('@newsletter') || remoteJid.includes('@broadcast')
        if (isGroup) {
          where.remoteJid = remoteJid
        } else {
          const digitsOnly = remoteJid.replace(/@.*/, '').replace(/\D/g, '')
          where.remoteJid = { in: [digitsOnly, `${digitsOnly}@s.whatsapp.net`] }
        }
        // Cursor: only messages older than `before`
        if (before) {
          const beforeDate = new Date(before)
          if (!isNaN(beforeDate.getTime())) {
            where.createdAt = { lt: beforeDate }
          }
        }
      } else {
        // Only apply 3-day filter on the general list view
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        where.createdAt = { gte: threeDaysAgo }
      }

      // When loading a specific chat, skip COUNT for performance (not needed for chat view)
      // Fetch the LATEST N messages (desc) then reverse to ascending for display
      if (remoteJid) {
        // Fetch limit+1 to detect if there are more older messages
        const messages = await prisma.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          include: {
            sentByUser: { select: { id: true, name: true } },
            sentByAIAgent: { select: { id: true, name: true } },
          },
        })
        const hasMore = messages.length > limit
        if (hasMore) messages.pop()
        messages.reverse()
        return reply.send({
          messages,
          hasMore,
          oldestCreatedAt: messages.length > 0 ? messages[0].createdAt : null,
          pagination: { page: 1, limit, total: messages.length, pages: 1 },
        })
      }

      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            sentByUser: { select: { id: true, name: true } },
            sentByAIAgent: { select: { id: true, name: true } },
          },
        }),
        prisma.message.count({ where }),
      ])

      return reply.send({
        messages,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      })
    })

    // ── Create note (private internal message) ──
    app.post('/note', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        instanceId: z.string().uuid(),
        remoteJid: z.string().min(5),
        content: z.string().min(1).max(10000),
      })
      const data = schema.parse(request.body)

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      const conversation = await ensureConversationForMessage({
        companyId: instance.companyId,
        instanceId: instance.id,
        remoteJid: data.remoteJid,
        lastActivityAt: new Date(),
      })

      const note = await prisma.message.create({
        data: {
          instanceId: instance.id,
          conversationId: conversation.id,
          remoteJid: data.remoteJid,
          messageId: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          direction: 'OUTBOUND',
          status: 'SENT',
          type: 'note',
          content: data.content,
          sentAt: new Date(),
          sentByUserId: request.user.id,
          metadata: {
            isNote: true,
            authorName: request.user.name || (request.user as any).email,
            authorId: request.user.id,
          },
        },
      })

      // Emit via socket so other agents see it in real-time
      io.to(instanceRoom(instance.companyId, instance.id)).emit('new-note', {
        instanceId: instance.id,
        remoteJid: data.remoteJid,
        note,
      })

      return reply.send({ success: true, note })
    })

    // ── Get notes history for a contact (by remoteJid) ──
    app.get('/notes/:instanceId/:remoteJid', { preHandler: [requirePermission('conversations:view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { instanceId, remoteJid } = request.params as { instanceId: string; remoteJid: string }

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })

      const notes = await prisma.message.findMany({
        where: {
          instanceId,
          remoteJid,
          type: 'note',
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          sentByUser: { select: { id: true, name: true } },
          sentByAIAgent: { select: { id: true, name: true } },
        },
      })

      return reply.send({ notes })
    })

    // Send text message (authenticated)
    app.post('/send', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendTextSchema.parse(request.body)

      if (!data.instanceId) {
        return reply.status(400).send({ error: 'instanceId is required' })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        // Pausar sessão AI quando atendente humano responde (stopBotFromMe)
        await pauseAISessionOnHumanReply(instance.id, data.to)

        if (instance.channel === 'BAILEYS') {
          const result = await baileysManager.sendTextMessage(instance.id, data.to, data.text, { sentByUserId: request.user.id })
          const msgId = result?.key.id || ''
          await persistOutboundMessage(instance, data.to, data.text, msgId, request.user.id)
          await triggerSendWebhook(instance, { to: data.to, content: data.text, type: 'text', messageId: msgId })
          return reply.send({ success: true, messageId: msgId })
        } else if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const result = await evoGo.sendTextMessage(data.to, data.text)
          const msgId = result?.key?.id || result?.messageId || ''
          await persistOutboundMessage(instance, data.to, data.text, msgId, request.user.id)
          await triggerSendWebhook(instance, { to: data.to, content: data.text, type: 'text', messageId: msgId })
          return reply.send({ success: true, messageId: msgId })
        } else {
          // Cloud API ou Coexistence - verificar rate limit
          if (instance.channel === 'COEXISTENCE') {
            const rateLimitResult = await checkRateLimit(instance.id)
            if (!rateLimitResult.allowed) {
              return reply.status(429).send({
                error: 'Rate limit exceeded (20 MPS for Coexistence)',
                retryAfterMs: rateLimitResult.retryAfterMs,
                limit: rateLimitResult.limit
              })
            }
          }
          const cloudApi = new CloudAPIProvider({ ...instance, accessToken: decryptSafe(instance.accessToken) as string })
          const result = await cloudApi.sendTextMessage(data.to, data.text)
          const msgId = result.messages?.[0]?.id || ''
          await persistOutboundMessage(instance, data.to, data.text, msgId, request.user.id)
          await triggerSendWebhook(instance, { to: data.to, content: data.text, type: 'text', messageId: msgId })
          return reply.send({ success: true, messageId: msgId })
        }
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Send interactive buttons (authenticated) - Uses NativeFlowMessage format
    app.post('/send-buttons', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendButtonsSchema.parse(request.body)

      if (!data.instanceId) {
        return reply.status(400).send({ error: 'instanceId is required' })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })
      if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') return reply.status(400).send({ error: 'Botões interativos disponíveis apenas para Baileys e Evo Go.' })

      try {
        // Pausar sessão AI quando atendente humano envia botões
        await pauseAISessionOnHumanReply(instance.id, data.to)

        if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const result = await evoGo.sendButtonMessage(
            data.to,
            data.header || '',
            data.text,
            data.footer || '',
            data.buttons.map(b => ({ type: 'reply', displayText: b.text, id: b.id }))
          )
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        }
        const result = await baileysManager.sendInteractiveButtons(
          instance.id, data.to, data.text, data.buttons, data.footer, data.header, { sentByUserId: request.user.id }
        )
        return reply.send({ success: true, messageId: result?.key.id })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Send interactive list (authenticated) - Uses NativeFlowMessage format
    app.post('/send-list', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendListSchema.parse(request.body)

      if (!data.instanceId) {
        return reply.status(400).send({ error: 'instanceId is required' })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })
      if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') return reply.status(400).send({ error: 'Listas interativas disponíveis apenas para Baileys e Evo Go.' })

      try {
        // Pausar sessão AI quando atendente humano envia lista
        await pauseAISessionOnHumanReply(instance.id, data.to)

        if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const result = await evoGo.sendListMessage(
            data.to,
            data.header || '',
            data.text,
            data.footer || '',
            data.buttonText,
            data.sections
          )
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        }
        const result = await baileysManager.sendInteractiveList(
          instance.id, data.to, data.text, data.buttonText, data.sections, data.footer, data.header, { sentByUserId: request.user.id }
        )
        return reply.send({ success: true, messageId: result?.key.id })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // ═══════ Send interactive message (unified: buttons, list, poll, pix) ═══════
    app.post('/send-interactive', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {

      const data = sendInteractiveSchema.parse(request.body)
      const interactiveMsg = data.interactive as InteractiveMessage

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })

      try {
        await pauseAISessionOnHumanReply(instance.id, data.to)

        const evoGo = (instance.channel === 'EVO_GO') ? new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string }) : undefined
        const bm = (instance.channel === 'BAILEYS') ? baileysManager : undefined

        const result = await sendInteractiveViaProvider({
          msg: interactiveMsg,
          to: data.to,
          instance,
          evoGo,
          baileysManager: bm,
        })

        // Persistir mensagem no DB
        const contentSummary = interactiveContentSummary(interactiveMsg)
        const msgType = interactiveMsg.type === 'buttons' ? 'button' : interactiveMsg.type
        const conversation = await ensureConversationForMessage({
          companyId: instance.companyId,
          instanceId: instance.id,
          remoteJid: data.to,
          lastActivityAt: new Date(),
          firstReplyAt: new Date(),
        })

        try {
          await prisma.message.create({
            data: {
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: data.to,
              messageId: result.messageId || `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              direction: 'OUTBOUND',
              status: 'SENT',
              type: msgType,
              content: contentSummary,
              sentAt: new Date(),
              sentByUserId: request.user.id,
              metadata: {
                interactive: interactiveMsg,
                fallback: result.fallback,
                fallbackText: result.fallbackText,
              } as any,
            },
          })
          await prisma.instance.update({
            where: { id: instance.id },
            data: { messagesSent: { increment: 1 } },
          })
          io.to(instanceRoom(instance.companyId, instance.id)).emit('message-sent', {
            instanceId: instance.id,
            from: data.to,
            content: contentSummary,
            type: msgType,
            timestamp: new Date(),
          })
        } catch (err: any) {
          if (err.code !== 'P2002') console.error('[persistInteractive]', err.message)
        }

        await triggerSendWebhook(instance, { to: data.to, content: contentSummary, type: msgType, messageId: result.messageId })

        return reply.send({
          success: true,
          messageId: result.messageId,
          fallback: result.fallback,
          interactiveType: interactiveMsg.type,
        })
      } catch (error: any) {
        const errMsg = error?.message || String(error)
        const errStack = error?.stack
        console.error('[send-interactive] failed', {
          instanceId: instance.id,
          channel: instance.channel,
          to: data.to,
          interactiveType: interactiveMsg.type,
          error: errMsg,
          stack: errStack,
        })
        return reply.status(500).send({ error: errMsg || 'Erro interno do servidor' })
      }
    })

    // Send media message (authenticated)
    app.post('/send-media', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendMediaSchema.parse(request.body)

      if (!data.instanceId) {
        return reply.status(400).send({ error: 'instanceId is required' })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
      })

      if (!instance) {
        return reply.status(404).send({ error: 'Instance not found' })
      }

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        // Pausar sessão AI quando atendente humano envia mídia
        await pauseAISessionOnHumanReply(instance.id, data.to)

        if (instance.channel === 'BAILEYS') {
          const result = await baileysManager.sendMediaMessage(
            instance.id,
            data.to,
            data.mediaType,
            data.mediaUrl,
            data.caption,
            data.fileName
          )
          return reply.send({ success: true, messageId: result?.key.id })
        } else if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const result = await evoGo.sendMediaMessage(data.to, data.mediaType, data.mediaUrl, data.caption, data.fileName)
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        } else {
          // Cloud API ou Coexistence - verificar rate limit
          if (instance.channel === 'COEXISTENCE') {
            const rateLimitResult = await checkRateLimit(instance.id)
            if (!rateLimitResult.allowed) {
              return reply.status(429).send({
                error: 'Rate limit exceeded (20 MPS for Coexistence)',
                retryAfterMs: rateLimitResult.retryAfterMs,
                limit: rateLimitResult.limit
              })
            }
          }
          const cloudApi = new CloudAPIProvider({ ...instance, accessToken: decryptSafe(instance.accessToken) as string })
          const result = await cloudApi.sendMediaMessage(data.to, data.mediaType, data.mediaUrl, data.caption)
          return reply.send({ success: true, messageId: result.messages?.[0]?.id })
        }
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Upload a file and send as media message (authenticated multipart)
    app.post('/send-media-upload', { preHandler: [requirePermission('conversations:reply')] }, async (request: FastifyRequest, reply: FastifyReply) => {

      const { writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const { randomUUID } = await import('crypto')

      let instanceId = '', to = '', mediaType = '', caption = ''
      let fileBuffer: Buffer | null = null
      let originalName = 'file'

      try {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer()
            originalName = part.filename || 'file'
          } else {
            const val = (part as any).value as string
            if (part.fieldname === 'instanceId') instanceId = val
            else if (part.fieldname === 'to') to = val
            else if (part.fieldname === 'mediaType') mediaType = val
            else if (part.fieldname === 'caption') caption = val
          }
        }
      } catch (err: any) {
        return reply.status(400).send({ error: 'Failed to parse multipart: ' + err.message })
      }

      if (!instanceId || !to || !mediaType || !fileBuffer) {
        return reply.status(400).send({ error: 'instanceId, to, mediaType, and file are required' })
      }

      const allowedTypes = ['image', 'video', 'audio', 'document']
      if (!allowedTypes.includes(mediaType)) {
        return reply.status(400).send({ error: 'mediaType must be one of: image, video, audio, document' })
      }

      const instance = await prisma.instance.findFirst({
        where: { id: instanceId, companyId: request.user.companyId, isActive: true },
      })
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })

      // Sanitize filename to prevent path traversal and block dangerous extensions
      const blockedExts = /\.(html?|svg|jsx?|tsx?|php|aspx?|exe|bat|cmd|ps1|sh|dll|msi|swf|htaccess)$/i
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
      if (blockedExts.test(safeName)) {
        return reply.status(400).send({ error: 'Tipo de arquivo n�o permitido' })
      }
      const savedName = `${randomUUID()}-${safeName}`
      const uploadsDir = join(process.cwd(), 'uploads', request.user.companyId)
      const { mkdir } = await import('fs/promises')
      await mkdir(uploadsDir, { recursive: true })
      await writeFile(join(uploadsDir, savedName), fileBuffer)

      // Public URL (browser access) and internal URL (Evo Go via Docker)
      const publicBase = (process.env.BACKEND_URL || 'http://localhost:3333').replace(/\/$/, '')
      const internalBase = (process.env.BACKEND_INTERNAL_URL || publicBase.replace('//localhost', '//host.docker.internal')).replace(/\/$/, '')
      const mediaPublicUrl = `${publicBase}/uploads/${request.user.companyId}/${savedName}`
      const mediaInternalUrl = `${internalBase}/uploads/${request.user.companyId}/${savedName}`

      // Short-lived download token for providers (Evo Go, Baileys, Cloud API) to fetch the file
      const downloadToken = request.server.jwt.sign(
        { sub: request.user.sub, companyId: request.user.companyId } as any,
        { expiresIn: '5m' }
      )
      const mediaInternalUrlAuth = `${mediaInternalUrl}?token=${downloadToken}`
      const mediaPublicUrlAuth = `${mediaPublicUrl}?token=${downloadToken}`

      try {
        // Pausar sessão AI quando atendente humano envia mídia upload
        await pauseAISessionOnHumanReply(instance.id, to)

        let msgId = ''
        if (instance.channel === 'EVO_GO') {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
          const result = await evoGo.sendMediaMessage(to, mediaType as "document" | "image" | "video" | "audio", mediaInternalUrlAuth, caption || undefined, originalName)
          msgId = result?.key?.id || result?.messageId || ''
        } else if (instance.channel === 'BAILEYS') {
          const result = await baileysManager.sendMediaMessage(instance.id, to, mediaType as "document" | "image" | "video" | "audio", mediaPublicUrlAuth, caption || undefined, originalName, { sentByUserId: request.user.id })
          msgId = result?.key?.id || ''
        } else {
          const cloudApi = new CloudAPIProvider({ ...instance, accessToken: decryptSafe(instance.accessToken) as string })
          const result = await cloudApi.sendMediaMessage(to, mediaType as "document" | "image" | "video" | "audio", mediaPublicUrlAuth, caption || undefined)
          msgId = result.messages?.[0]?.id || ''
        }

        await prisma.message.create({
          data: {
            instanceId: instance.id,
            conversationId: (await ensureConversationForMessage({
              companyId: instance.companyId,
              instanceId: instance.id,
              remoteJid: to,
              lastActivityAt: new Date(),
              firstReplyAt: new Date(),
            })).id,
            remoteJid: to,
            messageId: msgId || `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            direction: 'OUTBOUND',
            status: 'SENT',
            type: mediaType,
            content: caption || originalName,
            // Salvar relativo para que o frontend resolva via mesma origem (impacrm.*)
            // — assim o cookie de auth é enviado e nginx faz proxy → backend.
            // URL absoluta cross-subdomain (apiimpacrm.*) bloqueia o cookie e gera 401.
            mediaUrl: `/uploads/${request.user.companyId}/${savedName}`,
            sentAt: new Date(),
            sentByUserId: request.user.id,
          },
        })
        await prisma.instance.update({
          where: { id: instance.id },
          data: { messagesSent: { increment: 1 } },
        })
        io.to(instanceRoom(instance.companyId, instance.id)).emit('message-sent', {
          instanceId: instance.id,
          from: to,
          messageId: msgId || undefined,
          direction: 'OUTBOUND',
          content: caption || originalName,
          type: mediaType,
          mediaUrl: `/uploads/${request.user.companyId}/${savedName}`,
          timestamp: new Date(),
        })

        return reply.send({ success: true, messageId: msgId, mediaUrl: `/uploads/${request.user.companyId}/${savedName}` })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })
  })

  // API Token routes (for external integrations)
  fastify.register(async (app) => {
    app.addHook('preHandler', apiTokenMiddleware)

    // Send text via API token
    app.post('/api/send', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendTextSchema.parse(request.body)
      const instance = request.instance!

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        // Pausar sessão AI quando envio via API token (ex: atendente ou integração)
        await pauseAISessionOnHumanReply(instance.id, data.to)

        let messageId: string | undefined

        if (instance.channel === 'BAILEYS') {
          const result = await baileysManager.sendTextMessage(instance.id, data.to, data.text)
          messageId = result?.key.id || undefined
        } else if (instance.channel === 'EVO_GO') {
          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })
          if (!fullInstance) return reply.status(404).send({ error: 'Instance not found' })
          const evoGo = new EvoGoProvider({ ...fullInstance, evoApiKey: decryptSafe(fullInstance.evoApiKey) as string })
          const result = await evoGo.sendTextMessage(data.to, data.text)
          messageId = result?.key?.id || result?.messageId || undefined
          await triggerSendWebhook(fullInstance, { to: data.to, content: data.text, type: 'text', messageId })
        } else {
          // Cloud API ou Coexistence - verificar rate limit para Coexistence
          if (instance.channel === 'COEXISTENCE') {
            const rateLimitResult = await checkRateLimit(instance.id)
            if (!rateLimitResult.allowed) {
              return reply.status(429).send({
                error: 'Rate limit exceeded (20 MPS for Coexistence)',
                retryAfterMs: rateLimitResult.retryAfterMs,
                limit: rateLimitResult.limit
              })
            }
          }

          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })

          if (!fullInstance) {
            return reply.status(404).send({ error: 'Instance not found' })
          }

          if (!fullInstance.phoneNumberId || !fullInstance.accessToken) {
            return reply.status(400).send({
              error: 'Cloud API credentials not configured. Please add Phone Number ID and Access Token in the instance settings.'
            })
          }

          const cloudApi = new CloudAPIProvider({ ...fullInstance, accessToken: decryptSafe(fullInstance.accessToken) as string })
          const result = await cloudApi.sendTextMessage(data.to, data.text)
          messageId = result.messages?.[0]?.id

          // Disparar webhook para Cloud API / Coexistence
          await triggerSendWebhook(fullInstance, {
            to: data.to,
            content: data.text,
            type: 'text',
            messageId,
          })
        }

        return reply.send({ success: true, messageId })
      } catch (error: any) {
        console.error('API send error:', error)
        return reply.status(500).send({ error: 'Erro ao enviar mensagem' })
      }
    })

    // Send interactive buttons via API token
    app.post('/api/send-buttons', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendButtonsSchema.parse(request.body)
      const instance = request.instance!

      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })
      if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') return reply.status(400).send({ error: 'Botões interativos disponíveis apenas para Baileys e Evo Go' })

      try {
        if (instance.channel === 'EVO_GO') {
          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })
          if (!fullInstance) return reply.status(404).send({ error: 'Instance not found' })
          const evoGo = new EvoGoProvider({ ...fullInstance, evoApiKey: decryptSafe(fullInstance.evoApiKey) as string })
          const result = await evoGo.sendButtonMessage(
            data.to, data.header || '', data.text, data.footer || '',
            data.buttons.map(b => ({ type: 'reply', displayText: b.text, id: b.id }))
          )
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        }
        const result = await baileysManager.sendInteractiveButtons(
          instance.id, data.to, data.text, data.buttons, data.footer, data.header
        )
        return reply.send({ success: true, messageId: result?.key.id })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Send interactive list via API token
    app.post('/api/send-list', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendListSchema.parse(request.body)
      const instance = request.instance!

      if (instance.status !== 'CONNECTED') return reply.status(400).send({ error: 'Instance is not connected' })
      if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') return reply.status(400).send({ error: 'Listas interativas disponíveis apenas para Baileys e Evo Go' })

      try {
        if (instance.channel === 'EVO_GO') {
          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })
          if (!fullInstance) return reply.status(404).send({ error: 'Instance not found' })
          const evoGo = new EvoGoProvider({ ...fullInstance, evoApiKey: decryptSafe(fullInstance.evoApiKey) as string })
          const result = await evoGo.sendListMessage(
            data.to, data.header || '', data.text, data.footer || '', data.buttonText, data.sections
          )
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        }
        const result = await baileysManager.sendInteractiveList(
          instance.id, data.to, data.text, data.buttonText, data.sections, data.footer, data.header
        )
        return reply.send({ success: true, messageId: result?.key.id })
      } catch (error: any) {
        return reply.status(500).send({ error: 'Erro interno do servidor' })
      }
    })

    // Send media via API token
    app.post('/api/send-media', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendMediaSchema.parse(request.body)
      const instance = request.instance!

      if (instance.status !== 'CONNECTED') {
        return reply.status(400).send({ error: 'Instance is not connected' })
      }

      try {
        if (instance.channel === 'BAILEYS') {
          const result = await baileysManager.sendMediaMessage(
            instance.id,
            data.to,
            data.mediaType,
            data.mediaUrl,
            data.caption,
            data.fileName
          )
          return reply.send({ success: true, messageId: result?.key.id })
        } else if (instance.channel === 'EVO_GO') {
          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })
          if (!fullInstance) return reply.status(404).send({ error: 'Instance not found' })
          const evoGo = new EvoGoProvider({ ...fullInstance, evoApiKey: decryptSafe(fullInstance.evoApiKey) as string })
          const result = await evoGo.sendMediaMessage(data.to, data.mediaType, data.mediaUrl, data.caption, data.fileName)
          return reply.send({ success: true, messageId: result?.key?.id || result?.messageId })
        } else {
          // Cloud API ou Coexistence - verificar rate limit para Coexistence
          if (instance.channel === 'COEXISTENCE') {
            const rateLimitResult = await checkRateLimit(instance.id)
            if (!rateLimitResult.allowed) {
              return reply.status(429).send({
                error: 'Rate limit exceeded (20 MPS for Coexistence)',
                retryAfterMs: rateLimitResult.retryAfterMs,
                limit: rateLimitResult.limit
              })
            }
          }

          const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })

          if (!fullInstance) {
            return reply.status(404).send({ error: 'Instance not found' })
          }

          if (!fullInstance.phoneNumberId || !fullInstance.accessToken) {
            return reply.status(400).send({
              error: 'Cloud API credentials not configured. Please add Phone Number ID and Access Token in the instance settings.'
            })
          }

          const cloudApi = new CloudAPIProvider({ ...fullInstance, accessToken: decryptSafe(fullInstance.accessToken) as string })
          const result = await cloudApi.sendMediaMessage(data.to, data.mediaType, data.mediaUrl, data.caption)
          return reply.send({ success: true, messageId: result.messages?.[0]?.id })
        }
      } catch (error: any) {
        console.error('API send-media error:', error)
        return reply.status(500).send({ error: 'Erro ao enviar m�dia' })
      }
    })

    // Send template via API token
    app.post('/api/send-template', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendTemplateSchema.parse(request.body)
      const instance = request.instance!

      if (instance.channel !== 'CLOUD_API' && instance.channel !== 'COEXISTENCE') {
        return reply.status(400).send({ error: 'Templates are only available for Cloud API or Coexistence instances' })
      }

      // Rate limit check para Coexistence
      if (instance.channel === 'COEXISTENCE') {
        const rateLimitResult = await checkRateLimit(instance.id)
        if (!rateLimitResult.allowed) {
          return reply.status(429).send({
            error: 'Rate limit exceeded (20 MPS for Coexistence)',
            retryAfterMs: rateLimitResult.retryAfterMs,
            limit: rateLimitResult.limit
          })
        }
      }

      try {
        const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })

        if (!fullInstance) {
          return reply.status(404).send({ error: 'Instance not found' })
        }

        if (!fullInstance.phoneNumberId || !fullInstance.accessToken) {
          return reply.status(400).send({
            error: 'Cloud API credentials not configured. Please add Phone Number ID and Access Token in the instance settings.'
          })
        }

        const cloudApi = new CloudAPIProvider({ ...fullInstance, accessToken: decryptSafe(fullInstance.accessToken) as string })
        const result = await cloudApi.sendTemplateMessage(data.to, data.templateName, data.language, data.components)
        return reply.send({ success: true, messageId: result.messages?.[0]?.id })
      } catch (error: any) {
        console.error('Cloud API send-template error:', error)
        return reply.status(500).send({ error: 'Erro ao enviar template' })
      }
    })

    // Send invoice template (formato SjnetworkAPI: PDF + PIX + Boleto)
    app.post('/api/send-invoice', async (request: FastifyRequest, reply: FastifyReply) => {
      const data = sendInvoiceSchema.parse(request.body)
      const instance = request.instance!

      if (instance.channel !== 'CLOUD_API' && instance.channel !== 'COEXISTENCE') {
        return reply.status(400).send({ error: 'Invoice templates are only available for Cloud API or Coexistence instances' })
      }

      // Rate limit check para Coexistence
      if (instance.channel === 'COEXISTENCE') {
        const rateLimitResult = await checkRateLimit(instance.id)
        if (!rateLimitResult.allowed) {
          return reply.status(429).send({
            error: 'Rate limit exceeded (20 MPS for Coexistence)',
            retryAfterMs: rateLimitResult.retryAfterMs,
            limit: rateLimitResult.limit
          })
        }
      }

      try {
        const fullInstance = await prisma.instance.findUnique({ where: { id: instance.id } })

        if (!fullInstance) {
          return reply.status(404).send({ error: 'Instance not found' })
        }

        if (!fullInstance.phoneNumberId || !fullInstance.accessToken) {
          return reply.status(400).send({
            error: 'Cloud API credentials not configured.'
          })
        }

        const cloudApi = new CloudAPIProvider({ ...fullInstance, accessToken: decryptSafe(fullInstance.accessToken) as string })
        const result = await cloudApi.sendInvoiceTemplate(
          data.to,
          data.templateName,
          data.language,
          {
            documentUrl: data.documentUrl,
            documentFilename: data.documentFilename,
            bodyParams: [data.invoiceNumber, data.customerName, data.amount, data.dueDate],
            pixCode: data.pixCode,
            boletoCode: data.boletoCode,
          }
        )
        return reply.send({ success: true, messageId: result.messages?.[0]?.id })
      } catch (error: any) {
        console.error('Cloud API send-invoice error:', error)
        return reply.status(500).send({ error: 'Erro ao enviar fatura' })
      }
    })

    // ── Import historical messages from Evo Go ──
    // POST /messages/import-history/:instanceId
    // Idempotent: uses skipDuplicates on messageId.
    app.post<{ Params: { instanceId: string }; Querystring: { days?: string } }>(
      '/import-history/:instanceId',
      { preHandler: [requirePermission('conversations:read')] },
      async (request, reply) => {
        const { instanceId } = request.params
        const days = Math.min(parseInt(request.query.days || '90', 10) || 90, 365)

        const instance = await prisma.instance.findFirst({
          where: { id: instanceId, companyId: request.user.companyId },
        })
        if (!instance) return reply.status(404).send({ error: 'Instance not found' })
        if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
          return reply.status(400).send({ error: 'Instance not connected or not Evo Go' })
        }

        try {
          const result = await runHistoryImport(instance, days)
          return reply.send(result)
        } catch (error: any) {
          console.error('[import-history] Error:', error.message)
          return reply.status(500).send({ error: 'Erro ao importar histórico' })
        }
      }
    )

  })

  // Admin/JWT routes for history import management (NOT inside API token scope)
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // ── Sync incremental: busca o histórico no Evo Go e insere apenas as
    //    mensagens novas (createMany skipDuplicates por messageId @unique).
    //    Não apaga nada do banco — preserva atribuições, notas, status etc.
    // POST /messages/reimport-history/:instanceId
    app.post<{ Params: { instanceId: string } }>(
      '/reimport-history/:instanceId',
      async (request, reply) => {
        const { instanceId } = request.params

        const instance = await prisma.instance.findFirst({
          where: { id: instanceId, companyId: request.user.companyId },
        })
        if (!instance) return reply.status(404).send({ error: 'Instance not found' })
        if (instance.channel !== 'EVO_GO' || instance.status !== 'CONNECTED') {
          return reply.status(400).send({ error: 'Instance not connected or not Evo Go' })
        }

        const beforeCount = await prisma.message.count({ where: { instanceId } })
        console.log(`[reimport-history] ${instanceId}: iniciando sync incremental (banco tem ${beforeCount} msgs)...`)

        reply.send({
          status: 'started',
          existingMessages: beforeCount,
        })

        ;(async () => {
          try {
            const result = await runHistoryImport(instance)
            const afterCount = await prisma.message.count({ where: { instanceId } })
            console.log(`[reimport-history] ${instanceId}: concluído. Banco: ${beforeCount} → ${afterCount} (+${afterCount - beforeCount} novas). Resultado: ${JSON.stringify(result)}`)
          } catch (err: any) {
            console.error(`[reimport-history] ${instanceId}: erro`, err?.message || err)
          }
        })()
      }
    )

    // GET /messages/import-history/status/:instanceId — proxy para status da evo-go
    app.get<{ Params: { instanceId: string } }>(
      '/import-history/status/:instanceId',
      { preHandler: [requirePermission('conversations:read')] },
      async (request, reply) => {
        const { instanceId } = request.params

        const instance = await prisma.instance.findFirst({
          where: { id: instanceId, companyId: request.user.companyId },
          select: { id: true, channel: true, status: true, evoApiKey: true, evoApiUrl: true, evoInstanceId: true, historySyncedAt: true },
        })
        if (!instance) return reply.status(404).send({ error: 'Instance not found' })
        if (instance.channel !== 'EVO_GO') {
          return reply.status(400).send({ error: 'Not an Evo Go instance' })
        }

        try {
          const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string } as any)
          const statusResult = await evoGo.getImportHistoryStatus()
          return reply.send({ ...statusResult, historySyncedAt: instance.historySyncedAt })
        } catch (error: any) {
          console.error('[import-history/status] Error:', error.message)
          return reply.status(500).send({ error: 'Erro ao buscar status de importação' })
        }
      }
    )
  })
}
