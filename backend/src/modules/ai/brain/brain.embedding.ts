/**
 * AI Brain — Vetorização de fatos no Qdrant
 *
 * Por que: o bloco "What I know" injetado no prompt é o que mais economiza tokens
 * (substitui histórico bruto por fatos estruturados). Quando o contato acumula
 * muitos fatos, ordenar por confidence/data já não basta — queremos mandar
 * APENAS os fatos semanticamente relevantes para a mensagem atual do usuário.
 *
 * Estratégia:
 *  - 1 collection por empresa (`crm_brain_{companyId}`)
 *  - Payload mínimo: companyId, factId, contactId?, customerAccountId?, category, isActive
 *  - Embedding gerado on-write (createFact, supersedeFact) e removido on-delete
 *  - Busca filtra por contactId/customerAccountId + isActive=true
 *  - Falha silenciosa: se embedding não estiver disponível, sistema cai no
 *    ranking estruturado (confidence + recência) sem quebrar nada.
 */

import { prisma } from '../../../config/database.js'
import { decryptSafe } from '../../../config/encryption.js'
import {
  ensureCollection,
  getQdrantClient,
} from '../rag/qdrant.client.js'
import {
  embedQuery,
  embedTexts,
  getEmbeddingDimension,
  type EmbeddingConfig,
} from '../rag/embedding.service.js'

// ============================================
// Configuração
// ============================================

/** Nome da collection multi-tenant */
export function getBrainCollectionName(companyId: string): string {
  return `crm_brain_${companyId.replace(/-/g, '_')}`
}

/**
 * Resolve config de embedding para a empresa.
 * Reutiliza o provider OPENAI ativo da company. Sem fallback para .env aqui
 * porque queremos evitar custo "fantasma" — a empresa precisa ter provider
 * configurado conscientemente.
 */
async function resolveEmbeddingConfig(companyId: string): Promise<EmbeddingConfig | null> {
  // Tenta OPENAI primeiro (compatível com o padrão do RAG)
  const openai = await prisma.aIProvider.findFirst({
    where: { companyId, type: 'OPENAI', isActive: true },
  })
  if (openai?.apiKey) {
    const apiKey = decryptSafe(openai.apiKey) as string
    if (apiKey) {
      return {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey,
        baseUrl: openai.baseUrl || undefined,
      }
    }
  }

  // Fallback: GEMINI (gratuito)
  const gemini = await prisma.aIProvider.findFirst({
    where: { companyId, type: 'GEMINI', isActive: true },
  })
  if (gemini?.apiKey) {
    const apiKey = decryptSafe(gemini.apiKey) as string
    if (apiKey) {
      return {
        provider: 'gemini',
        model: 'text-embedding-004',
        apiKey,
        baseUrl: gemini.baseUrl || undefined,
      }
    }
  }

  // Último: variáveis de ambiente
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
    }
  }

  return null
}

/** Texto canônico para embedding de um fato */
function buildFactText(f: {
  category: string
  subject: string
  predicate: string
  value: string
}): string {
  return `[${f.category}] ${f.subject} ${f.predicate} ${f.value}`.slice(0, 2000)
}

// ============================================
// Setup de collection (idempotente)
// ============================================

const ensuredCollections = new Set<string>()

async function ensureBrainCollection(companyId: string, vectorSize: number): Promise<string> {
  const name = getBrainCollectionName(companyId)
  const cacheKey = `${name}:${vectorSize}`
  if (ensuredCollections.has(cacheKey)) return name

  await ensureCollection(name, vectorSize)

  // Indexes específicos do Brain (idempotentes — Qdrant ignora se já existem)
  const qClient = getQdrantClient()
  const fields: Array<{ name: string; type: 'keyword' | 'bool' }> = [
    { name: 'company_id', type: 'keyword' },
    { name: 'contact_id', type: 'keyword' },
    { name: 'customer_account_id', type: 'keyword' },
    { name: 'fact_id', type: 'keyword' },
    { name: 'category', type: 'keyword' },
    { name: 'is_active', type: 'bool' },
  ]
  for (const f of fields) {
    try {
      await qClient.createPayloadIndex(name, {
        field_name: f.name,
        field_schema: f.type,
      })
    } catch {
      // index já existe — ignora
    }
  }

  ensuredCollections.add(cacheKey)
  return name
}

// ============================================
// Indexação (write path)
// ============================================

