import { prisma } from '../../config/database.js'
import { AIProviderType, AISessionStatus } from '@prisma/client'
import { createProvider, AIMessage as ProviderMessage } from './providers/index.js'
import { runAgent, runSequentialAgent } from './agent-builder.js'
import { calculateCost } from './cost-calculator.js'
import { io } from '../../server.js'
import { logConversationEvent, getConversationId } from '../conversations/conversation-events.service.js'
import { encrypt, decryptSafe, decryptJSONSafe, type EncryptionContext } from '../../config/encryption.js'
import { recordMetric } from './smart-router.js'
import { summarizeAndSaveMemory, loadMemoryContext } from './memory.service.js'

// ============================================
// Helpers — criptografia de campos sensíveis
// ============================================

function encCtx(companyId: string, field: string, recordId?: string): EncryptionContext {
  return { companyId, model: 'AIProvider', field, recordId }
}

/** Encripta campos sensíveis antes de gravar no banco */
function encryptProviderSecrets(
  data: { apiKey?: string; refreshToken?: string; oauthData?: any },
  companyId: string,
  recordId?: string
) {
  const encrypted: any = {}
  if (data.apiKey) {
    encrypted.apiKey = encrypt(data.apiKey, encCtx(companyId, 'apiKey', recordId))
  }
  if (data.refreshToken) {
    encrypted.refreshToken = encrypt(data.refreshToken, encCtx(companyId, 'refreshToken', recordId))
  }
  if (data.oauthData) {
    encrypted.oauthData = encrypt(data.oauthData, encCtx(companyId, 'oauthData', recordId))
  }
  return encrypted
}

/** Decripta campos sensíveis lidos do banco */
export function decryptProviderSecrets(provider: any): any {
  if (!provider) return provider
  return {
    ...provider,
    apiKey: decryptSafe(provider.apiKey) as string,
    refreshToken: decryptSafe(provider.refreshToken) as string | null,
    oauthData: typeof provider.oauthData === 'string'
      ? decryptJSONSafe(provider.oauthData)
      : provider.oauthData, // legado (já é objeto)
  }
}

// ============================================
// PROVIDERS CRUD
// ============================================

export async function listProviders(companyId: string) {
  return prisma.aIProvider.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      companyId: true,
      name: true,
      type: true,
      model: true,
      baseUrl: true,
      maxTokens: true,
      temperature: true,
      isActive: true,
      isDefault: true,
      enabledModels: true,
      createdAt: true,
      updatedAt: true,
      // NÃO retorna apiKey por segurança
    },
  })
}

export async function getProvider(id: string, companyId: string) {
  return prisma.aIProvider.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      companyId: true,
      name: true,
      type: true,
      model: true,
      baseUrl: true,
      maxTokens: true,
      temperature: true,
      isActive: true,
      isDefault: true,
      enabledModels: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}

export async function createProviderRecord(data: {
  companyId: string
  name: string
  type: AIProviderType
  apiKey: string
  model: string
  enabledModels?: string[]
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  topP?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  isDefault?: boolean
  authType?: string
  refreshToken?: string
  tokenExpiresAt?: Date
  oauthData?: any
}) {
  // Se é default, remover default dos outros
  if (data.isDefault) {
    await prisma.aIProvider.updateMany({
      where: { companyId: data.companyId, isDefault: true },
      data: { isDefault: false },
    })
  }

  return prisma.aIProvider.create({
    data: {
      companyId: data.companyId,
      name: data.name,
      type: data.type,
      authType: data.authType || 'apikey',
      model: data.model,
      enabledModels: data.enabledModels || [data.model],
      baseUrl: data.baseUrl,
      maxTokens: data.maxTokens || 4096,
      temperature: data.temperature || 0.7,
      topP: data.topP ?? null,
      frequencyPenalty: data.frequencyPenalty ?? null,
      presencePenalty: data.presencePenalty ?? null,
      isDefault: data.isDefault || false,
      tokenExpiresAt: data.tokenExpiresAt,
      // ── Campos sensíveis encriptados ──
      ...encryptProviderSecrets(
        { apiKey: data.apiKey, refreshToken: data.refreshToken, oauthData: data.oauthData },
        data.companyId
      ),
    },
  })
}

