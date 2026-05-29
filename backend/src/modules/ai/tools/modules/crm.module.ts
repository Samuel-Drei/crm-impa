/**
 * CRM Tools Module — Ferramentas nativas do CRM para a IA
 *
 * A IA pode usar estas ferramentas para interagir com o CRM:
 * - Buscar/criar/atualizar contatos
 * - Ver info da conversa
 * - Atribuir conversas, adicionar notas
 * - Listar times e respostas prontas
 *
 * ⚠️ SANDBOX: Todas as tools respeitam crmToolsConfig do agente.
 *    - sandboxMode 'CURRENT_ONLY': acesso APENAS ao contato/conversa da sessão atual
 *    - Cada campo (nome, email, tags, etc) pode ser individualmente habilitado/desabilitado
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { io } from '../../../../server.js'
import { logConversationEvent, getConversationId } from '../../../conversations/conversation-events.service.js'

// ============================================
// TIPOS DA CONFIGURAÇÃO DE SANDBOX
// ============================================

export interface CrmSandboxConfig {
  sandboxMode: 'CURRENT_ONLY' | 'COMPANY'  // CURRENT_ONLY = só contato/conversa atual
  read: {
    contact_name: boolean
    contact_email: boolean
    contact_phone: boolean
    contact_tags: boolean
    custom_fields: boolean
    conversation_status: boolean
    conversation_assignee: boolean
    conversation_team: boolean
    conversation_labels: boolean
    conversation_priority: boolean
    conversation_history: boolean
    contact_notes: boolean
    teams: boolean
    canned_responses: boolean
    labels: boolean           // Listar etiquetas disponíveis
    pipelines: boolean        // Listar pipelines e estágios
  }
  write: {
    contact_name: boolean
    contact_email: boolean
    contact_tags: boolean
    custom_fields: boolean
    conversation_assign: boolean
    conversation_notes: boolean
    contact_create: boolean
    conversation_status: boolean     // Alterar status (OPEN/PENDING/SNOOZED/CLOSED)
    conversation_labels: boolean     // Adicionar/remover etiquetas
    conversation_pipeline: boolean   // Criar/mover cards no pipeline
    conversation_transfer: boolean   // Transferir para humano/time + pausar própria sessão
  }
  notesLimit: number
  enabledTools: string[]
}

/** Config padrão: tudo habilitado + sandbox on (compatível com agentes existentes MAS seguro) */
export const DEFAULT_CRM_SANDBOX: CrmSandboxConfig = {
  sandboxMode: 'CURRENT_ONLY',
  read: {
    contact_name: true,
    contact_email: true,
    contact_phone: true,
    contact_tags: true,
    custom_fields: true,
    conversation_status: true,
    conversation_assignee: true,
    conversation_team: true,
    conversation_labels: true,
    conversation_priority: true,
    conversation_history: true,
    contact_notes: true,
    teams: true,
    canned_responses: true,
    labels: true,
    pipelines: true,
  },
  notesLimit: 10,
  write: {
    contact_name: true,
    contact_email: true,
    contact_tags: true,
    custom_fields: true,
    conversation_assign: true,
    conversation_notes: true,
    contact_create: false,
    conversation_status: true,
    conversation_labels: true,
    conversation_pipeline: false,
    conversation_transfer: true,
  },
  enabledTools: [
    'get_contact_details', 'get_conversation_info',
    'assign_conversation', 'add_note',
    'list_teams', 'list_canned_responses',
    'change_conversation_status', 'add_label', 'remove_label', 'list_labels',
    'transfer_to_human', 'transfer_to_team',
  ],
}

/** Resolve config: merge do config do agente com defaults */
export function resolveSandboxConfig(raw: any): CrmSandboxConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CRM_SANDBOX
  return {
    sandboxMode: raw.sandboxMode || DEFAULT_CRM_SANDBOX.sandboxMode,
    read: { ...DEFAULT_CRM_SANDBOX.read, ...(raw.read || {}) },
    write: { ...DEFAULT_CRM_SANDBOX.write, ...(raw.write || {}) },
    notesLimit: typeof raw.notesLimit === 'number' ? raw.notesLimit : DEFAULT_CRM_SANDBOX.notesLimit,
    enabledTools: Array.isArray(raw.enabledTools) ? raw.enabledTools : DEFAULT_CRM_SANDBOX.enabledTools,
  }
}

// ============================================
// DEFINIÇÕES DAS TOOLS
// ============================================

