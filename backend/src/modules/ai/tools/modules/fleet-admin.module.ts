/**
 * Fleet Admin Tools Module — Ferramentas administrativas internas do CRM
 *
 * Estas tools são usadas pelos MEMBROS DA FLEET (funcionários AI internos)
 * para executar ações administrativas no CRM. Diferente do crm.module:
 *   - NÃO dependem de instanceId/remoteJid (o membro não está em uma sessão de WhatsApp)
 *   - Operam em escopo de empresa (companyId) com filtros explícitos
 *   - Toda execução é registrada em AuditLog com actorType=AI_MEMBER
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

async function logAudit(
  ctx: ToolExecutionContext,
  action: string,
  entity: string,
  entityId: string | null,
  oldData: any,
  newData: any
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: ctx.companyId,
        userId: null,
        actorType: 'AI_MEMBER',
        actorId: ctx.agentId, // agentId carrega o id do AIAgent; FleetMember 1:1
        action,
        entity,
        entityId,
        oldData: oldData ?? undefined,
        newData: newData ?? undefined,
      },
    })
  } catch (e) {
    // Não falhar a tool se o audit falhar
    console.error('[FleetAdmin] AuditLog error:', (e as Error).message)
  }
}

function ok(payload: any): string {
  return JSON.stringify({ success: true, ...payload })
}
function fail(message: string, code = 'error'): string {
  return JSON.stringify({ success: false, error: code, message })
}

/**
 * Normaliza telefone para o formato E.164 brasileiro (somente dígitos).
 * - Remove qualquer caractere não numérico
 * - Se tiver 10 ou 11 dígitos (DDD + número), adiciona 55
 * - Se já tiver 12 ou 13 dígitos começando com 55, mantém
 * - Caso contrário devolve só dígitos
 */
function normalizePhoneBR(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return '55' + digits
  return digits
}

/**
 * Gera variantes de busca para um telefone (com e sem 55, com e sem DDD).
 * Retorna pelo menos uma variante em formato substring para LIKE.
 */
function phoneSearchVariants(raw: string): string[] {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return []
  const variants = new Set<string>([digits])
  if (digits.startsWith('55') && digits.length >= 12) variants.add(digits.slice(2))
  if (digits.length === 10 || digits.length === 11) variants.add('55' + digits)
  // tail (últimos 8-9) também ajuda em buscas casuais
  if (digits.length >= 8) variants.add(digits.slice(-8))
  return Array.from(variants)
}

// ──────────────────────────────────────────────────────────────────────
// Tool definitions + executors
// ──────────────────────────────────────────────────────────────────────

interface FleetTool {
  definition: AIToolDefinition
  execute: (args: Record<string, any>, ctx: ToolExecutionContext) => Promise<string>
}

