/**
 * Agent Builder - Padrão do evo-ai adaptado para TypeScript/CRM
 * 
 * Responsável por:
 * 1. Montar tools via ToolEngine (HTTP + CRM + MCP)
 * 2. Montar system prompt com role/goal/variáveis temporais
 * 3. Executar tool calls em loop (function calling) com logging
 * 4. Orquestrar sub-agentes (sequential)
 */

import { prisma } from '../../config/database.js'
import { createProvider } from './providers/index.js'
import type { AIToolDefinition, AICompletionResult, IAIProvider } from './providers/base.provider.js'
import type { AIMessage as ProviderMessage } from './providers/base.provider.js'
import { ToolEngine, initMCPServers } from './tools/index.js'
import { resetSubAgentCounter } from './tools/modules/index.js'
import type { AgentToolsConfig } from './tools/tool-builder.js'
// Nota: retrieval RAG agora é agêntico (via tool `search_knowledge_base` no knowledge.module.ts).
// O retrieval automático foi removido para evitar custos em toda mensagem.
import { INTERACTIVE_SYSTEM_PROMPT_DOCS } from '../messages/interactive-messages.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from './ai.service.js'
import { selectBestProvider } from './smart-router.js'
import { selectActiveSkills, formatSkillsForPrompt, markSkillsUsed, type ActiveSkill } from './skills/skills.service.js'
import { composeSystemPrompt, type PromptLayer } from './prompt-layers.js'
import { extractConversationState, formatStateForPrompt } from './state-extractor.service.js'

const MAX_TOOL_ITERATIONS = 10  // Limite de loops de function calling

// ============================================
// TIPOS
// ============================================

interface AgentContext {
  companyId: string
  instanceId: string
  remoteJid: string
  contactName?: string
}

interface BuildResult {
  provider: IAIProvider
  providerId: string
  model: string
  systemPrompt: string
  promptLayers: PromptLayer[]
  alwaysOnSkills: ActiveSkill[]
  tools: AIToolDefinition[]
  toolTypeMap: Map<string, { type: string; config: any }>
  toolContext: import('./tools/tool-engine.js').ToolExecutionContext
  maxTokens: number
  temperature: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  responseMode?: 'precise' | 'balanced' | 'creative'
  toolForcing?: { enabled: boolean; keywords?: string[] }
  knowledgeBaseCount?: number
  outputMode?: 'text' | 'json' | 'json_schema'
}

// ============================================
// BUILD AGENT - Monta tudo a partir do DB
// ============================================

