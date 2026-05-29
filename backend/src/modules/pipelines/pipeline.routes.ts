import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { slugify } from './pipeline.helpers.js'

// ── Schemas ──

const createPipelineSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.string().max(50).default('sales'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isDefault: z.boolean().optional(),
  stages: z.array(z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
    position: z.number().int().min(0).optional(),
    isWon: z.boolean().default(false),
    isLost: z.boolean().default(false),
    rottingDays: z.number().int().positive().optional(),
  })).min(1),
})

const updatePipelineSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  type: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

const createStageSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  position: z.number().int().min(0).optional(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  rottingDays: z.number().int().positive().optional(),
})

const updateStageSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  rottingDays: z.number().int().positive().optional().nullable(),
})

const reorderStagesSchema = z.object({
  stages: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
  })),
})

const pipelineIdParam = z.object({ id: z.string().uuid() })
const stageIdParam = z.object({ id: z.string().uuid(), stageId: z.string().uuid() })

export async function pipelineRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ═══ PIPELINES ═══

  // List pipelines
  fastify.get('/', {
    preHandler: [requirePermission('pipelines:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const pipelines = await prisma.pipeline.findMany({
      where: { companyId: request.user.companyId },
      include: {
        stages: { orderBy: { position: 'asc' } },
        _count: { select: { cards: true } },
      },
      orderBy: { position: 'asc' },
    })
    return reply.send({ pipelines })
  })

  // Get pipeline detail
  fastify.get('/:id', {
    preHandler: [requirePermission('pipelines:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineIdParam.parse(request.params)

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId: request.user.companyId },
      include: {
        stages: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { cards: true } } },
        },
      },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    return reply.send({ pipeline })
  })

  // Create pipeline with stages
  fastify.post('/', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPipelineSchema.parse(request.body)
    const companyId = request.user.companyId

    // If isDefault, unset other defaults
    if (body.isDefault) {
      await prisma.pipeline.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      })
    }

    // Get max position
    const maxPos = await prisma.pipeline.aggregate({
      where: { companyId },
      _max: { position: true },
    })

    const pipeline = await prisma.pipeline.create({
      data: {
        companyId,
        name: body.name,
        description: body.description,
        type: body.type,
        color: body.color,
        isDefault: body.isDefault || false,
        position: (maxPos._max.position ?? -1) + 1,
        stages: {
          create: body.stages.map((s, index) => ({
            companyId,
            name: s.name,
            slug: s.slug || slugify(s.name),
            color: s.color,
            position: s.position ?? index,
            isWon: s.isWon,
            isLost: s.isLost,
            rottingDays: s.rottingDays,
          })),
        },
      },
      include: {
        stages: { orderBy: { position: 'asc' } },
      },
    })

    return reply.status(201).send({ pipeline })
  })

  // Update pipeline
  fastify.put('/:id', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineIdParam.parse(request.params)
    const body = updatePipelineSchema.parse(request.body)
    const companyId = request.user.companyId

    const existing = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    if (body.isDefault) {
      await prisma.pipeline.updateMany({
        where: { companyId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    const pipeline = await prisma.pipeline.update({
      where: { id },
      data: body,
      include: { stages: { orderBy: { position: 'asc' } } },
    })

    return reply.send({ pipeline })
  })

  // Delete pipeline
  fastify.delete('/:id', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineIdParam.parse(request.params)
    const companyId = request.user.companyId

    const existing = await prisma.pipeline.findFirst({
      where: { id, companyId },
      include: { _count: { select: { cards: true } } },
    })
    if (!existing) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    if (existing._count.cards > 0) {
      return reply.status(400).send({
        error: 'Pipeline possui cards. Mova ou delete os cards antes de remover o pipeline.',
      })
    }

    await prisma.pipeline.delete({ where: { id } })
    return reply.send({ success: true })
  })

  // ═══ STAGES ═══

  // Add stage to pipeline
  fastify.post('/:id/stages', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineIdParam.parse(request.params)
    const body = createStageSchema.parse(request.body)
    const companyId = request.user.companyId

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    const stageSlug = body.slug || slugify(body.name)

    // Check unique slug within pipeline
    const existingSlug = await prisma.stage.findUnique({
      where: { pipelineId_slug: { pipelineId: id, slug: stageSlug } },
    })
    if (existingSlug) {
      return reply.status(409).send({ error: `Stage com slug "${stageSlug}" já existe neste pipeline` })
    }

    // Auto-assign position if not provided
    let position = body.position
    if (position === undefined) {
      const maxStagePos = await prisma.stage.aggregate({
        where: { pipelineId: id },
        _max: { position: true },
      })
      position = (maxStagePos._max.position ?? -1) + 1
    }

    const stage = await prisma.stage.create({
      data: {
        pipelineId: id,
        companyId,
        name: body.name,
        slug: stageSlug,
        color: body.color,
        position,
        isWon: body.isWon,
        isLost: body.isLost,
        rottingDays: body.rottingDays,
      },
    })

    return reply.status(201).send({ stage })
  })

  // Update stage
  fastify.put('/:id/stages/:stageId', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, stageId } = stageIdParam.parse(request.params)
    const body = updateStageSchema.parse(request.body)
    const companyId = request.user.companyId

    const existing = await prisma.stage.findFirst({
      where: { id: stageId, pipelineId: id, companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Stage não encontrado' })

    const stage = await prisma.stage.update({
      where: { id: stageId },
      data: body,
    })

    return reply.send({ stage })
  })

  // Delete stage
  fastify.delete('/:id/stages/:stageId', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, stageId } = stageIdParam.parse(request.params)
    const companyId = request.user.companyId

    const existing = await prisma.stage.findFirst({
      where: { id: stageId, pipelineId: id, companyId },
      include: { _count: { select: { cards: true } } },
    })
    if (!existing) return reply.status(404).send({ error: 'Stage não encontrado' })

    if (existing._count.cards > 0) {
      return reply.status(400).send({
        error: 'Stage possui cards. Mova os cards antes de remover o stage.',
      })
    }

    await prisma.stage.delete({ where: { id: stageId } })
    return reply.send({ success: true })
  })

  // Reorder stages
  fastify.put('/:id/stages/reorder', {
    preHandler: [requirePermission('pipelines:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineIdParam.parse(request.params)
    const { stages } = reorderStagesSchema.parse(request.body)
    const companyId = request.user.companyId

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    // Validate all stages belong to this pipeline
    const stageIds = stages.map(s => s.id)
    const existingStages = await prisma.stage.findMany({
      where: { id: { in: stageIds }, pipelineId: id, companyId },
    })
    if (existingStages.length !== stageIds.length) {
      return reply.status(400).send({ error: 'Um ou mais stages não pertencem a este pipeline' })
    }

    await prisma.$transaction(
      stages.map(s =>
        prisma.stage.update({
          where: { id: s.id },
          data: { position: s.position },
        })
      )
    )

    const updatedStages = await prisma.stage.findMany({
      where: { pipelineId: id },
      orderBy: { position: 'asc' },
    })

    return reply.send({ stages: updatedStages })
  })
}
