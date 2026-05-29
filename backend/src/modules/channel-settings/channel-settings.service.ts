import { prisma } from '../../config/database.js'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'
import { CloudAPIProvider } from '../../providers/cloud-api/cloud-api.provider.js'
import { decryptSafe } from '../../config/encryption.js'

// Helper: decrypt instance secrets before passing to providers
function decryptInstance(inst: any): any {
  return {
    ...inst,
    accessToken: inst.accessToken ? decryptSafe(inst.accessToken) : inst.accessToken,
    evoApiKey: inst.evoApiKey ? decryptSafe(inst.evoApiKey) : inst.evoApiKey,
    webhookSecret: inst.webhookSecret ? decryptSafe(inst.webhookSecret) : inst.webhookSecret,
  }
}

// ══════════════════════════════════════════
// ═══ BUSINESS HOURS — OUT OF OFFICE ═══
// ══════════════════════════════════════════

/**
 * Verifica se a instância está fora do horário de funcionamento.
 * Retorna a mensagem de ausência se estiver fora, ou null se estiver no horário.
 */
export async function getOutOfOfficeMessage(instanceId: string): Promise<string | null> {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: {
      workingHoursEnabled: true,
      outOfOfficeMessage: true,
      timezone: true,
    },
  })

  if (!instance || !instance.workingHoursEnabled || !instance.outOfOfficeMessage) {
    return null
  }

  // Obter data/hora atual no timezone da instância
  const now = new Date()
  let localTime: Date
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: instance.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const get = (type: string) => parts.find(p => p.type === type)?.value || '0'
    localTime = new Date(
      parseInt(get('year')),
      parseInt(get('month')) - 1,
      parseInt(get('day')),
      parseInt(get('hour')),
      parseInt(get('minute'))
    )
  } catch {
    // Fallback: usar horário de Brasília (UTC-3)
    localTime = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  }

  const dayOfWeek = localTime.getDay() // 0=Dom, 6=Sab

  const workingHour = await prisma.workingHour.findUnique({
    where: { instanceId_dayOfWeek: { instanceId, dayOfWeek } },
  })

  if (!workingHour) return null // Sem config para esse dia = aberto

  // Fechado o dia inteiro
  if (workingHour.closedAllDay) {
    return instance.outOfOfficeMessage
  }

  // Verificar se a hora atual está dentro do horário de funcionamento
  const currentMinutes = localTime.getHours() * 60 + localTime.getMinutes()
  const openMinutes = workingHour.openHour * 60 + workingHour.openMinutes
  const closeMinutes = workingHour.closeHour * 60 + workingHour.closeMinutes

  if (currentMinutes < openMinutes || currentMinutes >= closeMinutes) {
    return instance.outOfOfficeMessage
  }

  return null // Está dentro do horário
}

// Rate-limit para não enviar mensagem de ausência repetidamente para o mesmo contato
const outOfOfficeSentCache = new Map<string, number>()
const OOO_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutos entre envios

/**
 * Envia resposta automática de fora do horário se aplicável.
 * Chamado quando uma mensagem inbound chega.
 */
export async function handleOutOfOfficeReply(
  instanceId: string,
  remoteJid: string,
  instance: any,
): Promise<boolean> {
  const message = await getOutOfOfficeMessage(instanceId)
  if (!message) return false

  // Rate-limit: não reenviar se já enviou recentemente
  const cacheKey = `${instanceId}:${remoteJid}`
  const lastSent = outOfOfficeSentCache.get(cacheKey)
  if (lastSent && Date.now() - lastSent < OOO_COOLDOWN_MS) {
    return true // Está fora do horário mas já enviou (não envia de novo)
  }

  try {
    await sendSystemMessage(instance, remoteJid, message)
    outOfOfficeSentCache.set(cacheKey, Date.now())
    console.log(`[OutOfOffice] Mensagem enviada para ${remoteJid} na instância ${instanceId}`)
  } catch (err: any) {
    console.error(`[OutOfOffice] Erro ao enviar:`, err.message)
  }

  return true
}

// ══════════════════════════════════════════
// ═══ CSAT — PESQUISA DE SATISFAÇÃO ═══
// ══════════════════════════════════════════

