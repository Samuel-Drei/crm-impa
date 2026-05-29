import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { Server } from 'socket.io'
// @ts-ignore
import jwtLib from 'jsonwebtoken'
import path from 'path'
import { fileURLToPath } from 'url'

// Polyfill: serializar BigInt como string em JSON.stringify (Prisma retorna BigInt em colunas como totalTokensUsed)
;(BigInt.prototype as any).toJSON = function () { return this.toString() }

import { env } from './config/env.js'
import { prisma } from './config/database.js'
import { redis } from './config/redis.js'
import { tenantStorage } from './core/tenant-context.js'
import { instanceRoom, pipelineRoom, companyRoom } from './config/socket-rooms.js'

import { authRoutes } from './modules/auth/auth.routes.js'
import { userRoutes } from './modules/users/user.routes.js'
import { companyRoutes } from './modules/companies/company.routes.js'
import { instanceRoutes } from './modules/instances/instance.routes.js'
import { messageRoutes } from './modules/messages/message.routes.js'
import { contactRoutes } from './modules/contacts/contact.routes.js'
import { templateRoutes } from './modules/templates/template.routes.js'
import { campaignRoutes } from './modules/campaigns/campaign.routes.js'
import { scheduleRoutes } from './modules/schedules/schedule.routes.js'
import { webhookRoutes } from './modules/webhooks/webhook.routes.js'
import { typebotRoutes } from './modules/typebot/typebot.routes.js'
import { n8nRoutes } from './modules/n8n/n8n.routes.js'
import { flowRoutes } from './modules/flows/flow.routes.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { webhookEntradaRoutes } from './modules/webhook-entrada/webhook-entrada.routes.js'
import { automationRoutes } from './modules/automations/automation.routes.js'
import { windowSubscriberRoutes } from './modules/window-subscribers/window-subscriber.routes.js'
import { conversationRoutes } from './modules/conversations/conversation.routes.js'
import { installationRoutes } from './modules/installation/installation.routes.js'
import { teamRoutes } from './modules/teams/team.routes.js'
import { labelRoutes } from './modules/labels/label.routes.js'
import { customAttributeRoutes } from './modules/custom-attributes/custom-attribute.routes.js'
import { cannedResponseRoutes } from './modules/canned-responses/canned-response.routes.js'
import { customFilterRoutes } from './modules/custom-filters/custom-filter.routes.js'
import { conversationAutomationRoutes } from './modules/conversation-automations/conversation-automation.routes.js'
import { macroRoutes } from './modules/macros/macro.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { fleetRoutes } from './modules/fleet/fleet.routes.js'
import { aiSkillsRoutes } from './modules/ai/skills/skills.routes.js'
import { brainRoutes } from './modules/ai/brain/brain.routes.js'
import { dailyBrainRoutes } from './modules/ai/brain/daily-brain.routes.js'
import { roleRoutes } from './modules/rbac/role.routes.js'
import { pipelineRoutes } from './modules/pipelines/pipeline.routes.js'
import { pipelineCardRoutes, cardRoutes } from './modules/pipelines/card.routes.js'
import { moduleRoutes } from './modules/crm-modules/module.routes.js'
import { sharedLinksRoutes, sharedLinksPublicRoutes } from './modules/shared-links/shared-links.routes.js'
import { categoryRoutes, catalogItemRoutes, bundleRoutes } from './modules/catalog/catalog.routes.js'
import { proposalRoutes } from './modules/proposals/proposal.routes.js'
import { invoiceRoutes } from './modules/invoices/invoice.routes.js'
import { paymentRoutes, gatewayConfigRoutes, asaasRoutes, paymentWebhookRoutes } from './modules/payments/payment.routes.js'
import { contractRoutes } from './modules/contracts/contract.routes.js'
import { projectRoutes, taskRoutes } from './modules/projects/project.routes.js'
import { expenseCategoryRoutes, expenseRoutes } from './modules/expenses/expense.routes.js'
import { customerAccountRoutes } from './modules/customers/customer.routes.js'
import { creditNoteRoutes } from './modules/credit-notes/credit-note.routes.js'
import { leadRoutes } from './modules/leads/lead.routes.js'
import { reportRoutes } from './modules/reports/report.routes.js'
import { channelSettingsRoutes } from './modules/channel-settings/channel-settings.routes.js'
import { ticketRoutes } from './modules/tickets/ticket.routes.js'
import { goalRoutes } from './modules/goals/goal.routes.js'
import { integrationsRoutes } from './modules/integrations/integration.routes.js'
import { BaileysManager } from './providers/baileys/baileys.manager.js'
import { ensureDefaultPlans } from './modules/plans/plan.helpers.js'
import { startWindowNotifierJob } from './jobs/window-notifier.job.js'
import { startFlowTimeoutJob } from './jobs/flow-timeout.job.js'
import { startAIFollowUpJob } from './jobs/ai-followup.job.js'
import { startSchedulingJob } from './jobs/scheduling.job.js'
import { startFleetSchedulerJob } from './jobs/fleet-scheduler.job.js'
import { startRecurringJob } from './jobs/recurring.job.js'
import { startAIHeartbeatJob } from './jobs/ai-heartbeat.job.js'
import { startIngestionWorker } from './queues/ingestion.queue.js'
import { startDailyBrainWorker } from './queues/daily-brain.queue.js'
import { startDailyBrainCron } from './jobs/daily-brain.job.js'
import { startConversationMaintenanceJob } from './jobs/conversation-maintenance.job.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  bodyLimit: 100 * 1024 * 1024, // 100MB para suportar vídeos em base64 via webhook
})

