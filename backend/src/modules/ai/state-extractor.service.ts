/**
 * State Extractor — Camada 2 do "AI mais inteligente".
 *
 * Antes de chamar o LLM principal, este serviço roda um modelo barato
 * (gpt-4o-mini ou similar) que recebe:
 *   - O schema declarativo de variáveis do agente (stateSchema.variables)
 *   - O estado atual da sessão (AISession.variables)
 *   - As últimas N mensagens da conversa
 *
 * E devolve um JSON com **updates** das variáveis (somente as que mudaram
 * ou foram preenchidas pela última mensagem do usuário).
 *
 * O resultado é mergido em AISession.variables e injetado no system prompt
 * do LLM principal como camada `<conversation_state>`. Assim, o LLM principal
 * não precisa rastrear nada na cabeça — vê o estado pronto e só decide o
 * próximo passo do fluxo.
 *
 * Padrão inspirado em Dify Parameter Extractor + LangGraph state machine.
 */

import { prisma } from '../../config/database.js'
import { decryptProviderSecrets } from './ai.service.js'
import { createProvider } from './providers/index.js'
import type { AIMessage as ProviderMessage } from './providers/base.provider.js'

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export type StateVariableType = 'string' | 'number' | 'boolean' | 'enum'

export interface StateVariableDef {
  name: string                // ex: "produto_escolhido"
  type: StateVariableType
  description?: string        // descrição p/ ajudar a IA extrair
  values?: string[]           // se type=enum, valores permitidos
  example?: string | number | boolean
}

export interface StateSchemaConfig {
  enabled: boolean
  variables: StateVariableDef[]
  /** Modelo do extrator. Se não definido, usa o mesmo do agente. */
  extractorModel?: string
  /** Provider do extrator. Se não definido, usa o mesmo do agente. */
  extractorProviderId?: string
  /** Quantas mensagens recentes enviar ao extrator (default 6). */
  recentMessages?: number
}

export interface ExtractStateInput {
  agentId: string
  companyId: string
  sessionId: string
  /** Mensagem atual do usuário (já normalizada). */
  currentUserMessage: string
  /** Histórico recente já formatado (msgs role/content). */
  recentMessages: Array<{ role: string; content: string }>
}