// Cache para evitar CSAT duplicado na mesma conversa (limpo ao reabrir)
const csatSentCache = new Set<string>()

/** Limpa o cache CSAT para uma conversa (chamar ao reabrir a conversa). */
export function clearCsatCache(conversationId: string): void {
  csatSentCache.delete(conversationId)
}

/**
 * Envia pesquisa CSAT quando conversa é marcada como resolvida.
 * Dispara mensagem com botões interativos diretamente via WhatsApp.
 */
export async function handleCsatOnResolve(conversationId: string): Promise<void> {
  // Evitar duplicata
  if (csatSentCache.has(conversationId)) { console.log(`[CSAT] Conversa ${conversationId} já enviou CSAT (cache), ignorando`); return }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      instanceId: true,
      contactId: true,
      remoteJid: true,
      assigneeId: true,
      instance: {
        select: {
          id: true,
          csatEnabled: true,
          csatMessage: true,
          channel: true,
          status: true,
          evoApiUrl: true,
          evoInstanceId: true,
          evoApiKey: true,
          phoneNumberId: true,
          accessToken: true,
          wabaId: true,
        },
      },
    },
  })

  if (!conversation) { console.log(`[CSAT] Conversa ${conversationId} não encontrada`); return }
  if (!conversation.instance.csatEnabled) { console.log(`[CSAT] CSAT não habilitado na instância ${conversation.instanceId}`); return }
  if (conversation.instance.status !== 'CONNECTED') { console.log(`[CSAT] Instância ${conversation.instanceId} não está conectada (status: ${conversation.instance.status})`); return }

  // Não enviar CSAT para grupos ou newsletters
  if (conversation.remoteJid.includes('@g.us') || conversation.remoteJid.includes('@newsletter')) { console.log(`[CSAT] Conversa ${conversationId} é grupo/newsletter, ignorando`); return }

  const csatMessage = conversation.instance.csatMessage || 
    'Como você avalia o atendimento que recebeu?\n\nPor favor, escolha uma nota de 1 a 5:'

  try {
    const instance = conversation.instance

    if (instance.channel === 'EVO_GO' && instance.evoApiUrl && instance.evoApiKey && instance.evoInstanceId) {
      // Enviar via Evo Go com lista interativa (5 opções em única mensagem — sem o limite de 3 botões)
      // Evo Go EXIGE title, description, footerText e buttonText não-vazios.
      const evoGo = new EvoGoProvider(decryptInstance(instance) as any)
      await evoGo.sendListMessage(
        conversation.remoteJid,
        '📊 Pesquisa de Satisfação',
        csatMessage,
        'Toque no botão abaixo para responder',
        'Responder',
        [
          {
            title: 'Selecione uma nota:',
            rows: [
              { rowId: `csat_${conversationId}_1`, title: '⭐ 1 - Péssimo' },
              { rowId: `csat_${conversationId}_2`, title: '⭐⭐ 2 - Ruim' },
              { rowId: `csat_${conversationId}_3`, title: '⭐⭐⭐ 3 - Regular' },
              { rowId: `csat_${conversationId}_4`, title: '⭐⭐⭐⭐ 4 - Bom' },
              { rowId: `csat_${conversationId}_5`, title: '⭐⭐⭐⭐⭐ 5 - Excelente' },
            ],
          },
        ]
      )
    } else if (instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') {
      // Cloud API: enviar como texto simples (sem botões interativos nativos para CSAT)
      const cloudApi = new CloudAPIProvider(decryptInstance(instance) as any)
      const textMessage = `${csatMessage}\n\nResponda com um número de 1 a 5:\n1 ⭐ Péssimo\n2 ⭐⭐ Ruim\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bom\n5 ⭐⭐⭐⭐⭐ Excelente`
      await cloudApi.sendTextMessage(conversation.remoteJid, textMessage)
    } else {
      // Baileys ou outro: enviar como texto
      await sendSystemMessage(instance as any, conversation.remoteJid, 
        `${csatMessage}\n\nResponda com um número de 1 a 5:\n1 ⭐ Péssimo\n2 ⭐⭐ Ruim\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bom\n5 ⭐⭐⭐⭐⭐ Excelente`
      )
    }

    csatSentCache.add(conversationId)
    console.log(`[CSAT] Pesquisa enviada para conversa ${conversationId}`)
  } catch (err: any) {
    console.error(`[CSAT] Erro ao enviar pesquisa:`, err.message)
  }
}

