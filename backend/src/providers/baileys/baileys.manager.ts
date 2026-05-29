import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  ConnectionState,
  proto,
  WAMessageKey,
  generateWAMessageFromContent,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { Server } from 'socket.io'
import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { pino } from 'pino'

import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { instanceRoom } from '../../config/socket-rooms.js'
import { FlowEngine, initFlowEngine, getFlowEngine } from '../../modules/flows/flow.engine.js'
import { handleIncomingForAI } from '../../modules/ai/whatsapp.integration.js'

const logger = pino({ level: 'silent' })

interface BaileysInstance {
  socket: WASocket
  qrCode?: string
  qrRetries: number
  manualDisconnect?: boolean
  companyId: string
}

export class BaileysManager {
  private instances: Map<string, BaileysInstance> = new Map()
  private io: Server
  private flowEngine: FlowEngine

  constructor(io: Server) {
    this.io = io
    // Initialize FlowEngine with send message callback
    this.flowEngine = initFlowEngine(this.sendFlowMessage.bind(this))
  }

  // Helper to format JID correctly for individuals and groups
  private formatJid(to: string): string {
    // If already has @, return as is
    if (to.includes('@')) {
      return to
    }
    // Group IDs typically start with a timestamp (e.g., 120363...) and contain a hyphen
    // or are very long numbers (18+ digits)
    if (to.includes('-') || (to.length >= 18 && /^\d+$/.test(to))) {
      return `${to}@g.us`
    }
    // Individual contact
    return `${to}@s.whatsapp.net`
  }

  // Send message from FlowEngine
  private async sendFlowMessage(to: string, content: any, type: string): Promise<void> {
    // Find the instance from the session (we need to get it from context)
    // For now, we'll use a workaround by storing instanceId in the content
    const instanceId = (content as any)._instanceId
    if (!instanceId) {
      console.error('FlowEngine: No instanceId provided')
      return
    }

    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      console.error('FlowEngine: Instance not connected')
      return
    }

    const jid = this.formatJid(to)
    // Remove internal routing field before sending
    delete (content as any)._instanceId