export async function updateProviderRecord(
  id: string,
  companyId: string,
  data: {
    name?: string
    type?: AIProviderType
    apiKey?: string
    model?: string
    enabledModels?: string[]
    baseUrl?: string | null
    maxTokens?: number
    temperature?: number
    topP?: number | null
    frequencyPenalty?: number | null
    presencePenalty?: number | null
    isActive?: boolean
    isDefault?: boolean
    refreshToken?: string
    tokenExpiresAt?: string | Date
    oauthData?: any
  }
) {
  // Se é default, remover default dos outros
  if (data.isDefault) {
    await prisma.aIProvider.updateMany({
      where: { companyId, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    })
  }

  // Encriptar campos sensíveis se fornecidos no update
  const updateData: any = { ...data }
  if (data.apiKey) {
    updateData.apiKey = encrypt(data.apiKey, encCtx(companyId, 'apiKey', id))
  }
  if (data.refreshToken) {
    updateData.refreshToken = encrypt(data.refreshToken, encCtx(companyId, 'refreshToken', id))
  }
  if (data.oauthData !== undefined && data.oauthData !== null) {
    updateData.oauthData = encrypt(data.oauthData, encCtx(companyId, 'oauthData', id))
  }
  if (data.tokenExpiresAt) {
    updateData.tokenExpiresAt = new Date(data.tokenExpiresAt)
  }

  return prisma.aIProvider.update({
    where: { id },
    data: updateData,
  })
}

export async function deleteProviderRecord(id: string, companyId: string) {
  // Verificar se pertence à empresa (previne IDOR)
  const provider = await prisma.aIProvider.findFirst({
    where: { id, companyId },
    select: { id: true },
  })
  if (!provider) throw new Error('Provider não encontrado')

  // Verificar se tem agentes usando
  const agentCount = await prisma.aIAgent.count({
    where: { providerId: id, companyId },
  })
  if (agentCount > 0) {
    throw new Error(`Não é possível excluir: ${agentCount} agente(s) usam este provider`)
  }

  return prisma.aIProvider.delete({ where: { id } })
}

/**
 * Busca provider com campos sensíveis (apiKey, refreshToken, oauthData) DECRIPTADOS.
 * USO INTERNO APENAS — nunca retornar direto ao frontend.
 */
export async function getProviderWithSecrets(id: string, companyId: string) {
  const provider = await prisma.aIProvider.findFirst({
    where: { id, companyId },
  })
  return provider ? decryptProviderSecrets(provider) : null
}

/**
 * Igual a getProviderWithSecrets, mas para providers OAuth com token de curta duração
 * (GitHub Copilot ~30min) faz refresh automático se o token está expirado ou prestes
 * a expirar (margem de 60s). Persiste o novo token no banco.
 */
export async function getProviderWithFreshToken(id: string, companyId: string) {
  const provider = await getProviderWithSecrets(id, companyId)
  if (!provider) return null

  if (provider.type !== 'GITHUB_COPILOT') return provider

  const oauthData = provider.oauthData as any
  const githubAccessToken = oauthData?.githubAccessToken
  if (!githubAccessToken) return provider

  const expiresAt = provider.tokenExpiresAt ? new Date(provider.tokenExpiresAt as any).getTime() : 0
  const needsRefresh = !oauthData?.copilotToken || expiresAt - Date.now() < 60_000

  if (!needsRefresh) return provider

  try {
    const { refreshCopilotToken } = await import('./oauth.service.js')
    const refreshed = await refreshCopilotToken(githubAccessToken)
    const newOauthData = {
      ...oauthData,
      copilotToken: refreshed.copilotToken,
      copilotEndpoint: refreshed.copilotEndpoint,
    }
    await prisma.aIProvider.update({
      where: { id },
      data: {
        oauthData: encrypt(newOauthData, encCtx(companyId, 'oauthData', id)),
        tokenExpiresAt: refreshed.expiresAt,
      },
    })
    return { ...provider, oauthData: newOauthData, tokenExpiresAt: refreshed.expiresAt }
  } catch (err: any) {
    console.warn(`[Copilot] Auto-refresh falhou para provider ${id}: ${err?.message}`)
    return provider
  }
}

export async function testProvider(id: string, companyId: string) {
  const provider = await prisma.aIProvider.findFirst({
    where: { id, companyId },
  })
  if (!provider) throw new Error('Provider não encontrado')

  const decrypted = decryptProviderSecrets(provider)
  const aiProvider = createProvider(decrypted.type, decrypted.apiKey, decrypted.baseUrl, decrypted.oauthData)
  const result = await aiProvider.chat({
    model: decrypted.model,
    messages: [{ role: 'user', content: 'Diga apenas "OK" para confirmar que está funcionando.' }],
    maxTokens: 50,
    temperature: 0,
  })

  return { success: true, response: result.content, latencyMs: result.latencyMs }
}

// ============================================
// AGENTS CRUD
// ============================================

export async function listAgents(companyId: string) {
  return prisma.aIAgent.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true },
      },
      _count: { select: { sessions: true, messages: true } },
    },
  })
}

export async function getAgent(id: string, companyId: string) {
  return prisma.aIAgent.findFirst({
    where: { id, companyId },
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true, enabledModels: true },
      },
      knowledgeBases: {
        include: {
          knowledgeBase: {
            select: { id: true, name: true, type: true, description: true, isActive: true, embeddingModel: true, totalChunks: true },
          },
        },
      },
      _count: { select: { sessions: true, messages: true } },
    },
  })
}

