import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { getNextNumber } from '../../core/documents/document-counter.js'
import { logActivityByContact } from '../customers/customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listInvoicesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  contactId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
})

const invoiceItemSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  bundleId: z.string().uuid().nullable().optional(),
  description: z.string().min(1),
  longDescription: z.string().optional(),
  quantity: z.number().min(0.0001).default(1),
  unit: z.string().optional(),
  rate: z.number().min(0),
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0).optional(),
  sortOrder: z.number().int().optional(),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY']).optional(),
})

const createInvoiceSchema = z.object({
  contactId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  prefix: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  adjustment: z.number().optional(),
  currency: z.string().default('BRL'),
  billingAddress: z.any().optional(),
  shippingAddress: z.any().optional(),
  terms: z.string().optional(),
  clientNote: z.string().optional(),
  internalNote: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  isRecurring: z.boolean().default(false),
  recurringType: z.string().optional(),
  recurringEvery: z.number().int().min(1).optional(),
  recurringCycles: z.number().int().min(0).optional(),
  items: z.array(invoiceItemSchema).min(1),
})

const updateInvoiceSchema = z.object({
  contactId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  adjustment: z.number().optional(),
  currency: z.string().optional(),
  billingAddress: z.any().optional(),
  shippingAddress: z.any().optional(),
  terms: z.string().optional(),
  clientNote: z.string().optional(),
  internalNote: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  items: z.array(invoiceItemSchema).optional(),
})

// ── Helpers ──────────────────────────────────────────────

function calculateItemTotal(item: { quantity: number; rate: number; taxRate?: number | null; discount?: number | null }) {
  const lineTotal = item.quantity * item.rate
  const discountAmount = item.discount || 0
  const afterDiscount = lineTotal - discountAmount
  const taxAmount = item.taxRate ? afterDiscount * (item.taxRate / 100) : 0
  return {
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round((afterDiscount + taxAmount) * 100) / 100,
  }
}

function calculateTotals(items: any[], discount?: { percent?: number | null; amount?: number | null; type?: string | null }, adjustment?: number | null) {
  const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.rate), 0)
  const taxTotal = items.reduce((sum: number, item: any) => sum + (item.taxAmount || 0), 0)

  let discountValue = 0
  if (discount?.type === 'percent' && discount.percent) {
    discountValue = subtotal * (discount.percent / 100)
  } else if (discount?.amount) {
    discountValue = discount.amount
  }

  const total = subtotal - discountValue + taxTotal + (adjustment || 0)

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round(total * 100) / 100,
    amountDue: Math.round(total * 100) / 100,
  }
}

async function logActivity(invoiceId: string, type: string, actorId: string, content?: string, meta?: any) {
  await prisma.invoiceActivity.create({
    data: {
      invoiceId,
      type,
      content,
      actorId,
      actorType: 'user',
      metadata: meta,
    },
  })
}

async function updateInvoicePaymentStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { where: { status: 'CONFIRMED' } } },
  })
  if (!invoice) return

  const amountPaid = invoice.payments.reduce((sum, p) => sum + p.amount.toNumber(), 0)
  const amountDue = invoice.total.toNumber() - amountPaid

  let status = invoice.status
  if (amountPaid >= invoice.total.toNumber()) {
    status = 'PAID'
  } else if (amountPaid > 0) {
    status = 'PARTIAL'
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: Math.round(amountPaid * 100) / 100,
      amountDue: Math.max(0, Math.round(amountDue * 100) / 100),
      status,
      paidAt: status === 'PAID' ? new Date() : null,
    },
  })
}

// ── Routes ───────────────────────────────────────────────

