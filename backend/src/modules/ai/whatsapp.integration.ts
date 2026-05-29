import { prisma } from '../../config/database.js'
import { io } from '../../server.js'
import { processMessage } from './ai.service.js'
import { logConversationEvent, getConversationId } from '../conversations/conversation-events.service.js'
import { parseInteractiveBlock, interactiveToText, type InteractiveMessage } from '../messages/interactive-messages.js'
import { isAgentAllowedNow } from './schedule.service.js'
import { shouldSpeakReply, synthesizeReply, transcribeAudio, type VoiceConfig, type SttConfig } from './voice-runtime.js'

interface IncomingMessage {
  instanceId: string
  remoteJid: string
  content: string
  type: string
  pushName?: string
  fromMe?: boolean // Para listeningFromMe e stopBotFromMe
  audio?: Buffer | string // payload de audio bruto (para STT)
  imageData?: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
}

// Cache de debounce para agrupar mensagens rápidas (key = instanceId:remoteJid).
// Contém:
//  - timer: timeout que vai disparar processAndReply com tudo agrupado
//  - messages: lista de mensagens recebidas dentro da janela atual
//  - processing: true quando a IA está efetivamente processando o batch atual.
//                Enquanto true, novas mensagens entram em `pending` em vez de
//                abrir uma nova janela paralela.
//  - pending: mensagens recebidas durante o processamento; ao terminar, abre
//             nova janela de debounce com elas.
//  - lastAgentSnapshot: snapshot do agent usado neste batch (preserva config
//                       caso o agent mude no meio do fluxo).
const debounceCache = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout> | null
    messages: string[]
    processing: boolean
    pending: string[]
    debounceMs: number
    fire: () => void
  }
>()

// Cache de cooldown para mensagem de "fora do horario" do schedule (30min por contato)
const scheduleOffSentCache = new Map<string, number>()

/**
 * Processa mensagem recebida via WhatsApp para verificar se deve ser respondida por IA.
 * Implementa fluxo completo: ignoreJids, fromMe handling, trigger matching, debounce,
 * session management, split messages (por parágrafos como evolution-api), timePerChar delay.
 *
 * Baseado nos padrões de:
 * - Evolution API (base-chatbot.service.ts): sessões, split por \n\n, timePerChar, ignoreJids
 * - Evo AI (agent_builder.py): variáveis temporais, role/goal
 * - Impa AI (bot types): debounce, splitMessage, gatilho com operador, isDefault
 */