/**
 * Processa resposta CSAT vinda de mensagem inbound.
 * Detecta respostas por botão (csat_CONVID_N) ou número simples (1-5).
 */
export async function processCsatResponse(
  instanceId: string,
  conversationId: string,
  contactId: string,
  messageContent: string,
): Promise<boolean> {
  // Verificar se há CSAT pendente (enviado mas sem resposta)
  if (!csatSentCache.has(conversationId)) return false

  let rating: number | null = null

  // Formato de botão: csat_<conversationId>_<rating>
  const buttonMatch = messageContent.match(/^csat_[\w-]+_(\d)$/)
  if (buttonMatch) {
    rating = parseInt(buttonMatch[1])
  }

  // Formato texto simples: apenas o número 1-5
  if (!rating) {
    const trimmed = messageContent.trim()
    if (/^[1-5]$/.test(trimmed)) {
      rating = parseInt(trimmed)
    }
  }

  if (!rating || rating < 1 || rating > 5) return false

  // Buscar agente que estava atendendo
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { assigneeId: true },
  })

  try {
    // Verificar duplicata (constraint unique)
    const existing = await prisma.csatSurveyResponse.findUnique({
      where: { conversationId },
    })
    if (existing) return false

    await prisma.csatSurveyResponse.create({
      data: {
        instanceId,
        conversationId,
        contactId,
        assignedAgentId: conversation?.assigneeId ?? null,
        rating,
      },
    })

    csatSentCache.delete(conversationId)

    // Enviar mensagem de agradecimento
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
    })
    if (instance) {
      const thanks = rating >= 4
        ? '🎉 Muito obrigado pela avaliação! Ficamos felizes em saber que tivemos um bom atendimento.'
        : '🙏 Obrigado pelo feedback! Vamos trabalhar para melhorar nosso atendimento.'
      
      await sendSystemMessage(instance, 
        (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { remoteJid: true } }))?.remoteJid || '',
        thanks
      )
    }

    console.log(`[CSAT] Resposta registrada: conversa ${conversationId}, nota ${rating}`)
    return true
  } catch (err: any) {
    if (err.code !== 'P2002') console.error(`[CSAT] Erro ao salvar resposta:`, err.message)
    return false
  }
}

/**
 * Processa feedback textual após a nota CSAT.
 * Se o contato enviar uma mensagem logo após dar a nota, salva como feedback.
 */
export async function processCsatFeedback(
  conversationId: string,
  feedbackMessage: string,
): Promise<boolean> {
  try {
    const response = await prisma.csatSurveyResponse.findUnique({
      where: { conversationId },
    })

    if (!response || response.feedbackMessage) return false

    // Só aceitar feedback se enviado até 5 min após a nota
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    if (response.createdAt < fiveMinAgo) return false

    await prisma.csatSurveyResponse.update({
      where: { conversationId },
      data: { feedbackMessage },
    })

    return true
  } catch {
    return false
  }
}

// ══════════════════════════════════════════
// ═══ HELPER: ENVIAR MENSAGEM SISTEMA ═══
// ══════════════════════════════════════════

async function sendSystemMessage(instance: any, remoteJid: string, content: string): Promise<void> {
  if (!remoteJid) return

  if (instance.channel === 'EVO_GO' && instance.evoApiUrl && instance.evoApiKey && instance.evoInstanceId) {
    const evoGo = new EvoGoProvider(decryptInstance(instance))
    await evoGo.sendTextMessage(remoteJid, content)
  } else if (instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') {
    const cloudApi = new CloudAPIProvider(decryptInstance(instance))
    await cloudApi.sendTextMessage(remoteJid, content)
  } else if (instance.channel === 'BAILEYS') {
    // Baileys: importar dinamicamente para evitar circular dependency
    const { baileysManager } = await import('../../server.js')
    if (baileysManager) {
      await baileysManager.sendTextMessage(instance.id, remoteJid, content)
    }
  }
}
