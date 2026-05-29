import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import {
  createGoal, listGoals, getGoalById,
  updateGoal, addCheckin, deleteGoal, getGoalSummary,
} from './goal.service.js'
import { GoalStatus, GoalType, GoalMetricType } from '@prisma/client'

const goalCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  type: z.nativeEnum(GoalType).optional(),
  parentId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(), // default = current user
  metricType: z.nativeEnum(GoalMetricType).optional(),
  targetValue: z.number().optional(),
  startValue: z.number().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  weight: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
})

const goalUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.nativeEnum(GoalStatus).optional(),
  type: z.nativeEnum(GoalType).optional(),
  ownerId: z.string().uuid().optional(),
  metricType: z.nativeEnum(GoalMetricType).optional(),
  targetValue: z.number().optional(),
  startValue: z.number().optional(),
  currentValue: z.number().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  weight: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
})

const checkinSchema = z.object({
  value: z.number(),
  note: z.string().max(2000).optional(),
})

export async function goalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── Resumo (dashboard) ──
  fastify.get('/summary', { preHandler: [requirePermission('goals:read')] }, async (request, reply) => {
    const summary = await getGoalSummary(request.user.companyId)
    return reply.send(summary)
  })

  // ── Listar Goals ──
  fastify.get<{ Querystring: { page?: string; limit?: string; parentId?: string; ownerId?: string; status?: string; type?: string; search?: string; topLevel?: string } }>(
    '/', { preHandler: [requirePermission('goals:read')] },
    async (request, reply) => {
      const result = await listGoals({
        companyId: request.user.companyId,
        parentId: request.query.topLevel === 'true' ? null : request.query.parentId,
        ownerId: request.query.ownerId,
        status: request.query.status as GoalStatus | undefined,
        type: request.query.type as GoalType | undefined,
        search: request.query.search,
        page: parseInt(request.query.page || '1'),
        limit: parseInt(request.query.limit || '50'),
      })
      return reply.send(result)
    }
  )

  // ── Obter Goal ──
  fastify.get<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('goals:read')] },
    async (request, reply) => {
      const goal = await getGoalById(request.params.id, request.user.companyId)
      if (!goal) return reply.status(404).send({ error: 'Goal não encontrado' })
      return reply.send(goal)
    }
  )

  // ── Criar Goal ──
  fastify.post('/', { preHandler: [requirePermission('goals:create')] }, async (request, reply) => {
    const body = goalCreateSchema.parse(request.body)
    const goal = await createGoal({
      companyId: request.user.companyId,
      title: body.title,
      description: body.description,
      type: body.type,
      ownerId: body.ownerId || request.user.sub,
      parentId: body.parentId,
      metricType: body.metricType,
      targetValue: body.targetValue,
      startValue: body.startValue,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      weight: body.weight,
      tags: body.tags,
    })
    return reply.status(201).send(goal)
  })

  // ── Atualizar Goal ──
  fastify.put<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('goals:update')] },
    async (request, reply) => {
      const body = goalUpdateSchema.parse(request.body)
      const goal = await updateGoal(request.params.id, request.user.companyId, {
        ...body,
        startDate: body.startDate === null ? null : body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate === null ? null : body.endDate ? new Date(body.endDate) : undefined,
      })
      return reply.send(goal)
    }
  )

  // ── Check-in ──
  fastify.post<{ Params: { id: string } }>(
    '/:id/checkins', { preHandler: [requirePermission('goals:update')] },
    async (request, reply) => {
      const body = checkinSchema.parse(request.body)
      const checkin = await addCheckin(request.params.id, request.user.companyId, request.user.sub, body.value, body.note)
      return reply.status(201).send(checkin)
    }
  )

  // ── Deletar Goal ──
  fastify.delete<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('goals:delete')] },
    async (request, reply) => {
      await deleteGoal(request.params.id, request.user.companyId)
      return reply.send({ success: true })
    }
  )
}