export async function handleIncomingForAI(
  msg: IncomingMessage,
  sendMessageFn: (to: string, content: string, aiAgentId?: string) => Promise<void>,
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>,
  sendInteractiveFn?: (to: string, msg: InteractiveMessage, aiAgentId?: string) => Promise<void>,
  sendAudioBufferFn?: (to: string, audio: Buffer, mimeType: string, aiAgentId?: string) => Promise<void>
): Promise<boolean> {
  const { instanceId, remoteJid, content, type, pushName, fromMe, audio } = msg

  let workingContent = content
  let workingType = type

  // ── STT: se a mensagem eh audio e ha sttConfig disponivel, transcrever ──
  const isAudioType = type === 'audio' || type === 'audioMessage' || type === 'ptt'
  if (isAudioType && audio) {
    try {
      // Buscar sttConfig: prioridade agent > instance
      const inst = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { companyId: true, sttConfig: true },
      })
      // Procurar primeiro agente com sttConfig na empresa para usar
      let sttConfig: SttConfig | null = null
      if (inst) {
        const agentWithStt = await prisma.aIAgent.findFirst({
          where: { companyId: inst.companyId, status: 'ACTIVE', sttConfig: { not: undefined } as any },
          select: { sttConfig: true },
        })
        const candidateAgentStt = agentWithStt?.sttConfig as any
        const candidateInstStt = inst.sttConfig as any
        if (candidateAgentStt && typeof candidateAgentStt === 'object' && candidateAgentStt.integrationId) {
          sttConfig = candidateAgentStt as SttConfig
        } else if (candidateInstStt && typeof candidateInstStt === 'object' && candidateInstStt.integrationId) {
          sttConfig = candidateInstStt as SttConfig
        }
      }
      if (sttConfig && inst) {
        const audioBuffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio as any, 'base64')
        const transcript = await transcribeAudio({
          audio: audioBuffer,
          contentType: type === 'ptt' ? 'audio/ogg' : 'audio/ogg',
          sttConfig,
          companyId: inst.companyId,
        })
        if (transcript.text) {
          console.log(`[AI STT] Transcribed audio (${transcript.text.length} chars)`)
          workingContent = transcript.text
          workingType = 'text'
        } else {
          console.warn('[AI STT] Transcription returned empty text')
          return false
        }
      } else {
        return false
      }
    } catch (err: any) {
      console.error('[AI STT] Failed to transcribe audio:', err.message)
      return false
    }
  }

  // Apenas texto (ou imagem com vision) a partir daqui
  const isImageWithVision = (workingType === 'image' || workingType === 'imageMessage') && !!(msg as any).imageData
  // Documento com texto extraído (inicia com "[Documento:") também pode ser processado
  const isDocumentWithText = workingType === 'document' && workingContent.startsWith('[Documento')
  if (workingType !== 'text' && workingType !== 'conversation' && workingType !== 'extendedTextMessage' && !isImageWithVision && !isDocumentWithText) {
    return false
  }

  // Para imagens sem legenda, usar texto padrão que instrui o LLM
  if (isImageWithVision && !workingContent) {
    workingContent = '[Imagem recebida — descreva o conteúdo desta imagem e responda de forma útil]'
  }

  // Reatribuir para uso abaixo
  ;(msg as any).content = workingContent
  // alias para uso interno (substitui o `content` original)
  const effectiveContent = workingContent

  // ========================================================================
  // FILTRO GLOBAL: Canais (@newsletter) e Status (@broadcast) NUNCA recebem IA
  // Isso é independente de qualquer configuração do agente
  // ========================================================================
  if (remoteJid.includes('@newsletter') || remoteJid.includes('@broadcast')) {
    return false
  }

  // Buscar instância para obter companyId
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { id: true, companyId: true },
  })
  if (!instance) return false

  // Buscar agentes ativos para esta instância/empresa
  const agents = await prisma.aIAgent.findMany({
    where: {
      companyId: instance.companyId,
      status: 'ACTIVE',
    },
  })

  if (agents.length === 0) return false

  // ========================================================================
  // BLOQUEIO ABSOLUTO: se existe QUALQUER sessão PAUSED para este remoteJid
  // nesta instância, a IA NUNCA responde automaticamente. Só sai de PAUSED
  // por: (1) despausa manual no painel, (2) fechamento da conversa,
  // (3) exclusão da sessão. Mensagens fromMe também não devem reabrir.
  // ========================================================================
  const pausedSession = await prisma.aISession.findFirst({
    where: {
      instanceId,
      remoteJid,
      status: 'PAUSED',
      agent: { companyId: instance.companyId },
    },
    select: { id: true },
  })
  if (pausedSession) {
    return false
  }

  // ========================================================================
  // BLOQUEIO ABSOLUTO 2: flag aiPaused na própria Conversation. Persistente
  // mesmo SEM nenhuma AISession criada. Usado quando o atendente humano
  // inicia a conversa pelo CRM ou pausa manualmente pelo painel.
  //
  // IMPORTANTE: usa o índice unique (instanceId, remoteJid) — não filtramos
  // por companyId aqui pra evitar que qualquer divergência de tenant derrube
  // o bloqueio. Como (instanceId, remoteJid) é unique e a instance pertence
  // a uma única companyId, não há risco de cross-tenant.
  // ========================================================================
  const pausedConv = await prisma.conversation.findUnique({
    where: { instanceId_remoteJid: { instanceId, remoteJid } },
    select: { id: true, aiPaused: true, aiPausedReason: true },
  })
  if (pausedConv?.aiPaused) {
    console.log(`[AI] BLOCKED by conversation.aiPaused=true | instance=${instanceId} remoteJid=${remoteJid} reason=${pausedConv.aiPausedReason || 'manual'}`)
    return false
  }

  // ========================================================================
  // PASSO 1: Verificar se já existe sessão ABERTA para este remoteJid.
  // Se sim, usar o agente da sessão existente (sem verificar trigger).
  // Isso é essencial: o trigger só serve para ABRIR a sessão, não para 
  // cada mensagem subsequente. (Padrão evolution-api base-chatbot.service)
  // ========================================================================
  let agent: any = null
  let hasExistingSession = false

  const existingOpenSession = await prisma.aISession.findFirst({
    where: {
      instanceId,
      remoteJid,
      status: 'OPENED',
      agent: { companyId: instance.companyId, status: 'ACTIVE' },
    },
    include: { agent: true },
  })

  if (existingOpenSession) {
    // Verificar se a sessão não expirou
    const minutesSinceActivity = (Date.now() - existingOpenSession.lastActivity.getTime()) / 60000
    if (!existingOpenSession.agent.keepOpen && minutesSinceActivity > existingOpenSession.agent.sessionTimeout) {
      // Sessão expirou - fechar e buscar novo agente por trigger
      await prisma.aISession.update({
        where: { id: existingOpenSession.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      })
      io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'CLOSED', sessionId: existingOpenSession.id, agentName: existingOpenSession.agent.name })
    } else {
      // Verificar que o agente da sessão está vinculado a esta instância
      const agentInstanceIds = existingOpenSession.agent.instanceIds || []
      if (agentInstanceIds.length === 0 || agentInstanceIds.includes(instanceId)) {
        // Sessão ativa - usar o agente vinculado (sem verificar trigger!)
        agent = existingOpenSession.agent
        hasExistingSession = true
      } else {
        // Agente não pertence mais a esta instância - fechar sessão
        await prisma.aISession.update({
          where: { id: existingOpenSession.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        })
        io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'CLOSED', sessionId: existingOpenSession.id, agentName: existingOpenSession.agent.name })
      }
    }
  }

  // ========================================================================
  // PASSO 2: Se não tem sessão aberta, verificar triggers para abrir nova
  // ========================================================================
  if (!agent) {
    agent = findMatchingAgent(agents, effectiveContent, instanceId)
    if (!agent) return false
  }

  // Verificar se o agente está vinculado a esta instância específica
  if (agent.instanceIds.length > 0 && !agent.instanceIds.includes(instanceId)) {
    return false
  }

  // Verificar ignoreGroups — se ativado, ignorar todas as mensagens de grupos (@g.us)
  if (agent.ignoreGroups && remoteJid.includes('@g.us')) {
    return false
  }

  // Verificar allowJids — se preenchido, SOMENTE esses JIDs/padrões são atendidos
  if (agent.allowJids && agent.allowJids.length > 0) {
    const isAllowed = agent.allowJids.some((pattern: string) => {
      const cleaned = pattern.trim()
      if (!cleaned) return false
      return remoteJid.includes(cleaned)
    })
    if (!isAllowed) return false
  }

  // Verificar ignoreJids — para filtros granulares (JIDs específicos)
  if (agent.ignoreJids && agent.ignoreJids.length > 0) {
    const shouldIgnore = agent.ignoreJids.some((pattern: string) => {
      const cleaned = pattern.trim()
      if (!cleaned) return false
      return remoteJid.includes(cleaned)
    })
    if (shouldIgnore) return false
  }

  // Verificar agendamento (scheduleMode) — horario comercial / fora / custom / sempre
  const scheduleCheck = await isAgentAllowedNow(agent, instanceId)
  if (!scheduleCheck.allowed) {
    // Envia mensagem de fora do horario uma unica vez por sessao (cooldown leve)
    if (agent.scheduleOffMessage && sendMessageFn && !fromMe) {
      const cooldownKey = `sched:${agent.id}:${instanceId}:${remoteJid}`
      const last = scheduleOffSentCache.get(cooldownKey) || 0
      const now = Date.now()
      if (now - last > 30 * 60 * 1000) {
        scheduleOffSentCache.set(cooldownKey, now)
        try {
          await sendMessageFn(remoteJid, agent.scheduleOffMessage, agent.id)
        } catch (e) {
          console.warn('[AI Schedule] failed to send offMessage:', (e as Error).message)
        }
      }
    }
    return false
  }

  // Verificar mensagens fromMe
  if (fromMe) {
    // stopBotFromMe: se eu envio mensagem, pausar a sessão do bot
    if (agent.stopBotFromMe) {
      if (existingOpenSession && existingOpenSession.status === 'OPENED') {
        await prisma.aISession.update({
          where: { id: existingOpenSession.id },
          data: { status: 'PAUSED' },
        })
        io?.to(`instance:${instanceId}`).emit('ai-session-update', { instanceId, remoteJid, status: 'PAUSED', sessionId: existingOpenSession.id, agentName: agent.name })
      }
      return false
    }
    // listeningFromMe: escutar mensagens que eu mesmo envio
    if (!agent.listeningFromMe) {
      return false
    }
  }

  // ============================================================
  // DEBOUNCE com processing-lock e fila pending.
  // Key SEM agent.id: agrupa por conversa (instance+remoteJid)
  // pra não quebrar caso o agent resolvido mude entre mensagens.
  // ============================================================
  const cacheKey = `${instanceId}:${remoteJid}`
  const debounceSec = typeof agent.debounceTime === 'number' ? agent.debounceTime : 3
  const debounceMs = Math.max(0, debounceSec) * 1000
  const existing = debounceCache.get(cacheKey)

  // Caso 1: já existe entrada para esta conversa
  if (existing) {
    if (existing.processing) {
      // IA está respondendo agora — enfileira pra próxima janela
      existing.pending.push(effectiveContent)
      console.log(`[AI][Debounce] queued (processing) ${cacheKey} | pending=${existing.pending.length} | content="${effectiveContent.slice(0, 60)}"`)
      return true
    }
    // Janela de debounce ainda aberta — acumula e RESETA o timer
    existing.messages.push(effectiveContent)
    if (existing.timer) clearTimeout(existing.timer)
    existing.timer = setTimeout(existing.fire, debounceMs)
    console.log(`[AI][Debounce] coalesce ${cacheKey} | total=${existing.messages.length} | wait=${debounceSec}s`)
    return true
  }

  // Caso 2: sem debounce configurado — processa direto
  if (debounceMs === 0) {
    await processAndReply(agent, instanceId, remoteJid, effectiveContent, instance.companyId, pushName, sendMessageFn, sendMediaFn, sendInteractiveFn, sendAudioBufferFn, workingType, msg.imageData)
    return true
  }

  // Caso 3: nova janela de debounce
  const entry: NonNullable<ReturnType<typeof debounceCache.get>> = {
    timer: null,
    messages: [effectiveContent],
    processing: false,
    pending: [],
    debounceMs,
    fire: () => {},
  }

  // `fire` precisa do entry já criado para se referenciar (closure)
  entry.fire = async () => {
    entry.timer = null
    if (entry.messages.length === 0) {
      debounceCache.delete(cacheKey)
      return
    }
    const batch = entry.messages.slice()
    entry.messages = []
    entry.processing = true
    const combined = batch.join('\n')
    console.log(`[AI][Debounce] FIRE ${cacheKey} | batch=${batch.length} msgs | combined.len=${combined.length}`)
    try {
      await processAndReply(agent, instanceId, remoteJid, combined, instance.companyId, pushName, sendMessageFn, sendMediaFn, sendInteractiveFn, sendAudioBufferFn, workingType, msg.imageData)
    } catch (e) {
      console.error(`[AI][Debounce] processAndReply threw for ${cacheKey}:`, (e as Error).message)
    } finally {
      entry.processing = false
      // Se chegaram mensagens enquanto processava, abre nova janela com elas
      if (entry.pending.length > 0) {
        entry.messages = entry.pending
        entry.pending = []
        console.log(`[AI][Debounce] drain pending ${cacheKey} | ${entry.messages.length} msgs | wait=${debounceSec}s`)
        entry.timer = setTimeout(entry.fire, entry.debounceMs)
      } else {
        debounceCache.delete(cacheKey)
      }
    }
  }

  entry.timer = setTimeout(entry.fire, debounceMs)
  debounceCache.set(cacheKey, entry)
  console.log(`[AI][Debounce] start window ${cacheKey} | wait=${debounceSec}s | content="${effectiveContent.slice(0, 60)}"`)
  return true
}