export const CRM_TOOLS: Record<string, { definition: AIToolDefinition; description: string }> = {
  search_contacts: {
    description: 'Busca contatos no CRM',
    definition: {
      name: 'search_contacts',
      description: 'Busca contatos no CRM por nome, email ou telefone. Retorna lista de contatos encontrados.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nome, email ou telefone para buscar' },
        },
        required: ['query'],
      },
    },
  },
  get_contact_details: {
    description: 'Detalhes de um contato',
    definition: {
      name: 'get_contact_details',
      description: 'Obtém detalhes completos de um contato pelo ID ou número de telefone.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Número de telefone do contato' },
        },
        required: ['phone'],
      },
    },
  },
  update_contact: {
    description: 'Atualiza dados de um contato',
    definition: {
      name: 'update_contact',
      description: 'Atualiza informações de um contato (nome, email, etc).',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Número de telefone do contato' },
          name: { type: 'string', description: 'Novo nome do contato' },
          email: { type: 'string', description: 'Novo email do contato' },
        },
        required: ['phone'],
      },
    },
  },
  create_contact: {
    description: 'Cria um novo contato',
    definition: {
      name: 'create_contact',
      description: 'Cria um novo contato no CRM.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do contato' },
          phone: { type: 'string', description: 'Número de telefone' },
          email: { type: 'string', description: 'Email (opcional)' },
        },
        required: ['name', 'phone'],
      },
    },
  },
  get_conversation_info: {
    description: 'Info da conversa atual',
    definition: {
      name: 'get_conversation_info',
      description: 'Obtém informações da conversa atual (status, agente, etiquetas).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  assign_conversation: {
    description: 'Atribui conversa a um agente/time',
    definition: {
      name: 'assign_conversation',
      description: 'Atribui a conversa a um agente humano ou time. Use quando o cliente precisa de atendimento especializado.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'ID do time para atribuir' },
        },
      },
    },
  },
  add_note: {
    description: 'Adiciona nota à conversa',
    definition: {
      name: 'add_note',
      description: 'Adiciona uma nota interna na conversa (visível apenas para a equipe).',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: 'Texto da nota' },
        },
        required: ['note'],
      },
    },
  },
  list_teams: {
    description: 'Lista times disponíveis',
    definition: {
      name: 'list_teams',
      description: 'Lista os times de atendimento disponíveis.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  list_canned_responses: {
    description: 'Lista respostas prontas',
    definition: {
      name: 'list_canned_responses',
      description: 'Lista as respostas prontas disponíveis para envio rápido.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filtrar por texto (opcional)' },
        },
      },
    },
  },
  list_custom_fields: {
    description: 'Lista campos personalizados disponíveis',
    definition: {
      name: 'list_custom_fields',
      description: 'Lista os campos personalizados (custom attributes) definidos no CRM, tanto de contato quanto de conversa. Use para saber quais campos existem antes de definir valores.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Filtrar por modelo: CONTACT ou CONVERSATION (opcional)' },
        },
      },
    },
  },
  set_custom_field: {
    description: 'Define valor de campo personalizado',
    definition: {
      name: 'set_custom_field',
      description: 'Define o valor de um campo personalizado (custom attribute) no contato ou conversa atual. Use list_custom_fields primeiro para saber quais campos existem.',
      parameters: {
        type: 'object',
        properties: {
          attributeKey: { type: 'string', description: 'A chave do campo (attributeKey da definição)' },
          value: { type: 'string', description: 'Valor a definir no campo' },
          model: { type: 'string', description: 'Modelo: CONTACT ou CONVERSATION (padrão: CONVERSATION)' },
        },
        required: ['attributeKey', 'value'],
      },
    },
  },

  // ── NOVAS TOOLS: Controle total da IA sobre o CRM ──

  change_conversation_status: {
    description: 'Altera status da conversa',
    definition: {
      name: 'change_conversation_status',
      description: 'Altera o status da conversa atual. Use para abrir, colocar como pendente, adiar ou resolver uma conversa.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Novo status: OPEN, PENDING, SNOOZED ou CLOSED' },
          snoozedUntil: { type: 'string', description: 'Data/hora para despertar se status=SNOOZED (ISO 8601, ex: 2026-04-10T14:00:00Z). Opcional.' },
        },
        required: ['status'],
      },
    },
  },

  list_labels: {
    description: 'Lista etiquetas disponíveis',
    definition: {
      name: 'list_labels',
      description: 'Lista todas as etiquetas (labels) disponíveis no CRM. Use antes de adicionar/remover etiquetas para saber quais existem.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  add_label: {
    description: 'Adiciona etiqueta à conversa',
    definition: {
      name: 'add_label',
      description: 'Adiciona uma etiqueta (label) à conversa atual. Use list_labels para ver as etiquetas disponíveis.',
      parameters: {
        type: 'object',
        properties: {
          labelId: { type: 'string', description: 'ID da etiqueta a adicionar' },
        },
        required: ['labelId'],
      },
    },
  },

  remove_label: {
    description: 'Remove etiqueta da conversa',
    definition: {
      name: 'remove_label',
      description: 'Remove uma etiqueta (label) da conversa atual.',
      parameters: {
        type: 'object',
        properties: {
          labelId: { type: 'string', description: 'ID da etiqueta a remover' },
        },
        required: ['labelId'],
      },
    },
  },

  list_pipelines: {
    description: 'Lista pipelines e estágios',
    definition: {
      name: 'list_pipelines',
      description: 'Lista os pipelines (funis/kanban) e seus estágios disponíveis no CRM. Use antes de criar ou mover cards.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  get_conversation_cards: {
    description: 'Obtém cards da conversa no pipeline',
    definition: {
      name: 'get_conversation_cards',
      description: 'Lista os cards (oportunidades) vinculados à conversa atual nos pipelines.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  create_card: {
    description: 'Cria card no pipeline',
    definition: {
      name: 'create_card',
      description: 'Cria um novo card (oportunidade) no pipeline vinculado à conversa atual. Use list_pipelines para ver os estágios disponíveis.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título do card' },
          stageId: { type: 'string', description: 'ID do estágio onde criar o card' },
          value: { type: 'number', description: 'Valor monetário (opcional)' },
          priority: { type: 'string', description: 'Prioridade: none, low, medium, high, urgent (opcional)' },
        },
        required: ['title', 'stageId'],
      },
    },
  },

  move_card: {
    description: 'Move card para outro estágio',
    definition: {
      name: 'move_card',
      description: 'Move um card existente para outro estágio do pipeline. Use get_conversation_cards para ver os cards e list_pipelines para ver os estágios.',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string', description: 'ID do card a mover' },
          stageId: { type: 'string', description: 'ID do novo estágio' },
        },
        required: ['cardId', 'stageId'],
      },
    },
  },

  transfer_to_human: {
    description: 'Transfere conversa para atendente humano',
    definition: {
      name: 'transfer_to_human',
      description: 'Transfere a conversa para um atendente humano específico. A sessão de IA será pausada automaticamente. Use list_teams para ver times e seus membros.',
      parameters: {
        type: 'object',
        properties: {
          assigneeId: { type: 'string', description: 'ID do atendente humano' },
          reason: { type: 'string', description: 'Motivo da transferência (será salvo como nota)' },
        },
        required: ['assigneeId'],
      },
    },
  },

  transfer_to_team: {
    description: 'Transfere conversa para um time',
    definition: {
      name: 'transfer_to_team',
      description: 'Transfere a conversa para um time de atendimento. A sessão de IA será pausada automaticamente. Use list_teams para ver os times disponíveis.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'ID do time' },
          reason: { type: 'string', description: 'Motivo da transferência (será salvo como nota)' },
        },
        required: ['teamId'],
      },
    },
  },
}

