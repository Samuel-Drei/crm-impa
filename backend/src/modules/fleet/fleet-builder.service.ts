/**
 * Fleet Builder Service — onboarding conversacional de FleetMember
 *
 * Em vez do admin preencher um formulário, ele conversa com um "designer AI"
 * que faz perguntas e usa function calling para montar a configuração do membro.
 */

import { prisma } from '../../config/database.js'
import { createProvider } from '../ai/providers/index.js'
import type { AIMessage, AIToolDefinition } from '../ai/providers/base.provider.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from '../ai/ai.service.js'
import { DEFAULT_FLEET_TOOLS_CONFIG } from './fleet.service.js'
import {
  AVAILABLE_FLEET_TOOLS,
  CRM_CONTEXT_BLOCK,
  findMatchingTemplate,
  FLEET_TEMPLATES,
} from './fleet-builder.context.js'

// Lista de tools que o membro pode receber (vinda do contexto centralizado)
const AVAILABLE_TOOLS = AVAILABLE_FLEET_TOOLS

const BUILDER_SYSTEM_PROMPT = `Você é o "Designer de Funcionários" do CRM IMPA. Sua missão é ajudar o administrador a criar um novo funcionário AI (FleetMember) através de uma conversa natural e amigável, em português.

REGRAS DE CONDUÇÃO:
1. Faça UMA pergunta por vez. Nunca dispare 5 perguntas juntas.
2. Comece descobrindo o NOME e o CARGO/PAPEL do funcionário (ex: "Carla, SDR" ou "Pedro, Analista de Dados").
3. Depois investigue: o que ele faz no dia-a-dia? Como deve se comunicar (formal/casual/direto)? Tem alguma especialidade?
4. Pergunte sobre temperamento (criativo/preciso) — isso vira a temperature.
5. Sugira ferramentas (tools) baseado no que ele faz. NÃO peça pro admin escolher tool por tool — você sugere, ele aprova.
6. Quando tiver TUDO claro, RESUMA a configuração e pergunte: "Posso criar agora?"
7. Use a tool 'propose_member_config' SEMPRE que tiver novas informações, mesmo que parcial. Vá preenchendo progressivamente.
8. Quando o admin confirmar a criação, chame 'propose_member_config' com complete=true.

⚠️ NUNCA use frases robóticas como "Anotei. Próxima pergunta", "Entendido. Próxima pergunta", "Ok, próxima". SEMPRE responda de forma natural ao que o admin disse, demonstre que você processou a informação, e SÓ ENTÃO faça a próxima pergunta — tudo no MESMO turno, num parágrafo só.

⚠️ SEMPRE escreva uma resposta em texto JUNTO com a chamada da tool. NÃO chame a tool sozinha sem texto. O admin precisa ver sua resposta natural na tela.

⚠️ O funcionário que você criar deve operar no padrão action-first: quando o pedido do admin for claro, ele usa as ferramentas em vez de prometer; só confirma ações depois de retorno success=true; usa update_todos para tarefas longas; pede aprovação antes de ações sensíveis/em massa; e delega com spawn_subagent apenas quando outro membro tiver expertise melhor.

ESTILO: Converse como um designer experiente entrevistando um cliente. Seja amigável, faça analogias ("um SDR é tipo um caçador de leads quentes..."), evite jargão técnico de IA. Não fale em "system prompt", "tokens", "modelo" — fale em "personalidade", "conhecimento", "como deve responder".

IMPORTANTE:
- O system_prompt que você gera deve ser em segunda pessoa ("Você é..."), descrevendo a personalidade e função do funcionário, em português, com 4-10 parágrafos curtos. Inclua: identidade, missão, tom de voz, limites, exemplos do que fazer/não fazer, como escalar pra humano. Quanto mais específico ao negócio do admin, melhor.
- Inclua no system_prompt regras operacionais explícitas: executar com tools quando houver pedido claro, não dizer "vou fazer e já confirmo" sem chamar tool, usar plano/checklist para 3+ passos, pedir aprovação para ações em massa/sensíveis e reportar falhas de forma honesta.
- Use as ferramentas DESCRITAS NO CONTEXTO ABAIXO. Recomende 6 a 12 — nunca todas. Tools demais confundem o LLM em runtime.
- SEMPRE inclua por padrão: configure_self, think, update_todos.
- Nunca invente informações que o admin não disse. Se faltar dado, pergunte.
- Se o admin disser "cria do seu jeito" ou "decide você", você decide e chama propose_member_config com complete=true.

${CRM_CONTEXT_BLOCK}

Comece se apresentando brevemente e fazendo a primeira pergunta.`

