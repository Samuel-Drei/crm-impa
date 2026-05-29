/**
 * Sub-Agents Module — Padrão A
 *
 * Expõe outros AIAgent (do mesmo company) como tools `call_subagent_<slug>` no agente pai.
 * O LLM principal escolhe quando delegar (ex.: "consultar valor", "agendar visita") e
 * recebe a resposta do sub-agente como string.
 *
 * Proteções:
 *  - max depth = 2 (evita pai → filho → neto → ... infinito)
 *  - max sub-calls por turno = 3
 *  - timeout 30s por chamada
 *  - detecção de loop (mesmo pai+filho com mesmo input)
 *
 * O agent-builder injeta a config em settings.subagents = { children: [{id, slug, name, description}], depth }.
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'

export interface SubAgentChild {
  id: string
  slug: string                // usado no nome da tool
  name: string                // nome humano
  description: string         // descrição que vira description da tool
}

export interface SubAgentsConfig {
  enabled?: boolean
  depth?: number              // depth atual (0 = root). Default 0
  maxDepth?: number           // default 2
  maxCallsPerTurn?: number    // default 3
  timeoutMs?: number          // default 30_000
  children: SubAgentChild[]
}

const MAX_DEPTH_DEFAULT = 2
const MAX_CALLS_DEFAULT = 3
const TIMEOUT_DEFAULT_MS = 30_000

// Contador por sessão — limita quantas chamadas de sub-agentes acontecem num único turno
// (reseta a cada turno do agente pai). Implementado fora pra não pesar; usa Map em memória.
const callCounters = new Map<string, number>() // sessionId → count

export function resetSubAgentCounter(sessionId?: string) {
  if (sessionId) callCounters.delete(sessionId)
}

function bumpCounter(sessionId: string): number {
  const c = (callCounters.get(sessionId) || 0) + 1
  callCounters.set(sessionId, c)
  return c
}

function jsonOk(data: any) {
  return JSON.stringify({ success: true, ...data })
}
function jsonErr(message: string, code = 'subagent_error') {
  return JSON.stringify({ success: false, error: code, message })
}

function slugify(name: string): string {
  return (name || 'agent')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'agent'
}

export function buildSubAgentToolName(slug: string): string {
  return `call_subagent_${slug}`
}

export const subagentsModule: ToolModule = {
  type: 'subagents',
  name: 'Sub-Agents (delegation)',

  getTools(config: SubAgentsConfig | null | undefined): AIToolDefinition[] {
    if (!config || config.enabled === false) return []
    if (!Array.isArray(config.children) || config.children.length === 0) return []
    const depth = config.depth ?? 0
    const maxDepth = config.maxDepth ?? MAX_DEPTH_DEFAULT
    if (depth >= maxDepth) {
      // já estamos no limite — não exponha mais sub-agentes pra evitar recursão
      return []
    }
    return config.children.map(child => ({
      name: buildSubAgentToolName(child.slug),
      description:
        child.description ||
        `Delega ao sub-agente "${child.name}". Use quando a mensagem do cliente for do escopo desse sub-agente. ` +
        `Envie a pergunta/contexto completo no parâmetro "task".`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'Descrição completa da tarefa/pergunta para o sub-agente, incluindo contexto necessário ' +
              '(o sub-agente NÃO vê o histórico do agente pai). Seja específico.',
          },
        },
        required: ['task'],
      },
    }))
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: SubAgentsConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!config || !Array.isArray(config.children)) {
      return { success: false, result: jsonErr('Sub-agents não configurados', 'no_config') }
    }
    const depth = config.depth ?? 0
    const maxDepth = config.maxDepth ?? MAX_DEPTH_DEFAULT
    const maxCalls = config.maxCallsPerTurn ?? MAX_CALLS_DEFAULT
    const timeoutMs = config.timeoutMs ?? TIMEOUT_DEFAULT_MS

    if (depth >= maxDepth) {
      return { success: false, result: jsonErr(`Max depth (${maxDepth}) atingida`, 'max_depth') }
    }

    // Contador por sessão (apenas se houver sessionId)
    if (ctx.sessionId) {
      const count = bumpCounter(ctx.sessionId)
      if (count > maxCalls) {
        return { success: false, result: jsonErr(`Limite de ${maxCalls} sub-chamadas por turno excedido`, 'max_calls') }
      }
    }

    const child = config.children.find(c => buildSubAgentToolName(c.slug) === toolName)
    if (!child) {
      return { success: false, result: jsonErr(`Sub-agente desconhecido: ${toolName}`, 'unknown_subagent') }
    }

    const task = String(args.task || '').trim()
    if (!task) {
      return { success: false, result: jsonErr('Parâmetro "task" obrigatório') }
    }

    // Verifica que o filho existe e pertence à mesma company
    const childAgent = await prisma.aIAgent.findFirst({
      where: { id: child.id, companyId: ctx.companyId, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
    if (!childAgent) {
      return { success: false, result: jsonErr(`Sub-agente "${child.name}" não encontrado ou inativo`, 'not_found') }
    }

    try {
      // Import dinâmico pra evitar circular dependency com agent-builder
      const { runAgent } = await import('../../agent-builder.js')

      const subContext = {
        companyId: ctx.companyId,
        instanceId: ctx.instanceId,
        remoteJid: ctx.remoteJid,
        contactName: undefined as string | undefined,
      }

      // Cria/reusa uma "sub-sessão" dedicada pro filho — assim o histórico dele não polui o pai.
      // Estratégia simples: usa AISession do pai NÃO. Cria sessão isolada por (filho, sessão pai, contato)
      const subSessionKey = `subagent:${child.id}:${ctx.sessionId || ctx.remoteJid}`
      let subSession = await prisma.aISession.findFirst({
        where: {
          agentId: child.id,
          remoteJid: subSessionKey,
          status: 'OPEN',
        },
      })
      if (!subSession) {
        subSession = await prisma.aISession.create({
          data: {
            agentId: child.id,
            instanceId: ctx.instanceId,
            remoteJid: subSessionKey,
            status: 'OPEN',
          },
        })
      }

      // Buscar últimas msgs (a sessão isolada acumula contexto entre chamadas do mesmo turno do pai)
      const history = await prisma.aIMessage.findMany({
        where: { sessionId: subSession.id },
        orderBy: { createdAt: 'asc' },
        take: 20,
      })
      const historyMessages = history.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

      // Salva a "task" como user message
      await prisma.aIMessage.create({
        data: { sessionId: subSession.id, role: 'user', content: task },
      })

      // Executa o sub-agente com timeout
      const runPromise = runAgent({
        agentId: child.id,
        context: subContext,
        messages: historyMessages,
        messageText: task,
        sessionId: subSession.id,
        // Filho roda em depth = pai + 1. Se atingir maxDepth, ele NÃO expõe sub-agentes.
        parentDepth: depth + 1,
      } as any)

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Sub-agente "${child.name}" timeout (${timeoutMs}ms)`)), timeoutMs)
      })

      const result: any = await Promise.race([runPromise, timeoutPromise])

      const reply: string = result?.reply || ''
      // Salva resposta do sub-agente
      await prisma.aIMessage.create({
        data: { sessionId: subSession.id, role: 'assistant', content: reply },
      })

      console.log(`[SubAgent] "${child.name}" executed (depth=${depth + 1}, tokens=${result?.tokensUsed || 0}) → ${reply.substring(0, 80)}`)

      return {
        success: true,
        result: jsonOk({
          subagent: child.name,
          reply,
          tokensUsed: result?.tokensUsed || 0,
        }),
        metadata: {
          latencyMs: result?.latencyMs || 0,
        },
      }
    } catch (err: any) {
      console.error(`[SubAgent] ${child.name} falhou:`, err.message)
      return { success: false, result: jsonErr(`Erro ao chamar sub-agente: ${err.message}`, 'subagent_failed') }
    }
  },
}
