/**
 * AI Skills Service — Procedural memory vetorizada (playbooks reutilizáveis)
 *
 * Cada skill tem:
 *   - conditions[]: frases que descrevem QUANDO ativar a skill
 *   - instructions: o playbook em si
 *
 * O service vetoriza (name + description + conditions) no Qdrant. Antes de cada
 * chamada ao LLM, busca top-K skills relevantes para a mensagem do usuário e
 * injeta apenas essas no system prompt — economizando tokens vs carregar todos
 * os playbooks sempre.
 *
 * Inspirado em: Hermes Skills System + OpenClaw Memory Layers + Noxus.
 */

import crypto from 'crypto'
import { prisma } from '../../../config/database.js'
import { decryptProviderSecrets } from '../ai.service.js'
import {
  embedQuery,
  embedTexts,
  buildEmbeddingConfigFromAIProvider,
  type EmbeddingConfig,
} from '../rag/embedding.service.js'
import {
  getQdrantClient,
  ensureCollection,
  upsertChunks,
  searchSimilar,
} from '../rag/qdrant.client.js'

// ============================================
// Tipos
// ============================================

export interface SkillInput {
  name: string
  slug?: string
  description?: string
  conditions?: string[]
  instructions: string
  examples?: string
  relatedSkillIds?: string[]
  priority?: number
  tags?: string[]
  isActive?: boolean
  agentId?: string | null // null/undefined = global (todos os agentes da empresa)
}

export interface ActiveSkill {
  id: string
  name: string
  slug: string
  instructions: string
  examples?: string | null
  priority: number
  score?: number // só presente quando ativada por similarity
  alwaysOn: boolean
}

// ============================================
// Helpers
// ============================================

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60)
}

