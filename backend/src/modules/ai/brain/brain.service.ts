/**
 * AI Brain Service — Perfil 360° + Grafo vetorizado por contato/empresa
 *
 * Responsabilidades:
 *  - CRUD de nodes/edges/facts
 *  - Sync determinístico CRM → nodes (contatos, empresas)
 *  - Extração leve a partir de uma sessão IA (heurística sem LLM,
 *    o enriquecimento via LLM acontece em memory.service)
 *  - Construção de grafo (subgrafo por subjectId ou global)
 *  - Bloco "What I know" para injeção no system prompt
 */

import { prisma } from '../../../config/database.js'
import type {
  AIBrainNodeType,
  AIBrainEdgeType,
  AIBrainFactCategory,
  Prisma,
} from '@prisma/client'
import {
  indexFact as embedIndexFact,
  markFactInactive as embedMarkFactInactive,
  removeFactFromIndex as embedRemoveFactFromIndex,
  searchSimilarFactIds,
} from './brain.embedding.js'

// ============================================
// Tipos públicos
// ============================================

export interface GraphNode {
  id: string
  label: string
  type: AIBrainNodeType
  size: number
  color: string
  metadata?: any
  subjectType?: string | null
  subjectId?: string | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: AIBrainEdgeType
  weight: number
  label?: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rootId?: string
}

const COLOR_BY_TYPE: Record<AIBrainNodeType, string> = {
  CONTACT: '#60a5fa',         // azul
  COMPANY: '#e5e7eb',         // branco
  TOPIC: '#34d399',           // verde
  FACT: '#fbbf24',            // âmbar
  PREFERENCE: '#f472b6',      // rosa
  OBJECTION: '#f87171',       // vermelho
  EVENT: '#a78bfa',           // roxo
  DOCUMENT_CHUNK: '#94a3b8',  // cinza
  SESSION: '#22d3ee',         // ciano
}

// ============================================
// Helpers
// ============================================

function colorFor(type: AIBrainNodeType): string {
  return COLOR_BY_TYPE[type] || '#9ca3af'
}

function clampWeight(w?: number): number {
  if (w === undefined || w === null || isNaN(w)) return 1
  return Math.max(0, Math.min(1, w))
}

// ============================================
// CRUD básico
// ============================================