/**
 * Encontra o agente correto para a mensagem, usando triggerType + triggerOperator.
 * Prioridade: isDefault específico da instância > KEYWORD > ADVANCED > ALL > isDefault geral
 *
 * triggerOperator (como evolution-api + impa-ai):
 * - CONTAINS: mensagem contém o valor
 * - EQUALS: mensagem é exatamente igual ao valor
 * - STARTS_WITH: mensagem começa com o valor
 * - ENDS_WITH: mensagem termina com o valor
 * - REGEX: expressão regular
 */
function findMatchingAgent(
  agents: any[],
  messageText: string,
  instanceId: string
): any | null {
  const normalizedMsg = messageText.toLowerCase().trim()

  // 1. KEYWORD match com operador
  for (const agent of agents) {
    if (agent.triggerType === 'KEYWORD' && agent.triggerValue) {
      if (!matchesInstance(agent, instanceId)) continue

      const keywords = agent.triggerValue.split(',').map((k: string) => k.trim().toLowerCase())
      const operator = agent.triggerOperator || 'CONTAINS'

      const matched = keywords.some((kw: string) => {
        if (!kw) return false
        switch (operator) {
          case 'EQUALS':
            return normalizedMsg === kw
          case 'STARTS_WITH':
            return normalizedMsg.startsWith(kw)
          case 'ENDS_WITH':
            return normalizedMsg.endsWith(kw)
          case 'REGEX':
            try { return new RegExp(kw, 'i').test(messageText) } catch { return false }
          case 'CONTAINS':
          default:
            return normalizedMsg.includes(kw)
        }
      })

      if (matched) return agent
    }
  }

  // 2. ADVANCED (regex puro, como antes)
  for (const agent of agents) {
    if (agent.triggerType === 'ADVANCED' && agent.triggerValue) {
      if (!matchesInstance(agent, instanceId)) continue
      try {
        const regex = new RegExp(agent.triggerValue, 'i')
        if (regex.test(messageText)) return agent
      } catch {
        // Regex inválida, ignorar
      }
    }
  }

  // 3. ALL
  for (const agent of agents) {
    if (agent.triggerType === 'ALL') {
      if (matchesInstance(agent, instanceId)) return agent
    }
  }

  // 4. isDefault - agente padrão (como impa-ai bot.padrao)
  const defaultAgent = agents.find(a =>
    a.isDefault && a.triggerType !== 'NONE' && matchesInstance(a, instanceId)
  )
  if (defaultAgent) return defaultAgent

  return null
}