function buildEmbeddingText(skill: {
  name: string
  description?: string | null
  conditions: string[]
  tags?: string[]
}): string {
  const parts = [
    `Skill: ${skill.name}`,
    skill.description ? `Descrição: ${skill.description}` : null,
    skill.conditions.length > 0
      ? `Quando aplicar:\n${skill.conditions.map(c => `- ${c}`).join('\n')}`
      : null,
    skill.tags && skill.tags.length > 0 ? `Tags: ${skill.tags.join(', ')}` : null,
  ].filter(Boolean)
  return parts.join('\n')
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** Nome da coleção Qdrant dedicada para skills da empresa. */
export function getSkillsCollectionName(companyId: string): string {
  return `crm_skills_${companyId.replace(/-/g, '_')}`
}

// ============================================
// Embedding config (reusa o provider de embedding da empresa)
// ============================================

async function resolveCompanyEmbeddingConfig(companyId: string): Promise<{
  config: EmbeddingConfig
  model: string
  providerId: string
} | null> {
  // Procura o provider default da empresa, ou o primeiro ativo compatível
  const provider =
    (await prisma.aIProvider.findFirst({
      where: { companyId, isActive: true, isDefault: true },
    })) ??
    (await prisma.aIProvider.findFirst({
      where: {
        companyId,
        isActive: true,
        type: { in: ['OPENAI', 'GEMINI', 'GITHUB_COPILOT'] },
      },
      orderBy: { createdAt: 'asc' },
    }))

  if (!provider) return null

  const decrypted = decryptProviderSecrets(provider)
  const model =
    decrypted.type === 'GEMINI' ? 'text-embedding-004' : 'text-embedding-3-small'

  return {
    config: buildEmbeddingConfigFromAIProvider(decrypted, model),
    model,
    providerId: provider.id,
  }
}

// ============================================
// Indexação no Qdrant
// ============================================

/**
 * (Re)indexa uma skill no Qdrant. Atualiza qdrantPointId, embeddingHash, indexedAt.
 * Retorna true se indexou, false se pulou (hash inalterado).
 */
export async function indexSkill(skillId: string): Promise<boolean> {
  const skill = await prisma.aIAgentSkill.findUnique({ where: { id: skillId } })
  if (!skill) throw new Error(`Skill ${skillId} não encontrada`)
  if (!skill.isActive) {
    // Se inativa, remove do índice se houver
    if (skill.qdrantPointId) {
      await removeSkillFromIndex(skillId).catch(() => {})
    }
    return false
  }

  const text = buildEmbeddingText({
    name: skill.name,
    description: skill.description,
    conditions: skill.conditions,
    tags: skill.tags,
  })
  const newHash = hashContent(text)

  // Skip se nada mudou
  if (skill.embeddingHash === newHash && skill.qdrantPointId) {
    return false
  }

  const emb = await resolveCompanyEmbeddingConfig(skill.companyId)
  if (!emb) {
    console.warn(`[Skills] Sem provider de embedding configurado para empresa ${skill.companyId}`)
    return false
  }

  const [vector] = await embedTexts([text], emb.config, emb.model, skill.companyId)
  if (!vector || vector.length === 0) {
    throw new Error('Embedding vazio retornado pelo provider')
  }

  const collection = getSkillsCollectionName(skill.companyId)
  await ensureCollection(collection, vector.length)

  const pointId = skill.qdrantPointId || skill.id

  await upsertChunks(collection, [
    {
      id: pointId,
      vector,
      payload: {
        company_id: skill.companyId,
        skill_id: skill.id,
        agent_id: skill.agentId || '__global__',
        name: skill.name,
        slug: skill.slug,
        priority: skill.priority,
        tags: skill.tags,
        is_active: true,
        // payload "content" mantém compat com searchSimilar (que faz cast para string)
        content: text,
      },
    },
  ])

  await prisma.aIAgentSkill.update({
    where: { id: skill.id },
    data: {
      qdrantPointId: pointId,
      embeddingHash: newHash,
      embeddingProviderId: emb.providerId,
      embeddingModel: emb.model,
      indexedAt: new Date(),
    },
  })

  return true
}

/** Remove uma skill do índice Qdrant (mantém o registro no Postgres). */
export async function removeSkillFromIndex(skillId: string): Promise<void> {
  const skill = await prisma.aIAgentSkill.findUnique({ where: { id: skillId } })
  if (!skill || !skill.qdrantPointId) return

  const collection = getSkillsCollectionName(skill.companyId)
  try {
    const qClient = getQdrantClient()
    await qClient.delete(collection, {
      wait: true,
      points: [skill.qdrantPointId],
    })
  } catch (err) {
    console.warn('[Skills] Falha ao remover do Qdrant:', (err as Error).message)
  }

  await prisma.aIAgentSkill.update({
    where: { id: skill.id },
    data: { qdrantPointId: null, embeddingHash: null, indexedAt: null },
  })
}

// ============================================
// Busca semântica de skills relevantes
// ============================================

/**
 * Retorna skills ativas para usar no prompt de uma chamada específica:
 *   1. Always-on: skills com priority >= 100 (carrega sempre)
 *   2. Top-K relevantes: busca semântica pela mensagem do usuário
 *
 * Combina skills GLOBAIS da empresa (agentId=null) com as ESPECÍFICAS do agente.
 */
export async function selectActiveSkills(params: {
  companyId: string
  agentId: string
  userMessage: string
  topK?: number
  scoreThreshold?: number
  maxAlwaysOn?: number
}): Promise<ActiveSkill[]> {
  const {
    companyId,
    agentId,
    userMessage,
    topK = 3,
    scoreThreshold = 0.55,
    maxAlwaysOn = 5,
  } = params

  // 1. Always-on: priority >= 100 (do agente OU globais da empresa)
  const alwaysOnRows = await prisma.aIAgentSkill.findMany({
    where: {
      companyId,
      isActive: true,
      priority: { gte: 100 },
      OR: [{ agentId }, { agentId: null }],
    },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    take: maxAlwaysOn,
  })

  const alwaysOn: ActiveSkill[] = alwaysOnRows.map(s => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    instructions: s.instructions,
    examples: s.examples,
    priority: s.priority,
    alwaysOn: true,
  }))

  // 2. Vector search (skip se mensagem vazia)
  const trimmed = userMessage.trim()
  if (!trimmed || topK <= 0) return alwaysOn

  let semantic: ActiveSkill[] = []
  try {
    const emb = await resolveCompanyEmbeddingConfig(companyId)
    if (!emb) return alwaysOn

    const vector = await embedQuery(trimmed, emb.config, emb.model, companyId)
    if (!vector || vector.length === 0) return alwaysOn

    const collection = getSkillsCollectionName(companyId)
    const qClient = getQdrantClient()

    // Filtra por agentId atual OU global, e is_active=true
    const results = await qClient.search(collection, {
      vector,
      limit: topK * 3, // pega mais e filtra por DB depois (skills inativas no DB são ignoradas)
      score_threshold: scoreThreshold,
      filter: {
        must: [
          { key: 'company_id', match: { value: companyId } },
          { key: 'is_active', match: { value: true } },
        ],
        should: [
          { key: 'agent_id', match: { value: agentId } },
          { key: 'agent_id', match: { value: '__global__' } },
        ],
      },
      with_payload: true,
    })

    if (results.length === 0) return alwaysOn

    const candidateIds = results
      .map(r => (r.payload?.skill_id as string) || (typeof r.id === 'string' ? r.id : null))
      .filter(Boolean) as string[]

    // Carrega instruções completas + valida ativas + dedupe contra always-on
    const alwaysOnIds = new Set(alwaysOn.map(s => s.id))
    const dbSkills = await prisma.aIAgentSkill.findMany({
      where: {
        id: { in: candidateIds },
        isActive: true,
        // Reforça filtro de escopo: agente atual ou global da empresa
        OR: [{ agentId }, { agentId: null }],
        companyId,
      },
    })

    const skillById = new Map(dbSkills.map(s => [s.id, s]))
    const seen = new Set<string>(alwaysOnIds)
    semantic = []
    for (const r of results) {
      const sid =
        (r.payload?.skill_id as string) || (typeof r.id === 'string' ? r.id : '')
      if (!sid || seen.has(sid)) continue
      const sk = skillById.get(sid)
      if (!sk) continue
      seen.add(sid)
      semantic.push({
        id: sk.id,
        name: sk.name,
        slug: sk.slug,
        instructions: sk.instructions,
        examples: sk.examples,
        priority: sk.priority,
        score: r.score,
        alwaysOn: false,
      })
      if (semantic.length >= topK) break
    }
  } catch (err) {
    console.warn('[Skills] Vector search falhou, usando só always-on:', (err as Error).message)
  }

  return [...alwaysOn, ...semantic]
}

