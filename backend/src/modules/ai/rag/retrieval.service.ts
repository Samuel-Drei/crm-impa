/**
 * Retrieval Service — Busca semântica nos knowledge bases vinculados ao agente
 * Substitui a injeção bruta de conteúdo no prompt
 * Inspirado no Dify dataset_retrieval.py
 * 
 * Melhorias:
 * - Reranking por relevância (BM25-like keyword overlap + cosine)
 * - Cache de retrieval com TTL (evita chamadas repetidas ao Qdrant)
 * - Parâmetros dinâmicos da KB (topK, scoreThreshold da config)
 */

import { prisma } from '../../../config/database.js'
import { decryptSafe } from '../../../config/encryption.js'
import { embedQuery, type EmbeddingConfig, buildEmbeddingConfigFromAIProvider } from './embedding.service.js'
import { searchSimilar, getCollectionName, checkQdrantHealth } from './qdrant.client.js'
import { createHash } from 'crypto'

export interface RetrievalResult {
  content: string
  score: number
  source: {
    documentTitle: string
    sourceUrl?: string
    sourceName: string
    sourceType: string
    knowledgeBaseName: string
    // YouTube-specific (para citação com timestamp)
    startFormatted?: string
    endFormatted?: string
    youtubeUrl?: string
    videoId?: string
    channelName?: string
    // Document structure (heading-aware chunking)
    sectionTitle?: string
    pageNumber?: number
    elementType?: string
  }
  chunkId: string
}

export interface RetrievalContext {
  chunks: RetrievalResult[]
  totalTokens: number
  formattedContext: string
}

// ============================================
// CACHE DE RETRIEVAL (LRU com TTL)
// ============================================
interface CacheEntry {
  result: RetrievalContext
  timestamp: number
}

const RETRIEVAL_CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000        // 60 segundos
const CACHE_MAX_ENTRIES = 500

function getCacheKey(agentId: string, query: string, kbIds: string[]): string {
  const raw = `${agentId}:${query.toLowerCase().trim()}:${kbIds.sort().join(',')}`
  return createHash('md5').update(raw).digest('hex')
}

function getFromCache(key: string): RetrievalContext | null {
  const entry = RETRIEVAL_CACHE.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    RETRIEVAL_CACHE.delete(key)
    return null
  }
  return entry.result
}

function setInCache(key: string, result: RetrievalContext): void {
  // Não cachear resultados vazios — assim queries que falharam por threshold/embedding
  // têm chance de funcionar na próxima tentativa sem esperar TTL
  if (!result.formattedContext || result.chunks.length === 0) return
  // Evictar entradas antigas se atingiu o limite
  if (RETRIEVAL_CACHE.size >= CACHE_MAX_ENTRIES) {
    const firstKey = RETRIEVAL_CACHE.keys().next().value
    if (firstKey) RETRIEVAL_CACHE.delete(firstKey)
  }
  RETRIEVAL_CACHE.set(key, { result, timestamp: Date.now() })
}

// ============================================
// RERANKING — combina cosine similarity + keyword overlap
// ============================================

/**
 * Reranker simples que combina o score de cosine similarity do Qdrant
 * com um score de overlap de termos (BM25-like) para melhorar a precisão.
 *
 * Peso: 50% cosine + 50% keyword overlap. Quando 100% dos termos significativos
 * da query aparecem no chunk, aplica boost adicional para garantir que match
 * literária suba ao topo (resolve casos de "qual o peso do X" onde X aparece
 * literalmente no chunk mas o cosine score fica médio).
 */
