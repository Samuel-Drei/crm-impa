/**
 * Learning Module — 3ª camada de memória do agente: aprendizado procedural.
 *
 * Diferente da memória de contato (AIMemory) e do grafo (AIBrainFact), este
 * módulo permite que o AGENTE registre lições aprendidas — padrões/regras
 * descobertos na prática que ele deve seguir/evitar em futuras interações.
 *
 * Exemplos:
 *   - "Quando o cliente perguntar sobre prazo, sempre confirmar o CEP antes de cotar"
 *   - "Erro comum: assumir que todo pedido é para retirada — sempre perguntar"
 *
 * As lições ativas são injetadas no system prompt do agente (via agent-builder)
 * e podem ser revisadas/aprovadas/podadas por humanos no painel.
 *
 * Config esperada em agent.settings.learning:
 *   { enabled: boolean, allowSelfLearning?: boolean }
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'

export interface LearningToolConfig {
  enabled?: boolean
  allowSelfLearning?: boolean // se false, agente só lê — não grava (humano gerencia)
}

const RECORD_LEARNING_TOOL: AIToolDefinition = {
  name: 'record_learning',
  description:
    'Registra uma LIÇÃO APRENDIDA (regra/padrão procedural) que VOCÊ aprendeu nesta conversa e deve aplicar em FUTURAS interações com QUALQUER contato. ' +
    'Use APENAS quando descobrir um padrão genuinamente novo, um erro a evitar, ou uma regra que melhora seu comportamento. ' +
    'NÃO use para fatos sobre o contato (use save_memory) ou informação genérica. ' +
    'Exemplos: "Sempre confirmar CEP antes de cotar frete", "Evitar prometer prazos sem checar estoque".',
  inputSchema: {
    type: 'object',
    properties: {
      trigger: {
        type: 'string',
        description: 'Quando esta lição deve ser aplicada (contexto/situação). Ex: "Quando o cliente perguntar sobre prazo de entrega".',
      },
      lesson: {
        type: 'string',
        description: 'O que fazer/evitar quando o trigger ocorrer. Ex: "Sempre confirmar CEP antes de cotar — sem isso, prazos podem estar errados".',
      },
      category: {
        type: 'string',
        enum: ['general', 'error_avoidance', 'optimization', 'policy'],
        description: 'Categoria da lição.',
      },
    },
    required: ['trigger', 'lesson'],
  },
}

const LIST_LEARNINGS_TOOL: AIToolDefinition = {
  name: 'list_learnings',
  description:
    'Lista as lições aprendidas ativas que você deve aplicar. Útil para revisar antes de tomar uma decisão complexa.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['general', 'error_avoidance', 'optimization', 'policy'],
        description: 'Filtrar por categoria (opcional).',
      },
    },
  },
}

const FORGET_LEARNING_TOOL: AIToolDefinition = {
  name: 'forget_learning',
  description:
    'Arquiva uma lição aprendida que se mostrou errada ou obsoleta. Use quando perceber que uma lição anterior está te fazendo errar.',
  inputSchema: {
    type: 'object',
    properties: {
      learningId: { type: 'string', description: 'ID da lição (visível em list_learnings).' },
      reason: { type: 'string', description: 'Por que arquivar (para auditoria).' },
    },
    required: ['learningId'],
  },
}

function jsonOk(data: any) { return JSON.stringify({ success: true, ...data }) }
function jsonErr(msg: string, code = 'learning_error') { return JSON.stringify({ success: false, error: code, message: msg }) }

export const learningModule: ToolModule = {
  type: 'learning',
  name: 'Agent Procedural Learning',

  getTools(config: LearningToolConfig | null | undefined): AIToolDefinition[] {
    if (!config || config.enabled === false) return []
    const tools: AIToolDefinition[] = [LIST_LEARNINGS_TOOL]
    if (config.allowSelfLearning !== false) {
      tools.push(RECORD_LEARNING_TOOL, FORGET_LEARNING_TOOL)
    }
    return tools
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: LearningToolConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const { companyId, agentId, sessionId } = ctx
      if (!companyId || !agentId) return { success: false, result: jsonErr('Contexto incompleto') }

      if (toolName === 'record_learning') {
        if (config?.allowSelfLearning === false) {
          return { success: false, result: jsonErr('Agente não tem permissão para auto-aprender (allowSelfLearning=false)') }
        }
        const trigger = String(args.trigger || '').trim().substring(0, 500)
        const lesson = String(args.lesson || '').trim().substring(0, 1000)
        const category = ['general', 'error_avoidance', 'optimization', 'policy'].includes(args.category) ? args.category : 'general'
        if (!trigger || !lesson) return { success: false, result: jsonErr('"trigger" e "lesson" são obrigatórios') }

        // Dedupe simples: se já existe lição com mesmo trigger+lesson (case-insensitive), incrementa confiança
        const existing = await prisma.aIAgentLearning.findFirst({
          where: { companyId, agentId, active: true, trigger: { equals: trigger, mode: 'insensitive' }, lesson: { equals: lesson, mode: 'insensitive' } },
        })
        if (existing) {
          const updated = await prisma.aIAgentLearning.update({
            where: { id: existing.id },
            data: { confidence: Math.min(1, existing.confidence + 0.05), positiveCount: { increment: 1 } },
          })
          return { success: true, result: jsonOk({ message: 'Lição já registrada — confiança atualizada.', id: updated.id, confidence: updated.confidence }) }
        }

        const created = await prisma.aIAgentLearning.create({
          data: { companyId, agentId, trigger, lesson, category, sourceType: 'agent_self_reflection', sourceRefId: sessionId || null },
        })
        return { success: true, result: jsonOk({ message: 'Lição registrada.', id: created.id }) }
      }

      if (toolName === 'list_learnings') {
        const where: any = { companyId, agentId, active: true }
        if (args.category) where.category = args.category
        const list = await prisma.aIAgentLearning.findMany({
          where, orderBy: [{ confidence: 'desc' }, { appliedCount: 'desc' }], take: 30,
        })
        return { success: true, result: jsonOk({ count: list.length, learnings: list.map(l => ({ id: l.id, trigger: l.trigger, lesson: l.lesson, category: l.category, confidence: l.confidence, appliedCount: l.appliedCount })) }) }
      }

      if (toolName === 'forget_learning') {
        const id = String(args.learningId || '')
        if (!id) return { success: false, result: jsonErr('"learningId" é obrigatório') }
        const found = await prisma.aIAgentLearning.findFirst({ where: { id, companyId, agentId } })
        if (!found) return { success: false, result: jsonErr('Lição não encontrada', 'not_found') }
        await prisma.aIAgentLearning.update({ where: { id }, data: { active: false, archivedAt: new Date(), negativeCount: { increment: 1 } } })
        return { success: true, result: jsonOk({ message: 'Lição arquivada.', id, reason: args.reason || null }) }
      }

      return { success: false, result: jsonErr(`Tool ${toolName} desconhecida`, 'tool_not_found') }
    } catch (err) {
      const msg = (err as Error).message
      console.error('[LearningTool] Falha:', msg)
      return { success: false, result: jsonErr(msg) }
    }
  },
}
