/**
 * Daily Brain Digest — Persistência
 *
 * Recebe um DigestRunResult e grava em:
 *   - AIKnowledgeBase '__daily_brain__' (auto-criada por empresa)
 *   - AIKnowledgeSource '__daily_brain_source__' (auto-criada)
 *   - AIKnowledgeDocument (1 por data)
 *   - AIKnowledgeChunk + Qdrant (1 por bucket)
 *   - AIBrainFact (todos os fatos extraídos)
 *   - AIBrainNode (1 por contato + 1 por tópico)
 *   - AIBrainEdge (Contact -> Topic, peso=ocorrências)
 */

import crypto from 'node:crypto'
import { prisma } from '../../../config/database.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from '../ai.service.js'
import {
  embedTexts,
  buildEmbeddingConfigFromAIProvider,
  getEmbeddingDimension,
  type EmbeddingConfig,
} from '../rag/embedding.service.js'
import { ensureCollection, getDailyBrainCollectionName, recreateCollection, upsertChunks, deleteByFilter } from '../rag/qdrant.client.js'
import type { DigestRunResult, ContactBucket } from './brain-digest.service.js'

export const DAILY_BRAIN_KB_NAME = '__daily_brain__'
const DAILY_BRAIN_SOURCE_NAME = '__daily_brain_source__'

export interface PersistResult {
  knowledgeBaseId: string
  documentId: string
  chunksCreated: number
  factsCreated: number
  nodesUpserted: number
  edgesUpserted: number
  embeddingsGenerated: number
}

// ============================================
// Embedding config da empresa
// ============================================

async function getCompanyEmbeddingConfig(companyId: string): Promise<{
  config: EmbeddingConfig
  providerId: string | null
  model: string
  dimension: number
} | null> {
  // Override explícito da empresa (Daily Brain)
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { dailyBrainEmbeddingProviderId: true, dailyBrainEmbeddingModel: true },
  })

  let provider = null as Awaited<ReturnType<typeof prisma.aIProvider.findFirst>> | null
  if (company?.dailyBrainEmbeddingProviderId) {
    provider = await prisma.aIProvider.findFirst({
      where: { id: company.dailyBrainEmbeddingProviderId, companyId, isActive: true },
    })
  }

  // Fallback: provider default
  if (!provider) {
    provider = await prisma.aIProvider.findFirst({
      where: { companyId, isActive: true, isDefault: true },
    })
  }

  // Fallback final: primeiro provider compatível
  const fallback = provider
    ?? (await prisma.aIProvider.findFirst({
      where: { companyId, isActive: true, type: { in: ['OPENAI', 'GEMINI', 'GITHUB_COPILOT'] } },
      orderBy: { createdAt: 'asc' },
    }))

  if (!fallback) return null

  const decrypted = (await getProviderWithFreshToken(fallback.id, companyId)) || decryptProviderSecrets(fallback)

  // Modelo: override explícito > default por tipo
  const model =
    company?.dailyBrainEmbeddingModel
    || (decrypted.type === 'GEMINI' ? 'text-embedding-004'
       : decrypted.type === 'GITHUB_COPILOT' ? 'text-embedding-3-small'
       : 'text-embedding-3-small')

  const config = buildEmbeddingConfigFromAIProvider(decrypted, model)
  const dimension = getEmbeddingDimension(model, config.provider)
  return { config, providerId: fallback.id, model, dimension }
}

// ============================================
// Garantir KB + Source
// ============================================