/**
 * Marca skills como "usadas" (incrementa hitCount) — fire-and-forget.
 */
export async function markSkillsUsed(skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return
  try {
    await prisma.aIAgentSkill.updateMany({
      where: { id: { in: skillIds } },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    })
  } catch (err) {
    console.warn('[Skills] Falha ao registrar hit:', (err as Error).message)
  }
}

/**
 * Formata as skills ativas para injeção no system prompt.
 * Layout otimizado para prompt cache: skills sempre na MESMA ORDEM
 * (priority desc, depois alfabética) — mantém o prefix idêntico entre runs.
 */
export function formatSkillsForPrompt(skills: ActiveSkill[]): string {
  if (skills.length === 0) return ''

  // Ordenação determinística (cacheable)
  const sorted = [...skills].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.slug.localeCompare(b.slug)
  })

  const blocks = sorted.map(s => {
    const parts: string[] = [`### ${s.name}`]
    parts.push(s.instructions.trim())
    if (s.examples && s.examples.trim()) {
      parts.push(`\nExemplos:\n${s.examples.trim()}`)
    }
    return parts.join('\n')
  })

  return `<active_skills>
Você tem os seguintes playbooks ATIVOS para esta interação. Siga as instruções deles quando aplicável (eles foram selecionados automaticamente com base no contexto da conversa).

${blocks.join('\n\n---\n\n')}
</active_skills>`
}

