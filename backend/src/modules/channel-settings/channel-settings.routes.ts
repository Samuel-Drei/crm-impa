import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

// ══════════════════════════════════════════
// ═══ SCHEMAS DE VALIDAÇÃO ═══
// ══════════════════════════════════════════

const instanceIdParamSchema = z.object({
  instanceId: z.string().uuid(),
})

const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
})

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
})

const workingHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openHour: z.number().int().min(0).max(23),
  openMinutes: z.number().int().min(0).max(59),
  closeHour: z.number().int().min(0).max(23),
  closeMinutes: z.number().int().min(0).max(59),
  closedAllDay: z.boolean(),
})

const updateWorkingHoursSchema = z.object({
  workingHoursEnabled: z.boolean(),
  outOfOfficeMessage: z.string().max(1000).nullable().optional(),
  timezone: z.string().max(100).optional(),
  hours: z.array(workingHourSchema).length(7), // Exatamente 7 dias
})

const updateCsatConfigSchema = z.object({
  csatEnabled: z.boolean(),
  csatMessage: z.string().max(500).nullable().optional(),
})

// ══════════════════════════════════════════
// ═══ HELPERS ═══
// ══════════════════════════════════════════

async function verifyInstanceOwnership(instanceId: string, companyId: string) {
  return prisma.instance.findFirst({
    where: { id: instanceId, companyId, isActive: true },
    select: { id: true, companyId: true },
  })
}

// ══════════════════════════════════════════
// ═══ ROTAS ═══
// ══════════════════════════════════════════

