import api from './api'

// ─── Types ───────────────────────────────

export type GoalStatus = 'NAO_INICIADO' | 'EM_PROGRESSO' | 'CONCLUIDO' | 'CANCELADO' | 'ATRASADO'
export type GoalType = 'OBJETIVO' | 'RESULTADO_CHAVE' | 'INICIATIVA'
export type GoalMetricType = 'PERCENTUAL' | 'NUMERICO' | 'MONETARIO' | 'BINARIO'

export interface Goal {
  id: string
  companyId: string
  parentId?: string
  title: string
  description?: string
  type: GoalType
  status: GoalStatus
  ownerId: string
  metricType: GoalMetricType
  targetValue: number
  currentValue: number
  startValue: number
  startDate?: string
  endDate?: string
  weight: number
  tags: string[]
  progress: number // calculated
  createdAt: string
  updatedAt: string
  owner: { id: string; name: string; email: string }
  parent?: { id: string; title: string; type: GoalType }
  children?: Goal[]
  checkins?: GoalCheckin[]
  _count: { children: number; checkins: number }
}

export interface GoalCheckin {
  id: string
  goalId: string
  value: number
  note?: string
  authorId: string
  createdAt: string
}

// ─── API ───────────────────────────────

export const getGoals = (params?: Record<string, string>) =>
  api.get<{ goals: Goal[]; total: number; page: number; limit: number; pages: number }>('/goals', { params }).then(r => r.data)

export const getGoalById = (id: string) =>
  api.get<Goal>(`/goals/${id}`).then(r => r.data)

export const createGoal = (data: Partial<Goal>) =>
  api.post<Goal>('/goals', data).then(r => r.data)

export const updateGoal = (id: string, data: Partial<Goal>) =>
  api.put<Goal>(`/goals/${id}`, data).then(r => r.data)

export const deleteGoal = (id: string) =>
  api.delete(`/goals/${id}`).then(r => r.data)

export const addGoalCheckin = (goalId: string, value: number, note?: string) =>
  api.post<GoalCheckin>(`/goals/${goalId}/checkins`, { value, note }).then(r => r.data)

export const getGoalSummary = () =>
  api.get<{ byStatus: Record<string, number>; byType: Record<string, number> }>('/goals/summary').then(r => r.data)
