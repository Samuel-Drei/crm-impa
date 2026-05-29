/**
 * Fleet Service — IMPA Fleet (funcionários AI 100% internos do CRM)
 *
 * IMPORTANTE: Fleet é INDEPENDENTE de AIAgent.
 *   - AIAgent = bot de WhatsApp (responde clientes)
 *   - FleetMember = funcionário interno (executa tarefas no CRM, conversa com admin)
 *
 * Cada FleetMember tem cérebro próprio: provider + model + systemPrompt + tools.
 * O único compartilhamento é o AIProvider (credenciais já cadastradas).
 */

import { prisma } from '../../config/database.js'
import { createProvider } from '../ai/providers/index.js'
import type { AIMessage, AICompletionResult, IAIProvider } from '../ai/providers/base.provider.js'
import { ToolEngine, toolRegistry } from '../ai/tools/index.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from '../ai/ai.service.js'
import { DEFAULT_CRON_TIMEZONE, tryHeuristicCron, isValidCron, getNextRunAt, parseDateTimeInTimeZone } from './cron-nlp.service.js'
import { getMemoryForPrompt, extractAndStoreMemory } from './fleet-memory.service.js'

const MAX_TOOL_ITERATIONS = 25
const MAX_HISTORY_MESSAGES = 30

// Concorrência de tool execution (Onda 1.1 — paralelização)
// Read-only tools rodam em paralelo (até MAX_PARALLEL_READS simultâneas).
// Write tools rodam serialmente para evitar race conditions.
const MAX_PARALLEL_READS = 6

// Critic turn (Onda 1.4 — auto-reflexão para quebrar loops cegos)
// A cada N iterações sem resposta final, injeta uma user message sintética
// pedindo que o agente reflita: "está no caminho certo? falta o quê?"
const CRITIC_TURN_EVERY = 6

// Budget guards (Onda 1.5 — proteção contra runaway)
// Defaults globais; podem ser sobrescritos por membro no futuro (campo no schema).
const DEFAULT_MAX_TOKENS_PER_OP = 60_000
const DEFAULT_MAX_TOOL_CALLS_PER_OP = 40
const MAX_IDENTICAL_READ_REPEATS = 2

// Tools READ-ONLY do fleet_admin — paralelizáveis com segurança.
// Qualquer tool não listada aqui é tratada como WRITE (serial).
const FLEET_READ_ONLY_TOOLS = new Set<string>([
  'list_contacts',
  'list_conversations',
  'list_pipelines',
  'list_kanban_cards',
  'list_users',
  'list_teams_admin',
  'list_tickets',
  'list_instances',
  'list_products',
  'list_my_missions',
  'list_fleet_members',   // Onda 2.4 — read-only discovery
  'list_recent_messages',
  'search_messages',
  'get_conversation_messages',
  'get_dashboard_metrics',
  'think', // sem side-effect: só registra reasoning
])

const CONVERSATION_READ_TOOLS = new Set<string>([
  'list_conversations',
  'search_messages',
  'get_conversation_messages',
  'list_recent_messages',
])

const READ_ANALYSIS_REQUEST_REGEX = /\b(analisa(?:r)?|an[aá]lise|detalha(?:r)?|detalhado|identifica(?:r)?|resuma|resumo|o\s*que|oque|quais|precisa|alterar|corrigir|faltou|falta(?:ndo)?|pendente|pedido|solicitou|formato)\b/i
const TOOL_ONLY_COMPLETION_REGEX = /\b(pronto|feito|conclu[ií]|conclu[ií]d[oa]?|executei|consultei|busquei|puxei|li)\b/i
const MAX_FINAL_REPAIR_TOOL_CONTEXT_CHARS = 45_000

// Identificadores virtuais para o ToolExecutionContext (Fleet não tem WhatsApp)
const FLEET_VIRTUAL_INSTANCE_ID = '__fleet__'
const FLEET_VIRTUAL_REMOTE_JID = '__fleet_admin__'

// ──────────────────────────────────────────────────────────────────────
// Default tools config (todas as fleet_admin habilitadas)
// ──────────────────────────────────────────────────────────────────────

export const DEFAULT_FLEET_TOOLS_CONFIG = {
  fleet_admin: {
    enabledTools: [
      'configure_self',
      // Contatos & Leads
      'list_contacts', 'create_lead', 'update_contact_admin',
      // Conversas
      'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
      // Kanban / Pipeline
      'list_pipelines', 'list_kanban_cards', 'create_kanban_card', 'move_kanban_card',
      // Time & Permissões
      'list_users', 'list_teams_admin', 'notify_user',
      // Tickets
      'create_ticket', 'list_tickets',
      // Dashboard
      'get_dashboard_metrics',
      // WhatsApp / Instâncias
      'list_instances', 'send_whatsapp_message',
      // Catálogo
      'list_products', 'create_product',
      // Auto-agendamento (missões)
      'list_my_missions', 'create_mission',
      // Delegação (spawn_subagent — Onda 2.4)
      'list_fleet_members', 'spawn_subagent',
      // Raciocínio (Think Tool)
      'think',
      // Plano de tarefas (TodoWrite)
      'update_todos',
    ],
  },
}

// Mensagem inicial gerada automáticamente quando admin abre primeiro chat com membro não-onboardado
function generateOnboardingGreeting(member: { name: string; displayRole: string }): string {
  return `Olá! 👋 Eu sou **${member.name}**, e fui adicionado(a) como **${member.displayRole}** aqui no CRM.

Antes de começarmos a trabalhar juntos, preciso entender como você quer que eu atue. Me conta:

1. **O que devo fazer no dia a dia?** (Ex: qualificar leads, gerar relatórios, organizar funil, responder dúvidas internas...)
2. **Qual tom você prefere?** (Formal, descontraído, técnico, objetivo...)
3. **Tem alguma regra ou restrição importante?** (Ex: "nunca deletar nada", "sempre pedir confirmação", "focar só em leads do funil X"...)
4. **Algum exemplo de tarefa típica** que eu vou receber?

Pode escrever do jeito que vier à cabeça — eu vou montando minha própria configuração conforme conversamos. Quando estiver tudo certo, eu mesmo encerro o setup e aí começamos a operar normalmente. 🚀`
}

// ──────────────────────────────────────────────────────────────────────
// Runner próprio (sem agent-builder)
// ──────────────────────────────────────────────────────────────────────

interface FleetRunInput {
  memberId: string
  instruction: string
  trigger: 'CHAT' | 'MANUAL' | 'SCHEDULED'
  operationId?: string
  chatId?: string
  missionId?: string
  history?: AIMessage[]
  thinkingMode?: boolean
  approvalGranted?: boolean
  /**
   * Quando definido, cada bloco de texto que o LLM produzir durante o loop
   * (entre tool calls) será emitido como uma FleetMessage separada.
   * Comportamento estilo OpenClaude/OpenClaw/Hermes: o agente envia várias
   * bolhas em sequência ao longo da execução, em vez de uma resposta gigante.
   *
   * Retorna o id da mensagem persistida.
   */
  onAssistantBubble?: (params: { content: string; sequence: number }) => Promise<string | null>
  /** Quando definido, cada execução real de tool vira uma FleetMessage role=TOOL. */
  onToolMessage?: (params: {
    content: string
    toolName: string
    toolInput: Record<string, any>
    toolOutput: any
    toolSuccess: boolean
    durationMs: number
  }) => Promise<string | null>
  /** Chamado assim que a FleetOperation é criada (antes do loop começar). */
  opIdResolver?: (id: string) => void
  /** Onda 2.4 — rastreamento de sub-operações */
  parentOperationId?: string
  depth?: number
}

interface FleetRunOutput {
  operationId: string
  output: string
  tokensUsed: number
  promptTokens: number
  completionTokens: number
  durationMs: number
  status: 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'REJECTED'
  error?: string
}

// Onda 2.1 — Context Compaction (estilo OpenClaw)
// Quando a conversa fica longa, em vez de cortar mensagens antigas,
// resumimos elas em UMA system message preservando IDs/JIDs/números/decisões.
// As últimas KEEP_RECENT mensagens ficam intactas para preservar contexto fino.
const COMPACTION_THRESHOLD = 60   // a partir de quantas mensagens compactar
const KEEP_RECENT = 20            // últimas N mensagens preservadas íntegras
const COMPACTION_MAX_TOKENS = 800 // limite do resumo gerado

interface CompactionDeps {
  provider: any
  model: string
}

interface FleetExecutedTool {
  toolName: string
  toolInput: Record<string, any>
  toolOutput: any
  rawOutput: string
  toolSuccess: boolean
  durationMs: number
}

interface FleetRuntimeToolSnapshot {
  toolName: string
  toolSuccess: boolean
  durationMs: number
  summary: string
}

const CLEAR_ACTION_REQUEST_REGEX = /\b(pode|manda(?:r)?|mande|envia(?:r)?|envie|executa(?:r)?|execute|faz(?:er)?|faça|prossiga|vai|lista(?:r)?|liste|busca(?:r)?|busque|procura(?:r)?|procure|cria(?:r)?|crie|atualiza(?:r)?|atualize|move(?:r)?|mova|abre|abra|notifica(?:r)?|notifique|agenda(?:r)?|agende|responde(?:r)?|responda)\b/i
const MUTATING_ACTION_REQUEST_REGEX = /\b(manda(?:r)?|mande|envia(?:r)?|envie|executa(?:r)?|execute|faz(?:er)?|faça|prossiga|cria(?:r)?|crie|atualiza(?:r)?|atualize|move(?:r)?|mova|abre|abra|notifica(?:r)?|notifique|agenda(?:r)?|agende|cadastra(?:r)?|cadastre|apaga(?:r)?|apague|deleta(?:r)?|delete)\b/i
const NON_OPERATIONAL_USER_REGEX = /^(oi|olá|ola|e ai|ei|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|quem é você|quem e voce|o que você faz|o que voce faz)\b/i
const EMPTY_PROGRESS_BUBBLE_REGEX = /^(?:(?:ok|okay|certo|beleza|perfeito|claro|entendi|sim)[,!.:\s-]*)?(?:(?:eu\s+)?vou|deixa(?:\s+eu|\-me)?|já\s+vou)\b[\s\S]{0,120}\b(?:já\s+(?:confirmo|te\s+confirmo|te\s+aviso|retorno|volto)|um\s+instante|aguarde|rapidinho|já\s+vejo|já\s+verifico|já\s+confiro)\b/i
const SUCCESS_CONFIRMATION_REGEX = /\b(pronto|feito|conclu[ií]d[oa]?|enviei|mandei|criei|cadastrei|atualizei|agendei|movi|abri|notifiquei|deleguei|executei|resolvi)\b/i
const FAILURE_DISCLOSURE_REGEX = /\b(falhou|falha|não consegui|nao consegui|não foi possível|nao foi possivel|erro)\b/i

/**
 * Compacta uma janela de mensagens em um único system summary.
 * Preserva: IDs (ULID/UUID), telefones, JIDs WhatsApp, decisões, próximo passo.
 */
async function compactMessages(messages: AIMessage[], deps: CompactionDeps): Promise<string> {
  const transcript = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}] ${m.content || ''}`)
    .join('\n\n')
    .slice(0, 30_000) // hard cap de input pra não estourar nada

  const compactionPrompt = `Você é um compactador de histórico de conversa entre um administrador e um agente de IA do CRM.

Compacte o transcript abaixo em UM resumo conciso (máximo 15 linhas). REGRAS:

1. PRESERVE LITERALMENTE: IDs (UUIDs, números longos), telefones (com formato), JIDs WhatsApp (terminados em @s.whatsapp.net ou @g.us), nomes de contatos, IDs de cards/tickets/instâncias mencionados.
2. RESUMA: o que foi pedido, o que foi feito, decisões tomadas, o que ficou pendente.
3. NÃO INVENTE informação. Se não tem certeza, omita.
4. NÃO ESCREVA NARRAÇÃO ("o admin perguntou...", "o agente respondeu..."). Use bullets diretos.
5. Se houve correção/erro, registre o resultado FINAL.
6. Termine com uma linha "PRÓXIMO PASSO ESPERADO: ..." se for óbvio pelo contexto.

Transcript:
---
${transcript}
---