const PROPOSE_TOOL: AIToolDefinition = {
  name: 'propose_member_config',
  description: 'Propõe ou atualiza a configuração do FleetMember sendo desenhado. Pode ser chamado várias vezes durante a conversa para refinar. Defina complete=true SOMENTE quando o admin confirmar que pode criar.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome do funcionário (ex: Carla, Pedro)' },
      displayRole: { type: 'string', description: 'Cargo/função (ex: SDR, Analista de Dados, Suporte L1)' },
      systemPrompt: { type: 'string', description: 'Personalidade completa em pt-BR, segunda pessoa, 3-8 parágrafos' },
      temperature: { type: 'number', description: '0.0 (preciso) a 1.5 (criativo). Default 0.7', minimum: 0, maximum: 2 },
      maxTokens: { type: 'integer', description: 'Tamanho máximo da resposta. Default 2000', minimum: 200, maximum: 8000 },
      suggestedTools: {
        type: 'array',
        description: 'Lista de ferramentas a habilitar para este funcionário',
        items: { type: 'string', enum: AVAILABLE_TOOLS as unknown as string[] },
      },
      emoji: { type: 'string', description: 'Emoji que representa o funcionário (ex: 👩‍💼, 🤖, 🛒)' },
      colorTag: { type: 'string', description: 'Cor hex da tag (ex: #8b5cf6)' },
      complete: { type: 'boolean', description: 'true quando o admin confirmou a criação. Caso contrário false ou omitir.' },
    },
    required: [],
  },
}

export interface BuilderProposedConfig {
  name?: string
  displayRole?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  suggestedTools?: string[]
  emoji?: string
  colorTag?: string
  complete?: boolean
}

export interface BuilderChatInput {
  companyId: string
  providerId: string
  model?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  currentConfig?: BuilderProposedConfig
}

export interface BuilderChatResult {
  reply: string
  proposedConfig: BuilderProposedConfig | null
  mergedConfig: BuilderProposedConfig
  isComplete: boolean
}

