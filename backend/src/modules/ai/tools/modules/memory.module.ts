/**
 * Memory Module — Tools de "memória explícita" (estilo ChatGPT "Memória atualizada")
 *
 * Permite ao agente, durante a conversa, salvar/atualizar fatos e preferências
 * imediatamente em AIMemory (escopo: companyId × agentId × remoteJid).
 *
 * Diferente do `memory.service.ts` que sumariza ao fechar a sessão, estas tools
 * gravam na hora — útil quando o usuário diz "anota aí na sua memória que...".
 *
 * Config esperada em agent.settings.memory:
 *   { enabled: boolean }
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { io } from '../../../../server.js'
import { instanceRoom } from '../../../../config/socket-rooms.js'

export interface MemoryToolConfig {
  enabled?: boolean
}

const SAVE_MEMORY_TOOL: AIToolDefinition = {
  name: 'save_memory',
  description:
    'Salva um fato importante sobre o contato na sua memória de longo prazo (persiste entre conversas). ' +
    'Use SEMPRE que o usuário pedir explicitamente para "anotar", "lembrar", "salvar na memória", ' +
    'ou quando uma informação for claramente útil para futuras interações (preferência, dado pessoal, ' +
    'decisão importante, regra de negócio mencionada). Seja conciso e específico.',
  inputSchema: {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description:
          'O fato a ser memorizado, em uma frase clara e completa (ex: "Cliente prefere ser contatado por e-mail às 14h"). Máx 500 chars.',
      },
    },
    required: ['fact'],
  },
}

const UPDATE_PREFERENCE_TOOL: AIToolDefinition = {
  name: 'update_preference',
  description:
    'Atualiza uma preferência específica do contato (chave/valor) na memória de longo prazo. ' +
    'Use para preferências estruturadas (idioma, canal preferido, horário, formato de resposta, etc).',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Nome da preferência (ex: "idioma", "canal_preferido", "horario").' },
      value: { type: 'string', description: 'Valor da preferência (ex: "pt-BR", "whatsapp", "manhã").' },
    },
    required: ['key', 'value'],
  },
}

const LIST_MEMORIES_TOOL: AIToolDefinition = {
  name: 'list_memories',
  description:
    'Lista os fatos memorizados sobre o contato atual. Útil para revisar o que já sabe antes de responder.',
  inputSchema: { type: 'object', properties: {} },
}

const FORGET_MEMORY_TOOL: AIToolDefinition = {
  name: 'forget_memory',
  description:
    'Remove um fato da memória de longo prazo. Use quando o usuário pedir explicitamente para "esquecer" ' +
    'ou corrigir uma informação anterior errada.',
  inputSchema: {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description: 'O fato exato (ou trecho identificador) a ser removido. Faz match parcial case-insensitive.',
      },
    },
    required: ['fact'],
  },
}

function jsonOk(data: any) {
  return JSON.stringify({ success: true, ...data })
}
function jsonErr(message: string, code = 'memory_error') {
  return JSON.stringify({ success: false, error: code, message })
}

/** Emite evento socket pra UI mostrar "Memória atualizada" */
function emitMemoryUpdated(ctx: ToolExecutionContext, payload: any) {
  try {
    io.to(instanceRoom(ctx.instanceId)).emit('ai-memory-updated', {
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      ...payload,
      timestamp: new Date().toISOString(),
    })
  } catch { /* socket pode não estar pronto */ }
}

async function getOrCreateMemory(companyId: string, agentId: string, remoteJid: string) {
  let mem = await prisma.aIMemory.findUnique({
    where: { companyId_agentId_remoteJid: { companyId, agentId, remoteJid } },
  })
  if (!mem) {
    mem = await prisma.aIMemory.create({
      data: {
        companyId,
        agentId,
        remoteJid,
        summary: '',
        facts: [],
        preferences: {},
        sessionCount: 0,
        tokensUsed: 0,
      },
    })
  }
  return mem
}

