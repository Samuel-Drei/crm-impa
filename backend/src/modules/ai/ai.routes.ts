import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AIProviderType, AIAgentType, AIAgentStatus, AITriggerType, AISessionStatus, AIAgentPromptField, AIPromptPatchOperation } from '@prisma/client'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'
import { prisma } from '../../config/database.js'
import { io } from '../../server.js'
import { auditLog } from '../../core/audit.service.js'
import { logConversationEvent, getConversationId } from '../conversations/conversation-events.service.js'
import * as aiService from './ai.service.js'
import * as promptEditorService from './prompt-editor/service.js'
import * as promptCoachService from './prompt-coach/service.js'
import { runAgent } from './agent-builder.js'
import * as oauthService from './oauth.service.js'
import { encrypt, type EncryptionContext } from '../../config/encryption.js'
import { redis } from '../../config/redis.js'
import * as templateService from './template.service.js'
import * as memoryService from './memory.service.js'
import { getProviderMetrics, cleanOldMetrics } from './smart-router.js'

// ============================================
// OAuth Rate Limiting (Redis-based sliding window)
// ============================================
async function oauthRateLimit(maxAttempts: number, windowSec: number) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const userId = request.user?.id || 'anon'
    const key = `rate_limit:oauth:${request.url}:${ip}:${userId}`
    try {
      const current = await redis.incr(key)
      if (current === 1) {
        await redis.expire(key, windowSec)
      }
      if (current > maxAttempts) {
        const ttl = await redis.ttl(key)
        reply.header('Retry-After', String(ttl > 0 ? ttl : windowSec))
        return reply.status(429).send({ error: 'Muitas tentativas OAuth. Tente novamente mais tarde.' })
      }
    } catch {
      return reply.status(503).send({ error: 'Serviço temporariamente indisponível' })
    }
  }
}

// ============================================
// Schemas de validação
// ============================================

const providerCreateSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(AIProviderType),
  authType: z.enum(['apikey', 'oauth', 'import_token']).optional().default('apikey'),
  apiKey: z.string().optional(), // Opcional para OAuth providers
  model: z.string().min(1),
  enabledModels: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.coerce.number().int().min(1).max(128000).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).nullable().optional(),
  frequencyPenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
  presencePenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
  isDefault: z.boolean().optional(),
  // OAuth fields
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().optional(),
  oauthData: z.any().optional(),
})

const providerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.nativeEnum(AIProviderType).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  enabledModels: z.array(z.string()).optional(),
  baseUrl: z.string().nullable().optional(),
  maxTokens: z.coerce.number().int().min(1).max(128000).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).nullable().optional(),
  frequencyPenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
  presencePenalty: z.coerce.number().min(-2).max(2).nullable().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  // OAuth re-authentication fields (used when reconnecting GitHub Copilot / Antigravity)
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().optional(),
  oauthData: z.any().optional(),
})

const agentCreateSchema = z.object({
  providerId: z.string().uuid(),
  model: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.nativeEnum(AIAgentType).optional(),
  systemPrompt: z.string().min(1),
  welcomeMessage: z.string().optional(),
  triggerType: z.nativeEnum(AITriggerType).optional(),
  triggerOperator: z.enum(['CONTAINS', 'EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX']).optional(),
  triggerValue: z.string().optional(),
  keywordFinish: z.string().optional(),
  unknownMessage: z.string().optional(),
  delayMessage: z.coerce.number().int().min(0).optional(),
  splitMessages: z.boolean().optional(),
  timePerChar: z.coerce.number().int().min(0).optional(),
  maxMessageLength: z.coerce.number().int().min(100).optional(),
  sessionTimeout: z.coerce.number().int().min(1).optional(),
  keepOpen: z.boolean().optional(),
  listeningFromMe: z.boolean().optional(),
  stopBotFromMe: z.boolean().optional(),
  debounceTime: z.coerce.number().int().min(0).optional(),
  ignoreGroups: z.boolean().optional(),
  ignoreJids: z.array(z.string()).optional(),
  allowJids: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
  useCrmContext: z.boolean().optional(),
  useContactInfo: z.boolean().optional(),
  useConversationHistory: z.boolean().optional(),
  contextMessagesLimit: z.coerce.number().int().min(0).max(50).optional(),
  sessionMessagesLimit: z.coerce.number().int().min(1).max(200).optional(),
  instanceIds: z.array(z.string().uuid()).optional(),
  mcpServerIds: z.array(z.string().uuid()).optional(),
  httpTools: z.any().optional(),
  settings: z.any().optional(),
  crmToolsConfig: z.any().optional(),
  // Smart Routing
  useSmartRouting: z.boolean().optional(),
  routingStrategy: z.enum(['BEST_PERFORMANCE', 'ROUND_ROBIN', 'COST_OPTIMIZED']).optional(),
  routingProviderIds: z.array(z.string().uuid()).optional(),
  // Follow-up
  followUpEnabled: z.boolean().optional(),
  followUpSteps: z.any().optional(),
  followUpDelay: z.coerce.number().int().min(1).optional(),
  followUpMaxAttempts: z.coerce.number().int().min(1).optional(),
  followUpInterval: z.coerce.number().int().min(1).optional(),
  followUpMode: z.enum(['AI_GENERATED', 'FIXED_MESSAGES']).optional(),
  followUpPrompt: z.string().optional(),
  followUpMessages: z.any().optional(),
  followUpCloseOnMax: z.boolean().optional(),
  followUpCloseMessage: z.string().optional(),
  // Ação após último step de follow-up
  followUpEndAction: z.enum(['CLOSE', 'PAUSE', 'NONE']).optional(),
  followUpEndDelayMinutes: z.coerce.number().int().min(0).optional(),
  // Auto-retomar sessão pausada
  pauseAutoResumeEnabled: z.boolean().optional(),
  pauseAutoResumeMinutes: z.coerce.number().int().min(1).optional(),
  pauseAutoResumeTrigger: z.enum(['PAUSED_AT', 'LAST_CONTACT_MSG', 'LAST_ATTENDANT_MSG']).optional(),
  // Agendamento (quando o agente pode responder)
  scheduleMode: z.enum(['ALWAYS', 'BUSINESS_HOURS', 'OUT_OF_BUSINESS_HOURS', 'CUSTOM']).optional(),
  scheduleTimezone: z.string().optional(),
  scheduleSlots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        openHour: z.number().int().min(0).max(23),
        openMinutes: z.number().int().min(0).max(59),
        closeHour: z.number().int().min(0).max(23),
        closeMinutes: z.number().int().min(0).max(59),
      }),
    )
    .optional(),
  scheduleOffMessage: z.string().optional().nullable(),
  // Integrações (voz, STT, calendário)
  voiceConfig: z.any().optional().nullable(),
  sttConfig: z.any().optional().nullable(),
  calendarConfig: z.any().optional().nullable(),
  // State Tracker (Camada 2 — Parameter Extractor estilo Dify)
  stateSchema: z.any().optional().nullable(),
  // Sub-agentes (Padrão A)
  isSubAgent: z.boolean().optional(),
  subAgentDescription: z.string().optional().nullable(),
  subAgentIds: z.array(z.string().uuid()).optional(),
})

const agentUpdateSchema = agentCreateSchema.partial().extend({
  status: z.nativeEnum(AIAgentStatus).optional(),
})

const promptEditorFlagsSchema = z.object({
  preservePlaceholders: z.boolean().default(true),
  preserveTools: z.boolean().default(true),
  preserveStructure: z.boolean().default(true),
  partialOnly: z.boolean().default(true),
})

const promptEditCandidateSchema = z.object({
  label: z.string().min(1),
  excerpt: z.string().min(1),
})

const promptPatchTargetSchema = z.object({
  strategy: z.enum(['exact_match', 'text_span', 'document_end']),
  startMarker: z.string().optional(),
  endMarker: z.string().optional(),
})