export async function builderChat(input: BuilderChatInput): Promise<BuilderChatResult> {
  const provider = await prisma.aIProvider.findFirst({
    where: { id: input.providerId, companyId: input.companyId, isActive: true },
  })
  if (!provider) throw new Error('Provider AI não encontrado ou inativo')

  // Refresh automático de tokens OAuth (Copilot expira a cada ~30min)
  const fresh = await getProviderWithFreshToken(provider.id, input.companyId)
  const decrypted = fresh || decryptProviderSecrets(provider)
  const llm = createProvider(provider.type, decrypted.apiKey, provider.baseUrl || undefined, (decrypted as any).oauthData)
  const model = input.model || provider.model

  // Mensagens (primeira chamada não tem histórico — modelo vai se apresentar)
  const messages: AIMessage[] = input.messages.length > 0
    ? input.messages.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: '[início da conversa]' }]

  const result = await llm.chat({
    model,
    messages,
    maxTokens: 4000,
    temperature: 0.6,
    systemPrompt: BUILDER_SYSTEM_PROMPT,
    tools: [PROPOSE_TOOL],
  })

  // Extrai config do tool_call (se houver)
  let proposedConfig: BuilderProposedConfig | null = null
  if (result.toolCalls && result.toolCalls.length > 0) {
    const proposeCall = result.toolCalls.find(tc => tc.name === 'propose_member_config')
    if (proposeCall) {
      proposedConfig = sanitizeConfig(proposeCall.arguments as BuilderProposedConfig)
    }
  }

  const mergedConfig: BuilderProposedConfig = {
    ...(input.currentConfig || {}),
    ...(proposedConfig || {}),
  }

  // A resposta visível para o usuário
  let reply = result.content?.trim() || ''

  // Se modelo só chamou tool sem texto, faz uma 2ª chamada SEM tools forçando texto
  if (!reply) {
    try {
      const followUp = await llm.chat({
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: `[anotei: ${JSON.stringify(proposedConfig || {})}]` },
          { role: 'user', content: 'Continue a conversa naturalmente em português. Responda diretamente ao que eu disse, sem dizer "próxima pergunta". Se ainda faltam informações, faça UMA pergunta natural. Se já está tudo, resuma e pergunte se pode criar.' },
        ],
        maxTokens: 1500,
        temperature: 0.7,
        systemPrompt: BUILDER_SYSTEM_PROMPT,
      })
      reply = followUp.content?.trim() || ''
    } catch (err) {
      console.warn('[Builder] Follow-up falhou:', (err as Error).message)
    }
  }
  if (!reply && proposedConfig?.complete) reply = 'Configuração finalizada. Pode clicar em "Criar agora".'
  if (!reply) reply = 'Pode me dar mais detalhes?'

  const isComplete = !!mergedConfig.complete && hasMinimumFields(mergedConfig)

  return { reply, proposedConfig, mergedConfig, isComplete }
}

function sanitizeConfig(c: BuilderProposedConfig): BuilderProposedConfig {
  const out: BuilderProposedConfig = {}
  if (typeof c.name === 'string' && c.name.trim()) out.name = c.name.trim().slice(0, 100)
  if (typeof c.displayRole === 'string' && c.displayRole.trim()) out.displayRole = c.displayRole.trim().slice(0, 100)
  if (typeof c.systemPrompt === 'string' && c.systemPrompt.trim()) out.systemPrompt = c.systemPrompt.trim().slice(0, 20000)
  if (typeof c.temperature === 'number' && c.temperature >= 0 && c.temperature <= 2) out.temperature = c.temperature
  if (typeof c.maxTokens === 'number' && c.maxTokens >= 200 && c.maxTokens <= 8000) out.maxTokens = Math.round(c.maxTokens)
  if (Array.isArray(c.suggestedTools)) {
    out.suggestedTools = normalizeSuggestedTools(c.suggestedTools)
  }
  if (typeof c.emoji === 'string' && c.emoji.trim()) out.emoji = c.emoji.trim().slice(0, 8)
  if (typeof c.colorTag === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.colorTag)) out.colorTag = c.colorTag
  if (typeof c.complete === 'boolean') out.complete = c.complete
  return out
}

function normalizeSuggestedTools(tools: string[] | undefined): string[] {
  const base = ['configure_self', 'think', 'update_todos']
  const valid = (tools || []).filter(t => (AVAILABLE_TOOLS as readonly string[]).includes(t))
  return Array.from(new Set([...valid, ...base]))
}

function hasMinimumFields(c: BuilderProposedConfig): boolean {
  return !!(c.name && c.displayRole && c.systemPrompt)
}

/**
 * Converte a config proposta em payload para createMember
 */
export function buildCreatePayload(merged: BuilderProposedConfig, providerId: string, model: string) {
  const suggestedTools = normalizeSuggestedTools(merged.suggestedTools)
  const toolsConfig = suggestedTools.length > 0
    ? { fleet_admin: { enabledTools: suggestedTools } }
    : DEFAULT_FLEET_TOOLS_CONFIG

  return {
    name: merged.name!,
    displayRole: merged.displayRole!,
    providerId,
    model,
    systemPrompt: merged.systemPrompt!,
    temperature: merged.temperature ?? 0.7,
    maxTokens: merged.maxTokens ?? 2000,
    toolsConfig,
    emoji: merged.emoji,
    colorTag: merged.colorTag,
    allowAutonomousActions: true,
  }
}
