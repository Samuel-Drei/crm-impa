import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { logActivityByContact } from '../customers/customer-activity.service.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listProjectsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  contactId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
})

const createProjectSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().optional(),
  contactId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  billingType: z.enum(['FIXED', 'HOURLY', 'FREE']).default('FIXED'),
  fixedCost: z.number().min(0).optional(),
  hourlyRate: z.number().min(0).optional(),
  progressMode: z.string().optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  members: z.array(z.object({
    userId: z.string().uuid(),
    role: z.string().optional(),
  })).optional(),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  contactId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  billingType: z.enum(['FIXED', 'HOURLY', 'FREE']).optional(),
  fixedCost: z.number().min(0).optional(),
  hourlyRate: z.number().min(0).optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  progressMode: z.string().optional(),
})

const createMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

// ── Helpers ──────────────────────────────────────────────

async function logProjectActivity(projectId: string, type: string, actorId: string, content?: string, meta?: any) {
  await prisma.projectActivity.create({
    data: {
      projectId,
      type,
      content,
      actorId,
      actorType: 'user',
      metadata: meta,
    },
  })
}

async function recalcProjectProgress(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project || project.progressMode !== 'auto') return

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { status: true },
  })

  if (tasks.length === 0) return

  const completed = tasks.filter(t => t.status === 'COMPLETED').length
  const progress = Math.round((completed / tasks.length) * 100)

  await prisma.project.update({
    where: { id: projectId },
    data: { progress },
  })
}