function matchesInstance(agent: any, instanceId: string): boolean {
  return agent.instanceIds.length === 0 || agent.instanceIds.includes(instanceId)
}

/**
 * Recheck se a IA foi pausada para esta conversa.
 * Chamado IMEDIATAMENTE antes de cada envio (texto/midia/interactive/audio)
 * para garantir que cliques em "pausar IA" feitos durante o processamento
 * cancelem o envio — não apenas o recebimento.
 */
async function isAISendBlocked(instanceId: string, remoteJid: string): Promise<boolean> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { instanceId_remoteJid: { instanceId, remoteJid } },
      select: { aiPaused: true },
    })
    if (conv?.aiPaused) return true

    const pausedSession = await prisma.aISession.findFirst({
      where: { instanceId, remoteJid, status: 'PAUSED' },
      select: { id: true },
    })
    return !!pausedSession
  } catch (err: any) {
    console.warn(`[AI] isAISendBlocked check failed: ${err.message}`)
    return false
  }
}

/**
 * Sentinel error: lançado por wrappers de envio quando a IA foi pausada
 * durante o processamento. Capturado no nível de `processAndReply` para
 * abortar silenciosamente o restante da resposta.
 */
class AIPausedDuringSendError extends Error {
  constructor() {
    super('AI paused during send — aborting remaining replies')
    this.name = 'AIPausedDuringSendError'
  }
}

