/**
 * Embedding Service — Multi-provider (inspirado no Dify)
 * Suporta: OpenAI, Gemini, Cohere, Voyage, Ollama
 * Cada knowledge base pode escolher seu provider/modelo/apiKey
 */

import crypto from 'crypto'

// ============================================
// Tipos e configuração de providers
// ============================================

export interface EmbeddingConfig {
  provider: string        // "openai" | "gemini" | "cohere" | "voyage" | "ollama" | "github_copilot"
  model: string           // nome do modelo de embedding
  apiKey: string          // API key para o provider (para Copilot: copilotToken)
  baseUrl?: string | null // URL customizada (Ollama, Azure, Copilot endpoint, etc.)
  /** Headers extras (ex.: Copilot-Integration-Id, Editor-Version) */
  extraHeaders?: Record<string, string>
}

/** Catálogo de providers e modelos disponíveis */
export const EMBEDDING_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'text-embedding-3-small', name: 'Embedding 3 Small', dimensions: 1536, pricePerMTokens: 0.02 },
      { id: 'text-embedding-3-large', name: 'Embedding 3 Large', dimensions: 3072, pricePerMTokens: 0.13 },
      { id: 'text-embedding-ada-002', name: 'Ada 002 (legacy)', dimensions: 1536, pricePerMTokens: 0.10 },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'text-embedding-004', name: 'Embedding 004', dimensions: 768, pricePerMTokens: 0.00 },
      { id: 'embedding-001', name: 'Embedding 001', dimensions: 768, pricePerMTokens: 0.00 },
    ],
  },
  cohere: {
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/v1',
    models: [
      { id: 'embed-multilingual-v3.0', name: 'Multilingual v3', dimensions: 1024, pricePerMTokens: 0.10 },
      { id: 'embed-english-v3.0', name: 'English v3', dimensions: 1024, pricePerMTokens: 0.10 },
      { id: 'embed-multilingual-light-v3.0', name: 'Multilingual Light v3', dimensions: 384, pricePerMTokens: 0.10 },
    ],
  },
  voyage: {
    name: 'Voyage AI',
    baseUrl: 'https://api.voyageai.com/v1',
    models: [
      { id: 'voyage-3', name: 'Voyage 3', dimensions: 1024, pricePerMTokens: 0.06 },
      { id: 'voyage-3-lite', name: 'Voyage 3 Lite', dimensions: 512, pricePerMTokens: 0.02 },
      { id: 'voyage-multilingual-2', name: 'Multilingual 2', dimensions: 1024, pricePerMTokens: 0.12 },
    ],
  },
  ollama: {
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434',
    models: [
      { id: 'nomic-embed-text', name: 'Nomic Embed Text', dimensions: 768, pricePerMTokens: 0 },
      { id: 'mxbai-embed-large', name: 'mxbai Embed Large', dimensions: 1024, pricePerMTokens: 0 },
      { id: 'all-minilm', name: 'All MiniLM', dimensions: 384, pricePerMTokens: 0 },
    ],
  },
  github_copilot: {
    name: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com',
    models: [
      { id: 'text-embedding-3-small', name: 'Embedding 3 Small', dimensions: 1536, pricePerMTokens: 0 },
      { id: 'text-embedding-3-small-inference', name: 'Embedding 3 Small (Inference)', dimensions: 1536, pricePerMTokens: 0 },
      { id: 'text-embedding-ada-002', name: 'Ada 002 (legacy)', dimensions: 1536, pricePerMTokens: 0 },
    ],
  },
} as const

export type EmbeddingProvider = keyof typeof EMBEDDING_PROVIDERS

// ============================================
// Cache de embeddings
// ============================================

const embeddingCache = new Map<string, number[]>()
const MAX_CACHE_SIZE = 10000

function getCacheKey(text: string, provider: string, model: string, companyId: string): string {
  return crypto.createHash('sha256').update(`${companyId}:${provider}:${model}:${text}`).digest('hex')
}

// ============================================
// Funções de embedding por provider
// ============================================

