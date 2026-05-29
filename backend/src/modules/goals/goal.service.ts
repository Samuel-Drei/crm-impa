import { prisma } from '../../config/database.js'
import { GoalStatus, GoalType, GoalMetricType, Prisma } from '@prisma/client'

const defaultInclude = {
  owner: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, title: true, type: true } },
  _count: { select: { children: true, checkins: true } },
} satisfies Prisma.GoalInclude

// ─── Calcular progresso ─────────
function calcProgress(currentValue: number, startValue: number, targetValue: number, metricType: GoalMetricType): number {
  if (metricType === 'BINARIO') return currentValue > 0 ? 100 : 0
  if (targetValue === startValue) return currentValue >= targetValue ? 100 : 0
  const progress = ((currentValue - startValue) / (targetValue - startValue)) * 100
  return Math.min(100, Math.max(0, Math.round(progress * 100) / 100))
}

// ─── Criar Goal ─────────
export async function createGoal(data: {
  companyId: string
  title: string
  description?: string
  type?: GoalType
  ownerId: string
  parentId?: string
  metricType?: GoalMetricType
  targetValue?: number
  startValue?: number
  startDate?: Date
  endDate?: Date
  weight?: number
  tags?: string[]
}) {
  return prisma.goal.create({
    data: {
      companyId: data.companyId,
      title: data.title,
      description: data.description,
      type: data.type || 'OBJETIVO',
      ownerId: data.ownerId,
      parentId: data.parentId,
      metricType: data.metricType || 'PERCENTUAL',
      targetValue: data.targetValue ?? 100,
      startValue: data.startValue ?? 0,
      currentValue: data.startValue ?? 0,
      startDate: data.startDate,
      endDate: data.endDate,
      weight: data.weight ?? 1,
      tags: data.tags || [],
    },
    include: defaultInclude,
  })
}

// ─── Listar Goals (árvore plana com nível) ─────────
export async function listGoals(params: {
  companyId: string
  parentId?: string | null
  ownerId?: string
  status?: GoalStatus
  type?: GoalType
  search?: string
  page?: number
  limit?: number
}) {
  const { companyId, parentId, ownerId, status, type, search, page = 1, limit = 50 } = params
  const where: Prisma.GoalWhereInput = { companyId }

  if (parentId === null) where.parentId = null  // top-level
  else if (parentId) where.parentId = parentId

  if (ownerId) where.ownerId = ownerId
  if (status) where.status = status
  if (type) where.type = type
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [goals, total] = await prisma.$transaction([
    prisma.goal.findMany({
      where,
      include: {
        ...defaultInclude,
        children: {
          include: defaultInclude,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.goal.count({ where }),
  ])

  // Adicionar progresso calculado
  const goalsWithProgress = goals.map(g => ({
    ...g,
    progress: calcProgress(Number(g.currentValue), Number(g.startValue), Number(g.targetValue), g.metricType),
    children: (g as any).children?.map((c: any) => ({
      ...c,
      progress: calcProgress(Number(c.currentValue), Number(c.startValue), Number(c.targetValue), c.metricType),
    })),
  }))

  return { goals: goalsWithProgress, total, page, limit, pages: Math.ceil(total / limit) }
}

// ─── Obter Goal com Checkins ─────────
export async function getGoalById(id: string, companyId: string) {
  const goal = await prisma.goal.findFirst({
    where: { id, companyId },
    include: {
      ...defaultInclude,
      children: {
        include: defaultInclude,
        orderBy: { createdAt: 'asc' },
      },
      checkins: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })
  if (!goal) return null
  return {
    ...goal,
    progress: calcProgress(Number(goal.currentValue), Number(goal.startValue), Number(goal.targetValue), goal.metricType),
    children: (goal as any).children?.map((c: any) => ({
      ...c,
      progress: calcProgress(Number(c.currentValue), Number(c.startValue), Number(c.targetValue), c.metricType),
    })),
  }
}

// ─── Atualizar Goal ─────────
export async function updateGoal(id: string, companyId: string, data: {
  title?: string
  description?: string
  status?: GoalStatus
  type?: GoalType
  ownerId?: string
  metricType?: GoalMetricType
  targetValue?: number
  startValue?: number
  currentValue?: number
  startDate?: Date | null
  endDate?: Date | null
  weight?: number
  tags?: string[]
}) {
  const goal = await prisma.goal.update({
    where: { id, companyId },
    data,
    include: defaultInclude,
  })

  // Se tem pai, propagar progresso
  if (goal.parentId) {
    await propagateProgress(goal.parentId, companyId)
  }

  return {
    ...goal,
    progress: calcProgress(Number(goal.currentValue), Number(goal.startValue), Number(goal.targetValue), goal.metricType),
  }
}

// ─── Check-in (registrar progresso) ─────────
export async function addCheckin(goalId: string, companyId: string, authorId: string, value: number, note?: string) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, companyId } })
  if (!goal) throw new Error('Goal não encontrado')

  const [checkin] = await prisma.$transaction([
    prisma.goalCheckin.create({
      data: { goalId, value, note, authorId },
    }),
    prisma.goal.update({
      where: { id: goalId },
      data: {
        currentValue: value,
        status: value >= Number(goal.targetValue) ? 'CONCLUIDO' : Number(value) > Number(goal.startValue) ? 'EM_PROGRESSO' : goal.status,
      },
    }),
  ])

  // Propagar progresso ao pai
  if (goal.parentId) {
    await propagateProgress(goal.parentId, companyId)
  }

  return checkin
}

// ─── Propagar progresso para o pai (média ponderada) ─────────
async function propagateProgress(parentId: string, companyId: string) {
  const parent = await prisma.goal.findFirst({
    where: { id: parentId, companyId },
    include: { children: true },
  })
  if (!parent || parent.children.length === 0) return

  let totalWeight = 0
  let weightedProgress = 0

  for (const child of parent.children) {
    const w = Number(child.weight)
    const progress = calcProgress(Number(child.currentValue), Number(child.startValue), Number(child.targetValue), child.metricType)
    totalWeight += w
    weightedProgress += progress * w
  }

  const parentProgress = totalWeight > 0 ? weightedProgress / totalWeight : 0
  const newCurrentValue = Number(parent.startValue) + (parentProgress / 100) * (Number(parent.targetValue) - Number(parent.startValue))

  await prisma.goal.update({
    where: { id: parentId },
    data: {
      currentValue: Math.round(newCurrentValue * 100) / 100,
      status: parentProgress >= 100 ? 'CONCLUIDO' : parentProgress > 0 ? 'EM_PROGRESSO' : parent.status,
    },
  })

  // Propagar recursivamente
  if (parent.parentId) {
    await propagateProgress(parent.parentId, companyId)
  }
}

// ─── Deletar Goal ─────────
export async function deleteGoal(id: string, companyId: string) {
  return prisma.goal.delete({ where: { id, companyId } })
}

// ─── Resumo por Status (dashboard) ─────────
export async function getGoalSummary(companyId: string) {
  const [byStatus, byType] = await Promise.all([
    prisma.goal.groupBy({ by: ['status'], where: { companyId }, _count: true }),
    prisma.goal.groupBy({ by: ['type'], where: { companyId }, _count: true }),
  ])
  return {
    byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
    byType: Object.fromEntries(byType.map(t => [t.type, t._count])),
  }
}
