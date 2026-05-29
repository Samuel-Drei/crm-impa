import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware, adminMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { scopedWhere } from '../../middlewares/scope.middleware.js'

const updateCompanySchema = z.object({
  name: z.string().min(2).optional(),
  document: z.string().optional(),
  phone: z.string().optional(),
})

export async function companyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  fastify.get('/current', { preHandler: [requirePermission('settings:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const company = await prisma.company.findUnique({
      where: { id: request.user.companyId },
      include: {
        _count: {
          select: {
            users: true,
            instances: { where: { isActive: true } },
            contacts: true,
            campaigns: true,
          },
        },
      },
    })

    if (!company) {
      return reply.status(404).send({ error: 'Company not found' })
    }

    return reply.send(company)
  })

  fastify.put('/current', { preHandler: [requirePermission('settings:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = updateCompanySchema.parse(request.body)

    const company = await prisma.company.update({
      where: { id: request.user.companyId },
      data,
    })

    return reply.send(company)
  })

  fastify.get('/stats', { preHandler: [requirePermission('settings:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user.companyId
    const convWhere = scopedWhere(request, 'conversations')

    const [
      instancesCount,
      onlineInstances,
      totalMessages,
      todayMessages,
      contactsCount,
      campaignsCount,
      openConversations,
      pendingConversations,
    ] = await Promise.all([
      prisma.instance.count({ where: { companyId, isActive: true } }),
      prisma.instance.count({ where: { companyId, status: 'CONNECTED', isActive: true } }),
      prisma.message.count({
        where: { instance: { companyId } },
      }),
      prisma.message.count({
        where: {
          instance: { companyId },
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      prisma.contact.count({ where: { companyId, isActive: true } }),
      prisma.campaign.count({ where: { companyId } }),
      prisma.conversation.count({ where: { ...convWhere, status: 'OPEN' } }),
      prisma.conversation.count({ where: { ...convWhere, status: 'PENDING' } }),
    ])

    return reply.send({
      instances: {
        total: instancesCount,
        online: onlineInstances,
        offline: instancesCount - onlineInstances,
      },
      messages: {
        total: totalMessages,
        today: todayMessages,
      },
      contacts: contactsCount,
      campaigns: campaignsCount,
      conversations: {
        open: openConversations,
        pending: pendingConversations,
      },
    })
  })
}