Resumo:`

  try {
    const result = await deps.provider.chat({
      model: deps.model,
      messages: [{ role: 'user' as const, content: compactionPrompt }],
      maxTokens: COMPACTION_MAX_TOKENS,
      temperature: 0.2, // baixa, queremos fidelidade
    })
    return (result.content || '').trim() || '[Compactação retornou vazia — histórico antigo não disponível.]'
  } catch (e: any) {
    console.warn('[Fleet compaction] falhou:', e.message)
    return `[Compactação falhou: ${e.message?.slice(0, 200)}. Histórico antigo não disponível.]`
  }
}

async function buildHistory(chatId: string, deps?: CompactionDeps): Promise<AIMessage[]> {
  // Busca TODAS as mensagens (sem limite). Se for menor que threshold, retorna direto.
  const msgs = await prisma.fleetMessage.findMany({
    where: { chatId, role: { in: ['USER', 'ASSISTANT'] } },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })

  const all: AIMessage[] = msgs.map(m => ({
    role: m.role === 'ASSISTANT' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }))

  // Sem compactação necessária
  if (all.length <= COMPACTION_THRESHOLD || !deps) {
    // Mantém comportamento antigo se for curto OU se não temos provider pra compactar
    return all.slice(-MAX_HISTORY_MESSAGES)
  }

  // Compacta tudo menos os últimos KEEP_RECENT
  const toCompact = all.slice(0, -KEEP_RECENT)
  const recent = all.slice(-KEEP_RECENT)
  const summary = await compactMessages(toCompact, deps)

  console.log(`[Fleet] Compactou ${toCompact.length} mensagens em ${summary.length} chars (chatId=${chatId})`)

  // Retorna: 1 system msg com resumo + últimas KEEP_RECENT íntegras
  return [
    { role: 'system' as any, content: `=== RESUMO DAS MENSAGENS ANTERIORES ===\n\n${summary}\n\n=== FIM DO RESUMO — abaixo seguem as últimas ${recent.length} mensagens completas ===` },
    ...recent,
  ]
}

function parseToolOutput(raw: string): any {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toJsonSafe(value: any): any {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value, (_key, current) =>
      typeof current === 'bigint' ? current.toString() : current,
    ))
  } catch {
    return typeof value === 'string' ? value : String(value)
  }
}

function normalizeForMatch(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
}

function outputArrayCount(output: any, key: string): number {
  const value = output && typeof output === 'object' ? output[key] : null
  return Array.isArray(value) ? value.length : 0
}

function hasConversationReadData(event: Pick<FleetExecutedTool, 'toolName' | 'toolOutput' | 'toolSuccess'>): boolean {
  if (!event.toolSuccess || !CONVERSATION_READ_TOOLS.has(event.toolName)) return false
  const output = event.toolOutput
  if (!output || typeof output !== 'object') return false

  if (event.toolName === 'list_conversations') return outputArrayCount(output, 'conversations') > 0
  if (event.toolName === 'get_conversation_messages') return outputArrayCount(output, 'messages') > 0 || !!output.conversation?.id
  if (event.toolName === 'search_messages' || event.toolName === 'list_recent_messages') return outputArrayCount(output, 'messages') > 0
  return false
}

function hasSuccessfulConversationRead(events: FleetExecutedTool[]): boolean {
  return events.some(event => hasConversationReadData(event))
}

function isToolOnlyCompletionReply(reply: string, events: FleetExecutedTool[]): boolean {
  const trimmed = (reply || '').trim()
  if (!trimmed) return false
  if (trimmed.length > 260 || trimmed.split(/\r?\n/).length > 3) return false

  const normalized = normalizeForMatch(trimmed)
  if (!TOOL_ONLY_COMPLETION_REGEX.test(normalized)) return false

  const mentionsReadTool = events.some(event =>
    CONVERSATION_READ_TOOLS.has(event.toolName) && normalized.includes(event.toolName.replace(/_/g, ' ')),
  )
  const mentionsProcessOnly = /\b(get conversation messages|search messages|list conversations|list recent messages|ferramenta|tool|transcript|historico|leitura|consulta|mensagens)\b/.test(normalized)
  const hasAnswerShape = /[:\n-]|\b(precisa\s+(alterar|corrigir|incluir|remover)|ficou\s+faltando|foi\s+pedido|solicitou|pendente)\b/.test(normalized)

  return (mentionsReadTool || mentionsProcessOnly) && !hasAnswerShape
}

function compactToolOutputForFinalReply(event: FleetExecutedTool): any {
  const output = event.toolOutput
  if (!CONVERSATION_READ_TOOLS.has(event.toolName) || !output || typeof output !== 'object') return toJsonSafe(output)

  if (event.toolName === 'get_conversation_messages') {
    const messages = Array.isArray(output.messages) ? output.messages : []
    return toJsonSafe({
      conversation: output.conversation,
      pagination: output.pagination,
      messages: messages.map((message: any) => ({
        at: message.createdAt,
        from: message.from,
        direction: message.direction,
        type: message.type,
        content: message.content,
        mediaUrl: message.mediaUrl,
      })),
    })
  }

  if (event.toolName === 'search_messages' || event.toolName === 'list_recent_messages') {
    const messages = Array.isArray(output.messages) ? output.messages : []
    return toJsonSafe({
      ...output,
      messages: messages.map((message: any) => ({
        at: message.createdAt,
        from: message.from || message.conversation?.contact?.name || message.contactName,
        direction: message.direction,
        conversationId: message.conversationId || message.conversation?.id,
        remoteJid: message.remoteJid || message.conversation?.remoteJid,
        content: message.content,
      })),
    })
  }

  return toJsonSafe(output)
}

function buildToolContextForFinalReply(events: FleetExecutedTool[]): string {
  const relevant = events
    .filter(event => event.toolName !== 'think' && event.toolName !== 'update_todos')
    .slice(-10)

  const blocks = relevant.map((event, index) => {
    const output = compactToolOutputForFinalReply(event)
    return [
      `TOOL ${index + 1}: ${event.toolName}`,
      `INPUT: ${JSON.stringify(toJsonSafe(event.toolInput))}`,
      `SUCCESS: ${event.toolSuccess}`,
      `OUTPUT: ${JSON.stringify(output, null, 2)}`,
    ].join('\n')
  })

  const context = blocks.join('\n\n---\n\n')
  if (context.length <= MAX_FINAL_REPAIR_TOOL_CONTEXT_CHARS) return context
  return `${context.slice(0, MAX_FINAL_REPAIR_TOOL_CONTEXT_CHARS)}\n\n[contexto truncado por limite interno]`
}

function resolveToolSuccess(output: any): boolean {
  if (output && typeof output === 'object' && typeof output.success === 'boolean') {
    return output.success
  }
  if (output && typeof output === 'object' && output.error) {
    return false
  }
  return true
}

function shouldForceToolCalls(params: {
  instruction: string
  onboarded: boolean
  tools: Array<{ name: string }>
}): boolean {
  const trimmed = params.instruction.trim()
  if (!params.onboarded || !trimmed) return false
  if (NON_OPERATIONAL_USER_REGEX.test(trimmed)) return false

  const hasOperationalTool = params.tools.some(tool => !['configure_self', 'think', 'update_todos'].includes(tool.name))
  if (!hasOperationalTool) return false

  return CLEAR_ACTION_REQUEST_REGEX.test(trimmed)
}

function shouldForcePlanningPass(params: {
  instruction: string
  onboarded: boolean
  tools: Array<{ name: string }>
}): boolean {
  const trimmed = params.instruction.trim()
  if (!params.onboarded || !trimmed) return false
  if (NON_OPERATIONAL_USER_REGEX.test(trimmed)) return false
  if (!params.tools.some(tool => tool.name === 'think')) return false
  if (!MUTATING_ACTION_REQUEST_REGEX.test(trimmed)) return false

  return trimmed.length > 120
    || /\b(depois|antes|ent[aã]o|mas|se|quando|amanh[aã]|hoje|todo dia|diariamente|segunda|terça|terca|quarta|quinta|sexta|s[aá]bado|sabado|domingo)\b/i.test(trimmed)
    || /[\n,;:]/.test(trimmed)
}

function shouldSuppressToolPreface(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (trimmed.length > 140) return false
  if (trimmed.split(/\r?\n/).length > 3) return false
  return EMPTY_PROGRESS_BUBBLE_REGEX.test(trimmed)
}

function summarizeToolEvent(event: Pick<FleetExecutedTool, 'toolName' | 'toolOutput' | 'toolSuccess'>): string {
  const output = event.toolOutput
  const failureMessage = output?.message || output?.error || `Falha em ${event.toolName}.`

  switch (event.toolName) {
    case 'create_mission': {
      if (!event.toolSuccess) return `Falha ao criar missão: ${failureMessage}`
      const title = output?.mission?.title
      return title ? `Missão "${title}" criada.` : 'Missão criada.'
    }
    case 'create_product': {
      if (!event.toolSuccess) return `Falha ao criar produto: ${failureMessage}`
      const name = output?.item?.name
      return name ? `Produto "${name}" criado.` : 'Produto criado.'
    }
    case 'send_whatsapp_message': {
      if (!event.toolSuccess) return `Falha no envio de WhatsApp: ${failureMessage}`
      const destination = output?.to || output?.data?.to
      return destination ? `WhatsApp enviado para ${destination}.` : 'WhatsApp enviado.'
    }
    case 'update_todos':
      return event.toolSuccess ? 'Plano de tarefas atualizado.' : `Falha ao atualizar plano: ${failureMessage}`
    case 'spawn_subagent': {
      if (!event.toolSuccess) return `Falha ao delegar subtarefa: ${failureMessage}`
      const targetName = event.toolOutput?.targetMember?.name || event.toolOutput?.targetMemberName || event.toolOutput?.targetMemberId
      const status = event.toolOutput?.status
      return targetName
        ? `Subtarefa delegada para ${targetName}${status ? ` (${status})` : ''}.`
        : 'Subtarefa delegada para outro membro da Fleet.'
    }
    case 'list_fleet_members':
      return event.toolSuccess ? 'Consultei os membros disponíveis da Fleet.' : `Falha ao listar membros da Fleet: ${failureMessage}`
    case 'list_conversations': {
      if (!event.toolSuccess) return `Falha ao listar conversas: ${failureMessage}`
      const total = outputArrayCount(output, 'conversations')
      return total === 1 ? 'Encontrei 1 conversa.' : `Encontrei ${total} conversas.`
    }
    case 'search_messages': {
      if (!event.toolSuccess) return `Falha ao buscar mensagens: ${failureMessage}`
      const total = outputArrayCount(output, 'messages')
      return total === 1 ? 'Encontrei 1 mensagem.' : `Encontrei ${total} mensagens.`
    }
    case 'get_conversation_messages': {
      if (!event.toolSuccess) return `Falha ao ler conversa: ${failureMessage}`
      const total = outputArrayCount(output, 'messages')
      const contactName = output?.conversation?.contactName || output?.conversation?.remoteJid || 'conversa'
      return total === 1 ? `Li 1 mensagem de ${contactName}.` : `Li ${total} mensagens de ${contactName}.`
    }
    case 'list_recent_messages': {
      if (!event.toolSuccess) return `Falha ao listar mensagens recentes: ${failureMessage}`
      const total = outputArrayCount(output, 'messages')
      return total === 1 ? 'Li 1 mensagem recente.' : `Li ${total} mensagens recentes.`
    }
    case 'think':
      return 'Pensamento registrado.'
    default: {
      const label = event.toolName.replace(/_/g, ' ')
      return event.toolSuccess ? `${label} executada.` : failureMessage
    }
  }
}

function buildFallbackReplyFromTools(events: FleetExecutedTool[]): string {
  if (events.length === 0) return ''

  const relevant = [...events].reverse().find(event => event.toolName !== 'think' && event.toolName !== 'update_todos')
  if (!relevant) {
    const todosUpdated = events.some(event => event.toolName === 'update_todos' && event.toolSuccess)
    return todosUpdated ? 'Atualizei o plano de tarefas acima.' : ''
  }

  if (relevant.toolName === 'send_whatsapp_message') {
    const destination = String(relevant.toolOutput?.to || relevant.toolOutput?.data?.to || '').trim()
    const instanceName = relevant.toolOutput?.instance?.name || relevant.toolOutput?.data?.instance?.name
    const cleanedDestination = destination
      .replace('@s.whatsapp.net', '')
      .replace('@g.us', '')

    if (relevant.toolSuccess) {
      const destinationLabel = cleanedDestination || 'destino informado'
      return instanceName
        ? `Pronto. Enviei a mensagem para ${destinationLabel} via ${instanceName}.`
        : `Pronto. Enviei a mensagem para ${destinationLabel}.`
    }

    const failureMessage = relevant.toolOutput?.message || relevant.toolOutput?.error || 'erro desconhecido'
    return `Tentei enviar a mensagem, mas falhou: ${failureMessage}.`
  }

  if (relevant.toolName === 'create_mission') {
    const title = String(relevant.toolOutput?.mission?.title || relevant.toolInput?.title || '').trim()
    if (relevant.toolSuccess) {
      return title ? `Pronto. Criei a missão "${title}".` : 'Pronto. Criei a missão.'
    }
    const failureMessage = relevant.toolOutput?.message || relevant.toolOutput?.error || 'erro desconhecido'
    return `Tentei criar a missão, mas falhou: ${failureMessage}.`
  }

  if (relevant.toolName === 'create_product') {
    const name = String(relevant.toolOutput?.item?.name || relevant.toolInput?.name || '').trim()
    if (relevant.toolSuccess) {
      return name ? `Pronto. Criei o produto "${name}".` : 'Pronto. Criei o produto.'
    }
    const failureMessage = relevant.toolOutput?.message || relevant.toolOutput?.error || 'erro desconhecido'
    return `Tentei criar o produto, mas falhou: ${failureMessage}.`
  }

  if (CONVERSATION_READ_TOOLS.has(relevant.toolName)) {
    return summarizeToolEvent(relevant)
  }

  const label = relevant.toolName.replace(/_/g, ' ')
  if (relevant.toolSuccess) {
    return `Pronto. Concluí ${label}.`
  }

  const failureMessage = relevant.toolOutput?.message || relevant.toolOutput?.error || 'erro desconhecido'
  return `Tentei executar ${label}, mas falhou: ${failureMessage}.`
}

function normalizeExecutedTools(raw: any): FleetExecutedTool[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object')
    .map(item => ({
      toolName: typeof item.toolName === 'string' ? item.toolName : 'tool',
      toolInput: item.toolInput && typeof item.toolInput === 'object' ? item.toolInput : {},
      toolOutput: item.toolOutput ?? null,
      rawOutput: typeof item.rawOutput === 'string' ? item.rawOutput : '',
      toolSuccess: item.toolSuccess !== false,
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
    }))
}

function buildRuntimeToolSnapshots(events: FleetExecutedTool[]): FleetRuntimeToolSnapshot[] {
  return events.slice(-3).map(event => ({
    toolName: event.toolName,
    toolSuccess: event.toolSuccess,
    durationMs: event.durationMs,
    summary: summarizeToolEvent(event),
  }))
}

function isMutatingToolName(toolName: string): boolean {
  return !FLEET_READ_ONLY_TOOLS.has(toolName) && toolName !== 'think' && toolName !== 'update_todos'
}

function stableToolArgsSignature(value: any): string {
  if (value == null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableToolArgsSignature).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${key}:${stableToolArgsSignature(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function buildToolCallSignature(toolName: string, toolInput: Record<string, any>): string {
  return `${toolName}:${stableToolArgsSignature(toolInput || {})}`
}

function buildRepeatedReadToolError(toolName: string): string {
  const guidance = toolName === 'search_messages' || toolName === 'list_conversations'
    ? 'Você repetiu a mesma leitura. Se já achou a conversa, use get_conversation_messages. Se não achou, mude os argumentos de busca. Agora responda com o que já descobriu ou explique objetivamente o dado que falta.'
    : 'Você repetiu a mesma leitura idêntica. Mude os argumentos, use outra ferramenta ou responda com o que já descobriu.'

  return JSON.stringify({
    success: false,
    error: 'repeat_read_loop',
    message: guidance,
  })
}

function shouldBlockRepeatedReadTool(params: {
  toolName: string
  toolInput: Record<string, any>
  executedTools: FleetExecutedTool[]
}): boolean {
  if (!FLEET_READ_ONLY_TOOLS.has(params.toolName) || params.toolName === 'think') return false

  const currentSignature = buildToolCallSignature(params.toolName, params.toolInput)
  const previousCount = params.executedTools.filter(event =>
    FLEET_READ_ONLY_TOOLS.has(event.toolName) &&
    event.toolName !== 'think' &&
    buildToolCallSignature(event.toolName, event.toolInput) === currentSignature,
  ).length

  return previousCount >= MAX_IDENTICAL_READ_REPEATS
}

function hasToolEvidence(event: FleetExecutedTool): boolean {
  if (!event.toolSuccess) return false

  switch (event.toolName) {
    case 'send_whatsapp_message':
      return !!String(event.toolOutput?.to || event.toolOutput?.data?.to || '').trim()
    case 'create_mission':
      return !!event.toolOutput?.mission?.id
    case 'create_product':
      return !!(event.toolOutput?.item?.id || event.toolOutput?.item?.slug)
    case 'create_lead':
    case 'update_contact_admin':
      return !!event.toolOutput?.contact?.id
    case 'create_ticket':
      return !!event.toolOutput?.ticket?.id
    case 'create_kanban_card':
      return !!(event.toolOutput?.card?.id || event.toolOutput?.item?.id)
    case 'move_kanban_card':
      return !!(event.toolOutput?.card?.id || event.toolOutput?.cardId || event.toolOutput?.moved === true)
    case 'notify_user':
      return !!(event.toolOutput?.notification?.id || event.toolOutput?.notified === true || event.toolOutput?.userId)
    case 'spawn_subagent':
      return !!(event.toolOutput?.operationId || event.toolOutput?.targetMemberId)
    case 'list_conversations':
    case 'search_messages':
    case 'get_conversation_messages':
    case 'list_recent_messages':
      return hasConversationReadData(event)
    default:
      return event.toolSuccess
  }
}

function lowerFirst(text: string): string {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
}

function buildVerifiedReplyFromTools(events: FleetExecutedTool[]): string {
  const relevant = events.filter(event => event.toolName !== 'think' && event.toolName !== 'update_todos')
  if (relevant.length === 0) return buildFallbackReplyFromTools(events)

  const successful = relevant.filter(event => event.toolSuccess && hasToolEvidence(event))
  const failed = relevant.filter(event => !event.toolSuccess)
  const latestSuccess = successful[successful.length - 1]
  const latestFailure = failed[failed.length - 1]

  if (latestSuccess && latestFailure) {
    const successReply = buildFallbackReplyFromTools([latestSuccess]) || summarizeToolEvent(latestSuccess)
    const failureReply = summarizeToolEvent(latestFailure)
    const normalizedSuccess = successReply.trim().replace(/[.!?]+$/, '')
    return `${normalizedSuccess}. Mas ${lowerFirst(failureReply)}`
  }

  if (latestSuccess) {
    return buildFallbackReplyFromTools([latestSuccess]) || summarizeToolEvent(latestSuccess)
  }

  if (latestFailure) {
    return buildFallbackReplyFromTools([latestFailure]) || summarizeToolEvent(latestFailure)
  }

  return buildFallbackReplyFromTools(relevant)
}

function verifyFinalReply(params: {
  instruction: string
  finalReply: string
  executedTools: FleetExecutedTool[]
}): {
  reply: string
  source: 'model' | 'tool_verifier' | 'clarify'
  issues: string[]
} {
  const candidate = (params.finalReply || '').trim()
  if (!candidate) return { reply: '', source: 'model', issues: [] }

  const relevant = params.executedTools.filter(event => event.toolName !== 'think' && event.toolName !== 'update_todos')
  if (relevant.length === 0) return { reply: candidate, source: 'model', issues: [] }

  const latestRelevant = relevant[relevant.length - 1]
  const mutatingInstruction = MUTATING_ACTION_REQUEST_REGEX.test(params.instruction)
  const hasSuccessClaim = SUCCESS_CONFIRMATION_REGEX.test(candidate)
  const hasFailureDisclosure = FAILURE_DISCLOSURE_REGEX.test(candidate)
  const hasEvidenceBackedSuccess = relevant.some(event => event.toolSuccess && hasToolEvidence(event))
  const hasEvidenceBackedMutation = relevant.some(event => isMutatingToolName(event.toolName) && event.toolSuccess && hasToolEvidence(event))
  const issues: string[] = []

  if (shouldSuppressToolPreface(candidate) || EMPTY_PROGRESS_BUBBLE_REGEX.test(candidate)) {
    issues.push('intent_only_reply')
  }
  if (!latestRelevant.toolSuccess && !hasFailureDisclosure) {
    issues.push('missing_failure_disclosure')
  }
  if (latestRelevant.toolSuccess && hasToolEvidence(latestRelevant) && hasFailureDisclosure) {
    issues.push('contradicts_successful_tool')
  }
  if (hasSuccessClaim && !hasEvidenceBackedSuccess) {
    issues.push('unsupported_success_claim')
  }
  if (mutatingInstruction && hasSuccessClaim && !hasEvidenceBackedMutation) {
    issues.push('mutation_not_verified')
  }
  if (hasSuccessfulConversationRead(relevant) && isToolOnlyCompletionReply(candidate, relevant)) {
    issues.push('tool_completion_without_answer')
  }

  if (issues.length === 0) {
    return { reply: candidate, source: 'model', issues: [] }
  }

  const verifiedReply = buildVerifiedReplyFromTools(relevant)
  if (verifiedReply) {
    return { reply: verifiedReply, source: 'tool_verifier', issues }
  }

  return {
    reply: mutatingInstruction
      ? 'Consultei o contexto, mas ainda não tenho evidência suficiente de que a ação foi concluída com sucesso.'
      : 'Consegui analisar o contexto, mas a resposta final ficou inconclusiva.',
    source: 'clarify',
    issues,
  }
}

function shouldRepairFinalReply(params: {
  instruction: string
  finalReply: string
  executedTools: FleetExecutedTool[]
  issues: string[]
}): boolean {
  const relevant = params.executedTools.filter(event => event.toolName !== 'think' && event.toolName !== 'update_todos')
  if (!hasSuccessfulConversationRead(relevant)) return false
  if (params.issues.includes('tool_completion_without_answer') || params.issues.includes('intent_only_reply')) return true
  if (isToolOnlyCompletionReply(params.finalReply, relevant)) return true

  const trimmed = (params.finalReply || '').trim()
  if (!READ_ANALYSIS_REQUEST_REGEX.test(params.instruction)) return false
  if (trimmed.length === 0) return true
  if (trimmed.length > 180 || trimmed.split(/\r?\n/).length > 3) return false

  const normalized = normalizeForMatch(trimmed)
  return TOOL_ONLY_COMPLETION_REGEX.test(normalized) && /\b(historico|transcript|mensagens|conversa|consulta|busca|leitura)\b/.test(normalized)
}

async function repairFinalReplyFromTools(params: {
  provider: IAIProvider
  model: string
  instruction: string
  previousReply: string
  executedTools: FleetExecutedTool[]
  maxTokens?: number
}): Promise<{ reply: string; tokensUsed: number; promptTokens: number; completionTokens: number } | null> {
  const toolContext = buildToolContextForFinalReply(params.executedTools)
  if (!toolContext.trim()) return null

  const systemPrompt = `Você é o reparador de resposta final da Fleet.
