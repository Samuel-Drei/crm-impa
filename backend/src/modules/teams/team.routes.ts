import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  allowAutoAssign: z.boolean().default(true),
})

const updateTeamSchema = createTeamSchema.partial()

const teamIdSchema = z.object({
  teamId: z.string().uuid(),
})

const memberSchema = z.object({
  userId: z.string().uuid(),
})

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List teams
  fastify.get('/', { preHandler: [requirePermission('teams:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const teams = await prisma.team.findMany({
      where: { companyId: request.user.companyId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: { select: { conversations: true } },
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ teams })
  })

  // Create team
  fastify.post('/', { preHandler: [requirePermission('teams:manage'), enforcePlanLimit('maxTeams')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTeamSchema.parse(request.body)

    const team = await prisma.team.create({
      data: {
        ...body,
        companyId: request.user.companyId,
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })

    return reply.status(201).send({ team })
  })

  // Get team by ID
  fastify.get('/:teamId', { preHandler: [requirePermission('teams:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { teamId } = teamIdSchema.parse(request.params)

    const team = await prisma.team.findFirst({
      where: { id: teamId, companyId: request.user.companyId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: { select: { conversations: true } },
      },
    })

    if (!team) return reply.status(404).send({ error: 'Team not found' })
    return reply.send({ team })
  })

  // Update team
  fastify.put('/:teamId', { preHandler: [requirePermission('teams:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { teamId } = teamIdSchema.parse(request.params)
    const body = updateTeamSchema.parse(request.body)

    const existing = await prisma.team.findFirst({
      where: { id: teamId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Team not found' })

    const team = await prisma.team.update({
      where: { id: teamId },
      data: body,
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })

    return reply.send({ team })
  })

  // Delete team
  fastify.delete('/:teamId', { preHandler: [requirePermission('teams:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { teamId } = teamIdSchema.parse(request.params)

    const existing = await prisma.team.findFirst({
      where: { id: teamId, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Team not found' })

    await prisma.team.delete({ where: { id: teamId } })
    return reply.send({ success: true })
  })

  // Add member to team
  fastify.post('/:teamId/members', { preHandler: [requirePermission('teams:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { teamId } = teamIdSchema.parse(request.params)
    const { userId } = memberSchema.parse(request.body)

    const team = await prisma.team.findFirst({
      where: { id: teamId, companyId: request.user.companyId },
    })
    if (!team) return reply.status(404).send({ error: 'Team not found' })

    const user = await prisma.user.findFirst({
      where: { id: userId, companyId: request.user.companyId, isActive: true },
    })
    if (!user) return reply.status(400).send({ error: 'User not found in this company' })

    const member = await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      update: {},
      create: { teamId, userId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    return reply.status(201).send({ member })
  })

  // Remove member from team
  fastify.delete('/:teamId/members/:userId', { preHandler: [requirePermission('teams:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      teamId: z.string().uuid(),
      userId: z.string().uuid(),
    }).parse(request.params)

    const team = await prisma.team.findFirst({
      where: { id: params.teamId, companyId: request.user.companyId },
    })
    if (!team) return reply.status(404).send({ error: 'Team not found' })

    await prisma.teamMember.deleteMany({
      where: { teamId: params.teamId, userId: params.userId },
    })

    return reply.send({ success: true })
  })
}