/**
 * Processa a mensagem com IA e envia resposta.
 * Implementa:
 * - Delay antes de responder (delayMessage)
 * - Split por parágrafos (\n\n) como evolution-api
 * - timePerChar delay entre partes split (como evolution-api base-chatbot.service)
 * - Fallback de maxMessageLength para mensagens muito longas
 * - RECHECK aiPaused antes de cada envio (cancela mid-flow se atendente pausa)
 */
async function processAndReply(
  agent: any,
  instanceId: string,
  remoteJid: string,
  messageText: string,
  companyId: string,
  pushName: string | undefined,
  sendMessageFn: (to: string, content: string, aiAgentId?: string) => Promise<void>,
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>,
  sendInteractiveFn?: (to: string, msg: InteractiveMessage, aiAgentId?: string) => Promise<void>,
  sendAudioBufferFn?: (to: string, audio: Buffer, mimeType: string, aiAgentId?: string) => Promise<void>,
  incomingType?: string,
  imageData?: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
) {
  try {
    console.log(`[AI] processAndReply called for ${remoteJid} with agent ${agent.id} (${agent.name})`)

    // ── GUARDS DE PAUSA — wrappam todos os senders ──
    // Antes de QUALQUER envio, recheca se a Conversation foi pausada (pelo
    // atendente clicando "pausar IA" enquanto o LLM processava). Se sim,
    // cancela o restante da resposta lançando AIPausedDuringSendError —
    // capturado no catch externo deste try.
    const guardedSendMessage: typeof sendMessageFn = async (to, text, aiAgentId) => {
      if (await isAISendBlocked(instanceId, remoteJid)) {
        console.log(`[AI] Send BLOCKED mid-flow (text) — conversation paused | ${instanceId} ${remoteJid}`)
        throw new AIPausedDuringSendError()
      }
      return sendMessageFn(to, text, aiAgentId)
    }
    const guardedSendMedia: typeof sendMediaFn = sendMediaFn
      ? async (to, mediaType, mediaUrl, caption, fileName) => {
          if (await isAISendBlocked(instanceId, remoteJid)) {
            console.log(`[AI] Send BLOCKED mid-flow (media) — conversation paused | ${instanceId} ${remoteJid}`)
            throw new AIPausedDuringSendError()
          }
          return sendMediaFn(to, mediaType, mediaUrl, caption, fileName)
        }
      : undefined
    const guardedSendInteractive: typeof sendInteractiveFn = sendInteractiveFn
      ? async (to, m, aiAgentId) => {
          if (await isAISendBlocked(instanceId, remoteJid)) {
            console.log(`[AI] Send BLOCKED mid-flow (interactive) — conversation paused | ${instanceId} ${remoteJid}`)
            throw new AIPausedDuringSendError()
          }
          return sendInteractiveFn(to, m, aiAgentId)
        }
      : undefined
    const guardedSendAudio: typeof sendAudioBufferFn = sendAudioBufferFn
      ? async (to, audio, mimeType, aiAgentId) => {
          if (await isAISendBlocked(instanceId, remoteJid)) {
            console.log(`[AI] Send BLOCKED mid-flow (audio) — conversation paused | ${instanceId} ${remoteJid}`)
            throw new AIPausedDuringSendError()
          }
          return sendAudioBufferFn(to, audio, mimeType, aiAgentId)
        }
      : undefined

    const result = await processMessage({
      agentId: agent.id,
      instanceId,
      remoteJid,
      messageText,
      companyId,
      contactName: pushName,
      sendMediaFn: guardedSendMedia,
      imageData,

    })
    console.log(`[AI] processMessage returned: reply=${result.reply ? result.reply.substring(0, 50) + '...' : 'EMPTY'}, tokens=${result.tokensUsed}`)

    if (!result.reply) return

    // Recheck explícito antes de iniciar o envio da resposta principal
    if (await isAISendBlocked(instanceId, remoteJid)) {
      console.log(`[AI] Aborting reply — conversation paused before send | ${instanceId} ${remoteJid}`)
      return
    }

    // Delay antes de responder (ms)
    if (agent.delayMessage > 0) {
      await new Promise(resolve => setTimeout(resolve, agent.delayMessage))
    }

    // ── TTS: se voiceConfig do agente decide enviar audio ──
    const voiceConfig = (agent as any).voiceConfig as VoiceConfig | null | undefined
    if (
      voiceConfig &&
      voiceConfig.integrationId &&
      guardedSendAudio &&
      shouldSpeakReply(voiceConfig, incomingType)
    ) {
      try {
        const audio = await synthesizeReply({
          text: result.reply,
          voiceConfig,
          companyId,
        })
        await guardedSendAudio(remoteJid, audio.buffer, audio.mimeType, agent.id)
        console.log(`[AI TTS] Sent audio reply (${audio.buffer.length} bytes) to ${remoteJid}`)
        return
      } catch (err: any) {
        if (err instanceof AIPausedDuringSendError) throw err
        console.error(`[AI TTS] Failed to synthesize, falling back to text:`, err.message)
      }
    }

    // Enviar resposta com split inteligente (texto)
    await sendSplitMessages(
      result.reply,
      remoteJid,
      agent.splitMessages,
      agent.timePerChar || 0,
      agent.maxMessageLength || 4000,
      guardedSendMessage,
      agent.id,
      guardedSendMedia,
      guardedSendInteractive
    )
  } catch (error: any) {
    if (error instanceof AIPausedDuringSendError) {
      // Não é erro de fato — atendente pausou IA durante o envio. Aborta silenciosamente.
      return
    }
    const errorMsg = error?.message || String(error)
    console.error(`[AI] ❌ Error processing message for ${remoteJid}:`, errorMsg)

    // Salvar erro na sessão para visibilidade no painel
    try {
      const session = await prisma.aISession.findFirst({
        where: { agentId: agent.id, instanceId, remoteJid, status: 'OPENED' },
      })
      if (session) {
        await prisma.aIMessage.create({
          data: {
            sessionId: session.id,
            agentId: agent.id,
            role: 'system',
            content: `⚠️ Erro ao processar: ${errorMsg}`,
            metadata: { error: true, errorMessage: errorMsg },
          },
        })
        await prisma.aISession.update({
          where: { id: session.id },
          data: { lastActivity: new Date(), messageCount: { increment: 1 } },
        })
      }
    } catch (saveErr) {
      console.error('[AI] Failed to save error to session:', saveErr)
    }
  }
}