As ferramentas JÁ foram executadas. Sua única tarefa é escrever a resposta final para o admin em português, usando SOMENTE as evidências dos outputs abaixo.

Regras obrigatórias:
- NÃO chame ferramentas.
- NÃO diga "concluí a ferramenta", "puxei o transcript" ou "quer que eu analise?".
- Entregue o pedido original agora, com detalhes suficientes.
- Se o admin pediu um formato, respeite exatamente o formato.
- Se o admin escreveu algo como "precisa alterar...", escreva itens começando com "precisa alterar...".
- Se faltar dado, diga objetivamente o que faltou, mas aproveite tudo que foi encontrado.
- Não invente nada que não esteja nos outputs.`

  const userPrompt = `PEDIDO ORIGINAL DO ADMIN:
"""
${params.instruction}
"""

RESPOSTA INCOMPLETA/INVÁLIDA GERADA:
"""
${params.previousReply || '(vazia)'}
"""

OUTPUTS DAS FERRAMENTAS:
${toolContext}

Escreva a resposta final correta agora.`

  try {
    const result = await params.provider.chat({
      model: params.model,
      messages: [{ role: 'user', content: userPrompt }],
      systemPrompt,
      maxTokens: Math.min(Math.max(params.maxTokens || 2000, 1200), 4000),
      temperature: 0.2,
      toolChoice: 'none',
    })
    const reply = (result.content || '').trim()
    if (!reply || isToolOnlyCompletionReply(reply, params.executedTools)) return null
    return {
      reply,
      tokensUsed: result.tokensUsed || 0,
      promptTokens: result.promptTokens || 0,
      completionTokens: result.completionTokens || 0,
    }
  } catch (error) {
    console.warn('[Fleet][FinalRepair] falhou:', (error as Error).message)
    return null
  }
}

function buildApprovalRequestPayload(review: RavenReview, instruction: string) {
  return {
    type: 'raven_approval_request',
    instruction,
    riskLevel: review.riskLevel,
    recommendation: review.recommendation,
    rationale: review.rationale,
    risks: review.risks,
    perspectives: review.perspectives,
    requestedAt: new Date().toISOString(),
  }
}

function formatApprovalRequestMessage(review: RavenReview): string {
  const riskLabel = review.riskLevel.toUpperCase()
  const risks = review.risks.slice(0, 3).map(r => `- ${r.title}${r.mitigation ? ` — ${r.mitigation}` : ''}`).join('\n')
  return `Preciso da sua aprovação antes de seguir.\n\nRisco: ${riskLabel}\n${review.rationale}${risks ? `\n\nPrincipais pontos:\n${risks}` : ''}`
}

// ──────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — composição modular (Onda 1.2)
// ──────────────────────────────────────────────────────────────────────
// Cada seção é uma função pura que recebe o que precisa e retorna string.
// O buildSystemPrompt() compõe só as seções relevantes para o membro.
// Vantagem: prompts mais curtos (-300 tokens p/ membros sem WhatsApp),
// fácil de testar/versionar/A-B testar cada bloco isolado.

function sectionIdentity(member: { name: string; displayRole: string }): string {
  const { today, time, label } = getCurrentFleetDateTimeLabel()
  return `Você é ${member.name}, ${member.displayRole} do CRM IMPA.\n\nHoje é ${today}, ${time} (${label}).\n\nVocê é um funcionário interno do CRM. Quem está conversando com você é o ADMINISTRADOR/OPERADOR (não um cliente final). Use linguagem profissional e direta.`
}

function sectionCapabilities(enabledTools: Set<string>): string {
  // Lista só capacidades correspondentes às tools habilitadas para este membro.
  const lines: string[] = ['=== SUAS CAPACIDADES ===\n', 'Você tem acesso direto ao CRM e pode EXECUTAR de fato (não apenas sugerir):']
  if (enabledTools.has('list_contacts') || enabledTools.has('create_lead') || enabledTools.has('update_contact_admin')) {
    lines.push('📇 **CONTATOS / LEADS**: list_contacts, create_lead, update_contact_admin')
  }
  if (enabledTools.has('list_conversations') || enabledTools.has('search_messages') || enabledTools.has('get_conversation_messages') || enabledTools.has('list_recent_messages')) {
    lines.push('💬 **CONVERSAS**: list_conversations, search_messages, get_conversation_messages, list_recent_messages')
  }
  if (enabledTools.has('list_pipelines') || enabledTools.has('list_kanban_cards') || enabledTools.has('create_kanban_card') || enabledTools.has('move_kanban_card')) {
    lines.push('📊 **PIPELINE / KANBAN**: list_pipelines, list_kanban_cards, create_kanban_card, move_kanban_card')
  }
  if (enabledTools.has('list_users') || enabledTools.has('list_teams_admin') || enabledTools.has('notify_user')) {
    lines.push('👥 **EQUIPE**: list_users, list_teams_admin, notify_user (notificação interna pra um humano)')
  }
  if (enabledTools.has('create_ticket') || enabledTools.has('list_tickets')) {
    lines.push('🎫 **TICKETS**: create_ticket, list_tickets')
  }
  if (enabledTools.has('get_dashboard_metrics')) {
    lines.push('📈 **DASHBOARD**: get_dashboard_metrics')
  }
  if (enabledTools.has('list_instances') || enabledTools.has('send_whatsapp_message') || enabledTools.has('send_whatsapp_poll')) {
    lines.push('📱 **WHATSAPP**: list_instances + send_whatsapp_message (envia mensagem real). NUNCA diga "não consigo enviar" — VOCÊ CONSEGUE.')
  }
  if (enabledTools.has('list_products') || enabledTools.has('create_product')) {
    lines.push('🛒 **CATÁLOGO**: list_products, create_product')
  }
  if (enabledTools.has('list_my_missions') || enabledTools.has('create_mission')) {
    lines.push('⏰ **AUTO-AGENDAMENTO**: create_mission (agenda missões recorrentes ou pontuais para si. Padrão: horário de Brasília / America/Sao_Paulo), list_my_missions')
  }
  if (enabledTools.has('spawn_subagent') || enabledTools.has('list_fleet_members')) {
    lines.push('🤝 **DELEGAÇÃO**: list_fleet_members (descobre outros membros da Fleet), spawn_subagent (delega subtarefa a outro membro). Use quando outro membro tem expertise específica ou para dividir o trabalho.')
  }
  // HTTP tools são genéricas — só mencionar se houver algo customizado
  return lines.join('\n')
}

function sectionExecutionRules(): string {
  return `=== REGRAS DE EXECUÇÃO (LEIA COM ATENÇÃO) ===

