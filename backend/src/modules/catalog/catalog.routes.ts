import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listItemsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).optional(),
  active: z.coerce.boolean().optional(),
  featured: z.coerce.boolean().optional(),
})

const createCategorySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  position: z.number().int().optional(),
  parentId: z.string().uuid().optional(),
})

const updateCategorySchema = createCategorySchema.partial()

const createItemSchema = z.object({
  name: z.string().min(1).max(300),
  slug: z.string().min(1).max(300).optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).default('SERVICE'),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().optional(),
  longDescription: z.string().optional(),
  pitch: z.string().optional(),
  benefits: z.any().optional(),
  features: z.any().optional(),
  faq: z.any().optional(),
  useCases: z.string().optional(),
  testimonial: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().default('BRL'),
  unit: z.string().optional(),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY']).default('ONE_TIME'),
  taxRate: z.number().min(0).max(100).optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  position: z.number().int().optional(),
  customFields: z.any().optional(),
})

const updateItemSchema = createItemSchema.partial()

const createVariantSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().default('BRL'),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY']).optional(),
  description: z.string().optional(),
  attributes: z.any().optional(),
  active: z.boolean().default(true),
  position: z.number().int().optional(),
})

const createBundleSchema = z.object({
  name: z.string().min(1).max(300),
  slug: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  pitch: z.string().optional(),
  pricingType: z.enum(['FIXED', 'DISCOUNT']).default('FIXED'),
  fixedPrice: z.number().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  currency: z.string().default('BRL'),
  billingCycle: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY']).default('ONE_TIME'),
  imageUrl: z.string().optional(),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().min(0.0001).default(1),
    position: z.number().int().optional(),
  })).min(1),
})

const updateBundleSchema = createBundleSchema.partial()

// ── Helpers ──────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ── Category Routes ──────────────────────────────────────

export async function categoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar categorias
  fastify.get('/', { preHandler: [requirePermission('catalog:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const categories = await prisma.itemCategory.findMany({
        where: { companyId },
        include: {
          children: true,
          _count: { select: { items: true } },
        },
        orderBy: { position: 'asc' },
      })

      return reply.send({ categories })
    }
  )

  // Criar categoria
  fastify.post('/', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = createCategorySchema.parse(request.body)

      const slug = body.slug || slugify(body.name)

      const existing = await prisma.itemCategory.findUnique({
        where: { companyId_slug: { companyId, slug } },
      })
      if (existing) return reply.status(409).send({ error: 'Categoria com este slug já existe' })

      if (body.parentId) {
        const parent = await prisma.itemCategory.findFirst({
          where: { id: body.parentId, companyId },
        })
        if (!parent) return reply.status(404).send({ error: 'Categoria pai não encontrada' })
      }

      const category = await prisma.itemCategory.create({
        data: { ...body, slug, companyId },
      })

      return reply.status(201).send({ category })
    }
  )

  // Atualizar categoria
  fastify.put('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateCategorySchema.parse(request.body)

      const existing = await prisma.itemCategory.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Categoria não encontrada' })

      if (body.slug && body.slug !== existing.slug) {
        const dup = await prisma.itemCategory.findUnique({
          where: { companyId_slug: { companyId, slug: body.slug } },
        })
        if (dup) return reply.status(409).send({ error: 'Slug já em uso' })
      }

      const category = await prisma.itemCategory.update({
        where: { id },
        data: body,
      })

      return reply.send({ category })
    }
  )

  // Deletar categoria
  fastify.delete('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.itemCategory.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Categoria não encontrada' })

      await prisma.itemCategory.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}

// ── Item Routes ──────────────────────────────────────────