export async function upsertNode(params: {
  companyId: string
  agentId?: string | null
  type: AIBrainNodeType
  subjectType?: string | null
  subjectId?: string | null
  label: string
  summary?: string | null
  metadata?: any
}) {
  const { companyId, type, subjectType, subjectId, label, summary, metadata, agentId } = params

  if (subjectType && subjectId) {
    const existing = await prisma.aIBrainNode.findFirst({
      where: { companyId, subjectType, subjectId, type },
    })
    if (existing) {
      return prisma.aIBrainNode.update({
        where: { id: existing.id },
        data: {
          label,
          summary: summary ?? existing.summary,
          metadata: (metadata ?? existing.metadata) as Prisma.InputJsonValue,
          lastSeenAt: new Date(),
          agentId: agentId ?? existing.agentId,
        },
      })
    }
  }

  return prisma.aIBrainNode.create({
    data: {
      companyId,
      agentId: agentId ?? null,
      type,
      subjectType: subjectType ?? null,
      subjectId: subjectId ?? null,
      label,
      summary: summary ?? null,
      metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

export async function ensureEdge(params: {
  companyId: string
  fromId: string
  toId: string
  type: AIBrainEdgeType
  weight?: number
  sourceSessionId?: string | null
  sourceMessageId?: string | null
  sourceDocumentId?: string | null
  metadata?: any
}) {
  const { companyId, fromId, toId, type, weight } = params
  if (fromId === toId) return null

  const existing = await prisma.aIBrainEdge.findFirst({
    where: { companyId, fromId, toId, type, validTo: null },
  })

  if (existing) {
    return prisma.aIBrainEdge.update({
      where: { id: existing.id },
      data: {
        weight: clampWeight((existing.weight + (weight ?? 1)) / 2),
        sourceSessionId: params.sourceSessionId ?? existing.sourceSessionId,
        sourceMessageId: params.sourceMessageId ?? existing.sourceMessageId,
        sourceDocumentId: params.sourceDocumentId ?? existing.sourceDocumentId,
      },
    })
  }

  return prisma.aIBrainEdge.create({
    data: {
      companyId,
      fromId,
      toId,
      type,
      weight: clampWeight(weight ?? 1),
      sourceSessionId: params.sourceSessionId ?? null,
      sourceMessageId: params.sourceMessageId ?? null,
      sourceDocumentId: params.sourceDocumentId ?? null,
      metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

export async function createFact(params: {
  companyId: string
  contactId?: string | null
  customerAccountId?: string | null
  agentId?: string | null
  nodeId?: string | null
  category: AIBrainFactCategory
  subject: string
  predicate: string
  value: string
  confidence?: number
  sourceType: 'LLM' | 'MANUAL' | 'CRM_SYNC' | 'RAG'
  sourceRefType?: string | null
  sourceRefId?: string | null
  metadata?: any
}) {
  const fact = await prisma.aIBrainFact.create({
    data: {
      companyId: params.companyId,
      contactId: params.contactId ?? null,
      customerAccountId: params.customerAccountId ?? null,
      agentId: params.agentId ?? null,
      nodeId: params.nodeId ?? null,
      category: params.category,
      subject: params.subject,
      predicate: params.predicate,
      value: params.value,
      confidence: clampWeight(params.confidence ?? 0.7),
      sourceType: params.sourceType,
      sourceRefType: params.sourceRefType ?? null,
      sourceRefId: params.sourceRefId ?? null,
      metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })

  // Indexa no Qdrant em background — falha silenciosa
  void embedIndexFact(fact.companyId, {
    id: fact.id,
    category: fact.category,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    contactId: fact.contactId,
    customerAccountId: fact.customerAccountId,
  })

  return fact
}

export async function supersedeFact(params: {
  companyId: string
  factId: string
  newValue: string
  reason?: string
}) {
  const old = await prisma.aIBrainFact.findFirst({
    where: { id: params.factId, companyId: params.companyId },
  })
  if (!old) throw new Error('Fato não encontrado')

  const replacement = await prisma.aIBrainFact.create({
    data: {
      companyId: old.companyId,
      contactId: old.contactId,
      customerAccountId: old.customerAccountId,
      agentId: old.agentId,
      nodeId: old.nodeId,
      category: old.category,
      subject: old.subject,
      predicate: old.predicate,
      value: params.newValue,
      confidence: old.confidence,
      sourceType: 'MANUAL',
      sourceRefType: 'manual',
      sourceRefId: null,
      metadata: ({ supersedesReason: params.reason ?? null } as Prisma.InputJsonValue),
    },
  })

  await prisma.aIBrainFact.update({
    where: { id: old.id },
    data: { validTo: new Date(), supersededById: replacement.id },
  })

  // Atualiza índice vetorial: marca antigo como inativo + indexa o novo
  void embedMarkFactInactive(old.companyId, old.id)
  void embedIndexFact(replacement.companyId, {
    id: replacement.id,
    category: replacement.category,
    subject: replacement.subject,
    predicate: replacement.predicate,
    value: replacement.value,
    contactId: replacement.contactId,
    customerAccountId: replacement.customerAccountId,
  })

  return replacement
}

// ============================================
// Sync determinístico CRM → nodes
// ============================================

export async function syncContactNode(companyId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, companyId },
    select: { id: true, name: true, phoneNumber: true, email: true, organizationId: true },
  })
  if (!contact) return null

  const node = await upsertNode({
    companyId,
    type: 'CONTACT',
    subjectType: 'contact',
    subjectId: contact.id,
    label: contact.name || contact.phoneNumber || 'Contato',
    metadata: { phone: contact.phoneNumber, email: contact.email },
  })

  if (contact.organizationId) {
    const org = await prisma.organization.findFirst({
      where: { id: contact.organizationId, companyId },
      select: { id: true, name: true },
    })
    if (org) {
      const orgNode = await upsertNode({
        companyId,
        type: 'COMPANY',
        subjectType: 'organization',
        subjectId: org.id,
        label: org.name,
      })
      await ensureEdge({ companyId, fromId: node.id, toId: orgNode.id, type: 'WORKS_AT' })
    }
  }

  return node
}

export async function syncCustomerAccountNode(companyId: string, customerAccountId: string) {
  const acc = await prisma.customerAccount.findFirst({
    where: { id: customerAccountId, companyId },
    select: { id: true, billingName: true, billingEmail: true, accountType: true },
  })
  if (!acc) return null

  return upsertNode({
    companyId,
    type: 'COMPANY',
    subjectType: 'customerAccount',
    subjectId: acc.id,
    label: acc.billingName || 'Conta',
    metadata: { email: acc.billingEmail, type: acc.accountType },
  })
}

// ============================================
// Subgrafo para visualização (Cytoscape-friendly)
// ============================================

export async function getGraph(params: {
  companyId: string
  subjectType: string
  subjectId: string
  depth?: number
  types?: AIBrainNodeType[]
}): Promise<GraphPayload> {
  const depth = Math.min(Math.max(params.depth ?? 2, 1), 3)

  const root = await prisma.aIBrainNode.findFirst({
    where: {
      companyId: params.companyId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
    },
  })
  if (!root) return { nodes: [], edges: [] }

  const nodeMap = new Map<string, typeof root>()
  const edgeMap = new Map<string, any>()
  nodeMap.set(root.id, root)

  let frontier: string[] = [root.id]
  for (let d = 0; d < depth; d++) {
    if (frontier.length === 0) break
    const edges = await prisma.aIBrainEdge.findMany({
      where: {
        companyId: params.companyId,
        validTo: null,
        OR: [{ fromId: { in: frontier } }, { toId: { in: frontier } }],
      },
      take: 500,
    })

    const nextIds = new Set<string>()
    for (const e of edges) {
      if (!edgeMap.has(e.id)) edgeMap.set(e.id, e)
      if (!nodeMap.has(e.fromId)) nextIds.add(e.fromId)
      if (!nodeMap.has(e.toId)) nextIds.add(e.toId)
    }

    if (nextIds.size === 0) break
    const newNodes = await prisma.aIBrainNode.findMany({
      where: {
        companyId: params.companyId,
        id: { in: Array.from(nextIds) },
        ...(params.types && params.types.length > 0 ? { type: { in: params.types } } : {}),
      },
      take: 500,
    })
    for (const n of newNodes) nodeMap.set(n.id, n)
    frontier = newNodes.map(n => n.id)
  }

  // tamanho ~ grau
  const degree = new Map<string, number>()
  for (const e of edgeMap.values()) {
    degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1)
    degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1)
  }

  const nodes: GraphNode[] = Array.from(nodeMap.values()).map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    size: 10 + Math.min(40, (degree.get(n.id) ?? 1) * 4),
    color: colorFor(n.type),
    metadata: n.metadata,
    subjectType: n.subjectType,
    subjectId: n.subjectId,
  }))

  const edges: GraphEdge[] = Array.from(edgeMap.values())
    .filter(e => nodeMap.has(e.fromId) && nodeMap.has(e.toId))
    .map(e => ({
      id: e.id,
      source: e.fromId,
      target: e.toId,
      type: e.type,
      weight: e.weight,
      label: e.type,
    }))

  return { nodes, edges, rootId: root.id }
}

export async function getGlobalGraph(params: {
  companyId: string
  limit?: number
  types?: AIBrainNodeType[]
}): Promise<GraphPayload> {
  const limit = Math.min(params.limit ?? 500, 1500)

  const nodes = await prisma.aIBrainNode.findMany({
    where: {
      companyId: params.companyId,
      ...(params.types && params.types.length > 0 ? { type: { in: params.types } } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
  })

  const ids = nodes.map(n => n.id)
  const edges = await prisma.aIBrainEdge.findMany({
    where: {
      companyId: params.companyId,
      validTo: null,
      fromId: { in: ids },
      toId: { in: ids },
    },
    take: limit * 4,
  })

  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1)
    degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1)
  }

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type,
      size: 10 + Math.min(40, (degree.get(n.id) ?? 1) * 3),
      color: colorFor(n.type),
      metadata: n.metadata,
      subjectType: n.subjectType,
      subjectId: n.subjectId,
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.fromId,
      target: e.toId,
      type: e.type,
      weight: e.weight,
      label: e.type,
    })),
  }
}

