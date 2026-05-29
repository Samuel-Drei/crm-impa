/**
 * Daily Brain Digest — Coleta + Sumarização
 *
 * Para uma empresa + data (YYYY-MM-DD, timezone da empresa), coleta tudo que aconteceu
 * (mensagens, eventos, cards, tasks, notas, tickets), agrupa por contato, e gera resumos
 * via LLM. O resultado é consumido pelo brain-persist.service para gravar em Memory/Fact/KB.
 */

import { prisma } from '../../../config/database.js'
import { createProvider } from '../providers/index.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from '../ai.service.js'
import type { AIMessage as ProviderMessage } from '../providers/base.provider.js'

// ============================================
// Tipos públicos
// ============================================

export interface DigestFact {
  predicate: string
  value: string
  confidence: number
}

export interface ContactBucket {
  contactId: string
  contactName: string
  remoteJid: string | null
  messageCount: number
  inboundCount: number
  outboundCount: number
  cardIds: string[]
  taskIds: string[]
  ticketIds: string[]
  topics: string[]
  facts: DigestFact[]
  summary: string
  rawTextForEmbedding: string
  llmTokensUsed: number
}

export interface DigestRunResult {
  date: string
  timezone: string
  rangeStart: Date
  rangeEnd: Date
  buckets: ContactBucket[]
  executiveSummary: string
  metrics: {
    contactsProcessed: number
    messagesProcessed: number
    conversationsTouched: number
    cardsTouched: number
    tasksTouched: number
    ticketsTouched: number
    factsCreated: number
    tokensUsed: number
  }
}

// ============================================
// Timezone helpers (sem dependência externa)
// ============================================

function getTzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return (asUtc - date.getTime()) / 60000
}

export function dayRangeInTz(dateStr: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)) // midday p/ evitar DST edge
  const offsetMin = getTzOffsetMinutes(guess, timeZone)
  const startUtc = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60000
  const start = new Date(startUtc)
  const end = new Date(startUtc + 24 * 3600 * 1000 - 1)
  return { start, end }
}

export function yesterdayInTz(timeZone: string): string {
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const today = dtf.format(now) // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number)
  const yest = new Date(Date.UTC(y, m - 1, d - 1))
  return dtf.format(yest)
}

// ============================================
// Prompt LLM
// ============================================

const BUCKET_SUMMARY_PROMPT = `Você é um analista do CRM. Resuma em poucas palavras o que aconteceu HOJE com este contato, com base nas atividades abaixo.

Responda APENAS com JSON válido nesta forma exata:
{
  "summary": "string curta (máx 280 chars) descrevendo o que mudou/aconteceu hoje",
  "facts": [{"predicate":"string", "value":"string", "confidence":0.0_a_1.0}],
  "topics": ["palavra-chave1","palavra-chave2"]
}

Regras:
- 0 a 5 fatos relevantes (ex: predicate="interesse", value="produto X")
- 0 a 6 topics curtos (lowercase, sem espaços extras)
- Sem markdown, sem comentários, JSON puro.`

const EXECUTIVE_PROMPT = `Você é um analista executivo do CRM. Gere um resumo curto (máx 500 chars) do dia da empresa com base nos números agregados abaixo. Seja direto, em 2-4 frases. Sem markdown.`

// ============================================
// Coleta de dados brutos
// ============================================

interface RawData {
  messages: any[]
  events: any[]
  cards: any[]
  cardActivities: any[]
  tasks: any[]
  cardNotes: any[]
  tickets: any[]
  csatResponses: any[]
  contactsById: Map<string, { id: string; name: string; phoneNumber: string }>
}