// ============================================
// EXECUTORES (com sandbox)
// ============================================

/** Helper: resolve o contato da sessão atual via remoteJid */
async function getCurrentContact(ctx: ToolExecutionContext) {
  const phoneNumber = ctx.remoteJid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
  return prisma.contact.findFirst({
    where: { companyId: ctx.companyId, phoneNumber: { contains: phoneNumber } },
  })
}

/** Helper: filtra campos do contato conforme sandbox.read */
function filterContactFields(contact: any, sandbox: CrmSandboxConfig): Record<string, any> {
  const filtered: Record<string, any> = { id: contact.id }
  if (sandbox.read.contact_name) filtered.name = contact.name
  if (sandbox.read.contact_phone) filtered.phoneNumber = contact.phoneNumber || contact.phone
  if (sandbox.read.contact_email) filtered.email = contact.email
  if (sandbox.read.contact_tags) filtered.tags = contact.tags
  if (sandbox.read.custom_fields && contact.customFieldValues) {
    filtered.customFields = contact.customFieldValues
  }
  return filtered
}

async function executeSearchContacts(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  // SANDBOX: se CURRENT_ONLY, retornar APENAS o contato da sessão
  if (sandbox.sandboxMode === 'CURRENT_ONLY') {
    const current = await getCurrentContact(ctx)
    if (!current) return JSON.stringify({ contacts: [], count: 0, sandbox: 'Acesso restrito ao contato atual' })
    return JSON.stringify({ contacts: [filterContactFields(current, sandbox)], count: 1 })
  }

  // COMPANY mode: busca normal
  const contacts = await prisma.contact.findMany({
    where: {
      companyId: ctx.companyId,
      OR: [
        { name: { contains: args.query, mode: 'insensitive' } },
        { phoneNumber: { contains: args.query } },
        { email: { contains: args.query, mode: 'insensitive' } },
      ],
    },
    take: 10,
  })
  return JSON.stringify({ contacts: contacts.map(c => filterContactFields(c, sandbox)), count: contacts.length })
}

async function executeGetContactDetails(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  const phone = args.phone?.replace(/\D/g, '')

  // SANDBOX: se CURRENT_ONLY, garantir que é o contato da sessão
  if (sandbox.sandboxMode === 'CURRENT_ONLY') {
    const currentPhone = ctx.remoteJid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
    if (!phone?.includes(currentPhone) && !currentPhone.includes(phone || '')) {
      return JSON.stringify({ error: 'access_denied', message: 'Acesso restrito: você só pode consultar o contato da conversa atual.' })
    }
  }

  const include: any = {}
  if (sandbox.read.custom_fields) {
    include.customFieldValues = { include: { customField: true } }
  }

  const contact = await prisma.contact.findFirst({
    where: {
      companyId: ctx.companyId,
      phoneNumber: { contains: phone },
    },
    include: Object.keys(include).length > 0 ? include : undefined,
  })
  if (!contact) return JSON.stringify({ error: 'Contact not found' })

  return JSON.stringify(filterContactFields(contact, sandbox))
}

