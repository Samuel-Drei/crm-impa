/**
 * Qdrant Vector Database Client
 * Inspirado no Dify (qdrant_vector.py) — adaptado para TypeScript/Node
 */

import { QdrantClient } from '@qdrant/js-client-rest'

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined

let client: QdrantClient | null = null

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      timeout: 30000,
    })
  }
  return client
}

/**
 * Garante que a collection existe com config HNSW (padrão Dify)
 */
export async function ensureCollection(
  collectionName: string,
  vectorSize: number = 1536
): Promise<void> {
  const qClient = getQdrantClient()

  try {
    await qClient.getCollection(collectionName)
    return // collection já existe
  } catch {
    // collection não existe, vamos criar
  }

  await qClient.createCollection(collectionName, {
    vectors: {
      size: vectorSize,
      distance: 'Cosine',
    },
    hnsw_config: {
      m: 16,
      ef_construct: 100,
      full_scan_threshold: 10000,
    },
    optimizers_config: {
      default_segment_number: 2,
    },
  })

  // Criar payload indexes (padrão Dify)
  await qClient.createPayloadIndex(collectionName, {
    field_name: 'company_id',
    field_schema: 'keyword',
  })
  await qClient.createPayloadIndex(collectionName, {
    field_name: 'knowledge_base_id',
    field_schema: 'keyword',
  })
  await qClient.createPayloadIndex(collectionName, {
    field_name: 'source_id',
    field_schema: 'keyword',
  })
  await qClient.createPayloadIndex(collectionName, {
    field_name: 'document_id',
    field_schema: 'keyword',
  })
  await qClient.createPayloadIndex(collectionName, {
    field_name: 'is_active',
    field_schema: 'bool',
  })

  console.log(`[Qdrant] Collection '${collectionName}' criada com HNSW index`)
}

/**
 * Nome da collection da empresa (isolamento multi-tenant)
 */
export function getCollectionName(companyId: string): string {
  return `crm_kb_${companyId.replace(/-/g, '_')}`
}

/**
 * Collection dedicada do Daily Brain (isolada das KBs do usuário).
 * Permite trocar dimensão do embedding sem afetar as outras KBs.
 */
export function getDailyBrainCollectionName(companyId: string): string {
  return `crm_brain_${companyId.replace(/-/g, '_')}`
}

/**
 * Recria a collection do zero (drop + create) — útil quando a dimensão muda.
 * ATENÇÃO: apaga TODOS os vetores. Use apenas em collections dedicadas.
 */
export async function recreateCollection(
  collectionName: string,
  vectorSize: number
): Promise<void> {
  const qClient = getQdrantClient()
  try {
    await qClient.deleteCollection(collectionName)
  } catch {
    // ignora se já não existia
  }
  await ensureCollection(collectionName, vectorSize)
}

/**
 * Upsert chunks no Qdrant com metadata rica
 */
export async function upsertChunks(
  collectionName: string,
  points: Array<{
    id: string
    vector: number[]
    payload: Record<string, unknown>
  }>
): Promise<void> {
  const qClient = getQdrantClient()

  // Batch de 64 (padrão Dify)
  const BATCH_SIZE = 64
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE)
    await qClient.upsert(collectionName, {
      wait: true,
      points: batch,
    })
  }
}

/**
 * Busca semântica com filtros (como o Dify retrieval_service)
 */
export async function searchSimilar(
  collectionName: string,
  queryVector: number[],
  options: {
    companyId: string
    knowledgeBaseIds?: string[]
    topK?: number
    scoreThreshold?: number
  }
): Promise<Array<{
  id: string
  score: number
  content: string
  metadata: Record<string, unknown>
}>> {
  const qClient = getQdrantClient()
  const { companyId, knowledgeBaseIds, topK = 5, scoreThreshold = 0.5 } = options

  const mustFilters: any[] = [
    { key: 'company_id', match: { value: companyId } },
    { key: 'is_active', match: { value: true } },
  ]

  if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
    mustFilters.push({
      key: 'knowledge_base_id',
      match: { any: knowledgeBaseIds },
    })
  }

  const results = await qClient.search(collectionName, {
    vector: queryVector,
    limit: topK,
    score_threshold: scoreThreshold,
    filter: { must: mustFilters },
    with_payload: true,
  })

  return results.map((r) => ({
    id: typeof r.id === 'string' ? r.id : String(r.id),
    score: r.score,
    content: (r.payload?.content as string) || '',
    metadata: (r.payload || {}) as Record<string, unknown>,
  }))
}

/**
 * Delete chunks por filtro (source/document)
 */
export async function deleteByFilter(
  collectionName: string,
  filter: Record<string, string>
): Promise<void> {
  const qClient = getQdrantClient()

  const mustFilters = Object.entries(filter).map(([key, value]) => ({
    key,
    match: { value },
  }))

  await qClient.delete(collectionName, {
    wait: true,
    filter: { must: mustFilters },
  })
}

/**
 * Health check do Qdrant
 */
export async function checkQdrantHealth(): Promise<boolean> {
  try {
    const qClient = getQdrantClient()
    await qClient.getCollections()
    return true
  } catch {
    return false
  }
}