function rerankResults(
  results: Array<{ content: string; score: number; id: string; metadata: Record<string, unknown> }>,
  query: string
): Array<{ content: string; score: number; id: string; metadata: Record<string, unknown> }> {
  if (results.length <= 1) return results

  const STOPWORDS = new Set([
    'qual','quais','quanto','quanta','como','onde','quando','porque','por','para','pra','ao','aos','das','dos','del',
    'que','com','sem','meu','minha','seu','sua','este','esta','esse','essa','esses','essas','isso','isto','aquele',
    'aquela','sobre','entre','ate','tem','ter','sao','foi','ser','sim','nao','medio','media','aproximado','aproximada',
  ])
  const significantQueryTerms = tokenize(query).filter(t => !STOPWORDS.has(t))
  const queryTerms = significantQueryTerms.length > 0 ? significantQueryTerms : tokenize(query)
  if (queryTerms.length === 0) return results

  // Calcular keyword overlap score para cada resultado
  const scored = results.map(r => {
    const contentTerms = tokenize(r.content)
    const overlapScore = calculateOverlapScore(queryTerms, contentTerms)
    // Score combinado: 50% cosine + 50% keyword overlap
    let combinedScore = (r.score * 0.5) + (overlapScore * 0.5)
    // Bonus quando todos os termos significativos da query aparecem no chunk
    if (overlapScore >= 0.999) combinedScore += 0.3
    else if (overlapScore >= 0.75) combinedScore += 0.15
    return { ...r, score: combinedScore, _originalScore: r.score, _keywordScore: overlapScore }
  })

  // Reordenar por score combinado
  scored.sort((a, b) => b.score - a.score)

  return scored
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2) // Ignorar termos muito curtos
}

function calculateOverlapScore(queryTerms: string[], contentTerms: string[]): number {
  const contentSet = new Set(contentTerms)
  let matches = 0
  for (const term of queryTerms) {
    if (contentSet.has(term)) {
      matches++
    } else {
      // Partial match (prefixo) para lidar com plurais/conjugações
      for (const ct of contentSet) {
        if (ct.startsWith(term) || term.startsWith(ct)) {
          matches += 0.5
          break
        }
      }
    }
  }
  return queryTerms.length > 0 ? matches / queryTerms.length : 0
}

/**
 * Busca chunks relevantes para uma query baseada nos knowledge bases do agente
 */
