/**
 * AI Brain â€” Routes (REST)
 *
 * Prefixos efetivos: /api/ai/brain/*
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AIBrainNodeType, AIBrainEdgeType, AIBrainFactCategory } from '@prisma/client'
import { authMiddleware } from '../../../middlewares/auth.middleware.js'
import { requirePermission } from '../../../middlewares/permission.middleware.js'
import * as brain from './brain.service.js'

// ============================================
// Schemas
// ============================================

const subjectQuerySchema = z.object({
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(3).optional(),
  types: z
    .union([z.array(z.nativeEnum(AIBrainNodeType)), z.string()])
    .optional()
    .transform(v => {
      if (!v) return undefined
      if (Array.isArray(v)) return v
      return v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean) as AIBrainNodeType[]
    }),
})

const profileQuerySchema = z.object({
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
})

const globalGraphQuerySchema = z.object({
  limit: z.coerce.number().int().min(10).max(1500).optional(),
  types: z
    .string()
    .optional()
    .transform(v => (v ? (v.split(',').map(s => s.trim()).filter(Boolean) as AIBrainNodeType[]) : undefined)),
})

const factsQuerySchema = z.object({
  contactId: z.string().optional(),
  customerAccountId: z.string().optional(),
  category: z.nativeEnum(AIBrainFactCategory).optional(),
  includeSuperseded: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const factCreateSchema = z.object({
  contactId: z.string().optional(),
  customerAccountId: z.string().optional(),
  agentId: z.string().optional(),
  nodeId: z.string().optional(),
  category: z.nativeEnum(AIBrainFactCategory),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
})

const factSupersedeSchema = z.object({
  newValue: z.string().min(1),
  reason: z.string().optional(),
})

const nodeCreateSchema = z.object({
  type: z.nativeEnum(AIBrainNodeType),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  label: z.string().min(1),
  summary: z.string().optional(),
  metadata: z.any().optional(),
  agentId: z.string().optional(),
})

const edgeCreateSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: z.nativeEnum(AIBrainEdgeType),
  weight: z.number().min(0).max(1).optional(),
  metadata: z.any().optional(),
})

// ============================================
// Routes
// ============================================

export async function brainRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ---- Perfil 360Â° ----
  fastify.get(
    '/profile',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request, reply) => {
      const q = profileQuerySchema.parse(request.query)
      const companyId = request.user!.companyId
      const data = await brain.getProfile({
        companyId,
        subjectType: q.subjectType,
        subjectId: q.subjectId,
      })
      return data
    },
  )

  // ---- Subgrafo (Cytoscape-friendly) ----
  fastify.get(
    '/graph',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request, reply) => {
      const q = subjectQuerySchema.parse(request.query)
      const companyId = request.user!.companyId
      const data = await brain.getGraph({
        companyId,
        subjectType: q.subjectType,
        subjectId: q.subjectId,
        depth: q.depth,
        types: q.types,
      })
      return data
    },
  )

  // ---- Grafo global da empresa ----
  fastify.get(
    '/graph/global',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request, reply) => {
      const q = globalGraphQuerySchema.parse(request.query)
      const companyId = request.user!.companyId
      const data = await brain.getGlobalGraph({
        companyId,
        limit: q.limit,
        types: q.types,
      })
      return data
    },
  )

  // ---- Sync determinÃ­stico CRM â†’ nodes ----
  fastify.post<{ Params: { contactId: string } }>(
    '/sync/contact/:contactId',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const node = await brain.syncContactNode(companyId, request.params.contactId)
      if (!node) return reply.status(404).send({ error: 'Contato nÃ£o encontrado' })
      return node
    },
  )

  fastify.post<{ Params: { customerAccountId: string } }>(
    '/sync/customer-account/:customerAccountId',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const node = await brain.syncCustomerAccountNode(companyId, request.params.customerAccountId)
      if (!node) return reply.status(404).send({ error: 'Conta nÃ£o encontrada' })
      return node
    },
  )

  // ---- Facts ----
  fastify.get(
    '/facts',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request, reply) => {
      const q = factsQuerySchema.parse(request.query)
      const companyId = request.user!.companyId
      return brain.listFacts({ companyId, ...q })
    },
  )

  fastify.post(
    '/facts',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const body = factCreateSchema.parse(request.body)
      const companyId = request.user!.companyId
      const fact = await brain.createFact({
        companyId,
        ...body,
        sourceType: 'MANUAL',
        sourceRefType: 'manual',
      })
      return fact
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/facts/:id/supersede',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const body = factSupersedeSchema.parse(request.body)
      const companyId = request.user!.companyId
      const fact = await brain.supersedeFact({
        companyId,
        factId: request.params.id,
        newValue: body.newValue,
        reason: body.reason,
      })
      return fact
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/facts/:id',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const result = await brain.deleteFact(companyId, request.params.id)
      return { deleted: result.count }
    },
  )

  // ---- Nodes / Edges (manual) ----
  fastify.post(
    '/nodes',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const body = nodeCreateSchema.parse(request.body)
      const companyId = request.user!.companyId
      return brain.upsertNode({ companyId, ...body })
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/nodes/:id',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const result = await brain.deleteNode(companyId, request.params.id)
      return { deleted: result.count }
    },
  )

  fastify.post(
    '/edges',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const body = edgeCreateSchema.parse(request.body)
      const companyId = request.user!.companyId
      return brain.ensureEdge({ companyId, ...body })
    },
  )

  // ---- Vetorização: backfill (re-indexa todos os fatos da empresa) ----
  fastify.post(
    '/embeddings/backfill',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const { backfillCompanyFacts } = await import('./brain.embedding.js')
      const limit = Math.min(Number((request.query as any)?.limit ?? 1000), 5000)
      const result = await backfillCompanyFacts(companyId, limit)
      return { ok: true, ...result }
    },
  )
}

