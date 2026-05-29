/**
 * Ingestion Pipeline — Processa sources e indexa no Qdrant
 * Inspirado no Dify (index_processor) + Firecrawl (queue-worker)
 * 
 * Pipeline: Source → Extract → Clean → Chunk → Embed → Index (Qdrant)
 */

import { prisma } from '../../../config/database.js'
import { decryptSafe } from '../../../config/encryption.js'
import { splitText, cleanText, splitElements, type StructuredChunk } from './text-splitter.js'
import { embedTexts, estimateTokens, getEmbeddingDimension, type EmbeddingConfig, buildEmbeddingConfigFromAIProvider } from './embedding.service.js'
import { ensureCollection, getCollectionName, upsertChunks, deleteByFilter } from './qdrant.client.js'
import { scrapeUrl, crawlWebsite } from './web-crawler.js'
import { parseDocument, isDoclingAvailable } from './document-parser.js'
import { type DocumentElement, elementsToMarkdown } from './document-elements.js'
import { fetchYouTubeTranscript, createYouTubeChunks, extractVideoId, type TranscriptResult } from './youtube-transcript.js'
import crypto from 'crypto'

// Helper: Log embedding cost from ingestion to daily token report
const EMBEDDING_PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02, 'text-embedding-3-large': 0.13,
  'text-embedding-ada-002': 0.10, 'text-embedding-004': 0,
  'embed-multilingual-v3.0': 0.10, 'voyage-3': 0.06, 'voyage-3-lite': 0.02,
}

async function logIngestionEmbeddingCost(companyId: string, model: string, tokens: number) {
  try {
    const pricePerM = EMBEDDING_PRICING[model] || 0.02
    const costUsd = (tokens / 1_000_000) * pricePerM
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.aITokenReport.upsert({
      where: { companyId_agentId_instanceId_date: { companyId, agentId: '__embedding__', instanceId: '__rag__', date: today } },
      create: {
        companyId, agentId: '__embedding__', instanceId: '__rag__', date: today,
        messagesCount: 1, sessionsCount: 0, promptTokens: tokens, completionTokens: 0,
        totalTokens: tokens, costUsd,
        modelBreakdown: [{ model, tokens, cost: costUsd, type: 'embedding' }],
      },
      update: {
        messagesCount: { increment: 1 }, promptTokens: { increment: tokens },
        totalTokens: { increment: tokens }, costUsd: { increment: costUsd },
      },
    })
  } catch (e) { console.error('[RAG] Error logging ingestion embedding cost:', e) }
}

/**
 * Processa uma source completa (entrypoint principal)
 */
