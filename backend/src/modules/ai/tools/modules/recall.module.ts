/**
 * Recall Module — Tool de RAG sobre o "cérebro diário" (Daily Brain Digest)
 *
 * Permite ao agente perguntar "o que conversamos com X na semana passada?" e
 * receber chunks vetorizados do histórico processado pelo job noturno.
 *
 * Config esperada em agent.settings.recall:
 *   { enabled: boolean, topK?: number, scoreThreshold?: number }
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { decryptProviderSecrets } from '../../ai.service.js'
import {
  embedQuery,
  buildEmbeddingConfigFromAIProvider,
} from '../../rag/embedding.service.js'
import { searchSimilar, getDailyBrainCollectionName } from '../../rag/qdrant.client.js'
import { DAILY_BRAIN_KB_NAME } from '../../brain/brain-persist.service.js'

export interface RecallToolConfig {
  enabled?: boolean
  topK?: number
  scoreThreshold?: number
}

const TOOL_DEF: AIToolDefinition = {
  name: 'recall_daily_history',
  description:
    'Recupera o histórico diário consolidado do CRM (memória de longo prazo). Use quando o usuário ' +
    'perguntar sobre eventos passados ("o que aconteceu ontem", "do que conversamos na semana passada", ' +
    '"resumo do contato X"). Retorna trechos relevantes do "cérebro diário" via busca semântica.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Consulta em linguagem natural sobre o histórico (ex: "interesse em produto X").',
      },
      contactId: {
        type: 'string',
        description: 'Opcional. ID do contato para filtrar o histórico (use o contato atual se não souber).',
      },
      topK: {
        type: 'number',
        description: 'Quantos resultados retornar (default 5, máx 15).',
      },
    },
    required: ['query'],
  },
}

function jsonOk(data: any) {
  return JSON.stringify({ success: true, ...data })
}
function jsonErr(message: string, code = 'recall_error') {
  return JSON.stringify({ success: false, error: code, message })
}

async function getCompanyEmbeddingForQuery(companyId: string) {
  const provider = await prisma.aIProvider.findFirst({
    where: { companyId, isActive: true, isDefault: true },
  })
  const fallback =
    provider ??
    (await prisma.aIProvider.findFirst({
      where: { companyId, isActive: true, type: { in: ['OPENAI', 'GEMINI', 'GITHUB_COPILOT'] } },
      orderBy: { createdAt: 'asc' },
    }))
  if (!fallback) return null
  const decrypted = decryptProviderSecrets(fallback)
  const model = decrypted.type === 'GEMINI' ? 'text-embedding-004' : 'text-embedding-3-small'
  return { config: buildEmbeddingConfigFromAIProvider(decrypted, model), model }
}

export const recallModule: ToolModule = {
  type: 'recall',
  name: 'Daily Brain Recall',

  getTools(config: RecallToolConfig | null | undefined): AIToolDefinition[] {
    if (!config) return []
    if (config.enabled === false) return []
    return [TOOL_DEF]
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: RecallToolConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (toolName !== 'recall_daily_history') {
      return { success: false, result: jsonErr(`Tool ${toolName} desconhecida`, 'tool_not_found') }
    }

    const query = String(args.query || '').trim()
    if (!query) {
      return { success: false, result: jsonErr('query é obrigatório') }
    }

    try {
      // Localiza KB daily_brain
      const kb = await prisma.aIKnowledgeBase.findFirst({
        where: { companyId: ctx.companyId, name: DAILY_BRAIN_KB_NAME },
        select: { id: true },
      })
      if (!kb) {
        return { success: true, result: jsonOk({ results: [], note: 'Cérebro diário ainda não foi inicializado.' }) }
      }

      const emb = await getCompanyEmbeddingForQuery(ctx.companyId)
      if (!emb) {
        return { success: false, result: jsonErr('Sem provedor de embedding configurado', 'no_embedding') }
      }

      const queryVector = await embedQuery(query, emb.config, emb.model, ctx.companyId)
      const collection = getDailyBrainCollectionName(ctx.companyId)
      const topK = Math.min(15, Math.max(1, Number(args.topK) || config?.topK || 5))
      const scoreThreshold = config?.scoreThreshold ?? 0.3

      const hits = await searchSimilar(collection, queryVector, {
        companyId: ctx.companyId,
        knowledgeBaseIds: [kb.id],
        topK,
        scoreThreshold,
      })

      // Filtro opcional por contactId
      const contactFilter = args.contactId ? String(args.contactId) : null
      const filtered = contactFilter
        ? hits.filter(h => (h.metadata as any)?.contact_id === contactFilter)
        : hits

      const results = filtered.slice(0, topK).map(h => ({
        score: Number(h.score.toFixed(3)),
        date: (h.metadata as any)?.date,
        contact_name: (h.metadata as any)?.contact_name,
        contact_id: (h.metadata as any)?.contact_id,
        topics: (h.metadata as any)?.topics || [],
        content: h.content,
      }))

      return { success: true, result: jsonOk({ results, total: results.length, kb_id: kb.id }) }
    } catch (err) {
      const msg = (err as Error).message
      console.error('[RecallTool] Falha:', msg)
      return { success: false, result: jsonErr(msg) }
    }
  },
}
