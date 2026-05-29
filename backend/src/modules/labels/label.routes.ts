import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logConversationEvent } from '../conversations/conversation-events.service.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'

const createLabelSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1f93ff'),
  showOnSidebar: z.boolean().default(true),
})

const updateLabelSchema = createLabelSchema.partial()

const labelIdSchema = z.object({
  labelId: z.string().uuid(),
})

export async function labelRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List labels
  fastify.get('/', { preHandler: [requirePermission('labels:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const labels = await prisma.label.findMany({
      where: { companyId: request.user.companyId },
      include: {
        _count: { select: { conversationLabels: true } },
      },
      orderBy: { title: 'asc' },
    })
    return reply.send({ labels })
  })

  // Create label
  fastify.post('/', { preHandler: [requirePermission('labels:manage'), enforcePlanLimit('maxLabels')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createLabelSchema.parse(request.body)

    const label = await prisma.label.create({
      data: {
        ...body,
        companyId: request.user.companyId,
      },
    })

    return reply.status(201).send({ label })
  })

  // Update label
  fastify.put('/:labelId', { preHandler: [requirePermission('labels:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { labelId } = labelIdSchema.parse(request.params)
    const body = updateLabelSchema.parse(request.body)

    const existing = await prisma.label.findFirst({
      where: { id: labelId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Label not found' })

    const label = await prisma.label.update({
      where: { id: labelId },
      data: body,
    })

    return reply.send({ label })
  })

  // Delete label
  fastify.delete('/:labelId', { preHandler: [requirePermission('labels:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { labelId } = labelIdSchema.parse(request.params)

    const existing = await prisma.label.findFirst({
      where: { id: labelId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Label not found' })

    await prisma.label.delete({ where: { id: labelId } })
    return reply.send({ success: true })
  })

  // Add label to conversation
  fastify.post('/conversations/:conversationId', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      conversationId: z.string().uuid(),
    }).parse(request.params)
    const { labelId } = z.object({ labelId: z.string().uuid() }).parse(request.body)

    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, companyId: request.user.companyId },
    })
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    const label = await prisma.label.findFirst({
      where: { id: labelId, companyId: request.user.companyId },
    })
    if (!label) return reply.status(404).send({ error: 'Label not found' })

    const conversationLabel = await prisma.conversationLabel.upsert({
      where: { conversationId_labelId: { conversationId: params.conversationId, labelId } },
      update: {},
      create: { conversationId: params.conversationId, labelId },
      include: { label: true },
    })

    const userName = request.user.name || 'Usuário'
    logConversationEvent({
      conversationId: params.conversationId,
      instanceId: conversation.instanceId,
      remoteJid: conversation.remoteJid,
      eventType: 'label_added',
      description: `${userName} adicionou a etiqueta "${label.title}"`,
      actorType: 'user',
      actorName: userName,
      metadata: { labelId, labelTitle: label.title, labelColor: label.color },
    })

    return reply.status(201).send({ conversationLabel })
  })

  // Remove label from conversation
  fastify.delete('/conversations/:conversationId/:labelId', { preHandler: [requirePermission('conversations:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      conversationId: z.string().uuid(),
      labelId: z.string().uuid(),
    }).parse(request.params)

    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, companyId: request.user.companyId },
    })
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    const label = await prisma.label.findFirst({
      where: { id: params.labelId, companyId: request.user.companyId },
      select: { title: true, color: true },
    })

    await prisma.conversationLabel.deleteMany({
      where: { conversationId: params.conversationId, labelId: params.labelId },
    })

    const userName = request.user.name || 'Usuário'
    logConversationEvent({
      conversationId: params.conversationId,
      instanceId: conversation.instanceId,
      remoteJid: conversation.remoteJid,
      eventType: 'label_removed',
      description: `${userName} removeu a etiqueta "${label?.title || 'Desconhecida'}"`,
      actorType: 'user',
      actorName: userName,
      metadata: { labelId: params.labelId, labelTitle: label?.title },
    })

    return reply.send({ success: true })
  })

  // Get labels of a conversation
  fastify.get('/conversations/:conversationId', { preHandler: [requirePermission('conversations:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { conversationId } = z.object({
      conversationId: z.string().uuid(),
    }).parse(request.params)

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: request.user.companyId },
    })
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    const labels = await prisma.conversationLabel.findMany({
      where: { conversationId },
      include: { label: true },
    })

    return reply.send({ labels: labels.map(cl => cl.label) })
  })
}
