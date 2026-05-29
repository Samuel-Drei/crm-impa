import axios, { AxiosInstance } from 'axios'
import { randomUUID } from 'crypto'

// Evo Go Provider v2.0 - Cliente HTTP para Evo Go API v3.0
// Suporta operações admin (globalApikey) e operações de instância (apikey)

interface EvoGoInstance {
  evoApiUrl?: string | null
  evoInstanceId?: string | null
  evoApiKey?: string | null
}

interface EvoGoCreateResult {
  instanceId: string
  instanceToken: string
  name: string
}

const DEFAULT_EVO_GO_WEBHOOK_EVENTS = [
  'MESSAGE',
  'SEND_MESSAGE',
  'READ_RECEIPT',
  'PRESENCE',
  'HISTORY_SYNC',
  'CHAT_PRESENCE',
  'CALL',
  'CONNECTION',
  'QRCODE',
  'LABEL',
  'CONTACT',
  'GROUP',
  'NEWSLETTER',
]
const EVO_GO_MESSAGE_EVENTS = new Set(['message', 'messages.upsert', 'sendmessage', 'buttonclick'])
const EVO_GO_INVISIBLE_TITLE = '\u200B'
const LINK_FALLBACK_MEDIA_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
])

export function isEvoGoMessageEvent(event?: string | null): boolean {
  return !!event && EVO_GO_MESSAGE_EVENTS.has(event.toLowerCase())
}

export function buildEvoGoConnectPayload(webhookUrl?: string, subscribe?: string[]) {
  const payload: any = {}
  if (!webhookUrl) return payload

  const requestedEvents = subscribe?.length ? subscribe : DEFAULT_EVO_GO_WEBHOOK_EVENTS
  const normalizedEvents = requestedEvents
    .flatMap(event => event.toUpperCase() === 'ALL' ? DEFAULT_EVO_GO_WEBHOOK_EVENTS : [event.toUpperCase()])
    .filter((event, index, events) => event && events.indexOf(event) === index)

  payload.webhookUrl = webhookUrl
  payload.subscribe = normalizedEvents
  payload.events = normalizedEvents.join(',')
  return payload
}

export function shouldSendMediaAsLink(mediaType: string, mediaUrl?: string | null): boolean {
  if (!mediaUrl || mediaType.toLowerCase() !== 'video') return false

  try {
    const host = new URL(mediaUrl).hostname.toLowerCase()
    return LINK_FALLBACK_MEDIA_HOSTS.has(host)
  } catch {
    return false
  }
}

export function buildMediaLinkFallbackText(mediaUrl: string, caption?: string): string {
  const cleanCaption = caption?.trim()
  return cleanCaption ? `${cleanCaption}\n${mediaUrl}` : mediaUrl
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const responseData = (error as any)?.response?.data
  if (typeof responseData?.message === 'string') return responseData.message
  if (typeof responseData?.error === 'string') return responseData.error
  return ''
}

function isUnsupportedRemoteMediaFormatError(error: unknown): boolean {
  return /invalid file format/i.test(getErrorMessage(error))
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstCleanString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanString(value)
    if (cleaned) return cleaned
  }
  return ''
}

type EvoGoFlowReply = {
  content: string
  messageType: 'button_reply' | 'list_reply'
  buttonId?: string
  listRowId?: string
}

function hasEvoGoFlowReplyId(reply: EvoGoFlowReply | null): reply is EvoGoFlowReply {
  return !!reply && !!(reply.buttonId || reply.listRowId)
}