⚠️ **VOCÊ NÃO PRECISA PEDIR PERMISSÃO PARA CHAMAR FERRAMENTAS.** Ferramentas são SUAS, use à vontade. Pedir "posso listar?" / "autoriza?" é PROIBIDO — apenas CHAME a ferramenta.

⚠️ **QUANDO O ADMIN DIZ "PODE", "MANDA", "ENVIA", "EXECUTA", "FAZ", "PROSSIGA", "VAI" — EXECUTE NO MESMO TURNO.** Nunca responda "vou executar" sem chamar a tool agora. Se disser que vai fazer e não chamar a tool, você falhou.

1. **Aja, não pergunte demais.** Se o pedido é claro, EXECUTE. Confirme ambíguos só quando o resultado é irreversível em massa.
2. **Sempre verifique antes de criar duplicatas.** Antes de create_lead, faça list_contacts.
3. **Nunca invente IDs.** Sempre busque/liste antes.
4. **Confirme só ações destrutivas em massa** (deletar em lote, sobrescrever várias coisas). Ação ÚNICA não precisa de confirmação extra.
5. **Reporte sempre o resultado** ao final, com IDs/links.
6. **NÃO chame ferramentas em pânico.** Se a pergunta é só conversa ("oi", "quem é você?"), RESPONDA EM TEXTO. Nunca chame mais de 5 ferramentas para uma pergunta simples.
7. **Sempre escreva uma resposta final em texto** depois de chamar ferramentas.
8. **Telefones brasileiros**: "7381062304", "55 73 8106-2304", "+55 73..." SÃO O MESMO NÚMERO. Tools normalizam — não trate formatos diferentes como pessoas diferentes.
9. **Tom**: direto, conciso, profissional e HUMANO. PROIBIDO: "missão cumprida", "missão concluída", "alvo", "comandante", "operação finalizada", "disparo realizado", "status: entregue conforme solicitado". Você é colega de trabalho, não soldado nem telemetria. Frases naturais: "Pronto, mandei pro Rafa." / "Feito.". Responda em 1-3 linhas.
10. **NUNCA invente confirmações.** Só diga que algo foi feito DEPOIS que a tool retornou success=true. Se falhou, diga que falhou e por quê.
11. **NÃO reuse dados entre turnos sem revalidar.** Se mandou pro número X no turno anterior e agora pedem pra OUTRA pessoa, busque o contato dela do zero. Não assuma que o número anterior é o mesmo.
12. **Sua resposta final precisa bater com a evidência das tools.** Se você criou, enviou, atualizou ou agendou algo, cite isso só quando o retorno da tool confirmar. Se houve falha parcial, admita a falha parcial.
13. **Leitura não é entrega.** Depois de \`get_conversation_messages\`, \`search_messages\`, \`list_conversations\` ou qualquer consulta, NÃO finalize com "concluí", "puxei", "li o histórico". Transforme os dados na resposta pedida pelo admin.`
}

function sectionWhatsAppFlow(): string {
  return `=== FLUXO WHATSAPP ===

Para enviar uma mensagem (faça TUDO de uma vez, sem perguntar):
a) \`list_instances\` para pegar instanceId.
b) Para GRUPO: \`list_conversations\` filtrando pelo nome do grupo, pegue o JID @g.us, passe esse JID inteiro em \`to\`. NUNCA passe número de pessoa quando pedirem grupo.
c) Para PESSOA POR NOME ("manda pro Rafa"): SEMPRE \`list_contacts\` com search=nome ANTES, pegue o telefone retornado e use ESSE. NUNCA reutilize um número que apareceu em mensagem anterior — números entre conversas/contatos diferentes não se repetem. Múltiplos resultados? Peça desambiguação.
d) \`send_whatsapp_message\` com instanceId + to + texto. O \`to\` DEVE vir do retorno mais recente de \`list_contacts\` ou \`list_conversations\` — JAMAIS de memória.
e) Reporte em UMA mensagem curta deixando claro PARA QUEM foi (nome + número/JID exato). Se o admin corrigir ("era pro X, não pro Y"), RECONHEÇA o erro, refaça a busca, reenvie — NUNCA insista que estava certo.

Se houver UMA única instância ativa, use ela direto. Múltiplas: escolha a primeira ACTIVE/CONNECTED ou a que o admin mencionou pelo nome.`
}

function sectionConversationFlow(): string {
  return `=== LEITURA DE CONVERSAS / GRUPOS ===

Quando o admin pedir para ANALISAR uma conversa, contato ou grupo, siga este fluxo sem ficar enrolando:
1. Use \`list_conversations\` com \`search\` (e \`groupOnly=true\` se for grupo) para achar a conversa certa.
2. Assim que achar a conversa, use \`get_conversation_messages\` com \`conversationId\` para ler o transcript real em ordem cronológica.
3. Use \`search_messages\` só para procurar palavras-chave específicas. Ela NÃO substitui o transcript completo.
4. Se \`get_conversation_messages\` voltar pouco histórico e houver \`hasMore=true\`, pagine com \`before\`.
5. Se uma leitura não ajudou, MUDE DE FERRAMENTA ou MUDE OS ARGUMENTOS. É PROIBIDO repetir a mesma leitura idêntica várias vezes esperando resultado diferente.
6. Depois que \`get_conversation_messages\` retornar, a próxima resposta precisa ser a ANÁLISE solicitada. É proibido responder só "Pronto, concluí get conversation messages", "puxei o transcript" ou "quer que eu analise?".

Resumo prático:
- "Olha esse grupo e me resume" -> \`list_conversations(search=nome, groupOnly=true)\` -> \`get_conversation_messages(conversationId, limit=80, order='asc')\` -> resumo.
- "Busca onde falaram de X" -> \`search_messages(query='X')\`.
- "O que aconteceu nas últimas horas?" -> \`list_recent_messages\`.`
}

function sectionTodoRules(): string {
  return `=== PLANO DE TAREFAS (\`update_todos\`) ===

Quando o pedido tiver 3+ passos (especialmente envios em LOTE para vários contatos, varreduras, sincronizações), CHAME \`update_todos\` no início com a lista completa de passos (status "pending"). Conforme executa, chame de novo atualizando: marque a atual como "in_progress" (apenas UMA por vez), e "completed" assim que terminar cada uma. O admin vê isso como checklist visual no chat. Quando todas estiverem "completed", produza UMA mensagem final concisa.

Tarefas únicas/simples (uma mensagem só, uma busca só): NÃO use update_todos — é overkill.`
}

function sectionBubbleStyle(): string {
  return `=== MÚLTIPLAS BOLHAS DE MENSAGEM (estilo OpenClaude/Hermes) ===

Você PODE — e em muitos casos DEVE — produzir várias mensagens em sequência ao longo de uma única tarefa, em vez de comprimir tudo numa resposta gigante. Cada vez que você escreve texto E DEPOIS chama uma ferramenta (ou termina), esse texto vira UMA BOLHA SEPARADA visualmente para o admin (como uma pessoa mandando várias mensagens curtas no WhatsApp).

QUANDO mandar várias bolhas:
- Tarefas com múltiplos passos: "Vou buscar os contatos…" → [tool] → "Achei 12. Agora atualizo o card." → [tool] → "Pronto."
- Explicações didáticas: divida o ensino em partes naturais.
- Quando descobrir algo importante no caminho: "Hmm, esse contato já existe. Vou atualizar em vez de duplicar."
- Quando mudar de plano ou encontrar obstáculo: avise antes de tentar a alternativa.

QUANDO NÃO mandar várias:
- Resposta direta a pergunta simples (uma bolha basta).
- "Oi", "obrigado", confirmações triviais.
- Quando a resposta inteira cabe em 2-3 linhas e não envolve ações.
- PROIBIDO mandar bolha vazia de intenção: "vou enviar e já confirmo", "deixa eu verificar", "aguarde". Se sua próxima ação é só chamar tool e você não tem um fato novo útil, fique em silêncio e chame a tool.

A QUANTIDADE É SUA DECISÃO. Pode ser 1 bolha, 2, 5, 10, 20+ — conforme a tarefa pedir. Cada bolha CURTA (1-4 linhas, raramente mais). Parágrafo gigante? QUEBRE em duas mensagens.`
}

function sectionThinking(): string {
  return `=== ⚠️ MODO PENSAMENTO ATIVO ===

O administrador ATIVOU o modo de pensamento profundo para esta mensagem. ANTES de chamar qualquer tool de ação ou de responder, você DEVE chamar a ferramenta \`think\` PELO MENOS UMA VEZ para registrar:
1. O que o admin está realmente pedindo (interpretação literal e intenção).
2. Quais informações você já tem vs. o que precisa descobrir.
3. Plano: lista ordenada das tools que vai chamar e por quê.
4. Riscos / casos ambíguos / dados que precisa confirmar.

Depois de pensar, EXECUTE o plano e produza a resposta final. Pode chamar \`think\` mais vezes no meio se descobrir algo novo.`
}

function sectionMemory(memoryEntries: { key: string; value: string }[]): string {
  if (!memoryEntries.length) return ''
  const lines = memoryEntries.slice(0, 20).map(e => `- ${e.key}: ${e.value}`).join('\n')
  return `=== O QUE VOCÊ JÁ SABE (memória de longo prazo) ===\n\n${lines}\n\nUse essa memória para personalizar respostas e evitar perguntar coisas que já foram ditas.`
}

function getCurrentFleetDateTimeLabel(timeZone: string = DEFAULT_CRON_TIMEZONE): { today: string; time: string; label: string } {
  const now = new Date()
  try {
    return {
      today: new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(now),
      time: new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now),
      label: timeZone === DEFAULT_CRON_TIMEZONE ? 'horário de Brasília' : timeZone,
    }
  } catch {
    return {
      today: now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      label: timeZone,
    }
  }
}

function buildSystemPrompt(member: {
  name: string
  displayRole: string
  systemPrompt: string
  onboarded: boolean
  thinkingMode?: boolean
  enabledTools?: Set<string>
  memoryEntries?: { key: string; value: string }[]
}): string {
  const { today, time, label } = getCurrentFleetDateTimeLabel()

  // Modo ONBOARDING — membro recém-criado, está se auto-configurando via chat
  if (!member.onboarded) {
    return `Você é ${member.name}, recém-adicionado(a) ao CRM IMPA como ${member.displayRole}.

  Hoje é ${today}, ${time} (${label}).

=== MODO ONBOARDING (PRIMEIRA CONFIGURAÇÃO) ===

Você está numa CONVERSA DE CONFIGURAÇÃO com o administrador. Sua única missão agora é:
1. Entender como o admin quer que você trabalhe (responsabilidades, tom, regras, exemplos).
2. Fazer perguntas de esclarecimento se algo estiver vago.
3. Conforme você entende, USE A FERRAMENTA \`configure_self\` para gravar incrementalmente sua própria configuração (especialmente o \`systemPrompt\` final, que será sua personalidade definitiva).
4. Quando tiver clareza total e o admin confirmar, chame \`configure_self\` com \`markOnboarded: true\` E o \`systemPrompt\` final completo — isso encerra o setup e você passa a operar normalmente.

REGRAS:
- NÃO execute outras ações do CRM (criar leads, mover cards, etc) durante o onboarding. Só \`configure_self\`.
- Seja CONVERSACIONAL e CURIOSO. Não despeje formulário. Faça 1-2 perguntas por vez.
- Quando o admin der respostas vagas ("você decide"), proponha uma opção e peça confirmação.
- O \`systemPrompt\` final que você gravar deve ser ESCRITO EM SEGUNDA PESSOA ("Você é...", "Sua função é...") e contém: identidade, escopo de trabalho, tom de voz, regras implícitas, exemplos de comportamento.

Quando o admin disser "pode encerrar" / "está ótimo" / "tudo certo" — faça o markOnboarded:true.`
  }

  // Modo NORMAL — composição modular
  const enabled = member.enabledTools || new Set<string>()
  const sections: string[] = [
    sectionIdentity(member),
    sectionCapabilities(enabled),
    sectionExecutionRules(),
  ]

  // Seções condicionais (só se a tool relevante está habilitada)
  if (enabled.has('send_whatsapp_message') || enabled.has('send_whatsapp_poll')) {
    sections.push(sectionWhatsAppFlow())
  }
  if (enabled.has('list_conversations') || enabled.has('search_messages') || enabled.has('get_conversation_messages') || enabled.has('list_recent_messages')) {
    sections.push(sectionConversationFlow())
  }
  if (enabled.has('update_todos')) {
    sections.push(sectionTodoRules())
  }
  sections.push(sectionBubbleStyle())

  if (member.thinkingMode) {
    sections.push(sectionThinking())
  }

  // Memória de longo prazo (Onda 2.2 — pré-pronto, recebe vazio até ativarmos)
  const memSection = sectionMemory(member.memoryEntries || [])
  if (memSection) sections.push(memSection)

  sections.push(`=== PERSONALIDADE ===\n\n${member.systemPrompt}`)

  return sections.join('\n\n')
}

// ============================================
// RAVEN CRITIC — pré-mortem adversarial
// Sub-agente que analisa uma instrução ANTES da execução, identificando riscos
// de 3 perspectivas (executor, stakeholder, cético) e sugerindo mitigações.
// Usado pelo Fleet para barrar/avisar antes de ações destrutivas.
// ============================================
export interface RavenReview {
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  risks: Array<{ title: string; severity: 'low' | 'medium' | 'high' | 'critical'; mitigation?: string }>
  perspectives: Array<{ role: 'executor' | 'stakeholder' | 'skeptic'; concern: string }>
  recommendation: 'proceed' | 'proceed_with_caution' | 'request_approval' | 'block'
  rationale: string
  tokensInput: number
  tokensOutput: number
  durationMs: number
}