export async function processSource(
  sourceId: string,
  jobId: string
): Promise<void> {
  const source = await prisma.aIKnowledgeSource.findUnique({
    where: { id: sourceId },
    include: { knowledgeBase: true },
  })

  if (!source) throw new Error(`Source ${sourceId} not found`)

  const kb = source.knowledgeBase
  const collectionName = getCollectionName(source.companyId)

  // Resolver config de embedding: KB → Provider da empresa → env
  const embeddingConfig = await resolveEmbeddingConfig(kb, source.companyId)

  // Recalcular dimensão baseada no modelo escolhido
  const dimension = getEmbeddingDimension(embeddingConfig.model, embeddingConfig.provider)

  // Atualizar status
  await updateJob(jobId, { status: 'PROCESSING', currentStep: 'extracting', startedAt: new Date() })
  await prisma.aIKnowledgeSource.update({ where: { id: sourceId }, data: { status: 'PROCESSING' } })

  try {
    // Garantir collection no Qdrant (com dimensão do modelo escolhido)
    await ensureCollection(collectionName, dimension)

    // Extrair documentos conforme o tipo
    let extractedDocs: ExtractedDocument[]

    switch (source.type) {
      case 'TEXT':
        extractedDocs = await extractText(source)
        break
      case 'URL':
        extractedDocs = await extractUrl(source)
        break
      case 'WEBSITE':
        extractedDocs = await extractWebsite(source, jobId)
        break
      case 'YOUTUBE':
        extractedDocs = await extractYouTube(source)
        break
      case 'FILE':
        extractedDocs = await extractFile(source)
        break
      case 'QA':
        extractedDocs = await extractQA(source)
        break
      default:
        throw new Error(`Tipo de source não suportado: ${source.type}`)
    }

    await updateJob(jobId, { documentsFound: extractedDocs.length, currentStep: 'chunking' })

    // Se não há docs para processar (ex: YouTube sem legendas aguardando ASR), finalizar silenciosamente
    if (extractedDocs.length === 0) {
      await updateJob(jobId, {
        status: 'COMPLETED',
        progress: 100,
        currentStep: 'done',
        completedAt: new Date(),
      })
      console.log(`[Ingestion] Source ${sourceId}: nenhum documento para processar (pode precisar de ASR)`)
      return
    }

    // Processar cada documento
    let totalChunks = 0
    let totalTokens = 0
    let docsProcessed = 0

    for (const doc of extractedDocs) {
      const result = await processDocument(doc, {
        sourceId,
        companyId: source.companyId,
        knowledgeBaseId: kb.id,
        embeddingConfig,
        chunkSize: kb.chunkSize,
        chunkOverlap: kb.chunkOverlap,
        collectionName,
      })

      totalChunks += result.chunksCreated
      totalTokens += result.tokensUsed
      docsProcessed++

      await updateJob(jobId, {
        documentsProcessed: docsProcessed,
        chunksCreated: totalChunks,
        tokensUsed: totalTokens,
        progress: Math.round((docsProcessed / extractedDocs.length) * 100),
        currentStep: 'embedding',
      })
    }

    // Atualizar source e KB com totais
    await prisma.aIKnowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'COMPLETED',
        totalDocuments: docsProcessed,
        totalChunks,
        totalTokens,
        processedAt: new Date(),
        lastCrawledAt: source.type === 'WEBSITE' || source.type === 'URL' ? new Date() : undefined,
        crawlVersion: { increment: 1 },
      },
    })

    // Recalcular totais da KB
    const kbTotals = await prisma.aIKnowledgeSource.aggregate({
      where: { knowledgeBaseId: kb.id, status: 'COMPLETED' },
      _sum: { totalDocuments: true, totalChunks: true, totalTokens: true },
    })

    await prisma.aIKnowledgeBase.update({
      where: { id: kb.id },
      data: {
        totalDocuments: kbTotals._sum.totalDocuments || 0,
        totalChunks: kbTotals._sum.totalChunks || 0,
        totalTokens: kbTotals._sum.totalTokens || 0,
        indexingStatus: 'ready',
        lastIndexedAt: new Date(),
      },
    })

    await updateJob(jobId, {
      status: 'COMPLETED',
      progress: 100,
      currentStep: 'done',
      completedAt: new Date(),
    })

    console.log(`[Ingestion] Source ${sourceId} processada: ${docsProcessed} docs, ${totalChunks} chunks, ${totalTokens} tokens`)
  } catch (error) {
    const errorMsg = (error as Error).message
    console.error(`[Ingestion] Erro na source ${sourceId}:`, errorMsg)

    await prisma.aIKnowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'ERROR', errorMessage: errorMsg },
    })

    await updateJob(jobId, {
      status: 'ERROR',
      errorMessage: errorMsg,
      currentStep: 'error',
    })

    throw error
  }
}

// ============================================
// RESOLVER CONFIG DE EMBEDDING (padrão Dify)
// Prioridade: KB.embeddingProviderId → KB.embeddingApiKey (legacy) → Provider da empresa → env
// ============================================

