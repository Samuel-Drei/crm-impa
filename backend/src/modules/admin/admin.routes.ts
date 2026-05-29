import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../../config/database.js'
import { authMiddleware, superAdminMiddleware } from '../../middlewares/auth.middleware.js'
import { ensureCompanyRoles, getRoleId } from '../rbac/rbac.helpers.js'
import { getAllModuleDefinitions, getModuleDefinition } from '../crm-modules/registry.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const execAsync = promisify(exec)

// Environment for exec commands - ensure PATH includes common locations
const execEnv = {
  ...process.env,
  PATH: `/root/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH || ''}`,
  NODE_ENV: process.env.NODE_ENV || 'production',
}

// Version is read from package.json — update package.json to change the version shown in the CRM
const _pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../../package.json')
const CURRENT_VERSION: string = (() => {
  try { return JSON.parse(readFileSync(_pkgPath, 'utf-8')).version }
  catch { return '0.7.3' }
})()
const GITHUB_REPO = 'theangelz/crm-impa'

export async function adminRoutes(fastify: FastifyInstance) {
  // Apply auth + super admin middleware to all routes
  fastify.addHook('onRequest', authMiddleware)
  fastify.addHook('onRequest', superAdminMiddleware)

  // ════════════════════════════════════════
  // ── EMPRESAS ──
  // ════════════════════════════════════════

  // GET /admin/companies - List with filters & pagination
  fastify.get('/companies', async (request, reply) => {
    const { search, plan, isActive, page, limit } = request.query as {
      search?: string; plan?: string; isActive?: string; page?: string; limit?: string
    }

    const where: any = {}
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (plan) where.plan = plan.toLowerCase()
    if (isActive !== undefined && isActive !== '') where.isActive = isActive === 'true'

    const pageNum = Math.max(1, parseInt(page || '1'))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50')))
    const skip = (pageNum - 1) * limitNum

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          planRef: { select: { id: true, name: true, slug: true } },
          users: {
            select: { id: true, name: true, email: true, isActive: true, createdAt: true },
          },
          _count: {
            select: { instances: true, contacts: true, campaigns: true, conversations: true, users: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.company.count({ where }),
    ])

    return reply.send({ data: companies, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) })
  })

  // GET /admin/companies/:id - Full company detail
  fastify.get('/companies/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        planRef: { select: { id: true, name: true, slug: true } },
        users: {
          select: {
            id: true, name: true, email: true, isActive: true, createdAt: true,
            rbacRole: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        instances: {
          select: {
            id: true, name: true, status: true, channel: true, phoneNumber: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            instances: true, contacts: true, campaigns: true, templates: true,
            conversations: true, users: true, aiAgents: true, aiProviders: true,
          },
        },
      },
    })

    if (!company) {
      return reply.status(404).send({ error: 'Empresa nao encontrada' })
    }

    return reply.send(company)
  })

  // GET /admin/companies/:id/roles - Get all roles for a specific company
  fastify.get('/companies/:id/roles', async (request, reply) => {
    const { id } = request.params as { id: string }
    const roles = await prisma.role.findMany({
      where: { companyId: id },
      select: { id: true, name: true, slug: true, type: true, description: true, isDefault: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
    return reply.send(roles)
  })

  // POST /admin/companies - Create company with admin user (using RBAC)
  fastify.post('/companies', async (request, reply) => {
    const schema = z.object({
      companyName: z.string().min(1),
      userName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      plan: z.string().transform(v => v.toLowerCase()).pipe(z.enum(['free', 'basic', 'pro', 'enterprise'])).default('free'),
    })

    const data = schema.parse(request.body)

    const existingUser = await prisma.user.findUnique({ where: { email: data.email } })
    if (existingUser) {
      return reply.status(400).send({ error: 'Email ja cadastrado' })
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    // Create company first - look up plan by slug to set planId
    const planRecord = await prisma.plan.findUnique({ where: { slug: data.plan } })

    const company = await prisma.company.create({
      data: {
        name: data.companyName,
        email: data.email,
        plan: data.plan,
        planId: planRecord?.id || undefined,
        isActive: true,
      },
    })

    // Ensure RBAC roles exist for the new company
    await ensureCompanyRoles(company.id)
    const adminRoleId = await getRoleId(company.id, 'admin')

    // Create admin user with proper RBAC role
    const user = await prisma.user.create({
      data: {
        name: data.userName,
        email: data.email,
        password: hashedPassword,
        companyId: company.id,
        roleId: adminRoleId,
      },
      select: { id: true, name: true, email: true },
    })

    return reply.status(201).send({ ...company, users: [user] })
  })

  // Update company
  fastify.put('/companies/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).optional(),
      plan: z.string().transform(v => v.toLowerCase()).optional(),
      isActive: z.boolean().optional(),
    })

    const data = schema.parse(request.body)

    // If plan slug is provided, also update planId
    let planId: string | undefined
    if (data.plan) {
      const planRecord = await prisma.plan.findUnique({ where: { slug: data.plan } })
      if (planRecord) planId = planRecord.id
    }

    const company = await prisma.company.update({
      where: { id },
      data: { ...data, ...(planId ? { planId } : {}) },
    })

    return reply.send(company)
  })

  // Delete company
  fastify.delete('/companies/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    // Delete all related data - need to delete in correct order
    // First get all instances to delete their messages
    const instances = await prisma.instance.findMany({
      where: { companyId: id },
      select: { id: true },
    })

    const instanceIds = instances.map((i) => i.id)

    await prisma.$transaction([
      // Delete messages for all instances
      prisma.message.deleteMany({ where: { instanceId: { in: instanceIds } } }),
      // Delete templates
      prisma.template.deleteMany({ where: { companyId: id } }),
      // Delete campaign contacts
      prisma.campaignContact.deleteMany({ where: { campaign: { companyId: id } } }),
      // Delete campaign instances
      prisma.campaignInstance.deleteMany({ where: { campaign: { companyId: id } } }),
      // Delete campaigns
      prisma.campaign.deleteMany({ where: { companyId: id } }),
      // Delete contacts
      prisma.contact.deleteMany({ where: { companyId: id } }),
      // Delete flow sessions
      prisma.flowSession.deleteMany({ where: { flow: { companyId: id } } }),
      // Delete flow edges
      prisma.flowEdge.deleteMany({ where: { flow: { companyId: id } } }),
      // Delete flow nodes
      prisma.flowNode.deleteMany({ where: { flow: { companyId: id } } }),
      // Delete flows
      prisma.flow.deleteMany({ where: { companyId: id } }),
      // Delete typebot integrations
      prisma.typebotIntegration.deleteMany({ where: { instance: { companyId: id } } }),
      // Delete n8n integrations
      prisma.n8nIntegration.deleteMany({ where: { instance: { companyId: id } } }),
      // Delete instances
      prisma.instance.deleteMany({ where: { companyId: id } }),
      // Delete users
      prisma.user.deleteMany({ where: { companyId: id } }),
      // Delete company
      prisma.company.delete({ where: { id } }),
    ])

    return reply.send({ success: true })
  })

  // ════════════════════════════════════════
  // ── USUÁRIOS ──
  // ════════════════════════════════════════

  // GET /admin/roles - Distinct role names across all companies
  fastify.get('/roles', async (_request, reply) => {
    const roles = await prisma.role.findMany({
      where: { companyId: { not: null } },
      select: { slug: true, name: true },
      distinct: ['slug'],
      orderBy: { name: 'asc' },
    })
    return reply.send(roles)
  })

  // GET /admin/users - List with filters & pagination
  fastify.get('/users', async (request, reply) => {
    const { search, companyId, isActive, role, page, limit } = request.query as {
      search?: string; companyId?: string; isActive?: string; role?: string; page?: string; limit?: string
    }

    const where: any = {}
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (companyId) where.companyId = companyId
    if (isActive !== undefined && isActive !== '') where.isActive = isActive === 'true'
    if (role) where.rbacRole = { slug: role }

    const pageNum = Math.max(1, parseInt(page || '1'))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50')))
    const skip = (pageNum - 1) * limitNum

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, isActive: true, createdAt: true,
          rbacRole: { select: { id: true, name: true, slug: true } },
          company: { select: { id: true, name: true, plan: true, isActive: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ])

    return reply.send({ data: users, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) })
  })

  // GET /admin/users/:id - User detail
  fastify.get('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, isActive: true, createdAt: true, updatedAt: true,
        rbacRole: { select: { id: true, name: true, slug: true } },
        company: { select: { id: true, name: true, plan: true, isActive: true } },
        teamMemberships: {
          select: { team: { select: { id: true, name: true } } },
        },
        _count: {
          select: { assignedConversations: true, sentMessages: true },
        },
      },
    })

    if (!user) {
      return reply.status(404).send({ error: 'Usuario nao encontrado' })
    }

    return reply.send(user)
  })

  // PUT /admin/users/:id - Update user (name, email, password, isActive, roleId or roleSlug)
  fastify.put('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      isActive: z.boolean().optional(),
      roleId: z.string().uuid().optional(),
      roleSlug: z.string().optional(),
    })

    const data = schema.parse(request.body)

    const updateData: any = { ...data }
    delete updateData.password
    delete updateData.roleSlug
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 12)
    }

    // Resolve roleSlug to roleId if provided
    if (data.roleSlug && !data.roleId) {
      const existingUser = await prisma.user.findUnique({ where: { id }, select: { companyId: true } })
      if (existingUser) {
        const role = await prisma.role.findFirst({
          where: { companyId: existingUser.companyId, slug: data.roleSlug },
        })
        if (role) updateData.roleId = role.id
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, email: true, isActive: true, createdAt: true,
        rbacRole: { select: { id: true, name: true, slug: true } },
        company: { select: { id: true, name: true } },
      },
    })

    return reply.send(user)
  })

  // Delete user
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { companyId } = request.query as { companyId?: string }

    // Validar que o user pertence a uma empresa específica (evita delete acidental cross-tenant)
    const user = await prisma.user.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
    })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    await prisma.user.delete({ where: { id } })

    return reply.send({ success: true })
  })

  // ════════════════════════════════════════
  // ── PLANOS ──
  // ════════════════════════════════════════

  // GET /admin/plans - List all plans with limits
  fastify.get('/plans', async (_request, reply) => {
    const plans = await prisma.plan.findMany({
      include: { limits: true, _count: { select: { companies: true } } },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send(plans)
  })

  // GET /admin/plans/feature-keys - List available feature keys (MUST be before :id)
  fastify.get('/plans/feature-keys', async (_request, reply) => {
    const featureKeys = [
      { key: 'maxUsers', label: 'Máximo de Usuários', description: 'Limite de usuários por empresa' },
      { key: 'maxInstances', label: 'Máximo de Instâncias', description: 'Instâncias WhatsApp' },
      { key: 'maxContacts', label: 'Máximo de Contatos', description: 'Contatos no CRM' },
      { key: 'maxCampaigns', label: 'Máximo de Campanhas', description: 'Campanhas de disparo' },
      { key: 'maxFlows', label: 'Máximo de Fluxos', description: 'Fluxos de automação' },
      { key: 'maxTeams', label: 'Máximo de Equipes', description: 'Equipes de atendimento' },
      { key: 'maxAiAgents', label: 'Máximo de Agentes IA', description: 'Agentes de IA (0 = bloqueado)' },
      { key: 'maxAiProviders', label: 'Máximo de Provedores IA', description: 'Provedores de IA (0 = bloqueado)' },
      { key: 'maxKnowledgeBases', label: 'Máximo de Bases de Conhecimento', description: 'RAG/Knowledge bases (0 = bloqueado)' },
      { key: 'maxTemplates', label: 'Máximo de Templates', description: 'Templates WhatsApp' },
      { key: 'maxAutomations', label: 'Máximo de Automações', description: 'Automações + Macros' },
      { key: 'maxLabels', label: 'Máximo de Labels', description: 'Etiquetas/labels' },
    ]
    return reply.send(featureKeys)
  })

  // GET /admin/plans/:id - Plan detail
  fastify.get('/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { limits: true, _count: { select: { companies: true } } },
    })
    if (!plan) return reply.status(404).send({ error: 'Plano não encontrado' })
    return reply.send(plan)
  })

  // POST /admin/plans - Create plan
  fastify.post('/plans', async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
      description: z.string().optional(),
      price: z.number().min(0).default(0),
      isDefault: z.boolean().default(false),
      sortOrder: z.number().default(0),
      limits: z.record(z.string(), z.number()).optional(), // { maxUsers: 10, maxInstances: 3, ... }
    })
    const data = schema.parse(request.body)

    // If setting this as default, unset other defaults
    if (data.isDefault) {
      await prisma.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }

    const plan = await prisma.plan.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        price: data.price,
        isDefault: data.isDefault,
        sortOrder: data.sortOrder,
      },
    })

    // Create limits
    if (data.limits) {
      for (const [featureKey, limitValue] of Object.entries(data.limits)) {
        await prisma.planLimit.create({
          data: { planId: plan.id, featureKey, limitValue },
        })
      }
    }

    const result = await prisma.plan.findUnique({
      where: { id: plan.id },
      include: { limits: true, _count: { select: { companies: true } } },
    })
    return reply.status(201).send(result)
  })

  // PUT /admin/plans/:id - Update plan (name, description, price, limits)
  fastify.put('/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const schema = z.object({
      name: z.string().min(1).optional(),
      slug: z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
      description: z.string().optional(),
      price: z.number().min(0).optional(),
      isDefault: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
      limits: z.record(z.string(), z.number()).optional(),
    })
    const data = schema.parse(request.body)

    // If setting this as default, unset other defaults
    if (data.isDefault) {
      await prisma.plan.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } })
    }

    const { limits, ...planData } = data
    const plan = await prisma.plan.update({
      where: { id },
      data: planData,
    })

    // Upsert limits
    if (limits) {
      for (const [featureKey, limitValue] of Object.entries(limits)) {
        await prisma.planLimit.upsert({
          where: { planId_featureKey: { planId: id, featureKey } },
          update: { limitValue },
          create: { planId: id, featureKey, limitValue },
        })
      }
    }

    const result = await prisma.plan.findUnique({
      where: { id },
      include: { limits: true, _count: { select: { companies: true } } },
    })
    return reply.send(result)
  })

  // DELETE /admin/plans/:id - Delete plan (only if no companies use it)
  fastify.delete('/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const count = await prisma.company.count({ where: { planId: id } })
    if (count > 0) {
      return reply.status(409).send({ error: `Impossível excluir: ${count} empresa(s) usam este plano` })
    }
    await prisma.plan.delete({ where: { id } })
    return reply.send({ success: true })
  })

  // PUT /admin/companies/:id/plan - Assign plan to company
  fastify.put('/companies/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { planId } = z.object({ planId: z.string().uuid() }).parse(request.body)

    const plan = await prisma.plan.findUnique({ where: { id: planId } })
    if (!plan) return reply.status(404).send({ error: 'Plano não encontrado' })

    const company = await prisma.company.update({
      where: { id },
      data: { planId, plan: plan.slug },
      select: { id: true, name: true, plan: true, planId: true },
    })
    return reply.send(company)
  })

  // ════════════════════════════════════════
  // ── CONFIGURAÇÕES DO SISTEMA ──
  // ════════════════════════════════════════

  // GET /admin/settings - Get all system settings
  fastify.get('/settings', async (_request, reply) => {
    const settings = await prisma.systemSetting.findMany()
    const map: Record<string, string> = {}
    for (const s of settings) map[s.key] = s.value
    return reply.send(map)
  })

  // PUT /admin/settings - Update system settings (batch)
  fastify.put('/settings', async (request, reply) => {
    const schema = z.record(z.string(), z.string())
    const data = schema.parse(request.body)

    const results: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      const setting = await prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
      results[setting.key] = setting.value
    }

    // Invalida caches relevantes ao mudar configuração
    if (Object.keys(data).some(k => k.startsWith('youtube.'))) {
      try {
        const { invalidateYouTubeConfigCache } = await import('../ai/rag/youtube-transcript.js')
        invalidateYouTubeConfigCache()
      } catch {}
    }

    return reply.send(results)
  })

  // ════════════════════════════════════════
  // ── DEBUG PROMPT IA ──
  // Inspeciona o prompt FINAL enviado ao provider para um agente específico.
  // Não chama o LLM, apenas retorna o que SERIA enviado (system + history + user).
  // ════════════════════════════════════════
  fastify.post('/ai/debug-prompt', async (request, reply) => {
    const bodySchema = z.object({
      agentId: z.string().uuid(),
      sampleMessage: z.string().min(1).max(12000).default('Olá'),
      remoteJid: z.string().optional(),
      instanceId: z.string().uuid().optional(),
      includeRag: z.boolean().optional().default(true),
    })
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() })
    const { agentId, sampleMessage, remoteJid, instanceId, includeRag } = parsed.data

    const agent = await prisma.aIAgent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, companyId: true, instanceIds: true, model: true, providerId: true },
    })
    if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })

    const effectiveInstanceId = instanceId
      || (Array.isArray(agent.instanceIds) && agent.instanceIds.length > 0 ? agent.instanceIds[0] : null)
      || (await prisma.instance.findFirst({ where: { companyId: agent.companyId }, select: { id: true } }))?.id
    if (!effectiveInstanceId) return reply.status(400).send({ error: 'Nenhuma instância disponível para este agente' })

    const effectiveJid = remoteJid || `5500000000000@s.whatsapp.net`

    try {
      const { buildAgent } = await import('../ai/agent-builder.js')
      const { retrieveForAgent } = await import('../ai/rag/retrieval.service.js')
      const skillsSvc = await import('../ai/skills/skills.service.js')
      const { composeSystemPrompt } = await import('../ai/prompt-layers.js')

      const built = await buildAgent(
        agentId,
        { companyId: agent.companyId, instanceId: effectiveInstanceId, remoteJid: effectiveJid },
      )

      // Carregar histórico real (se houver sessão)
      let history: Array<{ role: string; content: string }> = []
      const session = await prisma.aISession.findFirst({
        where: { agentId, instanceId: effectiveInstanceId, remoteJid: effectiveJid },
        orderBy: { lastActivity: 'desc' },
      })
      if (session) {
        const msgs = await prisma.aIMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: { role: true, content: true },
        })
        history = msgs
      }

      // RAG context (mesma config do runAgent)
      let ragInfo: { chunks: number; tokens: number; appended: string } = { chunks: 0, tokens: 0, appended: '' }
      let ragLayer = ''
      if (includeRag) {
        try {
          const ragCtx = await retrieveForAgent(agentId, agent.companyId, sampleMessage, {
            topK: 5, scoreThreshold: 0.4, maxContextTokens: 3000,
          })
          if (ragCtx.formattedContext) {
            ragLayer = ragCtx.formattedContext
            ragInfo = { chunks: ragCtx.chunks.length, tokens: ragCtx.totalTokens, appended: ragCtx.formattedContext }
          }
        } catch (e: any) {
          ragInfo.appended = `[RAG falhou: ${e?.message || e}]`
        }
      }

      // Skills semânticas (mesma busca que o runAgent faz)
      let matchedSkills: Awaited<ReturnType<typeof skillsSvc.selectActiveSkills>> = []
      let skillsLayer = ''
      try {
        const all = await skillsSvc.selectActiveSkills({
          companyId: agent.companyId,
          agentId,
          userMessage: sampleMessage,
          topK: 3,
          scoreThreshold: 0.55,
        })
        const alwaysOnIds = new Set(built.alwaysOnSkills.map(s => s.id))
        matchedSkills = all.filter(s => !s.alwaysOn && !alwaysOnIds.has(s.id))
        if (matchedSkills.length > 0) skillsLayer = skillsSvc.formatSkillsForPrompt(matchedSkills)
      } catch (e) {
        console.warn('[admin/debug-prompt] skills falhou:', (e as Error).message)
      }

      // Recompor system prompt com camadas dinâmicas
      const finalLayers = [
        ...built.promptLayers,
        { id: 'matched_skills' as const, cacheable: false, content: skillsLayer },
        { id: 'rag' as const, cacheable: false, content: ragLayer },
      ]
      const recomposed = composeSystemPrompt(finalLayers)
      const finalSystemPrompt = recomposed.text

      const finalMessages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: sampleMessage },
      ]

      const totalChars = finalMessages.reduce((s, m) => s + (m.content?.length || 0), 0)
      const estimatedTokens = Math.ceil(totalChars / 4) // aproximação 4 chars/token
      const cacheableChars = recomposed.cacheable.reduce((s, l) => s + l.content.length, 0)
      const dynamicChars = recomposed.dynamic.reduce((s, l) => s + l.content.length, 0)

      return reply.send({
        agent: { id: agent.id, name: agent.name },
        provider: { id: built.providerId, name: built.provider.name, model: built.model },
        params: {
          maxTokens: built.maxTokens,
          temperature: built.temperature,
          topP: built.topP ?? null,
          frequencyPenalty: built.frequencyPenalty ?? null,
          presencePenalty: built.presencePenalty ?? null,
        },
        tools: built.tools.map(t => ({ name: t.name, description: t.description })),
        rag: ragInfo,
        skills: {
          alwaysOn: built.alwaysOnSkills.map(s => ({
            id: s.id, name: s.name, slug: s.slug, priority: s.priority,
          })),
          matched: matchedSkills.map(s => ({
            id: s.id, name: s.name, slug: s.slug, priority: s.priority, score: s.score ?? null,
          })),
        },
        layers: finalLayers.map(l => ({
          id: l.id,
          cacheable: l.cacheable,
          chars: l.content.length,
        })),
        cacheBreakdown: {
          cacheableChars,
          dynamicChars,
          ratio: totalChars > 0 ? +(cacheableChars / (cacheableChars + dynamicChars)).toFixed(3) : 0,
        },
        systemPrompt: finalSystemPrompt,
        history,
        sampleMessage,
        finalMessages,
        stats: {
          systemPromptChars: finalSystemPrompt.length,
          historyMessages: history.length,
          totalChars,
          estimatedTokens,
        },
      })
    } catch (err: any) {
      console.error('[admin/ai/debug-prompt] error:', err)
      return reply.status(500).send({ error: err?.message || 'Erro ao montar prompt' })
    }
  })

  // GET /admin/ai/agents — lista mínima para o seletor do debug
  fastify.get('/ai/agents', async (_request, reply) => {
    const agents = await prisma.aIAgent.findMany({
      select: {
        id: true, name: true, status: true, companyId: true, model: true,
        company: { select: { name: true } },
        provider: { select: { name: true, type: true } },
      },
      orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
    })
    return reply.send(agents)
  })

  // ════════════════════════════════════════
  // ── ESTATÍSTICAS ──
  // ════════════════════════════════════════

  // GET /admin/stats - Expanded system stats
  fastify.get('/stats', async (request, reply) => {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))

    const [
      totalCompanies, activeCompanies,
      totalUsers, activeUsers,
      totalInstances, connectedInstances,
      totalMessages, todayMessages,
      totalContacts, totalConversations,
      totalAiAgents,
      recentCompanies,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { isActive: true } }),
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.instance.count(),
      prisma.instance.count({ where: { status: 'CONNECTED' } }),
      prisma.message.count(),
      prisma.message.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.contact.count(),
      prisma.conversation.count(),
      prisma.aIAgent.count(),
      prisma.company.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, plan: true, isActive: true, createdAt: true, _count: { select: { users: true, instances: true } } },
      }),
    ])

    return reply.send({
      companies: { total: totalCompanies, active: activeCompanies },
      users: { total: totalUsers, active: activeUsers },
      instances: { total: totalInstances, connected: connectedInstances },
      messages: { total: totalMessages, today: todayMessages },
      contacts: totalContacts,
      conversations: totalConversations,
      aiAgents: totalAiAgents,
      recentCompanies,
    })
  })

  // Check for updates
  fastify.get('/check-update', async (request, reply) => {
    try {
      const axios = (await import('axios')).default
      const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        timeout: 10000,
      })

      const latestVersion = response.data.tag_name.replace('v', '')
      const hasUpdate = latestVersion !== CURRENT_VERSION

      return reply.send({
        currentVersion: CURRENT_VERSION,
        latestVersion,
        hasUpdate,
        releaseUrl: response.data.html_url,
        releaseNotes: response.data.body,
        publishedAt: response.data.published_at,
      })
    } catch (error: any) {
      return reply.send({
        currentVersion: CURRENT_VERSION,
        latestVersion: CURRENT_VERSION,
        hasUpdate: false,
        error: 'Não foi possível verificar atualizações',
      })
    }
  })

  // Execute update with SSE (Server-Sent Events) for real-time progress
  // Auth is handled by authMiddleware which accepts token via query parameter for SSE connections
  fastify.get('/execute-update-stream', async (request, reply) => {
    // Set headers for SSE - include headers to prevent nginx buffering
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',  // Disable nginx buffering
    })

    const sendEvent = (step: string, status: 'running' | 'done' | 'error', message: string, details?: string) => {
      const data = JSON.stringify({ step, status, message, details })
      reply.raw.write(`data: ${data}\n\n`)
      // Force flush to ensure data is sent immediately
      if (typeof (reply.raw as any).flush === 'function') {
        (reply.raw as any).flush()
      }
    }

    // Send initial ping to establish connection
    reply.raw.write(':ping\n\n')

    try {
      // Step 1: Git fetch and reset to get latest code (force overwrite local changes)
      sendEvent('git', 'running', 'Baixando atualizacoes do repositorio...')
      try {
        await execAsync('cd /root/crm-impa && git fetch origin main', { timeout: 60000, env: execEnv })
        const { stdout: gitOutput } = await execAsync('cd /root/crm-impa && git reset --hard origin/main', { timeout: 60000, env: execEnv })
        sendEvent('git', 'done', 'Codigo atualizado com sucesso', gitOutput)
      } catch (error: any) {
        sendEvent('git', 'error', 'Erro ao baixar atualizacoes', error.message)
        reply.raw.end()
        return
      }

      // Step 2: Install backend dependencies (include dev for typescript)
      sendEvent('backend', 'running', 'Instalando dependencias do backend...')
      try {
        await execAsync('cd /root/crm-impa/backend && npm install', { timeout: 120000, env: execEnv })
        sendEvent('backend', 'done', 'Dependencias do backend instaladas')
      } catch (error: any) {
        sendEvent('backend', 'error', 'Erro ao instalar dependencias do backend', error.message)
        reply.raw.end()
        return
      }

      // Step 3: Build backend
      sendEvent('build-backend', 'running', 'Compilando backend...')
      try {
        await execAsync('cd /root/crm-impa/backend && npm run build', { timeout: 120000, env: execEnv })
        sendEvent('build-backend', 'done', 'Backend compilado com sucesso')
      } catch (error: any) {
        sendEvent('build-backend', 'error', 'Erro ao compilar backend', error.message)
        reply.raw.end()
        return
      }

      // Step 4: Install frontend dependencies
      sendEvent('frontend', 'running', 'Instalando dependencias do frontend...')
      try {
        await execAsync('cd /root/crm-impa/frontend && npm install --include=dev', { timeout: 180000, env: execEnv })
        // Send keepalive ping
        reply.raw.write(':ping\n\n')
      } catch (error: any) {
        sendEvent('frontend', 'error', 'Erro ao instalar dependencias do frontend', error.message)
        reply.raw.end()
        return
      }

      // Step 4b: Build frontend (separate to avoid timeout)
      sendEvent('frontend', 'running', 'Compilando frontend (pode demorar)...')
      try {
        await execAsync('cd /root/crm-impa/frontend && npm run build', { timeout: 600000, env: execEnv })
        sendEvent('frontend', 'done', 'Frontend compilado com sucesso')
      } catch (error: any) {
        sendEvent('frontend', 'error', 'Erro ao compilar frontend', error.message)
        reply.raw.end()
        return
      }

      // Step 5: Restart PM2 services
      // Send complete BEFORE restart because the connection will drop when backend restarts
      sendEvent('restart', 'running', 'Reiniciando servicos...')
      sendEvent('complete', 'done', 'Atualizacao concluida! Reiniciando...')
      reply.raw.end()

      // Restart after a small delay to ensure the response is sent
      setTimeout(async () => {
        try {
          await execAsync('pm2 restart all', { timeout: 30000, env: execEnv })
        } catch (error) {
          console.error('Erro ao reiniciar PM2:', error)
        }
      }, 500)
    } catch (error: any) {
      sendEvent('error', 'error', 'Erro inesperado na atualizacao', error.message)
      reply.raw.end()
    }
  })

  // Keep the old endpoint for backwards compatibility
  fastify.post('/execute-update', async (request, reply) => {
    try {
      // Step 1: Git pull
      const { stdout: gitOutput } = await execAsync('cd /root/crm-impa && git pull origin main', { timeout: 60000, env: execEnv })

      // Step 2: Install backend dependencies
      await execAsync('cd /root/crm-impa/backend && npm install', { timeout: 120000, env: execEnv })

      // Step 3: Build backend
      await execAsync('cd /root/crm-impa/backend && npm run build', { timeout: 120000, env: execEnv })

      // Step 4: Install frontend dependencies and build
      await execAsync('cd /root/crm-impa/frontend && npm install && npm run build', { timeout: 300000, env: execEnv })

      // Step 5: Restart PM2 services
      await execAsync('pm2 restart all', { timeout: 30000, env: execEnv })

      return reply.send({
        success: true,
        message: 'Sistema atualizado com sucesso! Os servicos foram reiniciados.',
        gitOutput,
      })
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: 'Erro ao atualizar sistema',
        details: error.message,
      })
    }
  })

  // Get current version
  fastify.get('/version', async (request, reply) => {
    return reply.send({
      version: CURRENT_VERSION,
      systemOperational: true,
    })
  })

  // ════════════════════════════════════════
  // ── MÓDULOS CRM ──
  // ════════════════════════════════════════

  // GET /admin/modules — Lista todos do MODULE_REGISTRY com status por empresa
  fastify.get('/modules', async (request, reply) => {
    const { companyId } = request.query as { companyId?: string }

    const allModules = getAllModuleDefinitions()

    // Se companyId fornecido, incluir status de ativação
    let activations: Record<string, any> = {}
    if (companyId) {
      const companyModules = await prisma.companyModule.findMany({
        where: { companyId },
        include: { module: true },
      })
      for (const cm of companyModules) {
        activations[cm.module.slug] = {
          isActive: cm.isActive,
          config: cm.config,
          activatedAt: cm.activatedAt,
          activatedBy: cm.activatedBy,
        }
      }
    }

    const modules = allModules.map(m => ({
      slug: m.slug,
      name: m.name,
      description: m.description,
      icon: m.icon,
      category: m.category,
      fieldsCount: m.customFields?.length || 0,
      templatesCount: m.pipelineTemplates?.length || 0,
      tabsCount: m.cardTabs?.length || 0,
      actionsCount: m.cardActions?.length || 0,
      ...(companyId ? { activation: activations[m.slug] || null } : {}),
    }))

    return reply.send({ modules })
  })

  // POST /admin/modules/:slug/activate — Ativa módulo para empresa
  fastify.post('/modules/:slug/activate', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const { companyId, config } = request.body as { companyId: string; config?: any }

    const definition = getModuleDefinition(slug)
    if (!definition) {
      return reply.status(404).send({ error: 'Módulo não encontrado no registry' })
    }

    // Garantir que o módulo existe na tabela crm_modules
    let crmModule = await prisma.crmModule.findUnique({ where: { slug } })
    if (!crmModule) {
      crmModule = await prisma.crmModule.create({
        data: {
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          icon: definition.icon,
          category: definition.category,
        },
      })
    }

    // Upsert da ativação
    const companyModule = await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId: crmModule.id } },
      update: { isActive: true, config: config || undefined, activatedBy: request.user.id || request.user.sub },
      create: {
        companyId,
        moduleId: crmModule.id,
        isActive: true,
        config: config || undefined,
        activatedBy: request.user.id || request.user.sub,
      },
    })

    return reply.send({ success: true, companyModule })
  })

  // POST /admin/modules/:slug/deactivate — Desativa módulo para empresa
  fastify.post('/modules/:slug/deactivate', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const { companyId } = request.body as { companyId: string }

    const crmModule = await prisma.crmModule.findUnique({ where: { slug } })
    if (!crmModule) {
      return reply.status(404).send({ error: 'Módulo não encontrado' })
    }

    await prisma.companyModule.updateMany({
      where: { companyId, moduleId: crmModule.id },
      data: { isActive: false },
    })

    return reply.send({ success: true })
  })

  // GET /admin/companies/:id/modules — Módulos ativos de uma empresa
  fastify.get('/companies/:id/modules', async (request, reply) => {
    const { id } = request.params as { id: string }

    const companyModules = await prisma.companyModule.findMany({
      where: { companyId: id },
      include: { module: true },
      orderBy: { activatedAt: 'desc' },
    })

    const modules = companyModules.map(cm => {
      const definition = getModuleDefinition(cm.module.slug)
      return {
        slug: cm.module.slug,
        name: cm.module.name,
        icon: cm.module.icon,
        category: cm.module.category,
        isActive: cm.isActive,
        config: cm.config,
        activatedAt: cm.activatedAt,
        activatedBy: cm.activatedBy,
        fieldsCount: definition?.customFields?.length || 0,
        templatesCount: definition?.pipelineTemplates?.length || 0,
      }
    })

    return reply.send({ modules })
  })

  // PUT /admin/companies/:id/modules/:slug/config — Configurar módulo por empresa
  fastify.put('/companies/:id/modules/:slug/config', async (request, reply) => {
    const { id, slug } = request.params as { id: string; slug: string }
    const { config } = request.body as { config: any }

    const crmModule = await prisma.crmModule.findUnique({ where: { slug } })
    if (!crmModule) {
      return reply.status(404).send({ error: 'Módulo não encontrado' })
    }

    await prisma.companyModule.updateMany({
      where: { companyId: id, moduleId: crmModule.id },
      data: { config },
    })

    return reply.send({ success: true })
  })
}
