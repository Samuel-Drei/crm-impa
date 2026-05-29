import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MacroVisibility } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'

const macroActionSchema = z.object({
  actionName: z.enum([
    'assign_agent',
    'assign_team',
    'add_label',
    'remove_label',
    'change_status',
    'change_priority',
    'send_message',
    'mute_conversation',
  ]),
  actionParams: z.array(z.any()),
})

const createMacroSchema = z.object({
  name: z.string().min(1).max(200),
  visibility: z.nativeEnum(MacroVisibility).default('PERSONAL'),
  actions: z.array(macroActionSchema),
})

const updateMacroSchema = createMacroSchema.partial()

const macroIdSchema = z.object({
  macroId: z.string().uuid(),
})

export async function macroRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List macros (user's personal + global)
  fastify.get('/', { preHandler: [requirePermission('macros:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const macros = await prisma.macro.findMany({
      where: {
        companyId: request.user.companyId,
        OR: [
          { visibility: 'GLOBAL' },
          { createdById: request.user.id },
        ],
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ macros })
  })

  // Create macro
  fastify.post('/', { preHandler: [requirePermission('macros:manage'), enforcePlanLimit('maxAutomations')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createMacroSchema.parse(request.body)

    const macro = await prisma.macro.create({
      data: {
        name: body.name,
        visibility: body.visibility,
        actions: body.actions as any,
        companyId: request.user.companyId,
        createdById: request.user.id,
        updatedById: request.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    })

    return reply.status(201).send({ macro })
  })

  // Update macro
  fastify.put('/:macroId', { preHandler: [requirePermission('macros:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { macroId } = macroIdSchema.parse(request.params)
    const body = updateMacroSchema.parse(request.body)

    const existing = await prisma.macro.findFirst({
      where: { id: macroId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Macro not found' })

    // Only owner or admin can edit
    if (existing.createdById !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized to edit this macro' })
    }

    const macro = await prisma.macro.update({
      where: { id: macroId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(body.actions !== undefined ? { actions: body.actions as any } : {}),
        updatedById: request.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    })

    return reply.send({ macro })
  })

  // Delete macro
  fastify.delete('/:macroId', { preHandler: [requirePermission('macros:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { macroId } = macroIdSchema.parse(request.params)

    const existing = await prisma.macro.findFirst({
      where: { id: macroId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Macro not found' })

    if (existing.createdById !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized to delete this macro' })
    }

    await prisma.macro.delete({ where: { id: macroId } })
    return reply.send({ success: true })
  })

  // Execute macro on a conversation
  fastify.post('/:macroId/execute', { preHandler: [requirePermission('macros:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { macroId } = macroIdSchema.parse(request.params)
    const { conversationId } = z.object({
      conversationId: z.string().uuid(),
    }).parse(request.body)

    const macro = await prisma.macro.findFirst({
      where: {
        id: macroId,
        companyId: request.user.companyId,
        OR: [
          { visibility: 'GLOBAL' },
          { createdById: request.user.id },
        ],
      },
    })
    if (!macro) return reply.status(404).send({ error: 'Macro not found' })

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: request.user.companyId },
    })
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    const actions = macro.actions as any[]
    const results: any[] = []

    for (const action of actions) {
      const result = await executeMacroAction(action, conversationId, request.user.companyId)
      results.push({ action: action.actionName, result })
    }

    return reply.send({ results })
  })
}

async function executeMacroAction(action: any, conversationId: string, companyId: string) {
  const { actionName, actionParams } = action

  switch (actionName) {
    case 'assign_agent':
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { assigneeId: actionParams[0] || null },
      })

    case 'assign_team':
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { teamId: actionParams[0] || null },
      })

    case 'add_label': {
      const label = await prisma.label.findFirst({
        where: { companyId, title: actionParams[0] },
      })
      if (label) {
        return prisma.conversationLabel.upsert({
          where: { conversationId_labelId: { conversationId, labelId: label.id } },
          update: {},
          create: { conversationId, labelId: label.id },
        })
      }
      return null
    }

    case 'remove_label': {
      const labelToRemove = await prisma.label.findFirst({
        where: { companyId, title: actionParams[0] },
      })
      if (labelToRemove) {
        return prisma.conversationLabel.deleteMany({
          where: { conversationId, labelId: labelToRemove.id },
        })
      }
      return null
    }

    case 'change_status':
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { status: actionParams[0], lastActivityAt: new Date() },
      })

    case 'change_priority':
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { priority: actionParams[0] },
      })

    case 'mute_conversation': {
      const snoozedUntil = new Date()
      snoozedUntil.setHours(snoozedUntil.getHours() + 1)
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'SNOOZED', snoozedUntil },
      })
    }

    default:
      return null
  }
}
