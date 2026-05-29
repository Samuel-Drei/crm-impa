import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

const createScheduleSchema = z.object({
  instanceId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  remoteJid: z.string().min(1),
  name: z.string().min(1).max(200),
  messageType: z.enum(['text', 'image', 'video', 'audio', 'document']).default('text'),
  content: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaFileName: z.string().optional(),
  recurrence: z.enum(['ONCE', 'DAILY', 'EVERY_X_DAYS', 'WEEKLY', 'SPECIFIC_DAYS', 'MONTHLY']).default('ONCE'),
  timezone: z.string().default('America/Sao_Paulo'),
  scheduledAt: z.string().datetime(),
  recurrenceRule: z.object({
    intervalDays: z.number().int().min(1).optional(),
    weekDays: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    endDate: z.string().datetime().optional(),
    maxOccurrences: z.number().int().min(1).optional(),
  }).optional(),
  aiEnabled: z.boolean().default(false),
  aiProviderId: z.string().uuid().optional(),
  aiModel: z.string().optional(),
  aiPrompt: z.string().optional(),
})

const updateScheduleSchema = createScheduleSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
})

export function calculateNextExecution(
  recurrence: string,
  scheduledAt: Date,
  recurrenceRule: any,
  lastExecutedAt?: Date | null,
): Date | null {
  const now = new Date()
  const baseDate = lastExecutedAt || scheduledAt

  switch (recurrence) {
    case 'ONCE':
      return lastExecutedAt ? null : scheduledAt

    case 'DAILY': {
      const next = new Date(baseDate)
      next.setDate(next.getDate() + 1)
      return next > now ? next : (() => {
        const n = new Date(now)
        n.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), scheduledAt.getSeconds(), 0)
        if (n <= now) n.setDate(n.getDate() + 1)
        return n
      })()
    }

    case 'EVERY_X_DAYS': {
      const interval = recurrenceRule?.intervalDays || 1
      const next = new Date(baseDate)
      next.setDate(next.getDate() + interval)
      return next > now ? next : (() => {
        const diffMs = now.getTime() - scheduledAt.getTime()
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        const cycles = Math.ceil(diffDays / interval)
        const n = new Date(scheduledAt)
        n.setDate(n.getDate() + cycles * interval)
        if (n <= now) n.setDate(n.getDate() + interval)
        return n
      })()
    }

    case 'WEEKLY': {
      const next = new Date(baseDate)
      next.setDate(next.getDate() + 7)
      return next > now ? next : (() => {
        const n = new Date(now)
        const dayDiff = (7 - (n.getDay() - scheduledAt.getDay()) % 7) % 7 || 7
        n.setDate(n.getDate() + dayDiff)
        n.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), scheduledAt.getSeconds(), 0)
        return n
      })()
    }

    case 'SPECIFIC_DAYS': {
      const weekDays: number[] = recurrenceRule?.weekDays || []
      if (weekDays.length === 0) return null
      const sorted = [...weekDays].sort((a, b) => a - b)
      const currentDay = now.getDay()
      let nextDay = sorted.find(d => d > currentDay)
      const daysUntil = nextDay !== undefined
        ? nextDay - currentDay
        : 7 - currentDay + sorted[0]
      if (nextDay === undefined) nextDay = sorted[0]
      const next = new Date(now)
      next.setDate(next.getDate() + daysUntil)
      next.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), scheduledAt.getSeconds(), 0)
      if (next <= now) {
        const secondNext = sorted.find(d => d > nextDay!) ?? sorted[0]
        const extraDays = secondNext > nextDay! ? secondNext - nextDay! : 7 - nextDay! + secondNext
        next.setDate(next.getDate() + extraDays)
      }
      return next
    }

    case 'MONTHLY': {
      const dayOfMonth = recurrenceRule?.dayOfMonth || scheduledAt.getDate()
      const next = new Date(baseDate)
      next.setMonth(next.getMonth() + 1)
      next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))
      next.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), scheduledAt.getSeconds(), 0)
      return next > now ? next : (() => {
        const n = new Date(now)
        n.setDate(Math.min(dayOfMonth, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()))
        n.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), scheduledAt.getSeconds(), 0)
        if (n <= now) n.setMonth(n.getMonth() + 1)
        return n
      })()
    }

    default:
      return null
  }
}