export function normalizeEvoGoButtons(buttons: any[]): any[] {
  return (Array.isArray(buttons) ? buttons : [])
    .map((button, index) => {
      const type = cleanString(button.type || button.buttonType || 'reply').toLowerCase() || 'reply'
      if (type === 'pix') {
        return {
          type: 'pix',
          currency: button.currency || '',
          name: button.name || '',
          keyType: button.keyType || 'random',
          key: button.key || '',
        }
      }

      const displayText = cleanString(
        button.displayText ||
        button.text ||
        button.title ||
        button.buttonText?.displayText
      )
      if (!displayText) return null

      const id = cleanString(button.id || button.buttonId) || `btn_${index + 1}`
      const normalized: any = { type, displayText }

      if (type === 'reply') normalized.id = id
      if (type === 'url') normalized.url = button.url || ''
      if (type === 'copy') normalized.copyCode = button.copyCode || button.copy_code || id
      if (type === 'call') normalized.phoneNumber = button.phoneNumber || ''

      return normalized
    })
    .filter(Boolean)
}

export function normalizeEvoGoListSections(sections: any[]): any[] {
  return (Array.isArray(sections) ? sections : [])
    .map((section, sectionIndex) => {
      const rows = (Array.isArray(section.rows) ? section.rows : [])
        .map((row: any, rowIndex: number) => {
          const title = cleanString(row.title || row.text)
          if (!title) return null
          return {
            title,
            description: cleanString(row.description),
            rowId: cleanString(row.rowId || row.id) || `row_${sectionIndex + 1}_${rowIndex + 1}`,
          }
        })
        .filter(Boolean)

      if (rows.length === 0) return null
      return {
        title: cleanString(section.title),
        rows,
      }
    })
    .filter(Boolean)
}

export function buildEvoGoButtonPayload(to: string, title: string, description: string, footer: string, buttons: any[]) {
  const normalizedButtons = normalizeEvoGoButtons(buttons)
  const cleanDescription = description || ''
  const hasOnlyCtaButtons = normalizedButtons.length > 0 &&
    normalizedButtons.every(button => ['copy', 'url', 'call'].includes(button.type))
  const ctaDescription = title
    ? `*${title}*${cleanDescription ? `\n\n${cleanDescription}` : ''}`
    : cleanDescription
  const cleanTitle = title || (hasOnlyCtaButtons && cleanDescription ? EVO_GO_INVISIBLE_TITLE : cleanDescription || 'Mensagem')

  return {
    number: to,
    title: hasOnlyCtaButtons ? EVO_GO_INVISIBLE_TITLE : cleanTitle,
    description: hasOnlyCtaButtons ? ctaDescription : cleanDescription,
    footer: footer || '',
    buttons: normalizedButtons,
  }
}

export function buildEvoGoListPayload(
  to: string,
  title: string,
  description: string,
  footerText: string,
  buttonText: string,
  sections: any[],
) {
  const cleanTitle = title || description || buttonText || 'Menu'
  return {
    number: to,
    title: cleanTitle,
    description: description || '',
    footerText: footerText || '',
    buttonText: buttonText || 'Menu',
    sections: normalizeEvoGoListSections(sections),
  }
}

function normalizeCarouselButtonType(button: any): 'REPLY' | 'URL' | 'CALL' | 'COPY' {
  const type = cleanString(button.type || button.buttonType || 'REPLY').toUpperCase()
  return type === 'URL' || type === 'CALL' || type === 'COPY' ? type : 'REPLY'
}

