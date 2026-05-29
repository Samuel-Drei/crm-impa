/**
 * Scheduling Job: verifica agendamentos pendentes a cada 30s e envia as mensagens.
 * Suporta personalização via IA (reescrita leve do conteúdo).
 */
import { prisma } from '../config/database.js'
import { decryptProviderSecrets } from '../modules/ai/ai.service.js'
import { decryptSafe } from '../config/encryption.js'
import { trackTokenUsage } from '../modules/ai/token-tracker.js'

let intervalId: NodeJS.Timeout | null = null

export function startSchedulingJob(): void {
  console.log('[Scheduling] Starting scheduling job (checks every 30s)...')
  intervalId = setInterval(processScheduledMessages, 30_000)
  // Primeira execução após 10s (dar tempo do server iniciar)
  setTimeout(processScheduledMessages, 10_000)
}

export function stopSchedulingJob(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

async function processScheduledMessages(): Promise<void> {
  try {
    const now = new Date()

    // Buscar agendamentos ativos com próxima execução <= agora
    const due = await prisma.scheduledMessage.findMany({
      where: {
        status: 'ACTIVE',
        nextExecutionAt: { lte: now },
      },
      include: {
        instance: true,
        aiProvider: true,
      },
    })

    if (due.length === 0) return

    console.log(`[Scheduling] ${due.length} agendamento(s) para processar`)

    for (const schedule of due) {
      try {
        await executeSchedule(schedule)
      } catch (err: any) {
        console.error(`[Scheduling] Erro ao processar agendamento ${schedule.id}:`, err.message)
        await prisma.scheduledMessage.update({
          where: { id: schedule.id },
          data: {
            errorMessage: err.message,
            totalFailed: { increment: 1 },
            status: schedule.totalFailed + 1 >= 5 ? 'ERROR' : 'ACTIVE',
          },
        })
        await prisma.scheduledMessageLog.create({
          data: {
            scheduledMessageId: schedule.id,
            status: 'FAILED',
            error: err.message,
          },
        })
      }
    }
  } catch (err: any) {
    console.error('[Scheduling] Erro geral:', err.message)
  }
}

async function executeSchedule(schedule: any): Promise<void> {
  const { instance } = schedule

  // Verificar se instância está conectada
  if (instance.status !== 'CONNECTED') {
    throw new Error(`Instância ${instance.name} não está conectada (status: ${instance.status})`)
  }

  // Preparar conteúdo (com ou sem IA)
  let finalContent = schedule.content || ''
  let aiUsed = false

  if (schedule.aiEnabled && schedule.aiProvider && schedule.content) {
    try {
      finalContent = await rewriteWithAI(schedule)
      aiUsed = true
    } catch (aiErr: any) {
      console.warn(`[Scheduling] IA falhou para ${schedule.id}, usando conteúdo original:`, aiErr.message)
      // Falha da IA não impede o envio — usa conteúdo original
    }
  }

  // Enviar mensagem
  let msgId = ''
  const to = schedule.remoteJid

  if (schedule.messageType === 'text') {
    msgId = await sendText(instance, to, finalContent)
  } else {
    msgId = await sendMedia(instance, to, schedule.messageType, schedule.mediaUrl, finalContent, schedule.mediaFileName)
  }

  // Log de sucesso
  await prisma.scheduledMessageLog.create({
    data: {
      scheduledMessageId: schedule.id,
      status: 'SENT',
      content: aiUsed ? finalContent : undefined,
      messageId: msgId,
      aiUsed,
    },
  })

  // Calcular próxima execução
  const { calculateNextExecution } = await import('../modules/schedules/schedule.routes.js')

  const nextExecution = calculateNextExecution(
    schedule.recurrence,
    schedule.scheduledAt,
    schedule.recurrenceRule,
    new Date(),
  )

  // Verificar se atingiu limite
  const newTotalSent = schedule.totalSent + 1
  const maxReached = schedule.maxOccurrences && newTotalSent >= schedule.maxOccurrences
  const endDateReached = schedule.recurrenceRule?.endDate && nextExecution && nextExecution > new Date(schedule.recurrenceRule.endDate)
  const isCompleted = schedule.recurrence === 'ONCE' || !nextExecution || maxReached || endDateReached

  await prisma.scheduledMessage.update({
    where: { id: schedule.id },
    data: {
      totalSent: { increment: 1 },
      lastExecutedAt: new Date(),
      nextExecutionAt: isCompleted ? null : nextExecution,
      status: isCompleted ? 'COMPLETED' : 'ACTIVE',
      errorMessage: null,
    },
  })
}

async function rewriteWithAI(schedule: any): Promise<string> {
  const { createProvider } = await import('../modules/ai/providers/index.js')

  const decrypted = decryptProviderSecrets(schedule.aiProvider)
  const provider = createProvider(
    decrypted.type,
    decrypted.apiKey,
    decrypted.baseUrl,
    decrypted.oauthData,
  )

  const systemPrompt = schedule.aiPrompt ||
    'Você é um assistente que reescreve mensagens de forma leve e natural. ' +
    'Mantenha o mesmo sentido e tom, mas varie palavras e estrutura para evitar repetição. ' +
    'Retorne APENAS o texto reescrito, sem explicações.'

  const modelName = schedule.aiModel || schedule.aiProvider.model || 'gpt-4o-mini'
  const result = await provider.chat({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Reescreva esta mensagem de forma levemente diferente:\n\n${schedule.content}` },
    ],
    maxTokens: 500,
    temperature: 0.8,
  })

  // Contabilizar tokens no relatório
  await trackTokenUsage({
    companyId: schedule.companyId,
    agentId: '__scheduling__',
    instanceId: schedule.instanceId,
    model: result.model || modelName,
    promptTokens: result.promptTokens || Math.floor(result.tokensUsed * 0.7),
    completionTokens: result.completionTokens || Math.floor(result.tokensUsed * 0.3),
    totalTokens: result.tokensUsed,
  })

  return result.content.trim()
}

async function sendText(instance: any, to: string, text: string): Promise<string> {
  if (instance.channel === 'BAILEYS') {
    const { baileysManager } = await import('../server.js')
    const result = await baileysManager.sendTextMessage(instance.id, to, text)
    return result?.key?.id || ''
  } else if (instance.channel === 'EVO_GO') {
    const { EvoGoProvider } = await import('../providers/evo-go/evo-go.provider.js')
    const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
    const result = await evoGo.sendTextMessage(to, text)
    return result?.key?.id || result?.messageId || ''
  } else {
    const { CloudAPIProvider } = await import('../providers/cloud-api/cloud-api.provider.js')
    const cloudApi = new CloudAPIProvider({ ...instance, accessToken: decryptSafe(instance.accessToken) as string })
    const result = await cloudApi.sendTextMessage(to, text)
    return result.messages?.[0]?.id || ''
  }
}

async function sendMedia(
  instance: any,
  to: string,
  mediaType: string,
  mediaUrl: string,
  caption: string | undefined,
  fileName: string | undefined,
): Promise<string> {
  // URL interna para Evo Go (Docker network)
  const publicBase = (process.env.BACKEND_URL || 'http://localhost:3333').replace(/\/$/, '')
  const internalBase = (process.env.BACKEND_INTERNAL_URL || publicBase).replace(/\/$/, '')
  // Normalizar URLs absolutas com localhost para path relativo
  let normalizedUrl = mediaUrl || ''
  if (normalizedUrl.startsWith('http')) {
    try {
      const parsed = new URL(normalizedUrl)
      if (parsed.pathname.startsWith('/uploads/')) {
        normalizedUrl = parsed.pathname
      }
    } catch {}
  }

  const internalUrl = normalizedUrl.startsWith('/uploads/')
    ? `${internalBase}${normalizedUrl}`
    : normalizedUrl.startsWith('http')
      ? normalizedUrl
      : `${publicBase}${normalizedUrl}`
  const publicUrl = normalizedUrl.startsWith('/uploads/')
    ? `${publicBase}${normalizedUrl}`
    : normalizedUrl || ''

  if (instance.channel === 'BAILEYS') {
    const { baileysManager } = await import('../server.js')
    const result = await baileysManager.sendMediaMessage(instance.id, to, mediaType as "document" | "image" | "video" | "audio", publicUrl, caption, fileName)
    return result?.key?.id || ''
  } else if (instance.channel === 'EVO_GO') {
    const { EvoGoProvider } = await import('../providers/evo-go/evo-go.provider.js')
    const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })
    const result = await evoGo.sendMediaMessage(to, mediaType, internalUrl, caption, fileName)
    return result?.key?.id || result?.messageId || ''
  } else {
    const { CloudAPIProvider } = await import('../providers/cloud-api/cloud-api.provider.js')
    const cloudApi = new CloudAPIProvider({ ...instance, accessToken: decryptSafe(instance.accessToken) as string })
    const result = await cloudApi.sendMediaMessage(to, mediaType, publicUrl, caption)
    return result.messages?.[0]?.id || ''
  }
}