    try {
      switch (type) {
        case 'text':
          await baileysInstance.socket.sendMessage(jid, { text: content.text })
          break
        case 'image':
          await baileysInstance.socket.sendMessage(jid, content)
          break
        case 'audio':
          await baileysInstance.socket.sendMessage(jid, content)
          break
        case 'video':
          await baileysInstance.socket.sendMessage(jid, content)
          break
        case 'document':
          await baileysInstance.socket.sendMessage(jid, content)
          break
        case 'pix':
          await baileysInstance.socket.sendMessage(jid, {
            text: [
              content.bodyText || 'Dados para pagamento via PIX',
              content.pixKey ? `Chave PIX: ${content.pixKey}` : '',
              content.keyType ? `Tipo: ${String(content.keyType).toUpperCase()}` : '',
              content.merchantName ? `Beneficiário: ${content.merchantName}` : '',
              content.footerText || '',
            ].filter(Boolean).join('\n'),
          })
          break
        case 'buttons':
          await this.sendButtonsMessage(baileysInstance.socket, jid, content)
          break
        case 'list':
          await this.sendListMessage(baileysInstance.socket, jid, content)
          break
        case 'carousel':
          await baileysInstance.socket.sendMessage(jid, {
            text: [
              content.body || 'Carrossel',
              ...(Array.isArray(content.cards) ? content.cards : []).map((card: any, index: number) => {
                const title = card?.header?.title ? `*${card.header.title}*` : `Card ${index + 1}`
                const body = card?.body?.text || ''
                return [title, body].filter(Boolean).join('\n')
              }),
              content.footer || '',
            ].filter(Boolean).join('\n\n'),
          })
          break
        default:
          await baileysInstance.socket.sendMessage(jid, { text: content.text || String(content) })
      }
    } catch (error) {
      console.error('FlowEngine send error:', error)
    }
  }

  private getSessionPath(instanceId: string): string {
    const sessionsPath = path.resolve(env.BAILEYS_SESSIONS_PATH)
    if (!fs.existsSync(sessionsPath)) {
      fs.mkdirSync(sessionsPath, { recursive: true })
    }
    return path.join(sessionsPath, instanceId)
  }

  async initInstance(instanceId: string): Promise<void> {
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
    })

    if (!instance || instance.channel !== 'BAILEYS') {
      throw new Error('Instance not found or not a Baileys instance')
    }

    if (this.instances.has(instanceId)) {
      const existingInstance = this.instances.get(instanceId)
      if (existingInstance?.socket) {
        existingInstance.socket.end(undefined)
      }
      this.instances.delete(instanceId)
    }

    const sessionPath = this.getSessionPath(instanceId)
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
    const { version } = await fetchLatestBaileysVersion()

    const socket = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ['IMPA CRM', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      // getMessage is required for proper message sending to groups
      getMessage: async (key) => {
        if (key.id) {
          const msg = await prisma.message.findFirst({
            where: { messageId: key.id },
            select: { content: true },
          })
          if (msg) {
            return { conversation: msg.content }
          }
        }
        return { conversation: '' }
      },
    })

    this.instances.set(instanceId, {
      socket,
      qrRetries: 0,
      companyId: instance.companyId,
    })

    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      await this.handleConnectionUpdate(instanceId, update)
    })

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        await this.handleIncomingMessage(instanceId, msg)
      }
    })

    socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        await this.handleMessageStatusUpdate(instanceId, update)
      }
    })
  }

  private async handleConnectionUpdate(instanceId: string, update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update
    const baileysInstance = this.instances.get(instanceId)
    const companyId = baileysInstance?.companyId || ''

    if (qr && baileysInstance) {
      baileysInstance.qrRetries++

      if (baileysInstance.qrRetries > 5) {
        await this.disconnectInstance(instanceId)
        this.io.to(instanceRoom(companyId, instanceId)).emit('qr-timeout', { instanceId })
        return
      }

      const qrCodeDataUrl = await QRCode.toDataURL(qr)
      baileysInstance.qrCode = qrCodeDataUrl

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          status: 'CONNECTING',
          qrCode: qrCodeDataUrl,
        },
      })

      this.io.to(instanceRoom(companyId, instanceId)).emit('qr-code', {
        instanceId,
        qrCode: qrCodeDataUrl,
      })
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const wasManualDisconnect = baileysInstance?.manualDisconnect
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !wasManualDisconnect

      console.log(`Instance ${instanceId} disconnected. Status: ${statusCode}. Manual: ${wasManualDisconnect}. Reconnect: ${shouldReconnect}`)

      if (statusCode === DisconnectReason.loggedOut) {
        await this.deleteSession(instanceId)
        await prisma.instance.update({
          where: { id: instanceId },
          data: {
            status: 'DISCONNECTED',
            qrCode: null,
            phoneNumber: null,
            profileName: null,
            profilePicture: null,
          },
        })
        this.instances.delete(instanceId)
      } else if (wasManualDisconnect) {
        // User clicked disconnect - don't auto-reconnect
        await prisma.instance.update({
          where: { id: instanceId },
          data: { status: 'DISCONNECTED', qrCode: null },
        })
        this.instances.delete(instanceId)
      } else if (shouldReconnect) {
        // Connection lost unexpectedly - try to reconnect
        await prisma.instance.update({
          where: { id: instanceId },
          data: { status: 'DISCONNECTED' },
        })
        setTimeout(() => this.initInstance(instanceId), 5000)
      }

      this.io.to(instanceRoom(companyId, instanceId)).emit('status-update', {
        instanceId,
        status: 'DISCONNECTED',
      })
    }

    if (connection === 'open') {
      const socket = baileysInstance?.socket
      if (!socket) return

      const user = socket.user
      let profilePicture: string | undefined

      try {
        profilePicture = await socket.profilePictureUrl(user?.id || '', 'image')
      } catch {
        profilePicture = undefined
      }

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          status: 'CONNECTED',
          qrCode: null,
          phoneNumber: user?.id?.split(':')[0] || null,
          profileName: user?.name || null,
          profilePicture: profilePicture || null,
        },
      })

      if (baileysInstance) {
        baileysInstance.qrCode = undefined
        baileysInstance.qrRetries = 0
      }

      this.io.to(instanceRoom(companyId, instanceId)).emit('status-update', {
        instanceId,
        status: 'CONNECTED',
        phoneNumber: user?.id?.split(':')[0],
        profileName: user?.name,
        profilePicture,
      })

      console.log(`Instance ${instanceId} connected as ${user?.id}`)
    }
  }

  private async handleIncomingMessage(instanceId: string, msg: proto.IWebMessageInfo) {
    if (!msg.message) return

    // Ignorar mensagens fromMe - a pausa do bot é feita diretamente na rota /send
    // (mensagens fromMe chegam como type:'append', não 'notify', então este handler
    //  nunca é chamado para elas de qualquer forma)
    if (msg.key.fromMe) return

    // --- Normal inbound messages (fromMe=false) ---
    {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
      })

      if (!instance) return

      const rawRemoteJid = msg.key.remoteJid || ''
      const isGroup = rawRemoteJid.includes('@g.us')
      // Normalize remoteJid: strip @s.whatsapp.net for private chats (consistent with Evo Go/Cloud API)
      // Keep full JID for groups (@g.us)
      const remoteJid = isGroup ? rawRemoteJid : rawRemoteJid.replace('@s.whatsapp.net', '').replace(/@.*/, '').replace(/\D/g, '')
      const phoneNumber = rawRemoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '')

      let content = ''
      let type: 'text' | 'button_reply' | 'list_reply' | 'image' | 'audio' | 'video' | 'document' | 'sticker' = 'text'
      let buttonId: string | undefined
      let listRowId: string | undefined

      if (msg.message.conversation) {
        content = msg.message.conversation
      } else if (msg.message.extendedTextMessage?.text) {
        content = msg.message.extendedTextMessage.text
      } else if (msg.message.buttonsResponseMessage) {
        // Button reply
        content = msg.message.buttonsResponseMessage.selectedDisplayText || ''
        buttonId = msg.message.buttonsResponseMessage.selectedButtonId || undefined
        type = 'button_reply'
      } else if (msg.message.listResponseMessage) {
        // List reply
        content = msg.message.listResponseMessage.title || ''
        listRowId = msg.message.listResponseMessage.singleSelectReply?.selectedRowId || undefined
        type = 'list_reply'
      } else if (msg.message.interactiveResponseMessage) {
        // Interactive response (NativeFlow buttons/lists)
        const nativeFlow = msg.message.interactiveResponseMessage.nativeFlowResponseMessage
        if (nativeFlow?.paramsJson) {
          try {
            const params = JSON.parse(nativeFlow.paramsJson)
            if (nativeFlow.name === 'quick_reply') {
              content = params.display_text || ''
              buttonId = params.id || undefined
              type = 'button_reply'
            } else {
              // single_select (list response)
              content = params.title || params.display_text || ''
              listRowId = params.id || undefined
              type = 'list_reply'
            }
          } catch {
            content = msg.message.interactiveResponseMessage.body?.text || ''
          }
        } else {
          content = msg.message.interactiveResponseMessage.body?.text || ''
        }
      } else if (msg.message.imageMessage) {
        content = msg.message.imageMessage.caption || '[Image]'
        type = 'image'
      } else if (msg.message.videoMessage) {
        content = msg.message.videoMessage.caption || '[Video]'
        type = 'video'
      } else if (msg.message.audioMessage) {
        content = '[Audio]'
        type = 'audio'
      } else if (msg.message.documentMessage) {
        content = msg.message.documentMessage.fileName || '[Document]'
        type = 'document'
      } else if (msg.message.stickerMessage) {
        content = '[Sticker]'
        type = 'sticker'
      }

      // Save message, update metrics & contact (await before emitting socket)
      try {
        await prisma.message.create({
          data: {
            instanceId,
            remoteJid,
            messageId: msg.key.id || '',
            direction: 'INBOUND',
            status: 'DELIVERED',
            type,
            content,
            deliveredAt: new Date(),
          },
        })
        await prisma.instance.update({
          where: { id: instanceId },
          data: { messagesReceived: { increment: 1 } },
        })
      } catch (err: any) {
        if (err.code !== 'P2002') console.error('DB ops error:', err)
      }
      if (instance.companyId && phoneNumber) {
        prisma.contact.upsert({
          where: {
            companyId_phoneNumber: {
              companyId: instance.companyId,
              phoneNumber: phoneNumber,
            },
          },
          update: { lastInboundAt: new Date() },
          create: {
            companyId: instance.companyId,
            phoneNumber: phoneNumber,
            name: phoneNumber,
            lastInboundAt: new Date(),
          },
        }).catch(err => console.error('Contact upsert error:', err))
      }

      // Emit to socket (remoteJid is already normalized for both groups and private chats)
      this.io.to(instanceRoom(instance.companyId, instanceId)).emit('message-received', {
        instanceId,
        from: remoteJid,
        content,
        type,
        timestamp: new Date(),
      })

      // Try to process with FlowEngine first
      try {
        // Create a custom sendMessage function that includes instanceId
        const flowEngine = getFlowEngine()
        if (flowEngine) {
          // Temporarily override the send function to include instanceId
          const originalEngine = flowEngine as any
          const originalSendFn = originalEngine.sendMessage

          originalEngine.sendMessage = async (to: string, msgContent: any, msgType: string) => {
            // Add instanceId to content for routing
            msgContent._instanceId = instanceId
            return this.sendFlowMessage(to, msgContent, msgType)
          }

          const handled = await flowEngine.processMessage({
            instanceId,
            remoteJid,
            message: content,
            messageType: type as any,
            buttonId,
            listRowId,
            pushName: msg.pushName || '', // Nome do contato no WhatsApp
          })

          // Restore original
          originalEngine.sendMessage = originalSendFn

          if (handled) {
            // Flow handled the message, skip external webhooks
            console.log(`Flow handled message from ${phoneNumber}`)
            return
          }
        }
      } catch (error) {
        console.error('FlowEngine error:', error)
      }

      // Try AI agent processing (after flow, before webhooks)
      try {
        // Baixar audio para STT (caso o agente/instance tenha sttConfig)
        let audioBuffer: Buffer | undefined
        if (type === 'audio') {
          try {
            const downloaded = await downloadMediaMessage(msg, 'buffer', {})
            if (Buffer.isBuffer(downloaded)) audioBuffer = downloaded
          } catch (err: any) {
            console.warn(`[Baileys] Failed to download audio for STT: ${err.message}`)
          }
        }

        const aiHandled = await handleIncomingForAI(
          { instanceId, remoteJid, content, type, pushName: msg.pushName || '', fromMe: false, audio: audioBuffer },
          async (to: string, text: string, aiAgentId?: string) => {
            await this.sendTextMessage(instanceId, to, text, aiAgentId ? { sentByAIAgentId: aiAgentId } : undefined)
          },
          async (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => {
            await this.sendMediaMessage(instanceId, to, mediaType as any, mediaUrl, caption, fileName)
          },
          async (to: string, interactiveMsg: any, aiAgentId?: string) => {
            const { sendInteractiveViaProvider, interactiveContentSummary } = await import('../../modules/messages/interactive-messages.js')
            const result = await sendInteractiveViaProvider({
              msg: interactiveMsg,
              to,
              instance: { id: instanceId, channel: 'BAILEYS' },
              baileysManager: this,
            })
            // Persist interactive message in DB
            const { ensureConversationForMessage } = await import('../../modules/conversations/conversation.service.js')
            const inst = await prisma.instance.findUnique({ where: { id: instanceId } })
            if (inst) {
              const conversation = await ensureConversationForMessage({
                companyId: inst.companyId,
                instanceId,
                remoteJid: to,
                lastActivityAt: new Date(),
              })
              const contentSummary = interactiveContentSummary(interactiveMsg)
              const msgType = interactiveMsg.type === 'buttons' ? 'button' : interactiveMsg.type
              await prisma.message.create({
                data: {
                  instanceId,
                  conversationId: conversation.id,
                  remoteJid: to,
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
              await prisma.instance.update({ where: { id: instanceId }, data: { messagesSent: { increment: 1 } } }).catch(() => {})
            }
          },
          // sendAudioBufferFn: TTS — envia audio diretamente como Buffer (PTT)
          async (to: string, audio: Buffer, mimeType: string, aiAgentId?: string) => {
            await this.sendMediaMessage(
              instanceId,
              to,
              'audio',
              audio,
              undefined,
              undefined,
              aiAgentId ? { sentByAIAgentId: aiAgentId } : undefined,
            )
          }
        )
        if (aiHandled) {
          console.log(`AI handled message from ${phoneNumber}`)
          return
        }
      } catch (error) {
        console.error('AI processing error:', error)
      }

      // Trigger webhooks (Typebot, n8n, custom) if no flow handled it
      // Lazy load integrations only when needed
      const fullInstance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: { typebotIntegration: true, n8nIntegration: true },
      })
      if (!fullInstance) return
      await this.triggerWebhooks(fullInstance, {
        event: 'message.received',
        from: phoneNumber,
        content,
        type,
        timestamp: new Date(),
      })
    }
  }

  private async handleMessageStatusUpdate(instanceId: string, update: { key: WAMessageKey; update: Partial<proto.IWebMessageInfo> }) {
    const { key, update: statusUpdate } = update

    if (statusUpdate.status) {
      let status: 'SENT' | 'DELIVERED' | 'READ' = 'SENT'
      const updateData: any = {}

      switch (statusUpdate.status) {
        case 2: // SENT
          status = 'SENT'
          updateData.sentAt = new Date()
          break
        case 3: // DELIVERED
          status = 'DELIVERED'
          updateData.deliveredAt = new Date()
          break
        case 4: // READ
          status = 'READ'
          updateData.readAt = new Date()
          break
      }

      await prisma.message.updateMany({
        where: { messageId: key.id || '' },
        data: { status, ...updateData },
      })
    }
  }

  private async triggerWebhooks(instance: any, data: any) {
    const axios = (await import('axios')).default

    // Custom webhook
    if (instance.webhookUrl && instance.webhookEvents.includes(data.event)) {
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
    if (instance.n8nIntegration?.isActive && instance.n8nIntegration.events.includes(data.event)) {
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

  async sendTextMessage(instanceId: string, to: string, text: string, attribution?: { sentByUserId?: string; sentByAIAgentId?: string }): Promise<proto.WebMessageInfo | null> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const jid = this.formatJid(to)

    const result = await baileysInstance.socket.sendMessage(jid, { text })

    // Save message
    await prisma.message.create({
      data: {
        instanceId,
        remoteJid: jid,
        messageId: result?.key.id || '',
        direction: 'OUTBOUND',
        status: 'PENDING',
        type: 'text',
        content: text,
        ...(attribution?.sentByUserId ? { sentByUserId: attribution.sentByUserId } : {}),
        ...(attribution?.sentByAIAgentId ? { sentByAIAgentId: attribution.sentByAIAgentId } : {}),
      },
    })

    // Update metrics
    await prisma.instance.update({
      where: { id: instanceId },
      data: { messagesSent: { increment: 1 } },
    })

    return result || null
  }

  async sendMediaMessage(
    instanceId: string,
    to: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    media: Buffer | string,
    caption?: string,
    fileName?: string,
    attribution?: { sentByUserId?: string; sentByAIAgentId?: string }
  ): Promise<proto.WebMessageInfo | null> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const jid = this.formatJid(to)

    let messageContent: any = {}

    switch (mediaType) {
      case 'image':
        messageContent = { image: media, caption }
        break
      case 'video':
        messageContent = { video: media, caption }
        break
      case 'audio':
        messageContent = { audio: media, mimetype: 'audio/mp4', ptt: true }
        break
      case 'document':
        messageContent = { document: media, fileName: fileName || 'document', mimetype: 'application/octet-stream' }
        break
    }

    const result = await baileysInstance.socket.sendMessage(jid, messageContent)

    await prisma.message.create({
      data: {
        instanceId,
        remoteJid: jid,
        messageId: result?.key.id || '',
        direction: 'OUTBOUND',
        status: 'PENDING',
        type: mediaType,
        content: caption || `[${mediaType}]`,
        ...(attribution?.sentByUserId ? { sentByUserId: attribution.sentByUserId } : {}),
        ...(attribution?.sentByAIAgentId ? { sentByAIAgentId: attribution.sentByAIAgentId } : {}),
      },
    })

    await prisma.instance.update({
      where: { id: instanceId },
      data: { messagesSent: { increment: 1 } },
    })

    return result || null
  }

  private buildNativeFlowButtons(buttons: any[]): any[] {
    return (Array.isArray(buttons) ? buttons : [])
      .slice(0, 3)
      .map((btn, index) => {
        const type = String(btn.type || btn.buttonType || 'reply').toLowerCase()
        const displayText = String(
          btn.buttonText?.displayText ||
          btn.displayText ||
          btn.text ||
          btn.title ||
          ''
        ).trim()

        if (!displayText) return null

        if (type === 'url') {
          return {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({ display_text: displayText, url: btn.url || '' }),
          }
        }

        if (type === 'copy') {
          return {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: btn.copyCode || btn.copy_code || btn.id || '' }),
          }
        }

        if (type === 'call') {
          return {
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: btn.phoneNumber || '' }),
          }
        }

        return {
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: displayText,
            id: btn.buttonId || btn.id || `btn_${index + 1}`,
          }),
        }
      })
      .filter(Boolean)
  }

  // Send buttons using InteractiveMessage + NativeFlowMessage (modern format that works)
  private async sendButtonsMessage(
    socket: WASocket,
    jid: string,
    content: { text: string; buttons: any[]; footer?: string; header?: string }
  ): Promise<proto.WebMessageInfo | undefined> {
    const nativeButtons = this.buildNativeFlowButtons(content.buttons)

    const interactiveMsg: any = {
      body: proto.Message.InteractiveMessage.Body.create({ text: content.text }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: nativeButtons,
      }),
    }

    if (content.footer) {
      interactiveMsg.footer = proto.Message.InteractiveMessage.Footer.create({ text: content.footer })
    }
    if (content.header) {
      interactiveMsg.header = proto.Message.InteractiveMessage.Header.create({
        title: content.header,
        hasMediaAttachment: false,
      })
    }

    // Try viewOnceMessage wrapper first (most common working approach)
    const msg = generateWAMessageFromContent(jid, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create(interactiveMsg),
        },
      },
    }, { userJid: socket.user?.id || '' })

    await socket.relayMessage(jid, msg.message!, { messageId: msg.key.id! })
    return msg
  }

  // Send buttons using direct interactiveMessage (fallback format)
  private async sendButtonsMessageDirect(
    socket: WASocket,
    jid: string,
    content: { text: string; buttons: any[]; footer?: string; header?: string }
  ): Promise<proto.WebMessageInfo | undefined> {
    const nativeButtons = this.buildNativeFlowButtons(content.buttons)

    const interactiveMsg: any = {
      body: proto.Message.InteractiveMessage.Body.create({ text: content.text }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: nativeButtons,
        messageVersion: 1,
      }),
    }

    if (content.footer) {
      interactiveMsg.footer = proto.Message.InteractiveMessage.Footer.create({ text: content.footer })
    }

    const msg = generateWAMessageFromContent(jid, {
      interactiveMessage: proto.Message.InteractiveMessage.create(interactiveMsg),
    }, { userJid: socket.user?.id || '' })

    await socket.relayMessage(jid, msg.message!, { messageId: msg.key.id! })
    return msg
  }

  // Send list using InteractiveMessage + NativeFlowMessage (modern format that works)
  private async sendListMessage(
    socket: WASocket,
    jid: string,
    content: { text: string; buttonText: string; sections: Array<{ title: string; rows: Array<{ rowId: string; title: string; description?: string }> }>; footer?: string; header?: string }
  ): Promise<proto.WebMessageInfo | undefined> {
    const interactiveMsg: any = {
      body: proto.Message.InteractiveMessage.Body.create({ text: content.text }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: content.buttonText,
            sections: content.sections.map(s => ({
              title: s.title,
              rows: s.rows.map(r => ({
                title: r.title,
                description: r.description || '',
                id: r.rowId,
              })),
            })),
          }),
        }],
      }),
    }

    if (content.footer) {
      interactiveMsg.footer = proto.Message.InteractiveMessage.Footer.create({ text: content.footer })
    }
    if (content.header) {
      interactiveMsg.header = proto.Message.InteractiveMessage.Header.create({
        title: content.header,
        hasMediaAttachment: false,
      })
    }

    const msg = generateWAMessageFromContent(jid, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create(interactiveMsg),
        },
      },
    }, { userJid: socket.user?.id || '' })

    await socket.relayMessage(jid, msg.message!, { messageId: msg.key.id! })
    return msg
  }

  // Public method: send interactive buttons via API
  async sendInteractiveButtons(
    instanceId: string,
    to: string,
    text: string,
    buttons: Array<{ id: string; text: string }>,
    footer?: string,
    header?: string,
    attribution?: { sentByUserId?: string; sentByAIAgentId?: string }
  ): Promise<proto.WebMessageInfo | null> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const jid = this.formatJid(to)

    const content = {
      text,
      buttons: buttons.map(btn => ({
        buttonId: btn.id,
        buttonText: { displayText: btn.text },
      })),
      footer,
      header,
    }

    const result = await this.sendButtonsMessage(baileysInstance.socket, jid, content)

    await prisma.message.create({
      data: {
        instanceId,
        remoteJid: jid,
        messageId: result?.key.id || '',
        direction: 'OUTBOUND',
        status: 'PENDING',
        type: 'text',
        content: `[Buttons] ${text}`,
        ...(attribution?.sentByUserId ? { sentByUserId: attribution.sentByUserId } : {}),
        ...(attribution?.sentByAIAgentId ? { sentByAIAgentId: attribution.sentByAIAgentId } : {}),
      },
    })

    await prisma.instance.update({
      where: { id: instanceId },
      data: { messagesSent: { increment: 1 } },
    })

    return result || null
  }

  // Test method: send buttons with alternative format (without viewOnce)
  async sendInteractiveButtonsDirect(
    instanceId: string,
    to: string,
    text: string,
    buttons: Array<{ id: string; text: string }>,
    footer?: string,
  ): Promise<proto.WebMessageInfo | null> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const jid = this.formatJid(to)

    const content = {
      text,
      buttons: buttons.map(btn => ({
        buttonId: btn.id,
        buttonText: { displayText: btn.text },
      })),
      footer,
    }

    const result = await this.sendButtonsMessageDirect(baileysInstance.socket, jid, content)
    return result || null
  }

  // Public method: send interactive list via API
  async sendInteractiveList(
    instanceId: string,
    to: string,
    text: string,
    buttonText: string,
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
    footer?: string,
    header?: string,
    attribution?: { sentByUserId?: string; sentByAIAgentId?: string }
  ): Promise<proto.WebMessageInfo | null> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const jid = this.formatJid(to)

    const content = {
      text,
      buttonText,
      sections: sections.map(s => ({
        title: s.title,
        rows: s.rows.map(r => ({ rowId: r.id, title: r.title, description: r.description })),
      })),
      footer,
      header,
    }

    const result = await this.sendListMessage(baileysInstance.socket, jid, content)

    await prisma.message.create({
      data: {
        instanceId,
        remoteJid: jid,
        messageId: result?.key.id || '',
        direction: 'OUTBOUND',
        status: 'PENDING',
        type: 'text',
        content: `[List] ${text}`,
        ...(attribution?.sentByUserId ? { sentByUserId: attribution.sentByUserId } : {}),
        ...(attribution?.sentByAIAgentId ? { sentByAIAgentId: attribution.sentByAIAgentId } : {}),
      },
    })

    await prisma.instance.update({
      where: { id: instanceId },
      data: { messagesSent: { increment: 1 } },
    })

    return result || null
  }

  async disconnectInstance(instanceId: string): Promise<void> {
    const baileysInstance = this.instances.get(instanceId)
    if (baileysInstance?.socket) {
      // Mark as manual disconnect to prevent auto-reconnect
      baileysInstance.manualDisconnect = true
      baileysInstance.socket.end(undefined)
    }
    // Don't delete instance here - let the connection handler do it
    // to ensure proper cleanup

    await prisma.instance.update({
      where: { id: instanceId },
      data: { status: 'DISCONNECTED', qrCode: null },
    })

    this.io.to(instanceRoom(baileysInstance?.companyId || '', instanceId)).emit('status-update', {
      instanceId,
      status: 'DISCONNECTED',
    })
  }

  async logoutInstance(instanceId: string): Promise<void> {
    const baileysInstance = this.instances.get(instanceId)
    if (baileysInstance?.socket) {
      await baileysInstance.socket.logout()
    }
    await this.deleteSession(instanceId)
    this.instances.delete(instanceId)

    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        status: 'DISCONNECTED',
        qrCode: null,
        phoneNumber: null,
        profileName: null,
        profilePicture: null,
      },
    })
  }

  private async deleteSession(instanceId: string): Promise<void> {
    const sessionPath = this.getSessionPath(instanceId)
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true })
    }
  }

  getQRCode(instanceId: string): string | undefined {
    return this.instances.get(instanceId)?.qrCode
  }

  isConnected(instanceId: string): boolean {
    const instance = this.instances.get(instanceId)
    return instance?.socket?.user !== undefined
  }

  async getGroups(instanceId: string): Promise<Array<{ id: string; name: string; participants: number }>> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const groups = await baileysInstance.socket.groupFetchAllParticipating()

    return Object.values(groups).map((group) => ({
      id: group.id,
      name: group.subject,
      participants: group.participants?.length || 0,
    }))
  }

  async getGroupInfo(instanceId: string, groupId: string): Promise<any> {
    const baileysInstance = this.instances.get(instanceId)
    if (!baileysInstance?.socket) {
      throw new Error('Instance not connected')
    }

    const metadata = await baileysInstance.socket.groupMetadata(groupId)
    return {
      id: metadata.id,
      name: metadata.subject,
      description: metadata.desc,
      owner: metadata.owner,
      participants: metadata.participants.map((p) => ({
        id: p.id,
        admin: p.admin,
      })),
      createdAt: metadata.creation,
    }
  }
}
