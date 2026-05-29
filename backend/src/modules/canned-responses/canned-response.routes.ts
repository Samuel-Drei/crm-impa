import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

const createResponseSchema = z.object({
  shortCode: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  content: z.string().min(1).max(5000),
})

const updateResponseSchema = createResponseSchema.partial()

const responseIdSchema = z.object({
  responseId: z.string().uuid(),
})

export async function cannedResponseRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List canned responses
  fastify.get('/', { preHandler: [requirePermission('canned_responses:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({
      search: z.string().optional(),
    }).parse(request.query)

    const where: any = { companyId: request.user.companyId }

    if (query.search) {
      where.OR = [
        { shortCode: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const responses = await prisma.cannedResponse.findMany({
      where,
      orderBy: { shortCode: 'asc' },
    })
    return reply.send({ responses })
  })

  // Create canned response
  fastify.post('/', { preHandler: [requirePermission('canned_responses:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createResponseSchema.parse(request.body)

    const response = await prisma.cannedResponse.create({
      data: {
        ...body,
        companyId: request.user.companyId,
      },
    })

    return reply.status(201).send({ response })
  })

  // Update canned response
  fastify.put('/:responseId', { preHandler: [requirePermission('canned_responses:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { responseId } = responseIdSchema.parse(request.params)
    const body = updateResponseSchema.parse(request.body)

    const existing = await prisma.cannedResponse.findFirst({
      where: { id: responseId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Canned response not found' })

    const response = await prisma.cannedResponse.update({
      where: { id: responseId },
      data: body,
    })

    return reply.send({ response })
  })

  // Delete canned response
  fastify.delete('/:responseId', { preHandler: [requirePermission('canned_responses:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { responseId } = responseIdSchema.parse(request.params)

    const existing = await prisma.cannedResponse.findFirst({
      where: { id: responseId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Canned response not found' })

    await prisma.cannedResponse.delete({ where: { id: responseId } })
    return reply.send({ success: true })
  })
}