export interface ExtractStateResult {
  /** Estado completo MERGED (já persistido em AISession.variables). */
  state: Record<string, any>
  /** Apenas o que mudou nesta extração. */
  updates: Record<string, any>
  /** Tokens consumidos pela extração (custo separado). */
  tokensUsed: number
  /** Latência ms da extração. */
  latencyMs: number
  /** Modelo usado na extração. */
  model: string
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function readSchema(agent: any): StateSchemaConfig | null {
  const raw = agent?.stateSchema
  if (!raw || typeof raw !== 'object') return null
  if (raw.enabled !== true) return null
  if (!Array.isArray(raw.variables) || raw.variables.length === 0) return null
  return raw as StateSchemaConfig
}

/** Schema serializado pra dar ao LLM. */
function describeSchema(schema: StateSchemaConfig): string {
  return schema.variables
    .map((v) => {
      const parts: string[] = [`- ${v.name} (${v.type})`]
      if (v.type === 'enum' && v.values?.length) {
        parts.push(`valores permitidos: ${v.values.map((x) => JSON.stringify(x)).join(', ')}`)
      }
      if (v.description) parts.push(`descrição: ${v.description}`)
      if (v.example !== undefined) parts.push(`exemplo: ${JSON.stringify(v.example)}`)
      return parts.join(' | ')
    })
    .join('\n')
}

/** Coerce/valida um valor extraído contra o schema. */
function coerceValue(v: StateVariableDef, raw: any): any {
  if (raw === null || raw === undefined) return null
  switch (v.type) {
    case 'string':
      return typeof raw === 'string' ? raw.trim() : String(raw).trim()
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      const s = String(raw).toLowerCase().trim()
      if (['true', 'sim', 's', 'yes', '1'].includes(s)) return true
      if (['false', 'nao', 'não', 'n', 'no', '0'].includes(s)) return false
      return null
    case 'enum': {
      const s = String(raw).trim()
      if (!v.values?.length) return s
      // Match case-insensitive primeiro
      const exact = v.values.find((x) => x === s)
      if (exact) return exact
      const ci = v.values.find((x) => x.toLowerCase() === s.toLowerCase())
      return ci ?? null
    }
    default:
      return raw
  }
}

// -----------------------------------------------------------------------------
// Função principal
// -----------------------------------------------------------------------------

/**
 * Extrai/atualiza o estado da conversa usando um LLM barato.
 * Se o agente não tem stateSchema configurado, retorna null (no-op).
 */
export async function extractConversationState(
  input: ExtractStateInput
): Promise<ExtractStateResult | null> {
  const agent = await prisma.aIAgent.findUnique({
    where: { id: input.agentId },
    include: { provider: true },
  })
  if (!agent) return null

  const schema = readSchema(agent)
  if (!schema) return null

  // Sessão atual (estado existente)
  const session = await prisma.aISession.findUnique({
    where: { id: input.sessionId },
    select: { variables: true },
  })
  const currentState = (session?.variables as Record<string, any> | null) || {}

  // Resolver provider do extrator
  let providerRow = agent.provider
  if (schema.extractorProviderId && schema.extractorProviderId !== agent.providerId) {
    const p = await prisma.aIProvider.findUnique({ where: { id: schema.extractorProviderId } })
    if (p) providerRow = p
  }
  const decrypted = decryptProviderSecrets(providerRow)
  const provider = createProvider(decrypted.type, decrypted.apiKey, decrypted.baseUrl, decrypted.oauthData)

  const model =
    schema.extractorModel ||
    agent.model ||
    providerRow.model ||
    'gpt-4o-mini'

  const schemaText = describeSchema(schema)
  const stateText = JSON.stringify(currentState, null, 2)
  const recentLimit = Math.max(2, Math.min(20, schema.recentMessages ?? 6))
  const recent = input.recentMessages.slice(-recentLimit)
  const recentText = recent
    .map((m) => `[${m.role}]: ${String(m.content).slice(0, 500)}`)
    .join('\n')

  const systemPrompt = `Você é um extrator de variáveis de estado de uma conversa de atendimento.

Sua tarefa: olhar a conversa e a última mensagem do usuário, e atualizar o estado JSON conforme o SCHEMA.

REGRAS DURAS:
1. Responda APENAS um objeto JSON válido. Nada de texto antes/depois, nada de markdown.
2. Inclua no JSON SOMENTE as variáveis que mudaram OU foram preenchidas com base na ÚLTIMA mensagem do usuário.
3. NUNCA invente valores. Se a informação não está clara/explícita na conversa, NÃO inclua a variável.
4. Para variáveis tipo enum, use EXATAMENTE um dos valores permitidos (case-sensitive).
5. Se o usuário NÃO está respondendo nada relevante (ex: "oi", "ok", "kkk"), responda {}.
6. Se a variável já tem valor no estado atual e a última mensagem não a contradiz, NÃO a inclua (não repita).
7. Se a última mensagem CONTRADIZ um valor existente (ex: cliente troca o nome do pet), inclua o novo valor.

SCHEMA:
${schemaText}

ESTADO ATUAL:
${stateText}`

  const userPrompt = `CONVERSA RECENTE:
${recentText}

ÚLTIMA MENSAGEM DO USUÁRIO:
${input.currentUserMessage}

Retorne o JSON com os updates (apenas variáveis que mudaram baseado na última mensagem):`

  const messages: ProviderMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const startedAt = Date.now()
  let extractedRaw: Record<string, any> = {}
  let tokensUsed = 0
  try {
    const result = await provider.chat({
      model,
      messages,
      temperature: 0,
      maxTokens: 400,
    })
    tokensUsed = result.tokensUsed || 0

    // Parse JSON com tolerância (modelos às vezes mandam markdown)
    let raw = (result.content || '').trim()
    // Strip code fences
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    }
    // Pega só o primeiro { ... } se vier prefixo/sufixo
    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      raw = raw.slice(firstBrace, lastBrace + 1)
    }
    if (raw) {
      try {
        extractedRaw = JSON.parse(raw)
        if (typeof extractedRaw !== 'object' || Array.isArray(extractedRaw) || extractedRaw === null) {
          extractedRaw = {}
        }
      } catch (parseErr) {
        console.warn('[StateExtractor] JSON parse failed:', (parseErr as Error).message, '| raw:', raw.slice(0, 200))
        extractedRaw = {}
      }
    }
  } catch (err) {
    console.warn('[StateExtractor] LLM call failed:', (err as Error).message)
    return null
  }
  const latencyMs = Date.now() - startedAt

  // Coerce + valida + filtra somente vars do schema
  const updates: Record<string, any> = {}
  for (const v of schema.variables) {
    if (!(v.name in extractedRaw)) continue
    const coerced = coerceValue(v, extractedRaw[v.name])
    if (coerced === null || coerced === undefined) continue
    // Não considera "update" se o valor é igual ao atual
    if (currentState[v.name] === coerced) continue
    updates[v.name] = coerced
  }

  // Merge no estado e persiste
  const merged = { ...currentState, ...updates }
  if (Object.keys(updates).length > 0) {
    await prisma.aISession.update({
      where: { id: input.sessionId },
      data: { variables: merged as any },
    })
    console.log(`[StateExtractor] updates(${Object.keys(updates).length}):`, JSON.stringify(updates), `| latency=${latencyMs}ms tokens=${tokensUsed} model=${model}`)
  } else {
    console.log(`[StateExtractor] no changes | latency=${latencyMs}ms tokens=${tokensUsed} model=${model}`)
  }

  return {
    state: merged,
    updates,
    tokensUsed,
    latencyMs,
    model,
  }
}

/**
 * Formata o estado pra injetar no system prompt do LLM principal.
 * Retorna string vazia se não há schema/estado.
 */
export function formatStateForPrompt(
  agent: any,
  state: Record<string, any> | null | undefined
): string {
  const schema = readSchema(agent)
  if (!schema) return ''
  const s = state || {}
  const lines: string[] = []
  for (const v of schema.variables) {
    const val = s[v.name]
    const display =
      val === null || val === undefined || val === ''
        ? 'null'
        : typeof val === 'string'
          ? val
          : JSON.stringify(val)
    lines.push(`${v.name}: ${display}`)
  }
  return `<conversation_state>
Estas são as variáveis de estado RASTREADAS AUTOMATICAMENTE da conversa.
Use-as como FONTE DA VERDADE — NÃO repita perguntas cujo valor já não é null.
Se uma variável é null, ela ainda precisa ser coletada.

${lines.join('\n')}
</conversation_state>`
}