async function resolveEmbeddingConfig(
  kb: { embeddingProviderId?: string | null; embeddingProvider?: string | null; embeddingModel: string; embeddingApiKey?: string | null; embeddingBaseUrl?: string | null },
  companyId: string
): Promise<EmbeddingConfig> {
  const provider = kb.embeddingProvider || 'openai'
  const model = kb.embeddingModel || 'text-embedding-3-small'

  // 1. Provider vinculado diretamente (novo padrão — como no Dify)
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

  // 2. API key da própria KB (legacy — mantido para compatibilidade)
  if (kb.embeddingApiKey) {
    return { provider, model, apiKey: decryptSafe(kb.embeddingApiKey) as string, baseUrl: kb.embeddingBaseUrl }
  }

  // 3. Buscar provider da empresa que corresponda ao tipo
  const providerTypeMap: Record<string, string> = {
    openai: 'OPENAI',
    gemini: 'GEMINI',
    cohere: 'OPENAI',
    voyage: 'OPENAI',
    ollama: 'OPENAI',
  }

  const aiProviderType = providerTypeMap[provider] || 'OPENAI'
  const companyProvider = await prisma.aIProvider.findFirst({
    where: { companyId, type: aiProviderType as any, isActive: true },
  })

  if (companyProvider?.apiKey) {
    return { provider, model, apiKey: decryptSafe(companyProvider.apiKey) as string, baseUrl: kb.embeddingBaseUrl }
  }

  // 4. Fallback para variáveis de ambiente
  const envKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    cohere: process.env.COHERE_API_KEY,
    voyage: process.env.VOYAGE_API_KEY,
    ollama: 'ollama',
  }

  const envKey = envKeyMap[provider]
  if (envKey) {
    return { provider, model, apiKey: envKey, baseUrl: kb.embeddingBaseUrl }
  }

  throw new Error(`Nenhuma API key encontrada para o provider "${provider}". Vincule um Provedor de IA à base de conhecimento, ou configure nas variáveis de ambiente.`)
}

// ============================================
// EXTRACTORS por tipo de source
// ============================================

interface ExtractedDocument {
  title: string
  sourceUrl?: string
  canonicalUrl?: string      // URL canônica (Firecrawl pattern)
  content: string
  contentHash: string
  language?: string          // Idioma detectado
  publishedAt?: Date | null  // Data de publicação
  metadata?: Record<string, unknown>
  // Novo: elementos tipados para chunking estrutural (Unstructured/Docling pattern)
  elements?: DocumentElement[]
  pageCount?: number
  parsingMethod?: string     // 'docling' | 'mammoth' | 'pdf-parse' | 'cheerio' | etc.
  fileSize?: number
}

async function extractText(source: any): Promise<ExtractedDocument[]> {
  const content = source.textContent || ''
  const hash = crypto.createHash('md5').update(content).digest('hex')
  return [{ title: source.name, content: cleanText(content), contentHash: hash }]
}

/**
 * Extrai pares Q&A como documentos independentes.
 * Cada par ativo vira 1 ExtractedDocument; como o conteúdo é curto, o chunker
 * naturalmente produz 1 chunk por par (pergunta + resposta juntos no embedding).
 */
async function extractQA(source: any): Promise<ExtractedDocument[]> {
  const items = Array.isArray(source.qaItems) ? source.qaItems : []
  const docs: ExtractedDocument[] = []
  for (const item of items) {
    if (!item || item.active === false) continue
    const question = String(item.question || '').trim()
    const answer = String(item.answer || '').trim()
    if (!question || !answer) continue
    const content = `Pergunta: ${question}\n\nResposta: ${answer}`
    const hash = crypto.createHash('md5').update(content).digest('hex')
    docs.push({
      title: question.slice(0, 120),
      sourceUrl: `qa://${source.id}/${item.id || hash}`,
      content,
      contentHash: hash,
      metadata: { qaPairId: item.id, question, answer },
    })
  }
  return docs
}

async function extractUrl(source: any): Promise<ExtractedDocument[]> {
  const result = await scrapeUrl(source.sourceUrl)
  return [{
    title: result.title || source.name,
    sourceUrl: result.url,
    canonicalUrl: result.canonicalUrl,
    content: result.content,
    contentHash: result.contentHash,
    language: result.metadata.language,
    publishedAt: result.metadata.publishedAt,
    metadata: result.metadata,
  }]
}

