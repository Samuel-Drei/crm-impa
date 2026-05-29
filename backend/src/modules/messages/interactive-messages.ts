/**
 * Interactive Messages Module
 * 
 * Suporta envio de mensagens interativas (botões, listas, enquetes, PIX, carrossel)
 * por IA e atendente humano usando o mesmo pipeline.
 * 
 * Tipos de botão suportados pela Evo Go API:
 * - reply: Botão de resposta rápida (máx 3, NÃO mistura com outros)
 * - url: Abre URL no navegador
 * - copy: Copia texto para clipboard
 * - call: Inicia chamada telefônica
 * 
 * PIX nativo via Evo Go: POST /send/pix (InteractiveMessage com NativeFlowMessage)
 * Carrossel: POST /send/carousel (cards com header, body, footer, botões)
 * 
 * Formato para IA gerar mensagens interativas dentro do fluxo:
 * :::interactive
 * {"type":"buttons","text":"Escolha:","buttons":[{"id":"1","text":"Sim","buttonType":"reply"}]}
 * :::
 */

import { z } from 'zod'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type InteractiveType = 'buttons' | 'list' | 'poll' | 'pix' | 'carousel'

export type ButtonType = 'reply' | 'url' | 'copy' | 'call'

export interface InteractiveButton {
  id: string
  text: string
  buttonType: ButtonType
  url?: string
  copyCode?: string
  phoneNumber?: string
}

export interface InteractiveButtonsMessage {
  type: 'buttons'
  text: string
  buttons: InteractiveButton[]
  footer?: string
  header?: string
  imageUrl?: string
  videoUrl?: string
}

