import { prisma } from '../config/database.js'
import { decryptProviderSecrets, getProviderWithFreshToken } from '../modules/ai/ai.service.js'
import { trackTokenUsage } from '../modules/ai/token-tracker.js'

/**
 * AI Follow-Up Job — Sistema de Steps Personalizáveis
 *
 * Cada agente pode ter N steps de follow-up, cada um com:
 * - delayMinutes: minutos desde a ÚLTIMA MENSAGEM DA IA (ponto zero)
 * - type: 'AI_GENERATED' | 'FIXED'
 * - message: texto fixo (quando type = FIXED)
 *
 * Exemplo de steps:
 * [
 *   { delayMinutes: 120,  type: "FIXED", message: "Oi, ainda posso te ajudar?" },
 *   { delayMinutes: 240,  type: "AI_GENERATED" },
 *   { delayMinutes: 960,  type: "FIXED", message: "Olá! Tudo bem?" },
 *   { delayMinutes: 1380, type: "FIXED", message: "Última chamada..." }
 * ]
 *
 * O delay SEMPRE conta a partir de followUpStartedAt (quando a IA mandou a msg
 * original e o cliente parou de responder). Não é incremental entre steps.
 */

interface FollowUpStep {
  delayMinutes: number
  type: 'AI_GENERATED' | 'FIXED'
  message?: string
}

let isRunning = false
let intervalId: NodeJS.Timeout | null = null

// Lazy import para evitar dependência circular
let _baileysManager: any = null
async function getBaileysManager() {
  if (!_baileysManager) {
    const server = await import('../server.js')
    _baileysManager = server.baileysManager
  }
  return _baileysManager
}

