import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { CustomerAccountContactRole, CustomerStatus } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logConversationEvent } from '../conversations/conversation-events.service.js'
import { logCustomerActivity } from './customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'CHURNED']).optional(),
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
})

const createSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  billingName: z.string().min(1).max(300).optional(),
  billingEmail: z.string().email().optional().or(z.literal('')),
  billingAddress: z.any().optional(),
  shippingAddress: z.any().optional(),
  taxId: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTermDays: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  customFields: z.any().optional(),
  contactIds: z.array(z.string().uuid()).optional(),
})

const updateSchema = createSchema.partial()

const addContactSchema = z.object({
  contactId: z.string().uuid(),
  role: z.enum(['ADMIN', 'BILLING', 'TECHNICAL', 'MEMBER']).default('MEMBER'),
  isPrimary: z.boolean().default(false),
})

// ── Customer Account Routes ──────────────────────────────

export async function customerAccountRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar contas
  fastify.get('/', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listQuery.parse(request.query)

      const where: any = { companyId }
      if (query.search) {
        where.OR = [
          { billingName: { contains: query.search, mode: 'insensitive' } },
          { billingEmail: { contains: query.search, mode: 'insensitive' } },
          { taxId: { contains: query.search, mode: 'insensitive' } },
        ]
      }
      if (query.status) where.status = query.status
      if (query.accountType) where.accountType = query.accountType

      const [accounts, total] = await Promise.all([
        prisma.customerAccount.findMany({
          where,
          include: {
            organization: { select: { id: true, name: true } },
            members: {
              include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true } } },
              orderBy: { isPrimary: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.customerAccount.count({ where }),
      ])

      return reply.send({ accounts, total, page: query.page, limit: query.limit })
    }
  )

  // Obter por ID
  fastify.get('/:id', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const account = await prisma.customerAccount.findFirst({
        where: { id, companyId },
        include: {
          organization: true,
          members: {
            include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true, profilePicture: true } } },
            orderBy: { isPrimary: 'desc' },
          },
        },
      })

      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })
      return reply.send({ account })
    }
  )

  // Criar conta
  fastify.post('/', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createSchema.parse(request.body)

      const { contactIds, ...data } = body

      const account = await prisma.customerAccount.create({
        data: {
          companyId,
          createdBy: userId,
          ...data,
        },
        include: { organization: true, members: true },
      })

      // Adicionar contatos iniciais
      if (contactIds && contactIds.length > 0) {
        await prisma.customerAccountContact.createMany({
          data: contactIds.map((contactId, i) => ({
            customerAccountId: account.id,
            contactId,
            isPrimary: i === 0,
          })),
          skipDuplicates: true,
        })
      }

      const full = await prisma.customerAccount.findUnique({
        where: { id: account.id },
        include: {
          organization: true,
          members: { include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true } } } },
        },
      })

      // Log conversation event for each linked contact
      if (contactIds && contactIds.length > 0) {
        const userName = request.user.name || 'Usuário'
        for (const contactId of contactIds) {
          const conversation = await prisma.conversation.findFirst({
            where: { contactId, companyId },
            select: { id: true, instanceId: true, remoteJid: true },
            orderBy: { lastActivityAt: 'desc' },
          })
          if (conversation) {
            const contact = full?.members?.find(m => m.contactId === contactId)?.contact
            logConversationEvent({
              conversationId: conversation.id,
              instanceId: conversation.instanceId,
              remoteJid: conversation.remoteJid,
              eventType: 'customer_created',
              description: `${userName} criou conta de cliente para ${contact?.name || 'contato'}`,
              actorType: 'user',
              actorName: userName,
              metadata: { accountId: account.id, contactId, billingName: data.billingName },
            })
          }
        }
      }

      // Log activity
      logCustomerActivity({ companyId, customerAccountId: account.id, userId, action: 'CREATED', entity: 'customer', entityId: account.id, description: `Conta de cliente "${data.billingName || 'Sem nome'}" criada` })

      return reply.status(201).send({ account: full })
    }
  )

  // Atualizar conta
  fastify.put('/:id', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateSchema.parse(request.body)

      const existing = await prisma.customerAccount.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Conta não encontrada' })

      const { contactIds, ...data } = body

      const account = await prisma.customerAccount.update({
        where: { id },
        data,
        include: {
          organization: true,
          members: { include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true } } } },
        },
      })

      logCustomerActivity({ companyId, customerAccountId: id, userId: request.user.sub, action: 'UPDATED', entity: 'customer', entityId: id, description: `Dados da conta atualizados` })

      return reply.send({ account })
    }
  )

  // Deletar conta
  fastify.delete('/:id', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.customerAccount.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Conta não encontrada' })

      logCustomerActivity({ companyId, customerAccountId: id, userId: request.user.sub, action: 'DELETED', entity: 'customer', entityId: id, description: `Conta de cliente "${existing.billingName || 'Sem nome'}" excluída` })

      await prisma.customerAccount.delete({ where: { id } })
      return reply.status(204).send()
    }
  )

  // ── Membros da conta ──

  // Adicionar contato à conta
  fastify.post('/:id/contacts', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = addContactSchema.parse(request.body)

      const account = await prisma.customerAccount.findFirst({ where: { id, companyId } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      // Se isPrimary, desmarcar outros
      if (body.isPrimary) {
        await prisma.customerAccountContact.updateMany({
          where: { customerAccountId: id, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      const member = await prisma.customerAccountContact.upsert({
        where: { customerAccountId_contactId: { customerAccountId: id, contactId: body.contactId } },
        create: { customerAccountId: id, contactId: body.contactId, role: body.role as CustomerAccountContactRole, isPrimary: body.isPrimary },
        update: { role: body.role as CustomerAccountContactRole, isPrimary: body.isPrimary },
        include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true } } },
      })

      logCustomerActivity({ companyId, customerAccountId: id, contactId: body.contactId, userId: request.user.sub, action: 'CONTACT_ADDED', entity: 'contact', entityId: body.contactId, description: `Contato "${(member as any).contact?.name || 'N/A'}" vinculado à conta` })

      return reply.status(201).send({ member })
    }
  )

  // Remover contato da conta
  fastify.delete('/:id/contacts/:contactId', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), contactId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId

      const account = await prisma.customerAccount.findFirst({ where: { id: params.id, companyId } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      await prisma.customerAccountContact.deleteMany({
        where: { customerAccountId: params.id, contactId: params.contactId },
      })

      logCustomerActivity({ companyId, customerAccountId: params.id, contactId: params.contactId, userId: request.user.sub, action: 'CONTACT_REMOVED', entity: 'contact', entityId: params.contactId, description: `Contato desvinculado da conta` })

      return reply.status(204).send()
    }
  )

  // Atualizar status
  fastify.patch('/:id/status', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CHURNED']) }).parse(request.body)

      const existing = await prisma.customerAccount.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Conta não encontrada' })

      const account = await prisma.customerAccount.update({
        where: { id },
        data: { status: status as CustomerStatus },
      })

      logCustomerActivity({ companyId, customerAccountId: id, userId: request.user.sub, action: 'STATUS_CHANGED', entity: 'customer', entityId: id, description: `Status alterado de "${existing.status}" para "${status}"`, oldValue: existing.status, newValue: status })

      return reply.send({ account })
    }
  )

  // ── Detalhe completo (estilo Perfex: tudo do cliente) ──
  fastify.get('/:id/full', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const account = await prisma.customerAccount.findFirst({
        where: { id, companyId },
        include: {
          organization: true,
          members: {
            include: { contact: { select: { id: true, name: true, email: true, phoneNumber: true, profilePicture: true, tags: true, isActive: true } } },
            orderBy: { isPrimary: 'desc' },
          },
        },
      })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      // Collect all contact IDs from this account
      const contactIds = account.members.map(m => m.contactId)

      // Load all related data in parallel
      const [proposals, invoices, payments, contracts, projects, expenses, creditNotes] = await Promise.all([
        // Proposals linked to any of the account's contacts
        contactIds.length > 0 ? prisma.proposal.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, number: true, prefix: true, title: true, status: true, total: true, validUntil: true, createdAt: true, contact: { select: { id: true, name: true } } },
        }) : [],

        // Invoices
        contactIds.length > 0 ? prisma.invoice.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, number: true, prefix: true, status: true, total: true, amountPaid: true, dueDate: true, createdAt: true, contact: { select: { id: true, name: true } } },
        }) : [],

        // Payments
        contactIds.length > 0 ? prisma.payment.findMany({
          where: { companyId, invoice: { contactId: { in: contactIds } } },
          orderBy: { date: 'desc' },
          take: 50,
          select: { id: true, amount: true, date: true, method: true, transactionId: true, invoice: { select: { id: true, number: true, prefix: true } } },
        }) : [],

        // Contracts
        contactIds.length > 0 ? prisma.contract.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, title: true, number: true, prefix: true, status: true, startDate: true, endDate: true, value: true, contact: { select: { id: true, name: true } } },
        }) : [],

        // Projects
        contactIds.length > 0 ? prisma.project.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, name: true, status: true, progress: true, startDate: true, deadline: true, billingType: true, contact: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
        }) : [],

        // Expenses linked to any of the account's contacts
        contactIds.length > 0 ? prisma.expense.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { date: 'desc' },
          take: 50,
          select: { id: true, name: true, amount: true, date: true, categoryId: true, billable: true, category: { select: { id: true, name: true } } },
        }) : [],

        // Credit notes
        contactIds.length > 0 ? prisma.creditNote.findMany({
          where: { companyId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, number: true, status: true, amount: true, amountRemaining: true, createdAt: true },
        }) : [],
      ])

      // Financial summary
      const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0)
      const totalPaid = invoices.reduce((s, i) => s + Number(i.amountPaid || 0), 0)
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

      return reply.send({
        account,
        proposals,
        invoices,
        payments,
        contracts,
        projects,
        expenses,
        creditNotes,
        summary: {
          totalInvoiced,
          totalPaid,
          totalOutstanding: totalInvoiced - totalPaid,
          totalExpenses,
          proposalCount: proposals.length,
          invoiceCount: invoices.length,
          contractCount: contracts.length,
          projectCount: projects.length,
        },
      })
    }
  )

  // ── Activity Log: listar atividades do cliente ──
  fastify.get('/:id/activities', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50), entity: z.string().optional() }).parse(request.query)

      const where: any = { customerAccountId: id, companyId }
      if (q.entity) where.entity = q.entity

      const [activities, total] = await Promise.all([
        prisma.customerActivityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
        prisma.customerActivityLog.count({ where }),
      ])

      return reply.send({ activities, total, page: q.page, limit: q.limit })
    }
  )

  // ── Activity Log: registrar manualmente ──
  fastify.post('/:id/activities', { preHandler: [requirePermission('customers:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = z.object({ action: z.string(), entity: z.string().optional(), entityId: z.string().optional(), description: z.string(), metadata: z.any().optional() }).parse(request.body)

      const log = await prisma.customerActivityLog.create({
        data: { companyId, customerAccountId: id, userId: request.user.sub, ...body },
      })

      return reply.status(201).send({ log })
    }
  )

  // ── Tarefas do cliente ──
  fastify.get('/:id/tasks', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const q = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query)

      // Buscar todos contactIds do customer
      const members = await prisma.customerAccountContact.findMany({ where: { customerAccountId: id }, select: { contactId: true } })
      const contactIds = members.map(m => m.contactId)
      if (contactIds.length === 0) return reply.send({ tasks: [], total: 0 })

      const where: any = { companyId, contactId: { in: contactIds } }
      if (q.status) where.status = q.status

      const tasks = await prisma.task.findMany({
        where,
        orderBy: [{ kanbanOrder: 'asc' }, { createdAt: 'desc' }],
        take: q.limit,
        include: { project: { select: { id: true, name: true } }, assignees: { include: { user: { select: { id: true, name: true } } } } },
      })

      return reply.send({ tasks, total: tasks.length })
    }
  )

  // ── Relatório do cliente ──
  fastify.get('/:id/report', { preHandler: [requirePermission('customers:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const account = await prisma.customerAccount.findFirst({ where: { id, companyId }, include: { members: true } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      const contactIds = account.members.map(m => m.contactId)
      if (contactIds.length === 0) {
        return reply.send({ revenue: { total: 0, paid: 0, pending: 0, overdue: 0 }, proposals: { total: 0, accepted: 0, declined: 0, pending: 0, conversionRate: 0 }, contracts: { total: 0, active: 0, expired: 0, totalValue: 0 }, projects: { total: 0, completed: 0, inProgress: 0, avgProgress: 0 }, tasks: { total: 0, completed: 0, inProgress: 0, overdue: 0, completionRate: 0 }, expenses: { total: 0, totalAmount: 0, billable: 0, nonBillable: 0 }, timeline: [] })
      }

      const [invoices, proposals, contracts, projects, tasks, expenses, recentActivities] = await Promise.all([
        prisma.invoice.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { status: true, total: true, amountPaid: true, dueDate: true } }),
        prisma.proposal.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { status: true, total: true } }),
        prisma.contract.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { status: true, value: true, endDate: true } }),
        prisma.project.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { status: true, progress: true } }),
        prisma.task.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { status: true, dueDate: true } }),
        prisma.expense.findMany({ where: { companyId, contactId: { in: contactIds } }, select: { amount: true, billable: true } }),
        prisma.customerActivityLog.findMany({ where: { customerAccountId: id, companyId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      ])

      const now = new Date()
      const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0)
      const totalPaid = invoices.reduce((s, i) => s + Number(i.amountPaid || 0), 0)
      const overdueInvoices = invoices.filter(i => i.status !== 'PAID' && i.status !== 'CANCELLED' && i.dueDate && new Date(i.dueDate) < now)
      const overdueAmount = overdueInvoices.reduce((s, i) => s + Number(i.total || 0) - Number(i.amountPaid || 0), 0)

      const acceptedProposals = proposals.filter(p => (p.status as string) === 'ACCEPTED' || (p.status as string) === 'INVOICED')
      const declinedProposals = proposals.filter(p => (p.status as string) === 'DECLINED')
      const pendingProposals = proposals.filter(p => (p.status as string) === 'DRAFT' || (p.status as string) === 'SENT' || (p.status as string) === 'OPEN')

      const activeContracts = contracts.filter(c => (c.status as string) === 'ACTIVE' || (c.status as string) === 'SIGNED')
      const expiredContracts = contracts.filter(c => (c.status as string) === 'EXPIRED' || (c.endDate && new Date(c.endDate) < now))
      const totalContractValue = contracts.reduce((s, c) => s + Number(c.value || 0), 0)

      const completedProjects = projects.filter(p => p.status === 'COMPLETED')
      const inProgressProjects = projects.filter(p => p.status === 'IN_PROGRESS')
      const avgProgress = projects.length > 0 ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length) : 0

      const completedTasks = tasks.filter(t => t.status === 'COMPLETED')
      const inProgressTasks = tasks.filter(t => t.status === 'IN_PROGRESS')
      const overdueTasks = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.dueDate && new Date(t.dueDate) < now)

      const totalExpenseAmount = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
      const billableExpenses = expenses.filter(e => e.billable)
      const nonBillableExpenses = expenses.filter(e => !e.billable)

      return reply.send({
        revenue: { total: totalInvoiced, paid: totalPaid, pending: totalInvoiced - totalPaid, overdue: overdueAmount },
        proposals: { total: proposals.length, accepted: acceptedProposals.length, declined: declinedProposals.length, pending: pendingProposals.length, conversionRate: proposals.length > 0 ? Math.round((acceptedProposals.length / proposals.length) * 100) : 0 },
        contracts: { total: contracts.length, active: activeContracts.length, expired: expiredContracts.length, totalValue: totalContractValue },
        projects: { total: projects.length, completed: completedProjects.length, inProgress: inProgressProjects.length, avgProgress },
        tasks: { total: tasks.length, completed: completedTasks.length, inProgress: inProgressTasks.length, overdue: overdueTasks.length, completionRate: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0 },
        expenses: { total: expenses.length, totalAmount: totalExpenseAmount, billable: billableExpenses.reduce((s, e) => s + Number(e.amount || 0), 0), nonBillable: nonBillableExpenses.reduce((s, e) => s + Number(e.amount || 0), 0) },
        timeline: recentActivities,
      })
    }
  )
}