export async function retrieveForAgent(
  agentId: string,
  companyId: string,
  query: string,
  options: {
    topK?: number
    scoreThreshold?: number
    maxContextTokens?: number
  } = {}
): Promise<RetrievalContext> {
  const { topK = 5, scoreThreshold = 0.5, maxContextTokens = 3000 } = options

  // 1. Buscar knowledge bases vinculadas ao agente
  const agentKnowledges = await prisma.aIAgentKnowledge.findMany({
    where: { agentId },
    include: {
      knowledgeBase: {
        select: {
          id: true,
          name: true,
          isActive: true,
          retrievalMode: true,
          topK: true,
          scoreThreshold: true,
          embeddingProviderId: true,
          embeddingProvider: true,
          embeddingModel: true,
          embeddingApiKey: true,
          embeddingBaseUrl: true,
          // Legacy fields para fallback
          content: true,
          type: true,
        },
      },
    },
  })

  const activeBases = agentKnowledges
    .filter((ak) => ak.knowledgeBase.isActive)
    .map((ak) => ak.knowledgeBase)

  if (activeBases.length === 0) {
    return { chunks: [], totalTokens: 0, formattedContext: '' }
  }

  // Cache: verificar se já temos resultado recente para esta query+bases
  const kbIds = activeBases.map(b => b.id)
  const cacheKey = getCacheKey(agentId, query, kbIds)
  const cached = getFromCache(cacheKey)
  if (cached) {
    console.log(`[RAG] Cache hit for query "${query.substring(0, 50)}..." (${cached.chunks.length} chunks)`)
    return cached
  }

  // 2. Verificar se Qdrant está disponível
  const qdrantAvailable = await checkQdrantHealth()

  if (!qdrantAvailable) {
    // Fallback: usar conteúdo bruto (modo antigo)
    return buildLegacyContext(activeBases, maxContextTokens)
  }

  // 3. Resolver config de embedding da primeira base ativa
  // (todas as bases de um agente devem usar o mesmo modelo para busca coerente)
  const primaryKb = activeBases[0]
  const embeddingConfig = await resolveEmbeddingConfigForRetrieval(primaryKb, companyId, agentId)

  if (!embeddingConfig) {
    return buildLegacyContext(activeBases, maxContextTokens)
  }

  // 4. Gerar embedding da query
  // 4a. Query expansion para queries curtas (melhora score para keywords)
  const expandedQuery = expandShortQuery(query)
  let queryVector: number[]

  try {
    queryVector = await embedQuery(expandedQuery, embeddingConfig, embeddingConfig.model, companyId)
  } catch (error) {
    console.error('[RAG] Erro ao gerar embedding da query:', error)
    return buildLegacyContext(activeBases, maxContextTokens)
  }

  // 5. Buscar no Qdrant
  const collectionName = getCollectionName(companyId)
  const knowledgeBaseIds = activeBases.map((b) => b.id)

  const effectiveTopK = Math.max(...activeBases.map((b) => b.topK || topK), topK)

  // Threshold para POST-reranking: considera KB config mas com floor de 0.1
  // (score pós-reranker é 50% cosine + 50% keyword, então mesmo chunks com
  //  cosine baixo mas keyword alto podem superar 0.3–0.4)
  const wordCount = query.trim().split(/\s+/).length
  const shortQueryPenalty = wordCount <= 2 ? 0.15 : wordCount <= 4 ? 0.05 : 0
  const postRerankThreshold = Math.max(
    0.1,
    Math.min(...activeBases.map((b) => b.scoreThreshold || scoreThreshold), scoreThreshold) - shortQueryPenalty - 0.2
  )

  let searchResults: Array<{
    id: string
    score: number
    content: string
    metadata: Record<string, unknown>
  }>

  try {
    // Qdrant recebe threshold fixo 0.1 para garantir que chunks com keyword
    // match alto mas cosine baixo (~0.2) cheguem ao reranker.
    searchResults = await searchSimilar(collectionName, queryVector, {
      companyId,
      knowledgeBaseIds,
      topK: effectiveTopK * 4,
      scoreThreshold: 0.1,
    })
  } catch (error) {
    console.warn('[RAG] Erro na busca Qdrant, usando fallback:', error)
    return buildLegacyContext(activeBases, maxContextTokens)
  }

  if (searchResults.length === 0) {
    // Sem resultados no Qdrant, tentar fallback
    return buildLegacyContext(activeBases, maxContextTokens)
  }

  // 6. Reranking: combinar cosine similarity com keyword overlap
  const allReranked = rerankResults(searchResults, query)
  // Aplicar threshold pós-reranker (não pré-Qdrant)
  const rerankedResults = allReranked.filter(r => r.score >= postRerankThreshold).slice(0, effectiveTopK)
  const finalResults = rerankedResults.length > 0 ? rerankedResults : allReranked.slice(0, effectiveTopK)
  console.log(`[RAG] Reranked ${searchResults.length} → ${finalResults.length} results (top score: ${finalResults[0]?.score.toFixed(3)})`)

  // 7. Montar contexto formatado com citações
  const chunks: RetrievalResult[] = finalResults.map((r) => ({
    content: r.content,
    score: r.score,
    source: {
      documentTitle: (r.metadata.document_title as string) || 'Sem título',
      sourceUrl: r.metadata.source_url as string | undefined,
      sourceName: (r.metadata.source_name as string) || 'Fonte desconhecida',
      sourceType: (r.metadata.source_type as string) || 'text',
      knowledgeBaseName: (r.metadata.knowledge_base_name as string) || 'Base de conhecimento',
      // YouTube-specific
      startFormatted: r.metadata.start_formatted as string | undefined,
      endFormatted: r.metadata.end_formatted as string | undefined,
      youtubeUrl: r.metadata.youtube_url as string | undefined,
      videoId: r.metadata.video_id as string | undefined,
      channelName: r.metadata.channel_name as string | undefined,
      // Document structure
      sectionTitle: r.metadata.section_title as string | undefined,
      pageNumber: r.metadata.page_number as number | undefined,
      elementType: r.metadata.element_type as string | undefined,
    },
    chunkId: r.id,
  }))

  // Limitar por tokens
  let totalTokens = 0
  const selectedChunks: RetrievalResult[] = []
  for (const chunk of chunks) {
    const tokenCount = Math.ceil(chunk.content.length / 4)
    if (totalTokens + tokenCount > maxContextTokens) break
    selectedChunks.push(chunk)
    totalTokens += tokenCount
  }

  // Formatar contexto com citações (como Dify faz)
  const formattedContext = formatContextWithCitations(selectedChunks)

  // Log preview dos chunks selecionados — facilita debug de RAG sem precisar rodar Qdrant à mão
  try {
    const preview = selectedChunks.slice(0, 3).map((c, i) => {
      const snippet = c.content.replace(/\s+/g, ' ').slice(0, 140)
      return `  #${i + 1} score=${c.score.toFixed(3)} src=${c.source.sourceName} :: ${snippet}${c.content.length > 140 ? '…' : ''}`
    }).join('\n')
    console.log(`[RAG] Selected ${selectedChunks.length} chunks for query "${query.slice(0, 80)}":\n${preview}`)
  } catch { /* ignore */ }

  // Incrementar hitCount nos chunks retornados (fire-and-forget, padrão Dify)
  incrementHitCounts(selectedChunks).catch(() => {})

  const result = { chunks: selectedChunks, totalTokens, formattedContext }

  // Salvar no cache
  setInCache(cacheKey, result)

  return result
}