async function checkFollowUps(): Promise<void> {
  if (isRunning) return
  isRunning = true

  try {
    console.log('[AI-FollowUp] Checking for follow-up sessions...')
    const sessions = await prisma.aISession.findMany({
      where: {
        status: 'OPENED',
        lastMessageRole: 'assistant',
        agent: {
          followUpEnabled: true,
          status: 'ACTIVE',
        },
      },
      include: {
        agent: {
          include: { provider: true },
        },
      },
    })

    if (sessions.length === 0) {
      console.log('[AI-FollowUp] No eligible sessions found')
      isRunning = false
      return
    }

    console.log(`[AI-FollowUp] Found ${sessions.length} eligible session(s)`)
    const now = new Date()

    for (const session of sessions) {
      try {
        const agent = session.agent
        const steps = parseSteps(agent)

        if (steps.length === 0) continue

        // Verificar se já passou todos os steps
        if (session.followUpCount >= steps.length) {
          // Determinar a ação final do agente
          // followUpEndAction: 'CLOSE' | 'PAUSE' | 'NONE' (novo)
          // fallback para followUpCloseOnMax (legado)
          const endAction: string = (agent as any).followUpEndAction
            || (agent.followUpCloseOnMax ? 'CLOSE' : 'NONE')

          if (endAction === 'NONE') {
            // Manter sessão aberta — IA fica disponível, follow-ups acabaram
            continue
          }

          // Verificar delay antes de aplicar a ação (followUpEndDelayMinutes)
          const endDelayMinutes: number = (agent as any).followUpEndDelayMinutes ?? 0
          if (endDelayMinutes > 0) {
            const referenceEndTime = session.lastFollowUpAt || session.lastActivity
            const minutesSinceLastStep = (now.getTime() - referenceEndTime.getTime()) / 60000
            if (minutesSinceLastStep < endDelayMinutes) {
              const remaining = (endDelayMinutes - minutesSinceLastStep).toFixed(1)
              console.log(`[AI-FollowUp] Session ${session.id} - aguardando ${remaining}min antes de aplicar ação '${endAction}'`)
              continue
            }
          }

          // Aplicar ação final
          if (endAction === 'CLOSE') {
            if (agent.followUpCloseMessage) {
              await sendFollowUpMessage(session.instanceId, session.remoteJid, agent.followUpCloseMessage)
            }
            await prisma.aISession.update({
              where: { id: session.id },
              data: { status: 'CLOSED', closedAt: now, lastActivity: now },
            })
            console.log(`[AI-FollowUp] Session ${session.id} CLOSED after all ${steps.length} steps - jid: ${session.remoteJid}`)
          } else if (endAction === 'PAUSE') {
            if (agent.followUpCloseMessage) {
              await sendFollowUpMessage(session.instanceId, session.remoteJid, agent.followUpCloseMessage)
            }
            await prisma.aISession.update({
              where: { id: session.id },
              data: { status: 'PAUSED', pausedAt: now, lastActivity: now },
            })
            console.log(`[AI-FollowUp] Session ${session.id} PAUSED after all ${steps.length} steps - jid: ${session.remoteJid}`)
          }
          continue
        }

        // Ponto de referência: quando a IA mandou a última msg real
        const referenceTime = session.followUpStartedAt || session.lastActivity
        const minutesSinceReference = (now.getTime() - referenceTime.getTime()) / 60000

        // Pegar o step atual
        const currentStep = steps[session.followUpCount]
        console.log(`[AI-FollowUp] Session ${session.remoteJid}: step ${session.followUpCount + 1}/${steps.length}, minutes elapsed: ${minutesSinceReference.toFixed(1)}, delay needed: ${currentStep.delayMinutes}`)
        if (minutesSinceReference < currentStep.delayMinutes) {
          console.log(`[AI-FollowUp] Not yet time. Waiting ${(currentStep.delayMinutes - minutesSinceReference).toFixed(1)} more minutes`)
          continue // Ainda não chegou no horário deste step
        }

        // Gerar mensagem
        let followUpText: string | null = null

        if (currentStep.type === 'FIXED' && currentStep.message) {
          followUpText = currentStep.message
        } else {
          // AI_GENERATED ou fallback
          followUpText = await generateAIFollowUp(session, agent, session.followUpCount, steps.length)
        }

        if (!followUpText) continue

        // Enviar
        await sendFollowUpMessage(session.instanceId, session.remoteJid, followUpText)

        // Salvar no histórico
        await prisma.aIMessage.create({
          data: {
            sessionId: session.id,
            agentId: agent.id,
            role: 'assistant',
            content: followUpText,
            metadata: {
              type: 'follow-up',
              step: session.followUpCount + 1,
              totalSteps: steps.length,
              delayMinutes: currentStep.delayMinutes,
            },
          },
        })

        // Atualizar sessão
        await prisma.aISession.update({
          where: { id: session.id },
          data: {
            followUpCount: { increment: 1 },
            lastFollowUpAt: now,
            lastActivity: now,
            lastMessageRole: 'assistant',
            messageCount: { increment: 1 },
          },
        })

        const hours = Math.floor(currentStep.delayMinutes / 60)
        const mins = currentStep.delayMinutes % 60
        const delayLabel = hours > 0 ? `${hours}h${mins > 0 ? mins + 'min' : ''}` : `${mins}min`
        console.log(
          `[AI-FollowUp] Step ${session.followUpCount + 1}/${steps.length} sent to ${session.remoteJid} (delay: ${delayLabel}, type: ${currentStep.type}, agent: ${agent.name})`
        )
      } catch (error: any) {
        console.error(`[AI-FollowUp] Error processing session ${session.id}:`, error.message)
      }
    }

    // ── Auto-resume de sessões PAUSADAS ──────────────────────────────────
    // Busca sessões pausadas cujo agente tem pauseAutoResumeEnabled = true
    const pausedSessions = await prisma.aISession.findMany({
      where: {
        status: 'PAUSED',
        agent: { pauseAutoResumeEnabled: true, status: 'ACTIVE' },
      },
      include: { agent: true },
    })

    for (const ps of pausedSessions) {
      try {
        const agent = ps.agent
        const resumeMinutes: number = (agent as any).pauseAutoResumeMinutes ?? 60
        const trigger: string = (agent as any).pauseAutoResumeTrigger ?? 'PAUSED_AT'

        let referenceTime: Date | null = null

        if (trigger === 'PAUSED_AT') {
          referenceTime = (ps as any).pausedAt ?? ps.lastActivity
        } else if (trigger === 'LAST_CONTACT_MSG') {
          // Última mensagem do usuário na sessão
          const lastUserMsg = await prisma.aIMessage.findFirst({
            where: { sessionId: ps.id, role: 'user' },
            orderBy: { createdAt: 'desc' },
          })
          referenceTime = lastUserMsg?.createdAt ?? (ps as any).pausedAt ?? ps.lastActivity
        } else if (trigger === 'LAST_ATTENDANT_MSG') {
          // Última mensagem de saída humana na conversa (não enviada pela IA)
          const lastHumanMsg = await prisma.message.findFirst({
            where: {
              instanceId: ps.instanceId,
              remoteJid: ps.remoteJid,
              direction: 'OUTBOUND',
              sentByAIAgentId: null,
            },
            orderBy: { createdAt: 'desc' },
          })
          referenceTime = lastHumanMsg?.createdAt ?? (ps as any).pausedAt ?? ps.lastActivity
        }

        if (!referenceTime) continue

        const minutesSinceRef = (now.getTime() - referenceTime.getTime()) / 60000
        if (minutesSinceRef >= resumeMinutes) {
          // Fecha a sessão (não retoma com o mesmo agente).
          // Ao fechar, o contato fica "livre": se mandar nova mensagem que bata
          // com um gatilho, uma sessão completamente nova será criada do zero.
          await prisma.aISession.update({
            where: { id: ps.id },
            data: {
              status: 'CLOSED',
              pausedAt: null,
              lastActivity: now,
            },
          })
          console.log(`[AI-FollowUp] Session ${ps.id} auto-CLOSED after pause period (trigger: ${trigger}, ${minutesSinceRef.toFixed(1)}min >= ${resumeMinutes}min) - jid: ${ps.remoteJid}`)
        }
      } catch (err: any) {
        console.error(`[AI-FollowUp] Error auto-resuming session ${ps.id}:`, err.message)
      }
    }
  } catch (error: any) {
    console.error('[AI-FollowUp] Error in checkFollowUps:', error.message)
  } finally {
    isRunning = false
  }
}