async function extractWebsite(source: any, jobId: string): Promise<ExtractedDocument[]> {
  const crawlConfig = (source.crawlConfig || {}) as Record<string, any>

  const results = await crawlWebsite(source.sourceUrl, {
    maxPages: crawlConfig.maxPages || 50,
    maxDepth: crawlConfig.maxDepth || 3,
    includePatterns: crawlConfig.includePatterns,
    excludePatterns: crawlConfig.excludePatterns,
    respectRobots: crawlConfig.respectRobots !== false,
  }, (progress) => {
    // Atualizar progresso do job assincronamente
    updateJob(jobId, {
      currentStep: `crawling (${progress.pagesProcessed}/${progress.pagesFound})`,
    }).catch(() => {})
  })

  // Atualizar pagesDiscovered na source
  await prisma.aIKnowledgeSource.update({
    where: { id: source.id },
    data: { pagesDiscovered: results.length },
  }).catch(() => {})

  return results.map((r) => ({
    title: r.title || r.url,
    sourceUrl: r.url,
    canonicalUrl: r.canonicalUrl,
    content: r.content,
    contentHash: r.contentHash,
    language: r.metadata.language,
    publishedAt: r.metadata.publishedAt,
    metadata: r.metadata,
  }))
}

async function extractYouTube(source: any): Promise<ExtractedDocument[]> {
  // Se já tem textContent de uma transcrição ASR anterior, usar isso
  if (source.textContent && (source.metadata as any)?.asrProvider) {
    console.log(`[YouTube] Usando transcript ASR existente para source ${source.id}`)
    const metadata = source.metadata as any
    const hash = crypto.createHash('md5').update(source.textContent).digest('hex')

    // Reconstruir transcript result para chunking com timestamps
    // O ASR salva segments no metadata; se não tiver, fazer chunk sem timestamp
    return [{
      title: metadata.title || source.name,
      sourceUrl: source.sourceUrl,
      content: source.textContent,
      contentHash: hash,
      language: metadata.asrLanguage || metadata.language || undefined,
      publishedAt: metadata.publishedAt ? new Date(metadata.publishedAt) : undefined,
      metadata: {
        videoId: metadata.videoId,
        channelName: metadata.channelName,
        duration: metadata.duration,
        isGenerated: false,
        thumbnailUrl: metadata.thumbnailUrl,
        needsAsrFallback: false,
        asrProvider: metadata.asrProvider,
        source: 'youtube_asr',
      },
    }]
  }

  const result = await fetchYouTubeTranscript(source.sourceUrl, {
    languages: ['pt', 'pt-BR', 'en', 'en-US', 'es'],
    segmentDuration: 120,
  })

  // Salvar transcript result na metadata da source para referência
  await prisma.aIKnowledgeSource.update({
    where: { id: source.id },
    data: {
      metadata: {
        ...(typeof source.metadata === 'object' && source.metadata ? source.metadata : {}),
        videoId: result.videoId,
        title: result.title,
        channelName: result.channelName,
        language: result.languageCode,
        isGenerated: result.isGenerated,
        duration: result.duration,
        thumbnailUrl: result.thumbnailUrl,
        viewCount: result.viewCount,
        publishedAt: result.publishedAt,
        needsAsrFallback: result.needsAsrFallback,
        totalSnippets: result.snippets.length,
        totalSegments: result.segments.length,
      },
    },
  }).catch(() => {})

  if (result.needsAsrFallback) {
    console.warn(`[YouTube] Vídeo ${result.videoId} sem legendas — aguardando transcrição ASR`)
    // Marcar source com status especial para que o frontend mostre o diálogo de confirmação ASR
    await prisma.aIKnowledgeSource.update({
      where: { id: source.id },
      data: {
        status: 'PENDING',
        errorMessage: 'NEEDS_ASR: Este vídeo não possui legendas. Transcrição de áudio (ASR) necessária.',
      },
    })

    // Retornar array vazio — não indexar nada até ASR ser confirmado
    return []
  }

  // Para YouTube com transcript disponível, retornar normalmente
  const hash = crypto.createHash('md5').update(result.fullText).digest('hex')
  return [{
    title: result.title,
    sourceUrl: source.sourceUrl,
    content: result.fullText,
    contentHash: hash,
    language: result.languageCode || undefined,
    publishedAt: result.publishedAt ? new Date(result.publishedAt) : undefined,
    metadata: {
      videoId: result.videoId,
      channelName: result.channelName,
      duration: result.duration,
      isGenerated: result.isGenerated,
      thumbnailUrl: result.thumbnailUrl,
      needsAsrFallback: false,
      source: 'youtube',
      _youtubeResult: result,
    },
  }]
}