export async function indexFact(
  companyId: string,
  fact: {
    id: string
    category: string
    subject: string
    predicate: string
    value: string
    contactId?: string | null
    customerAccountId?: string | null
  },
): Promise<void> {
  try {
    const cfg = await resolveEmbeddingConfig(companyId)
    if (!cfg) return // empresa sem provider — modo estruturado

    const dim = getEmbeddingDimension(cfg.model, cfg.provider)
    const collection = await ensureBrainCollection(companyId, dim)

    const text = buildFactText(fact)
    const [vector] = await embedTexts([text], cfg, cfg.model, companyId)
    if (!vector) return

    const qClient = getQdrantClient()
    await qClient.upsert(collection, {
      wait: false,
      points: [
        {
          id: fact.id,
          vector,
          payload: {
            company_id: companyId,
            fact_id: fact.id,
            contact_id: fact.contactId || null,
            customer_account_id: fact.customerAccountId || null,
            category: fact.category,
            is_active: true,
            content: text,
          },
        },
      ],
    })
  } catch (err) {
    console.warn('[Brain Embedding] indexFact failed:', (err as Error).message)
  }
}

export async function markFactInactive(companyId: string, factId: string): Promise<void> {
  try {
    const collection = getBrainCollectionName(companyId)
    const qClient = getQdrantClient()
    await qClient.setPayload(collection, {
      wait: false,
      payload: { is_active: false },
      points: [factId],
    })
  } catch (err) {
    console.warn('[Brain Embedding] markFactInactive failed:', (err as Error).message)
  }
}

export async function removeFactFromIndex(companyId: string, factId: string): Promise<void> {
  try {
    const collection = getBrainCollectionName(companyId)
    const qClient = getQdrantClient()
    await qClient.delete(collection, {
      wait: false,
      points: [factId],
    })
  } catch (err) {
    console.warn('[Brain Embedding] removeFactFromIndex failed:', (err as Error).message)
  }
}

// ============================================
// Busca semântica (read path)
// ============================================

export interface BrainSearchOptions {
  contactId?: string | null
  customerAccountId?: string | null
  topK?: number
  scoreThreshold?: number
}

/**
 * Retorna ids dos fatos mais relevantes para a query (mensagem do usuário).
 * Retorna [] se vetorização não disponível — caller deve cair no ranking estruturado.
 */
export async function searchSimilarFactIds(
  companyId: string,
  query: string,
  opts: BrainSearchOptions = {},
): Promise<Array<{ factId: string; score: number }>> {
  try {
    if (!query || query.trim().length < 3) return []

    const cfg = await resolveEmbeddingConfig(companyId)
    if (!cfg) return []

    const dim = getEmbeddingDimension(cfg.model, cfg.provider)
    const collection = await ensureBrainCollection(companyId, dim)

    const vector = await embedQuery(query, cfg, cfg.model, companyId)

    const must: any[] = [
      { key: 'company_id', match: { value: companyId } },
      { key: 'is_active', match: { value: true } },
    ]
    if (opts.contactId) {
      must.push({ key: 'contact_id', match: { value: opts.contactId } })
    }
    if (opts.customerAccountId) {
      must.push({ key: 'customer_account_id', match: { value: opts.customerAccountId } })
    }

    const qClient = getQdrantClient()
    const results = await qClient.search(collection, {
      vector,
      limit: opts.topK ?? 12,
      score_threshold: opts.scoreThreshold ?? 0.4,
      filter: { must },
      with_payload: false,
    })

    return results.map(r => ({
      factId: typeof r.id === 'string' ? r.id : String(r.id),
      score: r.score,
    }))
  } catch (err) {
    console.warn('[Brain Embedding] search failed:', (err as Error).message)
    return []
  }
}

// ============================================
// Backfill (uso administrativo)
// ============================================

export async function backfillCompanyFacts(companyId: string, limit = 1000): Promise<{ indexed: number; skipped: number }> {
  const cfg = await resolveEmbeddingConfig(companyId)
  if (!cfg) return { indexed: 0, skipped: 0 }

  const dim = getEmbeddingDimension(cfg.model, cfg.provider)
  await ensureBrainCollection(companyId, dim)

  const facts = await prisma.aIBrainFact.findMany({
    where: { companyId, validTo: null },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  })

  let indexed = 0
  for (const f of facts) {
    await indexFact(companyId, {
      id: f.id,
      category: f.category,
      subject: f.subject,
      predicate: f.predicate,
      value: f.value,
      contactId: f.contactId,
      customerAccountId: f.customerAccountId,
    })
    indexed++
  }

  return { indexed, skipped: 0 }
}