export async function createAgent(data: {
  companyId: string
  providerId: string
  name: string
  description?: string
  type?: 'LLM' | 'SEQUENTIAL' | 'WORKFLOW'
  systemPrompt: string
  welcomeMessage?: string
  triggerType?: 'KEYWORD' | 'ALL' | 'ADVANCED' | 'NONE'
  triggerOperator?: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX'
  triggerValue?: string
  keywordFinish?: string
  unknownMessage?: string
  delayMessage?: number
  splitMessages?: boolean
  timePerChar?: number
  maxMessageLength?: number
  sessionTimeout?: number
  keepOpen?: boolean
  listeningFromMe?: boolean
  stopBotFromMe?: boolean
  debounceTime?: number
  ignoreJids?: string[]
  isDefault?: boolean
  useCrmContext?: boolean
  useContactInfo?: boolean
  useConversationHistory?: boolean
  contextMessagesLimit?: number
  sessionMessagesLimit?: number
  instanceIds?: string[]
  mcpServerIds?: string[]
  httpTools?: any
  settings?: any
  crmToolsConfig?: any
  followUpEnabled?: boolean
  followUpSteps?: any
  followUpDelay?: number
  followUpMaxAttempts?: number
  followUpInterval?: number
  followUpMode?: string
  followUpPrompt?: string
  followUpMessages?: any
  followUpCloseOnMax?: boolean
  followUpCloseMessage?: string
  followUpEndAction?: string
  followUpEndDelayMinutes?: number
  pauseAutoResumeEnabled?: boolean
  pauseAutoResumeMinutes?: number
  pauseAutoResumeTrigger?: string
  voiceConfig?: any
  sttConfig?: any
  calendarConfig?: any
  stateSchema?: any
  isSubAgent?: boolean
  subAgentDescription?: string | null
  subAgentIds?: string[]
}) {
  // Verificar se provider existe
  const provider = await prisma.aIProvider.findFirst({
    where: { id: data.providerId, companyId: data.companyId },
  })
  if (!provider) throw new Error('Provider não encontrado')

  return prisma.aIAgent.create({
    data: {
      companyId: data.companyId,
      providerId: data.providerId,
      name: data.name,
      description: data.description,
      type: data.type || 'LLM',
      systemPrompt: data.systemPrompt,
      welcomeMessage: data.welcomeMessage,
      triggerType: data.triggerType || 'ALL',
      triggerOperator: data.triggerOperator || 'CONTAINS',
      triggerValue: data.triggerValue,
      keywordFinish: data.keywordFinish || '#sair',
      unknownMessage: data.unknownMessage,
      delayMessage: data.delayMessage || 1000,
      splitMessages: data.splitMessages || false,
      timePerChar: data.timePerChar || 0,
      maxMessageLength: data.maxMessageLength || 4000,
      sessionTimeout: data.sessionTimeout || 30,
      keepOpen: data.keepOpen || false,
      listeningFromMe: data.listeningFromMe || false,
      stopBotFromMe: data.stopBotFromMe ?? true,
      debounceTime: data.debounceTime || 3,
      ignoreJids: data.ignoreJids || [],
      isDefault: data.isDefault || false,
      useCrmContext: data.useCrmContext ?? true,
      useContactInfo: data.useContactInfo ?? true,
      useConversationHistory: data.useConversationHistory ?? true,
      contextMessagesLimit: data.contextMessagesLimit ?? 10,
      sessionMessagesLimit: data.sessionMessagesLimit ?? 50,
      instanceIds: data.instanceIds || [],
      mcpServerIds: data.mcpServerIds || [],
      httpTools: data.httpTools || null,
      settings: data.settings,
      crmToolsConfig: data.crmToolsConfig || null,
      followUpEnabled: data.followUpEnabled || false,
      followUpSteps: data.followUpSteps || null,
      followUpDelay: data.followUpDelay || 5,
      followUpMaxAttempts: data.followUpMaxAttempts || 3,
      followUpInterval: data.followUpInterval || 10,
      followUpMode: data.followUpMode || 'AI_GENERATED',
      followUpPrompt: data.followUpPrompt,
      followUpMessages: data.followUpMessages,
      followUpCloseOnMax: data.followUpCloseOnMax ?? true,
      followUpCloseMessage: data.followUpCloseMessage,
      followUpEndAction: data.followUpEndAction ?? 'CLOSE',
      followUpEndDelayMinutes: data.followUpEndDelayMinutes ?? 0,
      pauseAutoResumeEnabled: data.pauseAutoResumeEnabled ?? false,
      pauseAutoResumeMinutes: data.pauseAutoResumeMinutes ?? 60,
      pauseAutoResumeTrigger: data.pauseAutoResumeTrigger ?? 'PAUSED_AT',
      voiceConfig: data.voiceConfig ?? undefined,
      sttConfig: data.sttConfig ?? undefined,
      calendarConfig: data.calendarConfig ?? undefined,
      stateSchema: data.stateSchema ?? undefined,
      isSubAgent: data.isSubAgent ?? false,
      subAgentDescription: data.subAgentDescription ?? undefined,
      subAgentIds: data.subAgentIds || [],
      status: 'ACTIVE',
    },
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true },
      },
    },
  })
}

