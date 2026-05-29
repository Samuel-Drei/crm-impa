import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { getNextNumber } from '../../core/documents/document-counter.js'
import { logActivityByContact } from '../customers/customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listProposalsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVISED']).optional(),
  type: z.enum(['PROPOSAL', 'ESTIMATE']).optional(),
  contactId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

const proposalItemSchema = z.object({
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
  isOptional: z.boolean().default(false),
  isSelected: z.boolean().default(true),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY']).optional(),
})

const createProposalSchema = z.object({
  type: z.enum(['PROPOSAL', 'ESTIMATE']).default('PROPOSAL'),
  contactId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  prefix: z.string().optional(),
  date: z.string().optional(),
  validUntil: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  adjustment: z.number().optional(),
  currency: z.string().default('BRL'),
  assignedTo: z.string().uuid().optional(),
  terms: z.string().optional(),
  clientNote: z.string().optional(),
  internalNote: z.string().optional(),
  items: z.array(proposalItemSchema).min(1),
})

const updateProposalSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  contactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  validUntil: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  adjustment: z.number().optional(),
  currency: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  terms: z.string().optional(),
  clientNote: z.string().optional(),
  internalNote: z.string().optional(),
  items: z.array(proposalItemSchema).optional(),
})

const addCommentSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().default(false),
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
  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0)
  const taxTotal = items.reduce((sum, item) => sum + (item.taxAmount || 0), 0)

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
  }
}

async function logActivity(proposalId: string, type: string, actorId: string, content?: string, meta?: any) {
  await prisma.proposalActivity.create({
    data: {
      proposalId,
      type,
      content,
      actorId,
      actorType: 'user',
      metadata: meta,
    },
  })
}

// ── Routes ───────────────────────────────────────────────

