import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'

const automationActionSchema = z.object({
  actionName: z.enum([
    'assign_agent',
    'assign_team',
    'add_label',
    'remove_label',
    'change_status',
    'change_priority',
    'send_message',
    'mute_conversation',
    'create_pipeline_card',
  ]),
  actionParams: z.array(z.any()),
})

const automationConditionSchema = z.object({
  attributeKey: z.string(),
  filterOperator: z.enum([
    'equal_to',
    'not_equal_to',
    'contains',
    'does_not_contain',
    'is_present',
    'is_not_present',
  ]),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])),
  queryOperator: z.enum(['AND', 'OR']).optional(),
})

const createAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  eventName: z.enum([
    'conversation_created',
    'conversation_updated',
    'message_created',
    'conversation_opened',
  ]),
  conditions: z.array(automationConditionSchema),
  actions: z.array(automationActionSchema),
  isActive: z.boolean().default(true),
})

const updateAutomationSchema = createAutomationSchema.partial()

const automationIdSchema = z.object({
  automationId: z.string().uuid(),
})

export async function conversationAutomationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List conversation automations
  fastify.get('/', { preHandler: [requirePermission('automations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const automations = await prisma.conversationAutomation.findMany({
      where: { companyId: request.user.companyId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ automations })
  })

  // Create conversation automation
  fastify.post('/', { preHandler: [requirePermission('automations:manage'), enforcePlanLimit('maxAutomations')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createAutomationSchema.parse(request.body)

    const automation = await prisma.conversationAutomation.create({
      data: {
        name: body.name,
        description: body.description,
        eventName: body.eventName,
        conditions: body.conditions as any,
        actions: body.actions as any,
        isActive: body.isActive,
        companyId: request.user.companyId,
      },
    })

    return reply.status(201).send({ automation })
  })

  // Get single automation
  fastify.get('/:automationId', { preHandler: [requirePermission('automations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { automationId } = automationIdSchema.parse(request.params)

    const automation = await prisma.conversationAutomation.findFirst({
      where: { id: automationId, companyId: request.user.companyId },
    })
    if (!automation) return reply.status(404).send({ error: 'Automation not found' })

    return reply.send({ automation })
  })

  // Update automation
  fastify.put('/:automationId', { preHandler: [requirePermission('automations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { automationId } = automationIdSchema.parse(request.params)
    const body = updateAutomationSchema.parse(request.body)

    const existing = await prisma.conversationAutomation.findFirst({
      where: { id: automationId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Automation not found' })

    const automation = await prisma.conversationAutomation.update({
      where: { id: automationId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.eventName !== undefined ? { eventName: body.eventName } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions as any } : {}),
        ...(body.actions !== undefined ? { actions: body.actions as any } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    })

    return reply.send({ automation })
  })

  // Delete automation
  fastify.delete('/:automationId', { preHandler: [requirePermission('automations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { automationId } = automationIdSchema.parse(request.params)

    const existing = await prisma.conversationAutomation.findFirst({
      where: { id: automationId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Automation not found' })

    await prisma.conversationAutomation.delete({ where: { id: automationId } })
    return reply.send({ success: true })
  })
}