export interface InteractiveListMessage {
  type: 'list'
  text: string
  buttonText: string
  sections: Array<{
    title: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
  footer?: string
  header?: string
}

export interface InteractivePollMessage {
  type: 'poll'
  question: string
  options: string[]
  selectableCount?: number
}

export interface InteractivePixMessage {
  type: 'pix'
  pixKey: string
  pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp'
  merchantName: string
  headerTitle?: string
  bodyText?: string
  footerText?: string
}

export interface CarouselCard {
  header: {
    title?: string
    subtitle?: string
    imageUrl?: string
    videoUrl?: string
  }
  body: { text: string }
  footer?: string
  buttons: Array<{
    type: 'REPLY' | 'URL' | 'CALL' | 'COPY'
    displayText: string
    id?: string
    url?: string
    phoneNumber?: string
    copyCode?: string
  }>
}

export interface InteractiveCarouselMessage {
  type: 'carousel'
  body: string
  footer?: string
  cards: CarouselCard[]
}

export type InteractiveMessage =
  | InteractiveButtonsMessage
  | InteractiveListMessage
  | InteractivePollMessage
  | InteractivePixMessage
  | InteractiveCarouselMessage

// ═══════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS (Zod)
// ═══════════════════════════════════════════════════════════════

const buttonItemSchema = z.object({
  id: z.string().min(1, 'ID obrigatório'),
  text: z.string().min(1, 'Texto do botão obrigatório').max(20, 'Máximo 20 caracteres'),
  buttonType: z.enum(['reply', 'url', 'copy', 'call']).default('reply'),
  url: z.string().url('URL inválida').optional(),
  copyCode: z.string().optional(),
  phoneNumber: z.string().optional(),
})

export const buttonsSchemaBase = z.object({
  type: z.literal('buttons'),
  text: z.string().min(1, 'Texto obrigatório').max(1024),
  buttons: z.array(buttonItemSchema).min(1, 'Mínimo 1 botão').max(3, 'Máximo 3 botões'),
  footer: z.string().max(60).optional(),
  header: z.string().max(60).optional(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
})

export const buttonsSchema = buttonsSchemaBase.superRefine((data, ctx) => {
  const types = new Set(data.buttons.map(b => b.buttonType))
  if (types.has('reply') && types.size > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Botões de resposta rápida (reply) não podem ser misturados com outros tipos (url, copy, call)',
    })
  }
  data.buttons.forEach((b, i) => {
    if (b.buttonType === 'url' && !b.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Botão ${i + 1}: URL obrigatória para tipo 'url'`, path: ['buttons', i, 'url'] })
    }
    if (b.buttonType === 'copy' && !b.copyCode && !b.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Botão ${i + 1}: copyCode obrigatório para tipo 'copy'`, path: ['buttons', i, 'copyCode'] })
    }
    if (b.buttonType === 'call' && !b.phoneNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Botão ${i + 1}: phoneNumber obrigatório para tipo 'call'`, path: ['buttons', i, 'phoneNumber'] })
    }
  })
})

export const listSchema = z.object({
  type: z.literal('list'),
  text: z.string().min(1, 'Texto obrigatório').max(1024),
  buttonText: z.string().min(1).max(20).default('Menu'),
  sections: z.array(z.object({
    title: z.string().min(1).max(24),
    rows: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(24),
      description: z.string().max(72).optional(),
    })).min(1, 'Mínimo 1 item por seção').max(10),
  })).min(1, 'Mínimo 1 seção').max(10),
  footer: z.string().max(60).optional(),
  header: z.string().max(60).optional(),
})

export const pollSchema = z.object({
  type: z.literal('poll'),
  question: z.string().min(1, 'Pergunta obrigatória').max(256),
  options: z.array(z.string().min(1).max(100)).min(2, 'Mínimo 2 opções').max(12, 'Máximo 12 opções'),
  selectableCount: z.number().int().min(0).max(12).optional().default(1),
})

export const pixSchema = z.object({
  type: z.literal('pix'),
  pixKey: z.string().min(1, 'Chave PIX obrigatória'),
  pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'evp']),
  merchantName: z.string().min(1, 'Nome do beneficiário obrigatório'),
  headerTitle: z.string().max(60).optional(),
  bodyText: z.string().max(1024).optional(),
  footerText: z.string().max(60).optional(),
})

const carouselButtonSchema = z.object({
  type: z.enum(['REPLY', 'URL', 'CALL', 'COPY']),
  displayText: z.string().min(1).max(20),
  id: z.string().optional(),
  url: z.string().url().optional(),
  phoneNumber: z.string().optional(),
  copyCode: z.string().optional(),
})

const carouselCardSchema = z.object({
  header: z.object({
    title: z.string().max(60).optional(),
    subtitle: z.string().max(60).optional(),
    imageUrl: z.string().url().optional(),
    videoUrl: z.string().url().optional(),
  }),
  body: z.object({
    text: z.string().min(1).max(1024),
  }),
  footer: z.string().max(60).optional(),
  buttons: z.array(carouselButtonSchema).min(1).max(3),
})

export const carouselSchema = z.object({
  type: z.literal('carousel'),
  body: z.string().min(1, 'Texto principal obrigatório').max(1024),
  footer: z.string().max(60).optional(),
  cards: z.array(carouselCardSchema).min(1, 'Mínimo 1 card').max(10, 'Máximo 10 cards'),
})

// Manual dispatch para evitar problemas do Zod com ZodEffects em union/discriminatedUnion
export const interactiveMessageSchema = z.object({ type: z.string() }).passthrough().transform((data, ctx) => {
  let result
  switch (data.type) {
    case 'buttons': result = buttonsSchema.safeParse(data); break
    case 'list': result = listSchema.safeParse(data); break
    case 'poll': result = pollSchema.safeParse(data); break
    case 'pix': result = pixSchema.safeParse(data); break
    case 'carousel': result = carouselSchema.safeParse(data); break
    default:
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Tipo interativo inválido: ${data.type}` })
      return z.NEVER
  }
  if (!result.success) {
    result.error.issues.forEach(issue => ctx.addIssue(issue))
    return z.NEVER
  }
  return result.data
})

export const sendInteractiveSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string().min(10),
  interactive: interactiveMessageSchema,
})

