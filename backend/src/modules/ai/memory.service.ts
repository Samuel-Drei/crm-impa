/**
 * Memória Persistente — Resumo de sessões por contato
 * 
 * Quando uma sessão fecha, gera um resumo via LLM e salva em AIMemory.
 * Quando uma nova sessão abre, injeta o contexto da memória no prompt.
 */

import { prisma } from '../../config/database.js'
import { createProvider } from './providers/index.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from './ai.service.js'
import type { AIMessage as ProviderMessage } from './providers/base.provider.js'

// ============================================
// PROMPT DE SUMARIZAÇÃO
// ============================================

const SUMMARIZE_PROMPT = `Você é um assistente que sumariza conversas de atendimento.
Dado o histórico abaixo, gere um JSON com:
- "summary": resumo conciso da conversa (máx 500 chars)
- "facts": array de fatos importantes sobre o contato (nome, empresa, produtos mencionados, problemas, etc.)
- "preferences": objeto com preferências detectadas (idioma, horário, canal preferido, etc.)

Responda APENAS com o JSON válido, sem markdown ou explicações.`

// ============================================
// SUMARIZAR SESSÃO E SALVAR MEMÓRIA
// ============================================

export async function summarizeAndSaveMemory(params: {
  sessionId: string
  agentId: string
  companyId: string
  remoteJid: string
}) {
  const { sessionId, agentId, companyId, remoteJid } = params

  try {
    // Buscar mensagens da sessão
    const messages = await prisma.aIMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 30, // limitar para não estourar contexto
    })

    if (messages.length < 3) return // sessão muito curta, não vale sumarizar

    // Buscar provider do agente para usar na sumarização
    const agent = await prisma.aIAgent.findFirst({
      where: { id: agentId, companyId },
      include: { provider: true },
    })

    if (!agent?.provider) return

    // Montar histórico como texto
    const historyText = messages.map(m => {
      const role = m.role === 'user' ? 'Cliente' : 'Assistente'
      return `[${role}]: ${m.content?.substring(0, 300) || ''}`
    }).join('\n')

    // Chamar LLM para sumarizar (com refresh de token Copilot)
    const decrypted = await getProviderWithFreshToken(agent.provider.id, companyId)
      || decryptProviderSecrets(agent.provider)
    const provider = createProvider(decrypted.type, decrypted.apiKey, decrypted.baseUrl, decrypted.oauthData)

    const chatMessages: ProviderMessage[] = [
      { role: 'user', content: `Histórico da conversa:\n\n${historyText}` },
    ]

    const result = await provider.chat({
      model: agent.model || agent.provider.model,
      messages: chatMessages,
      maxTokens: 500,
      temperature: 0.3,
      systemPrompt: SUMMARIZE_PROMPT,
    })

    // Parsear resposta
    let summary = ''
    let facts: string[] = []
    let preferences: Record<string, any> = {}

    try {
      // Limpar possível markdown wrapping
      let cleaned = result.content.trim()
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const parsed = JSON.parse(cleaned)
      summary = parsed.summary || result.content.substring(0, 500)
      facts = Array.isArray(parsed.facts) ? parsed.facts : []
      preferences = typeof parsed.preferences === 'object' ? parsed.preferences : {}
    } catch {
      // Se não conseguir parsear JSON, usar o texto como resumo
      summary = result.content.substring(0, 500)
    }

    // Buscar memória existente
    const existing = await prisma.aIMemory.findUnique({
      where: { companyId_agentId_remoteJid: { companyId, agentId, remoteJid } },
    })

    if (existing) {
      // Merge: concatenar resumos, unir facts, merge preferences
      const existingFacts = Array.isArray(existing.facts) ? existing.facts as string[] : []
      const mergedFacts = [...new Set([...existingFacts, ...facts])].slice(0, 20) // máx 20 fatos

      const existingPrefs = typeof existing.preferences === 'object' && existing.preferences !== null
        ? existing.preferences as Record<string, any>
        : {}
      const mergedPrefs = { ...existingPrefs, ...preferences }

      // Manter resumo atualizado (mais recente + contexto anterior)
      const mergedSummary = existing.sessionCount > 3
        ? summary // Após 3+ sessões, substituir para não crescer infinito
        : `${existing.summary}\n---\n${summary}`.substring(0, 2000)

      await prisma.aIMemory.update({
        where: { id: existing.id },
        data: {
          summary: mergedSummary,
          facts: mergedFacts,
          preferences: mergedPrefs,
          sessionCount: { increment: 1 },
          lastSessionId: sessionId,
          tokensUsed: { increment: result.tokensUsed },
        },
      })
    } else {
      await prisma.aIMemory.create({
        data: {
          companyId,
          agentId,
          remoteJid,
          summary,
          facts,
          preferences,
          sessionCount: 1,
          lastSessionId: sessionId,
          tokensUsed: result.tokensUsed,
        },
      })
    }

    console.log(`[Memory] Saved memory for ${remoteJid} on agent ${agentId} (${messages.length} msgs → ${summary.length} chars)`)

    // ============================================
    // Brain integration — registra fatos/preferências como AIBrainFacts
    // ============================================
    try {
      const brain = await import('./brain/brain.service.js')

      // Localizar contato pelo remoteJid (whatsapp jid normalmente bate com phoneNumber)
      const phoneDigits = (remoteJid || '').replace(/\D/g, '').replace(/^55/, '')
      const contact = phoneDigits
        ? await prisma.contact.findFirst({
            where: {
              companyId,
              phoneNumber: { contains: phoneDigits },
            },
            select: { id: true, name: true, phoneNumber: true },
          })
        : null

      let nodeId: string | null = null
      if (contact) {
        const node = await brain.syncContactNode(companyId, contact.id)
        nodeId = node?.id ?? null
      }

      const subject = contact?.name || remoteJid

      for (const f of facts) {
        if (typeof f !== 'string' || !f.trim()) continue
        await brain.createFact({
          companyId,
          contactId: contact?.id ?? null,
          agentId,
          nodeId,
          category: 'CUSTOM',
          subject,
          predicate: 'sabe-se que',
          value: f.substring(0, 500),
          confidence: 0.7,
          sourceType: 'LLM',
          sourceRefType: 'session',
          sourceRefId: sessionId,
        })
      }

      for (const [k, v] of Object.entries(preferences || {})) {
        if (v === undefined || v === null) continue
        await brain.createFact({
          companyId,
          contactId: contact?.id ?? null,
          agentId,
          nodeId,
          category: 'PREFERENCE',
          subject,
          predicate: k,
          value: String(v).substring(0, 500),
          confidence: 0.75,
          sourceType: 'LLM',
          sourceRefType: 'session',
          sourceRefId: sessionId,
        })
      }
    } catch (brainErr) {
      console.warn('[Memory→Brain] Failed to sync facts:', (brainErr as Error).message)
    }
  } catch (err) {
    console.warn('[Memory] Failed to summarize session:', (err as Error).message)
  }
}

