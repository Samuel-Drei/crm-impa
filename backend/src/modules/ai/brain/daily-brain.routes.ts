/**
 * Daily Brain Digest — Routes
 *
 * Prefixo efetivo: /api/ai/daily-brain
 *
 * Endpoints:
 *   GET    /digests              → lista últimos 30 digests da empresa
 *   GET    /digests/:date        → detalhe de uma data específica (YYYY-MM-DD)
 *   POST   /run                  → trigger manual { date?: YYYY-MM-DD } (default = ontem)
 *   POST   /toggle               → habilita/desabilita digest pra empresa { enabled: boolean }
 *   GET    /status               → flags + métricas resumo
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../../middlewares/auth.middleware.js'
import { requirePermission } from '../../../middlewares/permission.middleware.js'
import { prisma } from '../../../config/database.js'
import { enqueueDailyBrain } from '../../../queues/daily-brain.queue.js'
import { yesterdayInTz } from './brain-digest.service.js'
import { EMBEDDING_PROVIDERS, aiProviderTypeToEmbeddingKey } from '../rag/embedding.service.js'
import { ensureDailyBrainKB } from './brain-persist.service.js'

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const runSchema = z.object({
  date: z.string().regex(dateRegex).optional(),
})

const toggleSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().optional(),
})

const settingsSchema = z.object({
  hour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).max(64).optional(),
  embeddingProviderId: z.string().nullable().optional(),
  embeddingModel: z.string().nullable().optional(),
})

export async function dailyBrainRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ---- Listagem de digests ----
  fastify.get(
    '/digests',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request) => {
      const companyId = request.user!.companyId
      const digests = await prisma.aIDailyDigest.findMany({
        where: { companyId },
        orderBy: { date: 'desc' },
        take: 60,
      })
      return { digests }
    },
  )

  fastify.get<{ Params: { date: string } }>(
    '/digests/:date',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const { date } = request.params
      if (!dateRegex.test(date)) {
        return reply.status(400).send({ error: 'Formato esperado YYYY-MM-DD' })
      }
      const digest = await prisma.aIDailyDigest.findUnique({
        where: { companyId_date: { companyId, date } },
      })
      if (!digest) return reply.status(404).send({ error: 'Digest não encontrado' })
      return digest
    },
  )

  // ---- Trigger manual ----
  fastify.post(
    '/run',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const body = runSchema.parse(request.body || {})

      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { dailyBrainTimezone: true },
      })
      const tz = company?.dailyBrainTimezone || 'America/Sao_Paulo'
      const date = body.date || yesterdayInTz(tz)

      try {
        await enqueueDailyBrain(companyId, date, 'manual')
        return reply.status(202).send({ enqueued: true, companyId, date })
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message })
      }
    },
  )

  // ---- Toggle ----
  fastify.post(
    '/toggle',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request) => {
      const companyId = request.user!.companyId
      const body = toggleSchema.parse(request.body)

      const updated = await prisma.company.update({
        where: { id: companyId },
        data: {
          dailyBrainEnabled: body.enabled,
          ...(body.timezone ? { dailyBrainTimezone: body.timezone } : {}),
        },
        select: { dailyBrainEnabled: true, dailyBrainTimezone: true },
      })
      return updated
    },
  )

  // ---- Status / dashboard ----
  fastify.get(
    '/status',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request) => {
      const companyId = request.user!.companyId
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: {
          dailyBrainEnabled: true,
          dailyBrainTimezone: true,
          dailyBrainHour: true,
          dailyBrainEmbeddingProviderId: true,
          dailyBrainEmbeddingModel: true,
        },
      })

      const [last, totalContacts, totalFacts, kb, embeddingProvider] = await Promise.all([
        prisma.aIDailyDigest.findFirst({
          where: { companyId },
          orderBy: { date: 'desc' },
        }),
        prisma.aIBrainNode.count({ where: { companyId, type: 'CONTACT' } }),
        prisma.aIBrainFact.count({
          where: { companyId, sourceType: 'daily_digest', validTo: null },
        }),
        prisma.aIKnowledgeBase.findFirst({
          where: { companyId, name: '__daily_brain__' },
          select: { id: true, totalChunks: true, totalTokens: true, embeddingModel: true },
        }),
        company?.dailyBrainEmbeddingProviderId
          ? prisma.aIProvider.findFirst({
              where: { id: company.dailyBrainEmbeddingProviderId, companyId },
              select: { id: true, name: true, type: true },
            })
          : Promise.resolve(null),
      ])

      return {
        enabled: company?.dailyBrainEnabled ?? true,
        timezone: company?.dailyBrainTimezone || 'America/Sao_Paulo',
        hour: company?.dailyBrainHour ?? 2,
        embeddingProviderId: company?.dailyBrainEmbeddingProviderId || null,
        embeddingModel: company?.dailyBrainEmbeddingModel || null,
        embeddingProvider,
        lastRun: last,
        totalContactsInBrain: totalContacts,
        totalFactsFromDigest: totalFacts,
        knowledgeBase: kb,
      }
    },
  )

  // ---- Settings (hora + timezone + embedding override) ----
  fastify.patch(
    '/settings',
    { preHandler: [requirePermission('ai_brain:manage')] },
    async (request, reply) => {
      const companyId = request.user!.companyId
      const body = settingsSchema.parse(request.body)

      // Valida embedding provider/model se enviados
      if (body.embeddingProviderId) {
        const prov = await prisma.aIProvider.findFirst({
          where: { id: body.embeddingProviderId, companyId, isActive: true },
          select: { id: true, type: true },
        })
        if (!prov) {
          return reply.status(400).send({ error: 'Provider de embedding inválido ou não pertence à empresa' })
        }
        if (body.embeddingModel) {
          const key = aiProviderTypeToEmbeddingKey(prov.type)
          const cfg = (EMBEDDING_PROVIDERS as any)[key]
          const ok = cfg?.models?.some((m: any) => m.id === body.embeddingModel)
          if (!ok) {
            return reply.status(400).send({ error: `Modelo ${body.embeddingModel} não disponível para o provider ${key}` })
          }
        }
      }

      const data: Record<string, unknown> = {}
      if (typeof body.hour === 'number') data.dailyBrainHour = body.hour
      if (body.timezone) data.dailyBrainTimezone = body.timezone
      if (body.embeddingProviderId !== undefined) data.dailyBrainEmbeddingProviderId = body.embeddingProviderId
      if (body.embeddingModel !== undefined) data.dailyBrainEmbeddingModel = body.embeddingModel

      const updated = await prisma.company.update({
        where: { id: companyId },
        data,
        select: {
          dailyBrainEnabled: true,
          dailyBrainTimezone: true,
          dailyBrainHour: true,
          dailyBrainEmbeddingProviderId: true,
          dailyBrainEmbeddingModel: true,
        },
      })

      // Sincroniza KB do Daily Brain imediatamente caso provider/modelo tenha mudado.
      // Sem isso, o ajuste só seria refletido na próxima execução do digest.
      if (body.embeddingProviderId !== undefined || body.embeddingModel !== undefined) {
        try {
          await ensureDailyBrainKB(companyId)
        } catch (err) {
          request.log.warn({ err }, '[DailyBrain] Falha ao sincronizar KB após PATCH /settings')
        }
      }

      return updated
    },
  )

  // ---- Lista de providers + modelos disponíveis para embedding ----
  fastify.get(
    '/embedding-options',
    { preHandler: [requirePermission('ai_brain:read')] },
    async (request) => {
      const companyId = request.user!.companyId
      const providers = await prisma.aIProvider.findMany({
        where: {
          companyId,
          isActive: true,
          type: { in: ['OPENAI', 'GEMINI', 'GITHUB_COPILOT'] },
        },
        select: { id: true, name: true, type: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      })

      const items = providers.map(p => {
        const key = aiProviderTypeToEmbeddingKey(p.type)
        const cfg = (EMBEDDING_PROVIDERS as any)[key]
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          isDefault: p.isDefault,
          embeddingKey: key,
          providerLabel: cfg?.name || key,
          models: (cfg?.models || []).map((m: any) => ({
            id: m.id,
            name: m.name,
            dimensions: m.dimensions,
            pricePerMTokens: m.pricePerMTokens,
          })),
        }
      })

      return { providers: items }
    },
  )
}
