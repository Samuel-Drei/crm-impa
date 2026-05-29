/**
 * Knowledge Base Routes — CRUD de Sources + Ingestion
 * Endpoints para gerenciar bases de conhecimento com RAG
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '../../../config/database.js'
import { processSource, deleteSourceData, checkQdrantHealth } from '../rag/index.js'
import { enqueueIngestion } from '../../../queues/ingestion.queue.js'
import { decryptSafe } from '../../../config/encryption.js'
import { listEmbeddingProviders, getEmbeddingDimension, estimateTokens } from './embedding.service.js'
import { calculateCost } from '../cost-calculator.js'
import { requirePermission } from '../../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../../middlewares/plan-limit.middleware.js'

// ============================================
// Schemas de validação
// ============================================

const sourceCreateSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  type: z.enum(['TEXT', 'URL', 'WEBSITE', 'YOUTUBE', 'FILE', 'QA']),
  name: z.string().min(1),
  textContent: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  crawlConfig: z.object({
    maxPages: z.number().min(1).max(500).optional(),
    maxDepth: z.number().min(1).max(10).optional(),
    includePatterns: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
    respectRobots: z.boolean().optional(),
  }).optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileMimeType: z.string().optional(),
  fileSize: z.number().optional(),
  qaItems: z.array(z.object({
    id: z.string().optional(),
    question: z.string().min(1),
    answer: z.string().min(1),
    active: z.boolean().optional(),
    order: z.number().optional(),
  })).optional(),
})

const qaPairSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  active: z.boolean().optional(),
  order: z.number().optional(),
})

const qaPairUpdateSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  active: z.boolean().optional(),
  order: z.number().optional(),
})

const kbUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  embeddingProviderId: z.string().uuid().optional().nullable(),
  embeddingProvider: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingApiKey: z.string().optional().nullable(),
  embeddingBaseUrl: z.string().optional().nullable(),
  chunkSize: z.number().min(100).max(4000).optional(),
  chunkOverlap: z.number().min(0).max(500).optional(),
  retrievalMode: z.enum(['semantic', 'keyword', 'hybrid']).optional(),
  topK: z.number().min(1).max(20).optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
})

// ============================================
// Helper: Log embedding cost to AITokenReport
// ============================================

async function logEmbeddingCost(companyId: string, model: string, tokensUsed: number) {
  try {
    // Embedding pricing (per 1M tokens)
    const EMBEDDING_PRICING: Record<string, number> = {
      'text-embedding-3-small': 0.02,
      'text-embedding-3-large': 0.13,
      'text-embedding-ada-002': 0.10,
      'text-embedding-004': 0,
      'embedding-001': 0,
      'embed-multilingual-v3.0': 0.10,
      'embed-english-v3.0': 0.10,
      'embed-multilingual-light-v3.0': 0.10,
      'voyage-3': 0.06,
      'voyage-3-lite': 0.02,
      'voyage-multilingual-2': 0.12,
    }
    const pricePerMTokens = EMBEDDING_PRICING[model] || 0.02
    const costUsd = (tokensUsed / 1_000_000) * pricePerMTokens

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    await prisma.aITokenReport.upsert({
      where: {
        companyId_agentId_instanceId_date: {
          companyId,
          agentId: '__embedding__',
          instanceId: '__rag__',
          date: today,
        },
      },
      create: {
        companyId,
        agentId: '__embedding__',
        instanceId: '__rag__',
        date: today,
        messagesCount: 1,
        sessionsCount: 0,
        promptTokens: tokensUsed,
        completionTokens: 0,
        totalTokens: tokensUsed,
        costUsd,
        modelBreakdown: [{ model, tokens: tokensUsed, cost: costUsd, type: 'embedding' }],
      },
      update: {
        messagesCount: { increment: 1 },
        promptTokens: { increment: tokensUsed },
        totalTokens: { increment: tokensUsed },
        costUsd: { increment: costUsd },
      },
    })
  } catch (e) {
    console.error('[RAG] Error logging embedding cost:', e)
  }
}

// ============================================
// Registrar rotas
// ============================================

export async function registerKnowledgeRoutes(app: FastifyInstance) {
  // === Catálogo de Embedding Providers ===

  // Lista todos os providers e modelos disponíveis (para o frontend)
  app.get('/embedding-providers', { preHandler: [requirePermission('ai_knowledge:read')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(listEmbeddingProviders())
  })

  // === Knowledge Base CRUD ===

  // Listar KBs com stats
  app.get('/knowledge-bases', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const kbs = await prisma.aIKnowledgeBase.findMany({
      // Oculta KB interna do Daily Brain — gerenciada exclusivamente pela página /ai-daily-brain.
      where: { companyId, name: { not: '__daily_brain__' } },
      include: {
        sources: {
          select: { id: true, type: true, name: true, status: true, totalChunks: true },
        },
        agents: {
          include: { agent: { select: { id: true, name: true } } },
        },
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(kbs)
  })

  // Obter KB + todos os documentos + sources
  app.get('/knowledge-bases/:id', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const kb = await prisma.aIKnowledgeBase.findFirst({
      where: { id, companyId },
      include: {
        sources: {
          include: {
            documents: {
              select: {
                id: true, title: true, sourceUrl: true, status: true,
                totalChunks: true, tokenCount: true, wordCount: true,
                indexedAt: true, errorMessage: true,
                pageCount: true, parsingMethod: true, fileSize: true,
              },
              orderBy: { createdAt: 'desc' },
            },
            jobs: {
              select: {
                id: true, type: true, status: true, progress: true,
                currentStep: true, errorMessage: true, documentsFound: true,
                documentsProcessed: true, chunksCreated: true, tokensUsed: true,
                startedAt: true, completedAt: true, createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        agents: {
          include: { agent: { select: { id: true, name: true } } },
        },
      },
    })
    if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' })
    return reply.send(kb)
  })

  // Criar KB
  app.post('/knowledge-bases', { preHandler: [requirePermission('ai_knowledge:manage'), enforcePlanLimit('maxKnowledgeBases')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const data = z.object({ name: z.string().min(1), description: z.string().optional() }).parse(request.body)
    const kb = await prisma.aIKnowledgeBase.create({
      data: {
        companyId,
        name: data.name,
        description: data.description,
      },
    })
    return reply.status(201).send(kb)
  })

  // Atualizar KB config
  app.put('/knowledge-bases/:id', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const data = kbUpdateSchema.parse(request.body)

    // Verificar que pertence à empresa
    const existing = await prisma.aIKnowledgeBase.findFirst({ where: { id, companyId } })
    if (!existing) return reply.status(404).send({ error: 'Knowledge base not found' })
    if (existing.name === '__daily_brain__') {
      return reply.status(403).send({ error: 'Base do Cérebro Diário é gerenciada automaticamente. Edite via /ai-daily-brain.' })
    }

    // Auto-calcular dimensão quando provider/modelo muda
    const updateData: Record<string, unknown> = { ...data }
    if (data.embeddingModel || data.embeddingProvider) {
      const model = data.embeddingModel || existing.embeddingModel
      const provider = data.embeddingProvider || existing.embeddingProvider
      updateData.embeddingDimension = getEmbeddingDimension(model, provider)
    }

    const kb = await prisma.aIKnowledgeBase.update({
      where: { id },
      data: updateData,
    })
    return reply.send(kb)
  })

  // Deletar KB (e todos os vetores)
  app.delete('/knowledge-bases/:id', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }

    const existing = await prisma.aIKnowledgeBase.findFirst({ where: { id, companyId } })
    if (!existing) return reply.status(404).send({ error: 'Knowledge base not found' })
    if (existing.name === '__daily_brain__') {
      return reply.status(403).send({ error: 'Base do Cérebro Diário não pode ser deletada. Para limpar, desative o Daily Brain.' })
    }

    // Deletar vetores do Qdrant para cada source
    const sources = await prisma.aIKnowledgeSource.findMany({ where: { knowledgeBaseId: id } })
    for (const source of sources) {
      await deleteSourceData(source.id).catch(() => {})
    }

    // Cascade delete no Postgres
    await prisma.aIKnowledgeBase.deleteMany({ where: { id, companyId } })
    return reply.send({ success: true })
  })

  // === Source CRUD + Ingestion ===

  // Upload de arquivo para criar uma source FILE (multipart/form-data)
  // Retorna { fileUrl, fileName, fileMimeType, fileSize } para o cliente passar a POST /knowledge-sources
  app.post('/knowledge-sources/upload', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId

    if (!(request as any).isMultipart || !(request as any).isMultipart()) {
      return reply.status(400).send({ error: 'Envio deve ser multipart/form-data' })
    }

    // Whitelist de extensões e MIME types permitidos para indexação RAG
    const ALLOWED_EXT = /\.(pdf|txt|md|markdown|html?|json)$/i
    const ALLOWED_MIME = new Set([
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'text/html',
      'application/json',
      'application/octet-stream', // alguns clientes enviam genérico — validamos pela extensão
    ])
    const BLOCKED_EXT = /\.(exe|bat|cmd|ps1|sh|dll|msi|swf|php|aspx?|jsx?|tsx?|svg|htaccess)$/i

    let fileBuffer: Buffer | null = null
    let originalName = 'file'
    let mimeType = 'application/octet-stream'

    try {
      const file = await (request as any).file()
      if (!file) return reply.status(400).send({ error: 'Arquivo ausente' })
      originalName = file.filename || 'file'
      mimeType = file.mimetype || 'application/octet-stream'
      fileBuffer = await file.toBuffer()
    } catch (err: any) {
      // @fastify/multipart lança código 'FST_REQ_FILE_TOO_LARGE' quando excede o limite
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({ error: 'Arquivo excede o limite de 50MB' })
      }
      return reply.status(400).send({ error: 'Falha ao processar upload: ' + err.message })
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.status(400).send({ error: 'Arquivo vazio' })
    }

    // Sanitização e validação de extensão
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
    if (BLOCKED_EXT.test(safeName)) {
      return reply.status(400).send({ error: 'Tipo de arquivo não permitido' })
    }
    if (!ALLOWED_EXT.test(safeName)) {
      return reply.status(400).send({ error: 'Apenas arquivos PDF, TXT, MD, HTML ou JSON são suportados' })
    }
    if (mimeType !== 'application/octet-stream' && !ALLOWED_MIME.has(mimeType)) {
      return reply.status(400).send({ error: `MIME type não permitido: ${mimeType}` })
    }

    // Persistir em uploads/<companyId>/knowledge/<uuid>-<safeName>
    // Caminho compatível com a proteção JWT por tenant em /uploads/<companyId>/...
    const { writeFile, mkdir } = await import('fs/promises')
    const { join } = await import('path')
    const { randomUUID } = await import('crypto')

    const savedName = `${randomUUID()}-${safeName}`
    const targetDir = join(process.cwd(), 'uploads', companyId, 'knowledge')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(targetDir, savedName), fileBuffer)

    // fileUrl é caminho relativo — extractFile fará path.join('/app', fileUrl)
    const fileUrl = `uploads/${companyId}/knowledge/${savedName}`

    return reply.status(201).send({
      fileUrl,
      fileName: originalName,
      fileMimeType: mimeType,
      fileSize: fileBuffer.length,
    })
  })

  // Adicionar source a uma KB
  app.post('/knowledge-sources', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const data = sourceCreateSchema.parse(request.body)

    // Verificar que a KB pertence à empresa
    const kb = await prisma.aIKnowledgeBase.findFirst({
      where: { id: data.knowledgeBaseId, companyId },
    })
    if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' })

    // Criar source
    const source = await prisma.aIKnowledgeSource.create({
      data: {
        companyId,
        knowledgeBaseId: data.knowledgeBaseId,
        type: data.type,
        name: data.name,
        textContent: data.textContent,
        sourceUrl: data.sourceUrl,
        crawlConfig: data.crawlConfig || undefined,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileMimeType: data.fileMimeType,
        fileSize: data.fileSize,
        qaItems: data.qaItems
          ? data.qaItems.map((it, idx) => ({
              id: it.id || randomUUID(),
              question: it.question,
              answer: it.answer,
              active: it.active !== false,
              order: typeof it.order === 'number' ? it.order : idx,
            }))
          : undefined,
        status: 'QUEUED',
      },
    })

    // Criar job de indexação
    const job = await prisma.aIIngestionJob.create({
      data: {
        companyId,
        sourceId: source.id,
        type: 'INDEX_SOURCE',
        status: 'QUEUED',
      },
    })

    // Processar via Bull queue (robusto: retry, persistência, concorrência)
    await enqueueIngestion({
      sourceId: source.id,
      jobId: job.id,
      companyId,
      type: 'INDEX_SOURCE',
    })

    return reply.status(201).send({ source, jobId: job.id })
  })

  // Obter source com documentos e chunks
  app.get('/knowledge-sources/:id', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
      include: {
        documents: {
          include: {
            chunks: {
              select: { id: true, content: true, chunkIndex: true, tokenCount: true, isIndexed: true },
              orderBy: { chunkIndex: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })
    if (!source) return reply.status(404).send({ error: 'Source not found' })
    return reply.send(source)
  })

  // Editar source (nome e, para TEXT, conteúdo). Dispara reindex automaticamente se conteúdo mudar.
  app.put('/knowledge-sources/:id', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const data = z.object({
      name: z.string().min(1).optional(),
      textContent: z.string().optional(),
    }).parse(request.body)

    const source = await prisma.aIKnowledgeSource.findFirst({ where: { id, companyId } })
    if (!source) return reply.status(404).send({ error: 'Source not found' })

    // textContent só pode ser editado em sources do tipo TEXT
    const willChangeContent = data.textContent !== undefined && source.type === 'TEXT' && data.textContent !== source.textContent
    if (data.textContent !== undefined && source.type !== 'TEXT') {
      return reply.status(400).send({ error: 'Apenas fontes do tipo TEXT podem ter o conteúdo editado' })
    }

    const updated = await prisma.aIKnowledgeSource.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(willChangeContent ? { textContent: data.textContent, status: 'QUEUED' as const } : {}),
      },
    })

    // Se o conteúdo mudou, limpar dados antigos (chunks + vetores) e enfileirar reindex
    let jobId: string | undefined
    if (willChangeContent) {
      await deleteSourceData(id)
      const job = await prisma.aIIngestionJob.create({
        data: { companyId, sourceId: id, type: 'REINDEX_SOURCE', status: 'QUEUED' },
      })
      await enqueueIngestion({ sourceId: id, jobId: job.id, companyId, type: 'REINDEX_SOURCE' })
      jobId = job.id
    }

    return reply.send({ source: updated, jobId })
  })

  // Reindexar source
  app.post('/knowledge-sources/:id/reindex', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }

    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
    })
    if (!source) return reply.status(404).send({ error: 'Source not found' })

    // Criar job de reindex
    const job = await prisma.aIIngestionJob.create({
      data: {
        companyId,
        sourceId: source.id,
        type: 'REINDEX_SOURCE',
        status: 'QUEUED',
      },
    })

    // Processar via Bull queue (retry automático, persistência)
    await enqueueIngestion({
      sourceId: source.id,
      jobId: job.id,
      companyId,
      type: 'REINDEX_SOURCE',
    })

    return reply.send({ jobId: job.id })
  })

  // Deletar source
  app.delete('/knowledge-sources/:id', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }

    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
    })
    if (!source) return reply.status(404).send({ error: 'Source not found' })

    await deleteSourceData(id)
    await prisma.aIKnowledgeSource.deleteMany({ where: { id, companyId } })

    return reply.send({ success: true })
  })

  // === Q&A Pairs CRUD (apenas para sources do tipo QA) ===

  // Helper interno: re-enfileira indexação após mudança nos pares
  const reindexQASource = async (sourceId: string, companyId: string) => {
    const job = await prisma.aIIngestionJob.create({
      data: { companyId, sourceId, type: 'REINDEX_SOURCE', status: 'QUEUED' },
    })
    await enqueueIngestion({ sourceId, jobId: job.id, companyId, type: 'REINDEX_SOURCE' })
    return job.id
  }

  // Adicionar par Q&A
  app.post('/knowledge-sources/:id/qa-pairs', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const data = qaPairSchema.parse(request.body)

    const source = await prisma.aIKnowledgeSource.findFirst({ where: { id, companyId } })
    if (!source) return reply.status(404).send({ error: 'Source not found' })
    if (source.type !== 'QA') return reply.status(400).send({ error: 'Source não é do tipo QA' })

    const items = Array.isArray(source.qaItems) ? (source.qaItems as any[]) : []
    const newItem = {
      id: randomUUID(),
      question: data.question,
      answer: data.answer,
      active: data.active !== false,
      order: typeof data.order === 'number' ? data.order : items.length,
    }
    const updated = [...items, newItem]

    await prisma.aIKnowledgeSource.update({
      where: { id },
      data: { qaItems: updated, status: 'QUEUED' },
    })
    const jobId = await reindexQASource(id, companyId)
    return reply.status(201).send({ pair: newItem, jobId })
  })

  // Atualizar par Q&A
  app.put('/knowledge-sources/:id/qa-pairs/:pairId', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id, pairId } = request.params as { id: string; pairId: string }
    const data = qaPairUpdateSchema.parse(request.body)

    const source = await prisma.aIKnowledgeSource.findFirst({ where: { id, companyId } })
    if (!source) return reply.status(404).send({ error: 'Source not found' })
    if (source.type !== 'QA') return reply.status(400).send({ error: 'Source não é do tipo QA' })

    const items = Array.isArray(source.qaItems) ? (source.qaItems as any[]) : []
    const idx = items.findIndex(it => it.id === pairId)
    if (idx === -1) return reply.status(404).send({ error: 'Par Q&A não encontrado' })

    const updated = [...items]
    updated[idx] = {
      ...updated[idx],
      ...(data.question !== undefined ? { question: data.question } : {}),
      ...(data.answer !== undefined ? { answer: data.answer } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    }

    await prisma.aIKnowledgeSource.update({
      where: { id },
      data: { qaItems: updated, status: 'QUEUED' },
    })
    const jobId = await reindexQASource(id, companyId)
    return reply.send({ pair: updated[idx], jobId })
  })

  // Deletar par Q&A
  app.delete('/knowledge-sources/:id/qa-pairs/:pairId', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id, pairId } = request.params as { id: string; pairId: string }

    const source = await prisma.aIKnowledgeSource.findFirst({ where: { id, companyId } })
    if (!source) return reply.status(404).send({ error: 'Source not found' })
    if (source.type !== 'QA') return reply.status(400).send({ error: 'Source não é do tipo QA' })

    const items = Array.isArray(source.qaItems) ? (source.qaItems as any[]) : []
    const updated = items.filter(it => it.id !== pairId)
    if (updated.length === items.length) return reply.status(404).send({ error: 'Par Q&A não encontrado' })

    await prisma.aIKnowledgeSource.update({
      where: { id },
      data: { qaItems: updated, status: 'QUEUED' },
    })
    const jobId = await reindexQASource(id, companyId)
    return reply.send({ success: true, jobId })
  })

  // === Ingestion Jobs ===

  // Listar jobs de ingestão
  app.get('/ingestion-jobs', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { sourceId, status } = request.query as { sourceId?: string; status?: string }

    const where: any = { companyId }
    if (sourceId) where.sourceId = sourceId
    if (status) where.status = status

    const jobs = await prisma.aIIngestionJob.findMany({
      where,
      include: {
        source: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return reply.send(jobs)
  })

  // Obter job detalhado
  app.get('/ingestion-jobs/:id', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const job = await prisma.aIIngestionJob.findFirst({
      where: { id, companyId },
      include: {
        source: {
          include: {
            documents: {
              select: { id: true, title: true, status: true, totalChunks: true },
            },
          },
        },
      },
    })
    if (!job) return reply.status(404).send({ error: 'Job not found' })
    return reply.send(job)
  })

  // === RAG health check ===

  app.get('/rag/health', { preHandler: [requirePermission('ai_knowledge:read')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const qdrantHealthy = await checkQdrantHealth()
    return reply.send({
      qdrant: qdrantHealthy ? 'connected' : 'disconnected',
      status: qdrantHealthy ? 'healthy' : 'degraded',
    })
  })

  // === RAG Search test (debug) ===

  app.post('/rag/search', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { query, knowledgeBaseIds, topK, scoreThreshold } = request.body as any

    const { embedQuery } = await import('../rag/embedding.service.js')
    const { searchSimilar, getCollectionName } = await import('../rag/qdrant.client.js')

    // Resolver embedding config: pega da primeira KB solicitada, ou busca provider da empresa
    let embeddingConfig: import('../rag/embedding.service.js').EmbeddingConfig | null = null

    if (knowledgeBaseIds?.length) {
      const kb = await prisma.aIKnowledgeBase.findFirst({
        where: { id: { in: knowledgeBaseIds }, companyId },
        select: { embeddingProviderId: true, embeddingProvider: true, embeddingModel: true, embeddingApiKey: true, embeddingBaseUrl: true },
      })

      // 1. Provider vinculado
      if (kb?.embeddingProviderId) {
        const linkedProvider = await prisma.aIProvider.findUnique({ where: { id: kb.embeddingProviderId } })
        if (linkedProvider?.apiKey) {
          const { buildEmbeddingConfigFromAIProvider } = await import('../rag/embedding.service.js')
          if (linkedProvider.type === 'GITHUB_COPILOT') {
            const { getProviderWithFreshToken } = await import('../ai.service.js')
            const fresh = await getProviderWithFreshToken(linkedProvider.id, companyId)
            if (fresh) {
              embeddingConfig = buildEmbeddingConfigFromAIProvider({
                type: fresh.type,
                apiKey: fresh.apiKey,
                baseUrl: fresh.baseUrl,
                oauthData: fresh.oauthData,
              }, kb.embeddingModel, kb.embeddingBaseUrl)
            }
          } else {
            embeddingConfig = buildEmbeddingConfigFromAIProvider({
              type: linkedProvider.type,
              apiKey: decryptSafe(linkedProvider.apiKey) as string,
              baseUrl: linkedProvider.baseUrl,
            }, kb.embeddingModel, kb.embeddingBaseUrl)
          }
        }
      }

      // 2. Legacy: API key da própria KB
      if (!embeddingConfig && kb?.embeddingApiKey) {
        embeddingConfig = {
          provider: kb.embeddingProvider || 'openai',
          model: kb.embeddingModel,
          apiKey: decryptSafe(kb.embeddingApiKey) as string,
          baseUrl: kb.embeddingBaseUrl,
        }
      }
    }

    // Fallback: provider da empresa → env
    if (!embeddingConfig) {
      const provider = await prisma.aIProvider.findFirst({
        where: { companyId, type: 'OPENAI', isActive: true },
      })
      const apiKey = provider?.apiKey || process.env.OPENAI_API_KEY
      if (!apiKey) return reply.status(400).send({ error: 'Nenhuma API key configurada para embeddings' })
      embeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey }
    }

    // Query expansion para queries curtas (melhora score)
    const words = query.trim().split(/\s+/)
    let expandedQuery = query
    if (words.length === 1) {
      expandedQuery = `O que é ${query}? Informações sobre ${query}. ${query}`
    } else if (words.length <= 3) {
      expandedQuery = `${query}. Informações sobre ${query}`
    }

    const queryVector = await embedQuery(expandedQuery, embeddingConfig, embeddingConfig.model, companyId)
    const collectionName = getCollectionName(companyId)

    // Log embedding cost
    const queryTokens = estimateTokens(expandedQuery)
    logEmbeddingCost(companyId, embeddingConfig.model, queryTokens).catch(() => {})

    // Threshold adaptativo: queries curtas naturalmente produzem scores mais baixos
    const defaultThreshold = words.length <= 2 ? 0.25 : 0.35

    const results = await searchSimilar(collectionName, queryVector, {
      companyId,
      knowledgeBaseIds,
      topK: topK || 5,
      scoreThreshold: scoreThreshold || defaultThreshold,
    })

    return reply.send({ results, total: results.length })
  })

  // === Document enable/disable (padrão Dify) ===

  app.patch('/knowledge-documents/:id/toggle', async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { enabled } = request.body as { enabled: boolean }

    const doc = await prisma.aIKnowledgeDocument.findFirst({ where: { id, companyId } })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    await prisma.aIKnowledgeDocument.update({
      where: { id },
      data: { enabled },
    })

    // Atualizar is_active no Qdrant para todos os chunks do documento
    try {
      const { getQdrantClient, getCollectionName } = await import('../rag/qdrant.client.js')
      const qClient = getQdrantClient()
      const collectionName = getCollectionName(companyId)

      await qClient.setPayload(collectionName, {
        payload: { is_active: enabled },
        filter: {
          must: [{ key: 'document_id', match: { value: id } }],
        },
      })
    } catch (error) {
      console.warn('[KB] Erro ao atualizar Qdrant payload:', (error as Error).message)
    }

    return reply.send({ success: true, enabled })
  })

  // === Chunk enable/disable (padrão Dify segment) ===

  app.patch('/knowledge-chunks/:id/toggle', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const { enabled } = request.body as { enabled: boolean }

    const chunk = await prisma.aIKnowledgeChunk.findUnique({
      where: { id },
      include: { document: { select: { companyId: true } } },
    })
    if (!chunk || chunk.document.companyId !== request.user.companyId) {
      return reply.status(404).send({ error: 'Chunk not found' })
    }

    await prisma.aIKnowledgeChunk.update({
      where: { id },
      data: { enabled },
    })

    // Atualizar is_active no Qdrant para este chunk
    if (chunk.qdrantPointId) {
      try {
        const { getQdrantClient, getCollectionName } = await import('../rag/qdrant.client.js')
        const qClient = getQdrantClient()
        const collectionName = getCollectionName(chunk.document.companyId)

        await qClient.setPayload(collectionName, {
          payload: { is_active: enabled },
          points: [chunk.qdrantPointId],
        })
      } catch (error) {
        console.warn('[KB] Erro ao atualizar Qdrant payload:', (error as Error).message)
      }
    }

    return reply.send({ success: true, enabled })
  })

  // === Chunk preview (debug: ver conteúdo extraído antes de indexar) ===

  app.get('/knowledge-documents/:id/chunks', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }

    const doc = await prisma.aIKnowledgeDocument.findFirst({
      where: { id, companyId },
      select: { id: true, title: true, sourceUrl: true, language: true, crawlVersion: true },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    const chunks = await prisma.aIKnowledgeChunk.findMany({
      where: { documentId: id },
      select: {
        id: true,
        content: true,
        chunkIndex: true,
        tokenCount: true,
        wordCount: true,
        hitCount: true,
        enabled: true,
        isIndexed: true,
      },
      orderBy: { chunkIndex: 'asc' },
    })

    return reply.send({ document: doc, chunks, total: chunks.length })
  })

  // ============================================
  // EXPORTAÇÃO MARKDOWN
  // Permite visualizar/baixar o conteúdo extraído de cada documento ou da
  // source completa, no formato markdown — útil para auditar o que foi
  // realmente indexado a partir de um PDF, site, áudio, etc.
  // ============================================

  function safeFileName(input: string, fallback = 'documento') {
    const cleaned = (input || fallback)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s\-.]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80)
    return cleaned || fallback
  }

  function buildDocumentMarkdown(doc: {
    title: string | null
    sourceUrl: string | null
    language: string | null
    crawlVersion: number
    pageCount: number | null
    parsingMethod: string | null
    wordCount: number
    tokenCount: number
    cleanContent: string | null
    rawContent: string | null
    metadata: any
  }, chunks: { content: string; chunkIndex: number }[]): string {
    const lines: string[] = []
    lines.push(`# ${doc.title || 'Documento'}`)
    lines.push('')
    if (doc.sourceUrl) lines.push(`> Fonte: <${doc.sourceUrl}>`)
    const meta: string[] = []
    if (doc.language) meta.push(`idioma: ${doc.language}`)
    if (doc.parsingMethod) meta.push(`parser: ${doc.parsingMethod}`)
    if (doc.pageCount) meta.push(`páginas: ${doc.pageCount}`)
    if (doc.wordCount) meta.push(`palavras: ${doc.wordCount.toLocaleString('pt-BR')}`)
    if (doc.tokenCount) meta.push(`tokens: ${doc.tokenCount.toLocaleString('pt-BR')}`)
    if (doc.crawlVersion) meta.push(`versão: ${doc.crawlVersion}`)
    if (meta.length) lines.push(`> ${meta.join(' · ')}`)
    lines.push('')
    lines.push('---')
    lines.push('')

    const body = (doc.cleanContent && doc.cleanContent.trim())
      ? doc.cleanContent
      : (doc.rawContent && doc.rawContent.trim())
        ? doc.rawContent
        : chunks.map(c => c.content).join('\n\n')

    lines.push(body || '*(sem conteúdo extraído)*')
    return lines.join('\n')
  }

  // Markdown de UM documento
  app.get('/knowledge-documents/:id/markdown', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }

    const doc = await prisma.aIKnowledgeDocument.findFirst({
      where: { id, companyId },
      select: {
        title: true, sourceUrl: true, language: true, crawlVersion: true,
        pageCount: true, parsingMethod: true, wordCount: true, tokenCount: true,
        cleanContent: true, rawContent: true, metadata: true,
      },
    })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    const chunks = (!doc.cleanContent && !doc.rawContent)
      ? await prisma.aIKnowledgeChunk.findMany({
          where: { documentId: id },
          select: { content: true, chunkIndex: true },
          orderBy: { chunkIndex: 'asc' },
        })
      : []

    const markdown = buildDocumentMarkdown(doc, chunks)
    const fileName = `${safeFileName(doc.title || 'documento')}.md`

    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    if (download === '1' || download === 'true') {
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
    } else {
      reply.header('Content-Disposition', `inline; filename="${fileName}"`)
    }
    return reply.send(markdown)
  })

  // Markdown combinado de TODA a source (todos os documentos)
  app.get('/knowledge-sources/:id/markdown', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { download } = request.query as { download?: string }

    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, type: true, sourceUrl: true, fileName: true, totalDocuments: true, totalChunks: true, totalTokens: true },
    })
    if (!source) return reply.status(404).send({ error: 'Source not found' })

    const docs = await prisma.aIKnowledgeDocument.findMany({
      where: { sourceId: id, companyId },
      select: {
        id: true, title: true, sourceUrl: true, language: true, crawlVersion: true,
        pageCount: true, parsingMethod: true, wordCount: true, tokenCount: true,
        cleanContent: true, rawContent: true, metadata: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const docIdsNeedingChunks = docs.filter(d => !d.cleanContent && !d.rawContent).map(d => d.id)
    const chunkMap: Record<string, { content: string; chunkIndex: number }[]> = {}
    if (docIdsNeedingChunks.length) {
      const all = await prisma.aIKnowledgeChunk.findMany({
        where: { documentId: { in: docIdsNeedingChunks } },
        select: { documentId: true, content: true, chunkIndex: true },
        orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
      })
      for (const c of all) {
        ;(chunkMap[c.documentId] ||= []).push({ content: c.content, chunkIndex: c.chunkIndex })
      }
    }

    const header: string[] = []
    header.push(`# ${source.name}`)
    header.push('')
    header.push(`> Tipo: \`${source.type}\``)
    if (source.sourceUrl) header.push(`> URL: <${source.sourceUrl}>`)
    if (source.fileName) header.push(`> Arquivo: \`${source.fileName}\``)
    header.push(`> ${source.totalDocuments} documento(s) · ${source.totalChunks} chunk(s) · ${source.totalTokens.toLocaleString('pt-BR')} tokens`)
    header.push('')
    header.push('---')
    header.push('')

    const body = docs.map(d => buildDocumentMarkdown(d, chunkMap[d.id] || [])).join('\n\n---\n\n')
    const markdown = header.join('\n') + body

    const fileName = `${safeFileName(source.name)}.md`
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    if (download === '1' || download === 'true') {
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
    } else {
      reply.header('Content-Disposition', `inline; filename="${fileName}"`)
    }
    return reply.send(markdown)
  })

  // === Ingestion queue status ===

  // ============================================
  // ASR (Audio Speech Recognition) para YouTube sem legendas
  // ============================================

  // Estimar custo de transcrição ASR antes de confirmar
  app.post('/sources/:id/asr-estimate', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { provider } = request.body as { provider?: 'openai' | 'local' }

    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
    })
    if (!source) return reply.status(404).send({ error: 'Source não encontrada' })
    if (source.type !== 'YOUTUBE') return reply.status(400).send({ error: 'ASR só é suportado para fontes do YouTube' })

    const { estimateAsrCost, checkYtDlpAvailable, resolveAsrConfig } = await import('./asr.service.js')
    const { extractVideoId, fetchYouTubeTranscript } = await import('./youtube-transcript.js')

    // Verificar yt-dlp
    const ytdlpAvailable = await checkYtDlpAvailable()
    if (!ytdlpAvailable) {
      return reply.status(503).send({ error: 'yt-dlp não está disponível no servidor. Contate o administrador.' })
    }

    // Verificar se o provider está disponível
    const preferredProvider = provider || 'openai'
    const asrConfig = await resolveAsrConfig(companyId, preferredProvider)

    const videoId = extractVideoId(source.sourceUrl || '')
    if (!videoId) return reply.status(400).send({ error: 'URL do YouTube inválida' })

    // Pegar duração do vídeo (da metadata se já tiver, ou buscar)
    let duration = (source.metadata as any)?.duration as number | null
    let title = (source.metadata as any)?.title || source.name

    if (!duration) {
      // Buscar metadata do vídeo
      try {
        const result = await fetchYouTubeTranscript(source.sourceUrl!, { languages: ['pt', 'en'] })
        duration = result.duration
        title = result.title
      } catch {
        duration = null
      }
    }

    if (!duration) {
      return reply.status(400).send({ error: 'Não foi possível determinar a duração do vídeo' })
    }

    // Gerar estimativa de custo
    const estimate = estimateAsrCost(videoId, title, duration, preferredProvider)

    // Info sobre providers disponíveis
    const providers: { id: string; name: string; available: boolean; reason?: string }[] = []

    // OpenAI
    const openaiConfig = await resolveAsrConfig(companyId, 'openai')
    providers.push({
      id: 'openai',
      name: 'OpenAI Whisper (US$ 0.006/min)',
      available: !!openaiConfig,
      reason: !openaiConfig ? 'Nenhuma API key da OpenAI configurada' : undefined,
    })

    // Local — só mostra se WHISPER_ENDPOINT estiver configurado
    const localConfig = await resolveAsrConfig(companyId, 'local')
    if (localConfig) {
      providers.push({
        id: 'local',
        name: 'Whisper Local (Grátis)',
        available: true,
      })
    }

    return reply.send({ estimate, providers, ytdlpAvailable })
  })

  // Confirmar e iniciar transcrição ASR
  app.post('/sources/:id/asr-confirm', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { provider, acceptedCostUsd } = request.body as {
      provider: 'openai' | 'local'
      acceptedCostUsd: number
    }

    if (typeof acceptedCostUsd !== 'number') {
      return reply.status(400).send({ error: 'Valor aceito (acceptedCostUsd) é obrigatório' })
    }

    const source = await prisma.aIKnowledgeSource.findFirst({
      where: { id, companyId },
      include: { knowledgeBase: true },
    })
    if (!source) return reply.status(404).send({ error: 'Source não encontrada' })
    if (source.type !== 'YOUTUBE') return reply.status(400).send({ error: 'ASR só é suportado para YouTube' })

    const { resolveAsrConfig, transcribeYouTubeVideo, estimateAsrCost } = await import('./asr.service.js')
    const { extractVideoId, groupSnippetsIntoSegments } = await import('./youtube-transcript.js')

    const videoId = extractVideoId(source.sourceUrl || '')
    if (!videoId) return reply.status(400).send({ error: 'URL inválida' })

    // Verificar provider
    const asrConfig = await resolveAsrConfig(companyId, provider)
    if (!asrConfig) {
      return reply.status(400).send({ error: `Provider "${provider}" não configurado` })
    }

    // Verificar custo aceito (double-check para proteção do usuário)
    const duration = (source.metadata as any)?.duration as number
    if (duration && provider === 'openai') {
      const estimate = estimateAsrCost(videoId, source.name, duration, provider)
      if (Math.abs(estimate.estimatedCostUsd - acceptedCostUsd) > 0.01) {
        return reply.status(400).send({
          error: 'O valor aceito não confere com a estimativa atual',
          expected: estimate.estimatedCostUsd,
          received: acceptedCostUsd,
        })
      }
    }

    // Criar job de ASR
    const job = await prisma.aIIngestionJob.create({
      data: {
        companyId,
        sourceId: id,
        type: 'INDEX_SOURCE',
        status: 'PROCESSING',
        currentStep: 'asr_download',
        startedAt: new Date(),
      },
    })

    await prisma.aIKnowledgeSource.update({
      where: { id },
      data: { status: 'PROCESSING' },
    })

    // Responder imediatamente, processar em background
    reply.send({
      message: 'Transcrição iniciada',
      jobId: job.id,
      provider,
      estimatedCostUsd: acceptedCostUsd,
    })

    // Processar ASR em background
    setImmediate(async () => {
      try {
        // 1. Atualizar step
        await prisma.aIIngestionJob.update({
          where: { id: job.id },
          data: { currentStep: 'asr_download' },
        })

        // 2. Transcrever
        await prisma.aIIngestionJob.update({
          where: { id: job.id },
          data: { currentStep: 'asr_transcribing' },
        })

        const asrResult = await transcribeYouTubeVideo(videoId, asrConfig, companyId)

        // 3. Converter resultado ASR em formato compatível com o pipeline
        const segments = asrResult.segments.map(seg => ({
          text: seg.text,
          start: seg.start,
          duration: seg.end - seg.start,
        }))

        const groupedSegments = groupSnippetsIntoSegments(segments, 120)

        // 4. Atualizar metadata da source com resultado ASR
        await prisma.aIKnowledgeSource.update({
          where: { id },
          data: {
            metadata: {
              ...(typeof source.metadata === 'object' && source.metadata ? source.metadata : {}),
              needsAsrFallback: false,
              asrProvider: asrResult.provider,
              asrModel: asrResult.model,
              asrCostUsd: asrResult.costUsd,
              asrDurationSeconds: asrResult.durationSeconds,
              asrLanguage: asrResult.language,
              totalSnippets: segments.length,
              totalSegments: groupedSegments.length,
            },
          },
        })

        // 5. Agora re-processar a source com o transcript real via pipeline normal
        await prisma.aIIngestionJob.update({
          where: { id: job.id },
          data: { currentStep: 'indexing' },
        })

        // Salvar transcript na source para que o pipeline use
        await prisma.aIKnowledgeSource.update({
          where: { id },
          data: {
            textContent: asrResult.text, // Guardar transcript para reprocessamento futuro
          },
        })

        // Disparar pipeline normal de ingestão
        await enqueueIngestion({ sourceId: id, jobId: job.id, companyId, type: 'INDEX_SOURCE' })

      } catch (error) {
        const errorMsg = (error as Error).message
        console.error(`[ASR] Erro na transcrição da source ${id}:`, errorMsg)

        await prisma.aIKnowledgeSource.update({
          where: { id },
          data: { status: 'ERROR', errorMessage: `ASR falhou: ${errorMsg}` },
        })

        await prisma.aIIngestionJob.update({
          where: { id: job.id },
          data: {
            status: 'ERROR',
            errorMessage: errorMsg,
            currentStep: 'error',
            completedAt: new Date(),
          },
        })
      }
    })
  })

  // Verificar status do yt-dlp e providers ASR disponíveis
  app.get('/asr-status', { preHandler: [requirePermission('ai_knowledge:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { checkYtDlpAvailable, resolveAsrConfig } = await import('./asr.service.js')

    const ytdlpAvailable = await checkYtDlpAvailable()
    const openaiAvailable = !!(await resolveAsrConfig(companyId, 'openai'))

    const providers: Record<string, { available: boolean; pricePerMinute: number }> = {
      openai: { available: openaiAvailable, pricePerMinute: 0.006 },
    }

    // Só inclui Whisper local se estiver configurado no env
    const localEndpoint = process.env.WHISPER_LOCAL_URL || process.env.WHISPER_BASE_URL
    if (localEndpoint) {
      const localAvailable = !!(await resolveAsrConfig(companyId, 'local'))
      providers.local = { available: localAvailable, pricePerMinute: 0 }
    }

    return reply.send({ ytdlpAvailable, providers })
  })

  // === KB Chat — Teste de conversa diretamente com a base ===
  app.post('/knowledge-bases/:id/chat', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const { id } = request.params as { id: string }
    const { message, history, providerId: chatProviderId, model: chatModel } = request.body as {
      message: string
      history?: Array<{ role: string; content: string }>
      providerId?: string  // Provider específico para o chat
      model?: string       // Modelo específico para o chat
    }

    if (!message?.trim()) return reply.status(400).send({ error: 'Mensagem é obrigatória' })

    // 1. Buscar KB e validar
    const kb = await prisma.aIKnowledgeBase.findFirst({
      where: { id, companyId },
      select: {
        id: true, name: true, embeddingProviderId: true, embeddingProvider: true,
        embeddingModel: true, embeddingApiKey: true, embeddingBaseUrl: true,
        topK: true, scoreThreshold: true,
      },
    })
    if (!kb) return reply.status(404).send({ error: 'Base não encontrada' })

    // 2. Resolver embedding config
    const { embedQuery: embedFn } = await import('../rag/embedding.service.js')
    const { searchSimilar, getCollectionName } = await import('../rag/qdrant.client.js')

    let embeddingConfig: import('../rag/embedding.service.js').EmbeddingConfig | null = null

    if (kb.embeddingProviderId) {
      const { getProviderWithFreshToken, decryptProviderSecrets } = await import('../ai.service.js')
      const { buildEmbeddingConfigFromAIProvider } = await import('../rag/embedding.service.js')
      const linkedProvider = await prisma.aIProvider.findUnique({ where: { id: kb.embeddingProviderId } })
      if (linkedProvider?.apiKey) {
        const decrypted = (await getProviderWithFreshToken(kb.embeddingProviderId, companyId))
          || decryptProviderSecrets(linkedProvider)
        embeddingConfig = buildEmbeddingConfigFromAIProvider(
          {
            type: decrypted.type,
            apiKey: decrypted.apiKey,
            baseUrl: decrypted.baseUrl || kb.embeddingBaseUrl,
            oauthData: decrypted.oauthData,
          },
          kb.embeddingModel,
          kb.embeddingBaseUrl,
        )
        // Forçar provider key conforme configurado na KB (se diferente do tipo do provider)
        if (kb.embeddingProvider) embeddingConfig.provider = kb.embeddingProvider
      }
    }
    if (!embeddingConfig && kb.embeddingApiKey) {
      embeddingConfig = {
        provider: kb.embeddingProvider || 'openai',
        model: kb.embeddingModel, apiKey: decryptSafe(kb.embeddingApiKey) as string,
        baseUrl: kb.embeddingBaseUrl,
      }
    }
    if (!embeddingConfig) {
      const provider = await prisma.aIProvider.findFirst({
        where: { companyId, type: 'OPENAI', isActive: true },
      })
      const apiKey = decryptSafe(provider?.apiKey) as string || process.env.OPENAI_API_KEY
      if (!apiKey) return reply.status(400).send({ error: 'Nenhuma API key configurada' })
      embeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey }
    }

    // 3. Query expansion para perguntas vagas/curtas
    const words = message.trim().split(/\s+/)
    let expandedMessage = message
    if (words.length <= 2) {
      expandedMessage = `O que é ${message}? Informações sobre ${message}. ${message}`
    } else if (words.length <= 5) {
      expandedMessage = `${message}. Informações sobre: ${message}`
    }

    // 4. Search similar com threshold adaptativo + reranking por keyword
    const queryVector = await embedFn(expandedMessage, embeddingConfig)
    const collectionName = getCollectionName(companyId)
    // Threshold baixo (0.1) para deixar candidatos com keyword match literal chegarem ao reranker
    const adaptiveThreshold = 0.1

    const rawResults = await searchSimilar(collectionName, queryVector, {
      companyId,
      knowledgeBaseIds: [id],
      topK: (kb.topK || 5) * 4,
      scoreThreshold: adaptiveThreshold,
    })

    // Reranker: 50% cosine + 50% keyword overlap + bonus full-match
    const STOPWORDS = new Set(['qual','quais','quanto','como','onde','quando','que','com','para','pra','dos','das','seu','sua','peso','medio','media'])
    const rawTerms = message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length > 2)
    const queryTerms = rawTerms.filter(t => !STOPWORDS.has(t)).length > 0
      ? rawTerms.filter(t => !STOPWORDS.has(t))
      : rawTerms
    const results = rawResults
      .map(r => {
        const contentTerms = new Set(r.content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t: string) => t.length > 2))
        let matches = 0
        for (const term of queryTerms) {
          if (contentTerms.has(term)) matches++
          else for (const ct of contentTerms) { if (ct.startsWith(term) || term.startsWith(ct)) { matches += 0.5; break } }
        }
        const overlap = queryTerms.length > 0 ? matches / queryTerms.length : 0
        let score = (r.score * 0.5) + (overlap * 0.5)
        if (overlap >= 0.999) score += 0.3
        else if (overlap >= 0.75) score += 0.15
        return { ...r, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, kb.topK || 5)

    // Log embedding cost
    const queryTokens = estimateTokens(expandedMessage)
    logEmbeddingCost(companyId, embeddingConfig.model, queryTokens).catch(() => {})

    // 5. Build context from results
    const context = results.map((r, i) =>
      `[${i + 1}] (score: ${(r.score * 100).toFixed(1)}%) ${r.content}`
    ).join('\n\n')

    if (!context.trim()) {
      return reply.send({
        reply: 'Não encontrei informações relevantes na base de conhecimento para esta pergunta.',
        sources: [],
        tokensUsed: queryTokens,
      })
    }

    // 5. Call LLM to generate answer
    // Usar provider/model especificado pelo usuário, ou o padrão da empresa
    let llmProvider: any
    if (chatProviderId) {
      llmProvider = await prisma.aIProvider.findFirst({
        where: { id: chatProviderId, companyId, isActive: true },
      })
    }
    if (!llmProvider) {
      llmProvider = await prisma.aIProvider.findFirst({
        where: { companyId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      })
    }
    if (!llmProvider) return reply.status(400).send({ error: 'Nenhum provedor de IA configurado' })

    const selectedModel = chatModel || llmProvider.model

    const messages = [
      {
        role: 'system',
        content: `Você é um assistente inteligente que responde perguntas com base no conhecimento da base "${kb.name}".

Use o contexto abaixo para formular respostas completas e naturais.
Se a pergunta for vaga (ex: "o que vocês fazem?", "me conta sobre vocês"), use TODAS as informações disponíveis no contexto para dar uma resposta abrangente.
Se uma informação específica não estiver no contexto, diga que não encontrou essa informação específica.

Contexto disponível:
${context}

Regras:
- Responda sempre em português
- Use as informações do contexto para responder
- Seja objetivo mas completo
- Cite as fontes quando possível (ex: [1], [2])
- Para perguntas gerais, faça um resumo do que o conteúdo aborda`,
      },
      ...(history || []).slice(-6), // últimas 3 trocas
      { role: 'user', content: message },
    ]

    // Pick provider — refresh Copilot OAuth token if needed
    const { createProvider } = await import('../providers/index.js')
    const { getProviderWithFreshToken: _getFresh, decryptProviderSecrets: _decSec } = await import('../ai.service.js')
    const decLlm = (await _getFresh(llmProvider.id, companyId)) || _decSec(llmProvider)
    const providerImpl = createProvider(decLlm.type as any, decLlm.apiKey as string, decLlm.baseUrl, decLlm.oauthData)
    const llmResult = await providerImpl.chat({
      model: selectedModel,
      messages: messages as any,
      maxTokens: 1024,
      temperature: 0.3,
    })

    // Log LLM cost
    const llmCostUsd = calculateCost(llmResult.model || selectedModel, llmResult.promptTokens, llmResult.completionTokens)
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      await prisma.aITokenReport.upsert({
        where: {
          companyId_agentId_instanceId_date: {
            companyId,
            agentId: '__kb_chat__',
            instanceId: '__rag__',
            date: today,
          },
        },
        create: {
          companyId, agentId: '__kb_chat__', instanceId: '__rag__', date: today,
          messagesCount: 1, sessionsCount: 0,
          promptTokens: llmResult.promptTokens, completionTokens: llmResult.completionTokens,
          totalTokens: llmResult.tokensUsed, costUsd: llmCostUsd,
          modelBreakdown: [{ model: llmResult.model || selectedModel, tokens: llmResult.tokensUsed, cost: llmCostUsd }],
        },
        update: {
          messagesCount: { increment: 1 },
          promptTokens: { increment: llmResult.promptTokens },
          completionTokens: { increment: llmResult.completionTokens },
          totalTokens: { increment: llmResult.tokensUsed },
          costUsd: { increment: llmCostUsd },
        },
      })
    } catch (e) { console.error('[RAG] Error logging KB chat cost:', e) }

    return reply.send({
      reply: llmResult.content,
      model: llmResult.model || selectedModel,
      providerName: llmProvider.name,
      sources: results.map(r => ({
        content: r.content.substring(0, 200),
        score: r.score,
        documentTitle: r.metadata?.document_title,
        sourceUrl: r.metadata?.source_url,
      })),
      tokensUsed: llmResult.tokensUsed + queryTokens,
      costUsd: llmCostUsd + (queryTokens / 1_000_000) * 0.02,
    })
  })

  // === Queue status (monitoring) ===

  app.get('/ingestion-queue/status', { preHandler: [requirePermission('ai_knowledge:read')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ingestionQueue } = await import('../../../queues/ingestion.queue.js')
      const [waiting, active, completed, failed] = await Promise.all([
        ingestionQueue.getWaitingCount(),
        ingestionQueue.getActiveCount(),
        ingestionQueue.getCompletedCount(),
        ingestionQueue.getFailedCount(),
      ])
      return reply.send({ waiting, active, completed, failed })
    } catch {
      return reply.send({ waiting: 0, active: 0, completed: 0, failed: 0, error: 'Queue not available' })
    }
  })
}