/**
 * Extrai os steps do agente.
 * Se followUpSteps não existir, gera steps a partir dos campos legados.
 */
function parseSteps(agent: any): FollowUpStep[] {
  // Novo formato: followUpSteps JSON
  if (agent.followUpSteps && Array.isArray(agent.followUpSteps)) {
    return agent.followUpSteps as FollowUpStep[]
  }

  // Fallback: campos legados → converter para steps
  const steps: FollowUpStep[] = []
  const mode = agent.followUpMode || 'AI_GENERATED'
  const messages = agent.followUpMessages as string[] | null
  const max = agent.followUpMaxAttempts || 3

  for (let i = 0; i < max; i++) {
    const delay = i === 0 ? agent.followUpDelay : agent.followUpDelay + agent.followUpInterval * i
    if (mode === 'FIXED_MESSAGES' && messages && messages[i]) {
      steps.push({ delayMinutes: delay, type: 'FIXED', message: messages[i] })
    } else {
      steps.push({ delayMinutes: delay, type: 'AI_GENERATED' })
    }
  }

  return steps
}

/**
 * Gera follow-up usando o LLM.
 */
async function generateAIFollowUp(
  session: any,
  agent: any,
  currentStep: number,
  totalSteps: number
): Promise<string | null> {
  try {
    const recentMessages = await prisma.aIMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    })

    const historyContext = recentMessages
      .reverse()
      .map((m: any) => `${m.role === 'user' ? 'Cliente' : 'Assistente'}: ${m.content}`)
      .join('\n')

    const contactName = session.remoteJid.replace('@s.whatsapp.net', '')

    const defaultPrompt = `Você precisa reengajar o cliente que parou de responder.
Baseado na conversa abaixo, envie UMA mensagem curta e natural.
Seja amigável, não pressione. Não repita o que já disse.
Esta é a tentativa ${currentStep + 1} de ${totalSteps}.
${currentStep > 0 ? 'O cliente já ignorou mensagens anteriores. Seja mais breve e direto.' : ''}

Histórico:
${historyContext}

Responda APENAS com a mensagem, sem explicações.`

    const prompt = agent.followUpPrompt
      ? agent.followUpPrompt
          .replace(/\{history\}/g, historyContext)
          .replace(/\{attempt\}/g, String(currentStep + 1))
          .replace(/\{max_attempts\}/g, String(totalSteps))
          .replace(/\{contact_name\}/g, contactName)
      : defaultPrompt

    const { createProvider } = await import('../modules/ai/providers/index.js')
    const decrypted = (await getProviderWithFreshToken(agent.provider.id, agent.companyId))
      || decryptProviderSecrets(agent.provider)
    const provider = createProvider(decrypted.type, decrypted.apiKey, decrypted.baseUrl, decrypted.oauthData)

    const modelName = agent.provider.model
    const result = await provider.chat({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: agent.systemPrompt || 'Você é um assistente virtual.',
      maxTokens: 200,
      temperature: agent.provider.temperature || 0.7,
    })

    // Contabilizar tokens no relatório
    await trackTokenUsage({
      companyId: agent.companyId,
      agentId: agent.id,
      instanceId: session.instanceId,
      model: result.model || modelName,
      promptTokens: result.promptTokens || Math.floor(result.tokensUsed * 0.7),
      completionTokens: result.completionTokens || Math.floor(result.tokensUsed * 0.3),
      totalTokens: result.tokensUsed,
    })

    return result.content || null
  } catch (error: any) {
    console.error(`[AI-FollowUp] Error generating AI follow-up:`, error.message)
    return null
  }
}