export async function ensureDailyBrainKB(companyId: string): Promise<string> {
  const emb = await getCompanyEmbeddingConfig(companyId)

  const existing = await prisma.aIKnowledgeBase.findFirst({
    where: { companyId, name: DAILY_BRAIN_KB_NAME },
    select: {
      id: true,
      embeddingProviderId: true,
      embeddingProvider: true,
      embeddingModel: true,
      embeddingDimension: true,
    },
  })
  if (existing) {
    // Sincroniza com a config atual da empresa caso tenha mudado
    if (emb && (
      existing.embeddingProviderId !== emb.providerId
      || existing.embeddingProvider !== emb.config.provider
      || existing.embeddingModel !== emb.model
      || existing.embeddingDimension !== emb.dimension
    )) {
      // Se a dimensão mudou, RECRIAR a collection dedicada do Daily Brain
      // (apaga vetores antigos — collection é dedicada, não afeta KBs do usuário).
      // Também limpa documentos/chunks no Postgres para evitar referências órfãs.
      const dimensionChanged = existing.embeddingDimension !== emb.dimension
      if (dimensionChanged) {
        try {
          await recreateCollection(getDailyBrainCollectionName(companyId), emb.dimension)
        } catch (err) {
          console.warn('[DailyBrain] Falha ao recriar collection após mudança de dimensão:', (err as Error).message)
        }
        await prisma.aIKnowledgeChunk.deleteMany({
          where: { document: { knowledgeBaseId: existing.id } },
        })
        await prisma.aIKnowledgeDocument.deleteMany({
          where: { knowledgeBaseId: existing.id },
        })
      }
      await prisma.aIKnowledgeBase.update({
        where: { id: existing.id },
        data: {
          embeddingProviderId: emb.providerId,
          embeddingProvider: emb.config.provider,
          embeddingModel: emb.model,
          embeddingDimension: emb.dimension,
        },
      })
    }
    return existing.id
  }

  const kb = await prisma.aIKnowledgeBase.create({
    data: {
      companyId,
      name: DAILY_BRAIN_KB_NAME,
      description: 'Memória diária do CRM (gerado automaticamente pelo Daily Brain Digest)',
      embeddingProviderId: emb?.providerId || null,
      embeddingProvider: emb?.config.provider || 'openai',
      embeddingModel: emb?.model || 'text-embedding-3-small',
      embeddingDimension: emb?.dimension || 1536,
      retrievalMode: 'semantic',
      topK: 8,
      scoreThreshold: 0.35,
      type: 'text',
      isActive: true,
      indexingStatus: 'ready',
    },
    select: { id: true },
  })
  return kb.id
}

async function ensureDailyBrainSource(companyId: string, knowledgeBaseId: string): Promise<string> {
  const existing = await prisma.aIKnowledgeSource.findFirst({
    where: { companyId, knowledgeBaseId, name: DAILY_BRAIN_SOURCE_NAME },
    select: { id: true },
  })
  if (existing) return existing.id

  const src = await prisma.aIKnowledgeSource.create({
    data: {
      companyId,
      knowledgeBaseId,
      name: DAILY_BRAIN_SOURCE_NAME,
      type: 'TEXT',
      status: 'COMPLETED',
      isActive: true,
      processedAt: new Date(),
    },
    select: { id: true },
  })
  return src.id
}

// ============================================
// Persistir vetores (KB chunks + Qdrant)
// ============================================