export async function scheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── Listar agendamentos ──
  fastify.get('/', {
    preHandler: [requirePermission('schedules:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { status, instanceId, remoteJid, from, to } = request.query as {
      status?: string
      instanceId?: string
      remoteJid?: string
      from?: string
      to?: string
    }

    const where: any = { companyId: request.user.companyId }
    if (status) where.status = status
    if (instanceId) where.instanceId = instanceId
    if (remoteJid) where.remoteJid = remoteJid
    if (from || to) {
      where.scheduledAt = {}
      if (from) where.scheduledAt.gte = new Date(from)
      if (to) where.scheduledAt.lte = new Date(to)
    }

    const schedules = await prisma.scheduledMessage.findMany({
      where,
      include: {
        instance: { select: { id: true, name: true, channel: true, status: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        createdBy: { select: { id: true, name: true } },
        aiProvider: { select: { id: true, name: true, type: true } },
        _count: { select: { logs: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    })

    return reply.send(schedules)
  })

  // ── Buscar um agendamento ──
  fastify.get('/:id', {
    preHandler: [requirePermission('schedules:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }

    const schedule = await prisma.scheduledMessage.findFirst({
      where: { id, companyId: request.user.companyId },
      include: {
        instance: { select: { id: true, name: true, channel: true, status: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        createdBy: { select: { id: true, name: true } },
        aiProvider: { select: { id: true, name: true, type: true } },
        logs: { orderBy: { executedAt: 'desc' }, take: 50 },
      },
    })

    if (!schedule) return reply.status(404).send({ error: 'Agendamento não encontrado' })
    return reply.send(schedule)
  })

  // ── Criar agendamento ──
  fastify.post('/', {
    preHandler: [requirePermission('schedules:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createScheduleSchema.parse(request.body)

    // Validar instância
    const instance = await prisma.instance.findFirst({
      where: { id: data.instanceId, companyId: request.user.companyId, isActive: true },
    })
    if (!instance) return reply.status(404).send({ error: 'Instância não encontrada' })

    // Validar provider AI se habilitado
    if (data.aiEnabled && data.aiProviderId) {
      const provider = await prisma.aIProvider.findFirst({
        where: { id: data.aiProviderId, companyId: request.user.companyId, isActive: true },
      })
      if (!provider) return reply.status(404).send({ error: 'Provider de IA não encontrado' })
    }

    const scheduledAt = new Date(data.scheduledAt)
    const nextExecutionAt = calculateNextExecution(
      data.recurrence,
      scheduledAt,
      data.recurrenceRule,
    )

    const schedule = await prisma.scheduledMessage.create({
      data: {
        companyId: request.user.companyId,
        instanceId: data.instanceId,
        contactId: data.contactId,
        remoteJid: data.remoteJid,
        name: data.name,
        messageType: data.messageType,
        content: data.content,
        mediaUrl: data.mediaUrl,
        mediaFileName: data.mediaFileName,
        recurrence: data.recurrence as any,
        timezone: data.timezone,
        scheduledAt,
        recurrenceRule: data.recurrenceRule || undefined,
        nextExecutionAt,
        aiEnabled: data.aiEnabled,
        aiProviderId: data.aiProviderId,
        aiModel: data.aiModel,
        aiPrompt: data.aiPrompt,
        maxOccurrences: data.recurrenceRule?.maxOccurrences,
        createdById: request.user.id,
      },
      include: {
        instance: { select: { id: true, name: true, channel: true, status: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    return reply.status(201).send(schedule)
  })

  // ── Atualizar agendamento ──
  fastify.put('/:id', {
    preHandler: [requirePermission('schedules:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const data = updateScheduleSchema.parse(request.body)

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Agendamento não encontrado' })

    // Se reativando, recalcular próxima execução
    let nextExecutionAt = existing.nextExecutionAt
    if (data.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
      const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : existing.scheduledAt
      nextExecutionAt = calculateNextExecution(
        data.recurrence || existing.recurrence,
        scheduledAt,
        data.recurrenceRule || existing.recurrenceRule,
        existing.lastExecutedAt,
      )
    }
    if (data.scheduledAt || data.recurrence || data.recurrenceRule) {
      const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : existing.scheduledAt
      nextExecutionAt = calculateNextExecution(
        data.recurrence || existing.recurrence,
        scheduledAt,
        data.recurrenceRule || existing.recurrenceRule,
        existing.lastExecutedAt,
      )
    }

    const updateData: any = { ...data }
    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt)
    if (data.recurrenceRule?.maxOccurrences) updateData.maxOccurrences = data.recurrenceRule.maxOccurrences
    updateData.nextExecutionAt = nextExecutionAt
    delete updateData.recurrenceRule
    if (data.recurrenceRule) updateData.recurrenceRule = data.recurrenceRule

    const schedule = await prisma.scheduledMessage.update({
      where: { id },
      data: updateData,
      include: {
        instance: { select: { id: true, name: true, channel: true, status: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    return reply.send(schedule)
  })

  // ── Duplicar agendamento ──
  fastify.post('/:id/duplicate', {
    preHandler: [requirePermission('schedules:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Agendamento não encontrado' })

    const nextExecutionAt = calculateNextExecution(
      existing.recurrence,
      existing.scheduledAt,
      existing.recurrenceRule,
    )

    const duplicate = await prisma.scheduledMessage.create({
      data: {
        companyId: existing.companyId,
        instanceId: existing.instanceId,
        contactId: existing.contactId,
        remoteJid: existing.remoteJid,
        name: `${existing.name} (cópia)`,
        messageType: existing.messageType,
        content: existing.content,
        mediaUrl: existing.mediaUrl,
        mediaFileName: existing.mediaFileName,
        status: 'PAUSED',
        recurrence: existing.recurrence,
        timezone: existing.timezone,
        scheduledAt: existing.scheduledAt,
        recurrenceRule: existing.recurrenceRule || undefined,
        nextExecutionAt,
        aiEnabled: existing.aiEnabled,
        aiProviderId: existing.aiProviderId,
        aiModel: existing.aiModel,
        aiPrompt: existing.aiPrompt,
        maxOccurrences: existing.maxOccurrences,
        createdById: request.user.id,
      },
      include: {
        instance: { select: { id: true, name: true, channel: true, status: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    return reply.status(201).send(duplicate)
  })

  // ── Deletar agendamento ──
  fastify.delete('/:id', {
    preHandler: [requirePermission('schedules:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, companyId: request.user.companyId },
    })
    if (!existing) return reply.status(404).send({ error: 'Agendamento não encontrado' })

    await prisma.scheduledMessage.delete({ where: { id } })
    return reply.send({ success: true })
  })

  // ── Logs de execução ──
  fastify.get('/:id/logs', {
    preHandler: [requirePermission('schedules:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const { page = '1', limit = '20' } = request.query as { page?: string; limit?: string }

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, companyId: request.user.companyId },
      select: { id: true },
    })
    if (!existing) return reply.status(404).send({ error: 'Agendamento não encontrado' })

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [logs, total] = await Promise.all([
      prisma.scheduledMessageLog.findMany({
        where: { scheduledMessageId: id },
        orderBy: { executedAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.scheduledMessageLog.count({
        where: { scheduledMessageId: id },
      }),
    ])

    return reply.send({ logs, total, page: parseInt(page), limit: parseInt(limit) })
  })

  // ── Eventos para calendário (formato otimizado) ──
  fastify.get('/calendar/events', {
    preHandler: [requirePermission('schedules:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { start, end, instanceId } = request.query as {
      start?: string
      end?: string
      instanceId?: string
    }

    const where: any = {
      companyId: request.user.companyId,
      status: { in: ['ACTIVE', 'PAUSED'] },
    }
    if (instanceId) where.instanceId = instanceId

    const schedules = await prisma.scheduledMessage.findMany({
      where,
      include: {
        instance: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, phoneNumber: true } },
      },
    })

    // Gerar eventos expandidos para o calendário no range solicitado
    const rangeStart = start ? new Date(start) : new Date()
    const rangeEnd = end ? new Date(end) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    const events: any[] = []

    // Logs realizados no range (envios passados)
    const pastLogs = await prisma.scheduledMessageLog.findMany({
      where: {
        scheduledMessage: { companyId: request.user.companyId },
        executedAt: { gte: rangeStart, lte: rangeEnd },
      },
      include: {
        scheduledMessage: {
          select: {
            id: true, name: true, messageType: true, status: true, remoteJid: true,
            instance: { select: { id: true, name: true } },
            contact: { select: { id: true, name: true, phoneNumber: true } },
          },
        },
      },
    })

    for (const log of pastLogs) {
      events.push({
        id: `log_${log.id}`,
        scheduleId: log.scheduledMessage.id,
        title: log.scheduledMessage.name,
        start: log.executedAt.toISOString(),
        end: log.executedAt.toISOString(),
        type: 'executed',
        messageType: log.scheduledMessage.messageType,
        status: log.status,
        instance: log.scheduledMessage.instance,
        contact: log.scheduledMessage.contact,
        remoteJid: log.scheduledMessage.remoteJid,
        aiUsed: log.aiUsed,
      })
    }

    // Próximas execuções (futuro)
    for (const sched of schedules) {
      if (sched.nextExecutionAt && sched.nextExecutionAt >= rangeStart && sched.nextExecutionAt <= rangeEnd) {
        events.push({
          id: `next_${sched.id}`,
          scheduleId: sched.id,
          title: sched.name,
          start: sched.nextExecutionAt.toISOString(),
          end: sched.nextExecutionAt.toISOString(),
          type: 'scheduled',
          messageType: sched.messageType,
          status: sched.status,
          instance: sched.instance,
          contact: sched.contact,
          remoteJid: sched.remoteJid,
        })
      }

      // Para recorrentes, expandir futuras ocorrências dentro do range
      if (sched.recurrence !== 'ONCE' && sched.status === 'ACTIVE') {
        let cursor = sched.nextExecutionAt || sched.scheduledAt
        let safety = 0
        while (cursor && cursor <= rangeEnd && safety < 200) {
          if (cursor > rangeStart && cursor > (sched.nextExecutionAt || new Date(0))) {
            events.push({
              id: `future_${sched.id}_${safety}`,
              scheduleId: sched.id,
              title: sched.name,
              start: cursor.toISOString(),
              end: cursor.toISOString(),
              type: 'future',
              messageType: sched.messageType,
              status: sched.status,
              instance: sched.instance,
              contact: sched.contact,
              remoteJid: sched.remoteJid,
            })
          }
          cursor = calculateNextExecution(sched.recurrence, sched.scheduledAt, sched.recurrenceRule, cursor)!
          if (!cursor) break
          // Checar endDate
          const endDate = (sched.recurrenceRule as any)?.endDate
          if (endDate && cursor > new Date(endDate)) break
          safety++
        }
      }
    }

    return reply.send(events)
  })

  // ── Upload de mídia para agendamento ──
  fastify.post('/upload-media', {
    preHandler: [requirePermission('schedules:manage')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const { randomUUID } = await import('crypto')

    let fileBuffer: Buffer | null = null
    let originalName = 'file'

    try {
      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer()
          originalName = part.filename || 'file'
        }
      }
    } catch (err: any) {
      return reply.status(400).send({ error: 'Erro ao processar upload: ' + err.message })
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: 'Arquivo é obrigatório' })
    }

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
    const blockedExts = /\.(html?|svg|jsx?|tsx?|php|aspx?|exe|bat|cmd|ps1|sh|dll|msi|swf|htaccess)$/i
    if (blockedExts.test(safeName)) {
      return reply.status(400).send({ error: 'Tipo de arquivo não permitido' })
    }
    const savedName = `${randomUUID()}-${safeName}`
    const uploadsDir = join(process.cwd(), 'uploads', request.user.companyId)
    const { mkdir } = await import('fs/promises')
    await mkdir(uploadsDir, { recursive: true })
    await writeFile(join(uploadsDir, savedName), fileBuffer)

    const mediaUrl = `/uploads/${request.user.companyId}/${savedName}`

    return reply.send({ url: mediaUrl, fileName: originalName })
  })
}