// ============================================
// CRUD
// ============================================

export async function createSkill(companyId: string, input: SkillInput) {
  const slug = (input.slug && slugify(input.slug)) || slugify(input.name)
  if (!slug) throw new Error('Slug inválido')

  const skill = await prisma.aIAgentSkill.create({
    data: {
      companyId,
      agentId: input.agentId ?? null,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      conditions: (input.conditions || []).map(c => c.trim()).filter(Boolean),
      instructions: input.instructions.trim(),
      examples: input.examples?.trim() || null,
      relatedSkillIds: input.relatedSkillIds || [],
      priority: input.priority ?? 0,
      tags: (input.tags || []).map(t => t.trim()).filter(Boolean),
      isActive: input.isActive ?? true,
    },
  })

  // Indexar em background (não bloqueia o response)
  indexSkill(skill.id).catch(err =>
    console.warn(`[Skills] indexSkill ${skill.id} falhou:`, (err as Error).message)
  )

  return skill
}

export async function updateSkill(skillId: string, companyId: string, input: Partial<SkillInput>) {
  const existing = await prisma.aIAgentSkill.findFirst({ where: { id: skillId, companyId } })
  if (!existing) throw new Error('Skill não encontrada')

  const data: any = {}
  if (input.name !== undefined) data.name = input.name.trim()
  if (input.slug !== undefined) data.slug = slugify(input.slug)
  if (input.description !== undefined) data.description = input.description?.trim() || null
  if (input.conditions !== undefined)
    data.conditions = (input.conditions || []).map(c => c.trim()).filter(Boolean)
  if (input.instructions !== undefined) data.instructions = input.instructions.trim()
  if (input.examples !== undefined) data.examples = input.examples?.trim() || null
  if (input.relatedSkillIds !== undefined) data.relatedSkillIds = input.relatedSkillIds
  if (input.priority !== undefined) data.priority = input.priority
  if (input.tags !== undefined) data.tags = (input.tags || []).map(t => t.trim()).filter(Boolean)
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.agentId !== undefined) data.agentId = input.agentId

  const updated = await prisma.aIAgentSkill.update({
    where: { id: skillId },
    data,
  })

  // Re-indexar em background
  indexSkill(updated.id).catch(err =>
    console.warn(`[Skills] reindexSkill ${updated.id} falhou:`, (err as Error).message)
  )

  return updated
}

export async function deleteSkill(skillId: string, companyId: string) {
  const existing = await prisma.aIAgentSkill.findFirst({ where: { id: skillId, companyId } })
  if (!existing) throw new Error('Skill não encontrada')

  // Remove do Qdrant antes do DB
  await removeSkillFromIndex(skillId).catch(() => {})
  await prisma.aIAgentSkill.delete({ where: { id: skillId } })
}

export async function listSkills(companyId: string, opts?: { agentId?: string | null; includeGlobal?: boolean }) {
  const where: any = { companyId }
  if (opts?.agentId !== undefined) {
    if (opts.includeGlobal) {
      where.OR = [{ agentId: opts.agentId }, { agentId: null }]
    } else {
      where.agentId = opts.agentId
    }
  }
  return prisma.aIAgentSkill.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
  })
}

export async function getSkill(skillId: string, companyId: string) {
  return prisma.aIAgentSkill.findFirst({ where: { id: skillId, companyId } })
}

/**
 * Re-indexa todas as skills da empresa (útil em manutenção / após troca de embedding).
 */
export async function reindexAllSkills(companyId: string): Promise<{ indexed: number; skipped: number; failed: number }> {
  const skills = await prisma.aIAgentSkill.findMany({
    where: { companyId, isActive: true },
    select: { id: true },
  })

  let indexed = 0
  let skipped = 0
  let failed = 0
  for (const s of skills) {
    try {
      const ok = await indexSkill(s.id)
      if (ok) indexed++
      else skipped++
    } catch {
      failed++
    }
  }
  return { indexed, skipped, failed }
}
