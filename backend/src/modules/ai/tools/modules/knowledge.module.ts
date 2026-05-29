/**
 * Knowledge Base Tool Module — RAG agêntico
 *
 * Expõe `search_knowledge_base(query)` como uma tool nativa que a IA decide
 * quando chamar e com qual query (ex: extrair "Cane Corso" do contexto da
 * conversa quando o usuário responde apenas "2" ou "padrão").
 *
 * Arquitetura: complementa o RAG passivo. O passivo roda sempre com a última
 * mensagem do usuário; a tool agêntica permite buscas sob demanda com query
 * formulada pela IA com base em todo o histórico.
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { retrieveForAgent } from '../../rag/retrieval.service.js'

export interface KnowledgeModuleConfig {
  enabled: boolean
  topK?: number
  scoreThreshold?: number
}

const TOOL_DEFINITION: AIToolDefinition = {
  name: 'search_knowledge_base',
  description:
    'Busca informações na base de conhecimento oficial (tabelas, catálogos, FAQ, documentos). ' +
    'Use SEMPRE que precisar de dados oficiais (peso de raça, preço de produto, especificação de curso, etc.) ' +
    'e o dado não esteja explícito no contexto recente. ' +
    'IMPORTANTE: a query deve conter a palavra-chave correta extraída do histórico — ' +
    'NÃO mande "1", "sim", "qual"; mande o NOME da entidade (ex: "Cane Corso", "Curso de Marketing Digital", "Plano Mensal"). ' +
    'Se o cliente respondeu apenas um número de menu, recupere a entidade discutida nas mensagens anteriores e use ela como query.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Termo de busca específico (nome da raça, produto, curso, etc.). ' +
          'Mínimo 3 caracteres significativos. Não usar "1", "2", "sim", "ok".',
      },
    },
    required: ['query'],
  },
}

export const knowledgeModule: ToolModule = {
  type: 'knowledge',
  name: 'Knowledge Base Search',

  getTools(config: KnowledgeModuleConfig): AIToolDefinition[] {
    if (!config?.enabled) return []
    return [TOOL_DEFINITION]
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: KnowledgeModuleConfig,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (toolName !== 'search_knowledge_base') {
      return {
        success: false,
        result: JSON.stringify({ error: 'unknown_tool', tool: toolName }),
        error: `Unknown tool: ${toolName}`,
      }
    }

    const rawQuery = String(args.query ?? '').trim()
    if (rawQuery.length < 3) {
      return {
        success: false,
        result: JSON.stringify({
          error: 'query_too_short',
          message:
            'A query precisa ter ao menos 3 caracteres significativos. Use o nome da entidade discutida (raça, produto, curso), não o número/letra de menu.',
        }),
        error: 'query_too_short',
      }
    }

    try {
      const start = Date.now()
      const result = await retrieveForAgent(ctx.agentId, ctx.companyId, rawQuery, {
        topK: config.topK ?? 5,
        scoreThreshold: config.scoreThreshold ?? 0.4,
        maxContextTokens: 2500,
      })
      const latencyMs = Date.now() - start

      console.log(
        `[KnowledgeTool] query="${rawQuery.slice(0, 60)}" → ${result.chunks.length} chunks (${result.totalTokens} tokens) in ${latencyMs}ms`,
      )

      if (result.chunks.length === 0) {
        return {
          success: true, // não é erro — apenas vazio
          result: JSON.stringify({
            found: false,
            query: rawQuery,
            message:
              'Nenhum trecho relevante encontrado para esta query. Refine o termo (use o nome exato da entidade) ou colete o dado diretamente do cliente.',
          }),
          metadata: { latencyMs },
        }
      }

      // Retornar chunks de forma estruturada para o LLM
      const chunks = result.chunks.map((c) => ({
        score: Number(c.score.toFixed(3)),
        source: c.source.documentTitle || c.source.sourceName,
        content: c.content,
      }))

      return {
        success: true,
        result: JSON.stringify({
          found: true,
          query: rawQuery,
          totalChunks: chunks.length,
          chunks,
        }),
        metadata: { latencyMs },
      }
    } catch (err: any) {
      const message = err?.message || String(err)
      console.error('[KnowledgeTool] retrieval failed:', message)
      return {
        success: false,
        result: JSON.stringify({ error: 'retrieval_failed', message }),
        error: message,
      }
    }
  },
}
