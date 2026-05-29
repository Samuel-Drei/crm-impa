import { prisma } from '../../config/database.js'
import { io } from '../../server.js'
import { pipelineRoom } from '../../config/socket-rooms.js'

interface AutomationContext {
  companyId: string
  instanceId: string
  conversationId: string
  remoteJid: string
  contactId?: string
  contactName?: string
  direction?: 'INBOUND' | 'OUTBOUND'
  messageContent?: string
  messageType?: string
  isNewConversation?: boolean
}

interface AutomationCondition {
  attributeKey: string
  filterOperator: 'equal_to' | 'not_equal_to' | 'contains' | 'does_not_contain' | 'is_present' | 'is_not_present'
  values: (string | number | boolean)[]
  queryOperator?: 'AND' | 'OR'
}

interface AutomationAction {
  actionName: string
  actionParams: any[]
}

// Condições assíncronas que precisam de consulta ao banco
async function evaluateCondition(
  condition: AutomationCondition,
  context: AutomationContext,
  conversationData: any
): Promise<boolean> {
  // Condições especiais assíncronas
  if (condition.attributeKey === 'has_no_card_in_pipeline') {
    const pipelineId = condition.values[0] as string
    if (!pipelineId) {
      console.log('[Automation] has_no_card_in_pipeline: pipelineId não informado → false')
      return false
    }
    const existingCard = await prisma.card.findFirst({
      where: {
        conversationId: context.conversationId,
        pipelineId,
        companyId: context.companyId,
      },
    })
    const result = !existingCard
    console.log(`[Automation] has_no_card_in_pipeline(${pipelineId}): card existente=${!!existingCard} → ${result}`)
    return result
  }

  let value: any

  switch (condition.attributeKey) {
    case 'status':
      value = conversationData?.status
      break
    case 'assignee_id':
      value = conversationData?.assigneeId
      break
    case 'team_id':
      value = conversationData?.teamId
      break
    case 'priority':
      value = conversationData?.priority
      break
    case 'conversation_type':
      if (context.remoteJid.includes('@g.us')) value = 'group'
      else if (context.remoteJid.includes('@newsletter')) value = 'newsletter'
      else value = 'direct'
      break
    case 'message_type':
      value = context.messageType
      break
    case 'message_content':
      value = context.messageContent
      break
    case 'contact_name':
      value = context.contactName
      break
    case 'phone_number':
      value = context.remoteJid?.replace(/@.*/, '')
      break
    default:
      console.log(`[Automation] Atributo desconhecido: ${condition.attributeKey}`)
      value = null
  }

  const strValue = value != null ? String(value).toLowerCase() : ''

  let result: boolean
  switch (condition.filterOperator) {
    case 'equal_to':
      result = condition.values.some(v => String(v).toLowerCase() === strValue)
      break
    case 'not_equal_to':
      result = !condition.values.some(v => String(v).toLowerCase() === strValue)
      break
    case 'contains':
      result = condition.values.some(v => strValue.includes(String(v).toLowerCase()))
      break
    case 'does_not_contain':
      result = !condition.values.some(v => strValue.includes(String(v).toLowerCase()))
      break
    case 'is_present':
      result = value != null && value !== ''
      break
    case 'is_not_present':
      result = value == null || value === ''
      break
    default:
      result = false
  }

  console.log(`[Automation] Condição: ${condition.attributeKey} ${condition.filterOperator} [${condition.values}] → valor="${strValue}" → ${result}`)
  return result
}

async function evaluateConditions(
  conditions: AutomationCondition[],
  context: AutomationContext,
  conversationData: any
): Promise<boolean> {
  if (!conditions.length) return true

  let result = await evaluateCondition(conditions[0], context, conversationData)

  for (let i = 1; i < conditions.length; i++) {
    const operator = conditions[i].queryOperator || 'AND'
    const condResult = await evaluateCondition(conditions[i], context, conversationData)

    if (operator === 'OR') {
      result = result || condResult
    } else {
      result = result && condResult
    }
  }

  console.log(`[Automation] Resultado final das condições: ${result}`)
  return result
}