// ═══════════════════════════════════════════════════════════════
// PARSER (detecta :::interactive blocks no texto)
// ═══════════════════════════════════════════════════════════════

const INTERACTIVE_BLOCK_REGEX = /^:::interactive\s*\n([\s\S]+?)\n\s*:::$/

export function parseInteractiveBlock(text: string): InteractiveMessage | null {
  const trimmed = text.trim()
  const match = INTERACTIVE_BLOCK_REGEX.exec(trimmed)
  if (!match) return null

  try {
    const jsonStr = match[1].trim()
    const data = JSON.parse(jsonStr)
    const result = interactiveMessageSchema.safeParse(data)
    if (result.success) {
      return result.data as InteractiveMessage
    }
    console.warn('[Interactive] Bloco detectado mas inválido:', result.error.flatten())
    return null
  } catch (err) {
    console.warn('[Interactive] Erro ao parsear bloco interativo:', err)
    return null
  }
}

export function validateInteractiveMessage(data: unknown): { valid: true; message: InteractiveMessage } | { valid: false; error: string } {
  const result = interactiveMessageSchema.safeParse(data)
  if (result.success) {
    return { valid: true, message: result.data as InteractiveMessage }
  }
  const errors = result.error.flatten()
  const errorMsg = Object.entries(errors.fieldErrors)
    .map(([field, msgs]) => `${field}: ${(msgs || []).join(', ')}`)
    .join('; ') || result.error.message
  return { valid: false, error: errorMsg }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK TO TEXT
// ═══════════════════════════════════════════════════════════════

export function interactiveToText(msg: InteractiveMessage): string {
  switch (msg.type) {
    case 'buttons': {
      let text = msg.header ? `*${msg.header}*\n\n` : ''
      text += msg.text + '\n\n'
      msg.buttons.forEach((b, i) => {
        if (b.buttonType === 'url') text += `${i + 1}. ${b.text} → ${b.url}\n`
        else if (b.buttonType === 'call') text += `${i + 1}. 📞 ${b.text} (${b.phoneNumber})\n`
        else if (b.buttonType === 'copy') text += `${i + 1}. 📋 ${b.text}\n`
        else text += `${i + 1}. ${b.text}\n`
      })
      if (msg.footer) text += `\n_${msg.footer}_`
      return text.trim()
    }
    case 'list': {
      let text = msg.header ? `*${msg.header}*\n\n` : ''
      text += msg.text + '\n'
      msg.sections.forEach(section => {
        text += `\n*${section.title}*\n`
        section.rows.forEach(row => {
          text += `• ${row.title}${row.description ? ` — ${row.description}` : ''}\n`
        })
      })
      if (msg.footer) text += `\n_${msg.footer}_`
      return text.trim()
    }
    case 'poll': {
      let text = `📊 *${msg.question}*\n\n`
      msg.options.forEach((opt, i) => { text += `${i + 1}. ${opt}\n` })
      if (msg.selectableCount && msg.selectableCount > 1) {
        text += `\n_Escolha até ${msg.selectableCount} opções_`
      }
      return text.trim()
    }
    case 'pix': {
      let text = '💰 *Dados para pagamento via PIX*\n\n'
      text += `*Chave PIX:* \`${msg.pixKey}\`\n`
      text += `*Tipo:* ${msg.pixKeyType.toUpperCase()}\n`
      text += `*Beneficiário:* ${msg.merchantName}\n`
      if (msg.bodyText) text += `\n${msg.bodyText}\n`
      text += '\n_Copie a chave PIX acima para realizar o pagamento_'
      return text.trim()
    }
    case 'carousel': {
      let text = msg.body + '\n'
      msg.cards.forEach((card, i) => {
        text += `\n━━ Card ${i + 1} ━━\n`
        if (card.header.title) text += `*${card.header.title}*\n`
        text += card.body.text + '\n'
        card.buttons.forEach((btn, j) => { text += `  ${j + 1}. ${btn.displayText}\n` })
      })
      if (msg.footer) text += `\n_${msg.footer}_`
      return text.trim()
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTENT FOR DB
// ═══════════════════════════════════════════════════════════════

export function interactiveContentSummary(msg: InteractiveMessage): string {
  switch (msg.type) {
    case 'buttons': return `[Botões] ${msg.text}`
    case 'list': return `[Lista] ${msg.text}`
    case 'poll': return `[Enquete] ${msg.question}`
    case 'pix': return `[PIX] ${msg.merchantName}`
    case 'carousel': return `[Carrossel] ${msg.body}`
  }
}

// ═══════════════════════════════════════════════════════════════
// SEND VIA PROVIDER
// ═══════════════════════════════════════════════════════════════

interface SendInteractiveParams {
  msg: InteractiveMessage
  to: string
  instance: any
  evoGo?: EvoGoProvider
  baileysManager?: any
}

export async function sendInteractiveViaProvider(params: SendInteractiveParams): Promise<{
  messageId: string
  fallback: boolean
  fallbackText?: string
}> {
  const { msg, to, instance, evoGo, baileysManager } = params
  const channel = instance.channel as string

  if (channel === 'EVO_GO' && evoGo) {
    return sendViaEvoGo(msg, to, evoGo)
  }
  if (channel === 'BAILEYS' && baileysManager) {
    return sendViaBaileys(msg, to, instance.id, baileysManager)
  }

  const fallbackText = interactiveToText(msg)
  return { messageId: '', fallback: true, fallbackText }
}

async function sendViaEvoGo(
  msg: InteractiveMessage,
  to: string,
  evoGo: EvoGoProvider
): Promise<{ messageId: string; fallback: boolean; fallbackText?: string }> {
  switch (msg.type) {
    case 'buttons': {
      const apiButtons = msg.buttons.map(b => {
        const base: any = { type: b.buttonType, displayText: b.text, id: b.id }
        if (b.buttonType === 'url') base.url = b.url
        if (b.buttonType === 'copy') base.copyCode = b.copyCode || b.id
        if (b.buttonType === 'call') base.phoneNumber = b.phoneNumber
        return base
      })
      const payload: any = {
        number: to,
        title: msg.header || '',
        description: msg.text,
        footer: msg.footer || '',
        buttons: apiButtons,
      }
      if (msg.imageUrl) payload.imageUrl = msg.imageUrl
      if (msg.videoUrl) payload.videoUrl = msg.videoUrl

      // Enviar direto via client para incluir imageUrl/videoUrl
      const result = await (evoGo as any).client.post('/send/button', payload)
      const data = result.data
      return { messageId: data?.key?.id || data?.messageId || '', fallback: false }
    }

    case 'list': {
      const result = await evoGo.sendListMessage(
        to, msg.header || '', msg.text, msg.footer || '', msg.buttonText, msg.sections
      )
      return { messageId: result?.key?.id || result?.messageId || '', fallback: false }
    }

    case 'poll': {
      const result = await evoGo.sendPollMessage(
        to, msg.question, msg.options, msg.selectableCount || 1
      )
      return { messageId: result?.key?.id || result?.messageId || '', fallback: false }
    }

    case 'pix': {
      const result = await evoGo.sendPixMessage(
        to, msg.pixKey, msg.pixKeyType, msg.merchantName,
        msg.headerTitle, msg.bodyText, msg.footerText,
      )
      return { messageId: result?.key?.id || result?.messageId || '', fallback: false }
    }

    case 'carousel': {
      const result = await evoGo.sendCarouselMessage(
        to, msg.body, msg.footer || '', msg.cards
      )
      return { messageId: result?.key?.id || result?.messageId || '', fallback: false }
    }
  }
}

async function sendViaBaileys(
  msg: InteractiveMessage,
  to: string,
  instanceId: string,
  baileysManager: any
): Promise<{ messageId: string; fallback: boolean; fallbackText?: string }> {
  switch (msg.type) {
    case 'buttons': {
      const result = await baileysManager.sendInteractiveButtons(
        instanceId, to, msg.text,
        msg.buttons.map((b: any) => ({ id: b.id, text: b.text })),
        msg.footer, msg.header
      )
      return { messageId: result?.key?.id || '', fallback: false }
    }
    case 'list': {
      const result = await baileysManager.sendInteractiveList(
        instanceId, to, msg.text, msg.buttonText, msg.sections, msg.footer, msg.header
      )
      return { messageId: result?.key?.id || '', fallback: false }
    }
    case 'poll': {
      if (typeof baileysManager.sendPollMessage === 'function') {
        const result = await baileysManager.sendPollMessage(
          instanceId, to, msg.question, msg.options, msg.selectableCount || 1
        )
        return { messageId: result?.key?.id || '', fallback: false }
      }
      const fallbackText = interactiveToText(msg)
      const result = await baileysManager.sendTextMessage(instanceId, to, fallbackText)
      return { messageId: result?.key?.id || '', fallback: true, fallbackText }
    }
    case 'pix':
    case 'carousel': {
      const fallbackText = interactiveToText(msg)
      const result = await baileysManager.sendTextMessage(instanceId, to, fallbackText)
      return { messageId: result?.key?.id || '', fallback: true, fallbackText }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT DOCS
// ═══════════════════════════════════════════════════════════════

export const INTERACTIVE_SYSTEM_PROMPT_DOCS = `
## Mensagens Interativas

Você pode enviar mensagens interativas usando blocos especiais.
O formato é um bloco :::interactive seguido de JSON e fechado com :::.

### Botões de Resposta Rápida (máximo 3, texto máx 20 caracteres)
:::interactive
{"type":"buttons","text":"Gostaria de agendar?","buttons":[{"id":"sim","text":"Sim, agendar","buttonType":"reply"},{"id":"nao","text":"Não, obrigado","buttonType":"reply"}],"footer":"Responda clicando"}
:::

### Botões com Link (abre URL)
:::interactive
{"type":"buttons","text":"Acesse nossa loja:","buttons":[{"id":"loja","text":"Abrir Loja","buttonType":"url","url":"https://loja.exemplo.com"}]}
:::

### Botões Copiar Texto
:::interactive
{"type":"buttons","text":"Copie o código:","buttons":[{"id":"cupom","text":"Copiar Cupom","buttonType":"copy","copyCode":"DESCONTO20"}]}
:::

### Botões Ligar
:::interactive
{"type":"buttons","text":"Nosso atendimento:","buttons":[{"id":"ligar","text":"Ligar Agora","buttonType":"call","phoneNumber":"5511999999999"}]}
:::

### Lista
:::interactive
{"type":"list","text":"Selecione:","buttonText":"Ver opções","sections":[{"title":"Atendimento","rows":[{"id":"suporte","title":"Suporte"},{"id":"vendas","title":"Vendas"}]}]}
:::

### Enquete
:::interactive
{"type":"poll","question":"Qual horário prefere?","options":["Manhã","Tarde","Noite"],"selectableCount":1}
:::

### PIX (nativo WhatsApp)
:::interactive
{"type":"pix","pixKey":"12345678901","pixKeyType":"cpf","merchantName":"Empresa Ltda","bodyText":"Pagamento mensalidade"}
:::

### Carrossel
:::interactive
{"type":"carousel","body":"Nossos produtos:","cards":[{"header":{"title":"Produto A","imageUrl":"https://img.com/a.jpg"},"body":{"text":"Descrição A"},"buttons":[{"type":"REPLY","displayText":"Quero","id":"a"}]}]}
:::

**Regras:**
- Botões reply: máx 3, NÃO misture com url/copy/call
- Botões url/copy/call: podem ser misturados entre si
- PIX: pixKeyType = cpf | cnpj | email | phone | evp
- Carrossel: 1-10 cards, cada card pode ter imagem/vídeo no header
`.trim()