export async function channelSettingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ──────────────────────────────
  // MEMBROS / COLABORADORES
  // ──────────────────────────────

  // Listar membros do canal
  fastify.get('/:instanceId/members', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    const members = await prisma.instanceMember.findMany({
      where: { instanceId },
      include: {
        user: {
          select: { id: true, name: true, email: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send(members)
  })

  // Adicionar membros ao canal
  fastify.post('/:instanceId/members', { preHandler: [requirePermission('instances:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)
    const { userIds } = addMembersSchema.parse(request.body)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    // Verificar que todos os usuários pertencem à mesma empresa
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, companyId: request.user.companyId, isActive: true },
      select: { id: true },
    })

    const validUserIds = users.map(u => u.id)
    if (validUserIds.length === 0) {
      return reply.status(400).send({ error: 'Nenhum usuário válido encontrado' })
    }

    // Criar membros (skipDuplicates evita erro se já existir)
    await prisma.instanceMember.createMany({
      data: validUserIds.map(userId => ({ instanceId, userId })),
      skipDuplicates: true,
    })

    // Retornar lista atualizada
    const members = await prisma.instanceMember.findMany({
      where: { instanceId },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send(members)
  })

  // Sincronizar membros (substituir lista completa)
  fastify.put('/:instanceId/members', { preHandler: [requirePermission('instances:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)
    const { userIds } = addMembersSchema.parse(request.body)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    // Verificar que todos os usuários pertencem à mesma empresa
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, companyId: request.user.companyId, isActive: true },
      select: { id: true },
    })

    const validUserIds = users.map(u => u.id)

    // Substituir membros numa transação
    await prisma.$transaction([
      prisma.instanceMember.deleteMany({ where: { instanceId } }),
      prisma.instanceMember.createMany({
        data: validUserIds.map(userId => ({ instanceId, userId })),
      }),
    ])

    const members = await prisma.instanceMember.findMany({
      where: { instanceId },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send(members)
  })

  // Remover membro do canal
  fastify.delete('/:instanceId/members/:userId', { preHandler: [requirePermission('instances:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)
    const { userId } = removeMemberSchema.parse((request as any).params)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    await prisma.instanceMember.deleteMany({
      where: { instanceId, userId },
    })

    return reply.send({ success: true })
  })

  // ──────────────────────────────
  // HORÁRIO DE FUNCIONAMENTO
  // ──────────────────────────────

  // Obter configuração de horários
  fastify.get('/:instanceId/working-hours', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)

    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, companyId: request.user.companyId, isActive: true },
      select: {
        id: true,
        workingHoursEnabled: true,
        outOfOfficeMessage: true,
        timezone: true,
      },
    })

    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    let hours = await prisma.workingHour.findMany({
      where: { instanceId },
      orderBy: { dayOfWeek: 'asc' },
    })

    // Se ainda não tem horários, criar os 7 dias com padrão
    if (hours.length === 0) {
      const defaultHours = Array.from({ length: 7 }, (_, day) => ({
        instanceId,
        dayOfWeek: day,
        openHour: 9,
        openMinutes: 0,
        closeHour: 18,
        closeMinutes: 0,
        closedAllDay: day === 0 || day === 6, // Dom e Sab fechados
      }))

      await prisma.workingHour.createMany({ data: defaultHours })
      hours = await prisma.workingHour.findMany({
        where: { instanceId },
        orderBy: { dayOfWeek: 'asc' },
      })
    }

    return reply.send({
      workingHoursEnabled: instance.workingHoursEnabled,
      outOfOfficeMessage: instance.outOfOfficeMessage,
      timezone: instance.timezone,
      hours,
    })
  })

  // Atualizar configuração de horários
  fastify.put('/:instanceId/working-hours', { preHandler: [requirePermission('instances:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)
    const data = updateWorkingHoursSchema.parse(request.body)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    // Validar que hora de fechar é depois de abrir (quando não fechado)
    for (const h of data.hours) {
      if (!h.closedAllDay) {
        const openMinTotal = h.openHour * 60 + h.openMinutes
        const closeMinTotal = h.closeHour * 60 + h.closeMinutes
        if (closeMinTotal <= openMinTotal) {
          const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
          return reply.status(400).send({
            error: `${dayNames[h.dayOfWeek]}: horário de fechamento deve ser posterior ao de abertura`,
          })
        }
      }
    }

    await prisma.$transaction([
      // Atualizar campos da instância
      prisma.instance.update({
        where: { id: instanceId },
        data: {
          workingHoursEnabled: data.workingHoursEnabled,
          outOfOfficeMessage: data.outOfOfficeMessage ?? null,
          timezone: data.timezone,
        },
      }),
      // Upsert cada dia
      ...data.hours.map(h =>
        prisma.workingHour.upsert({
          where: { instanceId_dayOfWeek: { instanceId, dayOfWeek: h.dayOfWeek } },
          update: {
            openHour: h.openHour,
            openMinutes: h.openMinutes,
            closeHour: h.closeHour,
            closeMinutes: h.closeMinutes,
            closedAllDay: h.closedAllDay,
          },
          create: {
            instanceId,
            dayOfWeek: h.dayOfWeek,
            openHour: h.openHour,
            openMinutes: h.openMinutes,
            closeHour: h.closeHour,
            closeMinutes: h.closeMinutes,
            closedAllDay: h.closedAllDay,
          },
        })
      ),
    ])

    return reply.send({ success: true })
  })

  // ──────────────────────────────
  // PESQUISA DE SATISFAÇÃO (CSAT)
  // ──────────────────────────────

  // Obter configuração CSAT
  fastify.get('/:instanceId/csat', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)

    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, companyId: request.user.companyId, isActive: true },
      select: { id: true, csatEnabled: true, csatMessage: true },
    })

    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    return reply.send({
      csatEnabled: instance.csatEnabled,
      csatMessage: instance.csatMessage,
    })
  })

  // Atualizar configuração CSAT
  fastify.put('/:instanceId/csat', { preHandler: [requirePermission('instances:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)
    const data = updateCsatConfigSchema.parse(request.body)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        csatEnabled: data.csatEnabled,
        csatMessage: data.csatMessage ?? null,
      },
    })

    return reply.send({ success: true })
  })

  // Listar respostas CSAT (com filtros)
  fastify.get('/:instanceId/csat/responses', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)

    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      agentId: z.string().uuid().optional(),
      startDate: z.string().optional(), // ISO date YYYY-MM-DD
      endDate: z.string().optional(),
    }).parse((request as any).query)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    const where: any = { instanceId }
    if (query.rating) where.rating = query.rating
    if (query.agentId) where.assignedAgentId = query.agentId
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) where.createdAt.gte = new Date(query.startDate)
      if (query.endDate) {
        const end = new Date(query.endDate)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const [responses, total] = await Promise.all([
      prisma.csatSurveyResponse.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, phoneNumber: true, profilePicture: true } },
          assignedAgent: { select: { id: true, name: true, email: true } },
          conversation: { select: { id: true, remoteJid: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.csatSurveyResponse.count({ where }),
    ])

    return reply.send({ responses, total, page: query.page, limit: query.limit })
  })

  fastify.get('/:instanceId/csat/metrics', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = instanceIdParamSchema.parse((request as any).params)

    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).parse((request as any).query)

    const instance = await verifyInstanceOwnership(instanceId, request.user.companyId)
    if (!instance) return reply.status(404).send({ error: 'Canal não encontrado' })

    const where: any = { instanceId }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) where.createdAt.gte = new Date(query.startDate)
      if (query.endDate) {
        const end = new Date(query.endDate)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const [aggregate, distribution, byAgent] = await Promise.all([
      prisma.csatSurveyResponse.aggregate({
        where,
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.csatSurveyResponse.groupBy({
        by: ['rating'],
        where,
        _count: { id: true },
        orderBy: { rating: 'asc' },
      }),
      prisma.csatSurveyResponse.groupBy({
        by: ['assignedAgentId'],
        where,
        _avg: { rating: true },
        _count: { id: true },
      }),
    ])

    // Resolve agent names
    const agentIds = byAgent.map(r => r.assignedAgentId).filter(Boolean) as string[]
    const agents = agentIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : []
    const agentMap = new Map(agents.map(a => [a.id, a.name]))

    return reply.send({
      averageRating: aggregate._avg.rating ?? 0,
      totalResponses: aggregate._count.id,
      distribution: distribution.map(d => ({ rating: d.rating, count: d._count.id })),
      byAgent: byAgent.map(r => ({
        agentId: r.assignedAgentId,
        agentName: r.assignedAgentId ? (agentMap.get(r.assignedAgentId) ?? 'Desconhecido') : 'Sem agente',
        averageRating: r._avg.rating ?? 0,
        count: r._count.id,
      })),
    })
  })
}