async function executeUpdateContact(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  const phone = args.phone?.replace(/\D/g, '')

  // SANDBOX: se CURRENT_ONLY, só pode atualizar o contato da sessão
  if (sandbox.sandboxMode === 'CURRENT_ONLY') {
    const currentPhone = ctx.remoteJid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
    if (!phone?.includes(currentPhone) && !currentPhone.includes(phone || '')) {
      return JSON.stringify({ error: 'access_denied', message: 'Acesso restrito: você só pode alterar o contato da conversa atual.' })
    }
  }

  const contact = await prisma.contact.findFirst({
    where: { companyId: ctx.companyId, phoneNumber: { contains: phone } },
  })
  if (!contact) return JSON.stringify({ error: 'Contact not found' })

  // Filtrar apenas campos autorizados para escrita
  const data: any = {}
  if (args.name && sandbox.write.contact_name) data.name = args.name
  if (args.email && sandbox.write.contact_email) data.email = args.email

  // Verificar se algo foi autorizado
  const blockedFields = []
  if (args.name && !sandbox.write.contact_name) blockedFields.push('nome')
  if (args.email && !sandbox.write.contact_email) blockedFields.push('email')

  if (Object.keys(data).length === 0) {
    return JSON.stringify({ error: 'write_denied', message: `Campos bloqueados: ${blockedFields.join(', ')}. Você não tem permissão para alterar estes dados.` })
  }

  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data,
  })

  // Log event para cada campo alterado
  const convId = await getConversationId(ctx.instanceId, ctx.remoteJid)
  if (convId) {
    const changes = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ')
    logConversationEvent({
      conversationId: convId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      eventType: 'contact_updated',
      description: `IA alterou dados do contato (${changes})`,
      actorType: 'ai',
      actorName: ctx.agentName || 'IA',
      metadata: { fields: data },
    })
  }

  return JSON.stringify({
    success: true,
    contact: filterContactFields(updated, sandbox),
    ...(blockedFields.length > 0 ? { blockedFields, warning: `Campos ignorados (sem permissão): ${blockedFields.join(', ')}` } : {}),
  })
}

async function executeCreateContact(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  if (!sandbox.write.contact_create) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para criar novos contatos.' })
  }

  const contact = await prisma.contact.create({
    data: {
      companyId: ctx.companyId,
      name: args.name,
      phoneNumber: args.phone,
      email: args.email,
    },
    select: { id: true, name: true, phoneNumber: true, email: true },
  })
  return JSON.stringify({ success: true, contact })
}