// ============================================
// Perfil 360° (Resumo + Fatos + Conexões)
// ============================================

export async function getProfile(params: {
  companyId: string
  subjectType: string
  subjectId: string
}) {
  const node = await prisma.aIBrainNode.findFirst({
    where: {
      companyId: params.companyId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
    },
  })

  const facts = await prisma.aIBrainFact.findMany({
    where: {
      companyId: params.companyId,
      validTo: null,
      OR: [
        params.subjectType === 'contact' ? { contactId: params.subjectId } : {},
        params.subjectType === 'customerAccount' ? { customerAccountId: params.subjectId } : {},
      ].filter(o => Object.keys(o).length > 0),
    },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  })

  const learnedToday = facts.filter(
    f => f.createdAt >= new Date(Date.now() - 24 * 60 * 60 * 1000),
  )

  let connectionsCount = 0
  if (node) {
    connectionsCount = await prisma.aIBrainEdge.count({
      where: {
        companyId: params.companyId,
        validTo: null,
        OR: [{ fromId: node.id }, { toId: node.id }],
      },
    })
  }

  return {
    node,
    facts,
    learnedToday,
    connectionsCount,
  }
}

// ============================================
// Bloco "What I know" para system prompt
// ============================================

export async function buildKnowledgeBlock(params: {
  companyId: string
  contactId?: string
  customerAccountId?: string
  limit?: number
  /** Mensagem atual do usuário — habilita busca semântica vetorial */
  query?: string | null
}): Promise<string | null> {
  const limit = params.limit ?? 12
  const where: Prisma.AIBrainFactWhereInput = {
    companyId: params.companyId,
    validTo: null,
  }
  if (params.contactId) where.contactId = params.contactId
  if (params.customerAccountId) where.customerAccountId = params.customerAccountId

  let facts: Awaited<ReturnType<typeof prisma.aIBrainFact.findMany>> = []

  // Caminho 1: busca semântica vetorial (quando há query e Qdrant disponível)
  if (params.query && params.query.trim().length >= 3) {
    const hits = await searchSimilarFactIds(params.companyId, params.query, {
      contactId: params.contactId ?? null,
      customerAccountId: params.customerAccountId ?? null,
      topK: limit,
    })
    if (hits.length > 0) {
      const ids = hits.map(h => h.factId)
      const found = await prisma.aIBrainFact.findMany({
        where: { ...where, id: { in: ids } },
      })
      // mantém ordem de relevância vetorial
      const order = new Map(ids.map((id, i) => [id, i]))
      facts = found.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    }
  }

  // Caminho 2 (fallback): ranking estruturado por confidence + recência
  if (facts.length === 0) {
    facts = await prisma.aIBrainFact.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    })
  }

  if (facts.length === 0) return null

  const lines = facts.map(f => `- [${f.category}] ${f.subject} ${f.predicate} ${f.value}`)
  return ['=== O QUE SEI SOBRE ESTE CONTATO ===', ...lines, '=== FIM ==='].join('\n')
}

// ============================================
// Listagens auxiliares
// ============================================

export async function listFacts(params: {
  companyId: string
  contactId?: string
  customerAccountId?: string
  category?: AIBrainFactCategory
  includeSuperseded?: boolean
  page?: number
  limit?: number
}) {
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 50, 200)

  const where: Prisma.AIBrainFactWhereInput = {
    companyId: params.companyId,
  }
  if (!params.includeSuperseded) where.validTo = null
  if (params.contactId) where.contactId = params.contactId
  if (params.customerAccountId) where.customerAccountId = params.customerAccountId
  if (params.category) where.category = params.category

  const [records, total] = await Promise.all([
    prisma.aIBrainFact.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.aIBrainFact.count({ where }),
  ])

  return { records, total, page, limit, totalPages: Math.ceil(total / limit) }
}

export async function deleteFact(companyId: string, factId: string) {
  void embedRemoveFactFromIndex(companyId, factId)
  return prisma.aIBrainFact.deleteMany({ where: { id: factId, companyId } })
}

export async function deleteNode(companyId: string, nodeId: string) {
  return prisma.aIBrainNode.deleteMany({ where: { id: nodeId, companyId } })
}
