/**
 * Fleet Memory Service (Onda 2.2)
 *
 * Memória de longo prazo do FleetMember. Após cada operation COMPLETED,
 * extrai fatos/preferências/regras importantes da conversa e faz upsert
 * na tabela fleet_memory_entries. Antes de cada execução, top entries são
 * injetadas no system prompt como "=== O QUE VOCÊ JÁ SABE ===".
 *
 * Padrão "memory wiki" inspirado no EvoNexus.
 */

import { prisma } from '../../config/database.js'
import type { AIMessage } from '../ai/providers/base.provider.js'

const MAX_ENTRIES_PER_MEMBER = 200       // hard cap pra não inflar prompt
const MAX_ENTRIES_FOR_PROMPT = 20        // top N injetadas no system prompt
const MAX_VALUE_LEN = 400                 // limite por entry (chars)
const EXTRACTION_MAX_TOKENS = 600

interface MemoryDeps {
  provider: any
  model: string
}

export interface MemoryEntry {
  key: string
  value: string
  kind: 'fact' | 'preference' | 'rule' | 'entity'
}

/**
 * Busca as top N entries de memória pra injetar no system prompt.
 * Ordenadas por updatedAt desc (mais recentes primeiro).
 */
export async function getMemoryForPrompt(memberId: string): Promise<{ key: string; value: string }[]> {
  const entries = await prisma.fleetMemoryEntry.findMany({
    where: {
      memberId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: MAX_ENTRIES_FOR_PROMPT,
    select: { key: true, value: true },
  })
  return entries
}

/**
 * Extrai fatos importantes do transcript de uma operation completa
 * e faz upsert na tabela. Roda em background (sem bloquear o response).
 *
 * Boas práticas:
 * - Só extrai se a conversa teve substância (>= 4 mensagens trocadas)
 * - Limita o tamanho do transcript enviado pro LLM (custo)
 * - Idempotent: usa upsert por key
 */
export async function extractAndStoreMemory(params: {
  memberId: string
  companyId: string
  chatId?: string
  operationId: string
  messages: AIMessage[]
  deps: MemoryDeps
}): Promise<void> {
  const { memberId, operationId, messages, deps } = params

  // Filtra só user/assistant — system/tool são ruído pra extração
  const meaningful = messages.filter(m => m.role === 'user' || m.role === 'assistant')
  if (meaningful.length < 4) return

  // Concat do transcript (cap em ~12k chars)
  const transcript = meaningful
    .map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n')
    .slice(0, 12_000)

  const extractionPrompt = `Você é um EXTRATOR DE MEMÓRIA para um agente de IA do CRM. Sua tarefa é ler o transcript de uma conversa entre o administrador e o agente, e extrair APENAS fatos/preferências/regras DURÁVEIS — coisas que o agente deveria lembrar em conversas FUTURAS.

REGRAS:
1. NÃO extraia nada efêmero (status de uma tarefa pontual, mensagem específica enviada agora). Só extraia se a informação será útil DAQUI A SEMANAS.
2. Categorias válidas (kind):
   - "fact": fatos sobre a empresa/admin/clientes ("o admin é o João, sócio da IMPA", "a empresa usa Asaas pra cobrança")
   - "preference": preferências de tom/estilo/comportamento ("admin prefere mensagens curtas sem emoji", "sempre confirmar antes de envios em massa")
   - "rule": regras de negócio explícitas ("não enviar mensagens depois das 22h", "leads do Instagram vão pro pipeline X")
   - "entity": pessoas/empresas/produtos importantes recorrentes ("Rafa = Rafael Silva, telefone X, é o sócio comercial")
3. KEY deve ser um identificador estável e descritivo (ex: "admin.name", "preference.tone", "rule.no_late_messages", "entity.rafa").
4. VALUE conciso (max 400 chars).
5. NÃO INVENTE. Se não há fato durável claro, retorne array vazio.
6. NÃO duplique o que já é óbvio do papel do agente.

Retorne APENAS um JSON válido com este formato (sem markdown, sem comentários):

{"entries": [{"kind": "fact", "key": "admin.name", "value": "João, sócio da IMPA"}, ...]}

Se não houver nada relevante, retorne: {"entries": []}

Transcript:
---
${transcript}
---

JSON:`

  let raw = ''
  try {
    const result = await deps.provider.chat({
      model: deps.model,
      messages: [{ role: 'user' as const, content: extractionPrompt }],
      maxTokens: EXTRACTION_MAX_TOKENS,
      temperature: 0.1, // queremos consistência
    })
    raw = (result.content || '').trim()
  } catch (e: any) {
    console.warn('[Fleet memory] extract LLM falhou:', e.message)
    return
  }

  // Limpa fences se o modelo insistir em colocar
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  let parsed: { entries?: MemoryEntry[] }
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Tenta achar o primeiro { ... } válido
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      console.warn('[Fleet memory] resposta não-JSON do extrator:', raw.slice(0, 200))
      return
    }
    try {
      parsed = JSON.parse(match[0])
    } catch (e: any) {
      console.warn('[Fleet memory] JSON inválido do extrator:', e.message)
      return
    }
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  if (entries.length === 0) return

  // Valida e faz upsert em batch
  const validKinds = new Set(['fact', 'preference', 'rule', 'entity'])
  const valid = entries.filter(e =>
    e && typeof e.key === 'string' && e.key.length > 0 && e.key.length < 100 &&
    typeof e.value === 'string' && e.value.length > 0 &&
    validKinds.has(e.kind)
  )

  if (valid.length === 0) return

  for (const entry of valid) {
    try {
      await prisma.fleetMemoryEntry.upsert({
        where: { memberId_scope_key: { memberId, scope: 'member', key: entry.key } },
        create: {
          memberId,
          scope: 'member',
          kind: entry.kind,
          key: entry.key,
          value: entry.value.slice(0, MAX_VALUE_LEN),
          source: operationId,
        },
        update: {
          value: entry.value.slice(0, MAX_VALUE_LEN),
          kind: entry.kind,
          source: operationId,
          // confidence cresce levemente quando o mesmo fato re-aparece
          confidence: { increment: 0.05 },
        },
      })
    } catch (e: any) {
      console.warn(`[Fleet memory] upsert falhou para key=${entry.key}:`, e.message)
    }
  }

  // Limpeza: se passou do cap, remove os menos confiáveis/antigos
  const count = await prisma.fleetMemoryEntry.count({ where: { memberId } })
  if (count > MAX_ENTRIES_PER_MEMBER) {
    const toDelete = await prisma.fleetMemoryEntry.findMany({
      where: { memberId },
      orderBy: [{ confidence: 'asc' }, { updatedAt: 'asc' }],
      take: count - MAX_ENTRIES_PER_MEMBER,
      select: { id: true },
    })
    if (toDelete.length > 0) {
      await prisma.fleetMemoryEntry.deleteMany({
        where: { id: { in: toDelete.map(e => e.id) } },
      }).catch(() => {})
    }
  }

  console.log(`[Fleet memory] Salvou ${valid.length} entries para member=${memberId} (op=${operationId})`)
}
