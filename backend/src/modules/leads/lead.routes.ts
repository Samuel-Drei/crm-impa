import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logConversationEvent } from '../conversations/conversation-events.service.js'
import { io } from '../../server.js'

// ── Lead → Pipeline integration helpers ──

const LEADS_PIPELINE_STAGES = [
  { name: 'Novo', slug: 'novo', color: '#3b82f6', position: 0 },
  { name: 'Contactado', slug: 'contactado', color: '#8b5cf6', position: 1 },
  { name: 'Qualificando', slug: 'qualificando', color: '#f59e0b', position: 2 },
  { name: 'Qualificado', slug: 'qualificado', color: '#10b981', position: 3, isWon: true },
  { name: 'Desqualificado', slug: 'desqualificado', color: '#ef4444', position: 4, isLost: true },
]

const LEAD_STATUS_TO_STAGE: Record<string, string> = {
  NEW: 'novo',
  CONTACTED: 'contactado',
  QUALIFYING: 'qualificando',
  QUALIFIED: 'qualificado',
  UNQUALIFIED: 'desqualificado',
  DISQUALIFIED: 'desqualificado',
}

async function getOrCreateLeadsPipeline(companyId: string) {
  let pipeline = await prisma.pipeline.findFirst({
    where: { companyId, type: 'leads' },
    include: { stages: { orderBy: { position: 'asc' } } },
  })
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: {
        companyId,
        name: 'Funil de Leads',
        type: 'leads',
        description: 'Pipeline automático de qualificação de leads',
        color: '#f59e0b',
        isDefault: false,
        position: 99,
        stages: {
          create: LEADS_PIPELINE_STAGES.map(s => ({
            companyId,
            name: s.name,
            slug: s.slug,
            color: s.color,
            position: s.position,
            isWon: s.isWon || false,
            isLost: s.isLost || false,
          })),
        },
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    })
  }
  return pipeline
}

async function createLeadCard(lead: any, contact: any, companyId: string, userId: string) {
  try {
    const pipeline = await getOrCreateLeadsPipeline(companyId)
    const stageSlug = LEAD_STATUS_TO_STAGE[lead.status] || 'novo'
    const stage = pipeline.stages.find(s => s.slug === stageSlug) || pipeline.stages[0]

    const maxPos = await prisma.card.aggregate({
      where: { stageId: stage.id },
      _max: { position: true },
    })

    const card = await prisma.card.create({
      data: {
        pipelineId: pipeline.id,
        stageId: stage.id,
        companyId,
        contactId: contact.id,
        title: contact.name,
        description: lead.source ? `Origem: ${lead.source}` : undefined,
        value: lead.estimatedBudget || null,
        currency: lead.budgetCurrency || 'BRL',
        assigneeId: lead.assignedTo || null,
        priority: lead.temperature === 'HOT' ? 'HIGH' : lead.temperature === 'WARM' ? 'MEDIUM' : 'NONE',
        source: lead.source || 'manual',
        status: 'OPEN',
        position: (maxPos._max.position ?? -1) + 1,
        createdBy: userId,
        customFields: { leadId: lead.id, temperature: lead.temperature, score: lead.score },
      },
    })

    // Emit socket event for real-time update
    io?.to(`company:${companyId}`).emit('pipeline:card-created', {
      pipelineId: pipeline.id,
      card,
    })

    return card
  } catch (err) {
    console.error('[Leads] Failed to create pipeline card:', err)
    return null
  }
}

async function moveLeadCard(leadId: string, newStatus: string, companyId: string) {
  try {
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId, type: 'leads' },
      include: { stages: true },
    })
    if (!pipeline) return

    const stageSlug = LEAD_STATUS_TO_STAGE[newStatus] || 'novo'
    const stage = pipeline.stages.find(s => s.slug === stageSlug)
    if (!stage) return

    const card = await prisma.card.findFirst({
      where: {
        pipelineId: pipeline.id,
        customFields: { path: ['leadId'], equals: leadId },
      },
    })
    if (!card) return

    const cardStatus = stage.isWon ? 'WON' : stage.isLost ? 'LOST' : 'OPEN'
    await prisma.card.update({
      where: { id: card.id },
      data: {
        stageId: stage.id,
        status: cardStatus,
        ...(cardStatus === 'WON' ? { wonAt: new Date() } : {}),
        ...(cardStatus === 'LOST' ? { lostAt: new Date() } : {}),
      },
    })

    io?.to(`company:${companyId}`).emit('pipeline:card-moved', {
      pipelineId: pipeline.id,
      cardId: card.id,
      stageId: stage.id,
      status: cardStatus,
    })
  } catch (err) {
    console.error('[Leads] Failed to move pipeline card:', err)
  }
}

