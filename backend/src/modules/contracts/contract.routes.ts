import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { getNextNumber } from '../../core/documents/document-counter.js'
import { CONTRACT_TEMPLATES } from './contract-templates.js'
import { logActivityByContact } from '../customers/customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listContractsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING_SIGNATURE', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'RENEWED', 'CANCELLED']).optional(),
  contactId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

// Aceita tanto o formato novo (contactId/title/typeId) quanto o legacy do frontend
// (customerId = customerAccountId, subject = title, type = typeId, notes/autoRenew/renewalDays ignorados).
const createContractSchema = z.object({
  contactId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  proposalId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  subject: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  value: z.number().min(0).optional(),
  typeId: z.string().optional(),
  type: z.string().optional(),
  prefix: z.string().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
  autoRenew: z.boolean().optional(),
  renewalDays: z.number().optional(),
}).refine(d => !!(d.contactId || d.customerId), { message: 'contactId ou customerId é obrigatório' })
  .refine(d => !!(d.title || d.subject), { message: 'title ou subject é obrigatório' })

const updateContractSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  subject: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  value: z.number().min(0).optional(),
  typeId: z.string().optional(),
  type: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
  autoRenew: z.boolean().optional(),
  renewalDays: z.number().optional(),
  customerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
})

const renewContractSchema = z.object({
  newStartDate: z.string(),
  newEndDate: z.string().optional(),
  newValue: z.number().min(0).optional(),
})

const createTemplateSchema = z.object({
  name: z.string().min(1).max(300),
  category: z.string().min(1).max(100),
  description: z.string().optional(),
  icon: z.string().optional(),
  content: z.string().min(1),
})

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  content: z.string().min(1).optional(),
})

// ── Helpers ──────────────────────────────────────────────

async function logActivity(contractId: string, type: string, actorId: string, content?: string, meta?: any) {
  await prisma.contractActivity.create({
    data: {
      contractId,
      type,
      content,
      actorId,
      actorType: 'user',
      metadata: meta,
    },
  })
}

// ── Routes ───────────────────────────────────────────────

