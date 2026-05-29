import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { MessageStatus } from '@prisma/client'
import axios from 'axios'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { io } from '../../server.js'
import { redis } from '../../config/redis.js'
import { handleTypebotMessage } from '../typebot/typebot.routes.js'
import { getFlowEngine } from '../flows/flow.engine.js'
import { handleIncomingForAI, pauseAISessionOnHumanReply } from '../ai/whatsapp.integration.js'
import { randomUUID, createHash, createHmac, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import { ensureConversationForMessage } from '../conversations/conversation.service.js'
import { processConversationAutomations } from '../conversation-automations/automation-processor.service.js'
import { runHistoryImport } from '../messages/import-history.helper.js'
import { instanceRoom } from '../../config/socket-rooms.js'
import { isWebhookReplay } from '../../core/webhook-replay.js'
import { decryptSafe } from '../../config/encryption.js'
import { handleOutOfOfficeReply, processCsatResponse } from '../channel-settings/channel-settings.service.js'

/** Marca que a IA está enviando para este remoteJid agora — dura 30s.
 * Usado para evitar que o webhook fromMe do Evo Go pause a IA por race condition. */
async function markAISending(instanceId: string, remoteJid: string): Promise<void> {
  try {
    await redis.set(`ai_sending:${instanceId}:${remoteJid}`, '1', 'EX', 30)
  } catch { /* Redis indisponível: degradar sem crash */ }
}

async function isAISending(instanceId: string, remoteJid: string): Promise<boolean> {
  try {
    const val = await redis.get(`ai_sending:${instanceId}:${remoteJid}`)
    return val === '1'
  } catch {
    return false
  }
}

const pendingInitialHistoryImports = new Set<string>()

function queueInitialHistoryImport(instance: {
  id: string
  companyId: string
  evoApiKey: string | null
  evoApiUrl: string | null
  evoInstanceId: string | null
  historySyncedAt?: Date | null
}) {
  if (pendingInitialHistoryImports.has(instance.id)) {
    return
  }

  pendingInitialHistoryImports.add(instance.id)

  setImmediate(async () => {
    try {
      const latestInstance = await prisma.instance.findUnique({
        where: { id: instance.id },
        select: { historySyncedAt: true },
      })

      if (latestInstance?.historySyncedAt) {
        const importedMessages = await prisma.message.count({
          where: { instanceId: instance.id, createdAt: { lte: latestInstance.historySyncedAt } },
        })
        if (importedMessages > 0) return
        console.log(`[Evo Go Webhook] Histórico estava marcado como sincronizado sem mensagens; tentando novamente para ${instance.id}`)
      }

      const result = await runHistoryImport(instance)
      if (result.total === 0) {
        console.log(`[Evo Go Webhook] Histórico ainda vazio para ${instance.id}; não marquei como sincronizado`)
      } else {
        console.log(`[Evo Go Webhook] Histórico importado para ${instance.id}: ${result.imported}/${result.total} msgs, ${result.conversations} conversas`)
      }
    } catch (err: any) {
      console.error(`[Evo Go Webhook] Erro ao importar histórico para ${instance.id}:`, err.message)
    } finally {
      pendingInitialHistoryImports.delete(instance.id)
    }
  })
}

/**
 * Persiste mensagem outbound da IA no DB (com conversationId) e emite
 * socket `message-sent` para o CRM atualizar em tempo real.
 *
 * Antes desta função, callbacks de IA chamavam direto a API do canal
 * (Cloud API/Evo Go) e a mensagem só aparecia no DB quando voltava via
 * webhook fromMe — dando a impressão de que a IA enviava "por fora" do
 * CRM e o WhatsApp atualizava antes da timeline.
 */
async function persistAIOutbound(params: {
  instance: any
  remoteJid: string
  text: string
  type: string
  messageId?: string
  aiAgentId?: string
  metadata?: any
}): Promise<void> {
  try {
    const conversation = await ensureConversationForMessage({
      companyId: params.instance.companyId,
      instanceId: params.instance.id,
      remoteJid: params.remoteJid,
      lastActivityAt: new Date(),
      firstReplyAt: new Date(),
    })
    await prisma.message.create({
      data: {
        instanceId: params.instance.id,
        conversationId: conversation.id,
        remoteJid: params.remoteJid,
        messageId: params.messageId || `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        direction: 'OUTBOUND',
        status: 'SENT',
        type: params.type,
        content: params.text,
        sentAt: new Date(),
        ...(params.aiAgentId ? { sentByAIAgentId: params.aiAgentId } : {}),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
    }).catch((err: any) => {
      if (err?.code !== 'P2002') console.error('[persistAIOutbound]', err.message)
    })
    await prisma.instance.update({
      where: { id: params.instance.id },
      data: { messagesSent: { increment: 1 } },
    }).catch(() => {})
    io.to(instanceRoom(params.instance.companyId, params.instance.id)).emit('message-sent', {
      instanceId: params.instance.id,
      from: params.remoteJid,
      messageId: params.messageId || undefined,
      direction: 'OUTBOUND',
      content: params.text,
      type: params.type,
      timestamp: new Date(),
      sentByAIAgentId: params.aiAgentId,
    })
  } catch (e: any) {
    console.error('[persistAIOutbound] outer:', e?.message || e)
  }
}

/**
 * Baixa mídia do Meta Cloud API via media ID e retorna como Buffer base64.
 * Requer access_token da instância.
 */
async function downloadMetaMedia(mediaId: string, accessToken: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const infoRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!infoRes.ok) return null
    const info = await infoRes.json() as any
    const mediaUrl: string = info.url
    const mime: string = info.mime_type || 'image/jpeg'
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!mediaRes.ok) return null
    const buffer = Buffer.from(await mediaRes.arrayBuffer())
    return { base64: buffer.toString('base64'), mimeType: mime }
  } catch (err: any) {
    console.warn(`[MetaMedia] Failed to download media ${mediaId}: ${err.message}`)
    return null
  }
}

// Send message via Cloud API (used by FlowEngine)
async function sendCloudApiMessage(instance: any, to: string, content: any, type: string): Promise<void> {
  const axios = (await import('axios')).default

  // Format phone number
  const phoneNumber = to.replace('@s.whatsapp.net', '').replace(/\D/g, '')

  const baseUrl = 'https://graph.facebook.com/v18.0'
  const url = `${baseUrl}/${instance.phoneNumberId}/messages`

  let messagePayload: any = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
  }

  switch (type) {
    case 'text':
      messagePayload.type = 'text'
      messagePayload.text = { body: content.text || String(content) }
      break
    case 'image':
      messagePayload.type = 'image'
      messagePayload.image = { link: content.image?.url, caption: content.caption }
      break
    case 'audio':
      messagePayload.type = 'audio'
      messagePayload.audio = { link: content.audio?.url }
      break
    case 'video':
      messagePayload.type = 'video'
      messagePayload.video = { link: content.video?.url, caption: content.caption }
      break
    case 'document':
      messagePayload.type = 'document'
      messagePayload.document = { link: content.document?.url, filename: content.fileName, caption: content.caption }
      break
    case 'buttons':
      // Cloud API uses interactive messages for buttons
      messagePayload.type = 'interactive'
      messagePayload.interactive = {
        type: 'button',
        body: { text: content.text || '' },
        action: {
          buttons: content.buttons?.slice(0, 3).map((btn: any) => ({
            type: 'reply',
            reply: { id: btn.buttonId, title: btn.buttonText?.displayText || btn.text }
          }))
        }
      }
      break
    case 'list':
      messagePayload.type = 'interactive'
      messagePayload.interactive = {
        type: 'list',
        body: { text: content.text || '' },
        action: {
          button: content.buttonText || 'Menu',
          sections: content.sections
        }
      }
      break
    default:
      messagePayload.type = 'text'
      messagePayload.text = { body: content.text || String(content) }
  }

  try {
    await axios.post(url, messagePayload, {
      headers: {
        Authorization: `Bearer ${instance.accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    console.log('Cloud API message sent:', type, 'to:', phoneNumber)
  } catch (error: any) {
    console.error('Cloud API send error:', error.response?.data || error.message)
  }
}

export async function webhookRoutes(fastify: FastifyInstance) {
  // Chatwoot webhook handler
  await handleChatwootWebhook(fastify)

  // Meta Cloud API Webhook Verification
  fastify.get('/cloud', async (request: FastifyRequest<{ Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string } }>, reply: FastifyReply) => {
    const mode = request.query['hub.mode']
    const token = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']

    console.log('Webhook verification request:', { mode, hasToken: !!token })

    // Accept verification if mode is subscribe and token matches (or if no token is configured)
    if (mode === 'subscribe') {
      if (!env.META_WEBHOOK_VERIFY_TOKEN || (token && env.META_WEBHOOK_VERIFY_TOKEN &&
        Buffer.byteLength(token) === Buffer.byteLength(env.META_WEBHOOK_VERIFY_TOKEN) &&
        timingSafeEqual(Buffer.from(token), Buffer.from(env.META_WEBHOOK_VERIFY_TOKEN)))) {
        console.log('Webhook verified successfully')
        // Meta expects the challenge as plain text
        return reply.type('text/plain').send(challenge)
      }
    }

    console.log('Webhook verification failed - token mismatch or invalid mode')
    return reply.status(403).send({ error: 'Forbidden' })
  })

  // Health check for webhook (can be used to test if endpoint is accessible)
  fastify.get('/cloud/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      endpoint: '/api/webhook/cloud',
    })
  })

  // Meta Cloud API Webhook Verification (per instance)
  fastify.get('/cloud-api/:instanceId', async (request: FastifyRequest<{
    Params: { instanceId: string },
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }
  }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const mode = request.query['hub.mode']
    const token = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']

    console.log('Webhook verification request for instance:', instanceId, { mode, hasToken: !!token })

    // Find instance to validate webhook secret
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      select: { webhookSecret: true, name: true }
    })

    if (!instance) {
      console.log('Instance not found:', instanceId)
      return reply.status(404).send({ error: 'Instance not found' })
    }

    // Accept verification if mode is subscribe and token matches
    if (mode === 'subscribe') {
      // If instance has webhookSecret, validate it; otherwise accept any token
      const secret = decryptSafe(instance.webhookSecret) as string | null
      if (!secret || (token && secret &&
        Buffer.byteLength(token) === Buffer.byteLength(secret) &&
        timingSafeEqual(Buffer.from(token), Buffer.from(secret)))) {
        console.log('Webhook verified successfully for instance:', instance.name)
        return reply.type('text/plain').send(challenge)
      }
    }

    console.log('Webhook verification failed for instance:', instanceId)
    return reply.status(403).send({ error: 'Forbidden' })
  })

  // Meta Cloud API Webhook Events (per instance)
  fastify.post('/cloud-api/:instanceId', async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const body = request.body as any

    console.log('[Webhook] cloud-api POST for instance:', instanceId)

    // Find instance
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        typebotIntegration: true,
        n8nIntegration: true,
      },
    })

    if (!instance) {
      console.log('Instance not found:', instanceId)
      return reply.status(404).send({ error: 'Instance not found' })
    }

    // Verify Meta webhook signature (X-Hub-Signature-256) using HMAC-SHA256
    const wSecret = decryptSafe(instance.webhookSecret) as string | null
    if (wSecret) {
      const signature = request.headers['x-hub-signature-256'] as string
      if (signature) {
        const rawBody = JSON.stringify(body)
        const expected = 'sha256=' + createHmac('sha256', wSecret).update(rawBody).digest('hex')
        try {
          const a = Buffer.from(signature)
          const b = Buffer.from(expected)
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return reply.status(403).send({ error: 'Invalid webhook signature' })
          }
        } catch {
          return reply.status(403).send({ error: 'Invalid webhook signature' })
        }
      }
    }

    if (body.object !== 'whatsapp_business_account') {
      console.log('Invalid webhook object:', body.object)
      return reply.status(400).send({ error: 'Invalid webhook' })
    }

    // Replay protection: deduplicate by entry ID
    const entryId = body.entry?.[0]?.id
    if (entryId && await isWebhookReplay('cloud-api', `${instanceId}:${entryId}:${JSON.stringify(body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || '')}`)) {
      return reply.send({ status: 'ok', deduplicated: true })
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        console.log('Change field:', change.field)
        if (change.field !== 'messages') continue

        const value = change.value
        console.log('Messages in payload:', value.messages?.length || 0)
        console.log('Statuses in payload:', value.statuses?.length || 0)

        // Handle incoming messages
        for (const message of value.messages || []) {
          const from = message.from
          let content = ''
          let type = 'text'

          console.log('Processing message from:', from, 'type:', message.type)

          switch (message.type) {
            case 'text':
              content = message.text?.body || ''
              type = 'text'
              break
            case 'image':
              content = message.image?.caption || '[Image]'
              type = 'image'
              break
            case 'video':
              content = message.video?.caption || '[Video]'
              type = 'video'
              break
            case 'audio':
              content = '[Audio]'
              type = 'audio'
              break
            case 'document':
              content = message.document?.filename || '[Document]'
              type = 'document'
              break
            case 'button':
              content = message.button?.text || message.button?.payload || '[Button Response]'
              type = 'text'
              break
            case 'interactive':
              content = message.interactive?.button_reply?.title ||
                       message.interactive?.list_reply?.title ||
                       '[Interactive Response]'
              type = 'text'
              break
          }

          console.log('Saving message:', { from, type, content: content.substring(0, 50) })

          // Save message
          const conversation = await ensureConversationForMessage({
            companyId: instance.companyId,
            instanceId: instance.id,
            remoteJid: from,
            lastActivityAt: new Date(),
          })

          // Processar automações (non-blocking)
          if (conversation._isNew) {
            processConversationAutomations('conversation_created', {
              companyId: instance.companyId,
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              contactId: conversation.contactId,
              direction: 'INBOUND',
              messageContent: content,
              messageType: type,
              isNewConversation: true,
            }).catch(err => console.error('[Cloud API] Erro em automações:', err))
          }
          processConversationAutomations('message_created', {
            companyId: instance.companyId,
            instanceId: instance.id,
            conversationId: conversation.id,
            remoteJid: from,
            contactId: conversation.contactId,
            direction: 'INBOUND',
            messageContent: content,
            messageType: type,
            isNewConversation: conversation._isNew,
          }).catch(err => console.error('[Cloud API] Erro em automações message:', err))

          const savedMessage = await prisma.message.create({
            data: {
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              messageId: message.id,
              direction: 'INBOUND',
              status: 'DELIVERED',
              type,
              content,
              deliveredAt: new Date(),
            },
          })

          console.log('Message saved with ID:', savedMessage.id)

          // Update metrics
          await prisma.instance.update({
            where: { id: instance.id },
            data: { messagesReceived: { increment: 1 } },
          })

          // Update contact's lastInboundAt for 24h window tracking
          if (instance.companyId && from) {
            await prisma.contact.upsert({
              where: {
                companyId_phoneNumber: {
                  companyId: instance.companyId,
                  phoneNumber: from,
                },
              },
              update: {
                lastInboundAt: new Date(),
              },
              create: {
                companyId: instance.companyId,
                phoneNumber: from,
                name: from,
                lastInboundAt: new Date(),
              },
            })
          }

          // Emit to socket
          io.to(instanceRoom(instance.companyId, instance.id)).emit('message-received', {
            instanceId: instance.id,
            from,
            content,
            type,
            timestamp: new Date(),
          })

          // Trigger webhooks
          await triggerInstanceWebhooks(instance, {
            event: 'message.received',
            from,
            content,
            type,
            timestamp: new Date(),
          })

          // Trigger Typebot if configured
          if (type === 'text' && content) {
            console.log('Triggering Typebot for instance:', instance.id, 'from:', from, 'message:', content.substring(0, 50))
            try {
              const typebotResponse = await handleTypebotMessage(instance.id, from, content)
              if (typebotResponse) {
                console.log('Typebot response:', JSON.stringify(typebotResponse).substring(0, 200))
              }
            } catch (typebotError) {
              console.error('Error triggering Typebot:', typebotError)
            }
          }

          // Process with FlowEngine (chatbot flows)
          try {
            const flowEngine = getFlowEngine()
            if (flowEngine && type === 'text' && content) {
              console.log('Processing with FlowEngine for instance:', instance.id)

              // Create a custom send function for this instance
              const originalSendFn = (flowEngine as any).sendMessage
              ;(flowEngine as any).sendMessage = async (to: string, msgContent: any, msgType: string) => {
                await sendCloudApiMessage(instance, to, msgContent, msgType)
              }

              const buttonId = message.button?.payload || message.interactive?.button_reply?.id
              const listRowId = message.interactive?.list_reply?.id

              const handled = await flowEngine.processMessage({
                instanceId: instance.id,
                remoteJid: from,
                message: content,
                messageType: buttonId ? 'button_reply' : listRowId ? 'list_reply' : 'text',
                buttonId,
                listRowId,
              })

              // Restore original send function
              ;(flowEngine as any).sendMessage = originalSendFn

              if (handled) {
                console.log('FlowEngine handled message from:', from)
              }
            }
          } catch (flowError) {
            console.error('FlowEngine error:', flowError)
          }

          // Try AI agent processing (after flow, before status updates)
          try {
            const aiHandled = await handleIncomingForAI(
              { instanceId: instance.id, remoteJid: from, content, type, pushName: '', fromMe: false },
              async (to: string, text: string, aiAgentId?: string) => {
                await sendCloudApiMessage(instance, to, { text }, 'text')
                await persistAIOutbound({ instance, remoteJid: from, text, type: 'text', aiAgentId })
              },
              async (to: string, mediaType: string, mediaUrl: string, caption?: string, _fileName?: string) => {
                const mediaContent: any = { [mediaType]: { url: mediaUrl }, caption }
                await sendCloudApiMessage(instance, to, mediaContent, mediaType)
                await persistAIOutbound({ instance, remoteJid: from, text: caption || `[${mediaType}]`, type: mediaType, metadata: { mediaUrl } })
              }
            )
            if (aiHandled) {
              console.log('AI handled Cloud API message from:', from)
            }
          } catch (aiError) {
            console.error('AI processing error:', aiError)
          }
        }

        // Handle status updates
        for (const status of value.statuses || []) {
          const statusMap: Record<string, MessageStatus> = {
            sent: MessageStatus.SENT,
            delivered: MessageStatus.DELIVERED,
            read: MessageStatus.READ,
            failed: MessageStatus.FAILED,
          }

          await prisma.message.updateMany({
            where: { messageId: status.id },
            data: {
              status: statusMap[status.status] || MessageStatus.SENT,
              ...(status.status === 'sent' && { sentAt: new Date() }),
              ...(status.status === 'delivered' && { deliveredAt: new Date() }),
              ...(status.status === 'read' && { readAt: new Date() }),
              ...(status.status === 'failed' && {
                failedAt: new Date(),
                failReason: status.errors?.[0]?.title,
              }),
            },
          })
        }
      }
    }

    return reply.send({ status: 'ok' })
  })

  // Meta Cloud API Webhook Events
  fastify.post('/cloud', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any

    // Verify Meta webhook signature if META_APP_SECRET is configured
    if (env.META_APP_SECRET) {
      const signature = request.headers['x-hub-signature-256'] as string
      if (signature) {
        const rawBody = JSON.stringify(body)
        const expected = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex')
        try {
          const a = Buffer.from(signature)
          const b = Buffer.from(expected)
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return reply.status(403).send({ error: 'Invalid webhook signature' })
          }
        } catch {
          return reply.status(403).send({ error: 'Invalid webhook signature' })
        }
      }
    }

    if (body.object !== 'whatsapp_business_account') {
      return reply.status(400).send({ error: 'Invalid webhook' })
    }

    // Replay protection
    const entryId = body.entry?.[0]?.id
    if (entryId && await isWebhookReplay('cloud', `${entryId}:${JSON.stringify(body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || '')}`)) {
      return reply.send({ status: 'ok', deduplicated: true })
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue

        const value = change.value
        const phoneNumberId = value.metadata?.phone_number_id

        // Find instance by phone number ID (Cloud API or Coexistence)
        const instance = await prisma.instance.findFirst({
          where: { phoneNumberId, channel: { in: ['CLOUD_API', 'COEXISTENCE'] }, isActive: true },
          include: {
            typebotIntegration: true,
            n8nIntegration: true,
          },
        })

        if (!instance) continue

        // Handle incoming messages
        for (const message of value.messages || []) {
          const from = message.from
          let content = ''
          let type = 'text'
          let mediaId: string | undefined

          switch (message.type) {
            case 'text':
              content = message.text?.body || ''
              type = 'text'
              break
            case 'image':
              content = message.image?.caption || ''
              type = 'image'
              mediaId = message.image?.id
              break
            case 'video':
              content = message.video?.caption || '[Video]'
              type = 'video'
              break
            case 'audio':
              content = '[Audio]'
              type = 'audio'
              break
            case 'document':
              content = message.document?.filename || '[Document]'
              type = 'document'
              break
          }

          // Save message
          const conversation = await ensureConversationForMessage({
            companyId: instance.companyId,
            instanceId: instance.id,
            remoteJid: from,
            lastActivityAt: new Date(),
          })

          // Processar automações (non-blocking)
          if (conversation._isNew) {
            processConversationAutomations('conversation_created', {
              companyId: instance.companyId,
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              contactId: conversation.contactId,
              direction: 'INBOUND',
              messageContent: content,
              messageType: type,
              isNewConversation: true,
            }).catch(err => console.error('[Cloud API 2] Erro em automações:', err))
          }

          await prisma.message.create({
            data: {
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              messageId: message.id,
              direction: 'INBOUND',
              status: 'DELIVERED',
              type,
              content,
              deliveredAt: new Date(),
            },
          })

          // Update metrics
          await prisma.instance.update({
            where: { id: instance.id },
            data: { messagesReceived: { increment: 1 } },
          })

          // Update contact's lastInboundAt for 24h window tracking
          if (instance.companyId && from) {
            await prisma.contact.upsert({
              where: {
                companyId_phoneNumber: {
                  companyId: instance.companyId,
                  phoneNumber: from,
                },
              },
              update: {
                lastInboundAt: new Date(),
              },
              create: {
                companyId: instance.companyId,
                phoneNumber: from,
                name: from,
                lastInboundAt: new Date(),
              },
            })
          }

          // Emit to socket
          io.to(instanceRoom(instance.companyId, instance.id)).emit('message-received', {
            instanceId: instance.id,
            from,
            content,
            type,
            timestamp: new Date(),
          })

          // Trigger webhooks
          await triggerInstanceWebhooks(instance, {
            event: 'message.received',
            from,
            content,
            type,
            timestamp: new Date(),
          })

          // AI Agent processing for Cloud API direct
          if ((type === 'text' && content) || (type === 'image' && mediaId)) {
            try {
              let imageData: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' } | undefined
              if (type === 'image' && mediaId) {
                const accessToken = (instance as any).cloudApiToken || (instance as any).accessToken
                if (accessToken) {
                  const media = await downloadMetaMedia(mediaId, accessToken)
                  if (media) {
                    const mime = media.mimeType.startsWith('image/') ? media.mimeType as any : 'image/jpeg'
                    imageData = { base64: media.base64, mimeType: mime }
                  }
                }
              }
              const aiHandled = await handleIncomingForAI(
                { instanceId: instance.id, remoteJid: from, content, type, pushName: '', fromMe: false, imageData },
                async (to: string, text: string, aiAgentId?: string) => {
                  await sendCloudApiMessage(instance, to, { text }, 'text')
                  await persistAIOutbound({ instance, remoteJid: from, text, type: 'text', aiAgentId })
                },
                async (to: string, mediaType: string, mediaUrl: string, caption?: string, _fileName?: string) => {
                  const mediaContent: any = { [mediaType]: { url: mediaUrl }, caption }
                  await sendCloudApiMessage(instance, to, mediaContent, mediaType)
                  await persistAIOutbound({ instance, remoteJid: from, text: caption || `[${mediaType}]`, type: mediaType, metadata: { mediaUrl } })
                }
              )
              if (aiHandled) {
                console.log('AI handled Cloud API direct message from:', from)
              }
            } catch (aiError) {
              console.error('AI processing error (Cloud API direct):', aiError)
            }
          }
        }

        // Handle status updates
        for (const status of value.statuses || []) {
          const statusMap: Record<string, MessageStatus> = {
            sent: MessageStatus.SENT,
            delivered: MessageStatus.DELIVERED,
            read: MessageStatus.READ,
            failed: MessageStatus.FAILED,
          }

          await prisma.message.updateMany({
            where: { messageId: status.id },
            data: {
              status: statusMap[status.status] || MessageStatus.SENT,
              ...(status.status === 'sent' && { sentAt: new Date() }),
              ...(status.status === 'delivered' && { deliveredAt: new Date() }),
              ...(status.status === 'read' && { readAt: new Date() }),
              ...(status.status === 'failed' && {
                failedAt: new Date(),
                failReason: status.errors?.[0]?.title,
              }),
            },
          })
        }
      }
    }

    return reply.send({ status: 'ok' })
  })

  // ========== EVO GO WEBHOOK ==========
  // Recebe eventos da Evo Go API v3.0
  // Eventos: QRCode, Connected, LoggedOut, Disconnected, Message, QRTimeout, etc.
  // A Evo Go envia POST para: /api/webhook/evo-go/:instanceId
  fastify.post('/evo-go/:instanceId', async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const body = request.body as any

    console.log('[Evo Go Webhook] Evento recebido para instância:', instanceId, 'event:', body?.event || 'unknown')

    // Buscar instância
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        typebotIntegration: true,
        n8nIntegration: true,
      },
    })

    if (!instance || instance.channel !== 'EVO_GO') {
      console.log('[Evo Go Webhook] Instância não encontrada ou canal incorreto:', instanceId)
      return reply.status(404).send({ error: 'Instância não encontrada' })
    }

    // SEC-05 fix: validate webhook authentication via apikey header or body instanceToken
    const evoApiKeyHeader = (request.headers['apikey'] as string) || body?.instanceToken
    const decryptedEvoKey = decryptSafe(instance.evoApiKey) as string | null
    if (decryptedEvoKey && evoApiKeyHeader) {
      try {
        const a = Buffer.from(String(evoApiKeyHeader))
        const b = Buffer.from(decryptedEvoKey)
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return reply.status(401).send({ error: 'Invalid webhook authentication' })
        }
      } catch {
        return reply.status(401).send({ error: 'Invalid webhook authentication' })
      }
    } else if (decryptedEvoKey && !evoApiKeyHeader) {
      // Instance has a key configured but webhook didn't send it
      return reply.status(401).send({ error: 'Missing webhook authentication' })
    }

    const event = body.event
    const data = body.data || body

    // Replay protection: deduplicate by instance + event + message ID or timestamp
    const nonceId = data?.key?.id || data?.Info?.ID || body.timestamp || Date.now()
    if (await isWebhookReplay('evo-go', `${instanceId}:${event}:${nonceId}`)) {
      return reply.send({ status: 'ok', deduplicated: true })
    }

    // Evento Connected (Evo Go envia "Connected" quando WhatsApp conecta)
    if (event === 'Connected') {
      const phoneJid = data.jid || ''
      const phoneNumber = phoneJid.replace('@s.whatsapp.net', '').replace(/:.*/, '').replace(/\D/g, '') || null
      const profileName = data.pushName || null

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          status: 'CONNECTED',
          qrCode: null,
          ...(phoneNumber && { phoneNumber }),
          ...(profileName && { profileName }),
        },
      })

      io.to(instanceRoom(instance.companyId, instanceId)).emit('status-update', {
        instanceId,
        status: 'CONNECTED',
        phoneNumber,
        profileName,
      })

      console.log(`[Evo Go Webhook] Conectado! Phone: ${phoneNumber}, Name: ${profileName}`)

      // Auto-import history on first connection (fire-and-forget)
      queueInitialHistoryImport(instance)

      return reply.send({ status: 'ok' })
    }

    // Evento LoggedOut / Disconnected (Evo Go envia quando desconecta)
    if (event === 'LoggedOut' || event === 'Disconnected') {
      await prisma.instance.update({
        where: { id: instanceId },
        data: { status: 'DISCONNECTED', qrCode: null },
      })

      io.to(instanceRoom(instance.companyId, instanceId)).emit('status-update', {
        instanceId,
        status: 'DISCONNECTED',
      })

      console.log(`[Evo Go Webhook] Desconectado (${event})`)
      return reply.send({ status: 'ok' })
    }

    // Evento de atualização de conexão (formato alternativo)
    if (event === 'connection.update') {
      const state = data.state || data.status
      let newStatus: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' = 'DISCONNECTED'

      if (state === 'open' || state === 'connected') newStatus = 'CONNECTED'
      else if (state === 'connecting') newStatus = 'CONNECTING'
      else newStatus = 'DISCONNECTED'

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          status: newStatus,
          ...(newStatus === 'CONNECTED' && { qrCode: null }),
        },
      })

      io.to(instanceRoom(instance.companyId, instanceId)).emit('status-update', {
        instanceId,
        status: newStatus,
      })

      console.log(`[Evo Go Webhook] Status atualizado: ${newStatus}`)

      if (newStatus === 'CONNECTED') {
        queueInitialHistoryImport(instance)
      }

      return reply.send({ status: 'ok' })
    }

    if (event === 'HistorySync' || String(event).toLowerCase() === 'historysync') {
      console.log(`[Evo Go Webhook] HistorySync recebido; enfileirando importação para ${instanceId}`)
      queueInitialHistoryImport(instance)
      return reply.send({ status: 'ok' })
    }

    // Evento de QR Code (Evo Go envia "QRCode" quando gera novo QR)
    if (event === 'QRCode' || event === 'qrcode.updated') {
      let qrCode = data.qrcode || data.base64
      if (qrCode) {
        // Evo Go pode enviar no formato "base64|code" - extrair apenas a parte base64
        if (qrCode.includes('|')) {
          qrCode = qrCode.split('|')[0]
        }
        await prisma.instance.update({
          where: { id: instanceId },
          data: { qrCode, status: 'CONNECTING' },
        })

        io.to(instanceRoom(instance.companyId, instanceId)).emit('qr-code', {
          instanceId,
          qrCode,
        })
        console.log(`[Evo Go Webhook] QR Code recebido e emitido via socket`)
      }
      return reply.send({ status: 'ok' })
    }

    // Evento QRTimeout (Evo Go envia quando QR expira)
    if (event === 'QRTimeout') {
      await prisma.instance.update({
        where: { id: instanceId },
        data: { qrCode: null, status: 'DISCONNECTED' },
      })

      io.to(instanceRoom(instance.companyId, instanceId)).emit('qr-timeout', {
        instanceId,
      })

      console.log(`[Evo Go Webhook] QR Timeout`)
      return reply.send({ status: 'ok' })
    }

    // Evento de mensagem recebida (Evo Go envia "Message" para mensagens)
    // Evento "SendMessage" = mensagens enviadas pelo dispositivo (telefone/WhatsApp Web)
    if (event === 'Message' || event === 'messages.upsert' || event === 'SendMessage') {
      const isSendMessageEvent = event === 'SendMessage'
      let rawMessages = Array.isArray(data) ? data : [data]

      // Responder imediatamente ao Evo GO para evitar timeout/retry
      // Processamento pesado roda em background
      reply.send({ status: 'ok' })

      // Processar mensagens em background (não bloqueia a resposta do webhook)
      ;(async () => {
      try {

      // Normalizar formato Evo Go para formato Baileys-like
      // Evo Go Go envia: { Info: { Chat, Sender, IsFromMe, IsGroup, ID, PushName, Type }, Message: { conversation: "..." } }
      // (Chat/Sender/IsFromMe ficam direto em Info, NÃO dentro de MessageSource)
      const messages = rawMessages.map((msg: any) => {
        // Se já tem o formato Baileys (key.remoteJid), usar como está
        if (msg.key?.remoteJid) return msg
        // Formato Evo Go v3 (Go): Info.Chat, Info.Sender direto
        if (msg.Info) {
          const info = msg.Info
          // Chat e Sender podem estar direto em Info ou dentro de MessageSource (versões diferentes)
          let chat: string = info.Chat || info.MessageSource?.Chat || ''
          let sender: string = info.Sender || info.MessageSource?.Sender || ''
          const isFromMe = info.IsFromMe ?? info.MessageSource?.IsFromMe ?? false
          const isGroup = info.IsGroup ?? info.MessageSource?.IsGroup ?? false

          // Resolver LID → JID real
          // Quando IsFromMe=true: Chat vem como @lid, mas RecipientAlt tem o JID @s.whatsapp.net do destinatário
          // Quando IsFromMe=false: Chat/Sender já tem @s.whatsapp.net, SenderAlt tem o @lid
          if (chat.includes('@lid') && info.RecipientAlt?.includes('@s.whatsapp.net')) {
            chat = info.RecipientAlt
          }
          if (chat.includes('@lid') && info.SenderAlt?.includes('@s.whatsapp.net')) {
            chat = info.SenderAlt
          }
          if (sender.includes('@lid') && info.SenderAlt?.includes('@s.whatsapp.net')) {
            sender = info.SenderAlt
          }
          // DeviceSentMeta.DestinationJID pode ter o JID real também
          if (chat.includes('@lid') && info.DeviceSentMeta?.DestinationJID?.includes('@s.whatsapp.net')) {
            chat = info.DeviceSentMeta.DestinationJID
          }

          console.log(`[Evo Go Webhook] JID resolved: Chat=${chat}, Sender=${sender}, IsFromMe=${isFromMe}`)

          return {
            key: {
              remoteJid: chat || sender,
              fromMe: isFromMe,
              id: info.ID || `evo_${Date.now()}`,
            },
            pushName: info.PushName || '',
            message: msg.Message || {},
            isGroup,
            // Preserve quoted message data from Evo Go
            ...(msg.isQuoted ? { isQuoted: true, quoted: msg.quoted } : {}),
            // Preserve poll vote data from Evo Go (decrypted by whatsmeow)
            ...(msg.isPoll ? { isPoll: true, pollVotes: msg.pollVotes } : {}),
          }
        }
        return msg
      })

      for (const msg of messages) {
        // Determinar se é mensagem enviada por nós (fromMe)
        // Mensagens do telefone/WhatsApp Web chegam como evento "Message" com IsFromMe=true
        // Mensagens enviadas pelo CRM já foram salvas por persistOutboundMessage — duplicatas
        // são ignoradas pela constraint unique do messageId (P2002 catch abaixo)
        const isFromMe = msg.key?.fromMe || isSendMessageEvent

        const direction = isFromMe ? 'OUTBOUND' : 'INBOUND'

        const remoteJid = msg.key?.remoteJid || ''
        const isGroup = msg.isGroup || remoteJid.includes('@g.us')
        const isNewsletter = remoteJid.includes('@newsletter')

        // Para grupos: remoteJid = JID do grupo (todas msgs ficam em 1 chat)
        //              sender = quem enviou (salvo em metadata)
        // Para newsletters: remoteJid = JID do canal (120363xxx@newsletter)
        // Para individual: remoteJid = número do contato
        let from = ''
        let senderPhone = ''
        let senderName = msg.pushName || ''
        if (isNewsletter) {
          // Newsletter/Canal do WhatsApp — manter JID completo com @newsletter
          from = remoteJid
        } else if (isGroup) {
          // remoteJid do grupo (ex: 120363xxx@g.us)
          from = remoteJid
          // Extrair número do remetente individual — preferir campo com @s.whatsapp.net
          let sender = data?.Info?.Sender || data?.Info?.MessageSource?.Sender || ''
          // Se sender é @lid, tentar SenderAlt ou RecipientAlt
          if (sender.includes('@lid')) {
            const alt = data?.Info?.SenderAlt || data?.Info?.RecipientAlt || ''
            if (alt.includes('@s.whatsapp.net')) sender = alt
          }
          senderPhone = sender.replace('@s.whatsapp.net', '').replace(/@.*/, '').replace(/\D/g, '')
        } else {
          from = remoteJid.replace('@s.whatsapp.net', '').replace(/@.*/, '').replace(/\D/g, '')
        }
        if (!from) continue

        console.log(`[Evo Go Webhook] Mensagem de ${isNewsletter ? 'canal ' + from : isGroup ? senderPhone + ' no grupo ' + from : from} (${senderName})${isGroup ? ' [grupo]' : isNewsletter ? ' [newsletter]' : ''}: processando...`)

        let content = ''
        let type = 'text'
        let interactiveData: any = null
        const message = msg.message || {}

        if (message.conversation) {
          content = message.conversation
          type = 'text'
        } else if (message.extendedTextMessage) {
          content = message.extendedTextMessage.text || ''
          type = 'text'
        } else if (message.imageMessage) {
          content = message.imageMessage.caption || '[Imagem]'
          type = 'image'
        } else if (message.videoMessage) {
          content = message.videoMessage.caption || '[Vídeo]'
          type = 'video'
        } else if (message.audioMessage) {
          content = '[Áudio]'
          type = 'audio'
        } else if (message.documentMessage) {
          content = message.documentMessage.fileName || '[Documento]'
          type = 'document'
        } else if (message.stickerMessage) {
          content = '[Sticker]'
          type = 'sticker'
        } else if (message.contactMessage) {
          content = message.contactMessage.displayName || '[Contato]'
          type = 'contact'
        } else if (message.locationMessage) {
          content = `[Localização: ${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}]`
          type = 'location'
        } else if (message.buttonsResponseMessage) {
          content = message.buttonsResponseMessage.selectedDisplayText || message.buttonsResponseMessage.selectedButtonId || '[Botão]'
          type = 'text'
        } else if (message.listResponseMessage) {
          content = message.listResponseMessage.title || message.listResponseMessage.singleSelectReply?.selectedRowId || '[Lista]'
          type = 'text'
        } else if (message.pollCreationMessage || message.pollCreationMessageV3) {
          const poll = message.pollCreationMessage || message.pollCreationMessageV3
          const question = poll.name || poll.question || 'Enquete'
          const options = (poll.options || []).map((o: any) => o.optionName || o.name || o)
          content = `[Enquete] ${question}`
          type = 'poll'
          interactiveData = { type: 'poll', question, options, selectableCount: poll.selectableOptionsCount ?? poll.maxAnswer ?? 1 }
        } else if (message.buttonsMessage) {
          const bm = message.buttonsMessage
          const text = bm.contentText || bm.text || ''
          const btns = (bm.buttons || []).map((b: any, i: number) => ({
            id: b.buttonId || `btn_${i}`, text: b.buttonText?.displayText || b.text || '', buttonType: 'reply',
          }))
          content = `[Botões] ${text}`
          type = 'button'
          interactiveData = { type: 'buttons', text, buttons: btns, ...(bm.footerText ? { footer: bm.footerText } : {}), ...(bm.headerText ? { header: bm.headerText } : {}) }
        } else if (message.listMessage) {
          const lm = message.listMessage
          const text = lm.description || lm.text || ''
          const secs = (lm.sections || []).map((s: any) => ({
            title: s.title || '', rows: (s.rows || []).map((r: any) => ({ id: r.rowId || r.id || '', title: r.title || '', description: r.description || '' })),
          }))
          content = `[Lista] ${text}`
          type = 'list'
          interactiveData = { type: 'list', text, buttonText: lm.buttonText || 'Menu', sections: secs, ...(lm.footerText ? { footer: lm.footerText } : {}), ...(lm.title ? { header: lm.title } : {}) }
        } else if (message.interactiveMessage) {
          const im = message.interactiveMessage
          const body = im.body?.text || im.nativeFlowMessage?.messageParamsJson || ''
          content = `[Interativo] ${body.substring(0, 100)}`
          type = 'text'
        } else if (message.pollUpdateMessage) {
          // Tentar resolver os nomes das opções votadas
          const pum = message.pollUpdateMessage
          const pollKey = pum.pollCreationMessageKey
          let votedOptions: string[] = []

          // pollVotes vem do Evo GO (decryptado pelo whatsmeow)
          const pollVotesData = (msg as any).pollVotes
          if (pollVotesData?.SelectedOptions && pollKey?.id) {
            try {
              // Buscar a enquete original no banco pelo messageId
              const originalPoll = await prisma.message.findFirst({
                where: { messageId: pollKey.id },
                select: { metadata: true },
              })
              const pollMeta = originalPoll?.metadata as any
              const options: { name: string }[] = pollMeta?.interactive?.options || []
              if (options.length > 0) {
                // SelectedOptions são SHA-256 hashes das opções (base64-encoded pelo Go JSON)
                const selectedHashes = pollVotesData.SelectedOptions.map((opt: any) => {
                  if (typeof opt === 'string') return Buffer.from(opt, 'base64')
                  if (opt?.type === 'Buffer' && Array.isArray(opt.data)) return Buffer.from(opt.data)
                  return Buffer.from(opt)
                })
                for (const opt of options) {
                  const hash = createHash('sha256').update(opt.name).digest()
                  if (selectedHashes.some((sh: Buffer) => hash.equals(sh))) {
                    votedOptions.push(opt.name)
                  }
                }
              }
            } catch (err: any) {
              console.error('[Evo Go Webhook] Erro ao resolver voto de enquete:', err.message)
            }
          }

          if (votedOptions.length > 0) {
            content = `[Voto em enquete] ${votedOptions.join(', ')}`
          } else {
            content = '[Voto em enquete]'
          }
          type = 'text'
        }

        if (!content) {
          console.log(`[Evo Go Webhook] Mensagem sem conteúdo reconhecido. Keys: ${Object.keys(message).join(', ')}`)
          continue
        }

        // Extrair ou salvar mídia
        // Evo Go com WebhookFiles=true envia base64 dentro de message (ex: message.base64)
        // Evo Go com MinIO envia mediaUrl dentro da sub-mensagem (ex: message.imageMessage.mediaUrl)
        let mediaUrl: string | undefined
        const mimeMap: Record<string, { ext: string; mime: string }> = {
          image: { ext: '.jpg', mime: 'image/jpeg' },
          video: { ext: '.mp4', mime: 'video/mp4' },
          audio: { ext: '.ogg', mime: 'audio/ogg' },
          document: { ext: '', mime: 'application/octet-stream' },
          sticker: { ext: '.png', mime: 'image/png' },
        }

        if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
          // 1. Check for mediaUrl from MinIO/S3
          const subMsg = message.imageMessage || message.videoMessage || message.audioMessage || message.documentMessage || message.stickerMessage
          mediaUrl = message.mediaUrl || subMsg?.mediaUrl

          // 2. If no mediaUrl, check for base64 and save to disk
          if (!mediaUrl && message.base64) {
            try {
              const b64 = message.base64 as string
              const buffer = Buffer.from(b64, 'base64')
              const mimeInfo = mimeMap[type] || mimeMap.document
              // For documents, try to get extension from mimetype or filename
              let ext = mimeInfo.ext
              if (type === 'document' && message.documentMessage?.fileName) {
                const docExt = path.extname(message.documentMessage.fileName)
                if (docExt) ext = docExt
              }
              if (type === 'document' && !ext && message.mimetype) {
                const mimeToExt: Record<string, string> = { 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' }
                ext = mimeToExt[message.mimetype] || '.bin'
              }
              if (!ext) ext = '.bin'

              // Block dangerous extensions
              const blockedExts = /^\.(html?|svg|jsx?|tsx?|php|aspx?|exe|bat|cmd|ps1|sh|dll|msi|swf|htaccess)$/i
              if (blockedExts.test(ext)) ext = '.bin'

              const fileName = `${randomUUID()}${ext}`
              const uploadsDir = path.join(process.cwd(), 'uploads', instance.companyId)
              if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
              fs.writeFileSync(path.join(uploadsDir, fileName), buffer)
              mediaUrl = `/uploads/${instance.companyId}/${fileName}`
              console.log(`[Evo Go Webhook] Mídia salva: ${fileName} (${buffer.length} bytes, type=${type})`)
            } catch (err) {
              console.error(`[Evo Go Webhook] Erro ao salvar base64:`, err)
            }
          }
        }

        console.log(`[Evo Go Webhook] Mensagem processada: dir=${direction}, tipo=${type}, conteúdo="${content.substring(0, 100)}"${mediaUrl ? ', mediaUrl=' + mediaUrl : ''}`)
        const messageId = msg.key?.id || `evo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        // Dedup 1: Verificar se já existe mensagem com este messageId exato (evita duplicata por eventos duplos)
        if (messageId) {
          const exactMatch = await prisma.message.findFirst({
            where: { instanceId: instance.id, messageId },
          })
          if (exactMatch) {
            console.log(`[Evo Go Webhook] Dedup: messageId ${messageId} já existe, ignorando`)
            continue
          }
        }

        // Dedup 2: Para OUTBOUND, o CRM já salvou a msg no send-media-upload / persistOutboundMessage
        // com um ID sintético (out_...) ou com o ID real retornado pela API.
        // O webhook chega com o ID real do WhatsApp — atualizar em vez de criar duplicata.
        if (direction === 'OUTBOUND') {
          const recentCutoff = new Date(Date.now() - 60_000) // 60 segundos (mídias podem demorar)

          // 2a + 2b: Buscar ambos em paralelo para reduzir latência
          const [existingOut, existingContent] = await Promise.all([
            prisma.message.findFirst({
              where: {
                instanceId: instance.id,
                remoteJid: from,
                direction: 'OUTBOUND',
                createdAt: { gte: recentCutoff },
                messageId: { startsWith: 'out_' },
              },
              orderBy: { createdAt: 'desc' },
            }),
            prisma.message.findFirst({
              where: {
                instanceId: instance.id,
                remoteJid: from,
                direction: 'OUTBOUND',
                content,
                type,
                createdAt: { gte: recentCutoff },
              },
              orderBy: { createdAt: 'desc' },
            }),
          ])

          if (existingOut) {
            // Atualizar com o messageId real do WhatsApp e mediaUrl se veio do webhook
            await prisma.message.update({
              where: { id: existingOut.id },
              data: {
                messageId,
                ...(mediaUrl && !existingOut.mediaUrl ? { mediaUrl } : {}),
              },
            })
            console.log(`[Evo Go Webhook] OUTBOUND dedup: atualizado ${existingOut.messageId} → ${messageId}`)
            continue
          }

          if (existingContent) {
            // Já existe uma mensagem idêntica recente — atualizar mediaUrl se necessário
            if (mediaUrl && !existingContent.mediaUrl) {
              await prisma.message.update({
                where: { id: existingContent.id },
                data: { mediaUrl },
              })
            }
            console.log(`[Evo Go Webhook] OUTBOUND dedup (conteúdo): mensagem idêntica já existe (${existingContent.messageId}), ignorando ${messageId}`)
            continue
          }

          // Sobreviveu à dedup → verificar se foi a IA enviando (race condition com webhook fromMe)
          // Se isAISending=true, a IA acabou de enviar esta msg — NÃO pausar.
          const aiSending = (!isGroup && !isNewsletter) ? await isAISending(instance.id, from) : false
          if (aiSending) {
            console.log(`[Evo Go Webhook] fromMe ignorado — IA estava enviando para ${from} (Redis ai_sending)`)
          } else if (!isGroup && !isNewsletter) {
            // É mensagem enviada pelo humano do celular/WhatsApp Web — pausar IA
            pauseAISessionOnHumanReply(instance.id, from).catch((e: any) =>
              console.warn('[Evo Go Webhook fromMe] pause falhou:', e.message)
            )
          }
        }

        // Garantir contato (non-blocking — roda em paralelo, não bloqueia salvamento da mensagem)
        const contactPromise = (async () => {
          if (!instance.companyId) return
          try {
            if (isNewsletter && from) {
              await prisma.contact.upsert({
                where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: from } },
                update: { ...(direction === 'INBOUND' ? { lastInboundAt: new Date() } : {}) },
                create: { companyId: instance.companyId, phoneNumber: from, name: `Canal ${from.replace('@newsletter', '')}`, lastInboundAt: direction === 'INBOUND' ? new Date() : undefined },
              })
            } else if (isGroup && from) {
              const groupContact = await prisma.contact.upsert({
                where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: from } },
                update: { ...(direction === 'INBOUND' ? { lastInboundAt: new Date() } : {}) },
                create: { companyId: instance.companyId, phoneNumber: from, name: `Grupo ${from}`, lastInboundAt: direction === 'INBOUND' ? new Date() : undefined },
              })
              if (senderPhone) {
                await prisma.contact.upsert({
                  where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: senderPhone } },
                  update: { ...(direction === 'INBOUND' ? { lastInboundAt: new Date() } : {}) },
                  create: { companyId: instance.companyId, phoneNumber: senderPhone, name: senderName || senderPhone, lastInboundAt: direction === 'INBOUND' ? new Date() : undefined },
                })
              }
              // Fire-and-forget: enrich new groups with name + avatar on first inbound message
              if (direction === 'INBOUND' && !groupContact.whatsappSyncedAt && instance.channel === 'EVO_GO' && instance.status === 'CONNECTED') {
                setImmediate(async () => {
                  try {
                    const { EvoGoProvider: EvoGoGroupEnrich } = await import('../../providers/evo-go/evo-go.provider.js')
                    const evoGo = new EvoGoGroupEnrich({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                    const groupRes = await Promise.race([evoGo.getGroupInfo(from), timeoutPromise]) as any
                    const gInfo = groupRes?.data || groupRes
                    const groupName: string | undefined = gInfo?.Name || gInfo?.GroupName?.Name
                    const groupPicUrl: string | undefined = gInfo?.profilePicUrl || gInfo?.ProfilePicUrl
                    const groupPicId: string | undefined = gInfo?.pictureId || gInfo?.PictureID
                    const enrichData: any = { whatsappSyncedAt: new Date() }
                    if (groupName) enrichData.name = groupName
                    if (groupPicId) enrichData.pictureId = groupPicId
                    if (groupPicUrl) {
                      try {
                        const avatarsDir = path.join(process.cwd(), 'uploads', instance.companyId, 'avatars')
                        if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true })
                        const safeJid = from.replace(/[@.]/g, '_')
                        const avatarFilePath = path.join(avatarsDir, `${safeJid}.jpg`)
                        const imgRes = await axios.get(groupPicUrl, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * 1024 * 1024 })
                        fs.writeFileSync(avatarFilePath, Buffer.from(imgRes.data))
                        enrichData.profilePicture = `/uploads/${instance.companyId}/avatars/${safeJid}.jpg`
                      } catch { /* avatar download failed, continue without it */ }
                    }
                    await prisma.contact.update({ where: { id: groupContact.id }, data: enrichData })
                  } catch (err: any) {
                    console.error('[Evo Go Webhook] Background group enrich error for', from, ':', err.message)
                  }
                })
              }
            } else if (from) {
              const upsertedContact = await prisma.contact.upsert({
                where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: from } },
                update: { ...(direction === 'INBOUND' ? { lastInboundAt: new Date() } : {}) },
                create: { companyId: instance.companyId, phoneNumber: from, name: senderName || from, lastInboundAt: direction === 'INBOUND' ? new Date() : undefined },
              })
              // Fire-and-forget: enrich new inbound contacts with WA profile data
              if (direction === 'INBOUND' && !upsertedContact.whatsappSyncedAt && instance.channel === 'EVO_GO' && instance.status === 'CONNECTED') {
                setImmediate(async () => {
                  try {
                    const { EvoGoProvider: EvoGoEnrich } = await import('../../providers/evo-go/evo-go.provider.js')
                    const evoGo = new EvoGoEnrich({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
                    const userInfoResult = await Promise.race([evoGo.getUserInfo([from]), timeoutPromise]) as any
                    const userData = userInfoResult?.data || userInfoResult
                    const usersArr: any[] = Array.isArray(userData?.users) ? userData.users : []
                    const userEntry = usersArr.find((u: any) => u.jid === `${from}@s.whatsapp.net` || u.number === from) || usersArr[0]
                    if (userEntry) {
                      const enrichData: any = {
                        whatsappStatus: userEntry.status || null,
                        verifiedName: userEntry.verifiedName || null,
                        isBusiness: userEntry.isBusiness ?? null,
                        pictureId: userEntry.pictureId || null,
                        whatsappSyncedAt: new Date(),
                      }
                      const enrichedName = userEntry.verifiedName || userEntry.businessName || userEntry.fullName || userEntry.pushName || null
                      if (enrichedName) enrichData.name = enrichedName
                      if (userEntry.profilePicUrl) {
                        try {
                          const avatarsDir = path.join(process.cwd(), 'uploads', instance.companyId, 'avatars')
                          if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true })
                          const safePhone = from.replace(/[@.]/g, '_')
                          const filePath = path.join(avatarsDir, `${safePhone}.jpg`)
                          const imgRes = await axios.get(userEntry.profilePicUrl, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * 1024 * 1024 })
                          fs.writeFileSync(filePath, Buffer.from(imgRes.data))
                          enrichData.profilePicture = `/uploads/${instance.companyId}/avatars/${safePhone}.jpg`
                        } catch { /* avatar download failed, continue without it */ }
                      }
                      await prisma.contact.update({ where: { id: upsertedContact.id }, data: enrichData })
                    }
                  } catch (err: any) {
                    console.error('[Evo Go Webhook] Background enrich error for', from, ':', err.message)
                  }
                })
              }
            }
          } catch (err: any) {
            console.error('[Evo Go Webhook] Erro ao garantir contato:', err.message)
          }
        })()

        // ── Construir metadata (síncrono, sem DB calls) ──
        // Extrair informações de mensagem respondida (quoted)
        const parseQuotedMessage = (qm: any): { content: string; type: string } => {
          if (!qm) return { content: '', type: 'text' }
          if (qm.conversation) return { content: qm.conversation, type: 'text' }
          if (qm.extendedTextMessage?.text) return { content: qm.extendedTextMessage.text, type: 'text' }
          if (qm.imageMessage) return { content: qm.imageMessage.caption || '[Imagem]', type: 'image' }
          if (qm.videoMessage) return { content: qm.videoMessage.caption || '[Vídeo]', type: 'video' }
          if (qm.audioMessage) return { content: '[Áudio]', type: 'audio' }
          if (qm.documentMessage) return { content: qm.documentMessage.fileName || '[Documento]', type: 'document' }
          if (qm.stickerMessage) return { content: '[Sticker]', type: 'sticker' }
          return { content: '', type: 'text' }
        }
        const getContextInfo = (rawMsg: any): any => {
          return rawMsg?.extendedTextMessage?.contextInfo
            || rawMsg?.imageMessage?.contextInfo
            || rawMsg?.videoMessage?.contextInfo
            || rawMsg?.audioMessage?.contextInfo
            || rawMsg?.documentMessage?.contextInfo
            || null
        }

        let quotedInfo: { stanzaId: string; quotedContent?: string; quotedType?: string; quotedParticipant?: string; quotedRemoteJid?: string } | undefined
        if ((msg as any).isQuoted && (msg as any).quoted) {
          const q = (msg as any).quoted
          const stanzaId = q.stanzaID || q.stanzaId || ''
          if (stanzaId) {
            const { content: qContent, type: qType } = parseQuotedMessage(q.quotedMessage)
            const ci = getContextInfo(message)
            quotedInfo = {
              stanzaId,
              quotedContent: qContent,
              quotedType: qType,
              ...(ci?.participant ? { quotedParticipant: ci.participant.replace('@s.whatsapp.net', '').replace(/@.*/, '') } : {}),
              ...(ci?.remoteJid?.includes('@g.us') ? { quotedRemoteJid: ci.remoteJid } : {}),
            }
          }
        } else {
          const ci = getContextInfo(message)
          if (ci?.stanzaId) {
            const { content: qContent, type: qType } = parseQuotedMessage(ci.quotedMessage)
            quotedInfo = {
              stanzaId: ci.stanzaId,
              quotedContent: qContent,
              quotedType: qType,
              ...(ci.participant ? { quotedParticipant: ci.participant.replace('@s.whatsapp.net', '').replace(/@.*/, '') } : {}),
              ...(ci.remoteJid?.includes('@g.us') ? { quotedRemoteJid: ci.remoteJid } : {}),
            }
          }
        }

        const msgMetadata: Record<string, any> = {}
        if (isGroup && senderPhone) {
          msgMetadata.senderPhone = senderPhone
          msgMetadata.senderName = senderName
        }
        if (quotedInfo) {
          msgMetadata.quotedStanzaId = quotedInfo.stanzaId
          msgMetadata.quotedContent = quotedInfo.quotedContent
          msgMetadata.quotedType = quotedInfo.quotedType
          if (quotedInfo.quotedParticipant) msgMetadata.quotedParticipant = quotedInfo.quotedParticipant
          if (quotedInfo.quotedRemoteJid) msgMetadata.quotedRemoteJid = quotedInfo.quotedRemoteJid
        }
        if (interactiveData) {
          msgMetadata.interactive = interactiveData
        }

        // ── EMITIR SOCKET IMEDIATAMENTE (antes de salvar no DB) ──
        // Para OUTBOUND: NÃO emitir aqui — o persistOutboundMessage/send-media-upload já emitiu
        if (direction !== 'OUTBOUND') {
          io.to(instanceRoom(instance.companyId, instance.id)).emit('message-received', {
            instanceId: instance.id,
            from,
            messageId,
            direction,
            content,
            type,
            mediaUrl,
            timestamp: new Date(),
            ...(isGroup ? { isGroup: true, senderPhone, senderName } : {}),
            ...(Object.keys(msgMetadata).length > 0 ? { metadata: msgMetadata } : {}),
          })
        }

        // ── Salvar mensagem no DB (em paralelo com contato) ──
        try {
          const conversation = await ensureConversationForMessage({
            companyId: instance.companyId,
            instanceId: instance.id,
            remoteJid: from,
            lastActivityAt: new Date(),
            ...(direction === 'OUTBOUND' ? { firstReplyAt: new Date() } : {}),
          })

          // Processar automações (non-blocking)
          if (conversation._isNew) {
            processConversationAutomations('conversation_created', {
              companyId: instance.companyId,
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              contactId: conversation.contactId,
              direction,
              messageContent: content,
              messageType: type,
              isNewConversation: true,
            }).catch(err => console.error('[Evo Go] Erro em automações:', err))
          }
          if (direction === 'INBOUND') {
            processConversationAutomations('message_created', {
              companyId: instance.companyId,
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              contactId: conversation.contactId,
              direction,
              messageContent: content,
              messageType: type,
              isNewConversation: conversation._isNew,
            }).catch(err => console.error('[Evo Go] Erro em automações message:', err))
          }

          await prisma.message.create({
            data: {
              instanceId: instance.id,
              conversationId: conversation.id,
              remoteJid: from,
              messageId,
              direction,
              status: direction === 'OUTBOUND' ? 'SENT' : 'DELIVERED',
              type,
              content,
              ...(mediaUrl ? { mediaUrl } : {}),
              ...(direction === 'OUTBOUND' ? { sentAt: new Date() } : { deliveredAt: new Date() }),
              ...(Object.keys(msgMetadata).length > 0 ? { metadata: msgMetadata } : {}),
            },
          })
        } catch (err: any) {
          // Ignorar duplicatas (messageId único)
          if (!err.code || err.code !== 'P2002') {
            console.error('[Evo Go Webhook] Erro ao salvar mensagem:', err.message)
          }
          await contactPromise.catch(() => {})
          continue
        }

        // Aguardar contato (não-crítico, apenas para não deixar promise pendente)
        await contactPromise.catch(() => {})

        // Atualizar métricas (non-blocking)
        prisma.instance.update({
          where: { id: instance.id },
          data: direction === 'OUTBOUND'
            ? { messagesSent: { increment: 1 } }
            : { messagesReceived: { increment: 1 } },
        }).catch(err => console.error('[Evo Go Webhook] Erro ao atualizar métricas:', err.message))

        // Disparar webhooks
        triggerInstanceWebhooks(instance, {
          event: direction === 'OUTBOUND' ? 'message.sent' : 'message.received',
          from,
          content,
          type,
          timestamp: new Date(),
          ...(isGroup ? { isGroup: true, senderPhone, senderName } : {}),
        })

        // FlowEngine e Typebot apenas para mensagens INBOUND
        if (direction === 'INBOUND') {
          // ── Out-of-Office: resposta automática fora do horário ──
          try {
            if (!isGroup && !isNewsletter) {
              await handleOutOfOfficeReply(instance.id, from, instance)
            }
          } catch (oooErr: any) {
            console.error('[Evo Go Webhook] OutOfOffice erro:', oooErr.message)
          }

          // ── CSAT: processar resposta de pesquisa de satisfação ──
          try {
            if (!isGroup && !isNewsletter && type === 'text' && content) {
              const conversation = await prisma.conversation.findUnique({
                where: { instanceId_remoteJid: { instanceId: instance.id, remoteJid: from } },
                select: { id: true, contactId: true },
              })
              if (conversation) {
                // Para respostas de botões/listas, usar o ID (selectedButtonId ou selectedRowId)
                // em vez do texto de exibição, para que o padrão "csat_UUID_N" seja detectado.
                const buttonOrRowId = message.buttonsResponseMessage?.selectedButtonId
                  || message.listResponseMessage?.singleSelectReply?.selectedRowId
                const csatHandled = await processCsatResponse(
                  instance.id, conversation.id, conversation.contactId,
                  buttonOrRowId || content,
                )
                if (csatHandled) {
                  continue // Resposta CSAT processada, não acionar flows/AI
                }
              }
            }
          } catch (csatErr: any) {
            console.error('[Evo Go Webhook] CSAT erro:', csatErr.message)
          }

          // FlowEngine (chatbot)
          try {
            const flowEngine = getFlowEngine()
            if (flowEngine && type === 'text' && content) {
              const { EvoGoProvider } = await import('../../providers/evo-go/evo-go.provider.js')
              const evoGo = new EvoGoProvider({
                ...instance,
                evoApiKey: decryptSafe(instance.evoApiKey) as string,
              })

              const originalSendFn = (flowEngine as any).sendMessage
              ;(flowEngine as any).sendMessage = async (to: string, msgContent: any, msgType: string) => {
                const phone = to.replace('@s.whatsapp.net', '').replace(/\D/g, '')
                if (msgType === 'text') {
                  await evoGo.sendTextMessage(phone, msgContent.text || String(msgContent))
                } else if (msgType === 'image') {
                  await evoGo.sendMediaMessage(phone, 'image', msgContent.image?.url, msgContent.caption)
                } else if (msgType === 'audio') {
                  await evoGo.sendMediaMessage(phone, 'audio', msgContent.audio?.url)
                } else if (msgType === 'video') {
                  await evoGo.sendMediaMessage(phone, 'video', msgContent.video?.url, msgContent.caption)
                } else if (msgType === 'document') {
                  await evoGo.sendMediaMessage(phone, 'document', msgContent.document?.url, msgContent.caption, msgContent.fileName)
                } else {
                  await evoGo.sendTextMessage(phone, msgContent.text || String(msgContent))
                }
              }

              const buttonId = message.buttonsResponseMessage?.selectedButtonId
              const listRowId = message.listResponseMessage?.singleSelectReply?.selectedRowId

              await flowEngine.processMessage({
                instanceId: instance.id,
                remoteJid: from,
                message: content,
                messageType: buttonId ? 'button_reply' : listRowId ? 'list_reply' : 'text',
                buttonId,
                listRowId,
              })

              ;(flowEngine as any).sendMessage = originalSendFn
            }
          } catch (flowError) {
            console.error('[Evo Go Webhook] FlowEngine erro:', flowError)
          }

          // Typebot
          if (type === 'text' && content) {
            try {
              await handleTypebotMessage(instance.id, from, content)
            } catch (typebotError) {
              console.error('[Evo Go Webhook] Typebot erro:', typebotError)
            }
          }

          // AI Agent processing (after flow/typebot)
          try {
            const { EvoGoProvider: EvoGoAI } = await import('../../providers/evo-go/evo-go.provider.js')
            const evoGoAi = new EvoGoAI({
              ...instance,
              evoApiKey: decryptSafe(instance.evoApiKey) as string,
            })

            const aiHandled = await handleIncomingForAI(
              { instanceId: instance.id, remoteJid: from, content, type, pushName: senderName || '', fromMe: false },
              async (to: string, text: string, aiAgentId?: string) => {
                const phone = to.replace('@s.whatsapp.net', '').replace(/\D/g, '')
                await markAISending(instance.id, from)
                const res = await evoGoAi.sendTextMessage(phone, text)
                await persistAIOutbound({
                  instance,
                  remoteJid: from,
                  text,
                  type: 'text',
                  messageId: res?.messageId || res?.id || res?.data?.messageId,
                  aiAgentId,
                })
              },
              async (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => {
                const phone = to.replace('@s.whatsapp.net', '').replace(/\D/g, '')
                const res = await evoGoAi.sendMediaMessage(phone, mediaType, mediaUrl, caption, fileName)
                await persistAIOutbound({
                  instance,
                  remoteJid: from,
                  text: caption || `[${mediaType}]`,
                  type: mediaType,
                  messageId: res?.messageId || res?.id || res?.data?.messageId,
                  metadata: { mediaUrl, fileName },
                })
              },
              async (to: string, interactiveMsg: any, aiAgentId?: string) => {
                const { sendInteractiveViaProvider, interactiveContentSummary } = await import('./../../modules/messages/interactive-messages.js')
                const { ensureConversationForMessage } = await import('../conversations/conversation.service.js')
                const phone = to.replace('@s.whatsapp.net', '').replace(/\D/g, '')
                const result = await sendInteractiveViaProvider({
                  msg: interactiveMsg,
                  to: phone,
                  instance,
                  evoGo: evoGoAi,
                })
                // Persist interactive message in DB
                const conversation = await ensureConversationForMessage({
                  companyId: instance.companyId,
                  instanceId: instance.id,
                  remoteJid: from,
                  lastActivityAt: new Date(),
                })
                const contentSummary = interactiveContentSummary(interactiveMsg)
                const msgType = interactiveMsg.type === 'buttons' ? 'button' : interactiveMsg.type
                await prisma.message.create({
                  data: {
                    instanceId: instance.id,
                    conversationId: conversation.id,
                    remoteJid: from,
                    messageId: result.messageId || `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    direction: 'OUTBOUND',
                    status: 'SENT',
                    type: msgType,
                    content: contentSummary,
                    sentAt: new Date(),
                    ...(aiAgentId ? { sentByAIAgentId: aiAgentId } : {}),
                    metadata: {
                      interactive: interactiveMsg,
                      fallback: result.fallback,
                      fallbackText: result.fallbackText,
                    },
                  },
                }).catch(() => {})
                await prisma.instance.update({ where: { id: instance.id }, data: { messagesSent: { increment: 1 } } }).catch(() => {})
              }
            )
            if (aiHandled) {
              console.log('[Evo Go Webhook] AI handled message from:', from)
            }
          } catch (aiError) {
            console.error('[Evo Go Webhook] AI processing error:', aiError)
          }
        }
      }

      } catch (bgErr) {
        console.error('[Evo Go Webhook] Erro no processamento background:', bgErr)
      }
      })()

      return
    }

    // Evento de atualização de mensagem (status: sent, delivered, read)
    if (event === 'messages.update') {
      const updates = Array.isArray(data) ? data : [data]

      for (const update of updates) {
        const msgId = update.key?.id
        if (!msgId) continue

        const statusNum = update.update?.status
        let status: MessageStatus | null = null

        // Códigos de status do Baileys/Evo Go: 1=pending, 2=sent, 3=delivered, 4=read
        if (statusNum === 2) status = MessageStatus.SENT
        else if (statusNum === 3) status = MessageStatus.DELIVERED
        else if (statusNum === 4) status = MessageStatus.READ

        if (status) {
          await prisma.message.updateMany({
            where: { messageId: msgId },
            data: {
              status,
              ...(status === 'SENT' && { sentAt: new Date() }),
              ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
              ...(status === 'READ' && { readAt: new Date() }),
            },
          })
        }
      }

      return reply.send({ status: 'ok' })
    }

    // PushName / Contact: o WhatsApp avisa o nome de exibição do contato.
    // Atualizamos o nome só se o atual está "vago" (vazio/numérico/mascarado).
    if (event === 'PushName' || event === 'Contact' || event === 'CONTACT') {
      try {
        // Payload possível: { JID, PushName } ou { Info: { JID }, PushName } ou aninhado em data.
        const jid: string | undefined =
          data?.JID || data?.Jid || data?.remoteJid ||
          data?.Info?.JID || data?.Info?.Sender || data?.Sender ||
          data?.contact?.JID || data?.contact?.jid
        const incomingName: string =
          (data?.PushName || data?.pushName || data?.FullName || data?.fullName ||
           data?.Info?.PushName || data?.contact?.name || '').trim()

        if (jid && incomingName) {
          // Helpers locais (idênticos aos do import-history)
          const phoneFromJid = (j: string) => j
            .replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '')
            .replace(/@lid$/, '').replace(/@c\.us$/, '')
            .replace(/@broadcast$/, '').replace(/@newsletter$/, '')
          const isWeak = (s: string | null | undefined) => {
            const v = (s || '').trim()
            if (!v) return true
            if (/^\+?\d+$/.test(v)) return true
            if (/[∙•·]/.test(v)) return true
            return false
          }

          if (!isWeak(incomingName)) {
            const existing = await prisma.contact.findUnique({
              where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: jid } },
              select: { id: true, name: true },
            })
            if (!existing) {
              await prisma.contact.create({
                data: { companyId: instance.companyId, phoneNumber: jid, name: incomingName },
              })
              console.log(`[Webhook] Contato criado via ${event}: ${jid} -> ${incomingName}`)
            } else if (isWeak(existing.name)) {
              await prisma.contact.update({
                where: { id: existing.id },
                data: { name: incomingName },
              })
              console.log(`[Webhook] PushName atualizado para ${jid}: "${existing.name}" -> "${incomingName}"`)
            }
            // Tenta também propagar o nome para conversas existentes (apenas metadado, não muda schema)
            phoneFromJid(jid) // referência usada apenas em logs futuros
          }
        }
      } catch (err) {
        console.error(`[Webhook] Erro processando ${event}:`, err)
      }
      return reply.send({ status: 'ok' })
    }

    // Outros eventos (send.message, etc.) - apenas log
    console.log(`[Evo Go Webhook] Evento não tratado: ${event}`)
    return reply.send({ status: 'ok' })
  })
}