async function persistVectors(params: {
  companyId: string
  knowledgeBaseId: string
  sourceId: string
  date: string
  buckets: ContactBucket[]
  embeddingConfig: EmbeddingConfig
  embeddingDimension: number
}): Promise<{ documentId: string; chunksCreated: number; embeddingsGenerated: number }> {
  const { companyId, knowledgeBaseId, sourceId, date, buckets, embeddingConfig, embeddingDimension } = params

  if (buckets.length === 0) {
    return { documentId: '', chunksCreated: 0, embeddingsGenerated: 0 }
  }

  // Upsert documento da data (idempotência: se rodar 2x a mesma data, substitui chunks)
  const docTitle = `Daily Brain ${date}`
  const sourceUrl = `daily-brain://${companyId}/${date}`
  const existingDoc = await prisma.aIKnowledgeDocument.findFirst({
    where: { knowledgeBaseId, sourceUrl },
    select: { id: true },
  })

  let documentId: string
  if (existingDoc) {
    documentId = existingDoc.id
    // Limpa chunks antigos (Postgres + Qdrant)
    await prisma.aIKnowledgeChunk.deleteMany({ where: { documentId } })
    try {
      await deleteByFilter(getDailyBrainCollectionName(companyId), { document_id: documentId })
    } catch (err) {
      console.warn('[DailyBrain] Falha ao limpar Qdrant doc antigo:', (err as Error).message)
    }
  } else {
    const created = await prisma.aIKnowledgeDocument.create({
      data: {
        companyId,
        knowledgeBaseId,
        sourceId,
        title: docTitle,
        sourceUrl,
        rawContent: buckets.map(b => b.rawTextForEmbedding).join('\n\n'),
        cleanContent: buckets.map(b => b.rawTextForEmbedding).join('\n\n'),
        wordCount: buckets.reduce((s, b) => s + b.rawTextForEmbedding.split(/\s+/).length, 0),
        tokenCount: buckets.reduce((s, b) => s + Math.ceil(b.rawTextForEmbedding.length / 4), 0),
        status: 'PROCESSING',
        enabled: true,
        isActive: true,
        metadata: { date, buckets: buckets.length },
      },
      select: { id: true },
    })
    documentId = created.id
  }

  // Garante collection dedicada do Daily Brain (isolada das KBs do usuário)
  const collection = getDailyBrainCollectionName(companyId)
  await ensureCollection(collection, embeddingDimension)

  // Embeddings
  const texts = buckets.map(b => b.rawTextForEmbedding)
  const embeddings = await embedTexts(texts, embeddingConfig, embeddingConfig.model, companyId)

  // Persistir chunks no PG + montar pontos Qdrant
  const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = []
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    const chunkId = crypto.randomUUID()
    await prisma.aIKnowledgeChunk.create({
      data: {
        id: chunkId,
        documentId,
        content: b.rawTextForEmbedding,
        chunkIndex: i,
        tokenCount: Math.ceil(b.rawTextForEmbedding.length / 4),
        wordCount: b.rawTextForEmbedding.split(/\s+/).filter(Boolean).length,
        enabled: true,
        qdrantPointId: chunkId,
        isIndexed: true,
        elementType: 'daily_brain_bucket',
        metadata: {
          date,
          contactId: b.contactId,
          contactName: b.contactName,
          remoteJid: b.remoteJid,
          messageCount: b.messageCount,
          topics: b.topics,
          factCount: b.facts.length,
        } as any,
      },
    })

    points.push({
      id: chunkId,
      vector: embeddings[i],
      payload: {
        content: b.rawTextForEmbedding,
        company_id: companyId,
        knowledge_base_id: knowledgeBaseId,
        knowledge_base_name: DAILY_BRAIN_KB_NAME,
        source_id: sourceId,
        source_name: DAILY_BRAIN_SOURCE_NAME,
        source_type: 'TEXT',
        document_id: documentId,
        document_title: docTitle,
        chunk_index: i,
        is_active: true,
        created_at: new Date().toISOString(),
        // Metadata especial daily-brain
        daily_brain: true,
        date,
        contact_id: b.contactId,
        contact_name: b.contactName,
        remote_jid: b.remoteJid,
        topics: b.topics,
      },
    })
  }

  await upsertChunks(collection, points)

  await prisma.aIKnowledgeDocument.update({
    where: { id: documentId },
    data: {
      status: 'COMPLETED',
      totalChunks: buckets.length,
      indexedAt: new Date(),
    },
  })

  return { documentId, chunksCreated: buckets.length, embeddingsGenerated: buckets.length }
}

// ============================================
// Persistir Brain (Facts + Nodes + Edges)
// ============================================

