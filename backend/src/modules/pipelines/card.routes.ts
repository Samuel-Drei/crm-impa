import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logCardActivity, validateCardOwnership, validateStageOwnership } from './pipeline.helpers.js'
import { io } from '../../server.js'
import { pipelineRoom } from '../../config/socket-rooms.js'

// ── Schemas ──

const listCardsQuery = z.object({
  status: z.enum(['OPEN', 'WON', 'LOST', 'ARCHIVED']).optional(),
  stageId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const createCardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  stageId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  value: z.number().min(0).optional(),
  currency: z.string().max(3).default('BRL'),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('NONE'),
  source: z.string().max(50).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  customFields: z.record(z.any()).optional(),
})

const updateCardSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  value: z.number().min(0).optional().nullable(),
  currency: z.string().max(3).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  source: z.string().max(50).optional().nullable(),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  customFields: z.record(z.any()).optional(),
  contactId: z.string().uuid().optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
})

const moveCardSchema = z.object({
  stageId: z.string().uuid(),
  position: z.number().int().min(0),
})

const cardIdParam = z.object({ cardId: z.string().uuid() })
const pipelineCardParam = z.object({ id: z.string().uuid() })

// ── Notes ──
const createNoteSchema = z.object({
  content: z.string().min(1).max(5000),
  isPrivate: z.boolean().default(false),
})

// ── Tasks ──
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('NONE'),
})

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  isCompleted: z.boolean().optional(),
})

// ── Tags ──
const addTagSchema = z.object({ labelId: z.string().uuid() })

