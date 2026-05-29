import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'
import { scopedWhere } from '../../middlewares/scope.middleware.js'

const createContactSchema = z.object({
  name: z.string().min(1),
  phoneNumber: z.string().min(10),
  email: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
})

const updateContactSchema = createContactSchema.partial()

const importContactsSchema = z.object({
  contacts: z.array(z.object({
    name: z.string().min(1),
    phoneNumber: z.string().min(10),
    email: z.string().email().optional(),
    tags: z.array(z.string()).optional(),
  })),
})

export async function contactRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  /** Mascara o telefone se o usuário não tem permissão contacts:view_phone */
  function maskPhone(contact: any, permissions: string[]) {
    if (!contact || permissions.includes('contacts:view_phone')) return contact
    const masked = { ...contact }
    if (masked.phoneNumber) {
      const last4 = masked.phoneNumber.slice(-4)
      masked.phoneNumber = '•'.repeat(Math.max(masked.phoneNumber.length - 4, 0)) + last4
    }
    return masked
  }

  function maskPhoneList(contacts: any[], permissions: string[]) {
    if (permissions.includes('contacts:view_phone')) return contacts
    return contacts.map(c => maskPhone(c, permissions))
  }

  // List contacts
  fastify.get<{ Querystring: { page?: string; limit?: string; search?: string; tag?: string } }>('/', { preHandler: [requirePermission('contacts:read')] }, async (request, reply) => {
    const page = parseInt(request.query.page || '1')
    const limit = parseInt(request.query.limit || '50')
    const search = request.query.search
    const tag = request.query.tag

    const where: any = {
      companyId: request.user.companyId,
      isActive: true,
    }

    // Scope-based contact filtering: agents with OWN/TEAM scope only see
    // contacts associated with conversations they can access
    const defaultScope = (request.user as any).defaultScope || 'OWN'
    if (defaultScope !== 'COMPANY') {
      const convWhere = scopedWhere(request, 'conversations')
      const visibleContactIds = await prisma.conversation.findMany({
        where: convWhere,
        select: { contactId: true },
        distinct: ['contactId'],
      })
      where.id = { in: visibleContactIds.map(c => c.contactId) }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (tag) {
      where.tags = { has: tag }
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ])

    return reply.send({
      contacts: maskPhoneList(contacts, request.user.permissions),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  })

  // Get contact by ID
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:read')] }, async (request, reply) => {
    const { id } = request.params

    const contact = await prisma.contact.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!contact) {
      return reply.status(404).send({ error: 'Contact not found' })
    }

    return reply.send(maskPhone(contact, request.user.permissions))
  })

  // Get contact by phone number (JID) with full data including custom attribute definitions
  fastify.get<{ Params: { phoneNumber: string } }>('/by-phone/:phoneNumber', { preHandler: [requirePermission('contacts:read')] }, async (request, reply) => {
    const { phoneNumber } = request.params

    const contact = await prisma.contact.findFirst({
      where: { phoneNumber, companyId: request.user.companyId },
      include: {
        conversations: {
          select: { id: true, remoteJid: true, status: true },
          take: 5,
          orderBy: { updatedAt: 'desc' },
        },
      },
    })

    if (!contact) {
      return reply.status(404).send({ error: 'Contact not found' })
    }

    // Get custom attribute definitions for CONTACT model
    const customAttributeDefinitions = await prisma.customAttributeDefinition.findMany({
      where: { companyId: request.user.companyId, attributeModel: 'CONTACT' },
      orderBy: { attributeDisplayName: 'asc' },
    })

    return reply.send({ contact: maskPhone(contact, request.user.permissions), customAttributeDefinitions })
  })

  // Create contact
  fastify.post('/', { preHandler: [requirePermission('contacts:write'), enforcePlanLimit('maxContacts')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createContactSchema.parse(request.body)

    const existingContact = await prisma.contact.findFirst({
      where: {
        companyId: request.user.companyId,
        phoneNumber: data.phoneNumber,
      },
    })

    if (existingContact) {
      return reply.status(409).send({ error: 'Contact with this phone number already exists' })
    }

    const contact = await prisma.contact.create({
      data: {
        ...data,
        companyId: request.user.companyId,
        tags: data.tags || [],
      },
    })

    return reply.status(201).send(contact)
  })

  // Update contact (phoneNumber is NOT editable)
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:write')] }, async (request, reply) => {
    const { id } = request.params
    const data = updateContactSchema.parse(request.body)

    // Never allow phoneNumber to be updated
    delete (data as any).phoneNumber

    const contact = await prisma.contact.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!contact) {
      return reply.status(404).send({ error: 'Contact not found' })
    }

    const updated = await prisma.contact.update({
      where: { id },
      data,
    })

    return reply.send(updated)
  })

  // Delete contact
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('contacts:delete')] }, async (request, reply) => {
    const { id } = request.params

    const contact = await prisma.contact.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!contact) {
      return reply.status(404).send({ error: 'Contact not found' })
    }

    await prisma.contact.update({
      where: { id },
      data: { isActive: false },
    })

    return reply.status(204).send()
  })

  // Import contacts (CSV format)
  fastify.post('/import', { preHandler: [requirePermission('contacts:import')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = importContactsSchema.parse(request.body)

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    }

    for (const contactData of data.contacts) {
      try {
        const existingContact = await prisma.contact.findFirst({
          where: {
            companyId: request.user.companyId,
            phoneNumber: contactData.phoneNumber,
          },
        })

        if (existingContact) {
          results.skipped++
          continue
        }

        await prisma.contact.create({
          data: {
            ...contactData,
            companyId: request.user.companyId,
            tags: contactData.tags || [],
          },
        })

        results.imported++
      } catch (error: any) {
        results.errors.push(`${contactData.phoneNumber}: ${error.message}`)
      }
    }

    return reply.send(results)
  })

  // Get all tags
  fastify.get('/tags/all', { preHandler: [requirePermission('contacts:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const contacts = await prisma.contact.findMany({
      where: { companyId: request.user.companyId, isActive: true },
      select: { tags: true },
    })

    const allTags = new Set<string>()
    contacts.forEach((c) => c.tags.forEach((t) => allTags.add(t)))

    return reply.send(Array.from(allTags).sort())
  })

  // Listar organizações
  fastify.get<{ Querystring: { limit?: string } }>('/organizations', { preHandler: [requirePermission('contacts:read')] },
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit) || 100, 500)
      const organizations = await prisma.organization.findMany({
        where: { companyId: request.user.companyId },
        orderBy: { name: 'asc' },
        take: limit,
      })
      return reply.send({ organizations })
    }
  )
}