export async function buildAgent(
  agentId: string,
  context: AgentContext,
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>,
  parentDepth: number = 0,
): Promise<BuildResult> {
  const isTestContext = context.instanceId === '__test__'
  const agent = await prisma.aIAgent.findFirst({
    where: {
      id: agentId,
      companyId: context.companyId,
      ...(isTestContext ? {} : { status: 'ACTIVE' }),
    },
    include: {
      provider: true,
      knowledgeBases: {
        include: { knowledgeBase: true },
        where: { knowledgeBase: { isActive: true } },
      },
    },
  })

  if (!agent) throw new Error('Agente não encontrado ou inativo')

  // 1. Criar provider (Smart Routing ou fixo)
  let selectedProvider = agent.provider
  let selectedModel = agent.model || agent.provider.model

  if ((agent as any).useSmartRouting) {
    try {
      const routing = await selectBestProvider({
        companyId: context.companyId,
        strategy: (agent as any).routingStrategy || 'BEST_PERFORMANCE',
        allowedProviderIds: (agent as any).routingProviderIds?.length > 0
          ? (agent as any).routingProviderIds
          : undefined,
      })
      if (routing) {
        const smartProvider = await prisma.aIProvider.findUnique({ where: { id: routing.providerId } })
        if (smartProvider) {
          selectedProvider = smartProvider
          selectedModel = routing.model
          console.log(`[Agent Builder] Smart Routing: selecionou provider "${smartProvider.name}" modelo ${routing.model} — ${routing.reason}`)
        }
      }
    } catch (err) {
      console.warn('[Agent Builder] Smart Routing falhou, usando provider fixo:', (err as Error).message)
    }
  }

  // Para providers OAuth de token curto (GitHub Copilot ~30min) faz refresh automático.
  // Para os demais retorna igual a decryptProviderSecrets.
  const decryptedProvider = await getProviderWithFreshToken(selectedProvider.id, context.companyId)
    || decryptProviderSecrets(selectedProvider)
  const provider = createProvider(
    decryptedProvider.type,
    decryptedProvider.apiKey,
    decryptedProvider.baseUrl,
    decryptedProvider.oauthData
  )

  // 2. Montar system prompt (igual evo-ai: variáveis + role + goal)
  const systemPrompt = buildSystemPrompt(agent, context)

  // 2b. Daily Brain — injeta contexto de longo prazo do contato (resumos + fatos do digest noturno)
  const brainContext = await loadDailyBrainContextForPrompt(context.companyId, context.remoteJid)

  // 2c. Lições aprendidas (memória procedural do agente) — top N mais confiáveis/usadas
  let learningsContext = ''
  try {
    const top = await prisma.aIAgentLearning.findMany({
      where: { companyId: context.companyId, agentId: agent.id, active: true },
      orderBy: [{ confidence: 'desc' }, { appliedCount: 'desc' }],
      take: 15,
      select: { id: true, trigger: true, lesson: true, category: true, confidence: true },
    })
    if (top.length > 0) {
      const lines = top
        .map(l => `- [${l.category}] QUANDO: ${l.trigger} → FAZER: ${l.lesson} (conf ${(l.confidence * 100).toFixed(0)}%)`)
        .join('\n')
      learningsContext = `<agent_procedural_memory>\nLIÇÕES APRENDIDAS (aplique automaticamente quando o "QUANDO" se encaixar; estas são suas próprias regras descobertas em interações anteriores):\n${lines}\n</agent_procedural_memory>`
      // Incrementa appliedCount em batch (best-effort)
      prisma.aIAgentLearning.updateMany({
        where: { id: { in: top.map(l => l.id) } },
        data: { appliedCount: { increment: 1 }, lastUsedAt: new Date() },
      }).catch(() => {})
    }
  } catch (err) {
    console.warn('[AgentBuilder] Falha ao carregar learnings:', (err as Error).message)
  }

  // 3. Montar tools via ToolEngine modular
  const settings = (agent.settings || {}) as Record<string, any>

  // Preparar config para cada módulo
  const toolSettings: Record<string, any> = {}

  // HTTP Request tools (prioridade: campo httpTools do DB > settings.http_tools legado)
  const httpToolsConfig = (agent as any).httpTools || settings.http_tools || settings.http_request
  if (Array.isArray(httpToolsConfig) && httpToolsConfig.length > 0) {
    toolSettings.http_request = httpToolsConfig
  }

  // CRM tools — monta config sandbox a partir de crmToolsConfig + settings.crm_tools
  const crmToolsRaw = settings.crm_tools
  const crmSandboxRaw = (agent as any).crmToolsConfig as Record<string, any> | null | undefined
  if (crmToolsRaw !== undefined || crmSandboxRaw) {
    // Se há sandbox config no DB, usa como config completo do módulo CRM
    if (crmSandboxRaw && typeof crmSandboxRaw === 'object') {
      toolSettings.crm = crmSandboxRaw
    } else {
      // Legado: array de tool names ou true/false
      toolSettings.crm = crmToolsRaw
    }
  }

  // Calendar tools — disponível quando agent.calendarConfig.integrationId estiver setado
  const calendarConfig = (agent as any).calendarConfig as Record<string, any> | null | undefined
  if (calendarConfig && typeof calendarConfig === 'object' && calendarConfig.integrationId) {
    toolSettings.calendar = calendarConfig
  }

  // MCP servers — carrega da empresa, filtrados pelos mcpServerIds do agente
  try {
    const agentMcpIds = (agent as any).mcpServerIds || []
    const mcpConfigs = await initMCPServers(context.companyId)
    if (mcpConfigs.length > 0) {
      // Se o agente tem MCP servers específicos, filtra. Senão, usa todos
      const filtered = agentMcpIds.length > 0
        ? mcpConfigs.filter((c: any) => agentMcpIds.includes(c.id))
        : mcpConfigs
      if (filtered.length > 0) {
        toolSettings.mcp = filtered
      }
    }
  } catch (err: any) {
    console.warn(`[Agent Builder] MCP init failed:`, err.message)
  }

  // Knowledge Base agentic tool — auto-inject quando agente tem KB vinculada.
  // Permite à IA decidir quando buscar (ex: extrair "Cane Corso" do contexto
  // mesmo quando a mensagem atual é apenas "2") em vez de depender só do RAG passivo.
  if (agent.knowledgeBases && agent.knowledgeBases.length > 0) {
    toolSettings.knowledge = { enabled: true, topK: 5, scoreThreshold: 0.4 }
  }

  // Memória explícita (estilo ChatGPT "Memória atualizada") — sempre habilitada
  // por padrão, pode ser desativada via settings.memory.enabled = false
  const memoryCfg = settings.memory && typeof settings.memory === 'object' ? settings.memory : {}
  if (memoryCfg.enabled !== false) {
    toolSettings.memory = { enabled: true }
  }

  // Lições aprendidas (memória procedural do agente) — opt-in via settings.learning.enabled = true
  const learningCfg = settings.learning && typeof settings.learning === 'object' ? settings.learning : {}
  if (learningCfg.enabled === true) {
    toolSettings.learning = { enabled: true, allowSelfLearning: learningCfg.allowSelfLearning !== false }
  }

  // Artefatos versionados — opt-in via settings.artifacts.enabled = true
  const artifactCfg = settings.artifacts && typeof settings.artifacts === 'object' ? settings.artifacts : {}
  if (artifactCfg.enabled === true) {
    toolSettings.artifact = { enabled: true, maxArtifactsPerConversation: artifactCfg.maxArtifactsPerConversation }
  }

  // Sub-agentes (Padrão A): expor outros AIAgent como tools call_subagent_<slug>
  const subAgentIds = ((agent as any).subAgentIds || []) as string[]
  if (Array.isArray(subAgentIds) && subAgentIds.length > 0) {
    try {
      const children = await prisma.aIAgent.findMany({
        where: {
          id: { in: subAgentIds },
          companyId: context.companyId,
          status: 'ACTIVE',
        },
        select: { id: true, name: true, description: true, subAgentDescription: true },
      })
      if (children.length > 0) {
        toolSettings.subagents = {
          enabled: true,
          depth: parentDepth,
          children: children.map(c => ({
            id: c.id,
            slug: (c.name || 'agent').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `a_${c.id.slice(0, 6)}`,
            name: c.name,
            description: c.subAgentDescription || c.description || `Sub-agente "${c.name}"`,
          })),
        }
      }
    } catch (err: any) {
      console.warn('[Agent Builder] Sub-agents load falhou:', err.message)
    }
  }

  // Build tools via ToolEngine
  const { tools, toolTypeMap } = ToolEngine.buildTools(toolSettings)

  const toolContext = {
    agentId,
    agentName: agent.name,
    companyId: context.companyId,
    instanceId: context.instanceId,
    remoteJid: context.remoteJid,
    triggeredBy: 'function_calling' as const,
    crmSandbox: crmSandboxRaw || undefined,
    sendMediaFn,
  }

  // ── Always-on skills (priority >= 100): carregam ANTES de qualquer mensagem
  // → fazem parte do prefixo CACHEABLE.  As skills semânticas (top-K via vector
  // search) são carregadas em runAgent() quando temos a mensagem do usuário.
  let alwaysOnSkills: ActiveSkill[] = []
  try {
    alwaysOnSkills = await selectActiveSkills({
      companyId: context.companyId,
      agentId,
      userMessage: '', // sem mensagem → só always-on
      topK: 0,
    })
  } catch (err) {
    console.warn('[Agent Builder] Skills always-on falhou:', (err as Error).message)
  }

  // Instrução de mensagens interativas — só injeta se a personalidade do agente realmente PEDE
  const promptForDetect = (systemPrompt || '').toLowerCase()
  const wantsInteractive = /\b(bot[oõã]?es?|button|lista|enquete|poll|pix|carross?[eé]l|carousel|interativ|interactive|:::interactive)\b/i.test(promptForDetect)

  // ── Prompt Layers (ordem CACHEABLE → DINÂMICO p/ Anthropic prompt cache)
  const layers: PromptLayer[] = [
    { id: 'identity', cacheable: true, content: systemPrompt },
    { id: 'always_skills', cacheable: true, content: formatSkillsForPrompt(alwaysOnSkills) },
    { id: 'interactive', cacheable: true, content: wantsInteractive ? INTERACTIVE_SYSTEM_PROMPT_DOCS : '' },
    { id: 'media', cacheable: true, content: sendMediaFn
        ? `<media>Para enviar mídia, use markdown numa linha separada: ![legenda opcional](https://url-publica/arquivo.ext). Tipo detectado pela extensão. Use só URLs reais.</media>`
        : '' },
    // Camadas dinâmicas (entram DEPOIS do cache breakpoint)
    { id: 'brain', cacheable: false, content: brainContext || '' },
    { id: 'learnings', cacheable: false, content: learningsContext || '' },
    // RAG e matched_skills são adicionados em runAgent() (precisam da mensagem do usuário)
  ]

  const composed = composeSystemPrompt(layers)

  // ── Camada 1: Response Mode preset (override de temperature/top_p)
  // Permite "Modo Fluxo" (precise) sem mexer no provider, ideal pra agentes de qualificação
  const responseMode = (settings.responseMode || 'balanced') as 'precise' | 'balanced' | 'creative'
  const presets: Record<string, { temperature: number; topP: number }> = {
    precise: { temperature: 0.2, topP: 0.5 },
    balanced: { temperature: selectedProvider.temperature ?? 0.7, topP: (selectedProvider as any).topP ?? 1 },
    creative: { temperature: 0.9, topP: 1 },
  }
  const presetCfg = presets[responseMode] || presets.balanced

  // Tool forcing: se settings.toolForcing.enabled e a mensagem do user contém algum keyword,
  // o agent-builder injeta tool_choice='required' na próxima chamada.
  const toolForcingCfg = settings.toolForcing && typeof settings.toolForcing === 'object'
    ? {
        enabled: !!settings.toolForcing.enabled,
        keywords: Array.isArray(settings.toolForcing.keywords) ? settings.toolForcing.keywords.map((k: any) => String(k).toLowerCase()) : [],
      }
    : undefined

  return {
    provider,
    providerId: selectedProvider.id,
    model: selectedModel,
    systemPrompt: composed.text,
    promptLayers: layers,
    alwaysOnSkills,
    tools,
    toolTypeMap,
    toolContext,
    knowledgeBaseCount: agent.knowledgeBases?.length ?? 0,
    maxTokens: selectedProvider.maxTokens,
    temperature: presetCfg.temperature,
    topP: presetCfg.topP,
    frequencyPenalty: (selectedProvider as any).frequencyPenalty ?? undefined,
    presencePenalty: (selectedProvider as any).presencePenalty ?? undefined,
    responseMode,
    toolForcing: toolForcingCfg,
    outputMode: (settings.outputMode as 'text' | 'json' | 'json_schema' | undefined) || 'text',
  }
}

