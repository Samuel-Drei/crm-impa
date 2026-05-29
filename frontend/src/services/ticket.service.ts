import api from './api'

// ─── Types ───────────────────────────────

export type TicketStatus = 'NOVO' | 'EM_ANDAMENTO' | 'AGUARDANDO' | 'RESOLVIDO' | 'FECHADO' | 'CANCELADO'
export type TicketPriority = 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'
export type TicketCategory = 'BUG' | 'MELHORIA' | 'SUPORTE' | 'INFRAESTRUTURA' | 'FINANCEIRO' | 'COMERCIAL' | 'OUTRO'

export interface Ticket {
  id: string
  companyId: string
  code: string
  title: string
  description?: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  createdById: string
  assigneeId?: string
  teamId?: string
  conversationId?: string
  contactId?: string
  cardId?: string
  dueDate?: string
  resolvedAt?: string
  closedAt?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string; email: string }
  assignee?: { id: string; name: string; email: string }
  team?: { id: string; name: string }
  contact?: { id: string; name: string; phoneNumber: string }
  conversation?: { id: string; remoteJid: string; status: string }
  card?: { id: string; title: string }
  _count: { comments: number }
  comments?: TicketComment[]
}

export interface TicketComment {
  id: string
  ticketId: string
  authorId: string
  content: string
  isInternal: boolean
  createdAt: string
  author: { id: string; name: string }
}

// ─── API ───────────────────────────────

export const getTickets = (params?: Record<string, string>) =>
  api.get<{ tickets: Ticket[]; total: number; page: number; limit: number; pages: number }>('/tickets', { params }).then(r => r.data)

export const getTicketById = (id: string) =>
  api.get<Ticket>(`/tickets/${id}`).then(r => r.data)

export const createTicket = (data: Partial<Ticket>) =>
  api.post<Ticket>('/tickets', data).then(r => r.data)

export const updateTicket = (id: string, data: Partial<Ticket>) =>
  api.put<Ticket>(`/tickets/${id}`, data).then(r => r.data)

export const deleteTicket = (id: string) =>
  api.delete(`/tickets/${id}`).then(r => r.data)

export const addTicketComment = (ticketId: string, content: string, isInternal = false) =>
  api.post<TicketComment>(`/tickets/${ticketId}/comments`, { content, isInternal }).then(r => r.data)

export const getTicketCounts = () =>
  api.get<Record<string, number>>('/tickets/counts').then(r => r.data)