export async function updateAgent(
  id: string,
  companyId: string,
  data: Record<string, any>
) {
  const agent = await prisma.aIAgent.findFirst({ where: { id, companyId } })
  if (!agent) throw new Error('Agente não encontrado')

  return prisma.aIAgent.update({
    where: { id },
    data,
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true },
      },
    },
  })
}

export async function deleteAgent(id: string, companyId: string) {
  const agent = await prisma.aIAgent.findFirst({ where: { id, companyId } })
  if (!agent) throw new Error('Agente não encontrado')

  return prisma.aIAgent.delete({ where: { id } })
}

// ============================================
// KNOWLEDGE BASE (legacy helpers — CRUD moved to rag/knowledge.routes.ts)
// ============================================

export async function linkKnowledgeToAgent(agentId: string, knowledgeBaseId: string, companyId: string) {
  const [agent, kb] = await Promise.all([
    prisma.aIAgent.findFirst({ where: { id: agentId, companyId } }),
    prisma.aIKnowledgeBase.findFirst({ where: { id: knowledgeBaseId, companyId } }),
  ])
  if (!agent) throw new Error('Agente não encontrado')
  if (!kb) throw new Error('Knowledge base não encontrada')

  return prisma.aIAgentKnowledge.create({
    data: { agentId, knowledgeBaseId },
  })
}

export async function unlinkKnowledgeFromAgent(agentId: string, knowledgeBaseId: string) {
  return prisma.aIAgentKnowledge.deleteMany({
    where: { agentId, knowledgeBaseId },
  })
}

// ============================================
// SESSIONS
// ============================================