export function normalizeEvoGoCarouselCards(cards: any[]): any[] {
  return (Array.isArray(cards) ? cards : [])
    .slice(0, 10)
    .map((card) => {
      const bodyText = cleanString(card?.body?.text || card?.text || card?.body)
      if (!bodyText) return null

      const header: any = {}
      const title = cleanString(card?.header?.title || card?.title)
      const subtitle = cleanString(card?.header?.subtitle || card?.subtitle)
      const imageUrl = cleanString(card?.header?.imageUrl || card?.imageUrl)
      const videoUrl = cleanString(card?.header?.videoUrl || card?.videoUrl)
      if (title) header.title = title
      if (subtitle) header.subtitle = subtitle
      if (imageUrl) header.imageUrl = imageUrl
      if (!imageUrl && videoUrl) header.videoUrl = videoUrl

      const buttons = (Array.isArray(card?.buttons) ? card.buttons : [])
        .slice(0, 3)
        .map((button: any, index: number) => {
          const type = normalizeCarouselButtonType(button)
          const displayText = cleanString(button.displayText || button.text || button.title)
          if (!displayText) return null

          const fallbackId = cleanString(button.id || button.buttonId) || `card_btn_${index + 1}`
          if (type === 'URL') {
            const url = cleanString(button.url) || fallbackId
            return url ? { type, displayText, id: url } : null
          }
          if (type === 'CALL') {
            const phoneNumber = cleanString(button.phoneNumber) || fallbackId
            return phoneNumber ? { type, displayText, id: phoneNumber } : null
          }
          if (type === 'COPY') {
            const copyCode = cleanString(button.copyCode || button.copy_code) || fallbackId
            return copyCode ? { type, displayText, copyCode } : null
          }

          return { type: 'REPLY', displayText, id: fallbackId }
        })
        .filter(Boolean)

      const normalizedCard: any = {
        header,
        body: { text: bodyText },
      }
      const footer = cleanString(card?.footer)
      if (footer) normalizedCard.footer = footer
      if (buttons.length > 0) normalizedCard.buttons = buttons
      return normalizedCard
    })
    .filter(Boolean)
}

export function buildEvoGoCarouselPayload(to: string, body: string, footer: string, cards: any[]) {
  return {
    number: to,
    body: body || '',
    footer: footer || '',
    cards: normalizeEvoGoCarouselCards(cards),
  }
}

export function extractEvoGoFlowReply(message: any): EvoGoFlowReply | null {
  let nestedFallback: EvoGoFlowReply | null = null

  if (message?.Message && message.Message !== message) {
    const nestedReply = extractEvoGoFlowReply(message.Message)
    if (hasEvoGoFlowReplyId(nestedReply)) return nestedReply
    if (nestedReply) nestedFallback = nestedReply
  }
  if (message?.message && message.message !== message) {
    const nestedReply = extractEvoGoFlowReply(message.message)
    if (hasEvoGoFlowReplyId(nestedReply)) return nestedReply
    if (nestedReply) nestedFallback = nestedReply
  }

  let structuredFallback: EvoGoFlowReply | null = nestedFallback

  if (message?.buttonsResponseMessage) {
    const buttonId = cleanString(message.buttonsResponseMessage.selectedButtonId)
    const reply = {
      content: cleanString(message.buttonsResponseMessage.selectedDisplayText) || buttonId || '[Botão]',
      messageType: 'button_reply',
      ...(buttonId ? { buttonId } : {}),
    } as const
    if (buttonId) return reply
    structuredFallback = reply
  }

  if (message?.listResponseMessage) {
    const listRowId = cleanString(message.listResponseMessage.singleSelectReply?.selectedRowId)
    const reply = {
      content: cleanString(message.listResponseMessage.title) || listRowId || '[Lista]',
      messageType: 'list_reply',
      ...(listRowId ? { listRowId } : {}),
    } as const
    if (listRowId) return reply
    structuredFallback = reply
  }

  const directSources = [
    message,
    message?.button,
    message?.Button,
    message?.buttonClick,
    message?.ButtonClick,
    message?.response,
    message?.selectedButton,
  ].filter(Boolean)

  for (const source of directSources) {
    const responseType = firstCleanString(
      source.type,
      source.Type,
      source.responseType,
      source.buttonType,
      source.ButtonType,
    ).toLowerCase()
    const selectedId = firstCleanString(
      source.buttonId,
      source.ButtonID,
      source.button_id,
      source.selectedButtonId,
      source.selectedRowId,
      source.rowId,
      source.RowID,
      source.id,
      source.ID,
    )
    if (!selectedId) continue

    const selectedText = firstCleanString(
      source.displayText,
      source.DisplayText,
      source.selectedDisplayText,
      source.title,
      source.Title,
      source.text,
      source.Text,
      source.name,
      source.Name,
    ) || selectedId

    if (responseType.includes('list') || source.rowId || source.RowID || source.selectedRowId) {
      return {
        content: selectedText,
        messageType: 'list_reply',
        listRowId: selectedId,
      }
    }

    return {
      content: selectedText,
      messageType: 'button_reply',
      buttonId: selectedId,
    }
  }

  const nativeFlow = message?.interactiveResponseMessage?.nativeFlowResponseMessage
  if (!nativeFlow?.paramsJson) return structuredFallback

  try {
    const params = JSON.parse(nativeFlow.paramsJson)
    const id = cleanString(params.id)
    if (nativeFlow.name === 'quick_reply') {
      return {
        content: cleanString(params.display_text || params.title) || id || '[Botão]',
        messageType: 'button_reply',
        ...(id ? { buttonId: id } : {}),
      }
    }

    return {
      content: cleanString(params.title || params.display_text) || id || '[Lista]',
      messageType: 'list_reply',
      ...(id ? { listRowId: id } : {}),
    }
  } catch {
    return structuredFallback
  }

  return structuredFallback
}

