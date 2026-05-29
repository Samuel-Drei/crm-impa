import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  slug: z.string().min(2).max(30).regex(/^[a-z0-9_-]+$/),
  description: z.string().optional(),
  defaultScope: z.enum(['OWN', 'OWN_ONLY', 'TEAM', 'COMPANY']).default('OWN'),
  conversationScope: z.enum(['OWN', 'OWN_ONLY', 'TEAM', 'COMPANY']).default('OWN'),
  canReplyConversations: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  permissionIds: z.array(z.string().uuid()),
})

const updateRoleSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().optional(),
  defaultScope: z.enum(['OWN', 'OWN_ONLY', 'TEAM', 'COMPANY']).optional(),
  conversationScope: z.enum(['OWN', 'OWN_ONLY', 'TEAM', 'COMPANY']).optional(),
  canReplyConversations: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
})

export async function roleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar todas as permissões disponíveis (para UI do editor de role)
  fastify.get('/permissions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    })
    return reply.send(permissions)
  })

  // Listar roles da empresa
  fastify.get('/', {
    preHandler: [requirePermission('roles:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const roles = await prisma.role.findMany({
      where: { companyId: request.user.companyId },
      include: {
        permissions: {
          include: { permission: { select: { id: true, slug: true, module: true, action: true, description: true } } },
        },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const mapped = roles.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      type: r.type,
      defaultScope: r.defaultScope,
      conversationScope: r.conversationScope,
      canReplyConversations: r.canReplyConversations,
      isDefault: r.isDefault,
      permissions: r.permissions.map(rp => rp.permission),
      userCount: r._count.users,
      createdAt: r.createdAt,
    }))

    return reply.send(mapped)
  })

  // Obter role por ID
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [requirePermission('roles:manage')],
  }, async (request, reply) => {
    const { id } = request.params

    const role = await prisma.role.findFirst({
      where: { id, companyId: request.user.companyId },
      include: {
        permissions: {
          include: { permission: true },
        },
        _count: { select: { users: true } },
      },
    })

    if (!role) {
      return reply.status(404).send({ error: 'Role not found' })
    }

    return reply.send({
      ...role,
      permissions: role.permissions.map(rp => rp.permission),
      userCount: role._count.users,
    })
  })

  // Criar role custom
  fastify.post('/', {
    preHandler: [requirePermission('roles:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createRoleSchema.parse(request.body)

    // Verificar slug único na empresa
    const existing = await prisma.role.findUnique({
      where: { companyId_slug: { companyId: request.user.companyId, slug: data.slug } },
    })
    if (existing) {
      return reply.status(409).send({ error: 'Slug already exists for this company' })
    }

    // Se isDefault=true, remover default de outros roles
    if (data.isDefault) {
      await prisma.role.updateMany({
        where: { companyId: request.user.companyId, isDefault: true },
        data: { isDefault: false },
      })
    }

    const role = await prisma.role.create({
      data: {
        companyId: request.user.companyId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        type: 'CUSTOM',
        defaultScope: data.defaultScope,
        conversationScope: data.conversationScope,
        canReplyConversations: data.canReplyConversations,
        isDefault: data.isDefault,
        permissions: {
          create: data.permissionIds.map(permissionId => ({ permissionId })),
        },
      },
      include: {
        permissions: { include: { permission: true } },
      },
    })

    return reply.status(201).send({
      ...role,
      permissions: role.permissions.map(rp => rp.permission),
    })
  })

  // Atualizar role
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [requirePermission('roles:manage')],
  }, async (request, reply) => {
    const { id } = request.params
    const data = updateRoleSchema.parse(request.body)

    const role = await prisma.role.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!role) {
      return reply.status(404).send({ error: 'Role not found' })
    }

    // Se isDefault=true, remover default de outros roles
    if (data.isDefault) {
      await prisma.role.updateMany({
        where: { companyId: request.user.companyId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    // Atualizar permissões se fornecidas
    if (data.permissionIds) {
      // Deletar todas existentes e recriar
      await prisma.rolePermission.deleteMany({ where: { roleId: id } })
      await prisma.rolePermission.createMany({
        data: data.permissionIds.map(permissionId => ({ roleId: id, permissionId })),
      })
    }

    const { permissionIds, ...updateData } = data

    const updated = await prisma.role.update({
      where: { id },
      data: updateData,
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    })

    return reply.send({
      ...updated,
      permissions: updated.permissions.map(rp => rp.permission),
      userCount: updated._count.users,
    })
  })

  // Deletar role (apenas CUSTOM)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [requirePermission('roles:manage')],
  }, async (request, reply) => {
    const { id } = request.params

    const role = await prisma.role.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!role) {
      return reply.status(404).send({ error: 'Role not found' })
    }

    if (role.type === 'SYSTEM') {
      return reply.status(403).send({ error: 'Cannot delete SYSTEM roles' })
    }

    // Verificar se há usuários com este role
    const userCount = await prisma.user.count({ where: { roleId: id } })
    if (userCount > 0) {
      return reply.status(409).send({
        error: `Cannot delete role with ${userCount} user(s). Reassign them first.`,
      })
    }

    await prisma.role.delete({ where: { id } })
    return reply.status(204).send()
  })
}