/** OpenAI / Voyage / GitHub Copilot (usam a mesma API format) */
async function embedOpenAICompatible(
  texts: string[],
  config: EmbeddingConfig,
  endpoint: string
): Promise<number[][]> {
  const BATCH_SIZE = 100
  const allEmbeddings: number[][] = new Array(texts.length)

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await fetch(`${endpoint}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(config.extraHeaders || {}),
      },
      body: JSON.stringify({ input: batch, model: config.model }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${config.provider} embedding error (${response.status}): ${error}`)
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    for (const item of data.data) {
      allEmbeddings[i + item.index] = item.embedding
    }
  }

  return allEmbeddings
}

/** Google Gemini */
async function embedGemini(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const baseUrl = config.baseUrl || EMBEDDING_PROVIDERS.gemini.baseUrl
  const allEmbeddings: number[][] = []

  // Gemini batch embed: até 100 textos por request
  const BATCH_SIZE = 100
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const requests = batch.map(text => ({
      model: `models/${config.model}`,
      content: { parts: [{ text }] },
    }))

    const response = await fetch(
      `${baseUrl}/models/${config.model}:batchEmbedContents?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini embedding error (${response.status}): ${error}`)
    }

    const data = await response.json() as {
      embeddings: Array<{ values: number[] }>
    }

    for (const emb of data.embeddings) {
      allEmbeddings.push(emb.values)
    }
  }

  return allEmbeddings
}

/** Cohere */
async function embedCohere(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const baseUrl = config.baseUrl || EMBEDDING_PROVIDERS.cohere.baseUrl
  const BATCH_SIZE = 96 // Cohere limit

  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await fetch(`${baseUrl}/embed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: batch,
        model: config.model,
        input_type: 'search_document',
        truncate: 'END',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Cohere embedding error (${response.status}): ${error}`)
    }

    const data = await response.json() as { embeddings: number[][] }
    allEmbeddings.push(...data.embeddings)
  }

  return allEmbeddings
}

