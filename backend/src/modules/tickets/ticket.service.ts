import { prisma } from '../../config/database.js'
import { TicketStatus, TicketPriority, TicketCategory, Prisma } from '@prisma/client'

// ─── Gerar código sequencial TK-001 ─────────
async function generateTicketCode(companyId: string): Promise<string> {
  const last = await prisma.ticket.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { code: true },
  })
  const nextNum = last ? parseInt(last.code.replace('TK-', ''), 10) + 1 : 1
  return `TK-${String(nextNum).padStart(4, '0')}`
}

// ─── Incluir relações padrão ─────────
const defaultInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, phoneNumber: true } },
  conversation: { select: { id: true, remoteJid: true, status: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TicketInclude

// ─── Criar Ticket ─────────
export async function createTicket(data: {
  companyId: string
  title: string
  description?: string
  priority?: TicketPriority
  category?: TicketCategory
  createdById: string
  assigneeId?: string
  teamId?: string
  conversationId?: string
  contactId?: string
  cardId?: string
  dueDate?: Date
  tags?: string[]
}) {
  const code = await generateTicketCode(data.companyId)
  return prisma.ticket.create({
    data: { ...data, code, tags: data.tags || [] },
    include: defaultInclude,
  })
}

// ─── Listar Tickets ─────────
export async function listTickets(params: {
  companyId: string
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  assigneeId?: string
  createdById?: string
  search?: string
  page?: number
  limit?: number
}) {
  const { companyId, status, priority, category, assigneeId, createdById, search, page = 1, limit = 50 } = params
  const where: Prisma.TicketWhereInput = { companyId }
  if (status) where.status = status
  if (priority) where.priority = priority
  if (category) where.category = category
  if (assigneeId) where.assigneeId = assigneeId
  if (createdById) where.createdById = createdById
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      include: defaultInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ])
  return { tickets, total, page, limit, pages: Math.ceil(total / limit) }
}

// ─── Obter Ticket por ID ─────────
export async function getTicketById(id: string, companyId: string) {
  return prisma.ticket.findFirst({
    where: { id, companyId },
    include: {
      ...defaultInclude,
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      card: { select: { id: true, title: true } },
    },
  })
}

// ─── Atualizar Ticket ─────────
export async function updateTicket(id: string, companyId: string, data: {
  title?: string
  description?: string
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  assigneeId?: string | null
  teamId?: string | null
  dueDate?: Date | null
  tags?: string[]
}) {
  const updateData: any = { ...data }

  // Marcar datas de transição de status
  if (data.status === 'RESOLVIDO' && !updateData.resolvedAt) {
    updateData.resolvedAt = new Date()
  }
  if (data.status === 'FECHADO' && !updateData.closedAt) {
    updateData.closedAt = new Date()
  }

  return prisma.ticket.update({
    where: { id, companyId },
    data: updateData,
    include: defaultInclude,
  })
}

// ─── Adicionar Comentário ─────────
export async function addComment(ticketId: string, authorId: string, content: string, isInternal = false) {
  return prisma.ticketComment.create({
    data: { ticketId, authorId, content, isInternal },
    include: { author: { select: { id: true, name: true } } },
  })
}

// ─── Deletar Ticket ─────────
export async function deleteTicket(id: string, companyId: string) {
  return prisma.ticket.delete({ where: { id, companyId } })
}

// ─── Contadores por Status (dashboard) ─────────
export async function getTicketCountsByStatus(companyId: string) {
  const counts = await prisma.ticket.groupBy({
    by: ['status'],
    where: { companyId },
    _count: true,
  })
  const result: Record<string, number> = {}
  for (const c of counts) {
    result[c.status] = c._count
  }
  return result
}