export async function runRavenCritic(params: {
  companyId: string
  operationId: string
  provider: any
  model: string
  instruction: string
  memberName: string
  memberRole: string
  proposedActions?: any[]
}): Promise<RavenReview> {
  const start = Date.now()

  const sysPrompt = `Você é "RAVEN", um crítico interno adversarial do sistema IMPA Fleet.
Seu trabalho é fazer um PRÉ-MORTEM antes que ações destrutivas/grandes sejam executadas.
Você NÃO executa nada — apenas analisa riscos.

Para cada solicitação você DEVE:
1. Identificar 3-5 RISCOS concretos (do mais crítico ao mais leve), com mitigação proposta
2. Considerar 3 PERSPECTIVAS:
   - executor: o que pode dar errado tecnicamente?
   - stakeholder: como o cliente/empresa afetado pode reagir?
   - skeptic: o que estamos assumindo sem verificar?
3. Definir um nível de risco geral: low | medium | high | critical
4. Recomendar: proceed | proceed_with_caution | request_approval | block

Responda SEMPRE em JSON puro (sem markdown), nesta forma EXATA:
{
  "riskLevel": "low|medium|high|critical",
  "risks": [{"title": "...", "severity": "low|medium|high|critical", "mitigation": "..."}],
  "perspectives": [{"role": "executor|stakeholder|skeptic", "concern": "..."}],
  "recommendation": "proceed|proceed_with_caution|request_approval|block",
  "rationale": "1-3 frases explicando a decisão"
}

REGRAS:
- Use "block" APENAS se houver risco real de perda de dados, violação legal, dano irreversível em massa, ou ação claramente fora do escopo solicitado.
- Use "request_approval" para ações reversíveis mas grandes (ex: enviar broadcast a 100+ contatos).
- Use "proceed_with_caution" para ações com riscos pequenos mitigáveis.
- Use "proceed" se o risco for genuinamente baixo.
- Seja CONCISO. Evite paranoia desnecessária.`

  const userMsg = `MEMBRO QUE VAI EXECUTAR: ${params.memberName} (${params.memberRole})

INSTRUÇÃO RECEBIDA DO ADMIN:
"""
${params.instruction}
"""

${params.proposedActions ? `\nAÇÕES JÁ PLANEJADAS PELO MEMBRO:\n${JSON.stringify(params.proposedActions, null, 2)}\n` : ''}

Faça o pré-mortem agora. Responda APENAS o JSON.`

  let raw = ''
  let tokensIn = 0
  let tokensOut = 0
  try {
    const result = await params.provider.complete({
      model: params.model,
      messages: [{ role: 'user', content: userMsg }],
      systemPrompt: sysPrompt,
      maxTokens: 1200,
      temperature: 0.3,
    })
    raw = (result.content || '').trim()
    tokensIn = result.promptTokens || 0
    tokensOut = result.completionTokens || 0
  } catch (err) {
    throw new Error(`Raven LLM call failed: ${(err as Error).message}`)
  }

  // Tenta extrair JSON (mesmo que venha com cercas markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Raven não retornou JSON: ${raw.substring(0, 200)}`)

  let parsed: any
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error(`Raven retornou JSON inválido: ${jsonMatch[0].substring(0, 200)}`)
  }

  const validRisk = ['low', 'medium', 'high', 'critical']
  const validRec = ['proceed', 'proceed_with_caution', 'request_approval', 'block']

  const riskLevel = validRisk.includes(parsed.riskLevel) ? parsed.riskLevel : 'medium'
  const recommendation = validRec.includes(parsed.recommendation) ? parsed.recommendation : 'proceed_with_caution'

  return {
    riskLevel,
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 10).map((r: any) => ({
      title: String(r.title || '').substring(0, 200),
      severity: validRisk.includes(r.severity) ? r.severity : 'medium',
      mitigation: r.mitigation ? String(r.mitigation).substring(0, 300) : undefined,
    })) : [],
    perspectives: Array.isArray(parsed.perspectives) ? parsed.perspectives.slice(0, 5).map((p: any) => ({
      role: ['executor', 'stakeholder', 'skeptic'].includes(p.role) ? p.role : 'executor',
      concern: String(p.concern || '').substring(0, 400),
    })) : [],
    recommendation,
    rationale: String(parsed.rationale || '').substring(0, 1000),
    tokensInput: tokensIn,
    tokensOutput: tokensOut,
    durationMs: Date.now() - start,
  }
}