const promptPatchPlanSchema = z.object({
  confidence: z.coerce.number().min(0).max(1),
  operation: z.nativeEnum(AIPromptPatchOperation),
  target: promptPatchTargetSchema,
  oldText: z.string(),
  newText: z.string(),
  reason: z.string(),
  needsConfirmation: z.boolean().optional(),
  candidates: z.array(promptEditCandidateSchema).optional(),
})

const promptPreviewBodySchema = z.object({
  field: z.nativeEnum(AIAgentPromptField),
  instruction: z.string().min(1),
  flags: promptEditorFlagsSchema,
  selectedCandidate: promptEditCandidateSchema.nullable().optional(),
  providerId: z.string().uuid().nullable().optional(),
  model: z.string().min(1).max(200).nullable().optional(),
})

const promptApplyBodySchema = z.object({
  field: z.nativeEnum(AIAgentPromptField),
  instruction: z.string().min(1),
  flags: promptEditorFlagsSchema,
  patch: promptPatchPlanSchema,
})

const sessionQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  status: z.nativeEnum(AISessionStatus).optional(),
  instanceId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const idParamSchema = z.object({ id: z.string().uuid() })

const chatBodySchema = z.object({
  agentId: z.string().uuid(),
  instanceId: z.string(),
  remoteJid: z.string(),
  message: z.string().min(1),
  contactName: z.string().optional(),
})

// ============================================
// Routes
// ============================================