async function executeAction(action: AutomationAction, context: AutomationContext): Promise<void> {
  const { actionName, actionParams } = action
  console.log(`[Automation] Executando ação: ${actionName} params=${JSON.stringify(actionParams)}`)

  switch (actionName) {
    case 'assign_agent': {
      const userId = actionParams[0]
      if (userId) {
        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { assigneeId: userId },
        })
      }
      break
    }

    case 'assign_team': {
      const teamId = actionParams[0]
      if (teamId) {
        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { teamId },
        })
      }
      break
    }

    case 'add_label': {
      const labelId = actionParams[0]
      if (labelId) {
        await prisma.conversationLabel.upsert({
          where: { conversationId_labelId: { conversationId: context.conversationId, labelId } },
          update: {},
          create: { conversationId: context.conversationId, labelId },
        }).catch(() => {})
      }
      break
    }

    case 'change_status': {
      const status = actionParams[0]
      if (status) {
        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { status },
        })
      }
      break
    }

    case 'change_priority': {
      const priority = actionParams[0]
      if (priority) {
        await prisma.conversation.update({
          where: { id: context.conversationId },
          data: { priority },
        })
      }
      break
    }

    case 'create_pipeline_card': {
      const [pipelineId, stageId, titleTemplate] = actionParams

      if (!pipelineId || !stageId) {
        console.log('[Automation] create_pipeline_card: pipelineId ou stageId ausentes')
        break
      }

      // Verificar se já existe card para esta conversa neste pipeline
      const existingCard = await prisma.card.findFirst({
        where: {
          conversationId: context.conversationId,
          pipelineId,
          companyId: context.companyId,
        },
      })
      if (existingCard) {
        console.log(`[Automation] Card já existe para conversa ${context.conversationId} no pipeline ${pipelineId}`)
        break
      }

      // Verificar se pipeline e stage existem
      const stage = await prisma.stage.findFirst({
        where: { id: stageId, pipelineId, companyId: context.companyId },
      })
      if (!stage) {
        console.log(`[Automation] Stage ${stageId} não encontrada no pipeline ${pipelineId}`)
        break
      }

      // Resolver nome do contato se não veio no contexto
      let contactName = context.contactName
      if (!contactName && context.contactId) {
        const contact = await prisma.contact.findUnique({
          where: { id: context.contactId },
          select: { name: true },
        })
        contactName = contact?.name || undefined
      }

      // Montar título
      let title = titleTemplate || contactName || context.remoteJid.replace(/@.*/, '')
      title = title
        .replace('{{contact_name}}', contactName || '')
        .replace('{{phone}}', context.remoteJid.replace(/@.*/, ''))

      // Calcular posição
      const maxPos = await prisma.card.aggregate({
        where: { stageId },
        _max: { position: true },
      })

      const card = await prisma.card.create({
        data: {
          pipelineId,
          stageId,
          companyId: context.companyId,
          title,
          conversationId: context.conversationId,
          contactId: context.contactId || undefined,
          source: 'automation',
          position: (maxPos._max.position ?? -1) + 1,
        },
        include: {
          stage: { select: { id: true, name: true, slug: true, color: true } },
          contact: { select: { id: true, name: true, phoneNumber: true } },
        },
      })
      console.log(`[Automation] Card criado: ${card.id} - "${title}" no pipeline ${pipelineId}`)

      io.to(pipelineRoom(context.companyId, pipelineId)).emit('pipeline:card-created', { pipelineId, card })

      break
    }

    default:
      console.warn(`[Automation] Ação desconhecida: ${actionName}`)
  }
}

export async function processConversationAutomations(
  eventName: string,
  context: AutomationContext
): Promise<void> {
  try {
    console.log(`[Automation] Processando evento "${eventName}" para conversa ${context.conversationId} (jid: ${context.remoteJid}, dir: ${context.direction})`)

    const automations = await prisma.conversationAutomation.findMany({
      where: {
        companyId: context.companyId,
        eventName,
        isActive: true,
      },
    })

    if (!automations.length) {
      console.log(`[Automation] Nenhuma automação ativa para evento "${eventName}"`)
      return
    }

    console.log(`[Automation] ${automations.length} automação(ões) encontrada(s) para "${eventName}"`)

    // Buscar dados da conversa para avaliar condições
    const conversationData = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { status: true, assigneeId: true, teamId: true, priority: true },
    })

    for (const automation of automations) {
      console.log(`[Automation] Avaliando automação "${automation.name}" (${automation.id})`)
      const conditions = (automation.conditions as unknown as AutomationCondition[]) || []
      const actions = (automation.actions as unknown as AutomationAction[]) || []

      const passed = await evaluateConditions(conditions, context, conversationData)
      if (!passed) {
        console.log(`[Automation] Condições não atendidas para "${automation.name}" — pulando`)
        continue
      }

      console.log(`[Automation] Condições atendidas! Executando ${actions.length} ação(ões) de "${automation.name}"`)
      for (const action of actions) {
        try {
          await executeAction(action, context)
        } catch (err) {
          console.error(`[Automation] Erro ao executar ação "${action.actionName}" da automação "${automation.name}":`, err)
        }
      }
    }
  } catch (err) {
    console.error('[Automation] Erro ao processar automações:', err)
  }
}