const leadStatusValues = ['NEW', 'CONTACTED', 'QUALIFYING', 'QUALIFIED', 'UNQUALIFIED', 'DISQUALIFIED'] as const
const leadTempValues = ['HOT', 'WARM', 'COLD'] as const

const createLeadSchema = z.object({
  contactId: z.string().uuid(),
  status: z.enum(leadStatusValues).default('NEW'),
  temperature: z.enum(leadTempValues).default('COLD'),
  score: z.number().int().min(0).max(100).optional(),
  source: z.string().optional(),
  channel: z.string().optional(),
  estimatedBudget: z.number().positive().optional(),
  budgetCurrency: z.string().default('BRL'),
  assignedTo: z.string().uuid().optional(),
})

const updateLeadSchema = z.object({
  status: z.enum(leadStatusValues).optional(),
  temperature: z.enum(leadTempValues).optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  estimatedBudget: z.number().positive().nullable().optional(),
  budgetCurrency: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  qualificationNotes: z.string().nullable().optional(),
})

export async function leadRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── List leads ──
  fastify.get<{
    Querystring: { page?: string; limit?: string; search?: string; status?: string; temperature?: string; assignedTo?: string }
  }>('/', { preHandler: [requirePermission('contacts:read')] }, async (request, reply) => {
    const page = parseInt(request.query.page || '1')
    const limit = Math.min(parseInt(request.query.limit || '50'), 200)
    const { search, status, temperature, assignedTo } = request.query

    const where: any = { companyId: request.user.companyId }
    if (status) where.status = status
    if (temperature) where.temperature = temperature
    if (assignedTo) where.assignedTo = assignedTo

    if (search) {
      where.contact = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    const [leads, total] = await Promise.all([
      prisma.leadProfile.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, email: true, phoneNumber: true, tags: true, profilePicture: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.leadProfile.count({ where }),
    ])

    return reply.send({ leads, total, page, limit })
  })

  // ── Get lead by ID ──
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:read')] }, async (request, reply) => {
    const lead = await prisma.leadProfile.findFirst({
      where: { id: request.params.id, companyId: request.user.companyId },
      include: {
        contact: true,
      },
    })
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' })
    return reply.send(lead)
  })

  // ── Create lead (from contact) ──
  fastify.post('/', { preHandler: [requirePermission('contacts:write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createLeadSchema.parse(request.body)

    // Verify contact exists and belongs to this company
    const contact = await prisma.contact.findFirst({
      where: { id: data.contactId, companyId: request.user.companyId },
    })
    if (!contact) return reply.status(404).send({ error: 'Contato não encontrado' })

    // Check if lead profile already exists for this contact
    const existing = await prisma.leadProfile.findUnique({ where: { contactId: data.contactId } })
    if (existing) return reply.status(409).send({ error: 'Este contato já possui um perfil de lead', lead: existing })

    const lead = await prisma.leadProfile.create({
      data: {
        ...data,
        companyId: request.user.companyId,
      },
      include: { contact: true },
    })

    // Log conversation event
    const conversation = await prisma.conversation.findFirst({
      where: { contactId: data.contactId, companyId: request.user.companyId },
      select: { id: true, instanceId: true, remoteJid: true },
      orderBy: { lastActivityAt: 'desc' },
    })
    if (conversation) {
      const userName = request.user.name || 'Usuário'
      logConversationEvent({
        conversationId: conversation.id,
        instanceId: conversation.instanceId,
        remoteJid: conversation.remoteJid,
        eventType: 'lead_created',
        description: `${userName} criou um perfil de lead para ${contact.name}`,
        actorType: 'user',
        actorName: userName,
        metadata: { leadId: lead.id, contactId: data.contactId, contactName: contact.name },
      })
    }

    // Auto-create card in leads pipeline
    await createLeadCard(lead, contact, request.user.companyId, request.user.id || request.user.sub)

    return reply.status(201).send(lead)
  })

  // ── Update lead ──
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:write')] }, async (request, reply) => {
    const data = updateLeadSchema.parse(request.body)

    const lead = await prisma.leadProfile.findFirst({
      where: { id: request.params.id, companyId: request.user.companyId },
    })
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' })

    // Track status transitions
    const updateData: any = { ...data }
    if (data.status === 'QUALIFIED' && lead.status !== 'QUALIFIED') {
      updateData.qualifiedAt = new Date()
    }
    if (data.status === 'DISQUALIFIED' && lead.status !== 'DISQUALIFIED') {
      updateData.disqualifiedAt = new Date()
    }

    const updated = await prisma.leadProfile.update({
      where: { id: request.params.id },
      data: updateData,
      include: { contact: true },
    })

    // Sync lead status to pipeline card
    if (data.status && data.status !== lead.status) {
      await moveLeadCard(lead.id, data.status, request.user.companyId)
    }

    return reply.send(updated)
  })

  // ── Delete lead profile ──
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:delete')] }, async (request, reply) => {
    const lead = await prisma.leadProfile.findFirst({
      where: { id: request.params.id, companyId: request.user.companyId },
    })
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' })

    await prisma.leadProfile.delete({ where: { id: request.params.id } })
    return reply.status(204).send()
  })

  // ── Convert lead to customer ──
  fastify.post<{
    Params: { id: string }
    Body: { accountType?: string; billingName?: string; billingEmail?: string; taxId?: string }
  }>('/:id/convert', { preHandler: [requirePermission('customers:manage')] }, async (request, reply) => {
    const lead = await prisma.leadProfile.findFirst({
      where: { id: request.params.id, companyId: request.user.companyId },
      include: { contact: true },
    })
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado' })
    if (lead.convertedAt) return reply.status(400).send({ error: 'Lead já foi convertido' })

    const body = request.body as any || {}

    try {
      // Create customer account + link contact as primary member
      const result = await prisma.$transaction(async (tx) => {
        const account = await tx.customerAccount.create({
          data: {
            companyId: request.user.companyId,
            accountType: body.accountType || 'INDIVIDUAL',
            billingName: body.billingName || lead.contact.name,
            billingEmail: body.billingEmail || lead.contact.email || '',
            taxId: body.taxId || '',
            status: 'ACTIVE',
            createdBy: request.user.id || request.user.sub,
          },
        })

        await tx.customerAccountContact.create({
          data: {
            customerAccountId: account.id,
            contactId: lead.contactId,
            role: 'PRIMARY',
            isPrimary: true,
          },
        })

        await tx.leadProfile.update({
          where: { id: lead.id },
          data: { convertedAt: new Date(), status: 'QUALIFIED' },
        })

        return account
      })

      // Log conversation event
      const conversation = await prisma.conversation.findFirst({
        where: { contactId: lead.contactId, companyId: request.user.companyId },
        select: { id: true, instanceId: true, remoteJid: true },
        orderBy: { lastActivityAt: 'desc' },
      })
      if (conversation) {
        const userName = request.user.name || 'Usuário'
        logConversationEvent({
          conversationId: conversation.id,
          instanceId: conversation.instanceId,
          remoteJid: conversation.remoteJid,
          eventType: 'lead_converted',
          description: `${userName} converteu o lead ${lead.contact.name} em cliente`,
          actorType: 'user',
          actorName: userName,
          metadata: { leadId: lead.id, accountId: result.id, contactName: lead.contact.name },
        })
      }

      return reply.send({ message: 'Lead convertido em cliente', account: result })
    } catch (error: any) {
      request.log.error(error, 'Erro ao converter lead')
      return reply.status(500).send({ error: 'Erro ao converter lead em cliente', details: error.message })
    }
  })

  // ── Stats/summary ──
  fastify.get('/stats/summary', { preHandler: [requirePermission('contacts:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const where = { companyId: request.user.companyId }

    const [total, byStatus, byTemperature] = await Promise.all([
      prisma.leadProfile.count({ where }),
      prisma.leadProfile.groupBy({ by: ['status'], where, _count: true }),
      prisma.leadProfile.groupBy({ by: ['temperature'], where, _count: true }),
    ])

    const statusMap: Record<string, number> = {}
    byStatus.forEach(s => { statusMap[s.status] = s._count })
    const tempMap: Record<string, number> = {}
    byTemperature.forEach(t => { tempMap[t.temperature] = t._count })

    return reply.send({ total, byStatus: statusMap, byTemperature: tempMap })
  })
}