export async function aiRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // ========== STATS ==========
    app.get('/stats', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const stats = await aiService.getAIStats(request.user.companyId)
      return reply.send(stats)
    })

    // ========== PER-AGENT STATS ==========
    app.get('/agents/:id/stats', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const query = z.object({ days: z.coerce.number().min(1).max(365).optional().default(30) }).parse(request.query)
      const companyId = request.user.companyId

      const agent = await prisma.aIAgent.findFirst({ where: { id, companyId } })
      if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })

      const since = new Date()
      since.setDate(since.getDate() - query.days)
      since.setHours(0, 0, 0, 0)

      const [reports, sessionCount, toolCallCount] = await Promise.all([
        prisma.aITokenReport.findMany({
          where: { agentId: id, companyId, date: { gte: since } },
          orderBy: { date: 'asc' },
        }),
        prisma.aISession.count({ where: { agentId: id } }),
        prisma.aIMessage.count({ where: { agentId: id, role: 'tool', createdAt: { gte: since } } }),
      ])

      const totals = reports.reduce((acc, r) => ({
        messages: acc.messages + r.messagesCount,
        promptTokens: acc.promptTokens + r.promptTokens,
        completionTokens: acc.completionTokens + r.completionTokens,
        totalTokens: acc.totalTokens + r.totalTokens,
        costUsd: acc.costUsd + r.costUsd,
      }), { messages: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 })

      const avgLatency = reports.length > 0
        ? reports.reduce((s, r) => s + (r.avgLatencyMs || 0), 0) / reports.length
        : 0

      return reply.send({
        agentId: id,
        agentName: agent.name,
        period: { days: query.days, since },
        totals: {
          ...totals,
          costUsd: Math.round(totals.costUsd * 10000) / 10000,
          sessions: sessionCount,
          toolCalls: toolCallCount,
          avgLatencyMs: Math.round(avgLatency),
        },
        daily: reports.map(r => ({
          date: r.date,
          messages: r.messagesCount,
          totalTokens: r.totalTokens,
          costUsd: Math.round(r.costUsd * 10000) / 10000,
        })),
      })
    })

    // ========== PROVIDERS ==========
    app.get('/providers', { preHandler: [requirePermission('ai_providers:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const providers = await aiService.listProviders(request.user.companyId)
      return reply.send(providers)
    })

    app.get('/providers/:id', { preHandler: [requirePermission('ai_providers:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const provider = await aiService.getProvider(id, request.user.companyId)
      if (!provider) return reply.status(404).send({ error: 'Provider não encontrado' })
      return reply.send(provider)
    })

    app.post('/providers', { preHandler: [requirePermission('ai_providers:manage'), enforcePlanLimit('maxAiProviders')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = providerCreateSchema.parse(request.body)
      const isOAuth = oauthService.isOAuthProvider(body.type)

      // Para OAuth, apiKey é obrigatório (é o access token)
      if (!isOAuth && !body.apiKey) {
        return reply.status(400).send({ error: 'API key é obrigatória' })
      }

      // Validar API key para providers com API key (não OAuth)
      if (!isOAuth && body.apiKey) {
        try {
          const { createProvider } = await import('./providers/index.js')
          const testProvider = createProvider(body.type, body.apiKey, body.baseUrl)
          await testProvider.chat({
            model: body.model,
            messages: [{ role: 'user', content: 'test' }],
            maxTokens: 5,
            temperature: 0,
          })
        } catch (err: any) {
          return reply.status(400).send({ error: `API key inválida: ${err.message}` })
        }
      }

      const provider = await aiService.createProviderRecord({
        ...body,
        apiKey: body.apiKey || 'oauth-managed',
        authType: isOAuth ? (body.authType || 'oauth') : 'apikey',
        enabledModels: body.enabledModels?.length ? body.enabledModels : [body.model],
        companyId: request.user.companyId,
        refreshToken: body.refreshToken || undefined,
        tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : undefined,
        oauthData: body.oauthData || undefined,
      })
      return reply.status(201).send(provider)
    })

    app.put('/providers/:id', { preHandler: [requirePermission('ai_providers:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = providerUpdateSchema.parse(request.body)
      const provider = await aiService.updateProviderRecord(id, request.user.companyId, body)
      return reply.send(provider)
    })

    app.delete('/providers/:id', { preHandler: [requirePermission('ai_providers:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      try {
        await aiService.deleteProviderRecord(id, request.user.companyId)
        return reply.send({ success: true })
      } catch (error: any) {
        const msg = error?.message || 'Erro ao excluir provider'
        // Conflitos de regra de negócio (provider em uso, não encontrado) → 409/404
        if (msg.includes('não encontrado')) return reply.status(404).send({ error: msg })
        if (msg.includes('agente') || msg.includes('Não é possível excluir')) {
          return reply.status(409).send({ error: msg })
        }
        console.error('[providers] delete error:', error)
        return reply.status(500).send({ error: 'Erro interno ao excluir provider' })
      }
    })

    app.post('/providers/:id/test', { preHandler: [requirePermission('ai_providers:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      try {
        const result = await aiService.testProvider(id, request.user.companyId)
        return reply.send(result)
      } catch (error: any) {
        console.error('[AI Provider Test] Error:', error.message)
        return reply.status(400).send({ success: false, error: 'Falha ao testar provedor' })
      }
    })

    // ========== OAUTH FLOWS ==========

    // Mapa de states OAuth ativos (por segurança contra CSRF)
    const oauthStates = new Map<string, { companyId: string; redirectUri: string; createdAt: number }>()
    // Limpar states expirados a cada 5 minutos
    setInterval(() => {
      const now = Date.now()
      for (const [key, val] of oauthStates.entries()) {
        if (now - val.createdAt > 10 * 60 * 1000) oauthStates.delete(key) // 10min TTL
      }
    }, 5 * 60 * 1000)

    /** Valida redirectUri contra origens permitidas */
    function validateRedirectUri(uri: string): boolean {
      try {
        const parsed = new URL(uri)
        const allowedHosts = [
          'localhost',
          '127.0.0.1',
          // Adicionar domínios de produção aqui
          ...(process.env.ALLOWED_OAUTH_ORIGINS?.split(',').map(h => h.trim()) || []),
        ]
        return allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))
      } catch { return false }
    }

    // GitHub Copilot — Step 1: Request device code
    app.post('/oauth/github-copilot/device-code', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(5, 300)] }, async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await oauthService.requestGitHubDeviceCode()
        return reply.send(data)
      } catch (error: any) {
        console.error('[OAuth] GitHub device code error:', error.message)
        return reply.status(500).send({ error: 'Falha ao iniciar autenticação GitHub' })
      }
    })

    // GitHub Copilot — Step 2: Poll for access token (high limit, polling roda a cada 5s por até 15min)
    app.post('/oauth/github-copilot/poll', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(300, 900)] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { device_code } = z.object({ device_code: z.string() }).parse(request.body)
      try {
        // Long-poll: bloqueia até 25s no servidor respeitando slow_down do GitHub
        // (evita bombardear o GitHub e disparar backoff de 13min)
        const result = await oauthService.pollGitHubTokenUntilDone(device_code, 5000, 25000)
        console.log('[OAuth] poll result:', { status: result.status, hasToken: !!result.access_token })
        if (result.status === 'success' && result.access_token) {
          // Obtém copilot token + user info (user info é best-effort: o client VS Code Copilot
          // não tem scope read:user, então /user pode falhar com 401 — ignoramos silenciosamente)
          try {
            console.log('[OAuth] Trocando GitHub token por Copilot token...')
            const copilotData = await oauthService.getCopilotToken(result.access_token)
            let userInfo: { login: string; name: string } | null = null
            try {
              const u = await oauthService.getGitHubUserInfo(result.access_token)
              userInfo = { login: u.login, name: u.name }
            } catch (userErr: any) {
              console.warn('[OAuth] User info indisponível (scope read:user ausente) — seguindo sem:', userErr?.message)
            }
            console.log('[OAuth] Copilot token obtido com sucesso', userInfo ? `para ${userInfo.login}` : '(sem user info)')
            return reply.send({
              status: 'success',
              accessToken: result.access_token,
              copilotToken: copilotData.token,
              copilotEndpoint: copilotData.endpoints?.api || 'https://api.githubcopilot.com',
              copilotExpiresAt: new Date(copilotData.expires_at * 1000).toISOString(),
              user: userInfo || { login: 'copilot-user', name: 'GitHub Copilot' },
            })
          } catch (innerErr: any) {
            console.error('[OAuth] Copilot exchange error:', innerErr?.name, innerErr?.message)
            const isSubscription = innerErr?.name === 'CopilotSubscriptionError'
            return reply.send({
              status: 'error',
              error: isSubscription
                ? 'Sua conta GitHub não possui uma assinatura ativa do GitHub Copilot.'
                : (innerErr?.message || 'Falha ao obter token Copilot'),
            })
          }
        }
        return reply.send({ status: result.status })
      } catch (error: any) {
        console.error('[OAuth] GitHub poll error:', error.message)
        return reply.status(500).send({ error: 'Falha no polling de autenticação' })
      }
    })

    // GitHub Copilot — Refresh copilot token (called periodically)
    app.post('/oauth/github-copilot/refresh', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(10, 300)] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId } = z.object({ providerId: z.string().uuid() }).parse(request.body)
      try {
        const provider = await aiService.getProviderWithSecrets(providerId, request.user.companyId)
        if (!provider) return reply.status(404).send({ error: 'Provider não encontrado' })
        const oauthData = provider.oauthData as any
        if (!oauthData?.githubAccessToken) return reply.status(400).send({ error: 'Provider sem credenciais OAuth' })
        const refreshed = await oauthService.refreshCopilotToken(oauthData.githubAccessToken)
        // Update provider with new copilot token — re-encriptar oauthData
        const newOauthData = {
          ...(oauthData || {}),
          copilotToken: refreshed.copilotToken,
          copilotEndpoint: refreshed.copilotEndpoint,
        }
        await prisma.aIProvider.update({
          where: { id: providerId },
          data: {
            oauthData: encrypt(newOauthData, { companyId: request.user.companyId, model: 'AIProvider', field: 'oauthData', recordId: providerId }),
            tokenExpiresAt: refreshed.expiresAt,
          },
        })
        return reply.send({ success: true, expiresAt: refreshed.expiresAt.toISOString() })
      } catch (error: any) {
        console.error('[OAuth] Copilot refresh error:', error.message)
        return reply.status(500).send({ error: 'Falha ao renovar token Copilot' })
      }
    })

    // Antigravity — Step 1: Get authorize URL
    app.post('/oauth/antigravity/authorize', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(5, 300)] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { redirectUri } = z.object({ redirectUri: z.string().url() }).parse(request.body)
      // Validar redirectUri contra origens permitidas (previne open redirect)
      if (!validateRedirectUri(redirectUri)) {
        return reply.status(400).send({ error: 'redirectUri não permitida' })
      }
      const state = crypto.randomUUID()
      // Salvar state server-side para validação no callback (anti-CSRF)
      oauthStates.set(state, { companyId: request.user.companyId, redirectUri, createdAt: Date.now() })
      const url = oauthService.buildAntigravityAuthUrl(redirectUri, state)
      return reply.send({ authorizeUrl: url, state })
    })

    // Antigravity — Step 2: Exchange code for tokens
    app.post('/oauth/antigravity/callback', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(10, 300)] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = z.object({ code: z.string(), state: z.string().uuid() }).parse(request.body)
      // Validar state contra CSRF
      const savedState = oauthStates.get(state)
      if (!savedState) {
        return reply.status(400).send({ error: 'State inválido ou expirado — tente novamente' })
      }
      if (savedState.companyId !== request.user.companyId) {
        return reply.status(403).send({ error: 'Operação não autorizada' })
      }
      oauthStates.delete(state) // State usado, invalidar
      try {
        const tokens = await oauthService.exchangeAntigravityCode(code, savedState.redirectUri)
        const [userInfo, projectData] = await Promise.all([
          oauthService.getAntigravityUserInfo(tokens.access_token),
          oauthService.antigravityPostExchange(tokens.access_token),
        ])
        return reply.send({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          user: { name: userInfo.name, email: userInfo.email },
          projectId: projectData.projectId,
        })
      } catch (error: any) {
        console.error('[OAuth] Antigravity callback error:', error.message)
        return reply.status(500).send({ error: 'Falha na autenticação Antigravity' })
      }
    })

    // Antigravity — Refresh token
    app.post('/oauth/antigravity/refresh', { preHandler: [requirePermission('ai_providers:manage'), await oauthRateLimit(10, 300)] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId } = z.object({ providerId: z.string().uuid() }).parse(request.body)
      try {
        const provider = await aiService.getProviderWithSecrets(providerId, request.user.companyId)
        if (!provider) return reply.status(404).send({ error: 'Provider não encontrado' })
        if (!provider.refreshToken) return reply.status(400).send({ error: 'Provider sem refresh token' })
        const refreshed = await oauthService.refreshAntigravityToken(provider.refreshToken)
        const newOauthData = {
          ...((provider.oauthData as any) || {}),
          googleAccessToken: refreshed.access_token,
        }
        await prisma.aIProvider.update({
          where: { id: providerId },
          data: {
            apiKey: encrypt(refreshed.access_token, { companyId: request.user.companyId, model: 'AIProvider', field: 'apiKey', recordId: providerId }),
            tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
            oauthData: encrypt(newOauthData, { companyId: request.user.companyId, model: 'AIProvider', field: 'oauthData', recordId: providerId }),
          },
        })
        return reply.send({ success: true })
      } catch (error: any) {
        console.error('[OAuth] Antigravity refresh error:', error.message)
        return reply.status(500).send({ error: 'Falha ao renovar token Google' })
      }
    })

    // ========== AGENTS ==========
    app.get('/agents', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const agents = await aiService.listAgents(request.user.companyId)
      return reply.send(agents)
    })

    app.get('/agents/:id', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const agent = await aiService.getAgent(id, request.user.companyId)
      if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })
      return reply.send(agent)
    })

    app.post('/agents', { preHandler: [requirePermission('ai_agents:manage'), enforcePlanLimit('maxAiAgents')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = agentCreateSchema.parse(request.body)
      const agent = await aiService.createAgent({
        ...body,
        companyId: request.user.companyId,
      })
      return reply.status(201).send(agent)
    })

    app.put('/agents/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = agentUpdateSchema.parse(request.body)
      const agent = await aiService.updateAgent(id, request.user.companyId, body)
      return reply.send(agent)
    })

    app.delete('/agents/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      await aiService.deleteAgent(id, request.user.companyId)
      return reply.send({ success: true })
    })

    app.post('/agents/:id/prompt-editor/preview', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = promptPreviewBodySchema.parse(request.body)
      const preview = await promptEditorService.previewPromptEdit(id, request.user.companyId, body)
      return reply.send(preview)
    })

    app.post('/agents/:id/prompt-editor/apply', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = promptApplyBodySchema.parse(request.body)
      const result = await promptEditorService.applyPromptEdit(id, request.user.companyId, request.user.id, body)
      await auditLog(request, {
        action: 'APPLY_AI_AGENT_PROMPT_PATCH',
        entity: 'ai_agent',
        entityId: id,
        newData: {
          field: body.field,
          instruction: body.instruction,
          versionId: result.version.id,
          confidence: body.patch.confidence,
        },
      })
      return reply.send(result)
    })

    app.post('/agents/:id/prompt-coach/analyze', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = z.object({
        field: z.nativeEnum(AIAgentPromptField),
        useAI: z.boolean().optional().default(false),
        providerId: z.string().uuid().optional(),
        model: z.string().optional(),
      }).parse(request.body)
      const result = await promptCoachService.analyzePrompt(id, request.user.companyId, body)
      return reply.send(result)
    })

    app.get('/agents/:id/prompt-editor/versions', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const versions = await promptEditorService.listPromptVersions(id, request.user.companyId)
      return reply.send(versions)
    })

    app.get('/agents/:id/prompt-editor/versions/:versionId', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const { versionId } = z.object({ versionId: z.string().uuid() }).parse(request.params)
      const version = await promptEditorService.getPromptVersion(id, versionId, request.user.companyId)
      return reply.send(version)
    })

    app.post('/agents/:id/prompt-editor/versions/:versionId/restore', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const { versionId } = z.object({ versionId: z.string().uuid() }).parse(request.params)
      const result = await promptEditorService.restorePromptVersion(id, versionId, request.user.companyId, request.user.id)
      await auditLog(request, {
        action: 'RESTORE_AI_AGENT_PROMPT_VERSION',
        entity: 'ai_agent',
        entityId: id,
        newData: {
          restoredVersionId: versionId,
          newVersionId: result.version.id,
          field: result.version.field,
        },
      })
      return reply.send(result)
    })

    // ========== KNOWLEDGE BASE (RAG) ==========
    // Rotas de KB, Sources, Ingestion, RAG debug
    const { registerKnowledgeRoutes } = await import('./rag/knowledge.routes.js')
    await registerKnowledgeRoutes(app)

    // Link/unlink knowledge base from agent
    app.post('/agents/:id/knowledge/:kbId', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const { kbId } = z.object({ kbId: z.string().uuid() }).parse(request.params)
      const link = await aiService.linkKnowledgeToAgent(id, kbId, request.user.companyId)
      return reply.status(201).send(link)
    })

    app.delete('/agents/:id/knowledge/:kbId', { preHandler: [requirePermission('ai_knowledge:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const { kbId } = z.object({ kbId: z.string().uuid() }).parse(request.params)
      await aiService.unlinkKnowledgeFromAgent(id, kbId)
      return reply.send({ success: true })
    })

    // ========== SESSIONS ==========
    app.get('/sessions', { preHandler: [requirePermission('ai_sessions:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const query = sessionQuerySchema.parse(request.query)
      const result = await aiService.listSessions(request.user.companyId, query)
      return reply.send(result)
    })

    app.get('/sessions/:id/messages', { preHandler: [requirePermission('ai_sessions:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const result = await aiService.getSessionMessages(id, request.user.companyId)
      return reply.send(result)
    })

    app.post('/sessions/:id/close', { preHandler: [requirePermission('ai_sessions:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const session = await aiService.closeSession(id, request.user.companyId)
      return reply.send(session)
    })

    app.post('/sessions/:id/reopen', { preHandler: [requirePermission('ai_sessions:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const session = await aiService.reopenSession(id, request.user.companyId)
      return reply.send(session)
    })

    app.delete('/sessions/:id', { preHandler: [requirePermission('ai_sessions:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      await aiService.deleteSession(id, request.user.companyId)
      return reply.send({ success: true })
    })

    // ========== CHAT (teste manual via WhatsApp) ==========
    app.post('/chat', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = chatBodySchema.parse(request.body)
      try {
        const result = await aiService.processMessage({
          agentId: body.agentId,
          instanceId: body.instanceId,
          remoteJid: body.remoteJid,
          messageText: body.message,
          companyId: request.user.companyId,
          contactName: body.contactName,
        })
        return reply.send(result)
      } catch (error: any) {
        console.error('[AI Agent Message] Error:', error.message)
        return reply.status(400).send({ error: 'Erro ao processar mensagem do agente' })
      }
    })

    // ========== TESTE DIRETO DO AGENTE (sem WhatsApp) ==========
    app.post('/agents/:id/test-chat', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const body = z.object({
        message: z.string().min(1),
        history: z.array(z.object({ role: z.string(), content: z.string() })).optional().default([]),
        providerId: z.string().uuid().optional(),
        model: z.string().optional(),
      }).parse(request.body)

      const companyId = request.user.companyId

      // Verificar se o agente existe e pertence à empresa
      const agent = await prisma.aIAgent.findFirst({
        where: { id, companyId },
        include: { provider: true },
      })
      if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })

      const startTime = Date.now()

      try {
        // Converte histórico para formato do provider
        const messages = body.history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        // Se o usuário escolheu um provider/model diferente, usar ele
        let testProvider = agent.provider
        if (body.providerId && body.providerId !== agent.providerId) {
          const customProvider = await prisma.aIProvider.findFirst({
            where: { id: body.providerId, companyId },
          })
          if (customProvider) testProvider = customProvider
        }
        const testModel = body.model || agent.model || testProvider.model

        // runAgent com contexto fake (sem instância/remoteJid)
        const result = await runAgent({
          agentId: id,
          context: {
            companyId,
            instanceId: '__test__',
            remoteJid: '__test_panel__',
            contactName: 'Teste via Painel',
          },
          messages,
          messageText: body.message,
          overrideProvider: body.providerId ? testProvider : undefined,
          overrideModel: body.model || undefined,
        })

        const latencyMs = Date.now() - startTime

        // Calcular custo usando cost-calculator (suporta todos os providers)
        const { calculateCost } = await import('./cost-calculator.js')
        const modelName = result.model || testModel || agent.provider.model
        const promptTk = (result as any).promptTokens || Math.floor(result.tokensUsed * 0.7)
        const completionTk = (result as any).completionTokens || Math.floor(result.tokensUsed * 0.3)
        const costUsd = calculateCost(modelName, promptTk, completionTk)

        // Registrar no relatório de tokens (upsert diário)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        try {
          await prisma.aITokenReport.upsert({
            where: {
              companyId_agentId_instanceId_date: {
                companyId,
                agentId: id,
                instanceId: '__test__',
                date: today,
              },
            },
            create: {
              companyId,
              agentId: id,
              instanceId: '__test__',
              date: today,
              messagesCount: 1,
              sessionsCount: 0,
              promptTokens: promptTk,
              completionTokens: completionTk,
              totalTokens: result.tokensUsed,
              costUsd,
              modelBreakdown: [{ model: modelName, tokens: result.tokensUsed, cost: costUsd }],
            },
            update: {
              messagesCount: { increment: 1 },
              promptTokens: { increment: promptTk },
              completionTokens: { increment: completionTk },
              totalTokens: { increment: result.tokensUsed },
              costUsd: { increment: costUsd },
            },
          })
        } catch (e) {
          console.error('[Agent Test] Error updating token report:', e)
        }

        return reply.send({
          reply: result.reply,
          model: modelName,
          providerName: testProvider.name,
          tokensUsed: result.tokensUsed,
          costUsd: Math.round(costUsd * 10000) / 10000,
          latencyMs,
        })
      } catch (error: any) {
        console.error('[Agent Test Chat] Error:', error)
        return reply.status(500).send({ error: 'Erro ao processar mensagem' })
      }
    })

    // ========== AI TEST CHAT STREAMING (SSE) ==========
    // Mesmo que test-chat mas retorna tokens em tempo real via SSE
    app.post('/agents/:id/test-chat/stream', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const body = z.object({
        message: z.string().min(1),
        history: z.array(z.object({ role: z.string(), content: z.string() })).optional().default([]),
        providerId: z.string().uuid().optional(),
        model: z.string().optional(),
      }).parse(request.body)

      const companyId = request.user.companyId

      const agent = await prisma.aIAgent.findFirst({
        where: { id, companyId },
        include: { provider: true },
      })
      if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })

      // Configurar SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sendEvent = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      try {
        const messages = body.history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        let testProvider = agent.provider
        if (body.providerId && body.providerId !== agent.providerId) {
          const customProvider = await prisma.aIProvider.findFirst({ where: { id: body.providerId, companyId } })
          if (customProvider) testProvider = customProvider
        }

        // Build agent to get provider instance
        const { buildAgent } = await import('./agent-builder.js')
        const built = await buildAgent(id, {
          companyId,
          instanceId: '__test__',
          remoteJid: '__test_panel__',
          contactName: 'Teste via Painel',
        })

        // Override provider/model if requested
        if (body.providerId) {
          const { decryptProviderSecrets, getProviderWithFreshToken } = await import('./ai.service.js')
          const { createProvider } = await import('./providers/provider-registry.js')
          const dp = await getProviderWithFreshToken(testProvider.id, companyId) || decryptProviderSecrets(testProvider)
          Object.assign(built, { provider: createProvider(dp.type, dp.apiKey, dp.baseUrl, dp.oauthData) })
        }
        if (body.model) built.model = body.model

        const chatMessages = [...messages, { role: 'user' as const, content: body.message }]

        let fullContent = ''
        const startTime = Date.now()

        const onToken = (token: string) => {
          fullContent += token
          sendEvent('token', { token })
        }

        // Use streaming if supported, otherwise fall back to regular chat
        let result
        if (built.provider.chatStream) {
          result = await built.provider.chatStream({
            model: built.model,
            messages: chatMessages,
            maxTokens: built.maxTokens,
            temperature: built.temperature,
            topP: built.topP,
            systemPrompt: built.systemPrompt,
          }, onToken)
        } else {
          // Fallback: regular chat, send full response as one token event
          result = await built.provider.chat({
            model: built.model,
            messages: chatMessages,
            maxTokens: built.maxTokens,
            temperature: built.temperature,
            topP: built.topP,
            systemPrompt: built.systemPrompt,
          })
          sendEvent('token', { token: result.content })
          fullContent = result.content
        }

        const { calculateCost } = await import('./cost-calculator.js')
        const modelName = result.model || built.model
        const promptTk = result.promptTokens || Math.floor(result.tokensUsed * 0.7)
        const completionTk = result.completionTokens || Math.floor(result.tokensUsed * 0.3)
        const costUsd = calculateCost(modelName, promptTk, completionTk)

        sendEvent('done', {
          model: modelName,
          providerName: testProvider.name,
          tokensUsed: result.tokensUsed,
          costUsd: Math.round(costUsd * 10000) / 10000,
          latencyMs: Date.now() - startTime,
        })
      } catch (error: any) {
        console.error('[Agent Test Chat Stream] Error:', error)
        sendEvent('error', { error: error.message || 'Erro ao processar mensagem' })
      } finally {
        reply.raw.end()
      }
    })

    // ========== AI SESSION STATUS (para o chat UI) ==========
    // Retorna se a IA está ativa ou pausada nesta conversa
    app.get('/session-status/:instanceId/:remoteJid', async (request: FastifyRequest, reply: FastifyReply) => {
      const { instanceId, remoteJid } = z.object({
        instanceId: z.string(),
        remoteJid: z.string(),
      }).parse(request.params)

      const session = await prisma.aISession.findFirst({
        where: {
          instanceId,
          remoteJid,
          status: { in: ['OPENED', 'PAUSED'] },
          agent: { companyId: request.user.companyId, status: 'ACTIVE' },
        },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { lastActivity: 'desc' },
      })

      return reply.send({
        active: session?.status === 'OPENED',
        sessionId: session?.id || null,
        agentName: session?.agent?.name || null,
        status: session?.status || null,
      })
    })

    // Pausar/reativar IA para uma conversa específica (do chat UI)
    app.post('/session-toggle/:instanceId/:remoteJid', async (request: FastifyRequest, reply: FastifyReply) => {
      const { instanceId, remoteJid } = z.object({
        instanceId: z.string(),
        remoteJid: z.string(),
      }).parse(request.params)
      const { action } = z.object({ action: z.enum(['pause', 'resume']) }).parse(request.body)

      const session = await prisma.aISession.findFirst({
        where: {
          instanceId,
          remoteJid,
          agent: { companyId: request.user.companyId },
        },
        orderBy: { lastActivity: 'desc' },
      })

      if (!session) return reply.status(404).send({ error: 'Nenhuma sessão encontrada' })

      if (action === 'pause' && session.status === 'OPENED') {
        await prisma.aISession.update({
          where: { id: session.id },
          data: {
            status: 'PAUSED',
            followUpCount: 0,
            lastFollowUpAt: null,
            followUpStartedAt: null,
          },
        })
        // Emitir evento em tempo real
        io?.to(`instance:${instanceId}`).emit('ai-session-update', {
          instanceId, remoteJid, status: 'PAUSED', sessionId: session.id, agentName: null,
        })
        const userName = request.user.name || 'Usuário'
        const convId = await getConversationId(instanceId, remoteJid)
        if (convId) {
          logConversationEvent({
            conversationId: convId, instanceId, remoteJid,
            eventType: 'ai_session_paused',
            description: `${userName} pausou a IA nesta conversa`,
            actorType: 'user', actorName: userName,
          })
        }
        return reply.send({ success: true, status: 'PAUSED' })
      }

      if (action === 'resume' && session.status === 'PAUSED') {
        const updated = await prisma.aISession.update({
          where: { id: session.id },
          data: {
            status: 'OPENED',
            lastActivity: new Date(),
            followUpCount: 0,
            lastFollowUpAt: null,
            followUpStartedAt: new Date(),
          },
          include: { agent: { select: { name: true } } },
        })
        // Emitir evento em tempo real
        io?.to(`instance:${instanceId}`).emit('ai-session-update', {
          instanceId, remoteJid, status: 'OPENED', sessionId: session.id, agentName: updated.agent.name,
        })
        const userName2 = request.user.name || 'Usuário'
        const convId2 = await getConversationId(instanceId, remoteJid)
        if (convId2) {
          logConversationEvent({
            conversationId: convId2, instanceId, remoteJid,
            eventType: 'ai_session_resumed',
            description: `${userName2} retomou a IA "${updated.agent.name}" nesta conversa`,
            actorType: 'user', actorName: userName2,
          })
        }
        return reply.send({ success: true, status: 'OPENED' })
      }

      return reply.send({ success: false, status: session.status })
    })

    // ============================================
    // TOOL LOGS — Debug panel
    // ============================================

    // GET /tool-logs — Listar logs de execução de tools
    app.get('/tool-logs', { preHandler: [requirePermission('ai_tools:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId, sessionId, toolType, status, page, limit } = request.query as any
      const take = Math.min(parseInt(limit) || 50, 200)
      const skip = ((parseInt(page) || 1) - 1) * take

      const where: any = { companyId: request.user.companyId }
      if (agentId) where.agentId = agentId
      if (sessionId) where.sessionId = sessionId
      if (toolType) where.toolType = toolType
      if (status) where.status = status

      const [logs, total] = await Promise.all([
        prisma.aIToolLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        prisma.aIToolLog.count({ where }),
      ])

      return reply.send({ logs, total, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take) })
    })

    // GET /tool-logs/:id — Detalhe de um log
    app.get('/tool-logs/:id', { preHandler: [requirePermission('ai_tools:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as any
      const log = await prisma.aIToolLog.findFirst({
        where: { id, companyId: request.user.companyId },
      })
      if (!log) return reply.status(404).send({ error: 'Log não encontrado' })
      return reply.send(log)
    })

    // ============================================
    // MCP SERVERS — Gerenciamento
    // ============================================

    // GET /mcp-servers — Listar MCP servers
    app.get('/mcp-servers', { preHandler: [requirePermission('ai_tools:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const servers = await prisma.aIMCPServer.findMany({
        where: { companyId: request.user.companyId },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send(servers)
    })

    // POST /mcp-servers — Criar MCP server
    app.post('/mcp-servers', { preHandler: [requirePermission('ai_tools:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const data = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        serverUrl: z.string().url(),
        transport: z.enum(['sse', 'streamable_http']).default('sse'),
        authType: z.enum(['none', 'bearer', 'header', 'query']).default('none'),
        authKey: z.string().optional(),
        authValue: z.string().optional(),
        timeout: z.number().int().min(1000).max(120000).default(30000),
        sseReadTimeout: z.number().int().min(1000).max(300000).default(60000),
      }).parse(request.body)

      // Encrypt authValue before storing
      const encData: any = { ...data, companyId: request.user.companyId }
      if (data.authValue) {
        const mcpId = crypto.randomUUID()
        const ctx: EncryptionContext = { companyId: request.user.companyId, model: 'AIMCPServer', field: 'authValue', recordId: mcpId }
        encData.id = mcpId
        encData.authValue = encrypt(data.authValue, ctx)
      }

      const server = await prisma.aIMCPServer.create({ data: encData })
      return reply.status(201).send(server)
    })

    // PUT /mcp-servers/:id — Atualizar
    app.put('/mcp-servers/:id', { preHandler: [requirePermission('ai_tools:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as any
      const data = z.object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        serverUrl: z.string().url().optional(),
        transport: z.enum(['sse', 'streamable_http']).optional(),
        authType: z.enum(['none', 'bearer', 'header', 'query']).optional(),
        authKey: z.string().nullable().optional(),
        authValue: z.string().nullable().optional(),
        timeout: z.number().int().min(1000).max(120000).optional(),
        sseReadTimeout: z.number().int().min(1000).max(300000).optional(),
        isActive: z.boolean().optional(),
      }).parse(request.body)

      // Encrypt authValue before storing
      const encData: any = { ...data }
      if (data.authValue) {
        const ctx: EncryptionContext = { companyId: request.user.companyId, model: 'AIMCPServer', field: 'authValue', recordId: id }
        encData.authValue = encrypt(data.authValue, ctx)
      }

      const server = await prisma.aIMCPServer.update({
        where: { id },
        data: encData,
      })
      return reply.send(server)
    })

    // DELETE /mcp-servers/:id — Deletar
    app.delete('/mcp-servers/:id', { preHandler: [requirePermission('ai_tools:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as any
      const server = await prisma.aIMCPServer.findFirst({
        where: { id, companyId: request.user.companyId },
      })
      if (!server) return reply.status(404).send({ error: 'Servidor não encontrado' })
      await prisma.aIMCPServer.delete({ where: { id } })
      return reply.send({ success: true })
    })

    // POST /mcp-servers/:id/discover — Descobrir tools
    app.post('/mcp-servers/:id/discover', { preHandler: [requirePermission('ai_tools:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as any
      const server = await prisma.aIMCPServer.findFirst({
        where: { id, companyId: request.user.companyId },
      })
      if (!server) return reply.status(404).send({ error: 'Servidor não encontrado' })

      try {
        const { initMCPServers } = await import('./tools/index.js')
        const configs = await initMCPServers(request.user.companyId)
        const config = configs.find(c => c.id === id)

        if (!config) {
          return reply.status(400).send({ error: 'Falha ao conectar ao servidor MCP' })
        }

        // Reload from DB to get discovered tools
        const updated = await prisma.aIMCPServer.findUnique({ where: { id } })
        return reply.send({
          success: true,
          tools: updated?.discoveredTools || [],
          discoveredAt: updated?.lastDiscoveredAt,
        })
      } catch (err: any) {
        console.error('[MCP Discover] Erro:', err.message)
        return reply.status(400).send({ error: 'Falha ao descobrir tools do servidor MCP' })
      }
    })

    // ============================================
    // DYNAMIC MODEL LISTING
    // ============================================

    // GET /providers/:id/models — Listar modelos disponíveis do provider (da API em tempo real)
    app.get('/providers/:id/models', { preHandler: [requirePermission('ai_providers:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const { id } = request.params as { id: string }

      // Usar getProviderWithFreshToken para refresh automático do copilotToken
      const provider = await aiService.getProviderWithFreshToken(id, companyId)
      if (!provider) return reply.status(404).send({ error: 'Provider não encontrado' })

      try {
        const { createProvider } = await import('./providers/index.js')
        const p = createProvider(provider.type, provider.apiKey, provider.baseUrl || undefined, provider.oauthData)
        const models = await p.listModels()
        // Marcar quais estão habilitados
        const enabledSet = new Set(provider.enabledModels || [])
        const enriched = models.map((m: any) => ({
          ...m,
          enabled: enabledSet.has(m.id),
        }))
        return reply.send({ models: enriched, enabledModels: provider.enabledModels || [] })
      } catch (err: any) {
        return reply.status(400).send({ error: `Erro ao listar modelos: ${err.message}` })
      }
    })

    // PUT /providers/:id/enabled-models — Atualizar modelos habilitados
    app.put('/providers/:id/enabled-models', { preHandler: [requirePermission('ai_providers:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const { id } = request.params as { id: string }
      const { enabledModels } = z.object({ enabledModels: z.array(z.string()) }).parse(request.body)

      const provider = await prisma.aIProvider.findFirst({ where: { id, companyId } })
      if (!provider) return reply.status(404).send({ error: 'Provider não encontrado' })

      // Se o modelo padrão não está na lista, usar o primeiro habilitado
      const model = enabledModels.includes(provider.model) ? provider.model : (enabledModels[0] || provider.model)

      const updated = await prisma.aIProvider.update({
        where: { id },
        data: { enabledModels, model },
      })
      return reply.send(updated)
    })

    // ============================================
    // TOKEN USAGE REPORTS
    // ============================================

    // GET /token-usage — Relatório por período com filtros
    app.get('/token-usage', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const {
        agentId,
        instanceId,
        period = '7d',
        groupBy = 'day',
        page = '1',
        pageSize = '30',
      } = request.query as Record<string, string>

      // Calcular datas
      const now = new Date()
      const periodDays: Record<string, number> = {
        '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365, 'all': 36500,
      }
      const days = periodDays[period] || 7
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      startDate.setHours(0, 0, 0, 0)

      const where: any = { companyId, date: { gte: startDate } }
      if (agentId) where.agentId = agentId
      if (instanceId) where.instanceId = instanceId

      const [reports, agents, instances] = await Promise.all([
        prisma.aITokenReport.findMany({
          where,
          orderBy: { date: 'desc' },
          take: parseInt(pageSize),
          skip: (parseInt(page) - 1) * parseInt(pageSize),
        }),
        prisma.aIAgent.findMany({
          where: { companyId },
          select: { id: true, name: true },
        }),
        prisma.instance.findMany({
          where: { companyId },
          select: { id: true, name: true, phoneNumber: true },
        }),
      ])

      // Totais do período
      const totals = await prisma.aITokenReport.aggregate({
        where,
        _sum: {
          messagesCount: true,
          sessionsCount: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costUsd: true,
        },
      })

      // Nomes amigáveis para IDs sintéticos (RAG, embedding, chat da KB, teste de agente)
      const SYNTHETIC_AGENTS: Record<string, string> = {
        '__kb_chat__': '💬 Chat da Base',
        '__embedding__': '🧠 Embeddings (RAG)',
        '__ingestion__': '📥 Ingestão de Dados',
        '__asr__': '🎙️ Transcrição de Áudio (ASR)',
      }
      const SYNTHETIC_INSTANCES: Record<string, string> = {
        '__rag__': '📚 Knowledge Base',
        '__test__': '🧪 Teste via Painel',
        '__youtube__': '🎬 YouTube (ASR)',
        '__message__': '🎙️ Transcrição de Mensagens',
      }
      const SYNTHETIC_SESSIONS: Record<string, string> = {
        '__agent_test__': '🧪 Teste do Agente',
        '__kb_chat__': '💬 Chat da Base',
      }

      // Enriquecer com nomes
      const agentMap = Object.fromEntries(agents.map(a => [a.id, a.name]))
      const instanceMap = Object.fromEntries(instances.map(i => [i.id, `${i.name} (${i.phoneNumber || 'sem número'})`]))

      const enriched = reports.map(r => ({
        ...r,
        agentName: r.agentId
          ? (SYNTHETIC_AGENTS[r.agentId] || agentMap[r.agentId] || r.agentId)
          : 'Todos',
        instanceName: r.instanceId
          ? (SYNTHETIC_INSTANCES[r.instanceId] || instanceMap[r.instanceId] || r.instanceId)
          : 'Todas',
        costBrl: (r.costUsd || 0) * 5.7,
      }))

      console.log(`[TokenReport] period=${period} companyId=${companyId} reports=${enriched.length} totals=${totals._sum.totalTokens}`)

      return reply.send({
        reports: enriched,
        totals: {
          messagesCount: totals._sum.messagesCount || 0,
          sessionsCount: totals._sum.sessionsCount || 0,
          promptTokens: totals._sum.promptTokens || 0,
          completionTokens: totals._sum.completionTokens || 0,
          totalTokens: totals._sum.totalTokens || 0,
          costUsd: totals._sum.costUsd || 0,
          costBrl: (totals._sum.costUsd || 0) * 5.7,
        },
        period,
        startDate,
        agents,
        instances,
      })
    })

    // GET /token-usage/by-agent — Custo agrupado por agente
    app.get('/token-usage/by-agent', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const { period = '30d' } = request.query as Record<string, string>

      const days = parseInt(period) || 30
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const [grouped, agents] = await Promise.all([
        prisma.aITokenReport.groupBy({
          by: ['agentId'],
          where: { companyId, date: { gte: startDate } },
          _sum: { totalTokens: true, costUsd: true, messagesCount: true },
          orderBy: { _sum: { costUsd: 'desc' } },
        }),
        prisma.aIAgent.findMany({
          where: { companyId },
          select: { id: true, name: true, type: true },
        }),
      ])

      const SYNTHETIC_AGENTS: Record<string, string> = {
        '__kb_chat__': '💬 Chat da Base',
        '__embedding__': '🧠 Embeddings (RAG)',
        '__ingestion__': '📥 Ingestão de Dados',
        '__asr__': '🎙️ Transcrição de Áudio (ASR)',
      }
      const agentMap = Object.fromEntries(agents.map(a => [a.id, a]))
      return reply.send(grouped.map(g => ({
        agentId: g.agentId,
        agentName: g.agentId
          ? (SYNTHETIC_AGENTS[g.agentId] || agentMap[g.agentId]?.name || g.agentId)
          : 'Desconhecido',
        totalTokens: g._sum.totalTokens || 0,
        costUsd: g._sum.costUsd || 0,
        costBrl: (g._sum.costUsd || 0) * 5.7,
        messagesCount: g._sum.messagesCount || 0,
      })))
    })

    // GET /token-usage/by-instance — Custo agrupado por instância
    app.get('/token-usage/by-instance', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const { period = '30d' } = request.query as Record<string, string>

      const days = parseInt(period) || 30
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const [grouped, instances] = await Promise.all([
        prisma.aITokenReport.groupBy({
          by: ['instanceId'],
          where: { companyId, date: { gte: startDate } },
          _sum: { totalTokens: true, costUsd: true, messagesCount: true },
          orderBy: { _sum: { costUsd: 'desc' } },
        }),
        prisma.instance.findMany({
          where: { companyId },
          select: { id: true, name: true, phoneNumber: true },
        }),
      ])

      const SYNTHETIC_INSTANCES: Record<string, string> = {
        '__rag__': '📚 Knowledge Base',
        '__test__': '🧪 Teste via Painel',
      }
      const instanceMap = Object.fromEntries(instances.map(i => [i.id, i]))
      return reply.send(grouped.map(g => ({
        instanceId: g.instanceId,
        instanceName: g.instanceId
          ? (SYNTHETIC_INSTANCES[g.instanceId] || `${instanceMap[g.instanceId]?.name || g.instanceId} (${instanceMap[g.instanceId]?.phoneNumber || 'sem número'})`)
          : 'Desconhecida',
        totalTokens: g._sum.totalTokens || 0,
        costUsd: g._sum.costUsd || 0,
        costBrl: (g._sum.costUsd || 0) * 5.7,
        messagesCount: g._sum.messagesCount || 0,
      })))
    })

    // GET /token-usage/sessions — Sessões com custo detalhado
    app.get('/token-usage/sessions', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { companyId } = request.user as { companyId: string }
      const {
        agentId, instanceId, period = '7d',
        page = '1', pageSize = '20',
      } = request.query as Record<string, string>

      const days = parseInt(period) || 7
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const agents = await prisma.aIAgent.findMany({
        where: { companyId },
        select: { id: true, name: true },
      })
      const agentIds = agents.map(a => a.id)

      const where: any = {
        agentId: { in: agentIds },
        startedAt: { gte: startDate },
      }
      if (agentId) where.agentId = agentId
      if (instanceId) where.instanceId = instanceId

      const [sessions, total] = await Promise.all([
        prisma.aISession.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          take: parseInt(pageSize),
          skip: (parseInt(page) - 1) * parseInt(pageSize),
          select: {
            id: true, agentId: true, instanceId: true, remoteJid: true,
            status: true, messageCount: true, tokensUsed: true,
            promptTokens: true, completionTokens: true, costUsd: true,
            startedAt: true, lastActivity: true, closedAt: true,
          },
        }),
        prisma.aISession.count({ where }),
      ])

      const agentMap = Object.fromEntries(agents.map(a => [a.id, a.name]))
      return reply.send({
        sessions: sessions.map(s => ({
          ...s,
          agentName: agentMap[s.agentId] || s.agentId,
          costBrl: (s.costUsd || 0) * 5.7,
        })),
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      })
    })

    // ========== AGENT TEMPLATES ==========

    // Listar templates (não requer permissão especial, são globais)
    app.get('/templates', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { category?: string; difficulty?: string; search?: string }
      const templates = await templateService.listTemplates(query)
      return reply.send(templates)
    })

    // Listar categorias de templates
    app.get('/templates/categories', async (_request: FastifyRequest, reply: FastifyReply) => {
      const categories = await templateService.listCategories()
      return reply.send(categories)
    })

    // Buscar template por ID ou slug
    app.get('/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string }
      const template = await templateService.getTemplate(id)
      if (!template) return reply.status(404).send({ error: 'Template não encontrado' })
      return reply.send(template)
    })

    // Criar agente a partir de template
    app.post('/templates/:id/create-agent', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string }
      const body = z.object({
        providerId: z.string().uuid(),
        name: z.string().min(1).optional(),
        instanceIds: z.array(z.string().uuid()).optional(),
      }).parse(request.body)

      const result = await templateService.createAgentFromTemplate({
        templateId: id,
        companyId: request.user.companyId,
        providerId: body.providerId,
        name: body.name,
        instanceIds: body.instanceIds,
      })

      return reply.status(201).send(result)
    })

    // Seed de templates (admin only)
    app.post('/templates/seed', { preHandler: [requirePermission('ai_agents:manage')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
      const result = await templateService.seedTemplates()
      return reply.send(result)
    })

    // ========== MEMÓRIA PERSISTENTE ==========

    // Listar memórias
    app.get('/memories', { preHandler: [requirePermission('ai_sessions:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { agentId?: string; remoteJid?: string; page?: string; limit?: string }
      const result = await memoryService.listMemories(request.user.companyId, {
        agentId: query.agentId,
        remoteJid: query.remoteJid,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      })
      return reply.send(result)
    })

    // Buscar memória específica
    app.get('/memories/:id', { preHandler: [requirePermission('ai_sessions:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const memory = await memoryService.getMemory(id, request.user.companyId)
      if (!memory) return reply.status(404).send({ error: 'Memória não encontrada' })
      return reply.send(memory)
    })

    // Deletar memória
    app.delete('/memories/:id', { preHandler: [requirePermission('ai_sessions:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      await memoryService.deleteMemory(id, request.user.companyId)
      return reply.send({ success: true })
    })

    // ========== AGENT LEARNINGS (memória procedural) ==========

    app.get('/learnings', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { agentId?: string; category?: string; active?: string; page?: string; limit?: string }
      const where: any = { companyId: request.user.companyId }
      if (q.agentId) where.agentId = q.agentId
      if (q.category) where.category = q.category
      if (q.active === 'true') where.active = true
      else if (q.active === 'false') where.active = false
      const page = q.page ? Math.max(1, parseInt(q.page)) : 1
      const limit = q.limit ? Math.min(200, Math.max(1, parseInt(q.limit))) : 50
      const [items, total] = await Promise.all([
        prisma.aIAgentLearning.findMany({
          where,
          orderBy: [{ active: 'desc' }, { confidence: 'desc' }, { appliedCount: 'desc' }],
          skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { id: true, name: true } } },
        }),
        prisma.aIAgentLearning.count({ where }),
      ])
      return reply.send({ items, total, page, totalPages: Math.ceil(total / limit) })
    })

    app.post('/learnings', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { agentId: string; trigger: string; lesson: string; category?: string; confidence?: number }
      if (!body.agentId || !body.trigger || !body.lesson) return reply.status(400).send({ error: 'agentId, trigger e lesson são obrigatórios' })
      // Confirma agente da empresa
      const agent = await prisma.aIAgent.findFirst({ where: { id: body.agentId, companyId: request.user.companyId } })
      if (!agent) return reply.status(404).send({ error: 'Agente não encontrado' })
      const created = await prisma.aIAgentLearning.create({
        data: {
          companyId: request.user.companyId, agentId: body.agentId,
          trigger: body.trigger.substring(0, 500), lesson: body.lesson.substring(0, 1000),
          category: body.category || 'general', confidence: typeof body.confidence === 'number' ? Math.max(0, Math.min(1, body.confidence)) : 0.7,
          sourceType: 'human_feedback', createdBy: (request.user as any).id || (request.user as any).userId,
        },
      })
      return reply.status(201).send(created)
    })

    app.put('/learnings/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = request.body as Partial<{ trigger: string; lesson: string; category: string; confidence: number; active: boolean }>
      const existing = await prisma.aIAgentLearning.findFirst({ where: { id, companyId: request.user.companyId } })
      if (!existing) return reply.status(404).send({ error: 'Não encontrada' })
      const data: any = {}
      if (body.trigger !== undefined) data.trigger = body.trigger.substring(0, 500)
      if (body.lesson !== undefined) data.lesson = body.lesson.substring(0, 1000)
      if (body.category !== undefined) data.category = body.category
      if (typeof body.confidence === 'number') data.confidence = Math.max(0, Math.min(1, body.confidence))
      if (typeof body.active === 'boolean') {
        data.active = body.active
        if (!body.active) data.archivedAt = new Date()
        else data.archivedAt = null
      }
      const updated = await prisma.aIAgentLearning.update({ where: { id }, data })
      return reply.send(updated)
    })

    app.delete('/learnings/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const existing = await prisma.aIAgentLearning.findFirst({ where: { id, companyId: request.user.companyId } })
      if (!existing) return reply.status(404).send({ error: 'Não encontrada' })
      await prisma.aIAgentLearning.delete({ where: { id } })
      return reply.send({ success: true })
    })

    // ========== AI ARTIFACTS ==========

    app.get('/artifacts', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { agentId?: string; remoteJid?: string; type?: string; status?: string; page?: string; limit?: string; rootOnly?: string }
      const where: any = { companyId: request.user.companyId }
      if (q.agentId) where.agentId = q.agentId
      if (q.remoteJid) where.remoteJid = q.remoteJid
      if (q.type) where.type = q.type
      if (q.status) where.status = q.status
      if (q.rootOnly === 'true') where.parentArtifactId = null
      const page = q.page ? Math.max(1, parseInt(q.page)) : 1
      const limit = q.limit ? Math.min(200, Math.max(1, parseInt(q.limit))) : 50
      const [items, total] = await Promise.all([
        prisma.aIArtifact.findMany({
          where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
          select: { id: true, name: true, type: true, mimeType: true, version: true, parentArtifactId: true, status: true, description: true, agentId: true, remoteJid: true, sessionId: true, createdAt: true, updatedAt: true, approvedBy: true, approvedAt: true },
        }),
        prisma.aIArtifact.count({ where }),
      ])
      return reply.send({ items, total, page, totalPages: Math.ceil(total / limit) })
    })

    app.get('/artifacts/:id', { preHandler: [requirePermission('ai_agents:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const artifact = await prisma.aIArtifact.findFirst({ where: { id, companyId: request.user.companyId }, include: { versions: { select: { id: true, version: true, createdAt: true, status: true }, orderBy: { version: 'asc' } } } })
      if (!artifact) return reply.status(404).send({ error: 'Não encontrado' })
      return reply.send(artifact)
    })

    app.put('/artifacts/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const body = request.body as Partial<{ name: string; description: string; status: string; content: string }>
      const existing = await prisma.aIArtifact.findFirst({ where: { id, companyId: request.user.companyId } })
      if (!existing) return reply.status(404).send({ error: 'Não encontrado' })
      const data: any = {}
      if (body.name !== undefined) data.name = body.name.substring(0, 200)
      if (body.description !== undefined) data.description = body.description ? body.description.substring(0, 500) : null
      if (body.status !== undefined && ['draft', 'approved', 'archived'].includes(body.status)) {
        data.status = body.status
        if (body.status === 'approved') {
          data.approvedBy = (request.user as any).id || (request.user as any).userId || null
          data.approvedAt = new Date()
        }
      }
      if (body.content !== undefined) data.content = body.content
      const updated = await prisma.aIArtifact.update({ where: { id }, data })
      return reply.send(updated)
    })

    app.delete('/artifacts/:id', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params)
      const existing = await prisma.aIArtifact.findFirst({ where: { id, companyId: request.user.companyId } })
      if (!existing) return reply.status(404).send({ error: 'Não encontrado' })
      await prisma.aIArtifact.delete({ where: { id } })
      return reply.send({ success: true })
    })

    // ========== MÉTRICAS DE PROVIDERS (Smart Routing) ==========

    // Buscar métricas de providers
    app.get('/provider-metrics', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { hours?: string }
      const hours = query.hours ? parseInt(query.hours) : 24
      const metrics = await getProviderMetrics(request.user.companyId, hours)
      return reply.send(metrics)
    })

    // Limpar métricas antigas
    app.delete('/provider-metrics/cleanup', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await cleanOldMetrics(request.user.companyId)
      return reply.send(result)
    })

    // ── Heartbeat / Health Status ──
    app.get('/providers/health', { preHandler: [requirePermission('ai_reports:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const providers = await prisma.aIProvider.findMany({
        where: { companyId: request.user.companyId, isActive: true },
        select: {
          id: true, name: true, type: true, model: true,
          healthStatus: true, lastHealthCheckAt: true, lastHealthError: true,
          healthLatencyMs: true, consecutiveErrors: true,
        },
        orderBy: { name: 'asc' },
      })
      return reply.send(providers)
    })

    // ── OpenAPI Import ──
    app.post('/tools/import-openapi', { preHandler: [requirePermission('ai_agents:manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { parseOpenAPISpec } = await import('./tools/openapi-parser.js')
      const { spec } = request.body as { spec: string }
      if (!spec || typeof spec !== 'string') {
        return reply.status(400).send({ error: 'Campo "spec" (string) é obrigatório' })
      }
      if (spec.length > 500_000) {
        return reply.status(400).send({ error: 'Spec muito grande (máximo 500KB)' })
      }
      try {
        const result = parseOpenAPISpec(spec)
        return reply.send(result)
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    })
  })
}