const FLEET_TOOLS: Record<string, FleetTool> = {
  // ──────────── CONTATOS / LEADS ────────────
  list_contacts: {
    definition: {
      name: 'list_contacts',
      description: 'Lista contatos do CRM com filtros (busca por texto, tag, data de criação). Paginado.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto para buscar (nome, telefone, email)' },
          tag: { type: 'string', description: 'Filtrar por tag específica' },
          createdAfter: { type: 'string', description: 'ISO date — somente contatos criados depois disso' },
          limit: { type: 'number', description: 'Máximo de resultados (default 20, max 100)' },
        },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId }
      if (args.search) {
        const search = String(args.search)
        const phoneVariants = phoneSearchVariants(search)
        const orConds: any[] = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ]
        for (const v of phoneVariants) orConds.push({ phoneNumber: { contains: v } })
        where.OR = orConds
      }
      if (args.tag) where.tags = { has: args.tag }
      if (args.createdAfter) where.createdAt = { gte: new Date(args.createdAfter) }
      const limit = Math.min(args.limit || 20, 100)
      const contacts = await prisma.contact.findMany({
        where, take: limit, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, phoneNumber: true, email: true, tags: true, createdAt: true },
      })
      return ok({ contacts, total: contacts.length })
    },
  },

  create_lead: {
    definition: {
      name: 'create_lead',
      description: 'Cria um novo lead/contato no CRM. O telefone é normalizado automaticamente para E.164 BR (adiciona 55 se faltar). Se já existir contato com o mesmo número (em qualquer formato), retorna o existente em vez de duplicar.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phoneNumber: { type: 'string' },
          email: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', description: 'Observações iniciais' },
        },
        required: ['name', 'phoneNumber'],
      },
    },
    async execute(args, ctx) {
      const phoneNormalized = normalizePhoneBR(args.phoneNumber)
      if (!phoneNormalized || phoneNormalized.length < 10) {
        return fail('Telefone inválido. Forneça com DDD (ex: 11999998888 ou 5511999998888).', 'invalid_phone')
      }
      // Dedup: procura por qualquer variante do número
      const variants = phoneSearchVariants(phoneNormalized)
      const existing = await prisma.contact.findFirst({
        where: {
          companyId: ctx.companyId,
          OR: variants.map(v => ({ phoneNumber: { contains: v } })),
        },
        select: { id: true, name: true, phoneNumber: true, email: true, tags: true },
      })
      if (existing) {
        return ok({
          contact: existing,
          duplicated: true,
          message: `Contato já existe com esse telefone (id=${existing.id}, nome=${existing.name}). Não foi criado novo registro.`,
        })
      }
      const contact = await prisma.contact.create({
        data: {
          companyId: ctx.companyId,
          name: args.name,
          phoneNumber: phoneNormalized,
          email: args.email || null,
          tags: args.tags || [],
        },
        select: { id: true, name: true, phoneNumber: true, email: true },
      })
      await logAudit(ctx, 'create', 'Contact', contact.id, null, contact)
      return ok({ contact, message: 'Lead criado com sucesso' })
    },
  },

  update_contact: {
    definition: {
      name: 'update_contact_admin',
      description: 'Atualiza um contato (nome, email, tags). Use para corrigir/enriquecer dados.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Substitui as tags atuais' },
        },
        required: ['contactId'],
      },
    },
    async execute(args, ctx) {
      const old = await prisma.contact.findFirst({ where: { id: args.contactId, companyId: ctx.companyId } })
      if (!old) return fail('Contato não encontrado', 'not_found')
      const data: any = {}
      if (args.name !== undefined) data.name = args.name
      if (args.email !== undefined) data.email = args.email
      if (args.tags !== undefined) data.tags = args.tags
      const updated = await prisma.contact.update({ where: { id: args.contactId }, data })
      await logAudit(ctx, 'update', 'Contact', updated.id, { name: old.name, email: old.email, tags: old.tags }, data)
      return ok({ contact: { id: updated.id, name: updated.name, email: updated.email, tags: updated.tags } })
    },
  },

  // ──────────── CONVERSAS ────────────
  list_conversations: {
    definition: {
      name: 'list_conversations',
      description: 'Lista conversas com filtros e busca textual por nome do contato/grupo, telefone, JID ou instância. Use para descobrir a conversa certa antes de ler o transcript com get_conversation_messages.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Busca por nome do contato/grupo, telefone ou fragmento do JID.' },
          remoteJid: { type: 'string', description: 'Filtra por JID exato ou parcial (ex: 120363...@g.us).' },
          instanceId: { type: 'string', description: 'Filtra por instância/canal.' },
          groupOnly: { type: 'boolean', description: 'Somente grupos (@g.us).' },
          status: { type: 'string', enum: ['OPEN', 'PENDING', 'SNOOZED', 'CLOSED'] },
          assigneeId: { type: 'string' },
          unassigned: { type: 'boolean', description: 'Somente sem atendente' },
          limit: { type: 'number' },
        },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId }
      if (args.search) {
        const search = String(args.search).trim()
        const phoneVariants = phoneSearchVariants(search)
        const orConds: any[] = [
          { contact: { name: { contains: search, mode: 'insensitive' } } },
          { remoteJid: { contains: search, mode: 'insensitive' } },
        ]
        for (const v of phoneVariants) {
          orConds.push({ contact: { phoneNumber: { contains: v } } })
          orConds.push({ remoteJid: { contains: v } })
        }
        where.OR = orConds
      }
      if (args.remoteJid) where.remoteJid = { contains: String(args.remoteJid).trim(), mode: 'insensitive' }
      if (args.instanceId) where.instanceId = args.instanceId
      if (args.groupOnly) where.remoteJid = { ...(where.remoteJid || {}), endsWith: '@g.us' }
      if (args.status) where.status = args.status
      if (args.unassigned) where.assigneeId = null
      else if (args.assigneeId) where.assigneeId = args.assigneeId
      const limit = Math.min(args.limit || 25, 100)
      const conversations = await prisma.conversation.findMany({
        where, take: limit, orderBy: { lastActivityAt: 'desc' },
        select: {
          id: true, status: true, priority: true, lastActivityAt: true, remoteJid: true,
          contact: { select: { id: true, name: true, phoneNumber: true } },
          instance: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
      })
      return ok({
        conversations: conversations.map(conv => ({
          id: conv.id,
          status: conv.status,
          priority: conv.priority,
          lastActivityAt: conv.lastActivityAt,
          remoteJid: conv.remoteJid,
          isGroup: (conv.remoteJid || '').endsWith('@g.us'),
          contact: conv.contact,
          instance: conv.instance,
          assignee: conv.assignee,
          team: conv.team,
        })),
        total: conversations.length,
      })
    },
  },

  // ──────────── KANBAN / PIPELINE ────────────
  list_pipelines: {
    definition: {
      name: 'list_pipelines',
      description: 'Lista os pipelines (kanbans) e seus estágios.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(_args, ctx) {
      const pipelines = await prisma.pipeline.findMany({
        where: { companyId: ctx.companyId },
        include: { stages: { select: { id: true, name: true, position: true }, orderBy: { position: 'asc' } } },
      })
      return ok({ pipelines })
    },
  },

  list_kanban_cards: {
    definition: {
      name: 'list_kanban_cards',
      description: 'Lista cards de um pipeline. Filtros: estágio, atendente, contato.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string' },
          stageId: { type: 'string' },
          assigneeId: { type: 'string' },
          contactId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId }
      if (args.pipelineId) where.pipelineId = args.pipelineId
      if (args.stageId) where.stageId = args.stageId
      if (args.assigneeId) where.assigneeId = args.assigneeId
      if (args.contactId) where.contactId = args.contactId
      const limit = Math.min(args.limit || 25, 100)
      const cards = await prisma.card.findMany({
        where, take: limit, orderBy: { updatedAt: 'desc' },
        select: {
          id: true, title: true, value: true, position: true, updatedAt: true,
          stage: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
        },
      })
      return ok({ cards })
    },
  },

  create_kanban_card: {
    definition: {
      name: 'create_kanban_card',
      description: 'Cria um card em um estágio do pipeline.',
      parameters: {
        type: 'object',
        properties: {
          stageId: { type: 'string' },
          title: { type: 'string' },
          contactId: { type: 'string' },
          value: { type: 'number', description: 'Valor monetário em reais' },
          assigneeId: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['stageId', 'title'],
      },
    },
    async execute(args, ctx) {
      const stage = await prisma.stage.findFirst({ where: { id: args.stageId, companyId: ctx.companyId } })
      if (!stage) return fail('Estágio não encontrado', 'not_found')
      const card = await prisma.card.create({
        data: {
          companyId: ctx.companyId,
          pipelineId: stage.pipelineId,
          stageId: args.stageId,
          title: args.title,
          contactId: args.contactId || null,
          value: args.value ?? null,
          assigneeId: args.assigneeId || null,
          description: args.description || null,
          position: 0,
        },
        select: { id: true, title: true, stageId: true },
      })
      await logAudit(ctx, 'create', 'Card', card.id, null, card)
      return ok({ card })
    },
  },

  move_kanban_card: {
    definition: {
      name: 'move_kanban_card',
      description: 'Move um card para outro estágio do pipeline.',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string' },
          toStageId: { type: 'string' },
        },
        required: ['cardId', 'toStageId'],
      },
    },
    async execute(args, ctx) {
      const card = await prisma.card.findFirst({ where: { id: args.cardId, companyId: ctx.companyId } })
      if (!card) return fail('Card não encontrado', 'not_found')
      const newStage = await prisma.stage.findFirst({ where: { id: args.toStageId, companyId: ctx.companyId } })
      if (!newStage) return fail('Estágio destino não encontrado', 'not_found')
      const updated = await prisma.card.update({
        where: { id: args.cardId },
        data: { stageId: args.toStageId, pipelineId: newStage.pipelineId },
        select: { id: true, title: true, stageId: true },
      })
      await logAudit(ctx, 'move', 'Card', updated.id, { stageId: card.stageId }, { stageId: updated.stageId })
      return ok({ card: updated })
    },
  },

  // ──────────── USUÁRIOS / TIMES ────────────
  list_users: {
    definition: {
      name: 'list_users',
      description: 'Lista os usuários (atendentes/admins) da empresa.',
      parameters: {
        type: 'object',
        properties: { activeOnly: { type: 'boolean', description: 'Somente ativos (default true)' } },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId }
      if (args.activeOnly !== false) where.isActive = true
      const users = await prisma.user.findMany({
        where, select: { id: true, name: true, email: true, isActive: true },
        orderBy: { name: 'asc' },
      })
      return ok({ users })
    },
  },

  list_teams: {
    definition: {
      name: 'list_teams_admin',
      description: 'Lista os times do CRM.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(_args, ctx) {
      const teams = await prisma.team.findMany({
        where: { companyId: ctx.companyId },
        select: { id: true, name: true, description: true },
      })
      return ok({ teams })
    },
  },

  // ──────────── TICKETS ────────────
  create_ticket: {
    definition: {
      name: 'create_ticket',
      description: 'Cria um ticket interno (bug, suporte, melhoria etc).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] },
          category: { type: 'string', enum: ['BUG', 'MELHORIA', 'SUPORTE', 'INFRAESTRUTURA', 'FINANCEIRO', 'COMERCIAL', 'OUTRO'] },
          assigneeId: { type: 'string' },
          createdByUserId: { type: 'string', description: 'Usuário que assina como criador (default: primeiro admin)' },
        },
        required: ['title'],
      },
    },
    async execute(args, ctx) {
      // Resolver createdById (fallback: primeiro super-admin / primeiro user)
      let createdById = args.createdByUserId as string | undefined
      if (!createdById) {
        const fallback = await prisma.user.findFirst({
          where: { companyId: ctx.companyId, isActive: true },
          orderBy: [{ isSuperAdmin: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
        createdById = fallback?.id
      }
      if (!createdById) return fail('Nenhum usuário disponível para criar o ticket', 'no_creator')

      // Gerar code (TK-XXX)
      const count = await prisma.ticket.count({ where: { companyId: ctx.companyId } })
      const code = `TK-${String(count + 1).padStart(4, '0')}`

      const ticket = await prisma.ticket.create({
        data: {
          companyId: ctx.companyId,
          code,
          title: args.title,
          description: args.description || null,
          priority: (args.priority as any) || 'MEDIA',
          category: (args.category as any) || 'OUTRO',
          assigneeId: args.assigneeId || null,
          createdById,
        },
        select: { id: true, code: true, title: true, priority: true, status: true },
      })
      await logAudit(ctx, 'create', 'Ticket', ticket.id, null, ticket)
      return ok({ ticket })
    },
  },

  list_tickets: {
    definition: {
      name: 'list_tickets',
      description: 'Lista tickets com filtros.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['NOVO', 'EM_ANDAMENTO', 'AGUARDANDO', 'RESOLVIDO', 'FECHADO', 'CANCELADO'] },
          priority: { type: 'string', enum: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] },
          assigneeId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId }
      if (args.status) where.status = args.status
      if (args.priority) where.priority = args.priority
      if (args.assigneeId) where.assigneeId = args.assigneeId
      const tickets = await prisma.ticket.findMany({
        where, take: Math.min(args.limit || 25, 100), orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, title: true, status: true, priority: true, assigneeId: true, createdAt: true },
      })
      return ok({ tickets })
    },
  },

  // ──────────── DASHBOARD ────────────
  get_dashboard_metrics: {
    definition: {
      name: 'get_dashboard_metrics',
      description: 'Retorna métricas-chave do CRM (contatos, conversas abertas, cards por pipeline, tickets abertos).',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO date — métricas a partir dessa data' },
        },
      },
    },
    async execute(args, ctx) {
      const since = args.since ? new Date(args.since) : new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const [contacts, openConvs, pendingConvs, cardsTotal, openTickets] = await Promise.all([
        prisma.contact.count({ where: { companyId: ctx.companyId, createdAt: { gte: since } } }),
        prisma.conversation.count({ where: { companyId: ctx.companyId, status: 'OPEN' } }),
        prisma.conversation.count({ where: { companyId: ctx.companyId, status: 'PENDING' } }),
        prisma.card.count({ where: { companyId: ctx.companyId } }),
        prisma.ticket.count({ where: { companyId: ctx.companyId, status: { notIn: ['FECHADO' as any, 'CANCELADO' as any] } } }).catch(() => 0),
      ])
      return ok({
        period: { since: since.toISOString(), until: new Date().toISOString() },
        metrics: {
          newContacts: contacts,
          openConversations: openConvs,
          pendingConversations: pendingConvs,
          totalCards: cardsTotal,
          openTickets,
        },
      })
    },
  },

  search_messages: {
    definition: {
      name: 'search_messages',
      description: 'Busca textual em mensagens recentes (últimos 30 dias). Use para encontrar palavras-chave/trechos específicos. NÃO use repetidamente para ler a conversa inteira; para transcript completo use get_conversation_messages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          contactId: { type: 'string' },
          conversationId: { type: 'string', description: 'Restringe a busca a uma conversa específica.' },
          remoteJid: { type: 'string', description: 'Alternativa ao conversationId: filtra pelo JID da conversa.' },
          instanceId: { type: 'string', description: 'Filtra por instância/canal.' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
    async execute(args, ctx) {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const where: any = {
        conversation: { companyId: ctx.companyId },
        content: { contains: args.query, mode: 'insensitive' },
        createdAt: { gte: cutoff },
      }
      if (args.contactId) where.conversation.contactId = args.contactId
      if (args.conversationId) where.conversation.id = args.conversationId
      if (args.remoteJid) where.conversation.remoteJid = args.remoteJid
      if (args.instanceId) where.conversation.instanceId = args.instanceId
      const messages = await prisma.message.findMany({
        where, take: Math.min(args.limit || 15, 50), orderBy: { createdAt: 'desc' },
        select: {
          id: true, content: true, direction: true, type: true, createdAt: true,
          conversation: {
            select: { id: true, remoteJid: true, contact: { select: { id: true, name: true } } },
          },
        },
      })
      return ok({
        messages,
        hint: 'Se você já encontrou a conversa certa e precisa ler o histórico em ordem, use get_conversation_messages.',
      })
    },
  },

  get_conversation_messages: {
    definition: {
      name: 'get_conversation_messages',
      description: 'LÊ as mensagens de UMA conversa/grupo específico (transcript completo, ordem cronológica). Use ANTES de responder em uma conversa que não está aberta no contexto, ou para revisar o que foi conversado em um grupo. Aceita: (a) conversationId direto, OU (b) remoteJid (ex: 5511999998888@s.whatsapp.net ou 120363xxx@g.us) + instanceId. Retorna texto + remetente (pushName) + tipo + data. Suporta paginação via "before" (ISO timestamp).',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'ID da conversa (use list_conversations para descobrir).' },
          remoteJid: { type: 'string', description: 'Alternativa ao conversationId: JID do contato/grupo (ex: 120363xxx@g.us para grupo).' },
          instanceId: { type: 'string', description: 'Obrigatório se usar remoteJid: ID da instância WhatsApp.' },
          limit: { type: 'number', description: 'Quantidade de mensagens (1-200, padrão 50). Para ler conversa inteira, faça várias chamadas com "before".' },
          before: { type: 'string', description: 'ISO timestamp: retorna mensagens anteriores a esse momento (paginação).' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Ordem cronológica. Padrão: asc (mais antiga primeiro, leitura natural).' },
        },
      },
    },
    async execute(args, ctx) {
      // 1. Resolver conversa (por id ou jid+instance)
      let conv: any = null
      if (args.conversationId) {
        conv = await prisma.conversation.findFirst({
          where: { id: args.conversationId, companyId: ctx.companyId },
          select: {
            id: true, remoteJid: true, instanceId: true, status: true,
            contact: { select: { id: true, name: true, phoneNumber: true } },
            instance: { select: { id: true, name: true } },
          },
        })
      } else if (args.remoteJid && args.instanceId) {
        conv = await prisma.conversation.findFirst({
          where: {
            companyId: ctx.companyId,
            remoteJid: args.remoteJid,
            instanceId: args.instanceId,
          },
          orderBy: { lastActivityAt: 'desc' },
          select: {
            id: true, remoteJid: true, instanceId: true, status: true,
            contact: { select: { id: true, name: true, phoneNumber: true } },
            instance: { select: { id: true, name: true } },
          },
        })
      } else {
        return fail('Informe conversationId OU (remoteJid + instanceId)', 'missing_args')
      }
      if (!conv) return fail('Conversa não encontrada nesta empresa', 'not_found')

      // 2. Filtros
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200)
      const where: any = { conversationId: conv.id }
      if (args.before) {
        const beforeDate = new Date(args.before)
        if (!isNaN(beforeDate.getTime())) where.createdAt = { lt: beforeDate }
      }

      // 3. Sempre busca em DESC (mais recentes), depois inverte se order=asc
      const raw = await prisma.message.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          messageId: true,
          content: true,
          direction: true,
          type: true,
          status: true,
          mediaUrl: true,
          mediaType: true,
          createdAt: true,
          sentByUser: { select: { id: true, name: true } },
          sentByAIAgent: { select: { id: true, name: true } },
        },
      })

      const order = args.order === 'desc' ? 'desc' : 'asc'
      const messages = order === 'asc' ? raw.slice().reverse() : raw

      // 4. Cursor para próxima página (timestamp da mensagem mais antiga retornada)
      const oldestTs = raw.length > 0 ? raw[raw.length - 1].createdAt.toISOString() : null
      const hasMore = raw.length === limit
      const isGroup = (conv.remoteJid || '').endsWith('@g.us')

      return ok({
        conversation: {
          id: conv.id,
          remoteJid: conv.remoteJid,
          status: conv.status,
          isGroup,
          contactName: conv.contact?.name,
          instanceName: conv.instance?.name,
        },
        messages: messages.map(m => {
          const fromMe = m.direction === 'OUTBOUND'
          let from: string
          if (fromMe) {
            if (m.sentByAIAgent?.name) from = `IA (${m.sentByAIAgent.name})`
            else if (m.sentByUser?.name) from = `Atendente (${m.sentByUser.name})`
            else from = 'me'
          } else {
            from = conv.contact?.name || 'contato'
          }
          return {
            id: m.id,
            from,
            direction: m.direction,
            type: m.type,
            content: m.content,
            mediaUrl: m.mediaUrl,
            mediaType: m.mediaType,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
          }
        }),
        pagination: {
          count: messages.length,
          order,
          hasMore,
          nextBefore: hasMore ? oldestTs : null,
          hint: hasMore ? `Para ler mais antigas, chame de novo com before="${oldestTs}"` : 'Fim do histórico desta conversa.',
        },
      })
    },
  },

  list_recent_messages: {
    definition: {
      name: 'list_recent_messages',
      description: 'Lista as mensagens mais recentes de TODA a empresa (todas as conversas), ou filtradas por contato/instância. Útil para ver "o que aconteceu nas últimas horas" sem saber a conversa específica. Diferente de search_messages, NÃO precisa de palavra-chave.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Filtrar por contato' },
          instanceId: { type: 'string', description: 'Filtrar por instância WhatsApp' },
          direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'], description: 'Apenas recebidas ou apenas enviadas' },
          sinceHours: { type: 'number', description: 'Mensagens das últimas N horas (padrão 24, máx 720 = 30 dias)' },
          limit: { type: 'number', description: '1-100, padrão 30' },
        },
      },
    },
    async execute(args, ctx) {
      const hours = Math.min(Math.max(Number(args.sinceHours) || 24, 1), 720)
      const cutoff = new Date(Date.now() - hours * 3600 * 1000)
      const where: any = {
        conversation: { companyId: ctx.companyId },
        createdAt: { gte: cutoff },
      }
      if (args.contactId) where.conversation.contactId = args.contactId
      if (args.instanceId) where.conversation.instanceId = args.instanceId
      if (args.direction) where.direction = args.direction

      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100)
      const messages = await prisma.message.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, content: true, direction: true, type: true,
          createdAt: true,
          conversation: {
            select: {
              id: true, remoteJid: true,
              contact: { select: { id: true, name: true, phoneNumber: true } },
            },
          },
        },
      })
      return ok({
        sinceHours: hours,
        count: messages.length,
        messages: messages.map(m => ({
          id: m.id,
          conversationId: m.conversation?.id,
          remoteJid: m.conversation?.remoteJid,
          contactName: m.conversation?.contact?.name,
          isGroup: (m.conversation?.remoteJid || '').endsWith('@g.us'),
          from: m.direction === 'OUTBOUND' ? 'me' : (m.conversation?.contact?.name || 'contato'),
          direction: m.direction,
          type: m.type,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      })
    },
  },

  notify_user: {
    definition: {
      name: 'notify_user',
      description: 'Envia uma notificação interna no painel para um usuário (admin/atendente).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['userId', 'title', 'body'],
      },
    },
    async execute(args, ctx) {
      try {
        // @ts-ignore - notification model pode não existir
        if ((prisma as any).notification) {
          // @ts-ignore
          const n = await (prisma as any).notification.create({
            data: {
              companyId: ctx.companyId,
              userId: args.userId,
              title: args.title,
              body: args.body,
              type: 'FLEET',
              isRead: false,
            },
          })
          return ok({ notification: { id: n.id } })
        }
      } catch {}
      await logAudit(ctx, 'notify', 'User', args.userId, null, { title: args.title, body: args.body })
      return ok({ message: 'Notificação registrada (audit)' })
    },
  },

  // ──────────── INSTÂNCIAS WHATSAPP ────────────
  list_instances: {
    definition: {
      name: 'list_instances',
      description: 'Lista as instâncias de WhatsApp/canal disponíveis na empresa. Use ANTES de send_whatsapp_message para descobrir o instanceId.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(_args, ctx) {
      const instances = await prisma.instance.findMany({
        where: { companyId: ctx.companyId },
        select: { id: true, name: true, channel: true, status: true, phoneNumber: true },
        orderBy: { createdAt: 'asc' },
      })
      return ok({ instances, total: instances.length })
    },
  },

  send_whatsapp_message: {
    definition: {
      name: 'send_whatsapp_message',
      description: 'ENVIA uma mensagem de WhatsApp (texto) através de uma instância da empresa. Use list_instances primeiro para pegar o instanceId. O parâmetro `to` aceita: (1) número de pessoa (ex: 5511999998888 — normaliza automático), OU (2) JID de GRUPO terminando em @g.us (ex: 120363202935985046@g.us). PARA ENVIAR EM GRUPO VOCÊ DEVE PASSAR O JID COMPLETO COM @g.us, NUNCA o número de uma pessoa. Use list_conversations para descobrir o JID de grupos. ⚠️ ATENÇÃO ANTI-ALUCINAÇÃO: o `to` DEVE vir do retorno mais recente de list_contacts (pessoa por nome) ou list_conversations (grupo). NUNCA copie um número que apareceu numa mensagem anterior do chat — número de uma conversa antiga NÃO é o mesmo de outra pessoa. Se admin pedir "manda pro Rafa", chame list_contacts(search="Rafa") AGORA, não reaproveite o número da última mensagem enviada.',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'string', description: 'ID da instância (obrigatório)' },
          to: { type: 'string', description: 'Número do destinatário (E.164 ou JID)' },
          text: { type: 'string', description: 'Texto da mensagem' },
        },
        required: ['instanceId', 'to', 'text'],
      },
    },
    async execute(args, ctx) {
      try {
        const instance = await prisma.instance.findFirst({
          where: { id: args.instanceId, companyId: ctx.companyId },
        })
        if (!instance) return fail('Instância não encontrada', 'instance_not_found')

        // Normaliza JID — aceita digitos puros (com ou sem 55), E.164 ou JID completo
        let raw = String(args.to).trim()
        let jid: string
        if (raw.includes('@')) {
          jid = raw
        } else {
          const normalized = normalizePhoneBR(raw)
          if (!normalized || normalized.length < 12) {
            return fail(`Telefone "${raw}" inválido. Forneça com DDD (ex: 11999998888 ou 5511999998888).`, 'invalid_phone')
          }
          jid = `${normalized}@s.whatsapp.net`
        }

        const { decryptSafe } = await import('../../../../config/encryption.js')
        const decrypted: any = {
          ...instance,
          accessToken: instance.accessToken ? decryptSafe(instance.accessToken) : instance.accessToken,
          evoApiKey: instance.evoApiKey ? decryptSafe(instance.evoApiKey) : instance.evoApiKey,
          webhookSecret: instance.webhookSecret ? decryptSafe(instance.webhookSecret) : instance.webhookSecret,
        }

        if (instance.channel === 'EVO_GO' && instance.evoApiUrl) {
          const { EvoGoProvider } = await import('../../../../providers/evo-go/evo-go.provider.js')
          const evoGo = new EvoGoProvider(decrypted)
          await evoGo.sendTextMessage(jid, args.text)
        } else if (instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') {
          const { CloudAPIProvider } = await import('../../../../providers/cloud-api/cloud-api.provider.js')
          const cloudApi = new CloudAPIProvider(decrypted)
          await cloudApi.sendTextMessage(jid, args.text)
        } else if (instance.channel === 'BAILEYS') {
          const { baileysManager } = await import('../../../../server.js') as any
          if (!baileysManager) return fail('Baileys manager indisponível', 'baileys_unavailable')
          await baileysManager.sendTextMessage(instance.id, jid, args.text)
        } else {
          return fail(`Canal ${instance.channel} não suportado para envio direto`, 'channel_unsupported')
        }

        await logAudit(ctx, 'send_message', 'Instance', instance.id, null, { to: jid, length: args.text.length })
        const isGroup = jid.endsWith('@g.us')
        return ok({
          message: 'Mensagem enviada',
          to: jid,
          destinationType: isGroup ? 'GROUP' : 'PERSON',
          instance: { id: instance.id, name: instance.name },
          confirmReportToAdmin: `Mensagem enviada para ${isGroup ? 'grupo' : 'pessoa'} ${jid} via instância "${instance.name}". Reporte ao admin EXATAMENTE este destinatário — não invente outro nome/número.`,
        })
      } catch (err: any) {
        return fail(err?.message || 'Falha ao enviar mensagem', 'send_failed')
      }
    },
  },

  send_whatsapp_poll: {
    definition: {
      name: 'send_whatsapp_poll',
      description: 'Envia ENQUETE/POLL no WhatsApp. ⚠️ Requer canal EVO_GO (Baileys/CloudAPI ainda não suportam poll nesta stack). Use list_instances para confirmar que `channel === "EVO_GO"`. O `to` aceita pessoa (E.164) ou grupo (JID @g.us). `selectableCount` define quantas opções o votante pode marcar (1 = enquete simples, >1 = múltipla escolha).',
      parameters: {
        type: 'object',
        properties: {
          instanceId: { type: 'string', description: 'ID da instância (canal EVO_GO)' },
          to: { type: 'string', description: 'Destino: número E.164 (5511...) ou JID de grupo (...@g.us)' },
          question: { type: 'string', description: 'Pergunta da enquete (máx 255 chars)' },
          options: { type: 'array', items: { type: 'string' }, description: 'Opções de resposta (2 a 12 itens, cada um até 100 chars)' },
          selectableCount: { type: 'number', description: 'Quantas opções podem ser selecionadas. Padrão: 1' },
        },
        required: ['instanceId', 'to', 'question', 'options'],
      },
    },
    async execute(args, ctx) {
      try {
        const opts = Array.isArray(args.options) ? args.options.filter((o: any) => typeof o === 'string' && o.trim().length > 0) : []
        if (opts.length < 2 || opts.length > 12) return fail('options deve ter entre 2 e 12 itens', 'invalid_options')
        const question = String(args.question || '').trim()
        if (!question) return fail('question vazio', 'invalid_question')

        const instance = await prisma.instance.findFirst({ where: { id: args.instanceId, companyId: ctx.companyId } })
        if (!instance) return fail('Instância não encontrada', 'instance_not_found')

        if (instance.channel !== 'EVO_GO' || !instance.evoApiUrl) {
          return fail(`Canal ${instance.channel} não suporta enquete nesta stack. Use uma instância EVO_GO.`, 'channel_unsupported')
        }

        let raw = String(args.to).trim()
        let jid: string
        if (raw.includes('@')) {
          jid = raw
        } else {
          const normalized = normalizePhoneBR(raw)
          if (!normalized || normalized.length < 12) return fail(`Telefone "${raw}" inválido.`, 'invalid_phone')
          jid = `${normalized}@s.whatsapp.net`
        }

        const { decryptSafe } = await import('../../../../config/encryption.js')
        const decrypted: any = {
          ...instance,
          accessToken: instance.accessToken ? decryptSafe(instance.accessToken) : instance.accessToken,
          evoApiKey: instance.evoApiKey ? decryptSafe(instance.evoApiKey) : instance.evoApiKey,
          webhookSecret: instance.webhookSecret ? decryptSafe(instance.webhookSecret) : instance.webhookSecret,
        }
        const { EvoGoProvider } = await import('../../../../providers/evo-go/evo-go.provider.js')
        const evoGo = new EvoGoProvider(decrypted)
        const selectable = Math.min(Math.max(Number(args.selectableCount) || 1, 1), opts.length)
        await evoGo.sendPollMessage(jid, question, opts, selectable)

        await logAudit(ctx, 'send_poll', 'Instance', instance.id, null, { to: jid, question, optionCount: opts.length, selectable })
        const isGroup = jid.endsWith('@g.us')
        return ok({
          message: 'Enquete enviada',
          to: jid,
          destinationType: isGroup ? 'GROUP' : 'PERSON',
          instance: { id: instance.id, name: instance.name },
          poll: { question, options: opts, selectableCount: selectable },
        })
      } catch (err: any) {
        return fail(err?.message || 'Falha ao enviar enquete', 'send_failed')
      }
    },
  },

  // ──────────── PRODUTOS / SERVIÇOS (CatalogItem) ────────────
  list_products: {
    definition: {
      name: 'list_products',
      description: 'Lista produtos/serviços do catálogo da empresa.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filtrar por nome' },
          type: { type: 'string', enum: ['PRODUCT', 'SERVICE'], description: 'Filtrar por tipo' },
          limit: { type: 'number', description: 'Padrão 30, máx 100' },
        },
      },
    },
    async execute(args, ctx) {
      try {
        const where: any = { companyId: ctx.companyId }
        if (args.search) where.name = { contains: args.search, mode: 'insensitive' }
        if (args.type) where.type = args.type
        const items = await prisma.catalogItem.findMany({
          where,
          take: Math.min(args.limit || 30, 100),
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, type: true, price: true, currency: true, sku: true, active: true, description: true },
        })
        return ok({ items, total: items.length })
      } catch (e: any) {
        return fail(e.message, 'list_failed')
      }
    },
  },

  create_product: {
    definition: {
      name: 'create_product',
      description: 'Cria um produto ou serviço no catálogo da empresa.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do produto/serviço' },
          type: { type: 'string', enum: ['PRODUCT', 'SERVICE'], description: 'Tipo (padrão SERVICE)' },
          price: { type: 'number', description: 'Preço em reais (ex: 199.90). Obrigatório.' },
          description: { type: 'string' },
          sku: { type: 'string' },
          billingCycle: { type: 'string', enum: ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'], description: 'Padrão ONE_TIME' },
        },
        required: ['name', 'price'],
      },
    },
    async execute(args, ctx) {
      try {
        const priceNum = Number(args.price)
        if (!Number.isFinite(priceNum) || priceNum < 0) {
          return fail('price deve ser um número >= 0', 'invalid_price')
        }
        const slug = String(args.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '-' + Date.now().toString(36)
        const item = await prisma.catalogItem.create({
          data: {
            companyId: ctx.companyId,
            name: args.name,
            slug,
            type: args.type || 'SERVICE',
            price: priceNum,
            description: args.description,
            sku: args.sku,
            billingCycle: args.billingCycle || 'ONE_TIME',
          },
        })
        await logAudit(ctx, 'create', 'CatalogItem', item.id, null, { name: args.name, price: priceNum })
        return ok({ item: { id: item.id, name: item.name, type: item.type, price: item.price.toString(), slug: item.slug } })
      } catch (e: any) {
        return fail(e.message, 'create_failed')
      }
    },
  },

  // ──────────── DESCOBERTA DE MEMBROS DA FLEET (para spawn_subagent) ────────────
  list_fleet_members: {
    definition: {
      name: 'list_fleet_members',
      description: 'Lista os membros ativos da Fleet na mesma empresa. Use para descobrir o ID de um membro antes de chamar spawn_subagent.',
      parameters: {
        type: 'object',
        properties: {
          department_id: { type: 'string', description: 'Filtra por departamento (opcional)' },
        },
      },
    },
    async execute(args, ctx) {
      const where: any = { companyId: ctx.companyId, status: 'ACTIVE' }
      if (args.department_id) where.departmentId = args.department_id
      const members = await prisma.fleetMember.findMany({
        where,
        select: {
          id: true, name: true, displayRole: true, emoji: true, colorTag: true,
          onboarded: true,
          department: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      })
      return ok({ members, total: members.length })
    },
  },

  // ──────────── MISSÕES (auto-agendamento) ────────────
  list_my_missions: {    definition: {
      name: 'list_my_missions',
      description: 'Lista as missões agendadas (recorrentes) do próprio membro.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(_args, ctx) {
      const missions = await prisma.fleetMission.findMany({
        where: { memberId: ctx.agentId, companyId: ctx.companyId },
        select: {
          id: true, title: true, instruction: true, cronExpr: true, cronNlOriginal: true,
          status: true, nextRunAt: true, lastRunAt: true, totalRuns: true, successRuns: true, failedRuns: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      return ok({ missions, total: missions.length })
    },
  },

  create_mission: {
    definition: {
      name: 'create_mission',
      description: 'Cria uma missão agendada para você mesmo executar. Pode ser recorrente (cronNl/cronExpr) ou uma única vez (runOnceAt). Quando o admin mencionar Brasília, use cronTimezone="America/Sao_Paulo".',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título curto da missão' },
          instruction: { type: 'string', description: 'O que você deve fazer quando a missão disparar (em primeira pessoa: "Eu devo...")' },
          cronNl: { type: 'string', description: 'Agendamento em linguagem natural pt-BR (ex: "todo dia às 9h", "segunda a sexta 18h")' },
          cronExpr: { type: 'string', description: 'Cron expression direto (alternativa a cronNl)' },
          runOnceAt: { type: 'string', description: 'Data/hora para disparar UMA única vez. Prefira ISO 8601. Se vier sem offset, será interpretado em cronTimezone.' },
          cronTimezone: { type: 'string', description: 'Timezone IANA do agendamento. Padrão America/Sao_Paulo.' },
          executionMode: { type: 'string', enum: ['AUTONOMOUS', 'REQUIRE_APPROVAL'], description: 'Padrão AUTONOMOUS' },
        },
        required: ['title', 'instruction'],
      },
    },
    async execute(args, ctx) {
      try {
        const { createMission } = await import('../../../fleet/fleet.service.js')
        const mission = await createMission({
          companyId: ctx.companyId,
          memberId: ctx.agentId,
          title: args.title,
          instruction: args.instruction,
          cronExpr: args.cronExpr,
          cronNl: args.cronNl,
          runOnceAt: args.runOnceAt,
          cronTimezone: args.cronTimezone,
          executionMode: args.executionMode || 'AUTONOMOUS',
        } as any)
        await logAudit(ctx, 'create', 'FleetMission', mission.id, null, { title: args.title })
        return ok({ mission: { id: mission.id, title: mission.title, nextRunAt: mission.nextRunAt, cronExpr: mission.cronExpr, cronTimezone: mission.cronTimezone, runOnceAt: mission.runOnceAt } })
      } catch (e: any) {
        return fail(e.message, 'create_mission_failed')
      }
    },
  },

  configure_self: {
    definition: {
      name: 'configure_self',
      description: 'IMPORTANTE: Use esta ferramenta APENAS durante o onboarding (primeira conversa) para se auto-configurar com base no que o administrador disse sobre como você deve trabalhar. Atualiza sua própria personalidade, prompt do sistema, temperature, ferramentas habilitadas, etc. Quando a configuração estiver completa, passe markOnboarded=true para encerrar o modo de configuração.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Atualiza seu próprio nome (opcional)' },
          displayRole: { type: 'string', description: 'Atualiza seu cargo/função (opcional)' },
          systemPrompt: { type: 'string', description: 'Define ou atualiza completamente seu novo system prompt baseado no que o admin pediu. Inclua personalidade, escopo de trabalho, regras, tom de voz.' },
          temperature: { type: 'number', description: 'Temperature 0-2 (criatividade). Padrão 0.7. Use 0.3 para análise/dados, 0.9 para criativo.' },
          maxTokens: { type: 'number', description: 'Max tokens de resposta. Padrão 2000.' },
          emoji: { type: 'string', description: 'Emoji que representa o membro (ex: 💼, 🎯, 📊)' },
          colorTag: { type: 'string', description: 'Cor hex do membro (ex: #8b5cf6)' },
          markOnboarded: { type: 'boolean', description: 'true = encerra o modo onboarding e o membro passa a operar normalmente. Use APENAS quando confirmou que a configuração está completa.' },
        },
        required: [],
      },
    },
    async execute(args, ctx) {
      const memberId = ctx.agentId
      const updateData: any = {}
      if (args.name) updateData.name = args.name
      if (args.displayRole) updateData.displayRole = args.displayRole
      if (args.systemPrompt) updateData.systemPrompt = args.systemPrompt
      if (typeof args.temperature === 'number') updateData.temperature = args.temperature
      if (typeof args.maxTokens === 'number') updateData.maxTokens = args.maxTokens
      if (args.emoji) updateData.emoji = args.emoji
      if (args.colorTag) updateData.colorTag = args.colorTag
      if (args.markOnboarded === true) updateData.onboarded = true

      if (Object.keys(updateData).length === 0) {
        return JSON.stringify({ success: false, error: 'no_changes', message: 'Nenhum campo para atualizar' })
      }

      try {
        const updated = await prisma.fleetMember.update({
          where: { id: memberId, companyId: ctx.companyId },
          data: updateData,
          select: { id: true, name: true, displayRole: true, onboarded: true },
        })
        await logAudit(ctx, 'configure_self', 'FleetMember', memberId, null, updateData)
        return ok({
          message: args.markOnboarded ? 'Configuração concluída! Você está pronto para operar.' : 'Configuração atualizada.',
          member: updated,
          updated_fields: Object.keys(updateData),
        })
      } catch (err: any) {
        return JSON.stringify({ success: false, error: 'configure_failed', message: err.message })
      }
    },
  },

  // ──────────── RACIOCÍNIO (THINK TOOL) ────────────
  // Inspirado no Think Tool do n8n / Anthropic.
  // O modelo registra um pensamento estruturado antes de agir/responder.
  // Não tem efeito colateral — apenas devolve o thought de volta como confirmação,
  // forçando o modelo a tornar o raciocínio explícito e "em voz alta".
  think: {
    definition: {
      name: 'think',
      description: 'Use esta ferramenta para PENSAR ANTES DE AGIR. Registra um raciocínio passo-a-passo (análise do pedido, opções, plano de ferramentas a chamar, riscos). NÃO executa nada externo — é só você pensando em voz alta. Use quando o pedido for ambíguo, multi-passo, ou quando precisar planejar qual sequência de tools chamar. NÃO use para perguntas triviais.',
      parameters: {
        type: 'object',
        properties: {
          thought: {
            type: 'string',
            description: 'Seu raciocínio interno detalhado: o que o admin quer, quais informações você já tem, quais tools precisa chamar e em que ordem, riscos a considerar.',
          },
        },
        required: ['thought'],
      },
    },
    async execute(args, _ctx) {
      const thought = String(args.thought || '').trim()
      if (!thought) return fail('Thought vazio', 'empty_thought')
      // Devolve o próprio thought como confirmação — padrão n8n/Anthropic.
      return ok({ thought, recorded: true })
    },
  },

  // ──────────── PLANO DE TAREFAS (TodoWrite) ────────────
  // Inspirado no TodoWrite do Claude Code / OpenClaude.
  // O agente publica um plano visível de tarefas e vai marcando o progresso.
  // Cada chamada SOBRESCREVE o plano todo (envie a lista completa, não só os deltas).
  // Status válidos: 'pending' | 'in_progress' | 'completed'.
  // Use para missões com 3+ passos, especialmente envios em lote, varreduras ou pipelines longos.
  update_todos: {
    definition: {
      name: 'update_todos',
      description: 'Publica/atualiza o plano de tarefas visível para o admin no chat. Use quando o pedido tiver 3 ou mais passos, especialmente envios em lote ("manda pra todos do pipeline X"), varreduras, ou pipelines longos. Cada chamada SOBRESCREVE o plano todo — envie a lista COMPLETA de tarefas com seus status atuais. Conforme você for executando, chame de novo atualizando o status de cada item. Mantenha apenas UMA tarefa em "in_progress" por vez. Marque "completed" assim que terminar cada uma. Quando todas estiverem "completed", produza a mensagem final em texto para o admin.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Lista COMPLETA de tarefas no estado atual',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Identificador estável da tarefa (use 1, 2, 3... ou um slug curto)' },
                title: { type: 'string', description: 'Descrição curta da tarefa (1 frase)' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Estado atual' },
              },
              required: ['id', 'title', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
    async execute(args, _ctx) {
      const todos = Array.isArray(args.todos) ? args.todos : []
      if (todos.length === 0) return fail('Lista de tarefas vazia', 'empty_todos')
      const inProgress = todos.filter((t: any) => t.status === 'in_progress').length
      if (inProgress > 1) {
        return fail(`Só pode haver 1 tarefa em "in_progress" por vez. Você enviou ${inProgress}.`, 'too_many_in_progress')
      }
      const done = todos.filter((t: any) => t.status === 'completed').length
      return ok({
        todos,
        progress: { completed: done, total: todos.length, percent: Math.round((done / todos.length) * 100) },
        message: `Plano atualizado: ${done}/${todos.length} concluídas. Continue executando.`,
      })
    },
  },

  // ──────────── DELEGAÇÃO — SPAWN SUBAGENT (Onda 2.4) ────────────
  // Permite que um FleetMember delegue uma subtarefa a outro membro da Fleet
  // (ou a si mesmo, pra rodar em paralelo/isolado). Inspirado no padrão
  // "spawn_agent" do evo-nexus e no "subgraph" do langgraph.
  //
  // Proteções:
  //   - max depth 2 (pai → filho → neto; sem mais)
  //   - max fanout 5 por operação pai
  //   - timeout 120s por filho
  //
  // QUANDO USAR: tarefas que podem ser executadas em paralelo por membros
  // com habilidades específicas, ou quando o admin pediu explicitamente
  // "passa pro agente de vendas / financeiro / suporte".
  spawn_subagent: {
    definition: {
      name: 'spawn_subagent',
      description: 'Delega uma subtarefa a outro membro da Fleet (ou a si mesmo em paralelo). ' +
        'Use quando a tarefa requer habilidades de outro membro (ex: "passa pro agente financeiro calcular as comissões"), ' +
        'ou quando é mais eficiente dividir o trabalho. ' +
        'O filho roda de forma SÍNCRONA (aguarda resultado) a menos que use wait_for_result=false. ' +
        'IMPORTANTE: não use se você mesmo consegue executar a tarefa. Evite delegações desnecessárias.',
      parameters: {
        type: 'object',
        properties: {
          target_member_id: {
            type: 'string',
            description: 'ID do FleetMember alvo (use list_fleet_members para descobrir). ' +
              'Deve pertencer à mesma empresa e estar ACTIVE.',
          },
          instruction: {
            type: 'string',
            description: 'Instrução COMPLETA e auto-suficiente para o membro filho. ' +
              'Ele NÃO tem acesso ao histórico desta conversa — inclua todo o contexto necessário.',
          },
          wait_for_result: {
            type: 'boolean',
            description: 'Se true (padrão), aguarda o resultado antes de continuar. ' +
              'Se false, dispara em background e retorna imediatamente com o operationId.',
            default: true,
          },
        },
        required: ['target_member_id', 'instruction'],
      },
    },
    async execute(args, ctx) {
      const targetMemberId = String(args.target_member_id || '').trim()
      const instruction = String(args.instruction || '').trim()
      const waitForResult = args.wait_for_result !== false

      if (!targetMemberId) return fail('Parâmetro "target_member_id" obrigatório', 'missing_param')
      if (!instruction) return fail('Parâmetro "instruction" obrigatório (inclua contexto completo)', 'missing_param')
      if (instruction.length < 10) return fail('Instrução muito curta — inclua contexto suficiente para o membro filho.', 'instruction_too_short')

      const parentOperationId = ctx.operationId
      const parentDepth = ctx.operationDepth ?? 0

      if (!parentOperationId) {
        return fail('spawn_subagent só pode ser chamado dentro de uma FleetOperation ativa.', 'no_operation_ctx')
      }

      try {
        // Import dinâmico pra evitar circular dependency
        const { spawnSubOperation } = await import('../../../../modules/fleet/fleet.service.js')

        if (!waitForResult) {
          // Fire-and-forget: cria a op em background e retorna operationId
          spawnSubOperation({
            parentOperationId,
            parentDepth,
            targetMemberId,
            instruction,
            companyId: ctx.companyId,
          }).catch(err => console.warn('[Fleet spawn] background op falhou:', err.message))

          return ok({
            message: 'Sub-operação disparada em background.',
            targetMemberId,
            instruction,
            waiting: false,
            note: 'Use get_operation_status quando quiser verificar o resultado (feature futura).',
          })
        }

        const result = await spawnSubOperation({
          parentOperationId,
          parentDepth,
          targetMemberId,
          instruction,
          companyId: ctx.companyId,
        })

        return ok({
          operationId: result.operationId,
          status: result.status,
          output: result.output,
          tokensUsed: result.tokensUsed,
          targetMember: (result as any).targetMember,
          targetMemberId,
          instruction,
          waiting: true,
        })
      } catch (err: any) {
        return fail(err.message || 'Falha ao criar sub-operação', 'spawn_failed')
      }
    },
  },
}

// ──────────────────────────────────────────────────────────────────────
// Module export
// ──────────────────────────────────────────────────────────────────────

export const fleetAdminModule: ToolModule = {
  type: 'fleet_admin',
  name: 'Fleet Admin Tools',

  getTools(config: any): AIToolDefinition[] {
    let enabled: string[]
    if (Array.isArray(config)) enabled = config
    else if (config && typeof config === 'object' && Array.isArray(config.enabledTools)) enabled = config.enabledTools
    else enabled = Object.keys(FLEET_TOOLS)

    return enabled.filter(n => FLEET_TOOLS[n]).map(n => FLEET_TOOLS[n]!.definition)
  },

  async execute(toolName, args, _config, ctx): Promise<ToolExecutionResult> {
    // Tool name pode ser o nome da definition; precisamos achar o slot
    let entry: FleetTool | undefined = FLEET_TOOLS[toolName]
    if (!entry) {
      // tentar match por definition.name
      entry = Object.values(FLEET_TOOLS).find(t => t.definition.name === toolName) as FleetTool | undefined
    }
    if (!entry) {
      return {
        success: false,
        result: JSON.stringify({ error: 'fleet_tool_not_found', message: `Fleet tool ${toolName} not found` }),
        error: `Fleet tool ${toolName} not found`,
      }
    }
    const startTime = Date.now()
    try {
      const result = await entry.execute(args, ctx)
      const latencyMs = Date.now() - startTime
      console.log(`[FleetAdmin] ✅ ${toolName} (${latencyMs}ms)`)
      return { success: true, result, metadata: { latencyMs } }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      console.error(`[FleetAdmin] ❌ ${toolName}: ${err.message} (${latencyMs}ms)`)
      return {
        success: false,
        result: JSON.stringify({ error: 'fleet_tool_error', message: err.message }),
        error: err.message,
        metadata: { latencyMs },
      }
    }
  },
}

export const FLEET_ADMIN_TOOL_NAMES = Object.values(FLEET_TOOLS).map(t => t.definition.name)