/**
 * Envia mensagem via WhatsApp — detecta automaticamente o canal (Baileys, Evo Go, Cloud API).
 */
async function sendFollowUpMessage(
  instanceId: string,
  remoteJid: string,
  message: string
): Promise<void> {
  // Buscar instância para determinar o canal
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { evoApiUrl: true, evoApiKey: true, evoInstanceId: true, accessToken: true, phoneNumberId: true },
  })

  if (!instance) {
    console.error(`[AI-FollowUp] Instance ${instanceId} not found`)
    return
  }

  // Canal 1: Evo Go
  if (instance.evoApiUrl && instance.evoApiKey && instance.evoInstanceId) {
    const { EvoGoProvider } = await import('../providers/evo-go/evo-go.provider.js')
    const { decryptSafe } = await import('../config/encryption.js')
    const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
    await evoGo.sendTextMessage(remoteJid, message)
    console.log(`[AI-FollowUp] Sent via Evo Go to ${remoteJid}`)
    return
  }

  // Canal 2: Cloud API (Meta)
  if (instance.accessToken && instance.phoneNumberId) {
    const { default: axios } = await import('axios')
    const { decryptSafe } = await import('../config/encryption.js')
    await axios.post(
      `https://graph.facebook.com/v21.0/${instance.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: remoteJid.replace('@s.whatsapp.net', ''),
        type: 'text',
        text: { body: message },
      },
      { headers: { Authorization: `Bearer ${decryptSafe(instance.accessToken) as string}` } }
    )
    console.log(`[AI-FollowUp] Sent via Cloud API to ${remoteJid}`)
    return
  }

  // Canal 3: Baileys (padrão)
  const manager = await getBaileysManager()
  if (manager) {
    await manager.sendTextMessage(instanceId, remoteJid, message)
    console.log(`[AI-FollowUp] Sent via Baileys to ${remoteJid}`)
  } else {
    console.error('[AI-FollowUp] No channel available to send message')
  }
}

export function startAIFollowUpJob(): void {
  console.log('[AI-FollowUp] Starting follow-up job (checks every 30s)...')
  intervalId = setInterval(checkFollowUps, 30 * 1000)
  setTimeout(checkFollowUps, 20 * 1000)
}

export function stopAIFollowUpJob(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[AI-FollowUp] Follow-up job stopped')
  }
}