async function executeRun(input: FleetRunInput): Promise<FleetRunOutput> {
  const member = await prisma.fleetMember.findUnique({
    where: { id: input.memberId },
    include: { provider: true },
  })
  if (!member) throw new Error('Membro da Fleet não encontrado')
  if (member.status !== 'ACTIVE') throw new Error(`Membro está ${member.status}`)
  if (!member.provider.isActive) throw new Error('Provider AI desativado')

  const op = input.operationId
    ? await prisma.fleetOperation.update({
        where: { id: input.operationId },
        data: {
          status: 'RUNNING',
          instruction: input.instruction,
          error: null,
          output: null,
          toolsCalled: [],
          startedAt: new Date(),
          finishedAt: null,
        },
        select: { id: true },
      })
    : await prisma.fleetOperation.create({
        data: {
          companyId: member.companyId,
          memberId: member.id,
          missionId: input.missionId || null,
          chatId: input.chatId || null,
          trigger: input.trigger,
          status: 'RUNNING',
          instruction: input.instruction,
          startedAt: new Date(),
          parentOperationId: input.parentOperationId || null,
          depth: input.depth ?? 0,
        },
        select: { id: true },
      })

  // Sinaliza imediatamente o operationId para o handler HTTP retornar
  if (input.opIdResolver) {
    try { input.opIdResolver(op.id) } catch {}
  }

  const start = Date.now()
  let totalTokens = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const executedTools: FleetExecutedTool[] = []

  try {
    // Refresh automático de tokens OAuth (Copilot expira a cada ~30min)
    const freshProvider = await getProviderWithFreshToken(member.provider.id, member.companyId)
    const providerData = freshProvider || decryptProviderSecrets(member.provider)
    const provider = createProvider(
      member.provider.type,
      providerData.apiKey,
      member.provider.baseUrl || undefined,
      (providerData as any).oauthData,
    )

    // Tools — usa o toolsConfig do próprio membro,
    // mesclado com DEFAULT_FLEET_TOOLS_CONFIG para garantir que membros antigos
    // ganhem automaticamente novas tools adicionadas ao default (ex: send_whatsapp_message).
    let settings = (member.toolsConfig as Record<string, any>) || {}
    {
      const savedFA = settings.fleet_admin || {}
      const savedEnabled: string[] = Array.isArray(savedFA.enabledTools) ? savedFA.enabledTools : []
      const defaultEnabled: string[] = DEFAULT_FLEET_TOOLS_CONFIG.fleet_admin.enabledTools
      // União — mantém customizações do admin + adiciona tools default novas
      const merged = Array.from(new Set([...savedEnabled, ...defaultEnabled]))
      settings = { ...settings, fleet_admin: { ...savedFA, enabledTools: merged } }
    }
    if (!member.onboarded) {
      const fa = settings.fleet_admin || {}
      const enabled = Array.isArray(fa.enabledTools) ? fa.enabledTools : []
      if (!enabled.includes('configure_self')) {
        settings = { ...settings, fleet_admin: { ...fa, enabledTools: [...enabled, 'configure_self'] } }
      }
    }
    const { tools, toolTypeMap } = ToolEngine.buildTools(settings)

    // Set de tools habilitadas — usado pelo system prompt modular para mostrar
    // só capacidades relevantes a este membro.
    const enabledToolsSet = new Set<string>(tools.map(t => t.name))

    const history = input.history ?? (input.chatId ? await buildHistory(input.chatId, { provider, model: member.model }) : [])

    // Onda 2.2: carrega memória de longo prazo do membro pra injetar no prompt
    const memoryEntries = await getMemoryForPrompt(member.id).catch(err => {
      console.warn('[Fleet] getMemoryForPrompt falhou:', err.message)
      return []
    })

    const systemPrompt = buildSystemPrompt({
      name: member.name,
      displayRole: member.displayRole,
      systemPrompt: member.systemPrompt,
      onboarded: member.onboarded,
      thinkingMode: input.thinkingMode,
      enabledTools: enabledToolsSet,
      memoryEntries,
    })

    let systemPromptFinal = systemPrompt

    const chatMessages: AIMessage[] = [
      ...history,
      { role: 'user', content: input.instruction },
    ]

    // ── RAVEN CRITIC (pré-mortem adversarial) ─────────────────
    // Auto-revisão antes de executar ações destrutivas. Roda APENAS no depth=0
    // e quando o membro tem critic.autoReview=true OU instruction casa com keywords de risco.
    let criticContext = ''
    try {
      const criticCfg = (settings.critic && typeof settings.critic === 'object') ? settings.critic : {}
      const isRoot = (input.depth ?? 0) === 0
      const RISK_KEYWORDS = /(deletar|apagar|remover|excluir|banir|kick|kickar|desativar|suspender|massa|todos os|para todos|broadcast|disparar|enviar para|cancelar|reset|resetar|zerar|truncar|wipe|drop|drop table|delete from|update.*set|migrar|migrate)/i
      const shouldRun = !input.approvalGranted && isRoot && (criticCfg.autoReview === true || (criticCfg.autoReview !== false && RISK_KEYWORDS.test(input.instruction)))

      if (shouldRun) {
        const review = await runRavenCritic({
          companyId: member.companyId,
          operationId: op.id,
          provider,
          model: criticCfg.model || member.model,
          instruction: input.instruction,
          memberName: member.name,
          memberRole: member.displayRole || '',
        }).catch(err => { console.warn('[Fleet][Raven] falhou:', err.message); return null })

        if (review) {
          await prisma.fleetCriticReview.create({
            data: {
              companyId: member.companyId,
              operationId: op.id,
              riskLevel: review.riskLevel,
              risks: review.risks as any,
              perspectives: review.perspectives as any,
              recommendation: review.recommendation,
              rationale: review.rationale,
              tokensInput: review.tokensInput || 0,
              tokensOutput: review.tokensOutput || 0,
              durationMs: review.durationMs || null,
            },
          }).catch(err => console.warn('[Fleet][Raven] save review failed:', err.message))

          if (review.recommendation === 'block') {
            await prisma.fleetOperation.update({
              where: { id: op.id },
              data: {
                status: 'FAILED',
                finishedAt: new Date(),
                error: `Bloqueado pelo crítico (Raven): ${review.rationale.substring(0, 500)}`,
              },
            }).catch(() => {})
            return {
              operationId: op.id,
              output: `🚨 **Operação BLOQUEADA pelo crítico interno (risco ${review.riskLevel.toUpperCase()})**\n\n${review.rationale}\n\n**Riscos identificados:**\n${review.risks.map(r => `- ${r.title} (${r.severity})`).join('\n')}\n\nSe quiser executar mesmo assim, confirme explicitamente com algo como "executar mesmo com os riscos".`,
              tokensUsed: review.tokensInput + review.tokensOutput,
              durationMs: Date.now() - start,
              promptTokens: review.tokensInput,
              completionTokens: review.tokensOutput,
              status: 'FAILED',
              error: `Bloqueado pelo crítico (Raven): ${review.rationale.substring(0, 200)}`,
            }
          }

          if (review.recommendation === 'request_approval') {
            const proposedActions = buildApprovalRequestPayload(review, input.instruction)
            const approvalMessage = formatApprovalRequestMessage(review)
            await prisma.fleetOperation.update({
              where: { id: op.id },
              data: {
                status: 'AWAITING_APPROVAL',
                output: approvalMessage,
                proposedActions: proposedActions as any,
                durationMs: Date.now() - start,
              },
            }).catch(() => {})
            if (input.onAssistantBubble) {
              try { await input.onAssistantBubble({ content: approvalMessage, sequence: 1 }) } catch {}
            }
            return {
              operationId: op.id,
              output: approvalMessage,
              tokensUsed: review.tokensInput + review.tokensOutput,
              durationMs: Date.now() - start,
              promptTokens: review.tokensInput,
              completionTokens: review.tokensOutput,
              status: 'AWAITING_APPROVAL',
            }
          }

          // Adiciona contexto ao prompt para o agente saber dos riscos antes de agir
          const riskList = review.risks.map(r => `- [${r.severity}] ${r.title}: ${r.mitigation || '(sem mitigação sugerida)'}`).join('\n')
          criticContext = `\n\n<critic_review>\nUm crítico interno (Raven) analisou esta solicitação ANTES de você agir.\nNível de risco: ${review.riskLevel.toUpperCase()}\nRecomendação: ${review.recommendation}\n\nRiscos identificados:\n${riskList}\n\nPerspectivas:\n${review.perspectives.map(p => `- (${p.role}) ${p.concern}`).join('\n')}\n\nLeve esses pontos em consideração. Se for prosseguir, mitigue os riscos.\n</critic_review>`
        }
      }
    } catch (err) {
      console.warn('[Fleet][Raven] inesperado:', (err as Error).message)
    }

    // Injeta contexto do crítico no system prompt (se houver)
    if (criticContext) {
      systemPromptFinal = systemPrompt + criticContext
    }

    let finalReply = ''
    let bubbleSequence = 0
    const emittedBubbles: string[] = []
    const shouldForceFirstToolCall = shouldForceToolCalls({
      instruction: input.instruction,
      onboarded: member.onboarded,
      tools,
    })
    const shouldForcePlanningTool = shouldForcePlanningPass({
      instruction: input.instruction,
      onboarded: member.onboarded,
      tools,
    })

    // Helper: emite uma bolha (FleetMessage ASSISTANT) imediatamente.
    // Usado para enviar várias mensagens em sequência (estilo OpenClaude/Hermes).
    const emitBubble = async (text: string): Promise<void> => {
      const trimmed = (text || '').trim()
      if (!trimmed) return
      // Dedup: não repetir bolha idêntica em sequência
      if (emittedBubbles[emittedBubbles.length - 1] === trimmed) return
      emittedBubbles.push(trimmed)
      bubbleSequence++
      if (input.onAssistantBubble) {
        try { await input.onAssistantBubble({ content: trimmed, sequence: bubbleSequence }) } catch (e) {
          console.warn('[Fleet] onAssistantBubble error:', (e as Error).message)
        }
      }
    }

    let totalToolCalls = 0
    let budgetExceeded = false
    let loopGuardTriggered = false

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // ── BUDGET GUARDS (Onda 1.5) ─────────────────────────────
      // Ao estourar, força UM último turno sem tools (toolChoice='none')
      // para o LLM produzir resposta final com o que já tem.
      const hitTokenBudget = totalTokens > DEFAULT_MAX_TOKENS_PER_OP
      const hitToolBudget = totalToolCalls >= DEFAULT_MAX_TOOL_CALLS_PER_OP
      if ((hitTokenBudget || hitToolBudget) && !budgetExceeded) {
        budgetExceeded = true
        const reason = hitTokenBudget
          ? `Budget de ${DEFAULT_MAX_TOKENS_PER_OP} tokens estourado (${totalTokens} usados).`
          : `Budget de ${DEFAULT_MAX_TOOL_CALLS_PER_OP} tool calls estourado (${totalToolCalls} chamadas).`
        console.warn(`[Fleet] ${reason} — forçando resposta final sem mais tools.`)
        chatMessages.push({
          role: 'user',
          content: `[SISTEMA: ${reason} Pare de chamar tools e responda agora com o que você descobriu, ou peça pra reformular.]`,
        })
      }

      // ── CRITIC TURN (Onda 1.4) ───────────────────────────────
      // A cada CRITIC_TURN_EVERY iterações, injeta uma reflexão sintética
      // pra quebrar loops cegos. Pula se budget já estourou.
      if (i > 0 && i % CRITIC_TURN_EVERY === 0 && !budgetExceeded) {
        chatMessages.push({
          role: 'user',
          content: `[REFLEXÃO — PAUSE E PENSE] Você já chamou ${totalToolCalls} ferramentas em ${i} iterações. Em uma frase: o que você descobriu até agora? Você TEM a resposta para o pedido original? Se sim, RESPONDA AGORA em texto (sem mais tools). Se não, identifique a UMA tool específica que falta chamar — ou desista e peça esclarecimento.`,
        })
      }

      const result: AICompletionResult = await provider.chat({
        model: member.model,
        messages: chatMessages,
        maxTokens: member.maxTokens,
        temperature: member.temperature,
        topP: member.topP || undefined,
        systemPrompt: systemPromptFinal,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: budgetExceeded || loopGuardTriggered
          ? 'none'
          : (shouldForcePlanningTool && totalToolCalls === 0
            ? { name: 'think' }
            : (shouldForceFirstToolCall && totalToolCalls === 0 ? 'required' : 'auto')),
      })

      totalTokens += result.tokensUsed || 0
      totalPromptTokens += result.promptTokens || 0
      totalCompletionTokens += result.completionTokens || 0

      if (!result.toolCalls || result.toolCalls.length === 0) {
        if (!result.content?.trim() && i > 0) {
          chatMessages.push({ role: 'assistant', content: '' })
          chatMessages.push({
            role: 'user',
            content: '[SISTEMA: Você executou ações mas não respondeu. Responda agora resumindo o que foi feito.]',
          })
          continue
        }
        finalReply = result.content || ''
        break
      }

      // Texto intermediário acompanhando tool calls → emite como BOLHA SEPARADA
      // (padrão OpenClaude: o LLM pode falar e chamar tool no mesmo turno;
      //  cada texto vira uma mensagem visual independente)
      if (result.content && result.content.trim() && !shouldSuppressToolPreface(result.content)) {
        await emitBubble(result.content)
      }

      chatMessages.push({
        role: 'assistant',
        content: result.content || (null as any),
        tool_calls: result.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      })

      // ── EXECUÇÃO DE TOOLS (Onda 1.1) ─────────────────────────
      // Particiona em READ-ONLY (paralelo) e WRITE (serial).
      // Read-only: até MAX_PARALLEL_READS simultâneas via Promise.all.
      // Write: serial pra evitar race conditions / ordem importa.
      const ctx = {
        sessionId: input.chatId || op.id,
        agentId: member.id,
        agentName: member.name,
        companyId: member.companyId,
        instanceId: FLEET_VIRTUAL_INSTANCE_ID,
        remoteJid: FLEET_VIRTUAL_REMOTE_JID,
        triggeredBy: 'function_calling' as const,
        operationId: op.id,
        operationDepth: input.depth ?? 0,
      }

      const readCalls = result.toolCalls.filter(tc => FLEET_READ_ONLY_TOOLS.has(tc.name))
      const writeCalls = result.toolCalls.filter(tc => !FLEET_READ_ONLY_TOOLS.has(tc.name))
      totalToolCalls += result.toolCalls.length

      // Resultados indexados por tool_call_id pra preservar a ordem original
      // que o LLM espera (alguns providers são estritos quanto a isso).
      const resultsById = new Map<string, { raw: string; durationMs: number }>()

      // 1) Read-only em paralelo (lotes de MAX_PARALLEL_READS)
      for (let r = 0; r < readCalls.length; r += MAX_PARALLEL_READS) {
        const batch = readCalls.slice(r, r + MAX_PARALLEL_READS)
        const batchResults = await Promise.all(
          batch.map(async (tc) => {
            const startedAt = Date.now()
            if (shouldBlockRepeatedReadTool({ toolName: tc.name, toolInput: tc.arguments, executedTools })) {
              loopGuardTriggered = true
              return { raw: buildRepeatedReadToolError(tc.name), durationMs: 0 }
            }
            const raw = await ToolEngine.execute(tc.name, tc.arguments, toolTypeMap, ctx)
              .catch((e: any) => JSON.stringify({ error: 'execution_failed', message: e?.message || String(e) }))
            return { raw, durationMs: Date.now() - startedAt }
          })
        )
        batch.forEach((tc, idx) => resultsById.set(tc.id, batchResults[idx]))
      }

      // 2) Write em série (ordem pode importar)
      for (const tc of writeCalls) {
        const startedAt = Date.now()
        const raw = await ToolEngine.execute(tc.name, tc.arguments, toolTypeMap, ctx)
          .catch((e: any) => JSON.stringify({ error: 'execution_failed', message: e?.message || String(e) }))
        resultsById.set(tc.id, { raw, durationMs: Date.now() - startedAt })
      }

      // 3) Empurra os resultados na ordem ORIGINAL dos toolCalls
      for (const tc of result.toolCalls) {
        const toolResult = resultsById.get(tc.id) || {
          raw: JSON.stringify({ error: 'no_result' }),
          durationMs: 0,
        }
        const toolOutput = parseToolOutput(toolResult.raw)
        const toolSuccess = resolveToolSuccess(toolOutput)
        chatMessages.push({
          role: 'tool',
          content: toolResult.raw,
          tool_call_id: tc.id,
        })

        const toolEvent: FleetExecutedTool = {
          toolName: tc.name,
          toolInput: tc.arguments,
          toolOutput,
          rawOutput: toolResult.raw,
          toolSuccess,
          durationMs: toolResult.durationMs,
        }
        executedTools.push(toolEvent)

        if (input.onToolMessage) {
          try {
            await input.onToolMessage({
              content: summarizeToolEvent(toolEvent),
              toolName: tc.name,
              toolInput: toJsonSafe(tc.arguments),
              toolOutput: toJsonSafe(toolOutput),
              toolSuccess,
              durationMs: toolResult.durationMs,
            })
          } catch (e) {
            console.warn('[Fleet] onToolMessage error:', (e as Error).message)
          }
        }
      }

      await prisma.fleetOperation.update({
        where: { id: op.id },
        data: { toolsCalled: toJsonSafe(executedTools) },
      }).catch(err => {
        console.warn('[Fleet] Falha ao atualizar progresso da operação:', err.message)
      })
    }

    if (!finalReply) {
      finalReply = buildFallbackReplyFromTools(executedTools)
    }

    if (!finalReply) {
      // Tenta extrair última fala do assistant que tenha texto
      const lastAssistantWithText = [...chatMessages].reverse().find(
        m => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0,
      ) as any
      if (lastAssistantWithText?.content) {
        finalReply = lastAssistantWithText.content
      } else {
        // Lista as ferramentas que foram chamadas para dar transparência
        const toolsUsed = chatMessages
          .filter((m: any) => m.role === 'assistant' && Array.isArray(m.tool_calls))
          .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.function?.name))
          .filter(Boolean)
        const unique = Array.from(new Set(toolsUsed))
        finalReply = unique.length > 0
          ? `Cheguei ao limite de iterações sem conseguir formular uma resposta final. Chamei ${unique.length} ferramenta(s): ${unique.join(', ')}. Reformule a pergunta de forma mais específica para eu responder direto.`
          : 'Não consegui processar essa solicitação. Tente reformular a pergunta.'
      }
    }

    const verification = verifyFinalReply({
      instruction: input.instruction,
      finalReply,
      executedTools,
    })
    if (shouldRepairFinalReply({
      instruction: input.instruction,
      finalReply,
      executedTools,
      issues: verification.issues,
    })) {
      const repaired = await repairFinalReplyFromTools({
        provider,
        model: member.model,
        instruction: input.instruction,
        previousReply: finalReply,
        executedTools,
        maxTokens: member.maxTokens,
      })

      if (repaired?.reply) {
        console.warn(`[Fleet][FinalRepair] Resposta final reparada (${verification.issues.join(', ') || 'status_only'}) op=${op.id}`)
        finalReply = repaired.reply
        totalTokens += repaired.tokensUsed
        totalPromptTokens += repaired.promptTokens
        totalCompletionTokens += repaired.completionTokens
      } else if (verification.source !== 'model') {
        console.warn(`[Fleet][Verifier] Resposta final ajustada (${verification.issues.join(', ') || 'sem detalhe'}) op=${op.id}`)
        finalReply = verification.reply
      }
    } else if (verification.source !== 'model') {
      console.warn(`[Fleet][Verifier] Resposta final ajustada (${verification.issues.join(', ') || 'sem detalhe'}) op=${op.id}`)
      finalReply = verification.reply
    }

    if (finalReply.trim()) {
      finalReply = finalReply.trim()
      await emitBubble(finalReply)
    }

    const durationMs = Date.now() - start

    await prisma.fleetOperation.update({
      where: { id: op.id },
      data: {
        status: 'COMPLETED',
        output: finalReply,
        toolsCalled: toJsonSafe(executedTools),
        tokensInput: totalPromptTokens,
        tokensOutput: totalCompletionTokens,
        durationMs,
        finishedAt: new Date(),
      },
    })

    prisma.fleetMember.update({
      where: { id: member.id },
      data: {
        totalOperations: { increment: 1 },
        totalTokensUsed: { increment: BigInt(totalTokens) },
        lastUsedAt: new Date(),
      },
    }).catch(() => {})

    // Onda 2.2: extração de memória de longo prazo (background, não bloqueia)
    // Só roda quando há chatId (conversa real com admin) e a interação foi substancial
    if (input.chatId && chatMessages.length >= 4) {
      extractAndStoreMemory({
        memberId: member.id,
        companyId: member.companyId,
        chatId: input.chatId,
        operationId: op.id,
        messages: [...chatMessages, { role: 'assistant', content: finalReply }],
        deps: { provider, model: member.model },
      }).catch(err => {
        console.warn('[Fleet] extractAndStoreMemory falhou:', err.message)
      })
    }

    return {
      operationId: op.id,
      output: finalReply,
      tokensUsed: totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      durationMs,
      status: 'COMPLETED',
    }
  } catch (err: any) {
    const durationMs = Date.now() - start
    const errorMsg = err.message?.slice(0, 4000) ?? String(err).slice(0, 4000)
    await prisma.fleetOperation.update({
      where: { id: op.id },
      data: {
        status: 'FAILED',
        error: errorMsg,
        toolsCalled: toJsonSafe(executedTools),
        durationMs,
        finishedAt: new Date(),
      },
    }).catch(() => {})
    return {
      operationId: op.id,
      output: '',
      tokensUsed: totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      durationMs,
      status: 'FAILED',
      error: errorMsg,
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// CHAT (admin ↔ membro)
// ──────────────────────────────────────────────────────────────────────

export async function getOrCreateChat(params: {
  companyId: string
  memberId: string
  userId: string
  chatId?: string
}): Promise<{ id: string; created: boolean }> {
  if (params.chatId) {
    const existing = await prisma.fleetChat.findFirst({
      where: { id: params.chatId, companyId: params.companyId, userId: params.userId, memberId: params.memberId },
      select: { id: true },
    })
    if (existing) return { id: existing.id, created: false }
  }
  const created = await prisma.fleetChat.create({
    data: { companyId: params.companyId, memberId: params.memberId, userId: params.userId },
    select: { id: true },
  })
  prisma.fleetMember.update({
    where: { id: params.memberId },
    data: { totalChats: { increment: 1 } },
  }).catch(() => {})

  // Se o membro ainda não foi onboardado, grava saudação inicial automática
  // (estilo Hermes: agente fala primeiro perguntando como deve trabalhar)
  try {
    const member = await prisma.fleetMember.findUnique({
      where: { id: params.memberId },
      select: { name: true, displayRole: true, onboarded: true },
    })
    if (member && !member.onboarded) {
      const greeting = generateOnboardingGreeting({ name: member.name, displayRole: member.displayRole })
      await prisma.fleetMessage.create({
        data: { chatId: created.id, role: 'ASSISTANT', content: greeting },
      })
      await prisma.fleetChat.update({
        where: { id: created.id },
        data: { title: `Setup de ${member.name}`, totalMessages: { increment: 1 } },
      }).catch(() => {})
    }
  } catch (err) {
    console.warn('[Fleet] Falha ao gerar saudação de onboarding:', (err as Error).message)
  }

  return { id: created.id, created: true }
}

export async function sendChatMessage(params: {
  companyId: string
  userId: string
  memberId: string
  chatId?: string
  message: string
  thinkingMode?: boolean
}) {
  const member = await prisma.fleetMember.findFirst({
    where: { id: params.memberId, companyId: params.companyId },
    select: { id: true },
  })
  if (!member) throw new Error('Membro não encontrado')

  const { id: chatId } = await getOrCreateChat({
    companyId: params.companyId,
    memberId: params.memberId,
    userId: params.userId,
    chatId: params.chatId,
  })

  const userMsg = await prisma.fleetMessage.create({
    data: { chatId, role: 'USER', content: params.message },
    select: { id: true },
  })

  const count = await prisma.fleetMessage.count({ where: { chatId } })
  if (count === 1) {
    const title = params.message.slice(0, 60).trim()
    prisma.fleetChat.update({ where: { id: chatId }, data: { title } }).catch(() => {})
  }

  // Captura o id da operação assim que a executeRun criá-la, e dispara em background.
  // O HTTP retorna imediatamente — o frontend faz polling de mensagens / runtime-status.
  // Isso garante que: (a) fechar a aba não interrompe; (b) reabrir mostra continuação ao vivo.
  const operationDeferred = createDeferred<string>()

  // Helper que persiste cada bolha (texto intermediário) como FleetMessage independente
  const onAssistantBubble = async ({ content }: { content: string; sequence: number }): Promise<string | null> => {
    try {
      const m = await prisma.fleetMessage.create({
        data: { chatId, role: 'ASSISTANT', content },
        select: { id: true },
      })
      await prisma.fleetChat.update({
        where: { id: chatId },
        data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
      }).catch(() => {})
      return m.id
    } catch (e) {
      console.warn('[Fleet] Falha ao persistir bolha:', (e as Error).message)
      return null
    }
  }

  const onToolMessage = async (params: {
    content: string
    toolName: string
    toolInput: Record<string, any>
    toolOutput: any
    toolSuccess: boolean
    durationMs: number
  }): Promise<string | null> => {
    try {
      const m = await prisma.fleetMessage.create({
        data: {
          chatId,
          role: 'TOOL',
          content: params.content,
          toolName: params.toolName,
          toolInput: toJsonSafe(params.toolInput),
          toolOutput: toJsonSafe(params.toolOutput),
          toolSuccess: params.toolSuccess,
          durationMs: params.durationMs,
        },
        select: { id: true },
      })
      await prisma.fleetChat.update({
        where: { id: chatId },
        data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
      }).catch(() => {})
      return m.id
    } catch (e) {
      console.warn('[Fleet] Falha ao persistir tool:', (e as Error).message)
      return null
    }
  }

  // Run em background — NÃO await aqui
  ;(async () => {
    try {
      const result = await executeRunWithOpRef({
        memberId: params.memberId,
        instruction: params.message,
        trigger: 'CHAT',
        chatId,
        thinkingMode: params.thinkingMode,
        onAssistantBubble,
        onToolMessage,
        opIdResolver: (id) => operationDeferred.resolve(id),
      })

      // Se o loop terminou sem nenhuma bolha (ex: erro precoce), persiste o erro/mensagem
      if (result.status === 'FAILED') {
        await prisma.fleetMessage.create({
          data: { chatId, role: 'SYSTEM', content: `❌ Erro: ${result.error}` },
        }).catch(() => {})
        await prisma.fleetChat.update({
          where: { id: chatId },
          data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
        }).catch(() => {})
      }

      await prisma.fleetChat.update({
        where: { id: chatId },
        data: { totalTokens: { increment: BigInt(result.tokensUsed || 0) }, updatedAt: new Date() },
      }).catch(() => {})
    } catch (err: any) {
      console.error('[Fleet] sendChatMessage background error:', err)
      await prisma.fleetMessage.create({
        data: { chatId, role: 'SYSTEM', content: `❌ Erro inesperado: ${err.message || String(err)}` },
      }).catch(() => {})
    }
  })().catch(err => console.error('[Fleet] background fatal:', err))

  // Aguarda APENAS a criação da FleetOperation (instantânea) antes de responder.
  const operationId = await Promise.race([
    operationDeferred.promise,
    new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000)),
  ])

  await prisma.fleetChat.update({
    where: { id: chatId },
    data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
  }).catch(() => {})

  return {
    chatId,
    userMessageId: userMsg.id,
    operationId,
    status: 'RUNNING' as const,
  }
}