async function extractFile(source: any): Promise<ExtractedDocument[]> {
  // Ler o arquivo do filesystem ou storage
  const fs = await import('fs/promises')
  const path = await import('path')

  if (!source.fileUrl) throw new Error('File URL não definida')

  // O fileUrl pode ser um path local (/app/uploads/...) ou URL
  let buffer: Buffer
  if (source.fileUrl.startsWith('http')) {
    const response = await fetch(source.fileUrl)
    buffer = Buffer.from(await response.arrayBuffer())
  } else {
    const filePath = path.join('/app', source.fileUrl)
    buffer = await fs.readFile(filePath)
  }

  // Usar o novo Document Parser (Docling microservice → fallback local)
  const parsed = await parseDocument(buffer, source.fileName || 'file', source.fileMimeType || '')
  const content = elementsToMarkdown(parsed.elements)
  const hash = crypto.createHash('md5').update(content).digest('hex')

  return [{
    title: parsed.title || source.fileName || 'file',
    content,
    contentHash: hash,
    language: parsed.language,
    elements: parsed.elements,
    pageCount: parsed.pageCount,
    parsingMethod: parsed.parsingMethod,
    fileSize: buffer.length,
    metadata: {
      fileName: source.fileName,
      mimeType: source.fileMimeType,
      parsingMethod: parsed.parsingMethod,
      parseTimeMs: parsed.parseTimeMs,
      pageCount: parsed.pageCount,
      wordCount: parsed.wordCount,
      charCount: parsed.charCount,
    },
  }]
}

// ============================================
// PROCESS DOCUMENT — Chunk + Embed + Index
// ============================================