// ═══ Pipeline-scoped card routes ═══
// Registered at /api/pipelines prefix
export async function pipelineCardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ═══ LIST CARDS BY PIPELINE ═══
  // GET /api/pipelines/:id/cards
  fastify.get('/:id/cards', {
    preHandler: [requirePermission('cards:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineCardParam.parse(request.params)
    const query = listCardsQuery.parse(request.query)
    const companyId = request.user.companyId

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    const where: any = { pipelineId: id, companyId }
    if (query.status) where.status = query.status
    if (query.stageId) where.stageId = query.stageId
    if (query.assigneeId) where.assigneeId = query.assigneeId
    if (query.contactId) where.contactId = query.contactId
    if (query.priority) where.priority = query.priority
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const [cards, total] = await Promise.all([
      prisma.card.findMany({
        where,
        include: {
          stage: { select: { id: true, name: true, slug: true, color: true } },
          contact: { select: { id: true, name: true, phoneNumber: true, profilePicture: true } },
          assignee: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
          tags: { include: { label: { select: { id: true, title: true, color: true } } } },
          _count: { select: { tasks: true, notes: true, files: true, activities: true } },
        },
        orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.card.count({ where }),
    ])

    return reply.send({ cards, total, page: query.page, limit: query.limit })
  })

  // ═══ CREATE CARD ═══
  // POST /api/pipelines/:id/cards
  fastify.post('/:id/cards', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineCardParam.parse(request.params)
    const body = createCardSchema.parse(request.body)
    const companyId = request.user.companyId

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    const stage = await validateStageOwnership(body.stageId, id, companyId)
    if (!stage) return reply.status(400).send({ error: 'Stage não pertence a este pipeline' })

    if (body.contactId) {
      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, companyId } })
      if (!contact) return reply.status(400).send({ error: 'Contato não encontrado' })
    }

    if (body.conversationId) {
      const conversation = await prisma.conversation.findFirst({ where: { id: body.conversationId, companyId } })
      if (!conversation) return reply.status(400).send({ error: 'Conversa não encontrada' })
    }

    const maxPos = await prisma.card.aggregate({
      where: { stageId: body.stageId },
      _max: { position: true },
    })

    const card = await prisma.card.create({
      data: {
        pipelineId: id,
        stageId: body.stageId,
        companyId,
        title: body.title,
        description: body.description,
        value: body.value,
        currency: body.currency,
        assigneeId: body.assigneeId,
        teamId: body.teamId,
        contactId: body.contactId,
        conversationId: body.conversationId,
        priority: body.priority,
        source: body.source,
        expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
        customFields: body.customFields,
        position: (maxPos._max.position ?? -1) + 1,
        createdBy: request.user.sub,
      },
      include: {
        stage: { select: { id: true, name: true, slug: true, color: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        assignee: { select: { id: true, name: true } },
      },
    })

    await logCardActivity({
      cardId: card.id,
      type: 'CARD_CREATED',
      content: `Card "${card.title}" criado em ${stage.name}`,
      actorId: request.user.sub,
      actorName: request.user.name,
    })

    io.to(pipelineRoom(request.user.companyId, id)).emit('pipeline:card-created', { pipelineId: id, card })

    return reply.status(201).send({ card })
  })

  // ═══ METRICS ═══
  fastify.get('/:id/metrics', {
    preHandler: [requirePermission('pipelines:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = pipelineCardParam.parse(request.params)
    const companyId = request.user.companyId

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, companyId },
    })
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline não encontrado' })

    const [totalCards, openCards, wonCards, lostCards, totalValue, wonValue] = await Promise.all([
      prisma.card.count({ where: { pipelineId: id } }),
      prisma.card.count({ where: { pipelineId: id, status: 'OPEN' } }),
      prisma.card.count({ where: { pipelineId: id, status: 'WON' } }),
      prisma.card.count({ where: { pipelineId: id, status: 'LOST' } }),
      prisma.card.aggregate({ where: { pipelineId: id, status: 'OPEN' }, _sum: { value: true } }),
      prisma.card.aggregate({ where: { pipelineId: id, status: 'WON' }, _sum: { value: true } }),
    ])

    const conversionRate = (wonCards + lostCards) > 0
      ? ((wonCards / (wonCards + lostCards)) * 100).toFixed(1)
      : '0.0'

    const stages = await prisma.stage.findMany({
      where: { pipelineId: id },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { cards: true } },
        cards: {
          where: { status: 'OPEN' },
          select: { value: true },
        },
      },
    })

    const stageMetrics = stages.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      color: s.color,
      cardCount: s._count.cards,
      totalValue: s.cards.reduce((sum, c) => sum + Number(c.value || 0), 0),
    }))

    return reply.send({
      metrics: {
        totalCards,
        openCards,
        wonCards,
        lostCards,
        conversionRate: Number(conversionRate),
        totalOpenValue: Number(totalValue._sum.value || 0),
        totalWonValue: Number(wonValue._sum.value || 0),
        stages: stageMetrics,
      },
    })
  })
}