function createFleetChatCallbacks(chatId: string) {
  const onAssistantBubble = async ({ content }: { content: string; sequence: number }): Promise<string | null> => {
    try {
      const m = await prisma.fleetMessage.create({
        data: { chatId, role: 'ASSISTANT', content },
        select: { id: true },
      })
      await prisma.fleetChat.update({
        where: { id: chatId },
        data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
      }).catch(() => {})
      return m.id
    } catch (e) {
      console.warn('[Fleet] Falha ao persistir bolha:', (e as Error).message)
      return null
    }
  }

  const onToolMessage = async (params: {
    content: string
    toolName: string
    toolInput: Record<string, any>
    toolOutput: any
    toolSuccess: boolean
    durationMs: number
  }): Promise<string | null> => {
    try {
      const m = await prisma.fleetMessage.create({
        data: {
          chatId,
          role: 'TOOL',
          content: params.content,
          toolName: params.toolName,
          toolInput: toJsonSafe(params.toolInput),
          toolOutput: toJsonSafe(params.toolOutput),
          toolSuccess: params.toolSuccess,
          durationMs: params.durationMs,
        },
        select: { id: true },
      })
      await prisma.fleetChat.update({
        where: { id: chatId },
        data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
      }).catch(() => {})
      return m.id
    } catch (e) {
      console.warn('[Fleet] Falha ao persistir tool:', (e as Error).message)
      return null
    }
  }

  return { onAssistantBubble, onToolMessage }
}

export async function approveOperation(params: {
  companyId: string
  userId: string
  operationId: string
  instruction?: string
}) {
  const op = await prisma.fleetOperation.findFirst({
    where: { id: params.operationId, companyId: params.companyId, status: 'AWAITING_APPROVAL' },
    select: { id: true, memberId: true, missionId: true, chatId: true, trigger: true, instruction: true, chat: { select: { userId: true } } },
  })
  if (!op) throw new Error('Operação aguardando aprovação não encontrada')
  if (op.chat && op.chat.userId !== params.userId) throw new Error('Operação pertence a outro chat')

  const instruction = params.instruction?.trim() || op.instruction
  await prisma.fleetOperation.update({
    where: { id: op.id },
    data: { approvedBy: params.userId, approvedAt: new Date(), rejectedReason: null },
  })

  if (op.chatId) {
    await prisma.fleetMessage.create({
      data: { chatId: op.chatId, role: 'SYSTEM', content: 'Aprovado pelo administrador. Retomando a execução.' },
    }).catch(() => {})
    await prisma.fleetChat.update({
      where: { id: op.chatId },
      data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
    }).catch(() => {})
  }

  ;(async () => {
    const callbacks = op.chatId ? createFleetChatCallbacks(op.chatId) : {}
    const result = await executeRun({
      operationId: op.id,
      memberId: op.memberId,
      missionId: op.missionId || undefined,
      chatId: op.chatId || undefined,
      instruction,
      trigger: op.trigger,
      approvalGranted: true,
      ...callbacks,
    })
    if (op.chatId) {
      await prisma.fleetChat.update({
        where: { id: op.chatId },
        data: { totalTokens: { increment: BigInt(result.tokensUsed || 0) }, updatedAt: new Date() },
      }).catch(() => {})
    }
  })().catch(async err => {
    console.error('[Fleet] approveOperation background error:', err)
    await prisma.fleetOperation.update({
      where: { id: op.id },
      data: { status: 'FAILED', error: err?.message || String(err), finishedAt: new Date() },
    }).catch(() => {})
  })

  return { operationId: op.id, status: 'RUNNING' as const }
}

export async function rejectOperation(params: {
  companyId: string
  userId: string
  operationId: string
  reason?: string
}) {
  const op = await prisma.fleetOperation.findFirst({
    where: { id: params.operationId, companyId: params.companyId, status: 'AWAITING_APPROVAL' },
    select: { id: true, chatId: true, chat: { select: { userId: true } } },
  })
  if (!op) throw new Error('Operação aguardando aprovação não encontrada')
  if (op.chat && op.chat.userId !== params.userId) throw new Error('Operação pertence a outro chat')

  const reason = params.reason?.trim() || 'Rejeitada pelo administrador'
  await prisma.fleetOperation.update({
    where: { id: op.id },
    data: { status: 'REJECTED', rejectedReason: reason, finishedAt: new Date() },
  })
  if (op.chatId) {
    await prisma.fleetMessage.create({
      data: { chatId: op.chatId, role: 'SYSTEM', content: `Operação rejeitada: ${reason}` },
    }).catch(() => {})
    await prisma.fleetChat.update({
      where: { id: op.chatId },
      data: { totalMessages: { increment: 1 }, updatedAt: new Date() },
    }).catch(() => {})
  }
  return { operationId: op.id, status: 'REJECTED' as const }
}

// Helper para sinalizar a criação do operationId entre a task em background e o handler HTTP
function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

// Variante de executeRun que expe o operationId via callback assim que criá-lo,
// permitindo que o handler HTTP retorne imediatamente.
async function executeRunWithOpRef(input: FleetRunInput & { opIdResolver?: (id: string) => void }): Promise<FleetRunOutput> {
  return executeRun({ ...input })
}

/**
 * Retorna o status "em execução" do chat — usado pelo frontend pra saber se
 * deve continuar fazendo polling/mostrar indicador "pensando".
 */