async function processDocument(
  doc: ExtractedDocument,
  config: {
    sourceId: string
    companyId: string
    knowledgeBaseId: string
    embeddingConfig: EmbeddingConfig
    chunkSize: number
    chunkOverlap: number
    collectionName: string
  }
): Promise<{ chunksCreated: number; tokensUsed: number }> {
  // 1. Criar/atualizar documento no Postgres
  const existing = await prisma.aIKnowledgeDocument.findFirst({
    where: {
      knowledgeBaseId: config.knowledgeBaseId,
      sourceUrl: doc.sourceUrl || `internal:${doc.contentHash}`,
    },
  })

  let documentId: string

  if (existing) {
    // Se hash mudou, reprocessar. Se não, skip
    if (existing.contentHash === doc.contentHash && existing.status === 'COMPLETED') {
      return { chunksCreated: existing.totalChunks, tokensUsed: 0 }
    }

    // Deletar chunks antigos do Qdrant e Postgres
    await deleteByFilter(config.collectionName, { document_id: existing.id })
    await prisma.aIKnowledgeChunk.deleteMany({ where: { documentId: existing.id } })

    documentId = existing.id
    await prisma.aIKnowledgeDocument.update({
      where: { id: documentId },
      data: {
        title: doc.title,
        contentHash: doc.contentHash,
        rawContent: doc.content,
        cleanContent: doc.content,
        wordCount: doc.content.split(/\s+/).filter(Boolean).length,
        tokenCount: estimateTokens(doc.content),
        canonicalUrl: doc.canonicalUrl || existing.canonicalUrl,
        language: doc.language || existing.language,
        publishedAt: doc.publishedAt,
        crawlVersion: { increment: 1 },
        status: 'PROCESSING',
        enabled: true,
        metadata: (doc.metadata || {}) as any,
      },
    })
  } else {
    const created = await prisma.aIKnowledgeDocument.create({
      data: {
        companyId: config.companyId,
        knowledgeBaseId: config.knowledgeBaseId,
        sourceId: config.sourceId,
        title: doc.title,
        sourceUrl: doc.sourceUrl || `internal:${doc.contentHash}`,
        canonicalUrl: doc.canonicalUrl,
        contentHash: doc.contentHash,
        rawContent: doc.content,
        cleanContent: doc.content,
        wordCount: doc.content.split(/\s+/).filter(Boolean).length,
        tokenCount: estimateTokens(doc.content),
        language: doc.language,
        publishedAt: doc.publishedAt,
        status: 'PROCESSING',
        enabled: true,
        qdrantCollectionName: config.collectionName,
        metadata: (doc.metadata || {}) as any,
      },
    })
    documentId = created.id
  }

  // 2. Chunk o conteúdo
  // Para YouTube, usar chunking baseado em timestamps
  const youtubeResult = doc.metadata?._youtubeResult as TranscriptResult | undefined
  let chunks: Array<{ content: string; index: number; tokenCount: number; sectionTitle?: string; pageNumber?: number; elementType?: string; metadata?: Record<string, unknown> }>

  if (youtubeResult && youtubeResult.segments && youtubeResult.segments.length > 0) {
    // YouTube: chunks com timestamps preservados
    const ytChunks = createYouTubeChunks(youtubeResult, config.chunkSize)
    chunks = ytChunks.map((c, i) => ({
      content: c.content,
      index: i,
      tokenCount: Math.ceil(c.content.length / 4),
      metadata: {
        startTime: c.startTime,
        endTime: c.endTime,
        startFormatted: c.startFormatted,
        endFormatted: c.endFormatted,
        youtubeUrl: c.youtubeUrl,
        videoId: c.videoId,
        videoTitle: c.videoTitle,
        channelName: c.channelName,
        sourceType: 'YOUTUBE',
      },
    }))
    console.log(`[Ingestion] YouTube: ${ytChunks.length} chunks com timestamps`)
  } else if (doc.elements && doc.elements.length > 0) {
    // Documentos com elementos tipados: heading-aware chunking (Unstructured pattern)
    const structuredChunks = splitElements(doc.elements, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      combineUnderNChars: Math.floor(config.chunkSize * 0.2), // 20% do chunkSize
    })
    chunks = structuredChunks.map(c => ({
      content: c.content,
      index: c.index,
      tokenCount: c.tokenCount,
      sectionTitle: c.sectionTitle,
      pageNumber: c.pageNumber,
      elementType: c.elementType,
    }))
    console.log(`[Ingestion] Structural chunking: ${chunks.length} chunks (${doc.parsingMethod || 'unknown'} parser)`)
  } else {
    // Fallback padrão: recursive character splitter
    chunks = splitText(doc.content, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
    })
  }

  if (chunks.length === 0) {
    await prisma.aIKnowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'COMPLETED', totalChunks: 0, indexedAt: new Date() },
    })
    return { chunksCreated: 0, tokensUsed: 0 }
  }

  // 3. Gerar embeddings em batch
  const chunkTexts = chunks.map((c) => c.content)
  const embeddings = await embedTexts(chunkTexts, config.embeddingConfig, config.embeddingConfig.model, config.companyId)

  // Log embedding cost for ingestion
  const embeddingTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
  logIngestionEmbeddingCost(config.companyId, config.embeddingConfig.model, embeddingTokens).catch(() => {})

  // 4. Salvar chunks no Postgres e montar pontos para Qdrant
  const qdrantPoints: Array<{
    id: string
    vector: number[]
    payload: Record<string, unknown>
  }> = []

  // Buscar nome da source e KB para payload
  const [source, kb] = await Promise.all([
    prisma.aIKnowledgeSource.findUnique({ where: { id: config.sourceId }, select: { name: true, type: true } }),
    prisma.aIKnowledgeBase.findUnique({ where: { id: config.knowledgeBaseId }, select: { name: true } }),
  ])

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = crypto.randomUUID()
    const chunk = chunks[i]

    // Salvar no Postgres
    await prisma.aIKnowledgeChunk.create({
      data: {
        id: chunkId,
        documentId,
        content: chunk.content,
        chunkIndex: chunk.index,
        tokenCount: chunk.tokenCount,
        wordCount: chunk.content.split(/\s+/).filter(Boolean).length,
        enabled: true,
        qdrantPointId: chunkId,
        isIndexed: true,
        sectionTitle: chunk.sectionTitle || null,
        pageNumber: chunk.pageNumber || null,
        elementType: chunk.elementType || null,
        metadata: {
          ...(chunk.metadata || {}),
          sourceType: source?.type,
          documentTitle: doc.title,
        } as any,
      },
    })

    // Preparar ponto para Qdrant (payload rico como Dify)
    // YouTube: inclui timestamps e URL com referência temporal
    const chunkMeta = chunk.metadata || {}
    qdrantPoints.push({
      id: chunkId,
      vector: embeddings[i],
      payload: {
        content: chunk.content,
        company_id: config.companyId,
        knowledge_base_id: config.knowledgeBaseId,
        knowledge_base_name: kb?.name || '',
        source_id: config.sourceId,
        source_name: source?.name || '',
        source_type: source?.type || 'TEXT',
        document_id: documentId,
        document_title: doc.title,
        source_url: doc.sourceUrl || '',
        chunk_index: chunk.index,
        token_count: chunk.tokenCount,
        is_active: true,
        created_at: new Date().toISOString(),
        // Structured document metadata (seção, página, tipo)
        ...(chunk.sectionTitle ? { section_title: chunk.sectionTitle } : {}),
        ...(chunk.pageNumber ? { page_number: chunk.pageNumber } : {}),
        ...(chunk.elementType ? { element_type: chunk.elementType } : {}),
        // YouTube-specific metadata (para citação com timestamp)
        ...(chunkMeta.startTime !== undefined ? {
          start_time: chunkMeta.startTime,
          end_time: chunkMeta.endTime,
          start_formatted: chunkMeta.startFormatted,
          end_formatted: chunkMeta.endFormatted,
          youtube_url: chunkMeta.youtubeUrl,
          video_id: chunkMeta.videoId,
          channel_name: chunkMeta.channelName,
        } : {}),
      },
    })
  }

  // 5. Upsert no Qdrant
  await upsertChunks(config.collectionName, qdrantPoints)

  // 6. Atualizar documento
  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
  await prisma.aIKnowledgeDocument.update({
    where: { id: documentId },
    data: {
      status: 'COMPLETED',
      totalChunks: chunks.length,
      indexedAt: new Date(),
      ...(doc.pageCount ? { pageCount: doc.pageCount } : {}),
      ...(doc.parsingMethod ? { parsingMethod: doc.parsingMethod } : {}),
      ...(doc.fileSize ? { fileSize: doc.fileSize } : {}),
    },
  })

  return { chunksCreated: chunks.length, tokensUsed: totalTokens }
}

// ============================================
// DELETE SOURCE — Remove vetores e dados
// ============================================

export async function deleteSourceData(sourceId: string): Promise<void> {
  const source = await prisma.aIKnowledgeSource.findUnique({
    where: { id: sourceId },
    include: { documents: true },
  })

  if (!source) return

  const collectionName = getCollectionName(source.companyId)

  // Deletar chunks do Qdrant por source_id
  try {
    await deleteByFilter(collectionName, { source_id: sourceId })
  } catch {
    console.warn(`[Ingestion] Falha ao deletar vetores da source ${sourceId}`)
  }

  // Deletar chunks, documents e source do Postgres (cascade)
  for (const doc of source.documents) {
    await prisma.aIKnowledgeChunk.deleteMany({ where: { documentId: doc.id } })
  }
  await prisma.aIKnowledgeDocument.deleteMany({ where: { sourceId } })
}

// ============================================
// Helper
// ============================================

async function updateJob(jobId: string, data: Record<string, any>): Promise<void> {
  try {
    await prisma.aIIngestionJob.update({ where: { id: jobId }, data })
  } catch {
    // Job pode não existir mais
  }
}