// ═══ Card-scoped routes ═══
// Registered at /api/cards prefix
export async function cardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ═══ GET CARDS BY CONVERSATION ═══
  // GET /api/cards/by-conversation/:conversationId
  fastify.get('/by-conversation/:conversationId', {
    preHandler: [requirePermission('cards:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { conversationId } = z.object({ conversationId: z.string().uuid() }).parse(request.params)
    const companyId = request.user.companyId

    const cards = await prisma.card.findMany({
      where: { conversationId, companyId },
      include: {
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ cards })
  })

  // ═══ GET CARD DETAIL ═══
  // GET /api/cards/:cardId
  fastify.get('/:cardId', {
    preHandler: [requirePermission('cards:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const companyId = request.user.companyId

    const card = await prisma.card.findFirst({
      where: { id: cardId, companyId },
      include: {
        pipeline: { select: { id: true, name: true, type: true } },
        stage: { select: { id: true, name: true, slug: true, color: true, isWon: true, isLost: true } },
        contact: { select: { id: true, name: true, phoneNumber: true, email: true, profilePicture: true, metadata: true } },
        conversation: { select: { id: true, remoteJid: true, status: true } },
        assignee: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
        tags: { include: { label: { select: { id: true, title: true, color: true } } } },
        tasks: { orderBy: { position: 'asc' }, include: { assignee: { select: { id: true, name: true } } } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, name: true } } } },
        files: { orderBy: { createdAt: 'desc' }, include: { uploader: { select: { id: true, name: true } } } },
        _count: { select: { activities: true } },
      },
    })
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    return reply.send({ card })
  })

  // ═══ UPDATE CARD ═══
  // PUT /api/cards/:cardId
  fastify.put('/:cardId', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const body = updateCardSchema.parse(request.body)
    const companyId = request.user.companyId

    const existing = await validateCardOwnership(cardId, companyId)
    if (!existing) return reply.status(404).send({ error: 'Card não encontrado' })

    // Validate contact if changing
    if (body.contactId) {
      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, companyId } })
      if (!contact) return reply.status(400).send({ error: 'Contato não encontrado' })
    }

    // Track changes for activity log
    const changes: string[] = []
    if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
      changes.push('assignee')
      await logCardActivity({
        cardId,
        type: 'ASSIGNED',
        content: body.assigneeId ? 'Card reatribuído' : 'Atribuição removida',
        actorId: request.user.sub,
        actorName: request.user.name,
        oldValue: existing.assigneeId,
        newValue: body.assigneeId,
      })
    }

    if (body.value !== undefined && String(body.value) !== String(existing.value)) {
      await logCardActivity({
        cardId,
        type: 'VALUE_CHANGED',
        content: `Valor alterado de ${existing.value || '0'} para ${body.value || '0'}`,
        actorId: request.user.sub,
        actorName: request.user.name,
        oldValue: String(existing.value || '0'),
        newValue: String(body.value || '0'),
      })
    }

    const card = await prisma.card.update({
      where: { id: cardId },
      data: {
        ...body,
        expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : body.expectedCloseDate === null ? null : undefined,
      },
      include: {
        stage: { select: { id: true, name: true, slug: true, color: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        assignee: { select: { id: true, name: true } },
      },
    })

    io.to(pipelineRoom(request.user.companyId, existing.pipelineId)).emit('pipeline:card-updated', { pipelineId: existing.pipelineId, card })

    return reply.send({ card })
  })

  // ═══ MOVE CARD (drag-and-drop) ═══
  // PUT /api/cards/:cardId/move
  fastify.put('/:cardId/move', {
    preHandler: [requirePermission('cards:move')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const { stageId, position } = moveCardSchema.parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    // Validate target stage belongs to the same pipeline and company
    const targetStage = await validateStageOwnership(stageId, card.pipelineId, companyId)
    if (!targetStage) return reply.status(400).send({ error: 'Stage destino não pertence a este pipeline' })

    const oldStageId = card.stageId
    const stageChanged = oldStageId !== stageId

    // Determine new status based on stage
    let newStatus = card.status
    const updates: any = { stageId, position }

    if (stageChanged) {
      if (targetStage.isWon) {
        newStatus = 'WON'
        updates.status = 'WON'
        updates.wonAt = new Date()
      } else if (targetStage.isLost) {
        newStatus = 'LOST'
        updates.status = 'LOST'
        updates.lostAt = new Date()
      } else if (card.status === 'WON' || card.status === 'LOST') {
        // Moving back from won/lost to normal stage
        newStatus = 'OPEN'
        updates.status = 'OPEN'
        updates.wonAt = null
        updates.lostAt = null
        updates.lostReason = null
      }
    }

    const updated = await prisma.card.update({
      where: { id: cardId },
      data: updates,
      include: {
        stage: { select: { id: true, name: true, slug: true, color: true } },
      },
    })

    if (stageChanged) {
      await logCardActivity({
        cardId,
        type: 'STAGE_CHANGED',
        content: `Card movido de "${card.stage.name}" para "${targetStage.name}"`,
        actorId: request.user.sub,
        actorName: request.user.name,
        oldValue: card.stage.name,
        newValue: targetStage.name,
        metadata: { oldStageId, newStageId: stageId },
      })

      if (newStatus === 'WON') {
        await logCardActivity({
          cardId,
          type: 'STATUS_CHANGED',
          content: 'Card marcado como GANHO',
          actorId: request.user.sub,
          actorName: request.user.name,
          oldValue: card.status,
          newValue: 'WON',
        })
      } else if (newStatus === 'LOST') {
        await logCardActivity({
          cardId,
          type: 'STATUS_CHANGED',
          content: 'Card marcado como PERDIDO',
          actorId: request.user.sub,
          actorName: request.user.name,
          oldValue: card.status,
          newValue: 'LOST',
        })
      }
    }

    io.to(pipelineRoom(request.user.companyId, card.pipelineId)).emit('pipeline:card-moved', { pipelineId: card.pipelineId, card: updated, oldStageId, newStageId: stageId })

    // ── Sync lead status when card moves in a leads pipeline ──
    if (stageChanged) {
      const pipeline = await prisma.pipeline.findUnique({ where: { id: card.pipelineId }, select: { type: true } })
      if (pipeline?.type === 'leads') {
        const leadId = (card.customFields as any)?.leadId
        if (leadId) {
          const STAGE_TO_LEAD_STATUS: Record<string, string> = {
            novo: 'NEW',
            contactado: 'CONTACTED',
            qualificando: 'QUALIFYING',
            qualificado: 'QUALIFIED',
            desqualificado: 'DISQUALIFIED',
          }
          const newLeadStatus = STAGE_TO_LEAD_STATUS[targetStage.slug]
          if (newLeadStatus) {
            const updateData: any = { status: newLeadStatus }
            if (newLeadStatus === 'QUALIFIED') updateData.qualifiedAt = new Date()
            if (newLeadStatus === 'DISQUALIFIED') updateData.disqualifiedAt = new Date()
            await prisma.leadProfile.update({ where: { id: leadId }, data: updateData }).catch(() => {})
          }
        }
      }
    }

    return reply.send({ card: updated })
  })

  // ═══ WON ═══
  fastify.put('/:cardId/won', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    // Find the won stage in this pipeline
    const wonStage = await prisma.stage.findFirst({
      where: { pipelineId: card.pipelineId, isWon: true },
    })

    const updated = await prisma.card.update({
      where: { id: cardId },
      data: {
        status: 'WON',
        wonAt: new Date(),
        stageId: wonStage?.id || card.stageId,
      },
    })

    await logCardActivity({
      cardId,
      type: 'STATUS_CHANGED',
      content: 'Card marcado como GANHO',
      actorId: request.user.sub,
      actorName: request.user.name,
      oldValue: card.status,
      newValue: 'WON',
    })

    io.to(pipelineRoom(request.user.companyId, card.pipelineId)).emit('pipeline:card-updated', { pipelineId: card.pipelineId, card: updated })

    return reply.send({ card: updated })
  })

  // ═══ LOST ═══
  fastify.put('/:cardId/lost', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const lostStage = await prisma.stage.findFirst({
      where: { pipelineId: card.pipelineId, isLost: true },
    })

    const updated = await prisma.card.update({
      where: { id: cardId },
      data: {
        status: 'LOST',
        lostAt: new Date(),
        lostReason: body.reason,
        stageId: lostStage?.id || card.stageId,
      },
    })

    await logCardActivity({
      cardId,
      type: 'STATUS_CHANGED',
      content: `Card marcado como PERDIDO${body.reason ? `: ${body.reason}` : ''}`,
      actorId: request.user.sub,
      actorName: request.user.name,
      oldValue: card.status,
      newValue: 'LOST',
    })

    io.to(pipelineRoom(request.user.companyId, card.pipelineId)).emit('pipeline:card-updated', { pipelineId: card.pipelineId, card: updated })

    return reply.send({ card: updated })
  })

  // ═══ DELETE CARD ═══
  fastify.delete('/:cardId', {
    preHandler: [requirePermission('cards:delete')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    await prisma.card.delete({ where: { id: cardId } })

    io.to(pipelineRoom(request.user.companyId, card.pipelineId)).emit('pipeline:card-deleted', { pipelineId: card.pipelineId, cardId })

    return reply.send({ success: true })
  })

  // ═══ ACTIVITIES ═══
  fastify.get('/:cardId/activities', {
    preHandler: [requirePermission('cards:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query)

    const [activities, total] = await Promise.all([
      prisma.cardActivity.findMany({
        where: { cardId },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.cardActivity.count({ where: { cardId } }),
    ])

    return reply.send({ activities, total })
  })

  // ═══ NOTES ═══
  fastify.post('/:cardId/notes', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const body = createNoteSchema.parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const note = await prisma.cardNote.create({
      data: {
        cardId,
        content: body.content,
        isPrivate: body.isPrivate,
        createdBy: request.user.sub,
      },
      include: { author: { select: { id: true, name: true } } },
    })

    await logCardActivity({
      cardId,
      type: 'NOTE_ADDED',
      content: `Nota adicionada${body.isPrivate ? ' (privada)' : ''}`,
      actorId: request.user.sub,
      actorName: request.user.name,
    })

    return reply.status(201).send({ note })
  })

  // ═══ TASKS ═══
  fastify.post('/:cardId/tasks', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const body = createTaskSchema.parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const maxPos = await prisma.cardTask.aggregate({
      where: { cardId },
      _max: { position: true },
    })

    const task = await prisma.cardTask.create({
      data: {
        cardId,
        title: body.title,
        description: body.description,
        assigneeId: body.assigneeId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        priority: body.priority,
        position: (maxPos._max.position ?? -1) + 1,
        createdBy: request.user.sub,
      },
      include: { assignee: { select: { id: true, name: true } } },
    })

    return reply.status(201).send({ task })
  })

  fastify.put('/:cardId/tasks/:taskId', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      cardId: z.string().uuid(),
      taskId: z.string().uuid(),
    }).parse(request.params)
    const body = updateTaskSchema.parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(params.cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const existing = await prisma.cardTask.findFirst({
      where: { id: params.taskId, cardId: params.cardId },
    })
    if (!existing) return reply.status(404).send({ error: 'Tarefa não encontrada' })

    const data: any = { ...body }
    if (body.isCompleted === true && !existing.isCompleted) {
      data.completedAt = new Date()
      data.completedBy = request.user.sub
    } else if (body.isCompleted === false) {
      data.completedAt = null
      data.completedBy = null
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    }

    const task = await prisma.cardTask.update({
      where: { id: params.taskId },
      data,
      include: { assignee: { select: { id: true, name: true } } },
    })

    if (body.isCompleted === true && !existing.isCompleted) {
      await logCardActivity({
        cardId: params.cardId,
        type: 'TASK_COMPLETED',
        content: `Tarefa "${task.title}" concluída`,
        actorId: request.user.sub,
        actorName: request.user.name,
      })
    }

    return reply.send({ task })
  })

  // ═══ TAGS ═══
  fastify.post('/:cardId/tags', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cardId } = cardIdParam.parse(request.params)
    const { labelId } = addTagSchema.parse(request.body)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    const label = await prisma.label.findFirst({ where: { id: labelId, companyId } })
    if (!label) return reply.status(400).send({ error: 'Etiqueta não encontrada' })

    const tag = await prisma.cardTag.upsert({
      where: { cardId_labelId: { cardId, labelId } },
      update: {},
      create: { cardId, labelId },
      include: { label: { select: { id: true, title: true, color: true } } },
    })

    return reply.status(201).send({ tag })
  })

  fastify.delete('/:cardId/tags/:labelId', {
    preHandler: [requirePermission('cards:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      cardId: z.string().uuid(),
      labelId: z.string().uuid(),
    }).parse(request.params)
    const companyId = request.user.companyId

    const card = await validateCardOwnership(params.cardId, companyId)
    if (!card) return reply.status(404).send({ error: 'Card não encontrado' })

    await prisma.cardTag.deleteMany({
      where: { cardId: params.cardId, labelId: params.labelId },
    })

    return reply.send({ success: true })
  })
}