// ============================================
// CARREGAR MEMÓRIA PARA INJEÇÃO NO PROMPT
// ============================================

export async function loadMemoryContext(params: {
  agentId: string
  companyId: string
  remoteJid: string
  /** Mensagem atual do usuário — habilita busca semântica de fatos no Cerebro */
  currentMessage?: string
}): Promise<string | null> {
  const { agentId, companyId, remoteJid, currentMessage } = params

  const memory = await prisma.aIMemory.findUnique({
    where: { companyId_agentId_remoteJid: { companyId, agentId, remoteJid } },
  })

  if (!memory) return null

  const parts: string[] = ['=== MEMÓRIA DO CONTATO (sessões anteriores) ===']

  parts.push(`Resumo: ${memory.summary}`)

  const facts = Array.isArray(memory.facts) ? memory.facts as string[] : []
  if (facts.length > 0) {
    parts.push(`\nFatos importantes:\n${facts.map(f => `- ${f}`).join('\n')}`)
  }

  const prefs = typeof memory.preferences === 'object' && memory.preferences !== null
    ? memory.preferences as Record<string, any>
    : {}
  const prefEntries = Object.entries(prefs)
  if (prefEntries.length > 0) {
    parts.push(`\nPreferências:\n${prefEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`)
  }

  parts.push(`\nSessões anteriores: ${memory.sessionCount}`)
  parts.push('=== FIM MEMÓRIA DO CONTATO ===')

  // Anexar bloco "What I know" do Brain (fatos consolidados)
  try {
    const brain = await import('./brain/brain.service.js')
    const phoneDigits = (remoteJid || '').replace(/\D/g, '').replace(/^55/, '')
    const contact = phoneDigits
      ? await prisma.contact.findFirst({
          where: { companyId, phoneNumber: { contains: phoneDigits } },
          select: { id: true },
        })
      : null
    if (contact) {
      const block = await brain.buildKnowledgeBlock({
        companyId,
        contactId: contact.id,
        limit: 12,
        query: currentMessage,
      })
      if (block) parts.push('\n' + block)
    }
  } catch {
    // silencioso — não quebrar a sessão
  }

  return parts.join('\n')
}

// ============================================
// BUSCAR MEMÓRIAS (para API/dashboard)
// ============================================

export async function listMemories(companyId: string, params?: {
  agentId?: string
  remoteJid?: string
  page?: number
  limit?: number
}) {
  const { agentId, remoteJid, page = 1, limit = 50 } = params || {}

  const where: any = { companyId }
  if (agentId) where.agentId = agentId
  if (remoteJid) where.remoteJid = remoteJid

  const [records, total] = await Promise.all([
    prisma.aIMemory.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.aIMemory.count({ where }),
  ])

  return { records, total, page, limit, totalPages: Math.ceil(total / limit) }
}

export async function getMemory(id: string, companyId: string) {
  return prisma.aIMemory.findFirst({ where: { id, companyId } })
}

export async function deleteMemory(id: string, companyId: string) {
  const memory = await prisma.aIMemory.findFirst({ where: { id, companyId } })
  if (!memory) throw new Error('Memória não encontrada')
  return prisma.aIMemory.delete({ where: { id } })
}