/**
 * Chatwoot webhook format:
 * {
 *   "event": "message_created",
 *   "message_type": "incoming",
 *   "content": "message text",
 *   "conversation": { "meta": { "sender": { "phone_number": "+5521..." } } },
 *   "sender": { "phone_number": "+5521..." }
 * }
 */
async function handleChatwootWebhook(fastify: FastifyInstance) {
  fastify.post('/chatwoot/:instanceId', async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const { instanceId } = request.params
    const body = request.body as any

    console.log('[Chatwoot Webhook] Received event:', body.event || 'unknown')

    // Find instance
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
    })

    if (!instance) {
      console.log('[Chatwoot Webhook] Instance not found:', instanceId)
      return reply.status(404).send({ error: 'Instance not found' })
    }

    // Only process incoming messages
    if (body.event !== 'message_created' || body.message_type !== 'incoming') {
      return reply.send({ status: 'ignored', reason: 'Not an incoming message' })
    }

    // Extract phone number from various possible locations in Chatwoot payload
    let phoneNumber = body.sender?.phone_number ||
                      body.conversation?.meta?.sender?.phone_number ||
                      body.contact?.phone_number ||
                      body.sender?.identifier

    if (!phoneNumber) {
      console.log('[Chatwoot Webhook] No phone number found in payload')
      return reply.status(400).send({ error: 'No phone number in payload' })
    }

    // Clean phone number (remove +, spaces, etc)
    phoneNumber = phoneNumber.replace(/\D/g, '')

    console.log(`[Chatwoot Webhook] Updating window for ${phoneNumber}`)

    // Update contact's lastInboundAt for 24h window tracking
    try {
      await prisma.contact.upsert({
        where: {
          companyId_phoneNumber: {
            companyId: instance.companyId,
            phoneNumber: phoneNumber,
          },
        },
        update: {
          lastInboundAt: new Date(),
        },
        create: {
          companyId: instance.companyId,
          phoneNumber: phoneNumber,
          name: body.sender?.name || body.contact?.name || phoneNumber,
          lastInboundAt: new Date(),
        },
      })

      console.log(`[Chatwoot Webhook] Window updated for ${phoneNumber}`)
      return reply.send({ status: 'ok', windowUpdated: true })
    } catch (error: any) {
      console.error('[Chatwoot Webhook] Error updating contact:', error)
      return reply.status(500).send({ error: 'Erro interno' })
    }
  })
}

async function triggerInstanceWebhooks(instance: any, data: any) {
  const axios = (await import('axios')).default

  // Custom webhook
  if (instance.webhookUrl && instance.webhookEvents?.includes(data.event)) {
    try {
      await axios.post(instance.webhookUrl, {
        instanceId: instance.id,
        instanceName: instance.name,
        ...data,
      })
    } catch (error) {
      console.error('Webhook error:', error)
    }
  }

  // n8n integration
  if (instance.n8nIntegration?.isActive && instance.n8nIntegration.events?.includes(data.event)) {
    try {
      await axios.post(instance.n8nIntegration.webhookUrl, {
        instanceId: instance.id,
        instanceName: instance.name,
        ...data,
      })
    } catch (error) {
      console.error('n8n webhook error:', error)
    }
  }
}
