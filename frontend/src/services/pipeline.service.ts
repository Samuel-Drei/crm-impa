import api from './api'
import type { Pipeline, Card, CardActivity, PipelineMetrics } from '@/types'

// ── Pipelines ──
export async function getPipelines(): Promise<Pipeline[]> {
  const res = await api.get('/pipelines')
  return res.data.pipelines
}

export async function getPipeline(id: string): Promise<Pipeline> {
  const res = await api.get(`/pipelines/${id}`)
  return res.data.pipeline
}

export async function createPipeline(data: { name: string; description?: string; type?: string; stages?: { name: string; color?: string }[] }): Promise<Pipeline> {
  const res = await api.post('/pipelines', data)
  return res.data.pipeline
}

export async function updatePipeline(id: string, data: Partial<{ name: string; description: string; isActive: boolean; isDefault: boolean }>): Promise<Pipeline> {
  const res = await api.put(`/pipelines/${id}`, data)
  return res.data.pipeline
}

export async function deletePipeline(id: string): Promise<void> {
  await api.delete(`/pipelines/${id}`)
}

// ── Stages ──
export async function addStage(pipelineId: string, data: { name: string; color?: string; isWon?: boolean; isLost?: boolean }): Promise<any> {
  const res = await api.post(`/pipelines/${pipelineId}/stages`, data)
  return res.data.stage
}

export async function updateStage(pipelineId: string, stageId: string, data: Partial<{ name: string; color: string }>): Promise<any> {
  const res = await api.put(`/pipelines/${pipelineId}/stages/${stageId}`, data)
  return res.data.stage
}

export async function deleteStage(pipelineId: string, stageId: string): Promise<void> {
  await api.delete(`/pipelines/${pipelineId}/stages/${stageId}`)
}

export async function reorderStages(pipelineId: string, stages: { id: string; position: number }[]): Promise<void> {
  await api.put(`/pipelines/${pipelineId}/stages/reorder`, { stages })
}

// ── Cards ──
export async function getCards(pipelineId: string, params?: Record<string, any>): Promise<{ cards: Card[]; total: number }> {
  const res = await api.get(`/pipelines/${pipelineId}/cards`, { params })
  return res.data
}

export async function createCard(pipelineId: string, data: {
  title: string
  stageId: string
  description?: string
  contactId?: string
  conversationId?: string
  value?: number
  assigneeId?: string
  teamId?: string
  priority?: string
}): Promise<Card> {
  const res = await api.post(`/pipelines/${pipelineId}/cards`, data)
  return res.data.card
}

export async function getCard(cardId: string): Promise<Card> {
  const res = await api.get(`/cards/${cardId}`)
  return res.data.card
}

export async function updateCard(cardId: string, data: Partial<Card>): Promise<Card> {
  const res = await api.put(`/cards/${cardId}`, data)
  return res.data.card
}

export async function deleteCard(cardId: string): Promise<void> {
  await api.delete(`/cards/${cardId}`)
}

export async function moveCard(cardId: string, stageId: string, position: number): Promise<Card> {
  const res = await api.put(`/cards/${cardId}/move`, { stageId, position })
  return res.data.card
}

export async function markCardWon(cardId: string): Promise<Card> {
  const res = await api.put(`/cards/${cardId}/won`)
  return res.data.card
}

export async function markCardLost(cardId: string, reason?: string): Promise<Card> {
  const res = await api.put(`/cards/${cardId}/lost`, { reason })
  return res.data.card
}

// ── Card Sub-resources ──
export async function getCardActivities(cardId: string, page = 1, limit = 50): Promise<{ activities: CardActivity[]; total: number }> {
  const res = await api.get(`/cards/${cardId}/activities`, { params: { page, limit } })
  return res.data
}

export async function addCardNote(cardId: string, content: string, isPrivate = false) {
  const res = await api.post(`/cards/${cardId}/notes`, { content, isPrivate })
  return res.data.note
}

export async function addCardTask(cardId: string, data: { title: string; assigneeId?: string; dueDate?: string; priority?: string }) {
  const res = await api.post(`/cards/${cardId}/tasks`, data)
  return res.data.task
}

export async function updateCardTask(cardId: string, taskId: string, data: Partial<{ title: string; isCompleted: boolean; assigneeId: string; dueDate: string; priority: string }>) {
  const res = await api.put(`/cards/${cardId}/tasks/${taskId}`, data)
  return res.data.task
}

export async function addCardTag(cardId: string, labelId: string) {
  const res = await api.post(`/cards/${cardId}/tags`, { labelId })
  return res.data.tag
}

export async function removeCardTag(cardId: string, labelId: string) {
  await api.delete(`/cards/${cardId}/tags/${labelId}`)
}

// ── Cards by Conversation ──
export async function getCardsByConversation(conversationId: string): Promise<Card[]> {
  const res = await api.get(`/cards/by-conversation/${conversationId}`)
  return res.data.cards
}

// ── Metrics ──
export async function getPipelineMetrics(pipelineId: string): Promise<PipelineMetrics> {
  const res = await api.get(`/pipelines/${pipelineId}/metrics`)
  return res.data.metrics
}