/**
 * Valida se a URL é válida e acessível para envio de mídia.
 * Verifica formato, protocolo HTTPS/HTTP e estrutura básica.
 */
function isValidMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Apenas http e https permitidos
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    // Deve ter hostname válido (não localhost, não IP privado em produção)
    if (!parsed.hostname || parsed.hostname === 'localhost') return false
    // Deve ter ao menos um ponto no hostname (domínio válido) ou ser IP
    if (!parsed.hostname.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Detecta tipo de mídia pela extensão da URL + heurísticas no path/hostname
 */
function detectMediaType(url: string): 'image' | 'video' | 'audio' | 'document' {
  const cleanUrl = url.split(/[?#]/)[0].toLowerCase()
  const ext = cleanUrl.split('.').pop() || ''

  // Detecção por extensão (mais confiável)
  if (/^(jpe?g|png|gif|webp|svg|bmp|tiff?)$/.test(ext)) return 'image'
  if (/^(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp)$/.test(ext)) return 'video'
  if (/^(mp3|ogg|opus|wav|m4a|aac|flac|wma|amr)$/.test(ext)) return 'audio'
  if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|zip|rar|7z)$/.test(ext)) return 'document'

  // Heurísticas por conteúdo da URL (quando extensão não é conclusiva)
  const urlLower = url.toLowerCase()
  if (urlLower.includes('/image') || urlLower.includes('/photo') || urlLower.includes('/img')) return 'image'
  if (urlLower.includes('/video') || urlLower.includes('/stream')) return 'video'
  if (urlLower.includes('/audio') || urlLower.includes('/voice') || urlLower.includes('/recording')) return 'audio'

  return 'document'
}

/** Regex para markdown mídia: apenas ![caption](url) — exige ! para não confundir com links normais [texto](url) */
const MARKDOWN_MEDIA_REGEX = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/

/** Regex para links markdown inline: [texto](url) — NÃO captura ![caption](url) que é mídia */
const MARKDOWN_LINK_REGEX = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g

/**
 * Converte markdown de links para texto plano compatível com WhatsApp.
 * [texto](url) → "texto: url" (se texto ≠ url) ou apenas "url"
 * WhatsApp não renderiza markdown de links, então precisa ser texto puro.
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(MARKDOWN_LINK_REGEX, (_match, label: string, url: string) => {
    const trimmedLabel = label.trim()
    // Se o label é igual à URL ou é genérico, só mostra a URL
    if (trimmedLabel === url || trimmedLabel.toLowerCase() === 'link' || trimmedLabel.toLowerCase() === 'clique aqui') {
      return url
    }
    return `${trimmedLabel}: ${url}`
  })
}

/**
 * Envia mensagem com split inteligente baseado na evolution-api + detecção de markdown mídia + mensagens interativas:
 * 1. Se splitMessages=true: divide por \n\n (parágrafos) como evolution-api
 * 2. Cada parte é verificada: se for ![caption](url), envia como mídia
 * 3. Se for :::interactive block, envia como mensagem interativa
 * 4. Cada parte tem delay calculado por timePerChar (min 1s, max 20s)
 * 5. Se mensagem > maxMessageLength: divide em chunks inteligentes
 */
async function sendSplitMessages(
  message: string,
  remoteJid: string,
  splitMessages: boolean,
  timePerChar: number,
  maxMessageLength: number,
  sendMessageFn: (to: string, content: string, aiAgentId?: string) => Promise<void>,
  aiAgentId?: string,
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>,
  sendInteractiveFn?: (to: string, msg: InteractiveMessage, aiAgentId?: string) => Promise<void>
) {
  // ── Pré-processamento: extrair blocos :::interactive completos (podem ter \n\n internos) ──
  const INTERACTIVE_FULL_REGEX = /:::interactive\s*\n([\s\S]+?)\n\s*:::/g
  const interactiveBlocks: Array<{ start: number; end: number; json: string }> = []
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = INTERACTIVE_FULL_REGEX.exec(message)) !== null) {
    interactiveBlocks.push({ start: blockMatch.index, end: blockMatch.index + blockMatch[0].length, json: blockMatch[1].trim() })
  }

  // Se há blocos interativos, separar texto e interativos
  if (interactiveBlocks.length > 0) {
    let cursor = 0
    const segments: Array<{ type: 'text'; content: string } | { type: 'interactive'; json: string }> = []

    for (const block of interactiveBlocks) {
      // Texto antes do bloco
      if (block.start > cursor) {
        const textBefore = message.slice(cursor, block.start).trim()
        if (textBefore) segments.push({ type: 'text', content: textBefore })
      }
      segments.push({ type: 'interactive', json: block.json })
      cursor = block.end
    }
    // Texto depois do último bloco
    if (cursor < message.length) {
      const textAfter = message.slice(cursor).trim()
      if (textAfter) segments.push({ type: 'text', content: textAfter })
    }

    for (const seg of segments) {
      if (seg.type === 'interactive') {
        try {
          const parsed = JSON.parse(seg.json)
          const interactiveMsg = parsed as InteractiveMessage

          if (sendInteractiveFn) {
            if (timePerChar > 0) {
              await new Promise(resolve => setTimeout(resolve, Math.min(2000, 5000)))
            }
            await sendInteractiveFn(remoteJid, interactiveMsg, aiAgentId)
            console.log(`[AI] Sent interactive ${interactiveMsg.type} to ${remoteJid}`)
          } else {
            // Fallback: converter para texto
            const fallbackText = interactiveToText(interactiveMsg)
            await sendWithDelay(fallbackText, remoteJid, timePerChar, sendMessageFn, aiAgentId)
            console.log(`[AI] Sent interactive ${interactiveMsg.type} as text fallback to ${remoteJid}`)
          }
        } catch (err: any) {
          console.warn(`[AI] Failed to parse/send interactive block, sending as text:`, err.message)
          // Se falhar parse, enviar o bloco bruto como texto
          await sendWithDelay(seg.json, remoteJid, timePerChar, sendMessageFn, aiAgentId)
        }
        continue
      }

      // Segmento de texto normal — processar com split padrão
      await sendTextSegment(seg.content, remoteJid, splitMessages, timePerChar, maxMessageLength, sendMessageFn, aiAgentId, sendMediaFn)
    }
    return
  }

  // ── Sem blocos interativos: fluxo normal ──
  await sendTextSegment(message, remoteJid, splitMessages, timePerChar, maxMessageLength, sendMessageFn, aiAgentId, sendMediaFn)
}