async function persistBrain(params: {
  companyId: string
  date: string
  digestId: string
  buckets: ContactBucket[]
}): Promise<{ factsCreated: number; nodesUpserted: number; edgesUpserted: number }> {
  const { companyId, date, digestId, buckets } = params

  let factsCreated = 0
  let nodesUpserted = 0
  let edgesUpserted = 0

  for (const b of buckets) {
    try {
      // 1. Upsert Contact node
      const contactNodeKey = { companyId, type: 'CONTACT' as const, subjectId: b.contactId }
      let contactNode = await prisma.aIBrainNode.findFirst({
        where: contactNodeKey,
        select: { id: true },
      })
      if (!contactNode) {
        contactNode = await prisma.aIBrainNode.create({
          data: {
            companyId,
            type: 'CONTACT',
            subjectType: 'contact',
            subjectId: b.contactId,
            label: b.contactName,
            summary: b.summary,
            metadata: { remoteJid: b.remoteJid },
          },
          select: { id: true },
        })
      } else {
        await prisma.aIBrainNode.update({
          where: { id: contactNode.id },
          data: { lastSeenAt: new Date(), summary: b.summary, label: b.contactName },
        })
      }
      nodesUpserted++

      // 2. Insert Facts
      for (const f of b.facts) {
        try {
          await prisma.aIBrainFact.create({
            data: {
              companyId,
              contactId: b.contactId,
              nodeId: contactNode.id,
              category: 'EVENT',
              subject: b.contactName,
              predicate: f.predicate,
              value: f.value,
              confidence: f.confidence,
              sourceType: 'daily_digest',
              sourceRefType: 'daily_digest',
              sourceRefId: digestId,
              validFrom: new Date(),
              metadata: { date, topics: b.topics },
            },
          })
          factsCreated++
        } catch (err) {
          console.warn('[DailyBrain] Falha ao criar fact:', (err as Error).message)
        }
      }

      // 3. Topic nodes + edges
      for (const topic of b.topics) {
        if (!topic) continue
        try {
          let topicNode = await prisma.aIBrainNode.findFirst({
            where: { companyId, type: 'TOPIC', subjectType: 'topic', subjectId: topic },
            select: { id: true },
          })
          if (!topicNode) {
            topicNode = await prisma.aIBrainNode.create({
              data: {
                companyId,
                type: 'TOPIC',
                subjectType: 'topic',
                subjectId: topic,
                label: topic,
              },
              select: { id: true },
            })
          } else {
            await prisma.aIBrainNode.update({
              where: { id: topicNode.id },
              data: { lastSeenAt: new Date() },
            })
          }
          nodesUpserted++

          // Edge contact -> topic (peso incremental)
          const existingEdge = await prisma.aIBrainEdge.findFirst({
            where: {
              fromId: contactNode.id,
              toId: topicNode.id,
              type: 'INTERESTED_IN',
            },
            select: { id: true, weight: true },
          })
          if (existingEdge) {
            await prisma.aIBrainEdge.update({
              where: { id: existingEdge.id },
              data: { weight: (existingEdge.weight || 1) + 1 },
            })
          } else {
            await prisma.aIBrainEdge.create({
              data: {
                companyId,
                fromId: contactNode.id,
                toId: topicNode.id,
                type: 'INTERESTED_IN',
                weight: 1,
              },
            })
          }
          edgesUpserted++
        } catch (err) {
          console.warn('[DailyBrain] Falha ao processar topic:', (err as Error).message)
        }
      }
    } catch (err) {
      console.warn(`[DailyBrain] Falha ao persistir bucket ${b.contactId}:`, (err as Error).message)
    }
  }

  return { factsCreated, nodesUpserted, edgesUpserted }
}

// ============================================
// API principal
// ============================================

export async function persistDigest(params: {
  companyId: string
  digestId: string
  digest: DigestRunResult
}): Promise<PersistResult> {
  const { companyId, digestId, digest } = params

  if (digest.buckets.length === 0) {
    return {
      knowledgeBaseId: '',
      documentId: '',
      chunksCreated: 0,
      factsCreated: 0,
      nodesUpserted: 0,
      edgesUpserted: 0,
      embeddingsGenerated: 0,
    }
  }

  const knowledgeBaseId = await ensureDailyBrainKB(companyId)
  const sourceId = await ensureDailyBrainSource(companyId, knowledgeBaseId)

  const emb = await getCompanyEmbeddingConfig(companyId)
  if (!emb) {
    console.warn(`[DailyBrain] Empresa ${companyId} sem embedding provider — pulando vetores`)
    const brain = await persistBrain({ companyId, date: digest.date, digestId, buckets: digest.buckets })
    return {
      knowledgeBaseId,
      documentId: '',
      chunksCreated: 0,
      embeddingsGenerated: 0,
      ...brain,
    }
  }

  const { documentId, chunksCreated, embeddingsGenerated } = await persistVectors({
    companyId,
    knowledgeBaseId,
    sourceId,
    date: digest.date,
    buckets: digest.buckets,
    embeddingConfig: emb.config,
    embeddingDimension: emb.dimension,
  })

  const brain = await persistBrain({ companyId, date: digest.date, digestId, buckets: digest.buckets })

  return {
    knowledgeBaseId,
    documentId,
    chunksCreated,
    embeddingsGenerated,
    ...brain,
  }
}