async function collectRawData(companyId: string, start: Date, end: Date): Promise<RawData> {
  const range = { gte: start, lte: end }

  const [messages, events, cards, cardActivities, tasks, cardNotes, tickets, csatResponses] = await Promise.all([
    prisma.message.findMany({
      where: { createdAt: range, conversation: { companyId } },
      select: {
        id: true,
        contactId: true,
        conversationId: true,
        remoteJid: true,
        direction: true,
        type: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    }),
    prisma.conversationEvent.findMany({
      where: { createdAt: range, conversation: { companyId } },
      select: {
        id: true,
        conversationId: true,
        remoteJid: true,
        eventType: true,
        description: true,
        actorType: true,
        actorName: true,
        createdAt: true,
      },
      take: 2000,
    }),
    prisma.card.findMany({
      where: {
        companyId,
        OR: [
          { createdAt: range },
          { updatedAt: range },
          { wonAt: range },
          { lostAt: range },
        ],
      },
      select: {
        id: true,
        contactId: true,
        title: true,
        description: true,
        value: true,
        status: true,
        wonAt: true,
        lostAt: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 2000,
    }),
    prisma.cardActivity.findMany({
      where: { createdAt: range, card: { companyId } },
      select: {
        id: true,
        cardId: true,
        type: true,
        description: true,
        createdAt: true,
        card: { select: { id: true, contactId: true, title: true } },
      },
      take: 2000,
    }).catch(() => [] as any[]),
    prisma.task.findMany({
      where: {
        companyId,
        OR: [{ createdAt: range }, { updatedAt: range }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 1000,
    }).catch(() => [] as any[]),
    prisma.cardNote.findMany({
      where: { createdAt: range, card: { companyId } },
      select: {
        id: true,
        cardId: true,
        content: true,
        createdAt: true,
        card: { select: { id: true, contactId: true, title: true } },
      },
      take: 1000,
    }).catch(() => [] as any[]),
    prisma.ticket.findMany({
      where: {
        companyId,
        OR: [{ createdAt: range }, { updatedAt: range }],
      },
      select: {
        id: true,
        contactId: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 500,
    }).catch(() => [] as any[]),
    prisma.csatSurveyResponse.findMany({
      where: { createdAt: range, instance: { companyId } },
      select: {
        id: true,
        contactId: true,
        conversationId: true,
        rating: true,
        feedbackMessage: true,
        assignedAgentId: true,
        createdAt: true,
        assignedAgent: { select: { name: true } },
      },
      take: 500,
    }).catch(() => [] as any[]),
  ])

  // Contactos referenciados
  const contactIds = new Set<string>()
  for (const m of messages) if (m.contactId) contactIds.add(m.contactId)
  for (const c of cards) if (c.contactId) contactIds.add(c.contactId)
  for (const t of tickets) if (t.contactId) contactIds.add(t.contactId)
  for (const ca of cardActivities) if (ca.card?.contactId) contactIds.add(ca.card.contactId)
  for (const cn of cardNotes) if (cn.card?.contactId) contactIds.add(cn.card.contactId)
  for (const cs of csatResponses) if (cs.contactId) contactIds.add(cs.contactId)

  const contacts = contactIds.size === 0
    ? []
    : await prisma.contact.findMany({
      where: { id: { in: Array.from(contactIds) }, companyId },
      select: { id: true, name: true, phoneNumber: true },
    })

  const contactsById = new Map<string, { id: string; name: string; phoneNumber: string }>()
  for (const c of contacts) contactsById.set(c.id, c)

  return { messages, events, cards, cardActivities, tasks, cardNotes, tickets, csatResponses, contactsById }
}

// ============================================
// Agrupamento por contato
// ============================================

interface RawBucket {
  contactId: string
  contactName: string
  remoteJid: string | null
  messages: any[]
  events: any[]
  cards: any[]
  cardActivities: any[]
  cardNotes: any[]
  tickets: any[]
  csatResponses: any[]
}

function groupByContact(raw: RawData): RawBucket[] {
  const map = new Map<string, RawBucket>()

  function ensure(contactId: string, remoteJid: string | null): RawBucket {
    let b = map.get(contactId)
    if (!b) {
      const c = raw.contactsById.get(contactId)
      b = {
        contactId,
        contactName: c?.name || c?.phoneNumber || 'Contato',
        remoteJid: remoteJid || (c?.phoneNumber ? `${c.phoneNumber}@s.whatsapp.net` : null),
        messages: [],
        events: [],
        cards: [],
        cardActivities: [],
        cardNotes: [],
        tickets: [],
        csatResponses: [],
      }
      map.set(contactId, b)
    }
    return b
  }

  for (const m of raw.messages) if (m.contactId) ensure(m.contactId, m.remoteJid).messages.push(m)
  for (const e of raw.events) {
    // events não têm contactId direto — buscar via conversation
    // Para evitar query extra, ignoramos eventos órfãos (msgs já cobrem o essencial)
    void e
  }
  for (const c of raw.cards) if (c.contactId) ensure(c.contactId, null).cards.push(c)
  for (const ca of raw.cardActivities) if (ca.card?.contactId) ensure(ca.card.contactId, null).cardActivities.push(ca)
  for (const cn of raw.cardNotes) if (cn.card?.contactId) ensure(cn.card.contactId, null).cardNotes.push(cn)
  for (const t of raw.tickets) if (t.contactId) ensure(t.contactId, null).tickets.push(t)
  for (const cs of raw.csatResponses) if (cs.contactId) ensure(cs.contactId, null).csatResponses.push(cs)

  return Array.from(map.values())
}

// ============================================
// Renderização do bucket -> texto pra LLM
// ============================================

function renderBucketAsText(b: RawBucket): string {
  const lines: string[] = []
  lines.push(`Contato: ${b.contactName}`)

  if (b.messages.length > 0) {
    lines.push('\n[Mensagens]')
    for (const m of b.messages.slice(0, 60)) {
      const who = m.direction === 'INBOUND' ? 'Cliente' : 'Atendente'
      const txt = (m.content || '').replace(/\s+/g, ' ').slice(0, 250)
      if (txt) lines.push(`- ${who}: ${txt}`)
    }
    if (b.messages.length > 60) lines.push(`- (+${b.messages.length - 60} mensagens omitidas)`)
  }

  if (b.cards.length > 0) {
    lines.push('\n[Oportunidades]')
    for (const c of b.cards) {
      const status = c.wonAt ? 'GANHO' : c.lostAt ? 'PERDIDO' : c.status || 'aberto'
      lines.push(`- ${c.title} (${status})${c.value ? ` valor=${c.value}` : ''}`)
    }
  }

  if (b.cardActivities.length > 0) {
    lines.push('\n[Atividades de oportunidade]')
    for (const ca of b.cardActivities.slice(0, 20)) {
      lines.push(`- ${ca.type}: ${(ca.description || '').slice(0, 150)}`)
    }
  }

  if (b.cardNotes.length > 0) {
    lines.push('\n[Notas]')
    for (const n of b.cardNotes.slice(0, 10)) {
      lines.push(`- ${(n.content || '').slice(0, 200)}`)
    }
  }

  if (b.tickets.length > 0) {
    lines.push('\n[Tickets]')
    for (const t of b.tickets) {
      lines.push(`- ${t.title} (${t.status})`)
    }
  }

  if (b.csatResponses.length > 0) {
    lines.push('\n[Pesquisa de Satisfação CSAT]')
    for (const cs of b.csatResponses) {
      const stars = '⭐'.repeat(cs.rating)
      const agent = cs.assignedAgent?.name ? ` (atendente: ${cs.assignedAgent.name})` : ''
      const comment = cs.feedbackMessage ? ` — comentou: "${cs.feedbackMessage.slice(0, 150)}"` : ''
      lines.push(`- Nota ${cs.rating}/5 ${stars}${agent}${comment}`)
    }
  }

  return lines.join('\n')
}

// ============================================
// LLM call (parser robusto de JSON)
// ============================================

function safeParseJson<T = any>(text: string): T | null {
  let s = text.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  // Tenta achar primeiro objeto/array balanceado
  const firstBrace = s.indexOf('{')
  const firstBracket = s.indexOf('[')
  let start = -1
  if (firstBrace === -1) start = firstBracket
  else if (firstBracket === -1) start = firstBrace
  else start = Math.min(firstBrace, firstBracket)
  if (start > 0) s = s.slice(start)
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

interface BucketLLMResponse {
  summary?: string
  facts?: { predicate?: string; value?: string; confidence?: number }[]
  topics?: string[]
}

async function summarizeBucket(
  llm: { provider: any; model: string },
  bucketText: string,
): Promise<{ summary: string; facts: DigestFact[]; topics: string[]; tokens: number }> {
  const messages: ProviderMessage[] = [
    { role: 'user', content: bucketText },
  ]

  let result: any
  try {
    result = await llm.provider.chat({
      model: llm.model,
      messages,
      maxTokens: 350,
      temperature: 0.2,
      systemPrompt: BUCKET_SUMMARY_PROMPT,
    })
  } catch (err) {
    console.warn('[DailyBrain] LLM call failed for bucket:', (err as Error).message)
    return { summary: '', facts: [], topics: [], tokens: 0 }
  }

  const tokens = (result?.tokensUsed as number) || 0
  const parsed = safeParseJson<BucketLLMResponse>(result?.content || '') || {}
  const summary = (parsed.summary || '').toString().slice(0, 500)
  const facts: DigestFact[] = Array.isArray(parsed.facts)
    ? parsed.facts
      .filter(f => f && typeof f.predicate === 'string' && typeof f.value === 'string')
      .slice(0, 10)
      .map(f => ({
        predicate: String(f.predicate).slice(0, 80),
        value: String(f.value).slice(0, 500),
        confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0.6,
      }))
    : []
  const topics: string[] = Array.isArray(parsed.topics)
    ? parsed.topics.filter(t => typeof t === 'string').slice(0, 8).map(t => t.toLowerCase().trim()).filter(Boolean)
    : []

  return { summary, facts, topics, tokens }
}

// ============================================
// Provider default da empresa
// ============================================

async function getCompanyLLM(companyId: string): Promise<{ provider: any; model: string } | null> {
  const aiProvider = await prisma.aIProvider.findFirst({
    where: { companyId, isActive: true, isDefault: true },
  })
  const fallback = aiProvider
    ? aiProvider
    : await prisma.aIProvider.findFirst({ where: { companyId, isActive: true }, orderBy: { createdAt: 'asc' } })
  if (!fallback) return null
  const decrypted = (await getProviderWithFreshToken(fallback.id, companyId)) || decryptProviderSecrets(fallback)
  const provider = createProvider(decrypted.type, decrypted.apiKey, decrypted.baseUrl, decrypted.oauthData)
  return { provider, model: decrypted.model }
}

// ============================================
// API principal
// ============================================

export async function runDigestForCompany(params: {
  companyId: string
  date: string // YYYY-MM-DD na timezone da empresa
  timezone?: string
  maxBuckets?: number
}): Promise<DigestRunResult> {
  const { companyId, date } = params

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, dailyBrainTimezone: true },
  })
  if (!company) throw new Error(`Company ${companyId} not found`)

  const timezone = params.timezone || company.dailyBrainTimezone || 'America/Sao_Paulo'
  const { start, end } = dayRangeInTz(date, timezone)

  console.log(`[DailyBrain] Coletando dados ${date} (${timezone}) — UTC range ${start.toISOString()} -> ${end.toISOString()}`)
  const raw = await collectRawData(companyId, start, end)

  let rawBuckets = groupByContact(raw)
  // Ordenar por atividade desc, limitar
  rawBuckets.sort((a, b) =>
    (b.messages.length + b.cards.length + b.cardActivities.length + b.cardNotes.length + b.tickets.length) -
    (a.messages.length + a.cards.length + a.cardActivities.length + a.cardNotes.length + a.tickets.length),
  )
  const cap = params.maxBuckets ?? 200
  if (rawBuckets.length > cap) rawBuckets = rawBuckets.slice(0, cap)

  // Filtra buckets sem nada relevante
  rawBuckets = rawBuckets.filter(b =>
    b.messages.length >= 1 || b.cards.length >= 1 || b.cardActivities.length >= 1 || b.cardNotes.length >= 1 || b.tickets.length >= 1 || b.csatResponses.length >= 1,
  )

  const llm = await getCompanyLLM(companyId)
  if (!llm) {
    console.warn(`[DailyBrain] Empresa ${companyId} sem AIProvider ativo — digest vazio`)
    return {
      date,
      timezone,
      rangeStart: start,
      rangeEnd: end,
      buckets: [],
      executiveSummary: 'Nenhum AIProvider configurado para gerar digest.',
      metrics: {
        contactsProcessed: 0,
        messagesProcessed: raw.messages.length,
        conversationsTouched: new Set(raw.messages.map(m => m.conversationId)).size,
        cardsTouched: raw.cards.length,
        tasksTouched: raw.tasks.length,
        ticketsTouched: raw.tickets.length,
        factsCreated: 0,
        tokensUsed: 0,
      },
    }
  }

  // Sumarizar cada bucket
  const buckets: ContactBucket[] = []
  let totalTokens = 0
  let totalFacts = 0

  for (const rb of rawBuckets) {
    const text = renderBucketAsText(rb)
    const inboundCount = rb.messages.filter(m => m.direction === 'INBOUND').length
    const outboundCount = rb.messages.length - inboundCount

    const { summary, facts, topics, tokens } = await summarizeBucket(llm, text)
    totalTokens += tokens
    totalFacts += facts.length

    if (!summary && facts.length === 0) continue // LLM falhou ou bucket pobre

    buckets.push({
      contactId: rb.contactId,
      contactName: rb.contactName,
      remoteJid: rb.remoteJid,
      messageCount: rb.messages.length,
      inboundCount,
      outboundCount,
      cardIds: rb.cards.map(c => c.id),
      taskIds: [],
      ticketIds: rb.tickets.map(t => t.id),
      topics,
      facts,
      summary,
      rawTextForEmbedding: `${rb.contactName} — ${summary}\nFatos: ${facts.map(f => `${f.predicate}=${f.value}`).join('; ')}\nTópicos: ${topics.join(', ')}`,
      llmTokensUsed: tokens,
    })
  }

  // Resumo executivo
  const aggText = `
Empresa: ${company.name}
Data: ${date} (${timezone})
Contatos com atividade: ${buckets.length}
Mensagens trocadas: ${raw.messages.length}
Conversas: ${new Set(raw.messages.map(m => m.conversationId)).size}
Cards movidos/atualizados: ${raw.cards.length}
Atividades em cards: ${raw.cardActivities.length}
Notas adicionadas: ${raw.cardNotes.length}
Tickets: ${raw.tickets.length}
Tasks: ${raw.tasks.length}
Pesquisas CSAT recebidas: ${raw.csatResponses.length}${raw.csatResponses.length > 0 ? `\nNota média CSAT: ${(raw.csatResponses.reduce((s, r) => s + r.rating, 0) / raw.csatResponses.length).toFixed(2)}` : ''}
`

  let executiveSummary = `Dia ${date}: ${buckets.length} contatos com atividade, ${raw.messages.length} mensagens, ${raw.cards.length} cards, ${raw.tickets.length} tickets.`
  try {
    const result = await llm.provider.chat({
      model: llm.model,
      messages: [{ role: 'user', content: aggText }],
      maxTokens: 250,
      temperature: 0.3,
      systemPrompt: EXECUTIVE_PROMPT,
    })
    if (result?.content) {
      executiveSummary = result.content.trim().slice(0, 800)
      totalTokens += (result.tokensUsed as number) || 0
    }
  } catch (err) {
    console.warn('[DailyBrain] LLM exec summary failed:', (err as Error).message)
  }

  return {
    date,
    timezone,
    rangeStart: start,
    rangeEnd: end,
    buckets,
    executiveSummary,
    metrics: {
      contactsProcessed: buckets.length,
      messagesProcessed: raw.messages.length,
      conversationsTouched: new Set(raw.messages.map(m => m.conversationId).filter(Boolean)).size,
      cardsTouched: raw.cards.length,
      tasksTouched: raw.tasks.length,
      ticketsTouched: raw.tickets.length,
      factsCreated: totalFacts,
      tokensUsed: totalTokens,
    },
  }
}