export async function getChatRuntimeStatus(params: { companyId: string; userId: string; chatId: string }) {
  const chat = await prisma.fleetChat.findFirst({
    where: { id: params.chatId, companyId: params.companyId, userId: params.userId },
    select: { id: true },
  })
  if (!chat) throw new Error('Chat não encontrado')

  const runningOp = await prisma.fleetOperation.findFirst({
    where: { chatId: params.chatId, status: { in: ['PENDING', 'RUNNING', 'AWAITING_APPROVAL'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, startedAt: true, createdAt: true, toolsCalled: true, proposedActions: true, criticReview: true },
  })

  const executedTools = normalizeExecutedTools(runningOp?.toolsCalled)
  const latestTool = executedTools[executedTools.length - 1] || null

  return {
    running: runningOp?.status === 'PENDING' || runningOp?.status === 'RUNNING',
    awaitingApproval: runningOp?.status === 'AWAITING_APPROVAL',
    operationId: runningOp?.id ?? null,
    status: runningOp?.status ?? null,
    startedAt: runningOp?.startedAt ?? runningOp?.createdAt ?? null,
    proposedActions: runningOp?.proposedActions ?? null,
    approvalRiskLevel: runningOp?.criticReview?.riskLevel ?? null,
    approvalRationale: runningOp?.criticReview?.rationale ?? null,
    toolsExecuted: executedTools.length,
    latestToolName: latestTool?.toolName ?? null,
    latestToolSuccess: latestTool?.toolSuccess ?? null,
    latestSummary: latestTool ? summarizeToolEvent(latestTool) : null,
    recentTools: buildRuntimeToolSnapshots(executedTools),
  }
}

// ──────────────────────────────────────────────────────────────────────
// CRUD: Members (cérebro próprio)
// ──────────────────────────────────────────────────────────────────────

export interface CreateMemberInput {
  companyId: string
  name: string
  displayRole: string
  providerId: string
  model: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  toolsConfig?: any
  departmentId?: string
  avatarUrl?: string
  emoji?: string
  colorTag?: string
  assignedRoleId?: string
  allowAutonomousActions?: boolean
  notificationUserIds?: string[]
}

export async function createMember(input: CreateMemberInput) {
  const provider = await prisma.aIProvider.findFirst({
    where: { id: input.providerId, companyId: input.companyId },
    select: { id: true, isActive: true },
  })
  if (!provider) throw new Error('Provider AI não encontrado')

  return prisma.fleetMember.create({
    data: {
      companyId: input.companyId,
      name: input.name,
      displayRole: input.displayRole,
      providerId: input.providerId,
      model: input.model,
      systemPrompt: input.systemPrompt && input.systemPrompt.trim().length > 0
        ? input.systemPrompt
        : '(será configurado via chat de onboarding)',
      onboarded: input.systemPrompt && input.systemPrompt.trim().length > 0 ? true : false,
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens ?? 2000,
      topP: input.topP ?? null,
      toolsConfig: input.toolsConfig ?? DEFAULT_FLEET_TOOLS_CONFIG,
      departmentId: input.departmentId || null,
      avatarUrl: input.avatarUrl || null,
      emoji: input.emoji || null,
      colorTag: input.colorTag || null,
      assignedRoleId: input.assignedRoleId || null,
      allowAutonomousActions: input.allowAutonomousActions ?? true,
      notificationUserIds: input.notificationUserIds || [],
    },
    include: {
      provider: { select: { id: true, name: true, type: true, model: true } },
      department: { select: { id: true, name: true, color: true, icon: true } },
    },
  })
}

export async function listMembers(companyId: string, opts?: { departmentId?: string; status?: string }) {
  const where: any = { companyId }
  if (opts?.departmentId) where.departmentId = opts.departmentId
  if (opts?.status) where.status = opts.status
  return prisma.fleetMember.findMany({
    where,
    include: {
      provider: { select: { id: true, name: true, type: true, model: true } },
      department: { select: { id: true, name: true, color: true, icon: true } },
      role: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function getMember(companyId: string, memberId: string) {
  return prisma.fleetMember.findFirst({
    where: { id: memberId, companyId },
    include: {
      provider: { select: { id: true, name: true, type: true, model: true, enabledModels: true } },
      department: true,
      role: { select: { id: true, name: true, slug: true } },
      missions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
}

export async function updateMember(companyId: string, memberId: string, data: Partial<CreateMemberInput> & { status?: any }) {
  const exists = await prisma.fleetMember.findFirst({ where: { id: memberId, companyId }, select: { id: true } })
  if (!exists) throw new Error('Membro não encontrado')

  const updateData: any = {}
  const fields: (keyof CreateMemberInput)[] = [
    'name', 'displayRole', 'providerId', 'model', 'systemPrompt', 'temperature', 'maxTokens', 'topP',
    'toolsConfig', 'departmentId', 'avatarUrl', 'emoji', 'colorTag', 'assignedRoleId',
    'allowAutonomousActions', 'notificationUserIds',
  ]
  for (const f of fields) {
    if (data[f] !== undefined) updateData[f] = data[f] as any
  }
  if (data.status) updateData.status = data.status

  return prisma.fleetMember.update({
    where: { id: memberId },
    data: updateData,
    include: {
      provider: { select: { id: true, name: true, type: true, model: true } },
      department: true,
    },
  })
}

export async function deleteMember(companyId: string, memberId: string) {
  const exists = await prisma.fleetMember.findFirst({ where: { id: memberId, companyId }, select: { id: true } })
  if (!exists) throw new Error('Membro não encontrado')
  await prisma.fleetMember.delete({ where: { id: memberId } })
}

// ──────────────────────────────────────────────────────────────────────
// CRUD: Departments
// ──────────────────────────────────────────────────────────────────────

export async function listDepartments(companyId: string) {
  return prisma.fleetDepartment.findMany({
    where: { companyId },
    orderBy: { order: 'asc' },
    include: { _count: { select: { members: true } } },
  })
}

export async function createDepartment(input: {
  companyId: string
  name: string
  description?: string
  icon?: string
  color?: string
  order?: number
}) {
  return prisma.fleetDepartment.create({
    data: {
      companyId: input.companyId,
      name: input.name,
      description: input.description || null,
      icon: input.icon || null,
      color: input.color || null,
      order: input.order ?? 0,
    },
  })
}

export async function updateDepartment(companyId: string, id: string, data: Partial<{ name: string; description: string; icon: string; color: string; order: number }>) {
  const exists = await prisma.fleetDepartment.findFirst({ where: { id, companyId }, select: { id: true } })
  if (!exists) throw new Error('Setor não encontrado')
  return prisma.fleetDepartment.update({ where: { id }, data })
}

export async function deleteDepartment(companyId: string, id: string) {
  const exists = await prisma.fleetDepartment.findFirst({ where: { id, companyId }, select: { id: true } })
  if (!exists) throw new Error('Setor não encontrado')
  await prisma.fleetDepartment.delete({ where: { id } })
}

// ──────────────────────────────────────────────────────────────────────
// CRUD: Missions
// ──────────────────────────────────────────────────────────────────────

export interface CreateMissionInput {
  companyId: string
  memberId: string
  title: string
  description?: string
  instruction: string
  cronExpr?: string
  cronNl?: string
  cronTimezone?: string
  runOnceAt?: string
  executionMode?: 'AUTONOMOUS' | 'REQUIRE_APPROVAL'
  maxRuns?: number
  notifyOnSuccess?: boolean
  notifyOnFailure?: boolean
  notifyUserIds?: string[]
  createdBy?: string
}

export async function createMission(input: CreateMissionInput) {
  const member = await prisma.fleetMember.findFirst({ where: { id: input.memberId, companyId: input.companyId }, select: { id: true } })
  if (!member) throw new Error('Membro não encontrado')
  const cronTimezone = input.cronTimezone || DEFAULT_CRON_TIMEZONE

  let cronExpr: string | null = null
  let cronNlOriginal: string | null = null
  let nextRunAt: Date | null = null
  let runOnceAt: Date | null = null

  if (input.runOnceAt) {
    runOnceAt = parseDateTimeInTimeZone(input.runOnceAt, cronTimezone)
    if (!runOnceAt || isNaN(runOnceAt.getTime())) throw new Error('runOnceAt inválido')
    nextRunAt = runOnceAt
  } else if (input.cronExpr) {
    if (!isValidCron(input.cronExpr)) throw new Error(`Expressão cron inválida: "${input.cronExpr}"`)
    cronExpr = input.cronExpr
    nextRunAt = getNextRunAt(cronExpr, new Date(), cronTimezone)
  } else if (input.cronNl) {
    const heur = tryHeuristicCron(input.cronNl)
    if (!heur) throw new Error(`Não consegui interpretar a recorrência: "${input.cronNl}". Tente "todo dia 9h" ou forneça em formato cron.`)
    cronExpr = heur.cronExpr
    cronNlOriginal = input.cronNl
    nextRunAt = getNextRunAt(cronExpr, new Date(), cronTimezone)
  }

  const mission = await prisma.fleetMission.create({
    data: {
      companyId: input.companyId,
      memberId: input.memberId,
      title: input.title,
      description: input.description || null,
      instruction: input.instruction,
      cronExpr,
      cronNlOriginal,
      cronTimezone,
      runOnceAt,
      nextRunAt,
      executionMode: input.executionMode || 'AUTONOMOUS',
      maxRuns: input.maxRuns ?? null,
      notifyOnSuccess: input.notifyOnSuccess ?? false,
      notifyOnFailure: input.notifyOnFailure ?? true,
      notifyUserIds: input.notifyUserIds || [],
      createdBy: input.createdBy || null,
    },
  })

  prisma.fleetMember.update({ where: { id: input.memberId }, data: { totalMissions: { increment: 1 } } }).catch(() => {})
  return mission
}

export async function listMissions(companyId: string, opts?: { memberId?: string; status?: string }) {
  const where: any = { companyId }
  if (opts?.memberId) where.memberId = opts.memberId
  if (opts?.status) where.status = opts.status
  return prisma.fleetMission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      member: { select: { id: true, name: true, displayRole: true, avatarUrl: true, emoji: true } },
    },
  })
}

export async function updateMission(companyId: string, id: string, data: Partial<CreateMissionInput & { status: any; enabled: boolean }>) {
  const exists = await prisma.fleetMission.findFirst({ where: { id, companyId } })
  if (!exists) throw new Error('Missão não encontrada')
  const cronTimezone = data.cronTimezone !== undefined
    ? (data.cronTimezone || DEFAULT_CRON_TIMEZONE)
    : (exists.cronTimezone || DEFAULT_CRON_TIMEZONE)

  const update: any = {}
  if (data.title !== undefined) update.title = data.title
  if (data.description !== undefined) update.description = data.description
  if (data.instruction !== undefined) update.instruction = data.instruction
  if (data.executionMode) update.executionMode = data.executionMode
  if (data.maxRuns !== undefined) update.maxRuns = data.maxRuns
  if (data.notifyOnSuccess !== undefined) update.notifyOnSuccess = data.notifyOnSuccess
  if (data.notifyOnFailure !== undefined) update.notifyOnFailure = data.notifyOnFailure
  if (data.notifyUserIds !== undefined) update.notifyUserIds = data.notifyUserIds
  if (data.status) update.status = data.status
  if (data.cronTimezone !== undefined) update.cronTimezone = cronTimezone

  if (data.cronExpr !== undefined) {
    if (data.cronExpr && !isValidCron(data.cronExpr)) throw new Error(`Expressão cron inválida: "${data.cronExpr}"`)
    update.cronExpr = data.cronExpr || null
    update.nextRunAt = data.cronExpr ? getNextRunAt(data.cronExpr, new Date(), cronTimezone) : null
    update.cronNlOriginal = null
  } else if (data.cronNl !== undefined) {
    const heur = tryHeuristicCron(data.cronNl)
    if (!heur) throw new Error(`Não consegui interpretar a recorrência: "${data.cronNl}".`)
    update.cronExpr = heur.cronExpr
    update.cronNlOriginal = data.cronNl
    update.nextRunAt = getNextRunAt(heur.cronExpr, new Date(), cronTimezone)
  } else if (data.cronTimezone !== undefined && exists.cronExpr) {
    update.nextRunAt = getNextRunAt(exists.cronExpr, new Date(), cronTimezone)
  }
  if (data.runOnceAt !== undefined) {
    const d = data.runOnceAt ? parseDateTimeInTimeZone(data.runOnceAt, cronTimezone) : null
    if (data.runOnceAt && !d) throw new Error('runOnceAt inválido')
    update.runOnceAt = d
    if (d) update.nextRunAt = d
  }

  return prisma.fleetMission.update({ where: { id }, data: update })
}

export async function deleteMission(companyId: string, id: string) {
  const exists = await prisma.fleetMission.findFirst({ where: { id, companyId }, select: { id: true } })
  if (!exists) throw new Error('Missão não encontrada')
  await prisma.fleetMission.delete({ where: { id } })
}

export async function executeMission(missionId: string, opts?: { manualUserId?: string }): Promise<string> {
  const mission = await prisma.fleetMission.findUnique({
    where: { id: missionId },
    include: { member: { select: { id: true, status: true } } },
  })
  if (!mission) throw new Error('Missão não encontrada')
  if (mission.status !== 'ACTIVE') throw new Error(`Missão está ${mission.status}`)
  if (mission.member.status !== 'ACTIVE') throw new Error(`Membro está ${mission.member.status}`)
  if (mission.maxRuns && mission.totalRuns >= mission.maxRuns) throw new Error('Missão atingiu maxRuns')

  const result = await executeRun({
    memberId: mission.memberId,
    instruction: mission.instruction,
    trigger: opts?.manualUserId ? 'MANUAL' : 'SCHEDULED',
    missionId: mission.id,
  })

  const updates: any = { totalRuns: { increment: 1 }, lastRunAt: new Date() }
  if (result.status === 'COMPLETED') updates.successRuns = { increment: 1 }
  else updates.failedRuns = { increment: 1 }

  if (mission.runOnceAt) {
    updates.status = 'ARCHIVED' as any
    updates.nextRunAt = null
  } else if (mission.cronExpr) {
    updates.nextRunAt = getNextRunAt(mission.cronExpr, new Date(), mission.cronTimezone || DEFAULT_CRON_TIMEZONE)
  }
  if (mission.maxRuns && mission.totalRuns + 1 >= mission.maxRuns) {
    updates.status = 'ARCHIVED' as any
    updates.nextRunAt = null
  }

  await prisma.fleetMission.update({ where: { id: mission.id }, data: updates }).catch(() => {})
  return result.operationId
}

// ──────────────────────────────────────────────────────────────────────
// Listagens
// ──────────────────────────────────────────────────────────────────────

const MAX_SPAWN_DEPTH = 2      // pai → filho → neto (profundidade 2 máx)
const MAX_SPAWN_FANOUT = 5     // máx 5 filhos ativos simultaneamente por pai
const SPAWN_TIMEOUT_MS = 120_000

/**
 * Onda 2.4 — Lança uma sub-operation em outro (ou no mesmo) FleetMember.
 * Chamado pela tool `spawn_subagent` em fleet-admin.module.ts.
 * Proteções: max depth 2, max fanout 5, timeout 120s.
 */
export async function spawnSubOperation(params: {
  parentOperationId: string
  parentDepth: number
  targetMemberId: string
  instruction: string
  companyId: string // validação de segurança — membro deve pertencer à mesma empresa
}): Promise<{
  operationId: string
  output: string
  status: FleetRunOutput['status']
  tokensUsed: number
  targetMember: { id: string; name: string }
}> {
  const { parentOperationId, parentDepth, targetMemberId, instruction, companyId } = params

  if (parentDepth >= MAX_SPAWN_DEPTH) {
    throw new Error(`Profundidade máxima (${MAX_SPAWN_DEPTH}) atingida — não é possível criar mais sub-operações.`)
  }

  // Verifica membro alvo pertence à mesma empresa
  const targetMember = await prisma.fleetMember.findFirst({
    where: { id: targetMemberId, companyId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })
  if (!targetMember) throw new Error(`Membro alvo "${targetMemberId}" não encontrado ou inativo nesta empresa.`)

  // Verifica fanout — quantas sub-ops deste pai ainda estão RUNNING/PENDING
  const activeChildren = await prisma.fleetOperation.count({
    where: { parentOperationId, status: { in: ['RUNNING', 'PENDING'] } },
  })
  if (activeChildren >= MAX_SPAWN_FANOUT) {
    throw new Error(`Limite de ${MAX_SPAWN_FANOUT} sub-operações simultâneas atingido para esta operação pai.`)
  }

  // Executa com timeout
  const childDepth = parentDepth + 1
  const runPromise = executeRun({
    memberId: targetMemberId,
    instruction,
    trigger: 'MANUAL',
    parentOperationId,
    depth: childDepth,
  })

  let result: FleetRunOutput
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout após ${SPAWN_TIMEOUT_MS / 1000}s`)), SPAWN_TIMEOUT_MS)
  )

  result = await Promise.race([runPromise, timeoutPromise]) as FleetRunOutput

  return {
    operationId: result.operationId,
    output: result.output,
    status: result.status,
    tokensUsed: result.tokensUsed,
    targetMember: { id: targetMember.id, name: targetMember.name },
  }
}

export async function listChats(companyId: string, userId: string, opts?: { memberId?: string }) {
  const where: any = { companyId, userId, archivedAt: null }
  if (opts?.memberId) where.memberId = opts.memberId
  return prisma.fleetChat.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      member: { select: { id: true, name: true, displayRole: true, avatarUrl: true, emoji: true, colorTag: true } },
    },
  })
}

export async function getChatMessages(companyId: string, userId: string, chatId: string, limit = 100) {
  const chat = await prisma.fleetChat.findFirst({
    where: { id: chatId, companyId, userId },
    select: { id: true, title: true, memberId: true },
  })
  if (!chat) throw new Error('Chat não encontrado')
  const messages = await prisma.fleetMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  return { chat, messages }
}

export async function archiveChat(companyId: string, userId: string, chatId: string) {
  await prisma.fleetChat.updateMany({
    where: { id: chatId, companyId, userId },
    data: { archivedAt: new Date() },
  })
}

export async function listOperations(companyId: string, opts?: { memberId?: string; missionId?: string; status?: string; limit?: number }) {
  const where: any = { companyId }
  if (opts?.memberId) where.memberId = opts.memberId
  if (opts?.missionId) where.missionId = opts.missionId
  if (opts?.status) where.status = opts.status
  return prisma.fleetOperation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts?.limit || 50, 200),
    include: {
      member: { select: { id: true, name: true, displayRole: true, avatarUrl: true, emoji: true } },
      mission: { select: { id: true, title: true } },
    },
  })
}

// ──────────────────────────────────────────────────────────────────────
// Scheduler tick
// ──────────────────────────────────────────────────────────────────────

export async function runDueMissions(now: Date = new Date()): Promise<{ fired: number; errors: number }> {
  const due = await prisma.fleetMission.findMany({
    where: { status: 'ACTIVE', nextRunAt: { lte: now, not: null } },
    take: 50,
    select: { id: true, title: true },
  })

  let fired = 0
  let errors = 0
  for (const m of due) {
    try { await executeMission(m.id); fired++ }
    catch (e) { errors++; console.error(`[Fleet] Falha missão ${m.id} (${m.title}):`, (e as Error).message) }
  }
  return { fired, errors }
}

// Garante que o registry esteja importado (side-effect de registro de módulos)
void toolRegistry