/** Ollama (local) */
async function embedOllama(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const baseUrl = config.baseUrl || EMBEDDING_PROVIDERS.ollama.baseUrl
  const allEmbeddings: number[][] = []

  // Ollama suporta batch nativo via /api/embed
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: texts }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Ollama embedding error (${response.status}): ${error}`)
  }

  const data = await response.json() as { embeddings: number[][] }
  allEmbeddings.push(...data.embeddings)

  return allEmbeddings
}

// ============================================
// API pública — interface unificada
// ============================================

/**
 * Gera embeddings para uma lista de textos usando qualquer provider
 * Usa cache + batching automático
 */
export async function embedTexts(
  texts: string[],
  apiKeyOrConfig: string | EmbeddingConfig,
  model: string = 'text-embedding-3-small',
  companyId: string = '_global'
): Promise<number[][]> {
  // Compatibilidade retroativa: se receber só a apiKey (string), assume OpenAI
  const config: EmbeddingConfig = typeof apiKeyOrConfig === 'string'
    ? { provider: 'openai', model, apiKey: apiKeyOrConfig }
    : apiKeyOrConfig

  const results: (number[] | null)[] = new Array(texts.length).fill(null)
  const toEmbed: { index: number; text: string }[] = []

  // Check cache (inclui provider+model no cache key para evitar colisões)
  for (let i = 0; i < texts.length; i++) {
    const key = getCacheKey(texts[i], config.provider, config.model, companyId)
    const cached = embeddingCache.get(key)
    if (cached) {
      results[i] = cached
    } else {
      toEmbed.push({ index: i, text: texts[i] })
    }
  }

  if (toEmbed.length === 0) return results as number[][]

  const textsToEmbed = toEmbed.map(t => t.text)
  let embeddings: number[][]

  // Dispatch para o provider correto
  switch (config.provider) {
    case 'gemini':
      embeddings = await embedGemini(textsToEmbed, config)
      break
    case 'cohere':
      embeddings = await embedCohere(textsToEmbed, config)
      break
    case 'voyage':
      embeddings = await embedOpenAICompatible(textsToEmbed, config,
        config.baseUrl || EMBEDDING_PROVIDERS.voyage.baseUrl)
      break
    case 'ollama':
      embeddings = await embedOllama(textsToEmbed, config)
      break
    case 'github_copilot':
      embeddings = await embedOpenAICompatible(textsToEmbed, config,
        config.baseUrl || EMBEDDING_PROVIDERS.github_copilot.baseUrl)
      break
    case 'openai':
    default:
      embeddings = await embedOpenAICompatible(textsToEmbed, config,
        config.baseUrl || EMBEDDING_PROVIDERS.openai.baseUrl)
      break
  }

  // Mapear resultados de volta + cache
  for (let i = 0; i < toEmbed.length; i++) {
    const original = toEmbed[i]
    const embedding = embeddings[i]
    results[original.index] = embedding

    const key = getCacheKey(original.text, config.provider, config.model, companyId)
    if (embeddingCache.size >= MAX_CACHE_SIZE) {
      const firstKey = embeddingCache.keys().next().value
      if (firstKey) embeddingCache.delete(firstKey)
    }
    embeddingCache.set(key, embedding)
  }

  return results as number[][]
}

/**
 * Gera embedding para uma única query (busca)
 */
export async function embedQuery(
  text: string,
  apiKeyOrConfig: string | EmbeddingConfig,
  model: string = 'text-embedding-3-small',
  companyId: string = '_global'
): Promise<number[]> {
  const results = await embedTexts([text], apiKeyOrConfig, model, companyId)
  return results[0]
}

/**
 * Conta tokens de forma aproximada (sem tiktoken)
 * ~4 chars = 1 token (heurística padrão)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Retorna a dimensão do vetor para um modelo.
 * Consulta o catálogo de providers; fallback 1536.
 */
export function getEmbeddingDimension(model: string, provider?: string): number {
  // Buscar no catálogo
  for (const [prov, cfg] of Object.entries(EMBEDDING_PROVIDERS)) {
    if (provider && prov !== provider) continue
    const found = cfg.models.find(m => m.id === model)
    if (found) return found.dimensions
  }
  return 1536
}

/**
 * Retorna os modelos disponíveis para um provider
 */
export function getModelsForProvider(provider: string) {
  const p = EMBEDDING_PROVIDERS[provider as EmbeddingProvider]
  return p ? p.models : []
}

/**
 * Lista todos os providers com seus modelos (para o frontend)
 */
export function listEmbeddingProviders() {
  return Object.entries(EMBEDDING_PROVIDERS).map(([key, cfg]) => ({
    id: key,
    name: cfg.name,
    models: cfg.models.map(m => ({
      id: m.id,
      name: m.name,
      dimensions: m.dimensions,
      pricePerMTokens: m.pricePerMTokens,
    })),
  }))
}

/**
 * Mapeia tipo do AIProvider (Prisma enum) para a chave do EMBEDDING_PROVIDERS.
 */
export function aiProviderTypeToEmbeddingKey(type: string): string {
  switch (type) {
    case 'OPENAI': return 'openai'
    case 'GEMINI': return 'gemini'
    case 'GITHUB_COPILOT': return 'github_copilot'
    default: return 'openai'
  }
}

/**
 * Constrói EmbeddingConfig a partir de um AIProvider já decriptado.
 * Para GITHUB_COPILOT usa copilotToken/endpoint do oauthData e injeta os
 * headers necessários para o endpoint /embeddings da API do Copilot.
 */
export function buildEmbeddingConfigFromAIProvider(
  aiProvider: { type: string; apiKey: string; baseUrl?: string | null; oauthData?: any },
  model: string,
  fallbackBaseUrl?: string | null,
): EmbeddingConfig {
  const provider = aiProviderTypeToEmbeddingKey(aiProvider.type)

  if (aiProvider.type === 'GITHUB_COPILOT') {
    const oauth = aiProvider.oauthData as any
    const copilotToken = oauth?.copilotToken || aiProvider.apiKey
    const copilotEndpoint = oauth?.copilotEndpoint || aiProvider.baseUrl || EMBEDDING_PROVIDERS.github_copilot.baseUrl
    return {
      provider,
      model,
      apiKey: copilotToken,
      baseUrl: copilotEndpoint,
      extraHeaders: {
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'vscode/1.104.0',
        'Editor-Plugin-Version': 'copilot-chat/0.29.0',
      },
    }
  }

  return {
    provider,
    model,
    apiKey: aiProvider.apiKey,
    baseUrl: aiProvider.baseUrl || fallbackBaseUrl || null,
  }
}