/**
 * Processa e envia um segmento de texto (com split por parágrafos, detecção de mídia, etc.)
 */
async function sendTextSegment(
  message: string,
  remoteJid: string,
  splitMessages: boolean,
  timePerChar: number,
  maxMessageLength: number,
  sendMessageFn: (to: string, content: string, aiAgentId?: string) => Promise<void>,
  aiAgentId?: string,
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>
) {
  if (splitMessages) {
    // Dividir por parágrafos (\n\n)
    const parts = message
      .split('\n\n')
      .map(p => p.trim())
      .filter(p => p.length > 0)

    for (let i = 0; i < parts.length; i++) {
      let part = parts[i]

      // Verificar se é markdown de mídia: ![caption](url) ou [caption](url)
      const mediaMatch = MARKDOWN_MEDIA_REGEX.exec(part)
      if (mediaMatch && sendMediaFn) {
        const caption = mediaMatch[1]?.trim() || ''
        const fileUrl = mediaMatch[2]

        // Validar URL antes de tentar enviar
        if (!isValidMediaUrl(fileUrl)) {
          console.warn(`[AI] Invalid media URL, sending as text: ${fileUrl.substring(0, 80)}`)
          await sendWithDelay(part, remoteJid, timePerChar, sendMessageFn, aiAgentId)
          continue
        }

        const mediaType = detectMediaType(fileUrl)

        if (timePerChar > 0) {
          const delay = Math.min(Math.max(1000, 2000), 5000) // delay fixo curto para mídia
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        try {
          const fileName = mediaType === 'document' ? (caption || fileUrl.split('/').pop() || 'document') : undefined
          await sendMediaFn(remoteJid, mediaType, fileUrl, caption || undefined, fileName)
          console.log(`[AI] Sent ${mediaType} via markdown: ${fileUrl.substring(0, 80)}...`)
        } catch (err: any) {
          console.error(`[AI] Failed to send markdown media: ${err.message}`)
          // Fallback: enviar como texto
          await sendWithDelay(part, remoteJid, timePerChar, sendMessageFn, aiAgentId)
        }
        continue
      }

      // Texto normal
      if (part.length > maxMessageLength) {
        const subParts = splitByMaxLength(part, maxMessageLength)
        for (const sub of subParts) {
          await sendWithDelay(sub, remoteJid, timePerChar, sendMessageFn, aiAgentId)
        }
      } else {
        await sendWithDelay(part, remoteJid, timePerChar, sendMessageFn, aiAgentId)
      }
    }
  } else {
    // Sem split — mas ainda assim verificar se a resposta inteira é uma mídia markdown
    const mediaMatch = MARKDOWN_MEDIA_REGEX.exec(message.trim())
    if (mediaMatch && sendMediaFn) {
      const caption = mediaMatch[1]?.trim() || ''
      const fileUrl = mediaMatch[2]

      // Validar URL antes de tentar enviar
      if (!isValidMediaUrl(fileUrl)) {
        console.warn(`[AI] Invalid media URL (no-split), sending as text: ${fileUrl.substring(0, 80)}`)
      } else {
        const mediaType = detectMediaType(fileUrl)
        try {
          const fileName = mediaType === 'document' ? (caption || fileUrl.split('/').pop() || 'document') : undefined
          await sendMediaFn(remoteJid, mediaType, fileUrl, caption || undefined, fileName)
          return
        } catch (err: any) {
          console.error(`[AI] Failed to send markdown media (no-split): ${err.message}`)
        }
      }
    }

    // Texto normal
    if (message.length > maxMessageLength) {
      const parts = splitByMaxLength(message, maxMessageLength)
      for (const part of parts) {
        await sendWithDelay(part, remoteJid, timePerChar, sendMessageFn, aiAgentId)
      }
    } else {
      await sendMessageFn(remoteJid, message, aiAgentId)
    }
  }
}

/**
 * Envia mensagem com delay calculado por timePerChar (como evolution-api sendSingleMessage).
 * Min delay: 1000ms, Max delay: 20000ms
 */
async function sendWithDelay(
  text: string,
  remoteJid: string,
  timePerChar: number,
  sendMessageFn: (to: string, content: string, aiAgentId?: string) => Promise<void>,
  aiAgentId?: string
) {
  // Converter links markdown [texto](url) para texto plano (WhatsApp não renderiza markdown de links)
  const cleanText = stripMarkdownLinks(text)

  if (timePerChar > 0) {
    const minDelay = 1000
    const maxDelay = 20000
    const delay = Math.min(Math.max(cleanText.length * timePerChar, minDelay), maxDelay)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  await sendMessageFn(remoteJid, cleanText, aiAgentId)
}

/**
 * Pausa a sessão AI quando um atendente humano envia mensagem pelo CRM.
 * Deve ser chamada em TODAS as rotas de envio de mensagem do CRM (/send, /send-media, etc).
 * Isso é necessário porque:
 * - No Baileys, mensagens fromMe chegam como type:'append' (não 'notify'), sendo filtradas
 * - No Evo Go e Cloud API, não há webhook de volta para mensagens enviadas
 * - A única forma confiável é interceptar no momento do envio pelo CRM
 *
 * Baseado no fluxo do impa-ai (N8N): verifica-fromMe → enviado-pela-api → pausa-bot
 */
export async function pauseAISessionOnHumanReply(instanceId: string, remoteJid: string): Promise<void> {
  try {
    // Sempre marca a Conversation como aiPaused se houver pelo menos um agente
    // ATIVO com stopBotFromMe=true para a empresa desta instância. Isso garante
    // que próximas mensagens do contato não disparem a IA, MESMO sem sessão
    // criada (caso clássico: atendente inicia conversa, cliente responde).
    try {
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { companyId: true },
      })
      if (instance) {
        const stopAgent = await prisma.aIAgent.findFirst({
          where: { companyId: instance.companyId, status: 'ACTIVE', stopBotFromMe: true },
          select: { id: true },
        })
        if (stopAgent) {
          await prisma.conversation.updateMany({
            where: { instanceId, remoteJid, aiPaused: false },
            data: {
              aiPaused: true,
              aiPausedAt: new Date(),
              aiPausedReason: 'auto: atendente respondeu',
            },
          })
        }
      }
    } catch (e) {
      console.warn('[AI] Failed to set conversation.aiPaused:', (e as Error).message)
    }

    // Buscar sessões OPENED para este remoteJid nesta instância
    const openSessions = await prisma.aISession.findMany({
      where: {
        instanceId,
        remoteJid,
        status: 'OPENED',
      },
      include: { agent: { select: { stopBotFromMe: true } } },
    })

    for (const session of openSessions) {
      // Só pausa se o agente tem stopBotFromMe ativo
      if (session.agent.stopBotFromMe) {
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
        const convId = await getConversationId(instanceId, remoteJid)
        if (convId) {
          logConversationEvent({
            conversationId: convId, instanceId, remoteJid,
            eventType: 'ai_session_paused',
            description: 'IA pausada automaticamente por resposta humana',
            actorType: 'system',
          })
        }
        console.log(`[AI] Session ${session.id} PAUSED - human attendant replied to ${remoteJid}`)
      }
    }
  } catch (error) {
    // Não bloquear o envio se der erro na pausa
    console.error('[AI] Error pausing session on human reply:', error)
  }
}

/**
 * Divide texto em partes respeitando maxLength, quebrando em \n\n > \n > espaço
 */
function splitByMaxLength(text: string, maxLength: number): string[] {
  const parts: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength)
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength
    }

    parts.push(remaining.substring(0, splitIndex).trim())
    remaining = remaining.substring(splitIndex).trim()
  }

  if (remaining) parts.push(remaining)
  return parts
}