async function executeGetConversationInfo(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  // Sempre limita à conversa atual (instanceId + remoteJid)
  const conversation = await prisma.conversation.findFirst({
    where: {
      companyId: ctx.companyId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
    },
    include: {
      assignee: { select: { name: true } },
      team: { select: { name: true } },
      conversationLabels: { include: { label: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!conversation) return JSON.stringify({ error: 'Conversation not found' })

  // Filtrar campos conforme sandbox.read
  const result: Record<string, any> = { id: conversation.id }
  if (sandbox.read.conversation_status) result.status = (conversation as any).status
  if (sandbox.read.conversation_priority) result.priority = (conversation as any).priority
  if (sandbox.read.conversation_assignee) result.assignee = (conversation as any).assignee
  if (sandbox.read.conversation_team) result.team = (conversation as any).team
  if (sandbox.read.conversation_labels) result.labels = (conversation as any).conversationLabels

  return JSON.stringify(result)
}

async function executeAssignConversation(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  if (!sandbox.write.conversation_assign) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para atribuir conversas.' })
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      companyId: ctx.companyId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!conversation) return JSON.stringify({ error: 'Conversation not found' })

  const data: any = {}
  if (args.teamId) data.teamId = args.teamId

  await prisma.conversation.update({
    where: { id: conversation.id },
    data,
  })

  if (args.teamId) {
    const team = await prisma.team.findUnique({ where: { id: args.teamId }, select: { name: true } })
    logConversationEvent({
      conversationId: conversation.id,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      eventType: 'assignee_changed',
      description: `IA atribuiu a conversa para o time ${team?.name || args.teamId}`,
      actorType: 'ai',
      actorName: ctx.agentName || 'IA',
      metadata: { teamId: args.teamId, teamName: team?.name },
    })
  }

  return JSON.stringify({ success: true })
}

async function executeAddNote(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  if (!sandbox.write.conversation_notes) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para adicionar notas.' })
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      companyId: ctx.companyId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!conversation) return JSON.stringify({ error: 'Conversation not found' })

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      messageId: `note_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      direction: 'OUTBOUND',
      type: 'note',
      status: 'SENT',
      content: args.note,
      sentAt: new Date(),
      sentByAIAgentId: ctx.agentId,
      metadata: { isNote: true, fromAI: true },
    },
  })

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'note_added',
    description: `IA adicionou uma nota privada`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { notePreview: args.note?.substring(0, 100) },
  })

  return JSON.stringify({ success: true })
}

async function executeListTeams(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  if (!sandbox.read.teams) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para listar times.' })
  }

  const teams = await prisma.team.findMany({
    where: { companyId: ctx.companyId },
    select: {
      id: true, name: true, description: true,
      members: {
        include: { user: { select: { id: true, name: true, isActive: true } } },
      },
    },
  })
  return JSON.stringify({
    teams: teams.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      members: t.members
        .filter((m: any) => m.user.isActive)
        .map((m: any) => ({ id: m.user.id, name: m.user.name })),
    })),
  })
}

async function executeListCannedResponses(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)

  if (!sandbox.read.canned_responses) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para listar respostas prontas.' })
  }

  const where: any = { companyId: ctx.companyId }
  if (args.search) {
    where.OR = [
      { shortCode: { contains: args.search, mode: 'insensitive' } },
      { content: { contains: args.search, mode: 'insensitive' } },
    ]
  }
  const responses = await prisma.cannedResponse.findMany({
    where,
    take: 20,
    select: { id: true, shortCode: true, content: true },
  })
  return JSON.stringify({ responses })
}

async function executeListCustomFields(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.read.custom_fields) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para listar campos personalizados.' })
  }

  const where: any = { companyId: ctx.companyId }
  if (args.model && (args.model === 'CONTACT' || args.model === 'CONVERSATION')) {
    where.attributeModel = args.model
  }

  const definitions = await prisma.customAttributeDefinition.findMany({
    where,
    select: {
      attributeKey: true,
      attributeDisplayName: true,
      attributeDisplayType: true,
      attributeModel: true,
      attributeValues: true,
      description: true,
    },
    orderBy: { attributeDisplayName: 'asc' },
  })

  return JSON.stringify({
    customFields: definitions.map(d => ({
      key: d.attributeKey,
      name: d.attributeDisplayName,
      type: d.attributeDisplayType,
      model: d.attributeModel,
      possibleValues: d.attributeValues || null,
      description: d.description || null,
    })),
    count: definitions.length,
  })
}

async function executeSetCustomField(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.custom_fields) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para alterar campos personalizados.' })
  }

  const model = args.model || 'CONVERSATION'
  const attributeKey = args.attributeKey
  const value = args.value

  // Verificar se a definição do campo existe
  const definition = await prisma.customAttributeDefinition.findFirst({
    where: {
      companyId: ctx.companyId,
      attributeKey,
      attributeModel: model,
    },
  })
  if (!definition) {
    return JSON.stringify({ error: 'not_found', message: `Campo personalizado '${attributeKey}' não encontrado para modelo ${model}. Use list_custom_fields para ver os campos disponíveis.` })
  }

  if (model === 'CONVERSATION') {
    const conversation = await prisma.conversation.findFirst({
      where: { companyId: ctx.companyId, instanceId: ctx.instanceId, remoteJid: ctx.remoteJid },
      orderBy: { updatedAt: 'desc' },
    })
    if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

    const currentAttrs = (conversation.customAttributes as Record<string, any>) || {}
    currentAttrs[attributeKey] = value

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { customAttributes: currentAttrs },
    })

    logConversationEvent({
      conversationId: conversation.id,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      eventType: 'custom_field_set',
      description: `IA alterou o campo "${definition.attributeDisplayName}" para "${value}"`,
      actorType: 'ai',
      actorName: ctx.agentName || 'IA',
      metadata: { attributeKey, displayName: definition.attributeDisplayName, value, model: 'CONVERSATION' },
    })

    return JSON.stringify({ success: true, message: `Campo '${definition.attributeDisplayName}' definido como '${value}' na conversa.` })
  } else {
    // CONTACT
    const phoneNumber = ctx.remoteJid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
    const contact = await prisma.contact.findFirst({
      where: { companyId: ctx.companyId, phoneNumber: { contains: phoneNumber } },
    })
    if (!contact) return JSON.stringify({ error: 'not_found', message: 'Contato não encontrado' })

    const currentMeta = (contact.metadata as Record<string, any>) || {}
    currentMeta[attributeKey] = value

    await prisma.contact.update({
      where: { id: contact.id },
      data: { metadata: currentMeta },
    })

    const convId = await getConversationId(ctx.instanceId, ctx.remoteJid)
    if (convId) {
      logConversationEvent({
        conversationId: convId,
        instanceId: ctx.instanceId,
        remoteJid: ctx.remoteJid,
        eventType: 'custom_field_set',
        description: `IA alterou o campo "${definition.attributeDisplayName}" para "${value}" no contato`,
        actorType: 'ai',
        actorName: ctx.agentName || 'IA',
        metadata: { attributeKey, displayName: definition.attributeDisplayName, value, model: 'CONTACT' },
      })
    }

    return JSON.stringify({ success: true, message: `Campo '${definition.attributeDisplayName}' definido como '${value}' no contato.` })
  }
}

// ── NOVOS EXECUTORES: Controle total da IA ──

/** Helper: obtém a conversa atual do contexto */
async function getCurrentConversation(ctx: ToolExecutionContext) {
  return prisma.conversation.findFirst({
    where: {
      companyId: ctx.companyId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
    },
    orderBy: { updatedAt: 'desc' },
  })
}

async function executeChangeConversationStatus(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_status) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para alterar o status da conversa.' })
  }

  const validStatuses = ['OPEN', 'PENDING', 'SNOOZED', 'CLOSED']
  const newStatus = args.status?.toUpperCase()
  if (!validStatuses.includes(newStatus)) {
    return JSON.stringify({ error: 'invalid_status', message: `Status inválido. Use: ${validStatuses.join(', ')}` })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const oldStatus = conversation.status
  const data: any = { status: newStatus, lastActivityAt: new Date() }
  if (newStatus === 'SNOOZED' && args.snoozedUntil) {
    data.snoozedUntil = new Date(args.snoozedUntil)
  } else {
    data.snoozedUntil = null
  }

  await prisma.conversation.update({ where: { id: conversation.id }, data })

  const statusLabels: Record<string, string> = { OPEN: 'Aberta', PENDING: 'Pendente', SNOOZED: 'Adiada', CLOSED: 'Resolvida' }
  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'status_changed',
    description: `IA alterou o status de ${statusLabels[oldStatus] || oldStatus} para ${statusLabels[newStatus] || newStatus}`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { oldStatus, newStatus },
  })

  return JSON.stringify({ success: true, oldStatus, newStatus, message: `Status alterado para ${statusLabels[newStatus] || newStatus}` })
}

async function executeListLabels(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.read.labels) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para listar etiquetas.' })
  }

  const labels = await prisma.label.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, title: true, color: true },
    orderBy: { title: 'asc' },
  })
  return JSON.stringify({ labels })
}

async function executeAddLabel(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_labels) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para adicionar etiquetas.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const label = await prisma.label.findFirst({
    where: { id: args.labelId, companyId: ctx.companyId },
    select: { id: true, title: true },
  })
  if (!label) return JSON.stringify({ error: 'not_found', message: 'Etiqueta não encontrada' })

  // Verificar se já existe
  const existing = await prisma.conversationLabel.findUnique({
    where: { conversationId_labelId: { conversationId: conversation.id, labelId: args.labelId } },
  })
  if (existing) return JSON.stringify({ success: true, message: `Etiqueta '${label.title}' já está na conversa.` })

  await prisma.conversationLabel.create({
    data: { conversationId: conversation.id, labelId: args.labelId },
  })

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'label_added',
    description: `IA adicionou a etiqueta "${label.title}"`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { labelId: args.labelId, labelTitle: label.title },
  })

  return JSON.stringify({ success: true, message: `Etiqueta '${label.title}' adicionada à conversa.` })
}

async function executeRemoveLabel(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_labels) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para remover etiquetas.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const label = await prisma.label.findFirst({
    where: { id: args.labelId, companyId: ctx.companyId },
    select: { id: true, title: true },
  })
  if (!label) return JSON.stringify({ error: 'not_found', message: 'Etiqueta não encontrada' })

  const existing = await prisma.conversationLabel.findUnique({
    where: { conversationId_labelId: { conversationId: conversation.id, labelId: args.labelId } },
  })
  if (!existing) return JSON.stringify({ success: true, message: `Etiqueta '${label.title}' não estava na conversa.` })

  await prisma.conversationLabel.delete({
    where: { conversationId_labelId: { conversationId: conversation.id, labelId: args.labelId } },
  })

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'label_removed',
    description: `IA removeu a etiqueta "${label.title}"`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { labelId: args.labelId, labelTitle: label.title },
  })

  return JSON.stringify({ success: true, message: `Etiqueta '${label.title}' removida da conversa.` })
}

async function executeListPipelines(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.read.pipelines) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para listar pipelines.' })
  }

  const pipelines = await prisma.pipeline.findMany({
    where: { companyId: ctx.companyId, isActive: true },
    include: {
      stages: {
        orderBy: { position: 'asc' },
        select: { id: true, name: true, color: true, position: true, isWon: true, isLost: true },
      },
    },
    orderBy: { position: 'asc' },
  })
  return JSON.stringify({
    pipelines: pipelines.map(p => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: p.stages,
    })),
  })
}

async function executeGetConversationCards(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.read.pipelines) {
    return JSON.stringify({ error: 'read_denied', message: 'Você não tem permissão para ver cards do pipeline.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const cards = await prisma.card.findMany({
    where: { conversationId: conversation.id },
    include: {
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, color: true } },
    },
  })
  return JSON.stringify({
    cards: cards.map(c => ({
      id: c.id, title: c.title, value: c.value, priority: c.priority, status: c.status,
      pipeline: c.pipeline, stage: c.stage,
    })),
  })
}

async function executeCreateCard(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_pipeline) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para criar cards no pipeline.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const stage = await prisma.stage.findUnique({
    where: { id: args.stageId },
    include: { pipeline: { select: { id: true, name: true, companyId: true } } },
  })
  if (!stage || stage.pipeline.companyId !== ctx.companyId) {
    return JSON.stringify({ error: 'not_found', message: 'Estágio não encontrado' })
  }

  // Buscar contato da conversa
  const phoneNumber = ctx.remoteJid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
  const contact = await prisma.contact.findFirst({
    where: { companyId: ctx.companyId, phoneNumber: { contains: phoneNumber } },
  })

  // Obter posição
  const maxPosition = await prisma.card.aggregate({
    where: { stageId: args.stageId },
    _max: { position: true },
  })

  const card = await prisma.card.create({
    data: {
      companyId: ctx.companyId,
      pipelineId: stage.pipeline.id,
      stageId: args.stageId,
      contactId: contact?.id || '',
      conversationId: conversation.id,
      title: args.title,
      value: args.value || 0,
      priority: args.priority || 'none',
      position: (maxPosition._max.position || 0) + 1,
    },
    select: { id: true, title: true },
  })

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'card_created',
    description: `IA criou o card "${args.title}" no pipeline ${stage.pipeline.name} > ${stage.name}`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { cardId: card.id, pipelineId: stage.pipeline.id, stageId: args.stageId, title: args.title },
  })

  return JSON.stringify({ success: true, card, message: `Card '${args.title}' criado em ${stage.pipeline.name} > ${stage.name}` })
}

async function executeMoveCard(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_pipeline) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para mover cards no pipeline.' })
  }

  const card = await prisma.card.findUnique({
    where: { id: args.cardId },
    include: {
      stage: { select: { name: true } },
      pipeline: { select: { companyId: true } },
    },
  })
  if (!card || card.pipeline.companyId !== ctx.companyId) {
    return JSON.stringify({ error: 'not_found', message: 'Card não encontrado' })
  }

  const newStage = await prisma.stage.findUnique({
    where: { id: args.stageId },
    select: { id: true, name: true, pipelineId: true },
  })
  if (!newStage) return JSON.stringify({ error: 'not_found', message: 'Estágio não encontrado' })

  const oldStageName = card.stage.name
  await prisma.card.update({
    where: { id: args.cardId },
    data: { stageId: args.stageId, pipelineId: newStage.pipelineId },
  })

  const convId = await getConversationId(ctx.instanceId, ctx.remoteJid)
  if (convId) {
    logConversationEvent({
      conversationId: convId,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      eventType: 'card_moved',
      description: `IA moveu o card "${card.title}" de "${oldStageName}" para "${newStage.name}"`,
      actorType: 'ai',
      actorName: ctx.agentName || 'IA',
      metadata: { cardId: args.cardId, oldStage: oldStageName, newStage: newStage.name, newStageId: args.stageId },
    })
  }

  return JSON.stringify({ success: true, message: `Card '${card.title}' movido de '${oldStageName}' para '${newStage.name}'` })
}

async function executeTransferToHuman(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_transfer) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para transferir conversas.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const assignee = await prisma.user.findFirst({
    where: { id: args.assigneeId, companyId: ctx.companyId, isActive: true },
    select: { id: true, name: true },
  })
  if (!assignee) return JSON.stringify({ error: 'not_found', message: 'Atendente não encontrado ou inativo' })

  // Atribuir conversa ao humano
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { assigneeId: args.assigneeId, lastActivityAt: new Date() },
  })

  // Pausar sessão de IA
  const session = await prisma.aISession.findFirst({
    where: { agentId: ctx.agentId, instanceId: ctx.instanceId, remoteJid: ctx.remoteJid, status: 'OPENED' },
  })
  if (session) {
    await prisma.aISession.update({
      where: { id: session.id },
      data: { status: 'PAUSED' },
    })
  }

  // Adicionar nota com motivo
  if (args.reason) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        instanceId: ctx.instanceId,
        remoteJid: ctx.remoteJid,
        messageId: `note_ai_transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        direction: 'OUTBOUND',
        type: 'note',
        status: 'SENT',
        content: `🤖 Transferência para ${assignee.name}: ${args.reason}`,
        sentAt: new Date(),
        sentByAIAgentId: ctx.agentId,
        metadata: { isNote: true, fromAI: true, transferReason: true },
      },
    })
  }

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'ai_transfer_human',
    description: `IA transferiu a conversa para ${assignee.name}${args.reason ? ` (motivo: ${args.reason})` : ''}`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { assigneeId: args.assigneeId, assigneeName: assignee.name, reason: args.reason },
  })

  // Emitir evento via Socket.IO para atualizar o painel em tempo real
  io?.to(`instance:${ctx.instanceId}`).emit('ai-session-update', {
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    status: 'PAUSED',
    agentName: ctx.agentName || 'IA',
    agentId: ctx.agentId,
  })

  return JSON.stringify({ success: true, message: `Conversa transferida para ${assignee.name}. Sessão de IA pausada.` })
}