/**
 * Fallback: Injeção bruta de conteúdo (modo antigo)
 */
function buildLegacyContext(
  bases: Array<{ id: string; name: string; content: string | null; type: string }>,
  maxTokens: number
): RetrievalContext {
  const parts: string[] = []
  let totalTokens = 0

  for (const base of bases) {
    if (!base.content) continue
    const tokenCount = Math.ceil(base.content.length / 4)
    if (totalTokens + tokenCount > maxTokens) {
      // Truncar
      const remaining = maxTokens - totalTokens
      parts.push(`[${base.name}]: ${base.content.slice(0, remaining * 4)}...`)
      totalTokens = maxTokens
      break
    }
    parts.push(`[${base.name}]: ${base.content}`)
    totalTokens += tokenCount
  }

  return {
    chunks: [],
    totalTokens,
    formattedContext: parts.join('\n\n'),
  }
}

/**
 * Formata contexto com citações marcadas (padrão Dify)
 */
function formatContextWithCitations(chunks: RetrievalResult[]): string {
  if (chunks.length === 0) return ''

  const parts = chunks.map((chunk, i) => {
    let sourceInfo: string

    if (chunk.source.youtubeUrl) {
      // YouTube: citação com timestamp e link direto
      const timeRef = chunk.source.startFormatted && chunk.source.endFormatted
        ? ` (${chunk.source.startFormatted} - ${chunk.source.endFormatted})`
        : ''
      const channel = chunk.source.channelName ? ` | ${chunk.source.channelName}` : ''
      sourceInfo = `[${chunk.source.documentTitle}${timeRef}${channel}](${chunk.source.youtubeUrl})`
    } else if (chunk.source.sourceUrl) {
      sourceInfo = `[${chunk.source.documentTitle}](${chunk.source.sourceUrl})`
    } else {
      sourceInfo = `[${chunk.source.documentTitle}]`
    }

    // Metadata de estrutura documental (seção, página)
    const structParts: string[] = []
    if (chunk.source.sectionTitle) structParts.push(`Seção: ${chunk.source.sectionTitle}`)
    if (chunk.source.pageNumber) structParts.push(`Página ${chunk.source.pageNumber}`)
    const structInfo = structParts.length > 0 ? ` | ${structParts.join(', ')}` : ''

    return `<context_${i + 1} source="${chunk.source.sourceName}" relevance="${(chunk.score * 100).toFixed(0)}%">\n${chunk.content}\n— Fonte: ${sourceInfo}${structInfo}\n</context_${i + 1}>`
  })

  return `<retrieved_knowledge>\n${parts.join('\n\n')}\n</retrieved_knowledge>`
}

/**
 * Incrementa hitCount nos chunks retornados (rastreabilidade, padrão Dify segment.hit_count)
 * Fire-and-forget: não bloqueia o response
 */
async function incrementHitCounts(chunks: RetrievalResult[]): Promise<void> {
  const chunkIds = chunks.map((c) => c.chunkId).filter(Boolean)
  if (chunkIds.length === 0) return

  // Batch update de hitCount — using safe Prisma API instead of $executeRawUnsafe
  await prisma.aIKnowledgeChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: { hitCount: { increment: 1 } },
  })
}

