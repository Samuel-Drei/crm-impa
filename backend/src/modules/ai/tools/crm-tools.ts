/**
 * CRM Native Tools - Ferramentas que a IA pode usar para interagir com o CRM
 * Inspirado no sistema de tools do evo-ai, adaptado para nosso CRM
 */

import { prisma } from '../../../config/database.js'
import { AIToolDefinition } from '../providers/base.provider.js'

// ============================================
// Definições das CRM Tools (para o LLM saber quais existem)
// ============================================

export const CRM_TOOL_DEFINITIONS: Record<string, AIToolDefinition> = {
  search_contacts: {
    name: 'search_contacts',
    description: 'Busca contatos no CRM por nome, telefone ou email. Use para encontrar informações de clientes.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto para buscar (nome, telefone ou email)' },
      },
      required: ['query'],
    },
  },

  get_contact_details: {
    name: 'get_contact_details',
    description: 'Obtém detalhes completos de um contato específico incluindo tags, campos customizados e conversas recentes.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'ID do contato' },
      },
      required: ['contactId'],
    },
  },

  update_contact: {
    name: 'update_contact',
    description: 'Atualiza informações de um contato no CRM (nome, email, tags)',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'ID do contato' },
        name: { type: 'string', description: 'Novo nome do contato' },
        email: { type: 'string', description: 'Novo email do contato' },
        addTags: { type: 'string', description: 'Tags para adicionar, separadas por vírgula' },
        removeTags: { type: 'string', description: 'Tags para remover, separadas por vírgula' },
      },
      required: ['contactId'],
    },
  },

  create_contact: {
    name: 'create_contact',
    description: 'Cria um novo contato no CRM',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do contato' },
        phoneNumber: { type: 'string', description: 'Número do telefone' },
        email: { type: 'string', description: 'Email do contato' },
        tags: { type: 'string', description: 'Tags iniciais, separadas por vírgula' },
      },
      required: ['name', 'phoneNumber'],
    },
  },

  get_conversation_info: {
    name: 'get_conversation_info',
    description: 'Obtém informações da conversa atual (status, atendente, time, prioridade)',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'ID da conversa (opcional - usa a conversa do contato atual)' },
      },
    },
  },

  assign_conversation: {
    name: 'assign_conversation',
    description: 'Atribui a conversa a um atendente específico ou time. Use para transferir o atendimento.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'ID da conversa' },
        assigneeId: { type: 'string', description: 'ID do atendente (opcional)' },
        teamId: { type: 'string', description: 'ID do time (opcional)' },
      },
      required: ['conversationId'],
    },
  },

  add_note: {
    name: 'add_note',
    description: 'Adiciona uma nota/observação interna à conversa (não visível para o cliente)',
    parameters: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'ID da conversa' },
        content: { type: 'string', description: 'Conteúdo da nota' },
      },
      required: ['conversationId', 'content'],
    },
  },

  list_teams: {
    name: 'list_teams',
    description: 'Lista os times disponíveis no CRM',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  list_canned_responses: {
    name: 'list_canned_responses',
    description: 'Lista as respostas prontas disponíveis para usar',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Texto para filtrar respostas' },
      },
    },
  },
}

// ============================================
// Executores das CRM Tools
// ============================================

export async function executeCrmTool(
  toolName: string,
  args: Record<string, any>,
  context: { companyId: string; instanceId: string; remoteJid: string }
): Promise<string> {
  try {
    switch (toolName) {
      case 'search_contacts':
        return await searchContacts(args.query, context.companyId)

      case 'get_contact_details':
        return await getContactDetails(args.contactId, context.companyId)

      case 'update_contact':
        return await updateContact(args, context.companyId)

      case 'create_contact':
        return await createContact(args, context.companyId)

      case 'get_conversation_info':
        return await getConversationInfo(args.conversationId, context)

      case 'assign_conversation':
        return await assignConversation(args, context.companyId)

      case 'add_note':
        return await addNote(args, context.companyId)

      case 'list_teams':
        return await listTeams(context.companyId)

      case 'list_canned_responses':
        return await listCannedResponses(args.search, context.companyId)

      default:
        return JSON.stringify({ error: `Tool desconhecida: ${toolName}` })
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message })
  }
}

// --- Implementações ---

