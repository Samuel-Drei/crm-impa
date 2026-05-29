import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['OPEN', 'APPLIED', 'VOID']).optional(),
  contactId: z.string().uuid().optional(),
})

const createSchema = z.object({
  contactId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  amount: z.number().min(0.01),
  reason: z.string().optional(),
  note: z.string().optional(),
})

const applySchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().min(0.01),
})

// ── Credit Note Routes ───────────────────────────────────

export async function creditNoteRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar notas de crédito
  fastify.get('/', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listQuery.parse(request.query)

      const where: any = { companyId }
      if (query.status) where.status = query.status
      if (query.contactId) where.contactId = query.contactId

      const [creditNotes, total] = await Promise.all([
        prisma.creditNote.findMany({
          where,
          include: {
            invoice: { select: { id: true, number: true, prefix: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.creditNote.count({ where }),
      ])

      return reply.send({ creditNotes, total, page: query.page, limit: query.limit })
    }
  )

  // Obter por ID
  fastify.get('/:id', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const creditNote = await prisma.creditNote.findFirst({
        where: { id, companyId },
        include: { invoice: true },
      })

      if (!creditNote) return reply.status(404).send({ error: 'Nota de crédito não encontrada' })
      return reply.send({ creditNote })
    }
  )

  // Criar nota de crédito
  fastify.post('/', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createSchema.parse(request.body)

      // Obter próximo número
      const lastNote = await prisma.creditNote.findFirst({
        where: { companyId },
        orderBy: { number: 'desc' },
        select: { number: true },
      })
      const nextNumber = (lastNote?.number || 0) + 1

      const creditNote = await prisma.creditNote.create({
        data: {
          companyId,
          number: nextNumber,
          contactId: body.contactId,
          invoiceId: body.invoiceId,
          amount: body.amount,
          amountRemaining: body.amount,
          reason: body.reason,
          note: body.note,
          createdBy: userId,
        },
        include: { invoice: true },
      })

      return reply.status(201).send({ creditNote })
    }
  )

  // Aplicar crédito a uma fatura
  fastify.post('/:id/apply', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = applySchema.parse(request.body)

      const creditNote = await prisma.creditNote.findFirst({ where: { id, companyId } })
      if (!creditNote) return reply.status(404).send({ error: 'Nota de crédito não encontrada' })
      if (creditNote.status === 'VOID') return reply.status(400).send({ error: 'Nota de crédito anulada' })

      const remaining = Number(creditNote.amountRemaining)
      if (body.amount > remaining) {
        return reply.status(400).send({ error: `Saldo disponível: R$ ${remaining.toFixed(2)}` })
      }

      // Verificar fatura
      const invoice = await prisma.invoice.findFirst({ where: { id: body.invoiceId, companyId } })
      if (!invoice) return reply.status(404).send({ error: 'Fatura não encontrada' })

      const newRemaining = remaining - body.amount
      const newUsed = Number(creditNote.amountUsed) + body.amount

      // Atualizar nota de crédito e fatura em transação
      const [updated] = await prisma.$transaction([
        prisma.creditNote.update({
          where: { id },
          data: {
            amountUsed: newUsed,
            amountRemaining: newRemaining,
            status: newRemaining <= 0 ? 'APPLIED' : 'OPEN',
          },
        }),
        prisma.invoice.update({
          where: { id: body.invoiceId },
          data: {
            amountPaid: { increment: body.amount },
            amountDue: { decrement: body.amount },
          },
        }),
      ])

      return reply.send({ creditNote: updated })
    }
  )

  // Anular nota de crédito
  fastify.patch('/:id/void', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const creditNote = await prisma.creditNote.findFirst({ where: { id, companyId } })
      if (!creditNote) return reply.status(404).send({ error: 'Nota de crédito não encontrada' })
      if (creditNote.status === 'VOID') return reply.status(400).send({ error: 'Já está anulada' })
      if (Number(creditNote.amountUsed) > 0) {
        return reply.status(400).send({ error: 'Nota de crédito já foi parcialmente aplicada. Não pode anular.' })
      }

      const updated = await prisma.creditNote.update({
        where: { id },
        data: { status: 'VOID' },
      })

      return reply.send({ creditNote: updated })
    }
  )
}