export async function invoiceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar faturas
  fastify.get('/', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listInvoicesQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.OR = [
          { number: { equals: parseInt(query.search) || -1 } },
          { contact: { name: { contains: query.search, mode: 'insensitive' } } },
        ]
      }
      if (query.status) where.status = query.status
      if (query.contactId) where.contactId = query.contactId
      if (query.assignedTo) where.assignedTo = query.assignedTo
      if (query.overdue) {
        where.status = { in: ['SENT', 'VIEWED', 'PARTIAL'] }
        where.dueDate = { lt: new Date() }
      }
      if (query.dateFrom || query.dateTo) {
        where.date = {}
        if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
        if (query.dateTo) where.date.lte = new Date(query.dateTo)
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          include: {
            contact: { select: { id: true, name: true, email: true } },
            _count: { select: { items: true, payments: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.invoice.count({ where }),
      ])

      return reply.send({ invoices, total, page: query.page, limit: query.limit })
    }
  )

  // Obter fatura por ID
  fastify.get('/:id', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const invoice = await prisma.invoice.findFirst({
        where: { id, companyId },
        include: {
          contact: true,
          proposal: { select: { id: true, number: true, prefix: true, title: true } },
          project: { select: { id: true, name: true } },
          items: {
            include: {
              item: { select: { id: true, name: true } },
              variant: { select: { id: true, name: true } },
            },
            orderBy: { sortOrder: 'asc' },
          },
          payments: { orderBy: { date: 'desc' } },
          creditNotes: true,
          activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      })

      if (!invoice) return reply.status(404).send({ error: 'Fatura não encontrada' })
      return reply.send({ invoice })
    }
  )

  // Obter fatura por hash (público)
  fastify.get('/public/:hash',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { hash } = z.object({ hash: z.string().uuid() }).parse(request.params)

      const invoice = await prisma.invoice.findUnique({
        where: { hash },
        select: {
          id: true,
          number: true,
          prefix: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          amountPaid: true,
          amountDue: true,
          currency: true,
          date: true,
          dueDate: true,
          status: true,
          clientNote: true,
          terms: true,
          hash: true,
          contact: { select: { name: true } },
          company: { select: { name: true } },
          items: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              description: true,
              longDescription: true,
              quantity: true,
              unit: true,
              rate: true,
              taxRate: true,
              taxAmount: true,
              discount: true,
              total: true,
              sortOrder: true,
            },
          },
        },
      })

      if (!invoice) return reply.status(404).send({ error: 'Fatura não encontrada' })

      if (!['VIEWED', 'PARTIAL', 'PAID'].includes(invoice.status) && invoice.status === 'SENT') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'VIEWED' },
        })
      }

      return reply.send({ invoice })
    }
  )

  // Criar fatura
  fastify.post('/', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createInvoiceSchema.parse(request.body)

      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, companyId } })
      if (!contact) return reply.status(404).send({ error: 'Contato não encontrado' })

      const prefix = body.prefix || 'FAT-'
      const number = await getNextNumber(companyId, 'invoice', prefix)

      const processedItems = body.items.map((item, idx) => {
        const calc = calculateItemTotal(item)
        return { ...item, ...calc, sortOrder: item.sortOrder ?? idx }
      })

      const totals = calculateTotals(
        processedItems,
        { percent: body.discountPercent, amount: body.discountAmount, type: body.discountType },
        body.adjustment
      )

      const invoice = await prisma.invoice.create({
        data: {
          companyId,
          number,
          prefix,
          contactId: body.contactId,
          projectId: body.projectId,
          date: body.date ? new Date(body.date) : new Date(),
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          discountPercent: body.discountPercent,
          discountAmount: body.discountAmount,
          discountType: body.discountType,
          adjustment: body.adjustment,
          currency: body.currency,
          billingAddress: body.billingAddress,
          shippingAddress: body.shippingAddress,
          terms: body.terms,
          clientNote: body.clientNote,
          internalNote: body.internalNote,
          assignedTo: body.assignedTo,
          isRecurring: body.isRecurring,
          recurringType: body.recurringType,
          recurringEvery: body.recurringEvery,
          recurringCycles: body.recurringCycles,
          createdBy: userId,
          ...totals,
          items: { create: processedItems },
        },
        include: { contact: true, items: true },
      })

      await logActivity(invoice.id, 'created', userId, `Fatura ${prefix}${number} criada`)
      logActivityByContact({ companyId, contactId: body.contactId, userId, action: 'INVOICE_CREATED', entity: 'invoice', entityId: invoice.id, description: `Fatura ${prefix}${number} criada` })

      return reply.status(201).send({ invoice })
    }
  )

  // Atualizar fatura
  fastify.put('/:id', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = updateInvoiceSchema.parse(request.body)

      const existing = await prisma.invoice.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Fatura não encontrada' })

      if (['PAID', 'CANCELLED'].includes(existing.status)) {
        return reply.status(400).send({ error: 'Não é possível editar fatura paga ou cancelada' })
      }

      const { items, ...invoiceData } = body

      const invoice = await prisma.$transaction(async (tx) => {
        if (items) {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })

          const processedItems = items.map((item, idx) => {
            const calc = calculateItemTotal(item)
            return { ...item, ...calc, sortOrder: item.sortOrder ?? idx, invoiceId: id }
          })

          await tx.invoiceItem.createMany({ data: processedItems })

          const totals = calculateTotals(
            processedItems,
            {
              percent: body.discountPercent ?? existing.discountPercent?.toNumber(),
              amount: body.discountAmount ?? existing.discountAmount?.toNumber(),
              type: body.discountType ?? existing.discountType,
            },
            body.adjustment ?? existing.adjustment?.toNumber()
          )

          const amountPaid = existing.amountPaid.toNumber()
          totals.amountDue = Math.max(0, totals.total - amountPaid)

          Object.assign(invoiceData, totals)
        }

        const updateData: any = { ...invoiceData }
        if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate)

        return tx.invoice.update({
          where: { id },
          data: updateData,
          include: { contact: true, items: { orderBy: { sortOrder: 'asc' } } },
        })
      })

      await logActivity(id, 'updated', userId, 'Fatura atualizada')

      return reply.send({ invoice })
    }
  )

  // Alterar status
  fastify.patch('/:id/status', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const { status } = z.object({
        status: z.enum(['DRAFT', 'SENT', 'CANCELLED']),
      }).parse(request.body)

      const existing = await prisma.invoice.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Fatura não encontrada' })

      const updateData: any = { status }
      if (status === 'SENT') updateData.sentAt = new Date()

      await prisma.invoice.updateMany({ where: { id, companyId }, data: updateData })
      const invoice = await prisma.invoice.findFirst({ where: { id, companyId } })

      await logActivity(id, 'status_changed', userId, `Status alterado para ${status}`, {
        oldStatus: existing.status,
        newStatus: status,
      })

      return reply.send({ invoice })
    }
  )

  // Deletar fatura
  fastify.delete('/:id', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.invoice.findFirst({
        where: { id, companyId },
        include: { _count: { select: { payments: true } } },
      })
      if (!existing) return reply.status(404).send({ error: 'Fatura não encontrada' })

      if (existing._count.payments > 0) {
        return reply.status(400).send({ error: 'Não é possível excluir fatura com pagamentos registrados' })
      }

      await prisma.invoice.deleteMany({ where: { id, companyId } })
      return reply.status(204).send()
    }
  )
}

export { updateInvoicePaymentStatus }