async function executeTransferToTeam(args: Record<string, any>, ctx: ToolExecutionContext): Promise<string> {
  const sandbox = resolveSandboxConfig(ctx.crmSandbox)
  if (!sandbox.write.conversation_transfer) {
    return JSON.stringify({ error: 'write_denied', message: 'Você não tem permissão para transferir conversas.' })
  }

  const conversation = await getCurrentConversation(ctx)
  if (!conversation) return JSON.stringify({ error: 'not_found', message: 'Conversa não encontrada' })

  const team = await prisma.team.findFirst({
    where: { id: args.teamId, companyId: ctx.companyId },
    select: { id: true, name: true },
  })
  if (!team) return JSON.stringify({ error: 'not_found', message: 'Time não encontrado' })

  // Atribuir conversa ao time
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { teamId: args.teamId, lastActivityAt: new Date() },
  })

  // Pausar sessão de IA
  const session = await prisma.aISession.findFirst({
    where: { agentId: ctx.agentId, instanceId: ctx.instanceId, remoteJid: ctx.remoteJid, status: 'OPENED' },
  })
  if (session) {
    await prisma.aISession.update({
      where: { id: session.id },
      data: { status: 'PAUSED' },
    })
  }

  // Adicionar nota com motivo
  if (args.reason) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        instanceId: ctx.instanceId,
        remoteJid: ctx.remoteJid,
        messageId: `note_ai_transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        direction: 'OUTBOUND',
        type: 'note',
        status: 'SENT',
        content: `🤖 Transferência para time ${team.name}: ${args.reason}`,
        sentAt: new Date(),
        sentByAIAgentId: ctx.agentId,
        metadata: { isNote: true, fromAI: true, transferReason: true },
      },
    })
  }

  logConversationEvent({
    conversationId: conversation.id,
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    eventType: 'ai_transfer_team',
    description: `IA transferiu a conversa para o time ${team.name}${args.reason ? ` (motivo: ${args.reason})` : ''}`,
    actorType: 'ai',
    actorName: ctx.agentName || 'IA',
    metadata: { teamId: args.teamId, teamName: team.name, reason: args.reason },
  })

  // Emitir evento via Socket.IO para atualizar o painel em tempo real
  io?.to(`instance:${ctx.instanceId}`).emit('ai-session-update', {
    instanceId: ctx.instanceId,
    remoteJid: ctx.remoteJid,
    status: 'PAUSED',
    agentName: ctx.agentName || 'IA',
    agentId: ctx.agentId,
  })

  return JSON.stringify({ success: true, message: `Conversa transferida para o time ${team.name}. Sessão de IA pausada.` })
}

// Mapa de executores
const executors: Record<string, (args: Record<string, any>, ctx: ToolExecutionContext) => Promise<string>> = {
  search_contacts: executeSearchContacts,
  get_contact_details: executeGetContactDetails,
  update_contact: executeUpdateContact,
  create_contact: executeCreateContact,
  get_conversation_info: executeGetConversationInfo,
  assign_conversation: executeAssignConversation,
  add_note: executeAddNote,
  list_teams: executeListTeams,
  list_canned_responses: executeListCannedResponses,
  list_custom_fields: executeListCustomFields,
  set_custom_field: executeSetCustomField,
  change_conversation_status: executeChangeConversationStatus,
  list_labels: executeListLabels,
  add_label: executeAddLabel,
  remove_label: executeRemoveLabel,
  list_pipelines: executeListPipelines,
  get_conversation_cards: executeGetConversationCards,
  create_card: executeCreateCard,
  move_card: executeMoveCard,
  transfer_to_human: executeTransferToHuman,
  transfer_to_team: executeTransferToTeam,
}

// ============================================
// CRM MODULE
// ============================================

export const crmModule: ToolModule = {
  type: 'crm',
  name: 'CRM Tools',

  getTools(config: any): AIToolDefinition[] {
    // config pode ser: string[] (legado), CrmSandboxConfig, ou undefined
    let enabledTools: string[]

    if (config && typeof config === 'object' && !Array.isArray(config) && config.enabledTools) {
      // CrmSandboxConfig passado como config
      enabledTools = config.enabledTools
    } else if (Array.isArray(config)) {
      enabledTools = config
    } else {
      enabledTools = Object.keys(CRM_TOOLS)
    }

    return enabledTools
      .filter(name => CRM_TOOLS[name])
      .map(name => CRM_TOOLS[name].definition)
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: any,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // Injetar sandbox config no contexto se veio no config
    if (config && typeof config === 'object' && !Array.isArray(config) && config.sandboxMode) {
      ctx.crmSandbox = config
    }

    const executor = executors[toolName]
    if (!executor) {
      return {
        success: false,
        result: JSON.stringify({ error: 'crm_tool_not_found', message: `CRM tool ${toolName} not found` }),
        error: `CRM tool ${toolName} not found`,
      }
    }

    const startTime = Date.now()
    try {
      const result = await executor(args, ctx)
      const latencyMs = Date.now() - startTime
      console.log(`[CRM Module] ✅ ${toolName} (${latencyMs}ms)`)
      return { success: true, result, metadata: { latencyMs } }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      console.error(`[CRM Module] ❌ ${toolName}: ${err.message} (${latencyMs}ms)`)
      return {
        success: false,
        result: JSON.stringify({ error: 'crm_tool_error', message: err.message }),
        error: err.message,
        metadata: { latencyMs },
      }
    }
  },

  // Cache Redis para tools de leitura (60 segundos)
  toolCacheTtl: {
    list_contacts: 60,
    list_conversations: 60,
    search_contacts: 30,
    list_products: 120,
    list_teams: 120,
    list_instances: 120,
    get_contact_details: 60,
    list_kanban_cards: 60,
    list_tickets: 60,
    search_knowledge_base: 90,
  },
}