export const memoryModule: ToolModule = {
  type: 'memory',
  name: 'Long-term Memory',

  getTools(config: MemoryToolConfig | null | undefined): AIToolDefinition[] {
    if (!config) return []
    if (config.enabled === false) return []
    return [SAVE_MEMORY_TOOL, UPDATE_PREFERENCE_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL]
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    _config: MemoryToolConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const { companyId, agentId, remoteJid } = ctx
      if (!companyId || !agentId || !remoteJid) {
        return { success: false, result: jsonErr('Contexto incompleto (faltando companyId/agentId/remoteJid)') }
      }

      if (toolName === 'save_memory') {
        const fact = String(args.fact || '').trim().substring(0, 500)
        if (!fact) return { success: false, result: jsonErr('"fact" é obrigatório') }
        const mem = await getOrCreateMemory(companyId, agentId, remoteJid)
        const existing = Array.isArray(mem.facts) ? (mem.facts as string[]) : []
        if (existing.some(f => f.toLowerCase() === fact.toLowerCase())) {
          return { success: true, result: jsonOk({ note: 'Fato já estava memorizado.', fact }) }
        }
        const updated = [...existing, fact].slice(-50) // máx 50 fatos
        await prisma.aIMemory.update({ where: { id: mem.id }, data: { facts: updated } })
        emitMemoryUpdated(ctx, { action: 'save', fact })
        return { success: true, result: jsonOk({ message: 'Memória atualizada.', fact, total: updated.length }) }
      }

      if (toolName === 'update_preference') {
        const key = String(args.key || '').trim().substring(0, 80)
        const value = String(args.value ?? '').substring(0, 500)
        if (!key) return { success: false, result: jsonErr('"key" é obrigatório') }
        const mem = await getOrCreateMemory(companyId, agentId, remoteJid)
        const prefs = (typeof mem.preferences === 'object' && mem.preferences !== null
          ? (mem.preferences as Record<string, any>)
          : {}) as Record<string, any>
        prefs[key] = value
        await prisma.aIMemory.update({ where: { id: mem.id }, data: { preferences: prefs } })
        emitMemoryUpdated(ctx, { action: 'preference', key, value })
        return { success: true, result: jsonOk({ message: 'Preferência atualizada.', key, value }) }
      }

      if (toolName === 'list_memories') {
        const mem = await prisma.aIMemory.findUnique({
          where: { companyId_agentId_remoteJid: { companyId, agentId, remoteJid } },
        })
        if (!mem) return { success: true, result: jsonOk({ facts: [], preferences: {}, summary: '' }) }
        return {
          success: true,
          result: jsonOk({
            facts: Array.isArray(mem.facts) ? mem.facts : [],
            preferences: mem.preferences || {},
            summary: mem.summary || '',
            sessionCount: mem.sessionCount,
          }),
        }
      }

      if (toolName === 'forget_memory') {
        const needle = String(args.fact || '').trim().toLowerCase()
        if (!needle) return { success: false, result: jsonErr('"fact" é obrigatório') }
        const mem = await prisma.aIMemory.findUnique({
          where: { companyId_agentId_remoteJid: { companyId, agentId, remoteJid } },
        })
        if (!mem) return { success: true, result: jsonOk({ removed: 0 }) }
        const existing = Array.isArray(mem.facts) ? (mem.facts as string[]) : []
        const remaining = existing.filter(f => !f.toLowerCase().includes(needle))
        const removed = existing.length - remaining.length
        if (removed > 0) {
          await prisma.aIMemory.update({ where: { id: mem.id }, data: { facts: remaining } })
          emitMemoryUpdated(ctx, { action: 'forget', count: removed })
        }
        return { success: true, result: jsonOk({ removed, remaining: remaining.length }) }
      }

      return { success: false, result: jsonErr(`Tool ${toolName} desconhecida`, 'tool_not_found') }
    } catch (err) {
      const msg = (err as Error).message
      console.error('[MemoryTool] Falha:', msg)
      return { success: false, result: jsonErr(msg) }
    }
  },
}