export async function listSessions(companyId: string, filters?: {
  agentId?: string
  status?: AISessionStatus
  instanceId?: string
  page?: number
  limit?: number
}) {
  const page = filters?.page || 1
  const limit = filters?.limit || 50
  const skip = (page - 1) * limit

  const where: any = {
    agent: { companyId },
  }
  if (filters?.agentId) where.agentId = filters.agentId
  if (filters?.status) where.status = filters.status
  if (filters?.instanceId) where.instanceId = filters.instanceId

  const [records, total] = await Promise.all([
    prisma.aISession.findMany({
      where,
      orderBy: { lastActivity: 'desc' },
      skip,
      take: limit,
      include: {
        agent: { select: { id: true, name: true, companyId: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.aISession.count({ where }),
  ])

  // Enrich with contact name and conversation id
  const enriched = await Promise.all(
    records.map(async (session) => {
      const phone = session.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '')
      const [contact, conversation] = await Promise.all([
        prisma.contact.findFirst({
          where: { companyId: session.agent.companyId, phoneNumber: { contains: phone } },
          select: { id: true, name: true, profilePicture: true },
        }),
        prisma.conversation.findFirst({
          where: { instanceId: session.instanceId, remoteJid: session.remoteJid },
          select: { id: true },
        }),
      ])
      return {
        ...session,
        contactName: contact?.name || null,
        contactAvatar: contact?.profilePicture || null,
        contactId: contact?.id || null,
        conversationId: conversation?.id || null,
      }
    })
  )

  return { records: enriched, total, page, limit, totalPages: Math.ceil(total / limit) }
}

export async function getSessionMessages(sessionId: string, companyId: string) {
  const session = await prisma.aISession.findFirst({
    where: { id: sessionId, agent: { companyId } },
    include: { agent: { select: { id: true, name: true } } },
  })
  if (!session) throw new Error('Sessão não encontrada')

  const messages = await prisma.aIMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  })

  return { session, messages }
}

export async function closeSession(sessionId: string, companyId: string) {
  const session = await prisma.aISession.findFirst({
    where: { id: sessionId, agent: { companyId } },
  })
  if (!session) throw new Error('Sessão não encontrada')

  // Sumarizar sessão para memória persistente (fire-and-forget)
  summarizeAndSaveMemory({
    sessionId,
    agentId: session.agentId,
    companyId,
    remoteJid: session.remoteJid,
  }).catch(err => console.warn('[AI] Memory summarize failed:', err.message))

  return prisma.aISession.update({
    where: { id: sessionId },
    data: { status: 'CLOSED', closedAt: new Date() },
  })
}

export async function reopenSession(sessionId: string, companyId: string) {
  const session = await prisma.aISession.findFirst({
    where: { id: sessionId, agent: { companyId } },
  })
  if (!session) throw new Error('Sessão não encontrada')
  if (session.status === 'OPENED') return session

  return prisma.aISession.update({
    where: { id: sessionId },
    data: { status: 'OPENED', closedAt: null, lastActivity: new Date() },
  })
}

export async function deleteSession(sessionId: string, companyId: string) {
  const session = await prisma.aISession.findFirst({
    where: { id: sessionId, agent: { companyId } },
  })
  if (!session) throw new Error('Sessão não encontrada')

  await prisma.aIMessage.deleteMany({ where: { sessionId } })
  return prisma.aISession.delete({ where: { id: sessionId } })
}

// ============================================
// CHAT - Processamento de mensagens
// ============================================

export async function processMessage(params: {
  agentId: string
  instanceId: string
  remoteJid: string
  messageText: string
  companyId: string
  contactName?: string
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>
  imageData?: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
}): Promise<{ reply: string; sessionId: string; tokensUsed: number }> {
  const { agentId, instanceId, remoteJid, companyId, contactName, sendMediaFn, imageData } = params
  // SEC-BLOCO3: Limit message length to prevent token abuse (12K chars ~= 3K tokens)
  const messageText = params.messageText.slice(0, 12000)

  // Buscar agente básico para checar keyword e sessão
  const agent = await prisma.aIAgent.findFirst({
    where: { id: agentId, companyId, status: 'ACTIVE' },
  })

  if (!agent) throw new Error('Agente não encontrado ou inativo')

  // Verificar keyword de encerramento
  if (agent.keywordFinish && messageText.trim().toLowerCase() === agent.keywordFinish.toLowerCase()) {
    // Buscar sessão aberta para sumarizar antes de fechar
    const openSession = await prisma.aISession.findFirst({
      where: { agentId, instanceId, remoteJid, status: 'OPENED' },
    })
    if (openSession) {
      summarizeAndSaveMemory({
        sessionId: openSession.id,
        agentId,
        companyId,
        remoteJid,
      }).catch(err => console.warn('[AI] Memory summarize on keyword close failed:', err.message))
    }

    await prisma.aISession.updateMany({
      where: { agentId, instanceId, remoteJid, status: 'OPENED' },
      data: { status: 'CLOSED', closedAt: new Date() },
    })
    io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'CLOSED', sessionId: null, agentName: agent.name })
    const convIdKeyword = await getConversationId(instanceId, remoteJid)
    if (convIdKeyword) {
      logConversationEvent({
        conversationId: convIdKeyword, instanceId, remoteJid,
        eventType: 'ai_session_ended',
        description: `Sessão da IA "${agent.name}" foi encerrada por palavra-chave`,
        actorType: 'system', actorName: agent.name,
      })
    }
    return { reply: 'Sessão encerrada. Obrigado!', sessionId: '', tokensUsed: 0 }
  }

  // Buscar ou criar sessão
  let session = await prisma.aISession.findUnique({
    where: { agentId_instanceId_remoteJid: { agentId, instanceId, remoteJid } },
  })

  const now = new Date()

  if (session && session.status === 'OPENED') {
    const minutesSinceActivity = (now.getTime() - session.lastActivity.getTime()) / 60000
    if (!agent.keepOpen && minutesSinceActivity > agent.sessionTimeout) {
      // Sumarizar sessão antes de fechar (memória persistente)
      summarizeAndSaveMemory({
        sessionId: session.id,
        agentId,
        companyId,
        remoteJid,
      }).catch(err => console.warn('[AI] Memory summarize on timeout failed:', err.message))

      await prisma.aISession.update({
        where: { id: session.id },
        data: { status: 'CLOSED', closedAt: now },
      })
      io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'CLOSED', sessionId: session.id, agentName: agent.name })
      session = null
    }
  } else if (session && session.status === 'PAUSED') {
    // Sessão pausada: IA não responde até ser retomada manualmente ou pelo auto-resume
    console.log(`[AI] Session ${session.id} is PAUSED for ${remoteJid} — ignoring incoming message`)
    return { reply: '', sessionId: session.id, tokensUsed: 0 }
  } else if (session && session.status !== 'OPENED') {
    session = null
  }

  if (!session) {
    await prisma.aISession.deleteMany({ where: { agentId, instanceId, remoteJid } })
    session = await prisma.aISession.create({
      data: { agentId, instanceId, remoteJid, status: 'OPENED', context: {}, variables: {} },
    })
    io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'OPENED', sessionId: session.id, agentName: agent.name })
    const convId = await getConversationId(instanceId, remoteJid)
    if (convId) {
      logConversationEvent({
        conversationId: convId, instanceId, remoteJid,
        eventType: 'ai_session_started',
        description: `IA "${agent.name}" começou a atender esta conversa`,
        actorType: 'ai', actorName: agent.name,
      })
    }
  }

  // Buscar histórico de mensagens da sessão
  const history = await prisma.aIMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    take: agent.sessionMessagesLimit || 50,
  })

  const historyMessages: ProviderMessage[] = history.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }))

  // ── SESSION AUTO-COMPACTION ──────────────────────────────────────────────
  // Quando o histórico atinge o limite configurado, compacta as mensagens mais
  // antigas em um resumo para economizar tokens e preservar contexto relevante.
  const COMPACT_THRESHOLD = agent.sessionMessagesLimit || 50
  const COMPACT_KEEP_RECENT = Math.min(20, Math.floor(COMPACT_THRESHOLD / 2))
  if (historyMessages.length >= COMPACT_THRESHOLD) {
    try {
      const { getProvider } = await import('./providers/index.js')
      const compactProvider = getProvider(agent as any)
      if (compactProvider) {
        const toCompact = historyMessages.filter(m => m.role !== 'system').slice(0, -COMPACT_KEEP_RECENT)
        const recent = historyMessages.filter(m => m.role !== 'system').slice(-COMPACT_KEEP_RECENT)
        if (toCompact.length > 0) {
          const transcript = toCompact
            .map(m => `[${m.role}] ${(m.content || '').slice(0, 1000)}`)
            .join('\n\n')
            .slice(0, 25_000)
          const compactResult = await compactProvider.chat({
            model: agent.model,
            messages: [{ role: 'user', content: `Você é um compactador de histórico de conversa entre um cliente e um agente de atendimento.\n\nCompacte o transcript abaixo em UM resumo conciso (máximo 15 linhas). REGRAS:\n1. PRESERVE literalmente: nomes, telefones, IDs, pedidos, datas, valores, produtos.\n2. RESUMA: o que o cliente pediu, o que foi resolvido, o que ficou pendente.\n3. NÃO INVENTE informação. Use bullets diretos.\n4. Se houve erro/correção, registre só o resultado FINAL.\n\nTranscript:\n---\n${transcript}\n---\n\nResumo:` }],
            maxTokens: 600,
            temperature: 0.1,
          })
          const summary = (compactResult.content || '').trim()
          if (summary) {
            console.log(`[AI][Compaction] Compactou ${toCompact.length} msgs em ${summary.length} chars (session=${session.id})`)
            historyMessages.splice(
              0,
              historyMessages.length,
              { role: 'system', content: `=== RESUMO DO HISTÓRICO ANTERIOR ===\n\n${summary}\n\n=== FIM DO RESUMO — abaixo seguem as últimas ${recent.length} mensagens completas ===` },
              ...recent,
            )
          }
        }
      }
    } catch (err: any) {
      console.warn('[AI][Compaction] Falhou, usando histórico completo:', err.message)
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // Carregar mensagens PRÉ-SESSÃO da conversa CRM (antes da sessão abrir)
  // Isso dá contexto ao LLM sobre o que foi conversado antes
  const preSessionLimit = agent.contextMessagesLimit || 10
  if (agent.useConversationHistory && preSessionLimit > 0) {
    const conversation = await prisma.conversation.findFirst({
      where: { instanceId, remoteJid },
    })
    if (conversation) {
      const preMessages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          createdAt: { lt: session.startedAt },  // Antes da sessão abrir
        },
        orderBy: { createdAt: 'desc' },
        take: preSessionLimit,
        select: { direction: true, content: true, createdAt: true },
      })
      if (preMessages.length > 0) {
        const preContext = preMessages.reverse().map(m => {
          const dir = m.direction === 'INBOUND' ? 'Cliente' : 'Atendente'
          return `[${dir}]: ${m.content?.substring(0, 300) || ''}`
        }).join('\n')
        historyMessages.unshift({
          role: 'system',
          content: `=== MENSAGENS ANTERIORES (antes desta sessão) ===\n${preContext}\n=== FIM MENSAGENS ANTERIORES ===`,
        })
      }
    }
  }

  // Adicionar contexto CRM ao histórico como mensagem de sistema
  if (agent.useCrmContext) {
    const crmSandboxRaw = (agent as any).crmToolsConfig as Record<string, any> | null | undefined
    const crmContext = await buildCrmContext(companyId, instanceId, remoteJid, crmSandboxRaw)
    if (crmContext) {
      historyMessages.unshift({
        role: 'system',
        content: `=== CONTEXTO CRM ===\n${crmContext}\n=== FIM CONTEXTO CRM ===`,
      })
    }
  }

  // Injetar memória persistente do contato (sessões anteriores)
  try {
    const memoryContext = await loadMemoryContext({ agentId, companyId, remoteJid, currentMessage: messageText })
    if (memoryContext) {
      historyMessages.unshift({
        role: 'system',
        content: memoryContext,
      })
    }
  } catch (err) {
    console.warn('[AI] Failed to load memory context:', (err as Error).message)
  }

  // Executar via Agent Builder (com function calling + tools)
  const context = { companyId, instanceId, remoteJid, contactName }
  let result: { reply: string; tokensUsed: number; promptTokens: number; completionTokens: number; model: string; latencyMs: number; providerId?: string }

  console.log(`[AI] Calling agent builder for agent ${agentId} type=${agent.type}, provider=${agent.providerId}`)

  if (agent.type === 'SEQUENTIAL') {
    const seqResult = await runSequentialAgent({
      agentId, context, messageText,
    })
    result = { ...seqResult, model: 'sequential', latencyMs: 0, promptTokens: 0, completionTokens: seqResult.tokensUsed }
  } else {
    // LLM (padrão) ou WORKFLOW
    result = await runAgent({
      agentId, context, messages: historyMessages, messageText, sessionId: session.id, sendMediaFn, imageData,
    })
  }
  console.log(`[AI] Agent result: reply=${result.reply?.substring(0, 80)}... tokens=${result.tokensUsed} (${result.promptTokens}in+${result.completionTokens}out)`)

  // Calcular custo
  const costUsd = calculateCost(result.model, result.promptTokens, result.completionTokens)

  // Registrar métrica para Smart Routing (fire-and-forget)
  const effectiveProviderId = result.providerId || agent.providerId
  if (effectiveProviderId) {
    recordMetric({
      companyId,
      providerId: effectiveProviderId,
      model: result.model,
      latencyMs: result.latencyMs,
      success: true,
      timeout: false,
      costUsd,
      tokensUsed: result.tokensUsed,
    }).catch(() => {})
  }

  // Salvar mensagens (user + assistant) com custo detalhado
  await prisma.aIMessage.createMany({
    data: [
      { sessionId: session.id, agentId, role: 'user', content: messageText },
      {
        sessionId: session.id,
        agentId,
        role: 'assistant',
        content: result.reply,
        tokensUsed: result.tokensUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd,
        modelUsed: result.model,
        latencyMs: result.latencyMs,
      },
    ],
  })

  // Atualizar sessão com custo acumulado
  const now2 = new Date()
  await prisma.aISession.update({
    where: { id: session.id },
    data: {
      lastActivity: now2,
      messageCount: { increment: 2 },
      tokensUsed:        { increment: result.tokensUsed },
      promptTokens:      { increment: result.promptTokens },
      completionTokens:  { increment: result.completionTokens },
      costUsd:           { increment: costUsd },
      lastMessageRole: 'assistant',
      followUpCount: 0,
      lastFollowUpAt: null,
      followUpStartedAt: now2,
    },
  })

  // Atualizar relatório diário de tokens (upsert)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  try {
    await prisma.aITokenReport.upsert({
      where: {
        companyId_agentId_instanceId_date: {
          companyId,
          agentId: agentId,
          instanceId: instanceId,
          date: today,
        },
      },
      create: {
        companyId,
        agentId,
        instanceId,
        date: today,
        messagesCount: 1,
        sessionsCount: 0,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.tokensUsed,
        costUsd,
        modelBreakdown: [{ model: result.model, tokens: result.tokensUsed, cost: costUsd }],
      },
      update: {
        messagesCount:    { increment: 1 },
        promptTokens:     { increment: result.promptTokens },
        completionTokens: { increment: result.completionTokens },
        totalTokens:      { increment: result.tokensUsed },
        costUsd:          { increment: costUsd },
      },
    })
  } catch (e) {
    // Não bloquear o fluxo principal se o report falhar
    console.error('[AI] Error updating token report:', e)
  }

  return { reply: result.reply, sessionId: session.id, tokensUsed: result.tokensUsed }
}