export async function catalogItemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar items
  fastify.get('/', { preHandler: [requirePermission('catalog:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listItemsQuery.parse(request.query)

      const where: any = { companyId }

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ]
      }
      if (query.categoryId) where.categoryId = query.categoryId
      if (query.type) where.type = query.type
      if (query.active !== undefined) where.active = query.active
      if (query.featured !== undefined) where.featured = query.featured

      const [items, total] = await Promise.all([
        prisma.catalogItem.findMany({
          where,
          include: {
            category: true,
            variants: { where: { active: true }, orderBy: { position: 'asc' } },
            images: { orderBy: { position: 'asc' }, take: 1 },
            _count: { select: { variants: true, priceTiers: true } },
          },
          orderBy: [{ featured: 'desc' }, { position: 'asc' }, { name: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.catalogItem.count({ where }),
      ])

      return reply.send({ items, total, page: query.page, limit: query.limit })
    }
  )

  // Obter item por ID
  fastify.get('/:id', { preHandler: [requirePermission('catalog:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const item = await prisma.catalogItem.findFirst({
        where: { id, companyId },
        include: {
          category: true,
          variants: { orderBy: { position: 'asc' } },
          images: { orderBy: { position: 'asc' } },
          priceTiers: { orderBy: { minQuantity: 'asc' } },
          bundles: { include: { bundle: true } },
        },
      })

      if (!item) return reply.status(404).send({ error: 'Item não encontrado' })
      return reply.send({ item })
    }
  )

  // Criar item
  fastify.post('/', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = createItemSchema.parse(request.body)

      const slug = body.slug || slugify(body.name)

      const existing = await prisma.catalogItem.findUnique({
        where: { companyId_slug: { companyId, slug } },
      })
      if (existing) return reply.status(409).send({ error: 'Item com este slug já existe' })

      if (body.categoryId) {
        const cat = await prisma.itemCategory.findFirst({
          where: { id: body.categoryId, companyId },
        })
        if (!cat) return reply.status(404).send({ error: 'Categoria não encontrada' })
      }

      const item = await prisma.catalogItem.create({
        data: { ...body, slug, companyId },
        include: { category: true },
      })

      return reply.status(201).send({ item })
    }
  )

  // Atualizar item
  fastify.put('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateItemSchema.parse(request.body)

      const existing = await prisma.catalogItem.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Item não encontrado' })

      if (body.slug && body.slug !== existing.slug) {
        const dup = await prisma.catalogItem.findUnique({
          where: { companyId_slug: { companyId, slug: body.slug } },
        })
        if (dup) return reply.status(409).send({ error: 'Slug já em uso' })
      }

      const item = await prisma.catalogItem.update({
        where: { id },
        data: body,
        include: { category: true, variants: true },
      })

      return reply.send({ item })
    }
  )

  // Deletar item
  fastify.delete('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.catalogItem.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Item não encontrado' })

      await prisma.catalogItem.delete({ where: { id } })
      return reply.status(204).send()
    }
  )

  // ── Variantes ──────────────────────────────────────────

  // Criar variante
  fastify.post('/:id/variants', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = createVariantSchema.parse(request.body)

      const item = await prisma.catalogItem.findFirst({ where: { id, companyId } })
      if (!item) return reply.status(404).send({ error: 'Item não encontrado' })

      const variant = await prisma.itemVariant.create({
        data: { ...body, itemId: id },
      })

      return reply.status(201).send({ variant })
    }
  )

  // Atualizar variante
  fastify.put('/:id/variants/:variantId', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), variantId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId
      const body = createVariantSchema.partial().parse(request.body)

      const item = await prisma.catalogItem.findFirst({ where: { id: params.id, companyId } })
      if (!item) return reply.status(404).send({ error: 'Item não encontrado' })

      const variant = await prisma.itemVariant.findFirst({ where: { id: params.variantId, itemId: params.id } })
      if (!variant) return reply.status(404).send({ error: 'Variante não encontrada' })

      const updated = await prisma.itemVariant.update({
        where: { id: params.variantId },
        data: body,
      })

      return reply.send({ variant: updated })
    }
  )

  // Deletar variante
  fastify.delete('/:id/variants/:variantId', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: z.string().uuid(), variantId: z.string().uuid() }).parse(request.params)
      const companyId = request.user.companyId

      const item = await prisma.catalogItem.findFirst({ where: { id: params.id, companyId } })
      if (!item) return reply.status(404).send({ error: 'Item não encontrado' })

      await prisma.itemVariant.delete({ where: { id: params.variantId } })
      return reply.status(204).send()
    }
  )
}

// ── Bundle Routes ────────────────────────────────────────

export async function bundleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar bundles
  fastify.get('/', { preHandler: [requirePermission('catalog:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const bundles = await prisma.itemBundle.findMany({
        where: { companyId },
        include: {
          items: {
            include: { item: { include: { images: { take: 1 } } } },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: [{ featured: 'desc' }, { name: 'asc' }],
      })

      return reply.send({ bundles })
    }
  )

  // Obter bundle por ID
  fastify.get('/:id', { preHandler: [requirePermission('catalog:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const bundle = await prisma.itemBundle.findFirst({
        where: { id, companyId },
        include: {
          items: {
            include: { item: { include: { variants: true, images: true } } },
            orderBy: { position: 'asc' },
          },
        },
      })

      if (!bundle) return reply.status(404).send({ error: 'Bundle não encontrado' })
      return reply.send({ bundle })
    }
  )

  // Criar bundle
  fastify.post('/', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = createBundleSchema.parse(request.body)

      const slug = body.slug || slugify(body.name)

      const existing = await prisma.itemBundle.findUnique({
        where: { companyId_slug: { companyId, slug } },
      })
      if (existing) return reply.status(409).send({ error: 'Bundle com este slug já existe' })

      const { items, ...bundleData } = body

      const bundle = await prisma.itemBundle.create({
        data: {
          ...bundleData,
          slug,
          companyId,
          items: {
            create: items.map((item, idx) => ({
              itemId: item.itemId,
              quantity: item.quantity,
              position: item.position ?? idx,
            })),
          },
        },
        include: { items: { include: { item: true } } },
      })

      return reply.status(201).send({ bundle })
    }
  )

  // Atualizar bundle
  fastify.put('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateBundleSchema.parse(request.body)

      const existing = await prisma.itemBundle.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Bundle não encontrado' })

      const { items, ...bundleData } = body

      const bundle = await prisma.$transaction(async (tx) => {
        if (items) {
          await tx.itemBundleItem.deleteMany({ where: { bundleId: id } })
          await tx.itemBundleItem.createMany({
            data: items.map((item, idx) => ({
              bundleId: id,
              itemId: item.itemId,
              quantity: item.quantity,
              position: item.position ?? idx,
            })),
          })
        }

        return tx.itemBundle.update({
          where: { id },
          data: bundleData,
          include: { items: { include: { item: true } } },
        })
      })

      return reply.send({ bundle })
    }
  )

  // Deletar bundle
  fastify.delete('/:id', { preHandler: [requirePermission('catalog:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.itemBundle.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Bundle não encontrado' })

      await prisma.itemBundle.delete({ where: { id } })
      return reply.status(204).send()
    }
  )
}