export async function contractRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── TEMPLATES ──────────────────────────────────────────

  // Listar templates (nativos + personalizados)
  fastify.get('/templates', { preHandler: [requirePermission('contracts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const userTemplates = await prisma.contractTemplate.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
      })

      const native = CONTRACT_TEMPLATES.map(t => ({ ...t, isDefault: true }))
      const custom = userTemplates.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description || '',
        icon: t.icon || '📄',
        content: t.content,
        isDefault: false,
      }))

      return reply.send({ templates: [...native, ...custom] })
    }
  )

  // Criar template personalizado
  fastify.post('/templates', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createTemplateSchema.parse(request.body)

      const template = await prisma.contractTemplate.create({
        data: {
          companyId,
          name: body.name,
          category: body.category,
          description: body.description,
          icon: body.icon || '📄',
          content: body.content,
          createdBy: userId,
        },
      })

      return reply.status(201).send({ template: { ...template, isDefault: false } })
    }
  )

  // Atualizar template (somente personalizados)
  fastify.put('/templates/:id', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateTemplateSchema.parse(request.body)

      const existing = await prisma.contractTemplate.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Template não encontrado ou é um modelo padrão' })

      const template = await prisma.contractTemplate.update({
        where: { id },
        data: body,
      })

      return reply.send({ template: { ...template, isDefault: false } })
    }
  )

  // Clonar template (nativo ou personalizado)
  fastify.post('/templates/:id/clone', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub

      // Tentar encontrar no banco (user template)
      let source: { name: string; category: string; description: string | null; icon: string | null; content: string } | null = null

      const dbTemplate = await prisma.contractTemplate.findFirst({ where: { id, companyId } })
      if (dbTemplate) {
        source = dbTemplate
      } else {
        // Buscar nos nativos
        const native = CONTRACT_TEMPLATES.find(t => t.id === id)
        if (native) {
          source = { name: native.name, category: native.category, description: native.description, icon: native.icon, content: native.content }
        }
      }

      if (!source) return reply.status(404).send({ error: 'Template não encontrado' })

      const template = await prisma.contractTemplate.create({
        data: {
          companyId,
          name: `${source.name} (cópia)`,
          category: source.category,
          description: source.description,
          icon: source.icon || '📄',
          content: source.content,
          createdBy: userId,
        },
      })

      return reply.status(201).send({ template: { ...template, isDefault: false } })
    }
  )

  // Deletar template (somente personalizados)
  fastify.delete('/templates/:id', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.contractTemplate.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Template não encontrado ou é um modelo padrão' })

      await prisma.contractTemplate.delete({ where: { id } })
      return reply.status(204).send()
    }
  )

  // Dados para auto-preenchimento de merge fields
  // Aceita contactId OU customerAccountId — resolve para o primary contact se for account
  fastify.get('/merge-data/:contactId', { preHandler: [requirePermission('contracts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId: rawId } = z.object({ contactId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId

      // Tenta como Contact primeiro
      let resolvedContactId: string | null = null
      const directContact = await prisma.contact.findFirst({ where: { id: rawId, companyId }, select: { id: true } })
      if (directContact) {
        resolvedContactId = directContact.id
      } else {
        // Tenta como CustomerAccount → primary contact
        const acc = await prisma.customerAccount.findFirst({
          where: { id: rawId, companyId },
          include: {
            members: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
              select: { contactId: true },
            },
          },
        })
        resolvedContactId = acc?.members[0]?.contactId ?? null
      }

      if (!resolvedContactId) return reply.status(404).send({ error: 'Contato não encontrado' })

      const [contact, company] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: resolvedContactId, companyId },
          include: {
            organization: { select: { name: true } },
            accountMemberships: {
              include: {
                customerAccount: {
                  select: { billingName: true, billingEmail: true, billingAddress: true, taxId: true },
                },
              },
              take: 1,
            },
          },
        }),
        prisma.company.findUnique({
          where: { id: companyId },
          select: { name: true, document: true, email: true },
        }),
      ])

      if (!contact) return reply.status(404).send({ error: 'Contato não encontrado' })

      const account = contact.accountMemberships?.[0]?.customerAccount
      const addr = (account?.billingAddress as any) || {}
      const addressParts = [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state, addr.zip].filter(Boolean)

      return reply.send({
        mergeData: {
          '{{CONTRATANTE_NOME}}': account?.billingName || contact.organization?.name || contact.name,
          '{{CONTRATANTE_DOCUMENTO}}': account?.taxId || '',
          '{{CONTRATANTE_ENDERECO}}': addressParts.join(', ') || '',
          '{{CONTRATANTE_EMAIL}}': account?.billingEmail || contact.email || '',
          '{{CONTRATADA_NOME}}': company?.name || '',
          '{{CONTRATADA_DOCUMENTO}}': company?.document || '',
          '{{CONTRATADA_EMAIL}}': company?.email || '',
        },
      })
    }
  )

  // ── CONTRATOS ──────────────────────────────────────────

  // Listar contratos
  fastify.get('/', { preHandler: [requirePermission('contracts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listContractsQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { number: { equals: parseInt(query.search) || -1 } },
        ]
      }
      if (query.status) where.status = query.status
      if (query.contactId) where.contactId = query.contactId
      if (query.dateFrom || query.dateTo) {
        where.startDate = {}
        if (query.dateFrom) where.startDate.gte = new Date(query.dateFrom)
        if (query.dateTo) where.startDate.lte = new Date(query.dateTo)
      }

      const [contracts, total] = await Promise.all([
        prisma.contract.findMany({
          where,
          include: {
            contact: { select: { id: true, name: true, email: true } },
            proposal: { select: { id: true, number: true, prefix: true, title: true } },
            _count: { select: { renewals: true, projects: true, tasks: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.contract.count({ where }),
      ])

      return reply.send({ contracts, total, page: query.page, limit: query.limit })
    }
  )

  // Obter contrato por ID
  fastify.get('/:id', { preHandler: [requirePermission('contracts:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const contract = await prisma.contract.findFirst({
        where: { id, companyId },
        include: {
          contact: true,
          proposal: { select: { id: true, number: true, prefix: true, title: true } },
          renewals: { orderBy: { renewedAt: 'desc' } },
          projects: { select: { id: true, name: true, status: true } },
          tasks: { select: { id: true, name: true, status: true }, take: 10, orderBy: { createdAt: 'desc' } },
          activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      })

      if (!contract) return reply.status(404).send({ error: 'Contrato não encontrado' })
      return reply.send({ contract })
    }
  )

  // Obter contrato por hash (público)
  fastify.get('/public/:hash',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { hash } = z.object({ hash: z.string().uuid() }).parse(request.params)

      const contract = await prisma.contract.findUnique({
        where: { hash },
        select: {
          id: true,
          number: true,
          prefix: true,
          title: true,
          description: true,
          content: true,
          value: true,
          startDate: true,
          endDate: true,
          status: true,
          signedAt: true,
          hash: true,
          contact: { select: { name: true } },
          company: { select: { name: true } },
        },
      })

      if (!contract) return reply.status(404).send({ error: 'Contrato não encontrado' })
      return reply.send({ contract })
    }
  )

  // Criar contrato
  fastify.post('/', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createContractSchema.parse(request.body)

      // Resolve contactId — aceita customerId (customerAccountId) → primary contact da account
      let contactId = body.contactId
      if (!contactId && body.customerId) {
        const acc = await prisma.customerAccount.findFirst({
          where: { id: body.customerId, companyId },
          include: {
            members: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
              select: { contactId: true },
            },
          },
        })
        if (!acc) return reply.status(404).send({ error: 'Cliente não encontrado' })
        contactId = acc.members[0]?.contactId
        if (!contactId) return reply.status(400).send({ error: 'Cliente não possui contato vinculado' })
      }
      if (!contactId) return reply.status(400).send({ error: 'contactId ou customerId é obrigatório' })

      const contact = await prisma.contact.findFirst({ where: { id: contactId, companyId } })
      if (!contact) return reply.status(404).send({ error: 'Contato não encontrado' })

      const prefix = body.prefix || 'CONT-'
      const number = await getNextNumber(companyId, 'contract', prefix)

      const title = body.title || body.subject!
      const typeId = body.typeId || body.type

      const contract = await prisma.contract.create({
        data: {
          companyId,
          number,
          prefix,
          contactId,
          proposalId: body.proposalId,
          title,
          description: body.description,
          content: body.content,
          value: body.value,
          typeId,
          startDate: new Date(body.startDate),
          endDate: body.endDate ? new Date(body.endDate) : null,
          createdBy: userId,
        },
        include: { contact: true },
      })

      await logActivity(contract.id, 'created', userId, `Contrato ${prefix}${number} criado`)
      logActivityByContact({ companyId, contactId, userId, action: 'CONTRACT_CREATED', entity: 'contract', entityId: contract.id, description: `Contrato ${prefix}${number} criado` })

      return reply.status(201).send({ contract })
    }
  )

  // Atualizar contrato
  fastify.put('/:id', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = updateContractSchema.parse(request.body)

      const existing = await prisma.contract.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Contrato não encontrado' })

      const updateData: any = { ...body }
      // Mapeia aliases legacy → campos reais e remove os que não pertencem ao schema do Contract
      if (updateData.subject && !updateData.title) updateData.title = updateData.subject
      if (updateData.type && !updateData.typeId) updateData.typeId = updateData.type
      delete updateData.subject
      delete updateData.type
      delete updateData.notes
      delete updateData.autoRenew
      delete updateData.renewalDays
      delete updateData.customerId
      delete updateData.contactId
      if (updateData.startDate) updateData.startDate = new Date(updateData.startDate)
      if (updateData.endDate) updateData.endDate = new Date(updateData.endDate)

      await prisma.contract.updateMany({
        where: { id, companyId },
        data: updateData,
      })
      const contract = await prisma.contract.findFirst({
        where: { id, companyId },
        include: { contact: true },
      })

      await logActivity(id, 'updated', userId, 'Contrato atualizado')

      return reply.send({ contract })
    }
  )

  // Alterar status
  fastify.patch('/:id/status', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const { status } = z.object({
        status: z.enum(['DRAFT', 'PENDING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
      }).parse(request.body)

      const existing = await prisma.contract.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Contrato não encontrado' })

      const updateData: any = { status }
      if (status === 'ACTIVE' && !existing.signedAt) {
        updateData.signedAt = new Date()
      }

      await prisma.contract.updateMany({ where: { id, companyId }, data: updateData })
      const contract = await prisma.contract.findFirst({ where: { id, companyId } })

      await logActivity(id, 'status_changed', userId, `Status alterado para ${status}`, {
        oldStatus: existing.status,
        newStatus: status,
      })

      return reply.send({ contract })
    }
  )

  // Assinar contrato (público)
  fastify.post('/public/:hash/sign',
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
        const rlKey = `ratelimit:contract-sign:${ip}`
        const current = await redis.incr(rlKey)
        if (current === 1) await redis.expire(rlKey, 300)
        if (current > 5) return reply.status(429).send({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' })
      } catch { /* FAIL CLOSED */ }

      const contract = await prisma.contract.findUnique({ where: { hash } })
      if (!contract) return reply.status(404).send({ error: 'Contrato não encontrado' })
      if (contract.status === 'ACTIVE') return reply.status(400).send({ error: 'Contrato já assinado' })

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: 'ACTIVE',
          signedAt: new Date(),
          signedByName: body.name,
          signedByEmail: body.email,
          signedByIp: ip,
        },
      })

      await logActivity(contract.id, 'signed', 'client', `Assinado por ${body.name}`, { ip })

      return reply.send({ success: true, message: 'Contrato assinado com sucesso' })
    }
  )

  // Renovar contrato
  fastify.post('/:id/renew', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = renewContractSchema.parse(request.body)

      const existing = await prisma.contract.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Contrato não encontrado' })

      const contract = await prisma.$transaction(async (tx) => {
        // Salvar histórico de renovação
        await tx.contractRenewal.create({
          data: {
            contractId: id,
            oldStartDate: existing.startDate,
            oldEndDate: existing.endDate,
            oldValue: existing.value,
            newStartDate: new Date(body.newStartDate),
            newEndDate: body.newEndDate ? new Date(body.newEndDate) : null,
            newValue: body.newValue,
            renewedBy: userId,
          },
        })

        // Atualizar contrato
        await tx.contract.updateMany({
          where: { id, companyId },
          data: {
            startDate: new Date(body.newStartDate),
            endDate: body.newEndDate ? new Date(body.newEndDate) : null,
            value: body.newValue ?? existing.value,
            status: 'RENEWED',
          },
        })
        return tx.contract.findFirst({
          where: { id, companyId },
          include: { contact: true, renewals: true },
        })
      })

      await logActivity(id, 'renewed', userId, 'Contrato renovado')

      return reply.send({ contract })
    }
  )

  // Deletar contrato
  fastify.delete('/:id', { preHandler: [requirePermission('contracts:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.contract.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Contrato não encontrado' })

      if (existing.status === 'ACTIVE') {
        return reply.status(400).send({ error: 'Não é possível excluir um contrato ativo' })
      }

      await prisma.contract.deleteMany({ where: { id, companyId } })
      return reply.status(204).send()
    }
  )
}