export function normalizeEvoGoButtonClickMessage(raw: any): any {
  const sourceMessage = raw?.Message || raw?.message || raw || {}

  const sourceReply = extractEvoGoFlowReply(sourceMessage)
  const rawReply = sourceMessage === raw ? null : extractEvoGoFlowReply(raw)
  const reply = hasEvoGoFlowReplyId(sourceReply)
    ? sourceReply
    : hasEvoGoFlowReplyId(rawReply)
      ? rawReply
      : sourceReply || rawReply
  if (!reply) return sourceMessage

  if (reply.messageType === 'list_reply') {
    return {
      listResponseMessage: {
        title: reply.content,
        singleSelectReply: { selectedRowId: reply.listRowId },
      },
    }
  }

  return {
    buttonsResponseMessage: {
      selectedDisplayText: reply.content,
      selectedButtonId: reply.buttonId,
    },
  }
}

export class EvoGoProvider {
  private client: AxiosInstance
  private instanceId: string

  constructor(instance: EvoGoInstance) {
    if (!instance.evoApiUrl || !instance.evoApiKey || !instance.evoInstanceId) {
      throw new Error('Credenciais da Evo Go não configuradas (URL, ID e API Key são obrigatórios)')
    }

    this.instanceId = instance.evoInstanceId

    // Endpoints operacionais usam apikey no header (sem instância na URL)
    this.client = axios.create({
      baseURL: instance.evoApiUrl.replace(/\/+$/, ''),
      headers: {
        'apikey': instance.evoApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          throw new Error('API Key da Evo Go inválida ou expirada. Verifique nas configurações da instância.')
        }
        if (error.response?.data?.message) {
          throw new Error(error.response.data.message)
        }
        if (error.response?.data?.error) {
          throw new Error(typeof error.response.data.error === 'string' ? error.response.data.error : JSON.stringify(error.response.data.error))
        }
        throw error
      }
    )
  }

  // ========== ADMIN - Criar instância na Evo Go (usa globalApikey) ==========

