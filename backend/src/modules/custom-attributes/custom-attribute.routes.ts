import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { CustomAttributeModel, CustomAttributeType } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { logConversationEvent } from '../conversations/conversation-events.service.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

const createDefinitionSchema = z.object({
  attributeKey: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
  attributeDisplayName: z.string().min(1).max(200),
  attributeDisplayType: z.nativeEnum(CustomAttributeType).default('TEXT'),
  attributeModel: z.nativeEnum(CustomAttributeModel).default('CONVERSATION'),
  attributeValues: z.array(z.string()).optional(),
  regexPattern: z.string().optional(),
  regexCue: z.string().optional(),
  description: z.string().max(500).optional(),
})

const updateDefinitionSchema = createDefinitionSchema.partial()

const definitionIdSchema = z.object({
  definitionId: z.string().uuid(),
})

const setAttributeBodySchema = z.object({
  attributeKey: z.string().min(1),
  value: z.any(),
})

export async function customAttributeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List attribute definitions
  fastify.get('/', { preHandler: [requirePermission('custom_attributes:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({
      model: z.nativeEnum(CustomAttributeModel).optional(),
    }).parse(request.query)

    const definitions = await prisma.customAttributeDefinition.findMany({
      where: {
        companyId: request.user.companyId,
        ...(query.model ? { attributeModel: query.model } : {}),
      },
      orderBy: { attributeDisplayName: 'asc' },
    })
    return reply.send({ definitions })
  })

  // Create attribute definition
  fastify.post('/', { preHandler: [requirePermission('custom_attributes:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createDefinitionSchema.parse(request.body)

    const definition = await prisma.customAttributeDefinition.create({
      data: {
        ...body,
        attributeValues: body.attributeValues ? body.attributeValues : undefined,
        companyId: request.user.companyId,
      },
    })

    return reply.status(201).send({ definition })
  })

  // Update attribute definition
  fastify.put('/:definitionId', { preHandler: [requirePermission('custom_attributes:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { definitionId } = definitionIdSchema.parse(request.params)
    const body = updateDefinitionSchema.parse(request.body)

    const existing = await prisma.customAttributeDefinition.findFirst({
      where: { id: definitionId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Definition not found' })

    const definition = await prisma.customAttributeDefinition.update({
      where: { id: definitionId },
      data: {
        ...body,
        attributeValues: body.attributeValues ? body.attributeValues : undefined,
      },
    })

    return reply.send({ definition })
  })

  // Delete attribute definition
  fastify.delete('/:definitionId', { preHandler: [requirePermission('custom_attributes:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { definitionId } = definitionIdSchema.parse(request.params)

    const existing = await prisma.customAttributeDefinition.findFirst({
      where: { id: definitionId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Definition not found' })

    await prisma.customAttributeDefinition.delete({ where: { id: definitionId } })
    return reply.send({ success: true })
  })

  // Set custom attribute value on a conversation
  fastify.post('/conversations/:conversationId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { conversationId } = z.object({
      conversationId: z.string().uuid(),
    }).parse(request.params)
    const { attributeKey, value } = setAttributeBodySchema.parse(request.body)

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: request.user.companyId },
      select: { id: true, customAttributes: true, instanceId: true, remoteJid: true },
    })
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    const definition = await prisma.customAttributeDefinition.findFirst({
      where: {
        companyId: request.user.companyId,
        attributeKey,
        attributeModel: 'CONVERSATION',
      },
    })
    if (!definition) return reply.status(404).send({ error: 'Attribute definition not found' })

    const currentAttrs = (conversation.customAttributes as Record<string, any>) || {}
    currentAttrs[attributeKey] = value

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: { customAttributes: currentAttrs },
    })

    const userName = request.user.name || 'Usuário'
    logConversationEvent({
      conversationId,
      instanceId: conversation.instanceId,
      remoteJid: conversation.remoteJid,
      eventType: 'custom_field_set',
      description: `${userName} alterou o campo "${definition.attributeDisplayName}" para "${value}"`,
      actorType: 'user',
      actorName: userName,
      metadata: { attributeKey, displayName: definition.attributeDisplayName, value },
    })

    return reply.send({ conversation: updated })
  })

  // Set custom attribute value on a contact
  fastify.post('/contacts/:contactId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { contactId } = z.object({
      contactId: z.string().uuid(),
    }).parse(request.params)
    const { attributeKey, value } = setAttributeBodySchema.parse(request.body)

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, companyId: request.user.companyId },
      select: { id: true, metadata: true },
    })
    if (!contact) return reply.status(404).send({ error: 'Contact not found' })

    const definition = await prisma.customAttributeDefinition.findFirst({
      where: {
        companyId: request.user.companyId,
        attributeKey,
        attributeModel: 'CONTACT',
      },
    })
    if (!definition) return reply.status(404).send({ error: 'Attribute definition not found' })

    const currentMeta = (contact.metadata as Record<string, any>) || {}
    currentMeta[attributeKey] = value

    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: { metadata: currentMeta },
    })

    // Log event on any conversation of this contact
    const contactConv = await prisma.conversation.findFirst({
      where: { contactId, companyId: request.user.companyId },
      select: { id: true, instanceId: true, remoteJid: true },
      orderBy: { lastActivityAt: 'desc' },
    })
    if (contactConv) {
      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: contactConv.id,
        instanceId: contactConv.instanceId,
        remoteJid: contactConv.remoteJid,
        eventType: 'custom_field_set',
        description: `${userName} alterou o campo "${definition.attributeDisplayName}" para "${value}" no contato`,
        actorType: 'user',
        actorName: userName,
        metadata: { attributeKey, displayName: definition.attributeDisplayName, value, model: 'CONTACT' },
      })
    }

    return reply.send({ contact: updated })
  })
}
