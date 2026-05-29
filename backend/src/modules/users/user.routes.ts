import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'
import { getDefaultRoleId } from '../rbac/rbac.helpers.js'
import { auditLog } from '../../core/audit.service.js'

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  roleId: z.string().uuid().optional(), // Se não informado, usa role padrão (agent)
})

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
})

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const builderSettingsSchema = z.object({
  snapToGrid: z.boolean(),
  snapGrid: z.number().int().min(5).max(80),
  backgroundVariant: z.enum(['dots', 'lines', 'cross', 'none']),
  backgroundGap: z.number().int().min(8).max(80),
  backgroundSize: z.number().min(0.5).max(4),
  controlsVisible: z.boolean(),
  minimapVisible: z.boolean(),
  defaultEdgeAnimated: z.boolean(),
  defaultEdgeType: z.enum(['smoothstep', 'step', 'straight', 'bezier', 'simpleBezier']),
  edgeStyle: z.enum(['dashed', 'solid']),
  edgeColor: hexColorSchema,
  selectedEdgeColor: hexColorSchema,
  edgeStrokeWidth: z.number().min(1).max(6),
  edgeMarkerEnd: z.enum(['none', 'arrow', 'arrowClosed']),
  edgeMarkerSize: z.number().int().min(8).max(32),
  edgeOpacity: z.number().min(0.2).max(1),
}).strict()

// Campos padrão para select de user (inclui rbacRole para retornar slug)
const userSelect = {
  id: true,
  name: true,
  email: true,
  roleId: true,
  rbacRole: { select: { slug: true, name: true } },
  isActive: true,
  createdAt: true,
} as const

export async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  fastify.get('/', { preHandler: [requirePermission('users:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const users = await prisma.user.findMany({
      where: { companyId: request.user.companyId },
      select: {
        ...userSelect,
        teamMemberships: { select: { team: { select: { id: true, name: true } } } },
      },
    })
    const mapped = users.map(u => ({
      ...u,
      role: u.rbacRole.slug,
      roleName: u.rbacRole.name,
      teams: u.teamMemberships.map(tm => tm.team),
    }))
    return reply.send(mapped)
  })

  fastify.get('/me/builder-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findFirst({
      where: { id: request.user.id, companyId: request.user.companyId },
      select: { builderSettings: true },
    })

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    return reply.send(user.builderSettings ?? null)
  })

  fastify.put('/me/builder-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const builderSettings = builderSettingsSchema.parse(request.body)

    const user = await prisma.user.update({
      where: { id: request.user.id },
      data: { builderSettings },
      select: { builderSettings: true },
    })

    return reply.send(user.builderSettings)
  })

  fastify.post('/', { preHandler: [requirePermission('users:manage'), enforcePlanLimit('maxUsers')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createUserSchema.parse(request.body)

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (existingUser) {
      return reply.status(409).send({ error: 'Email already registered' })
    }

const hashedPassword = await bcrypt.hash(data.password, 12)

    // Se não informou roleId, usar role padrão (agent)
    const roleId = data.roleId || await getDefaultRoleId(request.user.companyId)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        companyId: request.user.companyId,
        roleId,
      },
      select: userSelect,
    })

    return reply.status(201).send({
      ...user,
      role: user.rbacRole.slug,
      roleName: user.rbacRole.name,
    })
  })

  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params
    const data = updateUserSchema.parse(request.body)

    const user = await prisma.user.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const updateData: any = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.email !== undefined) updateData.email = data.email
    if (data.roleId !== undefined) updateData.roleId = data.roleId
    if (data.isActive !== undefined) updateData.isActive = data.isActive
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 12)
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    })

    auditLog(request, { action: 'UPDATE_USER', entity: 'user', entityId: id, newData: { name: data.name, email: data.email, roleId: data.roleId, isActive: data.isActive } })

    return reply.send({
      ...updatedUser,
      role: updatedUser.rbacRole.slug,
      roleName: updatedUser.rbacRole.name,
    })
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('users:manage')] }, async (request, reply) => {
    const { id } = request.params

    if (id === request.user.id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' })
    }

    const user = await prisma.user.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    await prisma.user.delete({ where: { id } })
    auditLog(request, { action: 'DELETE_USER', entity: 'user', entityId: id, oldData: { email: user.email, name: user.name } })

    return reply.status(204).send()
  })
}