// ============================================
// BUILD SYSTEM PROMPT - Padrão evo-ai
// ============================================

// SEC-BLOCO3: Sanitize user-controllable variables before injection into system prompt
// Prevents prompt injection via contact names or JIDs
function sanitizePromptVar(value: string, maxLen = 100): string {
  return value
    .slice(0, maxLen)
    .replace(/[<>{}]/g, '') // Remove XML/template delimiters
    .replace(/\n/g, ' ')    // Flatten newlines
    .trim()
}

// ============================================
// Daily Brain — contexto de longo prazo do contato
// ============================================

async function loadDailyBrainContextForPrompt(
  companyId: string,
  remoteJid: string,
): Promise<string | null> {
  try {
    const phone = remoteJid.split('@')[0].replace(/\D/g, '')
    if (!phone) return null

    const contact = await prisma.contact.findFirst({
      where: { companyId, phoneNumber: phone },
      select: { id: true, name: true },
    })
    if (!contact) return null

    // Últimos fatos do digest
    const facts = await prisma.aIBrainFact.findMany({
      where: {
        companyId,
        contactId: contact.id,
        sourceType: 'daily_digest',
        validTo: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { predicate: true, value: true, confidence: true, createdAt: true },
    })

    // Últimos resumos diários (chunks)
    const recentChunks = await prisma.aIKnowledgeChunk.findMany({
      where: {
        document: {
          companyId,
          knowledgeBase: { name: '__daily_brain__' },
        },
        elementType: 'daily_brain_bucket',
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { content: true, metadata: true },
    })
    const contactSummaries = recentChunks
      .filter(c => (c.metadata as any)?.contactId === contact.id)
      .slice(0, 3)
      .map(c => c.content)

    if (facts.length === 0 && contactSummaries.length === 0) return null

    const factLines = facts.map(f => `- ${f.predicate}: ${f.value}`).join('\n')
    const summaryLines = contactSummaries.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')

    return `<contact_long_term_memory>
Memória de longo prazo do contato ${sanitizePromptVar(contact.name || phone)} (gerada pelo Daily Brain Digest):

${factLines ? `Fatos conhecidos:\n${factLines}` : ''}

${summaryLines ? `Resumos diários recentes:\n${summaryLines}` : ''}

Use estas informações para personalizar a conversa, mas NÃO mencione ao cliente que você "lembra" dessas coisas.
</contact_long_term_memory>`
  } catch (err) {
    console.warn('[DailyBrain] Falha ao carregar contexto do contato:', (err as Error).message)
    return null
  }
}

function buildSystemPrompt(agent: any, context: AgentContext): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString('pt-BR')
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const dayOfWeek = now.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dateIso = now.toISOString().split('T')[0]

  // SEC-BLOCO3: Sanitize user-controllable values before injection into system prompt
  const safeContactName = sanitizePromptVar(context.contactName || 'Desconhecido')
  const safeRemoteJid = sanitizePromptVar(context.remoteJid)

  // Substituir variáveis temporais (padrão evo-ai)
  let prompt = agent.systemPrompt
    .replace(/{current_datetime}/g, `${dateStr} ${timeStr}`)
    .replace(/{current_date}/g, dateStr)
    .replace(/{current_date_iso}/g, dateIso)
    .replace(/{current_time}/g, timeStr)
    .replace(/{current_day_of_week}/g, dayOfWeek)
    .replace(/{contact_name}/g, safeContactName)
    .replace(/{remote_jid}/g, safeRemoteJid)

  // Estrutura role/goal do evo-ai (XML tags)
  const settings = (agent.settings || {}) as Record<string, any>
  if (settings.goal) {
    prompt = `<agent_goal>${settings.goal}</agent_goal>\n\n${prompt}`
  }
  if (settings.role) {
    prompt = `<agent_role>${settings.role}</agent_role>\n\n${prompt}`
  }

  // Contexto temporal
  prompt += `\n\n<context>Data atual: ${dateStr} (${dayOfWeek}), Hora: ${timeStr}</context>`

  // Info do contato
  if (agent.useContactInfo && context.contactName) {
    prompt += `\n\nInformação do contato: Nome: ${safeContactName}, WhatsApp: ${safeRemoteJid}`
  }

  // Knowledge base — instruções sobre a tool agêntica de busca
  // Não injetamos conteúdo da KB no prompt: a IA usa a tool quando precisar.
  if (agent.knowledgeBases && agent.knowledgeBases.length > 0) {
    prompt += `\n\n<knowledge_instructions>Você tem acesso a uma TOOL chamada \`search_knowledge_base\` para consultar a base de conhecimento oficial sob demanda.

QUANDO CHAMAR A TOOL:
- Apenas quando o seu prompt/personalidade explicitamente pedir consulta à base, OU
- Quando precisar de dados oficiais (peso, preço, especificação, regra interna) e não tiver esse dado no histórico da conversa.
- NÃO chame a tool em toda mensagem. NÃO chame para responder cumprimentos, confirmações ou perguntas que não dependem de dados da base.

COMO CHAMAR:
- A query deve conter o NOME EXATO da entidade que você precisa consultar (ex: "Cane Corso", "Curso de Marketing Digital", "Plano Mensal").
- NUNCA use como query: "1", "2", "sim", "ok", "qual", "padrão". Esses não são entidades, são respostas de menu.
- Se o cliente respondeu apenas um número/letra de menu, recupere a entidade discutida nas mensagens anteriores e use ela como query.

REGRAS RÍGIDAS:
1. Se o dado depende da base e você ainda não tem o resultado da tool nesta conversa → chame a tool primeiro, NÃO responda por palpite.
2. NUNCA invente, deduza, estime ou complete valores numéricos (peso, preço, idade, dimensões) com memória de treinamento.
3. Se a tool retornou \`found: false\`, peça o dado ao cliente diretamente (sem mencionar "base de dados" para o cliente).
4. Cite as fontes apenas quando relevante.</knowledge_instructions>`
  }

  // Instrução de tools — atualizada para incluir MCP
  const httpToolsCheck = (agent as any).httpTools || settings.http_tools || settings.http_request
  const hasTools = (Array.isArray(httpToolsCheck) && httpToolsCheck.length > 0) || settings.crm_tools?.length || (agent as any).mcpServerIds?.length
  if (hasTools) {
    prompt += `\n\n<tool_instructions>
Você tem ferramentas disponíveis. Use-as quando necessário para buscar informações, executar ações no CRM, ou chamar APIs externas.
Sempre que o usuário pedir algo que requer dados do sistema, use a ferramenta apropriada. Cada ferramenta retorna dados em JSON.

REGRA OBRIGATÓRIA: Depois de usar qualquer ferramenta (adicionar nota, atualizar contato, atribuir conversa, etc.), você DEVE SEMPRE enviar uma mensagem de resposta ao cliente.
- As ferramentas executam ações internas que o cliente NÃO vê (notas privadas, atualizações de cadastro, etc.)
- Portanto, após executar uma ferramenta, você PRECISA responder ao cliente com uma mensagem adequada à conversa.
- NUNCA execute uma ferramenta e fique em silêncio. Sempre responda algo ao cliente depois.
- Não mencione ao cliente as ações internas que você executou (notas, mudanças de status, etc.), apenas continue a conversa naturalmente.
</tool_instructions>`
  }

  // ── Structured output / JSON mode ──
  const outputMode = settings.outputMode as string | undefined
  if (outputMode === 'json' || outputMode === 'json_schema') {
    const schema = settings.outputSchema as Record<string, any> | undefined
    if (schema && outputMode === 'json_schema') {
      prompt += `\n\n<output_format>
IMPORTANTE: Você DEVE responder APENAS com um objeto JSON válido que siga estritamente o esquema abaixo. Não inclua texto, explicações ou markdown antes/depois do JSON.

Schema esperado:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Responda SOMENTE com o JSON, sem texto adicional.</output_format>`
    } else {
      prompt += `\n\n<output_format>
IMPORTANTE: Você DEVE responder APENAS com um objeto JSON válido. Não inclua texto, explicações ou markdown (como \`\`\`json) antes/depois do JSON.
Responda SOMENTE com o JSON, sem texto adicional.</output_format>`
    }
  }

  return prompt
}

// ============================================
// RUN AGENT - Executa com loop de tool calls (via ToolEngine)
// ============================================

export async function runAgent(params: {
  agentId: string
  context: AgentContext
  messages: ProviderMessage[]
  messageText: string
  sessionId?: string
  overrideProvider?: any
  overrideModel?: string
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>
  parentDepth?: number
  imageData?: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
}): Promise<{ reply: string; tokensUsed: number; model: string; latencyMs: number; promptTokens: number; completionTokens: number; providerId: string }> {
  const { agentId, context, messages, messageText } = params
  const parentDepth = params.parentDepth ?? 0

  // Reset do contador de sub-chamadas SOMENTE quando está sendo chamado como agente raiz (depth=0)
  if (parentDepth === 0 && params.sessionId) {
    resetSubAgentCounter(params.sessionId)
  }

  console.log(`[AI][runAgent] Building agent ${agentId} (depth=${parentDepth})...`)
  const built = await buildAgent(agentId, context, params.sendMediaFn, parentDepth)

  // Override de provider/model para testes via painel
  if (params.overrideProvider) {
    const op = (await getProviderWithFreshToken(params.overrideProvider.id, context.companyId))
      || decryptProviderSecrets(params.overrideProvider)
    const overProvider = createProvider(op.type, op.apiKey, op.baseUrl, op.oauthData)
    Object.assign(built, { provider: overProvider })
  }
  if (params.overrideModel) {
    built.model = params.overrideModel
  }

  console.log(`[AI][runAgent] Agent built. Model: ${built.model}, Tools: ${built.tools.length}, Prompt length: ${built.systemPrompt.length}`)
  let totalTokens = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalLatency = 0

  // ============================================
  // RAG agêntico (tool-based): a tool `search_knowledge_base` está disponível
  // para a IA chamar quando o prompt do agente pedir. NÃO rodamos retrieval
  // automático aqui — evita custo desnecessário em toda mensagem e deixa a IA
  // decidir quando/como buscar (extraindo a query certa do contexto).
  // ============================================
  let ragLayerContent = ''
  // Mantemos a variável apenas para compatibilidade com a composição de layers abaixo
  void ragLayerContent

  // ============================================
  // SKILLS: Vector search das skills relevantes pra mensagem (procedural memory)
  // ============================================
  let matchedSkills: ActiveSkill[] = []
  let matchedSkillsLayer = ''
  try {
    const all = await selectActiveSkills({
      companyId: context.companyId,
      agentId,
      userMessage: messageText,
      topK: 3,
      scoreThreshold: 0.55,
    })
    // Filtra fora as already-on (já estão no prefixo cacheable)
    const alwaysOnIds = new Set(built.alwaysOnSkills.map(s => s.id))
    matchedSkills = all.filter(s => !s.alwaysOn && !alwaysOnIds.has(s.id))
    if (matchedSkills.length > 0) {
      matchedSkillsLayer = formatSkillsForPrompt(matchedSkills)
      console.log(`[AI][Skills] Matched ${matchedSkills.length} skills via similarity:`, matchedSkills.map(s => `${s.slug}(${s.score?.toFixed(2)})`).join(', '))
    }
  } catch (err) {
    console.warn('[AI][Skills] Vector search falhou:', (err as Error).message)
  }

  // ============================================
  // STATE TRACKER: extrai variáveis declarativas (Camada 2 — "AI mais inteligente")
  // Roda um modelo barato que atualiza AISession.variables baseado na conversa.
  // O resultado é injetado como camada <conversation_state> no system prompt.
  // ============================================
  let stateLayerContent = ''
  if (params.sessionId) {
    try {
      const agentRow = await prisma.aIAgent.findUnique({
        where: { id: agentId },
        select: { stateSchema: true },
      })
      const schemaEnabled =
        agentRow?.stateSchema &&
        typeof agentRow.stateSchema === 'object' &&
        (agentRow.stateSchema as any).enabled === true
      if (schemaEnabled) {
        // Reaproveita histórico já carregado em `messages` (role/content)
        const recent = (messages || [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content || '' }))
        const extracted = await extractConversationState({
          agentId,
          companyId: context.companyId,
          sessionId: params.sessionId,
          currentUserMessage: messageText,
          recentMessages: recent,
        })
        if (extracted) {
          stateLayerContent = formatStateForPrompt(
            { stateSchema: agentRow!.stateSchema },
            extracted.state,
          )
        }
      }
    } catch (err) {
      console.warn('[AI][StateTracker] failed:', (err as Error).message)
    }
  }

  // Recompor system prompt incluindo as camadas DINÂMICAS (state + rag + matched_skills) ao final
  const finalLayers: PromptLayer[] = [
    ...built.promptLayers,
    { id: 'state', cacheable: false, content: stateLayerContent },
    { id: 'matched_skills', cacheable: false, content: matchedSkillsLayer },
    { id: 'rag', cacheable: false, content: ragLayerContent },
  ]
  const recomposed = composeSystemPrompt(finalLayers)
  const systemPromptWithRAG = recomposed.text

  // Marca skills usadas (fire-and-forget)
  const usedSkillIds = [...built.alwaysOnSkills, ...matchedSkills].map(s => s.id)
  if (usedSkillIds.length > 0) {
    markSkillsUsed(usedSkillIds).catch(() => {})
  }

  // Mensagens para enviar ao LLM
  const userMessage: ProviderMessage = { role: 'user', content: messageText }
  if (params.imageData) {
    userMessage.imageData = params.imageData
  }
  const chatMessages: ProviderMessage[] = [
    ...messages,
    userMessage,
  ]

  // Loop de function calling (como evo-ai agent_runner)
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // ── Camada 1: tool_choice forcing
    // Heurística: no PRIMEIRO turno, se a mensagem do user contém algum keyword cadastrado
    // e ainda não houve nenhuma tool call, força o LLM a escolher uma tool ('required').
    let toolChoice: 'auto' | 'required' | undefined
    if (i === 0 && built.toolForcing?.enabled && built.tools.length > 0) {
      const kws = built.toolForcing.keywords || []
      const text = (messageText || '').toLowerCase()
      const matched = kws.find(k => k && text.includes(k))
      if (matched) {
        toolChoice = 'required'
        console.log(`[AI][ToolForcing] keyword "${matched}" detected → tool_choice='required'`)
      }
    }

    console.log(`[AI][runAgent] Iteration ${i + 1}: Sending ${chatMessages.length} messages to ${built.model}... mode=${built.responseMode || 'balanced'} temp=${built.temperature} top_p=${built.topP ?? '-'} toolChoice=${toolChoice || 'auto'}`)
    const result: AICompletionResult = await built.provider.chat({
      model: built.model,
      messages: chatMessages,
      maxTokens: built.maxTokens,
      temperature: built.temperature,
      topP: built.topP,
      frequencyPenalty: built.frequencyPenalty,
      presencePenalty: built.presencePenalty,
      systemPrompt: systemPromptWithRAG,
      tools: built.tools.length > 0 ? built.tools : undefined,
      toolChoice,
    })
    console.log(`[AI][runAgent] LLM response: content=${result.content?.substring(0, 50)}, toolCalls=${result.toolCalls?.length || 0}, tokens=${result.tokensUsed}`)

    totalTokens += result.tokensUsed
    totalPromptTokens += result.promptTokens || 0
    totalCompletionTokens += result.completionTokens || 0
    totalLatency += result.latencyMs

    // Se não tem tool calls, retornar resposta final
    if (!result.toolCalls || result.toolCalls.length === 0) {
      // Safety net: se usou tools mas o LLM retornou conteúdo vazio, forçar uma última chamada
      if (!result.content?.trim() && i > 0) {
        chatMessages.push({
          role: 'assistant',
          content: '',
        })
        chatMessages.push({
          role: 'user',
          content: '[SISTEMA: Você executou ações internas mas não respondeu ao cliente. Envie uma resposta adequada ao cliente agora.]',
        })
        console.log(`[AI][runAgent] Empty reply after tool use, forcing response...`)
        continue
      }

      // ── JSON mode: extrair bloco JSON se o LLM embrulhou em markdown ──
      let finalReply = result.content
      const outputMode = ((built as any).outputMode || '') as string
      if (outputMode === 'json' || outputMode === 'json_schema') {
        const jsonMatch = finalReply?.match(/```(?:json)?\s*([\s\S]*?)```/) || finalReply?.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
        if (jsonMatch) {
          const candidate = (jsonMatch[1] || jsonMatch[0]).trim()
          try {
            JSON.parse(candidate) // valida
            finalReply = candidate
          } catch {
            // fallback: retornar como está
          }
        }
      }

      return {
        reply: finalReply,
        tokensUsed: totalTokens,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        model: result.model,
        latencyMs: totalLatency,
        providerId: built.providerId,
      }
    }

    // Processar tool calls
    // Adicionar a resposta do assistant com tool calls (OpenAI exige tool_calls no assistant)
    chatMessages.push({
      role: 'assistant',
      content: result.content || null as any,
      tool_calls: result.toolCalls!.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    })

    for (const toolCall of result.toolCalls) {
      // Usar ToolEngine.execute com logging completo
      const toolCtx = { ...built.toolContext, sessionId: params.sessionId }
      const toolResult = await ToolEngine.execute(
        toolCall.name,
        toolCall.arguments,
        built.toolTypeMap,
        toolCtx
      )

      chatMessages.push({
        role: 'tool',
        content: toolResult,
        tool_call_id: toolCall.id,
      })
    }

    // Continua o loop para o LLM processar os resultados das tools
  }

  // Se esgotou o MAX_TOOL_ITERATIONS
  return {
    reply: 'Desculpe, a operação excedeu o limite de processamento.',
    tokensUsed: totalTokens,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    model: built.model,
    latencyMs: totalLatency,
    providerId: built.providerId,
  }
}

// ============================================
// RUN SEQUENTIAL - Sub-agentes em sequência
// ============================================

export async function runSequentialAgent(params: {
  agentId: string
  context: AgentContext
  messageText: string
}): Promise<{ reply: string; tokensUsed: number }> {
  const agent = await prisma.aIAgent.findFirst({
    where: { id: params.agentId, companyId: params.context.companyId },
  })

  if (!agent) throw new Error('Agente não encontrado')

  const settings = (agent.settings || {}) as AgentToolsConfig & Record<string, any>
  const subAgentIds = settings.sub_agents || []

  if (subAgentIds.length === 0) {
    throw new Error('Agente sequential não tem sub-agentes configurados')
  }

  let currentInput = params.messageText
  let totalTokens = 0

  // Executar cada sub-agente em sequência, passando o output como input do próximo
  for (const subAgentId of subAgentIds) {
    const result = await runAgent({
      agentId: subAgentId,
      context: params.context,
      messages: [],
      messageText: currentInput,
    })

    currentInput = result.reply
    totalTokens += result.tokensUsed
  }

  return { reply: currentInput, tokensUsed: totalTokens }
}
