import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import {
  createTicket, listTickets, getTicketById,
  updateTicket, addComment, deleteTicket, getTicketCountsByStatus,
} from './ticket.service.js'
import { TicketStatus, TicketPriority, TicketCategory } from '@prisma/client'

const ticketCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  category: z.nativeEnum(TicketCategory).optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
})

const ticketUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  category: z.nativeEnum(TicketCategory).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
})

const commentSchema = z.object({
  content: z.string().min(1).max(5000),
  isInternal: z.boolean().optional(),
})

export async function ticketRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── Contadores (dashboard) ──
  fastify.get('/counts', { preHandler: [requirePermission('tickets:read')] }, async (request, reply) => {
    const counts = await getTicketCountsByStatus(request.user.companyId)
    return reply.send(counts)
  })

  // ── Listar Tickets ──
  fastify.get<{ Querystring: { page?: string; limit?: string; status?: string; priority?: string; category?: string; assigneeId?: string; search?: string } }>(
    '/', { preHandler: [requirePermission('tickets:read')] },
    async (request, reply) => {
      const result = await listTickets({
        companyId: request.user.companyId,
        status: request.query.status as TicketStatus | undefined,
        priority: request.query.priority as TicketPriority | undefined,
        category: request.query.category as TicketCategory | undefined,
        assigneeId: request.query.assigneeId,
        search: request.query.search,
        page: parseInt(request.query.page || '1'),
        limit: parseInt(request.query.limit || '50'),
      })
      return reply.send(result)
    }
  )

  // ── Obter Ticket ──
  fastify.get<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('tickets:read')] },
    async (request, reply) => {
      const ticket = await getTicketById(request.params.id, request.user.companyId)
      if (!ticket) return reply.status(404).send({ error: 'Ticket não encontrado' })
      return reply.send(ticket)
    }
  )

  // ── Criar Ticket ──
  fastify.post('/', { preHandler: [requirePermission('tickets:create')] }, async (request, reply) => {
    const body = ticketCreateSchema.parse(request.body)
    const ticket = await createTicket({
      ...body,
      companyId: request.user.companyId,
      createdById: request.user.sub,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    })
    return reply.status(201).send(ticket)
  })

  // ── Atualizar Ticket ──
  fastify.put<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('tickets:update')] },
    async (request, reply) => {
      const body = ticketUpdateSchema.parse(request.body)
      const ticket = await updateTicket(request.params.id, request.user.companyId, {
        ...body,
        dueDate: body.dueDate === null ? null : body.dueDate ? new Date(body.dueDate) : undefined,
      })
      return reply.send(ticket)
    }
  )

  // ── Deletar Ticket ──
  fastify.delete<{ Params: { id: string } }>(
    '/:id', { preHandler: [requirePermission('tickets:delete')] },
    async (request, reply) => {
      await deleteTicket(request.params.id, request.user.companyId)
      return reply.send({ success: true })
    }
  )

  // ── Adicionar Comentário ──
  fastify.post<{ Params: { id: string } }>(
    '/:id/comments', { preHandler: [requirePermission('tickets:update')] },
    async (request, reply) => {
      const body = commentSchema.parse(request.body)
      const comment = await addComment(request.params.id, request.user.sub, body.content, body.isInternal)
      return reply.status(201).send(comment)
    }
  )
}