// ── Project Routes ───────────────────────────────────────

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar projetos
  fastify.get('/', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listProjectsQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.name = { contains: query.search, mode: 'insensitive' }
      }
      if (query.status) where.status = query.status
      if (query.contactId) where.contactId = query.contactId
      if (query.contractId) where.contractId = query.contractId

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          include: {
            contact: { select: { id: true, name: true, email: true, phoneNumber: true } },
            contract: { select: { id: true, title: true, number: true } },
            members: { include: { project: false } },
            _count: { select: { tasks: true, milestones: true, invoices: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.project.count({ where }),
      ])

      return reply.send({ projects, total, page: query.page, limit: query.limit })
    }
  )

  // Obter projeto por ID (com todos os dados)
  fastify.get('/:id', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const project = await prisma.project.findFirst({
        where: { id, companyId },
        include: {
          contact: true,
          contract: { select: { id: true, title: true, number: true, prefix: true } },
          members: true,
          milestones: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { tasks: true } } } },
          tasks: {
            include: {
              assignees: true,
              milestone: { select: { id: true, name: true } },
            },
            orderBy: [{ kanbanOrder: 'asc' }, { createdAt: 'desc' }],
          },
          activities: { orderBy: { createdAt: 'desc' }, take: 50 },
          discussions: {
            orderBy: { lastActivityAt: 'desc' },
            include: { _count: { select: { comments: true } } },
          },
          timesheets: {
            orderBy: { startTime: 'desc' },
            take: 50,
          },
        },
      })

      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      // Notes are private per user
      const userNotes = await prisma.projectNote.findMany({
        where: { projectId: id, createdBy: request.user.sub },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send({ project: { ...project, notes: userNotes } })
    }
  )

  // Overview / Stats do projeto
  fastify.get('/:id/overview', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const taskStats = await prisma.task.groupBy({
        by: ['status'],
        where: { projectId: id },
        _count: true,
      })
      const totalTasks = taskStats.reduce((s, t) => s + t._count, 0)
      const completedTasks = taskStats.find(t => t.status === 'COMPLETED')?._count || 0
      const overdueTasks = await prisma.task.count({
        where: {
          projectId: id,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          dueDate: { lt: new Date() },
        },
      })

      const totalTimeTracked = await prisma.task.aggregate({
        where: { projectId: id },
        _sum: { timeTracked: true },
      })

      const timesheets = await prisma.projectTimesheet.findMany({
        where: { projectId: id },
        select: { duration: true },
      })
      const totalTimesheetMinutes = timesheets.reduce((s, t) => s + (t.duration || 0), 0)

      const invoiceStats = await prisma.invoice.aggregate({
        where: { projectId: id },
        _sum: { total: true, amountPaid: true },
        _count: true,
      })

      const expenseStats = await prisma.expense.aggregate({
        where: { projectId: id },
        _sum: { amount: true },
        _count: true,
      })

      let daysRemaining = null
      let totalDays = null
      let daysElapsed = null
      if (project.startDate) {
        const start = new Date(project.startDate)
        const now = new Date()
        daysElapsed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        if (project.deadline) {
          const end = new Date(project.deadline)
          totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
          daysRemaining = Math.floor((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        }
      }

      return reply.send({
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          overdue: overdueTasks,
          byStatus: Object.fromEntries(taskStats.map(s => [s.status, s._count])),
        },
        time: {
          totalTrackedMinutes: totalTimeTracked._sum.timeTracked || 0,
          totalTimesheetMinutes,
        },
        financial: {
          invoiceCount: invoiceStats._count,
          invoiceTotal: Number(invoiceStats._sum.total || 0),
          amountPaid: Number(invoiceStats._sum.amountPaid || 0),
          expenseCount: expenseStats._count,
          expenseTotal: Number(expenseStats._sum.amount || 0),
        },
        timeline: {
          daysElapsed,
          daysRemaining,
          totalDays,
          isOverdue: daysRemaining !== null && daysRemaining < 0 && project.status !== 'COMPLETED' && project.status !== 'CANCELLED',
        },
      })
    }
  )

  // Criar projeto
  fastify.post('/', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createProjectSchema.parse(request.body)

      const { members, ...projectData } = body

      const project = await prisma.project.create({
        data: {
          companyId,
          ...projectData,
          startDate: projectData.startDate ? new Date(projectData.startDate) : null,
          deadline: projectData.deadline ? new Date(projectData.deadline) : null,
          createdBy: userId,
          members: members ? {
            create: members.map(m => ({ userId: m.userId, role: m.role })),
          } : undefined,
        },
        include: { contact: true, members: true },
      })

      await logProjectActivity(project.id, 'created', userId, `Projeto "${body.name}" criado`)
      if (body.contactId) logActivityByContact({ companyId, contactId: body.contactId, userId, action: 'PROJECT_CREATED', entity: 'project', entityId: project.id, description: `Projeto "${body.name}" criado` })

      return reply.status(201).send({ project })
    }
  )

  // Copiar projeto
  fastify.post('/:id/copy', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub

      const body = z.object({
        name: z.string().min(1),
        startDate: z.string().optional(),
        deadline: z.string().optional(),
        contactId: z.string().uuid().nullable().optional(),
        copyTasks: z.boolean().default(true),
        copyMilestones: z.boolean().default(true),
        copyMembers: z.boolean().default(true),
      }).parse(request.body)

      const original = await prisma.project.findFirst({
        where: { id, companyId },
        include: {
          members: true,
          milestones: { orderBy: { sortOrder: 'asc' } },
          tasks: { include: { assignees: true } },
        },
      })
      if (!original) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const origStart = original.startDate ? new Date(original.startDate) : new Date()
      const newStart = body.startDate ? new Date(body.startDate) : new Date()
      const dayOffset = Math.floor((newStart.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24))

      const newProject = await prisma.project.create({
        data: {
          companyId,
          name: body.name,
          description: original.description,
          contactId: body.contactId !== undefined ? body.contactId : original.contactId,
          contractId: original.contractId,
          billingType: original.billingType,
          fixedCost: original.fixedCost,
          hourlyRate: original.hourlyRate,
          progressMode: original.progressMode,
          startDate: newStart,
          deadline: body.deadline ? new Date(body.deadline)
            : original.deadline ? new Date(original.deadline.getTime() + dayOffset * 86400000) : null,
          createdBy: userId,
        },
      })

      const milestoneMap: Record<string, string> = {}
      if (body.copyMilestones) {
        for (const m of original.milestones) {
          const newM = await prisma.milestone.create({
            data: {
              projectId: newProject.id,
              name: m.name,
              description: m.description,
              dueDate: m.dueDate ? new Date(m.dueDate.getTime() + dayOffset * 86400000) : null,
              sortOrder: m.sortOrder,
              color: m.color,
            },
          })
          milestoneMap[m.id] = newM.id
        }
      }

      if (body.copyTasks) {
        for (const t of original.tasks) {
          await prisma.task.create({
            data: {
              companyId,
              name: t.name,
              description: t.description,
              status: 'NOT_STARTED',
              priority: t.priority,
              projectId: newProject.id,
              milestoneId: t.milestoneId ? milestoneMap[t.milestoneId] || null : null,
              startDate: t.startDate ? new Date(t.startDate.getTime() + dayOffset * 86400000) : null,
              dueDate: t.dueDate ? new Date(t.dueDate.getTime() + dayOffset * 86400000) : null,
              billable: t.billable,
              isPublic: t.isPublic,
              kanbanOrder: t.kanbanOrder,
              checklist: t.checklist as any,
              createdBy: userId,
              assignees: { create: t.assignees.map(a => ({ userId: a.userId })) },
            },
          })
        }
      }

      if (body.copyMembers) {
        await prisma.projectMember.createMany({
          data: original.members.map(m => ({
            projectId: newProject.id,
            userId: m.userId,
            role: m.role,
          })),
          skipDuplicates: true,
        })
      }

      await logProjectActivity(newProject.id, 'created', userId, `Projeto copiado de "${original.name}"`)

      const full = await prisma.project.findUnique({
        where: { id: newProject.id },
        include: { contact: true, members: true, milestones: true, _count: { select: { tasks: true } } },
      })

      return reply.status(201).send({ project: full })
    }
  )

  // Atualizar projeto
  fastify.put('/:id', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = updateProjectSchema.parse(request.body)

      const existing = await prisma.project.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const updateData: any = { ...body }
      if (updateData.startDate) updateData.startDate = new Date(updateData.startDate)
      if (updateData.deadline) updateData.deadline = new Date(updateData.deadline)

      const project = await prisma.project.update({
        where: { id },
        data: updateData,
        include: { contact: true, members: true },
      })

      await logProjectActivity(id, 'updated', userId, 'Projeto atualizado')

      return reply.send({ project })
    }
  )

  // Alterar status
  fastify.patch('/:id/status', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const { status, completeAllTasks } = z.object({
        status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']),
        completeAllTasks: z.boolean().optional(),
      }).parse(request.body)

      const existing = await prisma.project.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const updateData: any = { status }
      if (status === 'COMPLETED') updateData.completedAt = new Date()

      if (status === 'COMPLETED' && completeAllTasks) {
        await prisma.task.updateMany({
          where: { projectId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })
      }

      const project = await prisma.project.update({ where: { id }, data: updateData })

      await logProjectActivity(id, 'status_changed', userId, `Status alterado para ${status}`, {
        oldStatus: existing.status,
        newStatus: status,
      })

      return reply.send({ project })
    }
  )

  // Gerenciar membros
  fastify.post('/:id/members', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = z.object({
        userId: z.string().uuid(),
        role: z.string().optional(),
      }).parse(request.body)

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const member = await prisma.projectMember.create({
        data: { projectId: id, userId: body.userId, role: body.role },
      })

      await logProjectActivity(id, 'member_added', request.user.sub, 'Membro adicionado ao projeto')

      return reply.status(201).send({ member })
    }
  )

  fastify.delete('/:id/members/:userId', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId

      const project = await prisma.project.findFirst({ where: { id: params.id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: params.id, userId: params.userId } },
      })

      await logProjectActivity(params.id, 'member_removed', request.user.sub, 'Membro removido do projeto')

      return reply.status(204).send()
    }
  )

  // ── Milestones ─────────────────────────────────────────

  fastify.post('/:id/milestones', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = createMilestoneSchema.parse(request.body)

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const milestone = await prisma.milestone.create({
        data: {
          projectId: id,
          ...body,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
        },
      })

      await logProjectActivity(id, 'milestone_created', request.user.sub, `Marco "${body.name}" criado`)

      return reply.status(201).send({ milestone })
    }
  )

  fastify.put('/:id/milestones/:milestoneId', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId
      const body = createMilestoneSchema.partial().parse(request.body)

      const project = await prisma.project.findFirst({ where: { id: params.id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const updateData: any = { ...body }
      if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate)

      const milestone = await prisma.milestone.update({
        where: { id: params.milestoneId },
        data: updateData,
      })

      return reply.send({ milestone })
    }
  )

  fastify.delete('/:id/milestones/:milestoneId', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId

      const project = await prisma.project.findFirst({ where: { id: params.id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      await prisma.task.updateMany({
        where: { milestoneId: params.milestoneId },
        data: { milestoneId: null },
      })

      await prisma.milestone.delete({ where: { id: params.milestoneId } })
      await logProjectActivity(params.id, 'milestone_deleted', request.user.sub, 'Marco excluído')

      return reply.status(204).send()
    }
  )

  // Reordenar milestones
  fastify.patch('/:id/milestones/reorder', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = z.object({
        milestones: z.array(z.object({
          id: z.string().uuid(),
          sortOrder: z.number().int(),
        })),
      }).parse(request.body)

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      await prisma.$transaction(
        body.milestones.map(m =>
          prisma.milestone.update({ where: { id: m.id }, data: { sortOrder: m.sortOrder } })
        )
      )

      return reply.send({ success: true })
    }
  )

  // ── Discussões ─────────────────────────────────────────

  fastify.get('/:id/discussions', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const discussions = await prisma.projectDiscussion.findMany({
        where: { projectId: id },
        include: { _count: { select: { comments: true } } },
        orderBy: { lastActivityAt: 'desc' },
      })

      return reply.send({ discussions })
    }
  )

  fastify.post('/:id/discussions', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = z.object({
        subject: z.string().min(1).max(300),
        description: z.string().optional(),
      }).parse(request.body)

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const discussion = await prisma.projectDiscussion.create({
        data: { projectId: id, subject: body.subject, description: body.description, createdBy: userId },
      })

      await logProjectActivity(id, 'discussion_created', userId, `Discussão "${body.subject}" criada`)

      return reply.status(201).send({ discussion })
    }
  )

  fastify.get('/:id/discussions/:discussionId', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), discussionId: z.string().uuid() }).parse(request.params)

      const discussion = await prisma.projectDiscussion.findUnique({
        where: { id: params.discussionId },
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      })
      if (!discussion) return reply.status(404).send({ error: 'Discussão não encontrada' })

      return reply.send({ discussion })
    }
  )

  fastify.post('/:id/discussions/:discussionId/comments', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), discussionId: z.string().uuid() }).parse(request.params)
      const userId = request.user.sub
      const body = z.object({
        content: z.string().min(1),
        parentId: z.string().uuid().optional(),
      }).parse(request.body)

      const comment = await prisma.projectDiscussionComment.create({
        data: {
          discussionId: params.discussionId,
          content: body.content,
          parentId: body.parentId,
          authorId: userId,
          authorName: request.user.name || 'Usuário',
        },
      })

      await prisma.projectDiscussion.update({
        where: { id: params.discussionId },
        data: { lastActivityAt: new Date() },
      })

      return reply.status(201).send({ comment })
    }
  )

  fastify.delete('/:id/discussions/:discussionId', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), discussionId: z.string().uuid() }).parse(request.params)

      await prisma.projectDiscussion.delete({ where: { id: params.discussionId } })
      await logProjectActivity(params.id, 'discussion_deleted', request.user.sub, 'Discussão excluída')

      return reply.status(204).send()
    }
  )

  // ── Notas (privadas por usuário) ───────────────────────

  fastify.get('/:id/notes', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const userId = request.user.sub

      const notes = await prisma.projectNote.findMany({
        where: { projectId: id, createdBy: userId },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send({ notes })
    }
  )

  fastify.post('/:id/notes', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const userId = request.user.sub
      const body = z.object({
        title: z.string().min(1).max(300),
        content: z.string().optional(),
      }).parse(request.body)

      const note = await prisma.projectNote.create({
        data: { projectId: id, title: body.title, content: body.content, createdBy: userId },
      })

      return reply.status(201).send({ note })
    }
  )

  fastify.put('/:id/notes/:noteId', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), noteId: z.string().uuid() }).parse(request.params)
      const userId = request.user.sub
      const body = z.object({
        title: z.string().min(1).max(300).optional(),
        content: z.string().optional(),
      }).parse(request.body)

      const existing = await prisma.projectNote.findFirst({
        where: { id: params.noteId, createdBy: userId },
      })
      if (!existing) return reply.status(404).send({ error: 'Nota não encontrada' })

      const note = await prisma.projectNote.update({
        where: { id: params.noteId },
        data: body,
      })

      return reply.send({ note })
    }
  )

  fastify.delete('/:id/notes/:noteId', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), noteId: z.string().uuid() }).parse(request.params)
      const userId = request.user.sub

      const existing = await prisma.projectNote.findFirst({
        where: { id: params.noteId, createdBy: userId },
      })
      if (!existing) return reply.status(404).send({ error: 'Nota não encontrada' })

      await prisma.projectNote.delete({ where: { id: params.noteId } })
      return reply.status(204).send()
    }
  )

  // ── Timesheets ─────────────────────────────────────────

  fastify.get('/:id/timesheets', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const query = z.object({
        userId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(request.query)

      const where: any = { projectId: id }
      if (query.userId) where.userId = query.userId

      const [timesheets, total] = await Promise.all([
        prisma.projectTimesheet.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.projectTimesheet.count({ where }),
      ])

      return reply.send({ timesheets, total })
    }
  )

  fastify.post('/:id/timesheets', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const userId = request.user.sub

      const body = z.object({
        taskId: z.string().uuid().nullable().optional(),
        startTime: z.string(),
        endTime: z.string().optional(),
        duration: z.number().int().min(1).optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        userId: z.string().uuid().optional(),
      }).parse(request.body)

      const project = await prisma.project.findFirst({ where: { id, companyId } })
      if (!project) return reply.status(404).send({ error: 'Projeto não encontrado' })

      const start = new Date(body.startTime)
      const end = body.endTime ? new Date(body.endTime) : null
      const durationMinutes = body.duration || (end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0)

      const timesheet = await prisma.projectTimesheet.create({
        data: {
          projectId: id,
          taskId: body.taskId,
          userId: body.userId || userId,
          startTime: start,
          endTime: end,
          duration: durationMinutes,
          note: body.note,
          tags: body.tags || [],
        },
      })

      if (body.taskId && durationMinutes > 0) {
        await prisma.task.update({
          where: { id: body.taskId },
          data: { timeTracked: { increment: durationMinutes } },
        })
      }

      return reply.status(201).send({ timesheet })
    }
  )

  fastify.delete('/:id/timesheets/:timesheetId', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), timesheetId: z.string().uuid() }).parse(request.params)

      const ts = await prisma.projectTimesheet.findUnique({ where: { id: params.timesheetId } })
      if (!ts) return reply.status(404).send({ error: 'Timesheet não encontrado' })

      if (ts.taskId && ts.duration) {
        await prisma.task.update({
          where: { id: ts.taskId },
          data: { timeTracked: { decrement: ts.duration } },
        })
      }

      await prisma.projectTimesheet.delete({ where: { id: params.timesheetId } })
      return reply.status(204).send()
    }
  )

  // ── Atividades ─────────────────────────────────────────

  fastify.get('/:id/activities', { preHandler: [requirePermission('projects:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const query = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(request.query)

      const [activities, total] = await Promise.all([
        prisma.projectActivity.findMany({
          where: { projectId: id },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.projectActivity.count({ where: { projectId: id } }),
      ])

      return reply.send({ activities, total })
    }
  )

  // Deletar projeto
  fastify.delete('/:id', { preHandler: [requirePermission('projects:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.project.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Projeto não encontrado' })

      await prisma.project.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}

// ── Task Routes ──────────────────────────────────────────

const listTasksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  search: z.string().optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_FEEDBACK', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  projectId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
})

const createTaskSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_FEEDBACK', 'COMPLETED', 'CANCELLED']).default('NOT_STARTED'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  assignees: z.array(z.string().uuid()).optional(),
  checklist: z.any().optional(),
  billable: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  kanbanOrder: z.number().int().optional(),
})

const updateTaskSchema = createTaskSchema.partial()

export async function taskRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar tarefas
  fastify.get('/', { preHandler: [requirePermission('tasks:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listTasksQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.name = { contains: query.search, mode: 'insensitive' }
      }
      if (query.status) where.status = query.status
      if (query.priority) where.priority = query.priority
      if (query.projectId) where.projectId = query.projectId
      if (query.milestoneId) where.milestoneId = query.milestoneId
      if (query.contactId) where.contactId = query.contactId
      if (query.assignedTo) {
        where.assignees = { some: { userId: query.assignedTo } }
      }
      if (query.overdue) {
        where.status = { notIn: ['COMPLETED', 'CANCELLED'] }
        where.dueDate = { lt: new Date() }
      }

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          include: {
            assignees: true,
            project: { select: { id: true, name: true } },
            milestone: { select: { id: true, name: true } },
            contact: { select: { id: true, name: true, email: true, phoneNumber: true } },
          },
          orderBy: [{ kanbanOrder: 'asc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.task.count({ where }),
      ])

      return reply.send({ tasks, total, page: query.page, limit: query.limit })
    }
  )

  // Obter tarefa por ID
  fastify.get('/:id', { preHandler: [requirePermission('tasks:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const task = await prisma.task.findFirst({
        where: { id, companyId },
        include: {
          assignees: true,
          project: { select: { id: true, name: true } },
          milestone: { select: { id: true, name: true } },
          contract: { select: { id: true, title: true, number: true } },
          contact: true,
          conversation: { select: { id: true, contactId: true } },
        },
      })

      if (!task) return reply.status(404).send({ error: 'Tarefa não encontrada' })
      return reply.send({ task })
    }
  )

  // Criar tarefa
  fastify.post('/', { preHandler: [requirePermission('tasks:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = createTaskSchema.parse(request.body)

      const { assignees, ...taskData } = body

      const task = await prisma.task.create({
        data: {
          companyId,
          ...taskData,
          startDate: taskData.startDate ? new Date(taskData.startDate) : null,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          createdBy: userId,
          assignees: assignees ? {
            create: assignees.map(userId => ({ userId })),
          } : undefined,
        },
        include: { assignees: true, project: { select: { id: true, name: true } } },
      })

      if (task.projectId) {
        await recalcProjectProgress(task.projectId)
        await logProjectActivity(task.projectId, 'task_created', userId, `Tarefa "${body.name}" criada`)
      }

      return reply.status(201).send({ task })
    }
  )

  // Atualizar tarefa
  fastify.put('/:id', { preHandler: [requirePermission('tasks:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateTaskSchema.parse(request.body)

      const existing = await prisma.task.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Tarefa não encontrada' })

      const { assignees, ...taskData } = body

      const updateData: any = { ...taskData }
      if (updateData.startDate) updateData.startDate = new Date(updateData.startDate)
      if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate)
      if (updateData.status === 'COMPLETED') updateData.completedAt = new Date()

      const task = await prisma.$transaction(async (tx) => {
        if (assignees !== undefined) {
          await tx.taskAssignee.deleteMany({ where: { taskId: id } })
          if (assignees && assignees.length > 0) {
            await tx.taskAssignee.createMany({
              data: assignees.map(userId => ({ taskId: id, userId })),
            })
          }
        }

        return tx.task.update({
          where: { id },
          data: updateData,
          include: { assignees: true, project: { select: { id: true, name: true } } },
        })
      })

      const projectId = task.projectId || existing.projectId
      if (projectId) {
        await recalcProjectProgress(projectId)
      }

      return reply.send({ task })
    }
  )

  // Deletar tarefa
  fastify.delete('/:id', { preHandler: [requirePermission('tasks:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.task.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Tarefa não encontrada' })

      await prisma.task.delete({ where: { id } })

      if (existing.projectId) {
        await recalcProjectProgress(existing.projectId)
      }

      return reply.status(204).send()
    }
  )

  // Reordenar tarefas (Kanban)
  fastify.patch('/reorder', { preHandler: [requirePermission('tasks:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = z.object({
        tasks: z.array(z.object({
          id: z.string().uuid(),
          kanbanOrder: z.number().int(),
          status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_FEEDBACK', 'COMPLETED', 'CANCELLED']).optional(),
          milestoneId: z.string().uuid().nullable().optional(),
        })),
      }).parse(request.body)

      await prisma.$transaction(
        body.tasks.map(task =>
          prisma.task.updateMany({
            where: { id: task.id, companyId },
            data: {
              kanbanOrder: task.kanbanOrder,
              status: task.status,
              milestoneId: task.milestoneId,
              completedAt: task.status === 'COMPLETED' ? new Date() : undefined,
            },
          })
        )
      )

      return reply.send({ success: true })
    }
  )

  // Registrar tempo
  fastify.post('/:id/time', { preHandler: [requirePermission('tasks:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const { minutes } = z.object({ minutes: z.number().int().min(1) }).parse(request.body)

      const existing = await prisma.task.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Tarefa não encontrada' })

      const task = await prisma.task.update({
        where: { id },
        data: { timeTracked: { increment: minutes } },
      })

      return reply.send({ task })
    }
  )
}