async function searchContacts(query: string, companyId: string): Promise<string> {
  const contacts = await prisma.contact.findMany({
    where: {
      companyId,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { phoneNumber: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 10,
    select: {
      id: true, name: true, phoneNumber: true, email: true, tags: true,
    },
  })
  return JSON.stringify({ results: contacts, total: contacts.length })
}

async function getContactDetails(contactId: string, companyId: string): Promise<string> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, companyId },
    include: {
      conversations: {
        take: 3,
        orderBy: { lastActivityAt: 'desc' },
        select: {
          id: true, status: true, priority: true, lastActivityAt: true,
          assignee: { select: { name: true } },
          team: { select: { name: true } },
        },
      },
    },
  })
  if (!contact) return JSON.stringify({ error: 'Contato não encontrado' })
  return JSON.stringify(contact)
}

async function updateContact(args: Record<string, any>, companyId: string): Promise<string> {
  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, companyId },
  })
  if (!contact) return JSON.stringify({ error: 'Contato não encontrado' })

  const updateData: any = {}
  if (args.name) updateData.name = args.name
  if (args.email) updateData.email = args.email

  // Tags
  let tags = [...contact.tags]
  if (args.addTags) {
    const newTags = args.addTags.split(',').map((t: string) => t.trim()).filter(Boolean)
    tags = [...new Set([...tags, ...newTags])]
  }
  if (args.removeTags) {
    const rmTags = args.removeTags.split(',').map((t: string) => t.trim().toLowerCase())
    tags = tags.filter(t => !rmTags.includes(t.toLowerCase()))
  }
  updateData.tags = tags

  const updated = await prisma.contact.update({
    where: { id: args.contactId },
    data: updateData,
    select: { id: true, name: true, email: true, tags: true },
  })
  return JSON.stringify({ success: true, contact: updated })
}

async function createContact(args: Record<string, any>, companyId: string): Promise<string> {
  const tags = args.tags ? args.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []
  const contact = await prisma.contact.create({
    data: {
      companyId,
      name: args.name,
      phoneNumber: args.phoneNumber,
      email: args.email || null,
      tags,
    },
    select: { id: true, name: true, phoneNumber: true, email: true, tags: true },
  })
  return JSON.stringify({ success: true, contact })
}

async function getConversationInfo(
  conversationId: string | undefined,
  context: { companyId: string; instanceId: string; remoteJid: string }
): Promise<string> {
  const where = conversationId
    ? { id: conversationId }
    : { instanceId: context.instanceId, remoteJid: context.remoteJid }

  const conversation = await prisma.conversation.findFirst({
    where,
    include: {
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true, tags: true } },
    },
  })
  if (!conversation) return JSON.stringify({ error: 'Conversa não encontrada' })
  return JSON.stringify(conversation)
}

async function assignConversation(args: Record<string, any>, companyId: string): Promise<string> {
  const data: any = {}
  if (args.assigneeId) data.assigneeId = args.assigneeId
  if (args.teamId) data.teamId = args.teamId

  const conv = await prisma.conversation.update({
    where: { id: args.conversationId },
    data,
    select: {
      id: true, status: true,
      assignee: { select: { name: true } },
      team: { select: { name: true } },
    },
  })
  return JSON.stringify({ success: true, conversation: conv })
}

async function addNote(args: Record<string, any>, _companyId: string): Promise<string> {
  // Adicionar como mensagem interna
  const msg = await prisma.message.create({
    data: {
      conversationId: args.conversationId,
      instanceId: args.instanceId || '',
      remoteJid: args.remoteJid || '',
      messageId: `note_legacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      direction: 'OUTBOUND',
      status: 'SENT',
      type: 'note',
      content: args.content,
      sentAt: new Date(),
      metadata: { isNote: true, fromAI: true },
    },
  })
  return JSON.stringify({ success: true, messageId: msg.id })
}

async function listTeams(companyId: string): Promise<string> {
  const teams = await prisma.team.findMany({
    where: { companyId },
    select: { id: true, name: true, description: true },
  })
  return JSON.stringify({ teams })
}

async function listCannedResponses(search: string | undefined, companyId: string): Promise<string> {
  const where: any = { companyId }
  if (search) {
    where.OR = [
      { shortCode: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ]
  }

  const responses = await prisma.cannedResponse.findMany({
    where,
    take: 20,
    select: { id: true, shortCode: true, content: true },
  })
  return JSON.stringify({ responses })
}

// ============================================
// Helper: Obter definições das tools habilitadas
// ============================================

export function getCrmToolDefinitions(enabledTools?: string[]): AIToolDefinition[] {
  if (!enabledTools || enabledTools.length === 0) {
    // Retornar todas
    return Object.values(CRM_TOOL_DEFINITIONS)
  }
  return enabledTools
    .filter(name => CRM_TOOL_DEFINITIONS[name])
    .map(name => CRM_TOOL_DEFINITIONS[name])
}