/**
 * Expande queries curtas para melhorar a qualidade do embedding
 * Modelos de embedding (text-embedding-3-small/large) funcionam muito melhor
 * com frases do que com palavras isoladas.
 * 
/**
 * Resolve config de embedding para retrieval.
 * Prioridade: KB.embeddingProviderId → KB.embeddingApiKey (legacy) → Provider da empresa → Agent provider → env
 */
async function resolveEmbeddingConfigForRetrieval(
  kb: { embeddingProviderId?: string | null; embeddingProvider?: string | null; embeddingModel: string; embeddingApiKey?: string | null; embeddingBaseUrl?: string | null },
  companyId: string,
  agentId: string
): Promise<EmbeddingConfig | null> {
  const provider = kb.embeddingProvider || 'openai'
  const model = kb.embeddingModel || 'text-embedding-3-small'

  // 1. Provider vinculado diretamente (novo padrão)
  if (kb.embeddingProviderId) {
    const linkedProvider = await prisma.aIProvider.findUnique({
      where: { id: kb.embeddingProviderId },
    })
    if (linkedProvider?.apiKey) {
      // Para GITHUB_COPILOT precisamos do copilotToken fresco (auto-refresh)
      if (linkedProvider.type === 'GITHUB_COPILOT') {
        const { getProviderWithFreshToken } = await import('../ai.service.js')
        const fresh = await getProviderWithFreshToken(linkedProvider.id, companyId)
        if (fresh) {
          return buildEmbeddingConfigFromAIProvider({
            type: fresh.type,
            apiKey: fresh.apiKey,
            baseUrl: fresh.baseUrl,
            oauthData: fresh.oauthData,
          }, model, kb.embeddingBaseUrl)
        }
      }
      return buildEmbeddingConfigFromAIProvider({
        type: linkedProvider.type,
        apiKey: decryptSafe(linkedProvider.apiKey) as string,
        baseUrl: linkedProvider.baseUrl,
      }, model, kb.embeddingBaseUrl)
    }
  }

  // 2. API key da KB (legacy)
  if (kb.embeddingApiKey) {
    return { provider, model, apiKey: decryptSafe(kb.embeddingApiKey) as string, baseUrl: kb.embeddingBaseUrl }
  }

  // 3. Provider da empresa
  const providerTypeMap: Record<string, string> = {
    openai: 'OPENAI', gemini: 'GEMINI', cohere: 'OPENAI', voyage: 'OPENAI', ollama: 'OPENAI'
  }
  const companyProvider = await prisma.aIProvider.findFirst({
    where: { companyId, type: (providerTypeMap[provider] || 'OPENAI') as any, isActive: true },
  })
  if (companyProvider?.apiKey) {
    return { provider, model, apiKey: decryptSafe(companyProvider.apiKey) as string, baseUrl: kb.embeddingBaseUrl }
  }

  // 4. Provider do agente (fallback para retrocompatibilidade)
  const agent = await prisma.aIAgent.findUnique({
    where: { id: agentId },
    include: { provider: true },
  })
  if (agent?.provider?.apiKey) {
    return { provider, model, apiKey: decryptSafe(agent.provider.apiKey) as string, baseUrl: kb.embeddingBaseUrl }
  }

  // 5. Variáveis de ambiente
  const envKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY,
    cohere: process.env.COHERE_API_KEY, voyage: process.env.VOYAGE_API_KEY, ollama: 'ollama',
  }
  const envKey = envKeyMap[provider]
  if (envKey) return { provider, model, apiKey: envKey, baseUrl: kb.embeddingBaseUrl }

  return null
}

/**
 * Expande queries curtas para melhorar embedding score
 * "openclaw" → "O que é openclaw? Informações sobre openclaw"
 * "preço plano" → "Qual o preço e plano? preço plano valores"
 */
function expandShortQuery(query: string): string {
  const trimmed = query.trim()
  const words = trimmed.split(/\s+/)

  // Queries com 4+ palavras já são suficientes para bom embedding
  if (words.length >= 4) return trimmed

  // 1 palavra: expande com contexto de busca
  if (words.length === 1) {
    return `O que é ${trimmed}? Informações sobre ${trimmed}. ${trimmed}`
  }

  // 2-3 palavras: expande levemente
  return `${trimmed}. Informações sobre ${trimmed}`
}
