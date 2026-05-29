import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'

const filterConditionSchema = z.object({
  attribute: z.string(),
  operator: z.enum([
    'equal',
    'not_equal',
    'contains',
    'not_contains',
    'is_present',
    'is_not_present',
    'is_greater_than',
    'is_less_than',
    'days_before',
  ]),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])),
  queryOperator: z.enum(['AND', 'OR']).optional(),
})

const createFilterSchema = z.object({
  name: z.string().min(1).max(200),
  filterType: z.string().default('conversation'),
  query: z.array(filterConditionSchema),
})

const updateFilterSchema = createFilterSchema.partial()

const filterIdSchema = z.object({
  filterId: z.string().uuid(),
})

export async function customFilterRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // List user's saved filters
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({
      filterType: z.string().optional(),
    }).parse(request.query)

    const filters = await prisma.customFilter.findMany({
      where: {
        companyId: request.user.companyId,
        userId: request.user.id,
        ...(query.filterType ? { filterType: query.filterType } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ filters })
  })

  // Create filter
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFilterSchema.parse(request.body)

    const filter = await prisma.customFilter.create({
      data: {
        name: body.name,
        filterType: body.filterType,
        query: body.query as any,
        companyId: request.user.companyId,
        userId: request.user.id,
      },
    })

    return reply.status(201).send({ filter })
  })

  // Update filter
  fastify.put('/:filterId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filterId } = filterIdSchema.parse(request.params)
    const body = updateFilterSchema.parse(request.body)

    const existing = await prisma.customFilter.findFirst({
      where: { id: filterId, userId: request.user.id },
    })
    if (!existing) return reply.status(404).send({ error: 'Filter not found' })

    const filter = await prisma.customFilter.update({
      where: { id: filterId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.filterType ? { filterType: body.filterType } : {}),
        ...(body.query ? { query: body.query as any } : {}),
      },
    })

    return reply.send({ filter })
  })

  // Delete filter
  fastify.delete('/:filterId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filterId } = filterIdSchema.parse(request.params)

    const existing = await prisma.customFilter.findFirst({
      where: { id: filterId, userId: request.user.id },
    })
    if (!existing) return reply.status(404).send({ error: 'Filter not found' })

    await prisma.customFilter.delete({ where: { id: filterId } })
    return reply.send({ success: true })
  })

  // Apply filter (execute query against conversations)
  fastify.post('/apply', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({
      query: z.array(filterConditionSchema),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(request.body)

    const prismaWhere = buildConversationWhere(body.query, request.user.companyId)
    const skip = (body.page - 1) * body.limit

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: prismaWhere,
        orderBy: { lastActivityAt: 'desc' },
        skip,
        take: body.limit,
        include: {
          contact: { select: { id: true, name: true, phoneNumber: true, profilePicture: true } },
          assignee: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
          conversationLabels: { include: { label: true } },
        },
      }),
      prisma.conversation.count({ where: prismaWhere }),
    ])

    return reply.send({
      conversations,
      pagination: {
        page: body.page,
        limit: body.limit,
        total,
        pages: Math.ceil(total / body.limit),
      },
    })
  })
}

function buildConversationWhere(conditions: any[], companyId: string) {
  const where: any = { companyId }
  const andConditions: any[] = []

  for (const condition of conditions) {
    const prismaCondition = mapConditionToPrisma(condition)
    if (prismaCondition) {
      if (condition.queryOperator === 'OR' && andConditions.length > 0) {
        const lastAnd = andConditions.pop()
        andConditions.push({ OR: [lastAnd, prismaCondition] })
      } else {
        andConditions.push(prismaCondition)
      }
    }
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  return where
}

function mapConditionToPrisma(condition: any) {
  const { attribute, operator, values } = condition
  const value = values[0]

  const operatorMap: Record<string, any> = {
    equal: { equals: value },
    not_equal: { not: value },
    contains: { contains: String(value), mode: 'insensitive' },
    not_contains: { not: { contains: String(value), mode: 'insensitive' } },
    is_present: { not: null },
    is_not_present: null,
    is_greater_than: { gt: value },
    is_less_than: { lt: value },
  }

  const prismaOp = operatorMap[operator]

  switch (attribute) {
    case 'status':
      return { status: prismaOp }
    case 'assignee_id':
      return { assigneeId: prismaOp }
    case 'team_id':
      return { teamId: prismaOp }
    case 'priority':
      return { priority: prismaOp }
    case 'label':
      return {
        conversationLabels: {
          some: { label: { title: prismaOp } },
        },
      }
    case 'contact_name':
      return { contact: { name: prismaOp } }
    case 'phone_number':
      return { remoteJid: prismaOp }
    default:
      // Custom attribute (stored in JSONB)
      if (attribute.startsWith('custom_')) {
        const key = attribute.replace('custom_', '')
        return {
          customAttributes: {
            path: [key],
            ...(operator === 'equal' ? { equals: value } : {}),
            ...(operator === 'contains' ? { string_contains: String(value) } : {}),
          },
        }
      }
      return null
  }
}
