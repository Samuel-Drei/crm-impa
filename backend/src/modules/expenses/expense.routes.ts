import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logActivityByContact } from '../customers/customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listExpensesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  billable: z.coerce.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

const createExpenseSchema = z.object({
  name: z.string().min(1).max(300),
  amount: z.number().min(0),
  categoryId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  date: z.string(),
  paymentMethod: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'CASH', 'OTHER']).optional(),
  currency: z.string().default('BRL'),
  taxRate: z.number().min(0).max(100).optional(),
  note: z.string().optional(),
  receiptFile: z.string().optional(),
  billable: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurringType: z.string().optional(),
  recurringEvery: z.number().int().min(1).optional(),
  recurringCycles: z.number().int().min(0).optional(),
})

const updateExpenseSchema = createExpenseSchema.partial()

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().optional(),
})

// ── Expense Category Routes ──────────────────────────────

export async function expenseCategoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  fastify.get('/', { preHandler: [requirePermission('expenses:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const categories = await prisma.expenseCategory.findMany({
        where: { companyId },
        include: { _count: { select: { expenses: true } } },
        orderBy: { name: 'asc' },
      })

      return reply.send({ categories })
    }
  )

  fastify.post('/', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = createCategorySchema.parse(request.body)

      const existing = await prisma.expenseCategory.findUnique({
        where: { companyId_name: { companyId, name: body.name } },
      })
      if (existing) return reply.status(409).send({ error: 'Categoria já existe' })

      const category = await prisma.expenseCategory.create({
        data: { companyId, ...body },
      })

      return reply.status(201).send({ category })
    }
  )

  fastify.put('/:id', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = createCategorySchema.partial().parse(request.body)

      const existing = await prisma.expenseCategory.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Categoria não encontrada' })

      const category = await prisma.expenseCategory.update({
        where: { id },
        data: body,
      })

      return reply.send({ category })
    }
  )

  fastify.delete('/:id', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.expenseCategory.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Categoria não encontrada' })

      await prisma.expenseCategory.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}

// ── Expense Routes ───────────────────────────────────────

export async function expenseRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar despesas
  fastify.get('/', { preHandler: [requirePermission('expenses:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listExpensesQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.name = { contains: query.search, mode: 'insensitive' }
      }
      if (query.categoryId) where.categoryId = query.categoryId
      if (query.projectId) where.projectId = query.projectId
      if (query.billable !== undefined) where.billable = query.billable
      if (query.dateFrom || query.dateTo) {
        where.date = {}
        if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
        if (query.dateTo) where.date.lte = new Date(query.dateTo)
      }

      const [expenses, total] = await Promise.all([
        prisma.expense.findMany({
          where,
          include: {
            category: { select: { id: true, name: true, color: true } },
          },
          orderBy: { date: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.expense.count({ where }),
      ])

      // Agregar total
      const aggregate = await prisma.expense.aggregate({
        where,
        _sum: { amount: true },
      })

      return reply.send({
        expenses,
        total,
        totalAmount: aggregate._sum.amount?.toNumber() || 0,
        page: query.page,
        limit: query.limit,
      })
    }
  )

  // Obter despesa por ID
  fastify.get('/:id', { preHandler: [requirePermission('expenses:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const expense = await prisma.expense.findFirst({
        where: { id, companyId },
        include: { category: true },
      })

      if (!expense) return reply.status(404).send({ error: 'Despesa não encontrada' })
      return reply.send({ expense })
    }
  )

  // Criar despesa
  fastify.post('/', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createExpenseSchema.parse(request.body)

      const expense = await prisma.expense.create({
        data: {
          companyId,
          ...body,
          date: new Date(body.date),
          createdBy: userId,
        },
        include: { category: true },
      })

      if (body.contactId) logActivityByContact({ companyId, contactId: body.contactId, userId, action: 'EXPENSE_CREATED', entity: 'expense', entityId: expense.id, description: `Despesa "${body.name}" criada (${body.amount})` })

      return reply.status(201).send({ expense })
    }
  )

  // Atualizar despesa
  fastify.put('/:id', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateExpenseSchema.parse(request.body)

      const existing = await prisma.expense.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Despesa não encontrada' })

      const updateData: any = { ...body }
      if (updateData.date) updateData.date = new Date(updateData.date)

      const expense = await prisma.expense.update({
        where: { id },
        data: updateData,
        include: { category: true },
      })

      return reply.send({ expense })
    }
  )

  // Deletar despesa
  fastify.delete('/:id', { preHandler: [requirePermission('expenses:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.expense.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Despesa não encontrada' })

      await prisma.expense.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}