export async function proposalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar propostas
  fastify.get('/', { preHandler: [requirePermission('proposals:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listProposalsQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { number: { equals: parseInt(query.search) || -1 } },
        ]
      }
      if (query.status) where.status = query.status
      if (query.type) where.type = query.type
      if (query.contactId) where.contactId = query.contactId
      if (query.assignedTo) where.assignedTo = query.assignedTo
      if (query.dateFrom || query.dateTo) {
        where.date = {}
        if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
        if (query.dateTo) where.date.lte = new Date(query.dateTo)
      }

      const [proposals, total] = await Promise.all([
        prisma.proposal.findMany({
          where,
          include: {
            contact: { select: { id: true, name: true, email: true, phoneNumber: true } },
            opportunity: { select: { id: true, title: true } },
            _count: { select: { items: true, comments: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.proposal.count({ where }),
      ])

      return reply.send({ proposals, total, page: query.page, limit: query.limit })
    }
  )

  // Obter proposta por ID
  fastify.get('/:id', { preHandler: [requirePermission('proposals:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const proposal = await prisma.proposal.findFirst({
        where: { id, companyId },
        include: {
          contact: true,
          opportunity: { select: { id: true, title: true, stage: true } },
          items: {
            include: {
              item: { select: { id: true, name: true, slug: true } },
              variant: { select: { id: true, name: true } },
              bundle: { select: { id: true, name: true } },
            },
            orderBy: { sortOrder: 'asc' },
          },
          comments: { orderBy: { createdAt: 'desc' } },
          activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      })

      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })
      return reply.send({ proposal })
    }
  )

  // Obter proposta por hash (público, sem auth)
  fastify.get('/public/:hash',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { hash } = z.object({ hash: z.string().uuid() }).parse(request.params)

      const proposal = await prisma.proposal.findUnique({
        where: { hash },
        select: {
          id: true,
          number: true,
          prefix: true,
          type: true,
          title: true,
          content: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          currency: true,
          date: true,
          validUntil: true,
          status: true,
          viewedAt: true,
          acceptedAt: true,
          declinedAt: true,
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
              isOptional: true,
              isSelected: true,
              billingCycle: true,
            },
          },
        },
      })

      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })

      // Registrar visualização
      if (!proposal.viewedAt) {
        await prisma.proposal.update({
          where: { id: proposal.id },
          data: { viewedAt: new Date(), status: proposal.status === 'SENT' ? 'VIEWED' : undefined },
        })
        await logActivity(proposal.id, 'viewed', 'system', 'Proposta visualizada pelo cliente')
      }

      return reply.send({ proposal })
    }
  )

  // Criar proposta
  fastify.post('/', { preHandler: [requirePermission('proposals:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createProposalSchema.parse(request.body)

      // Validar contato
      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, companyId } })
      if (!contact) return reply.status(404).send({ error: 'Contato não encontrado' })

      // Validar oportunidade se fornecida
      if (body.opportunityId) {
        const card = await prisma.card.findFirst({ where: { id: body.opportunityId, companyId } })
        if (!card) return reply.status(404).send({ error: 'Oportunidade não encontrada' })
      }

      const prefix = body.prefix || (body.type === 'ESTIMATE' ? 'ORC-' : 'PROP-')
      const number = await getNextNumber(companyId, 'proposal', prefix)

      // Calcular totais dos itens
      const processedItems = body.items.map((item, idx) => {
        const calc = calculateItemTotal(item)
        return { ...item, ...calc, sortOrder: item.sortOrder ?? idx }
      })

      const totals = calculateTotals(
        processedItems,
        { percent: body.discountPercent, amount: body.discountAmount, type: body.discountType },
        body.adjustment
      )

      const proposal = await prisma.proposal.create({
        data: {
          companyId,
          number,
          prefix,
          type: body.type,
          contactId: body.contactId,
          opportunityId: body.opportunityId,
          title: body.title,
          content: body.content,
          date: body.date ? new Date(body.date) : new Date(),
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          discountPercent: body.discountPercent,
          discountAmount: body.discountAmount,
          discountType: body.discountType,
          adjustment: body.adjustment,
          currency: body.currency,
          assignedTo: body.assignedTo,
          terms: body.terms,
          clientNote: body.clientNote,
          internalNote: body.internalNote,
          createdBy: userId,
          ...totals,
          items: {
            create: processedItems,
          },
        },
        include: {
          contact: true,
          items: true,
        },
      })

      await logActivity(proposal.id, 'created', userId, `Proposta ${prefix}${number} criada`)
      logActivityByContact({ companyId, contactId: body.contactId, userId, action: 'PROPOSAL_CREATED', entity: 'proposal', entityId: proposal.id, description: `Proposta ${prefix}${number} criada` })

      return reply.status(201).send({ proposal })
    }
  )

  // Atualizar proposta
  fastify.put('/:id', { preHandler: [requirePermission('proposals:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = updateProposalSchema.parse(request.body)

      const existing = await prisma.proposal.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Proposta não encontrada' })

      if (['ACCEPTED', 'DECLINED'].includes(existing.status)) {
        return reply.status(400).send({ error: 'Não é possível editar uma proposta aceita ou recusada' })
      }

      const { items, ...proposalData } = body

      const proposal = await prisma.$transaction(async (tx) => {
        if (items) {
          await tx.proposalItem.deleteMany({ where: { proposalId: id } })

          const processedItems = items.map((item, idx) => {
            const calc = calculateItemTotal(item)
            return { ...item, ...calc, sortOrder: item.sortOrder ?? idx, proposalId: id }
          })

          await tx.proposalItem.createMany({ data: processedItems })

          const totals = calculateTotals(
            processedItems,
            {
              percent: body.discountPercent ?? existing.discountPercent?.toNumber(),
              amount: body.discountAmount ?? existing.discountAmount?.toNumber(),
              type: body.discountType ?? existing.discountType,
            },
            body.adjustment ?? existing.adjustment?.toNumber()
          )

          Object.assign(proposalData, totals)
        }

        const updateData: any = { ...proposalData }
        if (updateData.validUntil) updateData.validUntil = new Date(updateData.validUntil)

        return tx.proposal.update({
          where: { id },
          data: updateData,
          include: { contact: true, items: { orderBy: { sortOrder: 'asc' } } },
        })
      })

      await logActivity(id, 'updated', userId, 'Proposta atualizada')

      return reply.send({ proposal })
    }
  )

  // Alterar status da proposta
  fastify.patch('/:id/status', { preHandler: [requirePermission('proposals:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const { status } = z.object({
        status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVISED']),
      }).parse(request.body)

      const existing = await prisma.proposal.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Proposta não encontrada' })

      const updateData: any = { status }

      if (status === 'SENT') updateData.sentAt = new Date()
      if (status === 'ACCEPTED') updateData.acceptedAt = new Date()
      if (status === 'DECLINED') updateData.declinedAt = new Date()

      const proposal = await prisma.proposal.update({
        where: { id },
        data: updateData,
      })

      await logActivity(id, 'status_changed', userId, `Status alterado para ${status}`, {
        oldStatus: existing.status,
        newStatus: status,
      })

      return reply.send({ proposal })
    }
  )

  // Aceitar proposta (público via hash)
  fastify.post('/public/:hash/accept',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { hash } = z.object({ hash: z.string().uuid() }).parse(request.params)
      const body = z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
      }).parse(request.body)

      // Rate limit por IP (5 tentativas por 5 minutos)
      const ip = request.ip
      const { redis } = await import('../../config/redis.js')
      try {
        const rlKey = `ratelimit:proposal-accept:${ip}`
        const current = await redis.incr(rlKey)
        if (current === 1) await redis.expire(rlKey, 300)
        if (current > 5) return reply.status(429).send({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' })
      } catch { /* FAIL CLOSED handled by general catch */ }

      const proposal = await prisma.proposal.findUnique({ where: { hash } })
      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })
      if (proposal.status === 'ACCEPTED') return reply.status(400).send({ error: 'Proposta já foi aceita' })
      if (proposal.status === 'EXPIRED') return reply.status(400).send({ error: 'Proposta expirada' })

      await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptanceName: body.name,
          acceptanceEmail: body.email,
          acceptanceIp: ip,
        },
      })

      await logActivity(proposal.id, 'accepted', 'client', `Aceita por ${body.name}`, { ip })

      return reply.send({ success: true, message: 'Proposta aceita com sucesso' })
    }
  )

  // Recusar proposta (público via hash)
  fastify.post('/public/:hash/decline',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { hash } = z.object({ hash: z.string().uuid() }).parse(request.params)
      const body = z.object({
        reason: z.string().optional(),
      }).parse(request.body)

      // Rate limit por IP (5 tentativas por 5 minutos)
      const ip = request.ip
      const { redis } = await import('../../config/redis.js')
      try {
        const rlKey = `ratelimit:proposal-decline:${ip}`
        const current = await redis.incr(rlKey)
        if (current === 1) await redis.expire(rlKey, 300)
        if (current > 5) return reply.status(429).send({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' })
      } catch { /* FAIL CLOSED */ }

      const proposal = await prisma.proposal.findUnique({ where: { hash } })
      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })
      if (proposal.status === 'ACCEPTED') return reply.status(400).send({ error: 'Proposta já foi aceita' })

      await prisma.proposal.update({
        where: { id: proposal.id },
        data: { status: 'DECLINED', declinedAt: new Date() },
      })

      await logActivity(proposal.id, 'declined', 'client', body.reason || 'Proposta recusada pelo cliente')

      return reply.send({ success: true })
    }
  )

  // Converter proposta em fatura
  fastify.post('/:id/convert-to-invoice', { preHandler: [requirePermission('invoices:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub

      const proposal = await prisma.proposal.findFirst({
        where: { id, companyId },
        include: { items: true },
      })

      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })
      if (proposal.status !== 'ACCEPTED') {
        return reply.status(400).send({ error: 'Apenas propostas aceitas podem ser convertidas em fatura' })
      }

      // Verificar se já foi convertida
      const existingInvoice = await prisma.invoice.findUnique({ where: { proposalId: id } })
      if (existingInvoice) return reply.status(409).send({ error: 'Proposta já foi convertida em fatura' })

      const invoiceNumber = await getNextNumber(companyId, 'invoice', 'FAT-')

      const invoice = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            companyId,
            number: invoiceNumber,
            prefix: 'FAT-',
            contactId: proposal.contactId,
            proposalId: id,
            subtotal: proposal.subtotal,
            discountPercent: proposal.discountPercent,
            discountAmount: proposal.discountAmount,
            discountType: proposal.discountType,
            taxTotal: proposal.taxTotal,
            adjustment: proposal.adjustment,
            total: proposal.total,
            amountDue: proposal.total,
            currency: proposal.currency,
            terms: proposal.terms,
            clientNote: proposal.clientNote,
            createdBy: userId,
            items: {
              create: proposal.items.map(item => ({
                itemId: item.itemId,
                variantId: item.variantId,
                bundleId: item.bundleId,
                description: item.description,
                longDescription: item.longDescription,
                quantity: item.quantity,
                unit: item.unit,
                rate: item.rate,
                taxRate: item.taxRate,
                taxAmount: item.taxAmount,
                discount: item.discount,
                total: item.total,
                sortOrder: item.sortOrder,
                billingCycle: item.billingCycle,
              })),
            },
          },
          include: { items: true },
        })

        await tx.proposal.update({
          where: { id },
          data: { convertedAt: new Date() },
        })

        return inv
      })

      await logActivity(id, 'converted_to_invoice', userId, `Convertida em fatura FAT-${invoiceNumber}`)

      return reply.status(201).send({ invoice })
    }
  )

  // Adicionar comentário
  fastify.post('/:id/comments', { preHandler: [requirePermission('proposals:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = addCommentSchema.parse(request.body)

      const proposal = await prisma.proposal.findFirst({ where: { id, companyId } })
      if (!proposal) return reply.status(404).send({ error: 'Proposta não encontrada' })

      const comment = await prisma.proposalComment.create({
        data: {
          proposalId: id,
          content: body.content,
          authorId: request.user.sub,
          authorName: request.user.name,
          isInternal: body.isInternal,
        },
      })

      return reply.status(201).send({ comment })
    }
  )

  // Deletar proposta
  fastify.delete('/:id', { preHandler: [requirePermission('proposals:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.proposal.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Proposta não encontrada' })

      if (existing.status === 'ACCEPTED') {
        return reply.status(400).send({ error: 'Não é possível excluir uma proposta aceita' })
      }

      await prisma.proposal.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}