  static async createInstance(evoApiUrl: string, globalApiKey: string, name: string, token?: string): Promise<EvoGoCreateResult> {
    const baseUrl = evoApiUrl.replace(/\/+$/, '')
    const instanceToken = token || randomUUID()

    const response = await axios.post(`${baseUrl}/instance/create`, {
      name,
      token: instanceToken,
    }, {
      headers: {
        'apikey': globalApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })

    const data = response.data?.data || response.data
    return {
      instanceId: data.id || data.instanceId,
      instanceToken: instanceToken,
      name: data.name || name,
    }
  }

  // ========== ADMIN - Deletar instância na Evo Go ==========

  static async deleteInstance(evoApiUrl: string, globalApiKey: string, instanceId: string): Promise<void> {
    const baseUrl = evoApiUrl.replace(/\/+$/, '')
    await axios.delete(`${baseUrl}/instance/delete/${instanceId}`, {
      headers: {
        'apikey': globalApiKey,
      },
      timeout: 30000,
    })
  }

  // ========== ADMIN - Listar instâncias na Evo Go ==========

  static async listInstances(evoApiUrl: string, globalApiKey: string): Promise<any[]> {
    const baseUrl = evoApiUrl.replace(/\/+$/, '')
    const response = await axios.get(`${baseUrl}/instance/all`, {
      headers: {
        'apikey': globalApiKey,
      },
      timeout: 30000,
    })
    return response.data?.data || response.data || []
  }

  // ========== STATUS ==========

  async getConnectionStatus() {
    const response = await this.client.get('/instance/status')
    return response.data
  }

  async connectInstance(webhookUrl?: string, subscribe?: string[]) {
    const payload = buildEvoGoConnectPayload(webhookUrl, subscribe)
    const response = await this.client.post('/instance/connect', payload)
    return response.data
  }

  async getQRCode() {
    const response = await this.client.get('/instance/qr')
    return response.data
  }

  async disconnectInstance() {
    const response = await this.client.post('/instance/disconnect')
    return response.data
  }

  async reconnectInstance() {
    const response = await this.client.post('/instance/reconnect')
    return response.data
  }

  async logoutInstance() {
    const response = await this.client.delete('/instance/logout')
    return response.data
  }

  // ========== ENVIO DE MENSAGENS ==========

  async sendTextMessage(to: string, text: string) {
    const response = await this.client.post('/send/text', {
      number: to,
      text,
    })
    return response.data
  }

  async sendMediaMessage(to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) {
    if (shouldSendMediaAsLink(mediaType, mediaUrl)) {
      return this.sendLinkMessage(to, buildMediaLinkFallbackText(mediaUrl, caption))
    }

    const payload: any = {
      number: to,
      url: mediaUrl,
      type: mediaType, // image | video | audio | document | ptv
    }
    if (caption) payload.caption = caption
    if (fileName) payload.filename = fileName

    try {
      const response = await this.client.post('/send/media', payload)
      return response.data
    } catch (error) {
      if (isUnsupportedRemoteMediaFormatError(error)) {
        return this.sendLinkMessage(to, buildMediaLinkFallbackText(mediaUrl, caption))
      }
      throw error
    }
  }

  async sendLinkMessage(to: string, text: string) {
    const response = await this.client.post('/send/link', {
      number: to,
      text,
    })
    return response.data
  }

  async sendLocationMessage(to: string, latitude: number, longitude: number, name: string, address: string) {
    const response = await this.client.post('/send/location', {
      number: to,
      latitude,
      longitude,
      name,
      address,
    })
    return response.data
  }

  async sendContactMessage(to: string, vcard: { fullName: string; phone: string; organization?: string; email?: string }) {
    const response = await this.client.post('/send/contact', {
      number: to,
      vcard,
    })
    return response.data
  }

  async sendButtonMessage(to: string, title: string, description: string, footer: string, buttons: any[]) {
    const response = await this.client.post('/send/button', buildEvoGoButtonPayload(to, title, description, footer, buttons))
    return response.data
  }

  async sendListMessage(to: string, title: string, description: string, footerText: string, buttonText: string, sections: any[]) {
    const response = await this.client.post('/send/list', buildEvoGoListPayload(to, title, description, footerText, buttonText, sections))
    return response.data
  }

  async sendPollMessage(to: string, question: string, options: string[], selectableCount: number = 1) {
    const response = await this.client.post('/send/poll', {
      number: to,
      question,
      options,
      maxAnswer: selectableCount,
    })
    return response.data
  }

  async sendStickerMessage(to: string, stickerUrl: string) {
    const response = await this.client.post('/send/sticker', {
      number: to,
      sticker: stickerUrl,
    })
    return response.data
  }

  async sendPixMessage(to: string, pixKey: string, keyType: string, merchantName: string, headerTitle?: string, bodyText?: string, footerText?: string) {
    const normalizedKeyType = String(keyType || 'random').toLowerCase() === 'evp'
      ? 'random'
      : String(keyType || 'random').toLowerCase()
    const description = bodyText || headerTitle || merchantName || 'PIX'
    const response = await this.client.post('/send/button', buildEvoGoButtonPayload(
      to,
      headerTitle || description,
      description,
      footerText || '',
      [{ type: 'pix', currency: 'BRL', name: merchantName, keyType: normalizedKeyType, key: pixKey }],
    ))
    return response.data
  }

  async sendCarouselMessage(to: string, body: string, footer: string, cards: any[]) {
    const response = await this.client.post('/send/carousel', buildEvoGoCarouselPayload(to, body, footer, cards))
    return response.data
  }

  // ========== OPERAÇÕES DE MENSAGEM ==========

  async reactToMessage(number: string, messageId: string, reaction: string, fromMe: boolean) {
    const response = await this.client.post('/message/react', {
      number,
      id: messageId,
      reaction,
      fromMe,
    })
    return response.data
  }

  async markAsRead(number: string, messageIds: string[]) {
    const response = await this.client.post('/message/markread', {
      number,
      id: messageIds,
    })
    return response.data
  }

  async downloadMedia(message: any) {
    const response = await this.client.post('/message/downloadmedia', {
      message,
    })
    return response.data
  }

  // ========== GRUPOS ==========

  async listGroups() {
    const response = await this.client.get('/group/list')
    return response.data
  }

  async getGroupInfo(groupJid: string) {
    const response = await this.client.post('/group/info', {
      groupJid,
    })
    return response.data
  }

  // ========== NEWSLETTERS (CANAIS) ==========

  async listNewsletters() {
    const response = await this.client.get('/newsletter/list')
    return response.data
  }

  async getNewsletterInfo(jid: string) {
    const response = await this.client.post('/newsletter/info', { jid })
    return response.data
  }

  // ========== USUÁRIO ==========

  async checkIsOnWhatsApp(numbers: string[]) {
    const response = await this.client.post('/user/check', {
      number: numbers,
    })
    return response.data
  }

  async getUserInfo(numbers: string[]) {
    const response = await this.client.post('/user/info', {
      number: numbers,
    })
    return response.data
  }

  async getChatMessages(days = 90, chat?: string) {
    const params: Record<string, string | number> = { days, limit: 0 }
    if (chat) params.chat = chat
    const response = await this.client.get('/chat/messages', { params })
    return response.data
  }

  async getImportHistoryStatus() {
    const response = await this.client.get('/chat/import-history/status')
    return response.data
  }

  /**
   * Lista de contatos do address book do aparelho (rico em nomes reais).
   * Retorna array de { Jid, Found, FirstName, FullName, PushName, BusinessName }.
   * Tolerante a erro: retorna [] se endpoint indisponível.
   */
  async getContacts(): Promise<Array<{ Jid: string; Found?: boolean; FirstName?: string; FullName?: string; PushName?: string; BusinessName?: string }>> {
    try {
      const response = await this.client.get('/user/contacts')
      const data = response.data?.data ?? response.data
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.contacts)) return data.contacts
      if (Array.isArray(data?.users)) return data.users
      return []
    } catch {
      return []
    }
  }

  async getAvatar(number: string, preview = true) {
    const response = await this.client.post('/user/avatar', {
      number,
      preview,
    })
    return response.data
  }

  // ========== CONFIGURAÇÕES AVANÇADAS ==========

  async getAdvancedSettings() {
    const response = await this.client.get(`/instance/${this.instanceId}/advanced-settings`)
    return response.data
  }

  async updateAdvancedSettings(settings: {
    alwaysOnline?: boolean
    rejectCall?: boolean
    msgRejectCall?: string
    readMessages?: boolean
    ignoreGroups?: boolean
    ignoreStatus?: boolean
  }) {
    const response = await this.client.put(`/instance/${this.instanceId}/advanced-settings`, settings)
    return response.data
  }
}