export let io: Server
export let baileysManager: BaileysManager

async function bootstrap() {
  // Pre-warm Prisma connection pool to avoid cold start on first request
  await prisma.$connect()

  await fastify.register(cors, {
    origin: [
      env.FRONTEND_URL,
      'http://localhost:5454',
      'http://localhost:5455',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-token'],
  })

  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  })

  await fastify.register(cookie)

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // CSP handled per-route for uploads
    crossOriginEmbedderPolicy: false, // Allow embedding media
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin media loading
  })

  // Initialize tenant context for each request (AsyncLocalStorage)
  fastify.addHook('onRequest', async (request, reply) => {
    tenantStorage.enterWith({ companyId: null, bypass: false })
  })

  // CSRF defense in depth: validate Origin header on state-changing requests
  const allowedOrigins = new Set([
    env.FRONTEND_URL,
    'http://localhost:5454',
    'http://localhost:5455',
  ].map(o => o.replace(/\/$/, '')))

  fastify.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
    if (!request.url.startsWith('/api/')) return
    // Skip webhook endpoints (external callers)
    if (request.url.startsWith('/api/webhook') || request.url.startsWith('/api/payments/webhook')) return

    const origin = request.headers.origin
    const referer = request.headers.referer
    // If no Origin/Referer (e.g. server-to-server with API token), allow
    if (!origin && !referer) return

    const requestOrigin = origin || (referer ? new URL(referer).origin : null)
    if (requestOrigin && !allowedOrigins.has(requestOrigin.replace(/\/$/, ''))) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
  })

  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  })

  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  })

  // Auth check for /uploads/ — require JWT via Authorization header, cookie, or ?token= query (SEC-03 fix)
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/uploads/')) return

    let decoded: any = null

    // Try Authorization header first
    const auth = request.headers.authorization
    if (auth) {
      try {
        await request.jwtVerify()
        decoded = request.user
      } catch { /* fall through */ }
    }

    // Try httpOnly cookie
    if (!decoded) {
      const cookieToken = (request.cookies as any)?.token
      if (cookieToken) {
        try {
          decoded = request.server.jwt.verify(cookieToken)
        } catch { /* fall through */ }
      }
    }

    // Fallback: ?token= query param (needed for <img>, <video>, <audio> tags)
    if (!decoded) {
      const queryToken = (request.query as any)?.token
      if (queryToken) {
        try {
          decoded = request.server.jwt.verify(queryToken)
        } catch { /* fall through */ }
      }
    }

    if (!decoded) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Tenant isolation: validate companyId in URL path matches JWT
    const urlPath = request.url.split('?')[0]
    const pathParts = urlPath.split('/').filter(Boolean) // ['uploads', '{companyId}', ...]
    if (pathParts.length >= 2) {
      const pathCompanyId = pathParts[1]
      // Allow access only if companyId matches or user is superAdmin
      if (pathCompanyId !== 'avatars' && decoded.companyId && decoded.companyId !== pathCompanyId && !decoded.isSuperAdmin) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }
  })

  // Security headers for uploaded files — prevent XSS, clickjacking, MIME sniffing
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/uploads/')) {
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'DENY')
      reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      reply.header('Cache-Control', 'private, no-cache')
      // Block dangerous file types from being rendered inline
      const ext = path.extname(request.url.split('?')[0]).toLowerCase()
      const dangerous = ['.html','.htm','.svg','.js','.php','.exe','.bat','.sh','.ps1','.xhtml','.shtml']
      if (dangerous.includes(ext)) {
        reply.header('Content-Disposition', 'attachment')
        reply.header('Content-Type', 'application/octet-stream')
      }
    }
    return payload
  })

  // Serve docs static files
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public', 'docs'),
    prefix: '/docs/',
    decorateReply: false,
  })

  // Serve AI Workspace public files (landing pages, assets criados pela IA)
  // Cada empresa fica em /app/ai-workspace/<companyId>/. Servido sem auth porque
  // o objetivo é que landing pages sejam acessíveis publicamente. Apenas extensões
  // web seguras são permitidas (a tool ai-workspace bloqueia upload de .sh/.exe).
  const aiWorkspaceRoot = process.env.AI_WORKSPACE_ROOT || '/app/ai-workspace'
  try {
    const fsSync = await import('fs')
    if (!fsSync.existsSync(aiWorkspaceRoot)) {
      fsSync.mkdirSync(aiWorkspaceRoot, { recursive: true })
    }
    await fastify.register(fastifyStatic, {
      root: aiWorkspaceRoot,
      prefix: '/ai-workspace/',
      decorateReply: false,
      index: ['index.html'],
    })
    fastify.log.info(`[AI Workspace] Serving from ${aiWorkspaceRoot}`)
  } catch (e) {
    fastify.log.warn(`[AI Workspace] Could not register static route: ${(e as Error).message}`)
  }

  // Serve frontend static files
  const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist')
  await fastify.register(fastifyStatic, {
    root: frontendPath,
    prefix: '/',
    decorateReply: false,
  })

  // SPA fallback - serve index.html for non-API routes
  fastify.setNotFoundHandler(async (request, reply) => {
    // If it's an API request, return 404
    if (request.url.startsWith('/api/') || request.url.startsWith('/uploads/') || request.url.startsWith('/ai-workspace/')) {
      return reply.code(404).send({ error: 'Not found' })
    }
    // Otherwise serve the SPA
    const fs = await import('fs/promises')
    const indexPath = path.join(frontendPath, 'index.html')
    const html = await fs.readFile(indexPath, 'utf-8')
    return reply.type('text/html').send(html)
  })

  // Global error handler - catch Zod validation errors and unhandled exceptions
  fastify.setErrorHandler(async (error, request, reply) => {
    if (error.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos', details: (error as any).issues })
    }
    request.log.error(error)
    return reply.status(error.statusCode || 500).send({ error: 'Erro interno do servidor' })
  })

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // API Routes
  await fastify.register(installationRoutes, { prefix: '/api/installation' })
  await fastify.register(authRoutes, { prefix: '/api/auth' })
  await fastify.register(userRoutes, { prefix: '/api/users' })
  await fastify.register(companyRoutes, { prefix: '/api/companies' })
  await fastify.register(instanceRoutes, { prefix: '/api/instances' })
  await fastify.register(messageRoutes, { prefix: '/api/messages' })
  await fastify.register(contactRoutes, { prefix: '/api/contacts' })
  await fastify.register(templateRoutes, { prefix: '/api/templates' })
  await fastify.register(campaignRoutes, { prefix: '/api/campaigns' })
  await fastify.register(webhookRoutes, { prefix: '/api/webhook' })
  await fastify.register(typebotRoutes, { prefix: '/api/typebot' })
  await fastify.register(n8nRoutes, { prefix: '/api/n8n' })
  await fastify.register(flowRoutes, { prefix: '/api/flows' })
  await fastify.register(adminRoutes, { prefix: '/api/admin' })
  await fastify.register(webhookEntradaRoutes, { prefix: '/api/webhook-entrada' })
  await fastify.register(automationRoutes, { prefix: '/api/automations' })
  await fastify.register(windowSubscriberRoutes, { prefix: '/api/window-subscribers' })
  await fastify.register(conversationRoutes, { prefix: '/api/conversations' })
  await fastify.register(teamRoutes, { prefix: '/api/teams' })
  await fastify.register(labelRoutes, { prefix: '/api/labels' })
  await fastify.register(customAttributeRoutes, { prefix: '/api/custom-attributes' })
  await fastify.register(cannedResponseRoutes, { prefix: '/api/canned-responses' })
  await fastify.register(customFilterRoutes, { prefix: '/api/custom-filters' })
  await fastify.register(conversationAutomationRoutes, { prefix: '/api/conversation-automations' })
  await fastify.register(macroRoutes, { prefix: '/api/macros' })
  await fastify.register(aiRoutes, { prefix: '/api/ai' })
  await fastify.register(aiSkillsRoutes, { prefix: '/api/ai' })
  await fastify.register(fleetRoutes, { prefix: '/api/fleet' })
  await fastify.register(brainRoutes, { prefix: '/api/ai/brain' })
  await fastify.register(dailyBrainRoutes, { prefix: '/api/ai/daily-brain' })
  await fastify.register(integrationsRoutes, { prefix: '/api/integrations' })
  await fastify.register(roleRoutes, { prefix: '/api/roles' })
  await fastify.register(pipelineRoutes, { prefix: '/api/pipelines' })
  await fastify.register(pipelineCardRoutes, { prefix: '/api/pipelines' })
  await fastify.register(cardRoutes, { prefix: '/api/cards' })
  await fastify.register(moduleRoutes, { prefix: '/api/modules' })
  await fastify.register(scheduleRoutes, { prefix: '/api/schedules' })
  await fastify.register(sharedLinksRoutes, { prefix: '/api/instances' })
  await fastify.register(channelSettingsRoutes, { prefix: '/api/channel-settings' })
  await fastify.register(sharedLinksPublicRoutes, { prefix: '/api/shared' })  // Público, sem auth

  // ── CRM Comercial / Financeiro ───────────────────────
  await fastify.register(categoryRoutes, { prefix: '/api/catalog/categories' })
  await fastify.register(catalogItemRoutes, { prefix: '/api/catalog/items' })
  await fastify.register(bundleRoutes, { prefix: '/api/catalog/bundles' })
  await fastify.register(proposalRoutes, { prefix: '/api/proposals' })
  await fastify.register(invoiceRoutes, { prefix: '/api/invoices' })
  await fastify.register(paymentRoutes, { prefix: '/api/payments' })
  await fastify.register(gatewayConfigRoutes, { prefix: '/api/payment-gateways' })
  await fastify.register(asaasRoutes, { prefix: '/api/asaas' })
  await fastify.register(paymentWebhookRoutes, { prefix: '/api/payments/webhook' })  // Público, sem auth
  await fastify.register(contractRoutes, { prefix: '/api/contracts' })
  await fastify.register(projectRoutes, { prefix: '/api/projects' })
  await fastify.register(taskRoutes, { prefix: '/api/tasks' })
  await fastify.register(expenseCategoryRoutes, { prefix: '/api/expense-categories' })
  await fastify.register(expenseRoutes, { prefix: '/api/expenses' })
  await fastify.register(customerAccountRoutes, { prefix: '/api/customers' })
  await fastify.register(creditNoteRoutes, { prefix: '/api/credit-notes' })
  await fastify.register(leadRoutes, { prefix: '/api/leads' })
  await fastify.register(reportRoutes, { prefix: '/api/reports' })

  // ── Tickets & Goals ───────────────────────
  await fastify.register(ticketRoutes, { prefix: '/api/tickets' })
  await fastify.register(goalRoutes, { prefix: '/api/goals' })

  // Start Fastify server
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })

  // Ensure default plans exist and link unlinked companies
  await ensureDefaultPlans()

  // Initialize Socket.IO after server is ready
  io = new Server(fastify.server, {
    cors: {
      origin: [
        env.FRONTEND_URL,
        'http://localhost:5454',
        'http://localhost:5455',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // Socket.IO authentication middleware (SEC-02 fix)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers?.cookie?.match(/(?:^|;\s*)token=([^;]*)/)?.[1]
    if (!token) {
      return next(new Error('Authentication required'))
    }
    try {
      const decoded = jwtLib.verify(token, env.JWT_SECRET) as any
      socket.data.user = {
        id: decoded.sub,
        companyId: decoded.companyId,
        role: decoded.role,
      }
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  // Socket.IO events
  io.on('connection', (socket) => {
    const user = socket.data.user

    socket.on('join-instance', async (instanceId: string) => {
      try {
        const instance = await prisma.instance.findFirst({
          where: { id: instanceId, companyId: user.companyId },
          select: { id: true },
        })
        if (!instance) {
          socket.emit('error', { message: 'Instance not found or forbidden' })
          return
        }
        socket.join(instanceRoom(user.companyId, instanceId))
      } catch {
        socket.emit('error', { message: 'Failed to join instance' })
      }
    })

    socket.on('leave-instance', (instanceId: string) => {
      socket.leave(instanceRoom(user.companyId, instanceId))
    })

    socket.on('join-pipeline', async (pipelineId: string) => {
      try {
        const pipeline = await prisma.pipeline.findFirst({
          where: { id: pipelineId, companyId: user.companyId },
          select: { id: true },
        })
        if (!pipeline) {
          socket.emit('error', { message: 'Pipeline not found or forbidden' })
          return
        }
        socket.join(pipelineRoom(user.companyId, pipelineId))
      } catch {
        socket.emit('error', { message: 'Failed to join pipeline' })
      }
    })

    socket.on('leave-pipeline', (pipelineId: string) => {
      socket.leave(pipelineRoom(user.companyId, pipelineId))
    })

    socket.on('disconnect', () => {
      // cleanup handled by Socket.IO automatically
    })
  })

  // Initialize BaileysManager
  baileysManager = new BaileysManager(io)

  // Initialize connected instances
  const connectedInstances = await prisma.instance.findMany({
    where: {
      status: 'CONNECTED',
      channel: 'BAILEYS',
      isActive: true,
    },
  })

  for (const instance of connectedInstances) {
    try {
      await baileysManager.initInstance(instance.id)
    } catch (error) {
      console.error(`Failed to restore instance ${instance.id}:`, error)
    }
  }

  console.log(`Server running on http://0.0.0.0:${env.PORT}`)

  // Start window notifier job (for 24h window management)
  startWindowNotifierJob()

  // Start flow timeout job (closes inactive flow sessions)
  startFlowTimeoutJob()

  // Start AI follow-up job (reengages clients who stopped responding)
  startAIFollowUpJob()

  // Start knowledge base ingestion queue worker (Bull)
  startIngestionWorker()

  // Start scheduling job (checks for due scheduled messages every 30s)
  startSchedulingJob()
  startFleetSchedulerJob()

  // Start recurring job (processes recurring invoices/expenses every 60 min)
  startRecurringJob()

  // Start AI heartbeat job (monitors AI provider health every 5 min)
  startAIHeartbeatJob()

  // Start Daily Brain Digest worker + cron (vetoriza histórico do dia anterior à noite)
  startDailyBrainWorker()
  startDailyBrainCron()

  // Start conversation maintenance (unsnooze, auto-assign round-robin)
  startConversationMaintenanceJob()

  // Auto-seed AI agent templates (idempotente — atualiza se já existir)
  try {
    const { seedTemplates } = await import('./modules/ai/template.service.js')
    const result = await seedTemplates()
    console.log(`[Templates] Auto-seed: ${result.created} created, ${result.updated} updated`)
  } catch (err: any) {
    console.error('[Templates] Auto-seed falhou:', err?.message || err)
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