// ============================================
// CRM Context Builder
// ============================================

async function buildCrmContext(
  companyId: string,
  instanceId: string,
  remoteJid: string,
  sandboxRaw?: Record<string, any> | null
): Promise<string | null> {
  // Resolver sandbox (usa defaults se não configurado)
  const sandbox = resolveCrmSandbox(sandboxRaw)
  const parts: string[] = []

  // Buscar contato
  const phoneNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '')
  const contact = await prisma.contact.findFirst({
    where: { companyId, phoneNumber: { contains: phoneNumber } },
  })

  if (contact) {
    const contactParts: string[] = []
    if (sandbox.read.contact_name) contactParts.push(`Nome: ${contact.name || 'Sem nome'}`)
    if (sandbox.read.contact_phone) contactParts.push(`Telefone: ${contact.phoneNumber}`)
    if (sandbox.read.contact_email && contact.email) contactParts.push(`Email: ${contact.email}`)
    if (sandbox.read.contact_tags && contact.tags.length) contactParts.push(`Tags: ${contact.tags.join(', ')}`)
    if (contactParts.length > 0) parts.push(`Contato: ${contactParts.join(', ')}`)

    // Custom fields do contato (armazenados em metadata)
    if (sandbox.read.custom_fields && contact.metadata) {
      const meta = contact.metadata as Record<string, any>
      const customEntries = Object.entries(meta).filter(([k]) => !['profilePicture', 'pushName'].includes(k))
      if (customEntries.length > 0) {
        parts.push(`Campos personalizados do contato: ${customEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`)
      }
    }
  }

  // Buscar conversa atual
  const conversation = await prisma.conversation.findFirst({
    where: { instanceId, remoteJid },
    include: {
      assignee: { select: { name: true } },
      team: { select: { name: true } },
    },
  })

  if (conversation) {
    const convParts: string[] = []
    if (sandbox.read.conversation_status) convParts.push(`status=${conversation.status}`)
    if (sandbox.read.conversation_priority) convParts.push(`prioridade=${conversation.priority || 'não definida'}`)
    if (convParts.length > 0) parts.push(`Conversa: ${convParts.join(', ')}`)
    if (sandbox.read.conversation_assignee && conversation.assignee) parts.push(`Atendente: ${conversation.assignee.name}`)
    if (sandbox.read.conversation_team && conversation.team) parts.push(`Time: ${conversation.team.name}`)

    // Custom attributes da conversa
    if (sandbox.read.custom_fields && conversation.customAttributes) {
      const attrs = conversation.customAttributes as Record<string, any>
      const entries = Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== '')
      if (entries.length > 0) {
        parts.push(`Campos personalizados da conversa: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`)
      }
    }

    // Listar definições de campos personalizados disponíveis
    if (sandbox.read.custom_fields) {
      const definitions = await prisma.customAttributeDefinition.findMany({
        where: { companyId },
        select: { attributeKey: true, attributeDisplayName: true, attributeDisplayType: true, attributeModel: true, attributeValues: true },
      })
      if (definitions.length > 0) {
        const defLines = definitions.map(d => {
          let line = `- ${d.attributeKey} (${d.attributeDisplayName}, tipo: ${d.attributeDisplayType}, modelo: ${d.attributeModel})`
          if (d.attributeValues) {
            const vals = d.attributeValues as any
            if (Array.isArray(vals) && vals.length > 0) line += ` [valores possíveis: ${vals.join(', ')}]`
          }
          return line
        })
        parts.push(`\nCampos personalizados disponíveis para configurar:\n${defLines.join('\n')}`)
      }
    }

    // Últimas 5 mensagens da conversa
    if (sandbox.read.conversation_history) {
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { direction: true, content: true, createdAt: true, type: true },
      })

      if (recentMessages.length > 0) {
        parts.push('\nÚltimas mensagens da conversa:')
        for (const msg of recentMessages.reverse()) {
          const dir = msg.direction === 'INBOUND' ? 'Cliente' : 'Atendente'
          parts.push(`[${dir}]: ${msg.content.substring(0, 200)}`)
        }
      }
    }

    // Notas privadas do contato (visíveis para IA)
    if (sandbox.read.contact_notes) {
      const notesLimit = sandbox.notesLimit || 10
      const recentNotes = await prisma.message.findMany({
        where: { instanceId, remoteJid, type: 'note' },
        orderBy: { createdAt: 'desc' },
        take: notesLimit,
        include: {
          sentByUser: { select: { name: true } },
          sentByAIAgent: { select: { name: true } },
        },
      })

      if (recentNotes.length > 0) {
        parts.push('\nNotas privadas sobre este contato:')
        for (const note of recentNotes.reverse()) {
          const author = note.sentByAIAgent ? `I.A. ${note.sentByAIAgent.name}` :
            note.sentByUser ? note.sentByUser.name :
            (note.metadata as any)?.authorName || 'Desconhecido'
          const date = note.createdAt.toLocaleDateString('pt-BR')
          parts.push(`[${date} - ${author}]: ${note.content.substring(0, 300)}`)
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null
}

/** Resolve sandbox config para buildCrmContext (mesma lógica do crm.module.ts) */
function resolveCrmSandbox(raw?: Record<string, any> | null) {
  const defaults = {
    sandboxMode: 'CURRENT_ONLY' as const,
    read: {
      contact_name: true, contact_email: true, contact_phone: true, contact_tags: true,
      custom_fields: true,
      conversation_status: true, conversation_assignee: true, conversation_team: true,
      conversation_labels: true, conversation_priority: true, conversation_history: true,
      contact_notes: true,
      teams: true, canned_responses: true,
    },
    write: {
      contact_name: true, contact_email: true, contact_tags: true,
      custom_fields: true,
      conversation_assign: true, conversation_notes: true,
      contact_create: false,
    },
    notesLimit: 10,
    enabledTools: [] as string[],
  }
  if (!raw || typeof raw !== 'object') return defaults
  return {
    sandboxMode: raw.sandboxMode || defaults.sandboxMode,
    read: { ...defaults.read, ...(raw.read || {}) },
    write: { ...defaults.write, ...(raw.write || {}) },
    notesLimit: typeof raw.notesLimit === 'number' ? raw.notesLimit : defaults.notesLimit,
    enabledTools: raw.enabledTools || defaults.enabledTools,
  }
}

// ============================================
// STATISTICS
// ============================================

export async function getAIStats(companyId: string) {
  const [
    totalAgents,
    activeAgents,
    totalSessions,
    openSessions,
    totalMessages,
    totalProviders,
  ] = await Promise.all([
    prisma.aIAgent.count({ where: { companyId } }),
    prisma.aIAgent.count({ where: { companyId, status: 'ACTIVE' } }),
    prisma.aISession.count({ where: { agent: { companyId } } }),
    prisma.aISession.count({ where: { agent: { companyId }, status: 'OPENED' } }),
    prisma.aIMessage.count({ where: { agent: { companyId } } }),
    prisma.aIProvider.count({ where: { companyId } }),
  ])

  // Tokens usados nas últimas 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentMessages = await prisma.aIMessage.findMany({
    where: {
      agent: { companyId },
      role: 'assistant',
      createdAt: { gte: oneDayAgo },
    },
    select: { tokensUsed: true },
  })
  const tokensLast24h = recentMessages.reduce((sum, m) => sum + (m.tokensUsed || 0), 0)

  return {
    totalAgents,
    activeAgents,
    totalSessions,
    openSessions,
    totalMessages,
    totalProviders,
    tokensLast24h,
  }
}
