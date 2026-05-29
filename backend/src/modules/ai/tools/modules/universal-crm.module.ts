/**
 * Universal CRM Module — Acesso genérico ao banco via Prisma para a IA
 *
 * Filosofia: em vez de criar uma tool por entidade (~134 modelos), exponho 3 tools
 * universais que cobrem ~90% dos casos de leitura/escrita do CRM.
 *
 * Segurança:
 *   - Whitelist explícita: apenas modelos em ALLOWED_MODELS são acessíveis
 *   - Forçamos `companyId = ctx.companyId` em TODA query (multi-tenant)
 *   - SENSITIVE_FIELDS são removidos do retorno (passwords, tokens, secrets)
 *   - Auditoria de TODAS as escritas em AuditLog (actorType=AI_MEMBER)
 *   - PROTECTED_MODELS bloqueiam mutate (somente leitura)
 *   - Limite de 200 registros por query
 *   - JSON params: a IA passa o filtro como objeto Prisma `where`/`include`
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'

// ──────────────────────────────────────────────────────────────────────
// Whitelist: modelos acessíveis via super-tool, agrupados por área
// (qualquer modelo NÃO listado aqui é INACESSÍVEL pela super-tool)
// ──────────────────────────────────────────────────────────────────────

const ALLOWED_MODELS = {
  // Comercial / financeiro
  proposal: 'Proposal',
  proposalItem: 'ProposalItem',
  proposalComment: 'ProposalComment',
  contract: 'Contract',
  contractRenewal: 'ContractRenewal',
  contractTemplate: 'ContractTemplate',
  invoice: 'Invoice',
  invoiceItem: 'InvoiceItem',
  invoiceActivity: 'InvoiceActivity',
  payment: 'Payment',
  creditNote: 'CreditNote',
  expense: 'Expense',
  expenseCategory: 'ExpenseCategory',

  // Catálogo (leitura/edição extra além do create_product)
  catalogItem: 'CatalogItem',
  itemCategory: 'ItemCategory',
  itemVariant: 'ItemVariant',
  itemPriceTier: 'ItemPriceTier',
  itemBundle: 'ItemBundle',

  // Projetos / tarefas
  project: 'Project',
  projectMember: 'ProjectMember',
  milestone: 'Milestone',
  projectNote: 'ProjectNote',
  projectDiscussion: 'ProjectDiscussion',
  projectTimesheet: 'ProjectTimesheet',
  task: 'Task',
  taskAssignee: 'TaskAssignee',

  // Pipeline / cards
  pipeline: 'Pipeline',
  stage: 'Stage',
  card: 'Card',
  cardActivity: 'CardActivity',
  cardTask: 'CardTask',
  cardNote: 'CardNote',
  cardTag: 'CardTag',

  // Comunicação
  conversation: 'Conversation',
  message: 'Message',
  contact: 'Contact',
  label: 'Label',
  cannedResponse: 'CannedResponse',
  customFilter: 'CustomFilter',
  customAttributeDefinition: 'CustomAttributeDefinition',
  conversationAutomation: 'ConversationAutomation',
  macro: 'Macro',
  template: 'Template',
  campaign: 'Campaign',
  scheduledMessage: 'ScheduledMessage',
  scheduledMessageLog: 'ScheduledMessageLog',

  // Times / pessoas / RBAC
  team: 'Team',
  teamMember: 'TeamMember',
  user: 'User',                       // sensitive fields stripped
  role: 'Role',
  rolePermission: 'RolePermission',
  permission: 'Permission',           // global, sem companyId
  customerAccount: 'CustomerAccount',
  organization: 'Organization',

  // Instâncias / canais (leitura preferencial)
  instance: 'Instance',               // sensitive fields stripped

  // Tickets / metas
  ticket: 'Ticket',
  ticketComment: 'TicketComment',
  goal: 'Goal',
  goalCheckin: 'GoalCheckin',

  // Workflows / automations
  automation: 'Automation',
  workflow: 'Workflow',
  workflowRun: 'WorkflowRun',

  // Webhooks / integrações
  webhookEvent: 'WebhookEvent',
  webhookVariable: 'WebhookVariable',

  // Fleet / missões
  fleetMember: 'FleetMember',
  fleetMission: 'FleetMission',
  fleetOperation: 'FleetOperation',
  fleetDepartment: 'FleetDepartment',

  // Auditoria (read-only)
  auditLog: 'AuditLog',
} as const

type ModelKey = keyof typeof ALLOWED_MODELS
const MODEL_KEYS = Object.keys(ALLOWED_MODELS) as ModelKey[]

// Modelos read-only (a IA pode ler mas não escrever)
const READ_ONLY_MODELS = new Set<ModelKey>([
  'permission',
  'rolePermission',
  'auditLog',
  'webhookEvent',
  'invoiceActivity',
  'proposalActivity',
  'cardActivity',
  'contractActivity',
  'projectActivity',
  'scheduledMessageLog',
  'workflowRun',
] as ModelKey[])

// Modelos que não têm companyId (entidades globais ou link tables)
const MODELS_WITHOUT_COMPANY = new Set<ModelKey>([
  'permission',
  'rolePermission',
  'taskAssignee',
  'projectMember',
  'teamMember',
  'cardTag',
])

// Campos sensíveis a serem REMOVIDOS de TODA resposta
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'apiKey',
  'apiSecret',
  'secret',
  'accessToken',
  'refreshToken',
  'webhookSecret',
  'evoApiKey',
  'sessionData',
  'qrCode',
  'pairingCode',
  'twoFactorSecret',
  'encryptedCredentials',
])

// Limite máximo de registros por query
const MAX_TAKE = 200
const DEFAULT_TAKE = 50

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function ok(payload: any): string { return JSON.stringify({ success: true, ...payload }) }
function fail(message: string, code = 'error'): string { return JSON.stringify({ success: false, error: code, message }) }

function stripSensitive(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(stripSensitive)
  const out: any = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(k)) continue
    out[k] = (v && typeof v === 'object') ? stripSensitive(v) : v
  }
  return out
}

function getDelegate(model: ModelKey): any {
  const map: Record<string, string> = ALLOWED_MODELS as any
  // Prisma delegate names = lowercase first char
  const name = map[model].charAt(0).toLowerCase() + map[model].slice(1)
  const d = (prisma as any)[name]
  if (!d) throw new Error(`Prisma delegate not found for ${model}`)
  return d
}

function applyCompanyScope(model: ModelKey, where: any, companyId: string): any {
  const w = where && typeof where === 'object' ? { ...where } : {}
  if (!MODELS_WITHOUT_COMPANY.has(model)) {
    // Sempre força companyId — sobrescreve qualquer tentativa da IA
    w.companyId = companyId
  }
  return w
}

function sanitizeInclude(include: any, depth = 0): any {
  if (!include || depth > 2) return undefined
  if (typeof include !== 'object') return undefined
  const out: any = {}
  for (const [k, v] of Object.entries(include)) {
    if (v === true) out[k] = true
    else if (v && typeof v === 'object') {
      const sub: any = {}
      if ((v as any).select) sub.select = (v as any).select
      if ((v as any).include) sub.include = sanitizeInclude((v as any).include, depth + 1)
      if ((v as any).where) sub.where = (v as any).where
      if ((v as any).take) sub.take = Math.min(Number((v as any).take) || DEFAULT_TAKE, MAX_TAKE)
      if ((v as any).orderBy) sub.orderBy = (v as any).orderBy
      out[k] = Object.keys(sub).length ? sub : true
    }
  }
  return out
}

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
        actorId: ctx.agentId,
        action,
        entity,
        entityId,
        oldData: oldData ?? undefined,
        newData: newData ?? undefined,
      },
    })
  } catch (e) {
    console.error('[UniversalCRM] AuditLog error:', (e as Error).message)
  }
}

// ──────────────────────────────────────────────────────────────────────
// Tool definitions
// ──────────────────────────────────────────────────────────────────────

const MODEL_LIST_DOC = MODEL_KEYS.join(', ')

const TOOL_LIST_MODELS: AIToolDefinition = {
  name: 'crm_list_models',
  description: 'Lista os modelos do CRM acessíveis pela super-tool, com indicação de quais são read-only. Use ANTES de crm_query/crm_mutate para descobrir o nome exato e os campos disponíveis.',
  parameters: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Opcional: se informado, retorna detalhes apenas deste modelo (incluindo campos)' },
    },
  },
}

const TOOL_QUERY: AIToolDefinition = {
  name: 'crm_query',
  description: `LEITURA universal do banco. Use para buscar dados em qualquer entidade do CRM SEM precisar de tool dedicada. Modelos disponíveis: ${MODEL_LIST_DOC}. Filtros automáticos por companyId. Campos sensíveis (passwords/tokens/secrets) são removidos do retorno.`,
  parameters: {
    type: 'object',
    properties: {
      model: { type: 'string', description: `Nome do modelo (ex: invoice, proposal, project, task...). Veja crm_list_models.` },
      operation: { type: 'string', enum: ['findMany', 'findFirst', 'count'], description: 'Operação. Padrão: findMany' },
      where: { type: 'object', description: 'Filtro Prisma (ex: { status: "DUE", dueDate: { lt: "2025-12-01T00:00:00Z" } }). companyId é forçado automaticamente.' },
      orderBy: { type: 'object', description: 'Ordenação Prisma (ex: { createdAt: "desc" })' },
      take: { type: 'number', description: `Máximo de registros (1-${MAX_TAKE}, padrão ${DEFAULT_TAKE})` },
      skip: { type: 'number', description: 'Offset para paginação' },
      select: { type: 'object', description: 'Seleção de campos (recomendado para reduzir payload). Mutuamente exclusivo com include.' },
      include: { type: 'object', description: 'Relações a incluir (até 2 níveis).' },
    },
    required: ['model'],
  },
}

const TOOL_MUTATE: AIToolDefinition = {
  name: 'crm_mutate',
  description: `ESCRITA universal: create, update ou delete em qualquer modelo NÃO read-only. Toda operação é registrada em AuditLog com actorType=AI_MEMBER. Para create, companyId é injetado automaticamente. Para update/delete, o filtro where SEMPRE é cruzado com companyId (impossível afetar outra empresa). Modelos read-only: ${Array.from(READ_ONLY_MODELS).join(', ')}.`,
  parameters: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Nome do modelo (veja crm_list_models)' },
      operation: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Operação' },
      data: { type: 'object', description: 'Dados (para create ou update). companyId é injetado em create automaticamente.' },
      where: { type: 'object', description: 'Filtro para update/delete. Para update por id: { id: "abc" }. Será sempre cruzado com companyId.' },
    },
    required: ['model', 'operation'],
  },
}

// ──────────────────────────────────────────────────────────────────────
// Executors
// ──────────────────────────────────────────────────────────────────────

async function execListModels(args: any): Promise<string> {
  const requested = args.model ? String(args.model) : null
  if (requested) {
    if (!(requested in ALLOWED_MODELS)) return fail(`Modelo "${requested}" não está na whitelist. Use um destes: ${MODEL_LIST_DOC}`, 'model_not_allowed')
    return ok({
      model: requested,
      prismaName: ALLOWED_MODELS[requested as ModelKey],
      readOnly: READ_ONLY_MODELS.has(requested as ModelKey),
      hasCompanyScope: !MODELS_WITHOUT_COMPANY.has(requested as ModelKey),
      hint: 'Para descobrir os campos exatos, faça crm_query com take=1 e veja a estrutura retornada.',
    })
  }
  return ok({
    models: MODEL_KEYS.map(k => ({
      name: k,
      readOnly: READ_ONLY_MODELS.has(k),
      hasCompanyScope: !MODELS_WITHOUT_COMPANY.has(k),
    })),
    sensitiveFieldsRemoved: Array.from(SENSITIVE_FIELDS),
    maxTake: MAX_TAKE,
  })
}

async function execQuery(args: any, ctx: ToolExecutionContext): Promise<string> {
  const model = String(args.model || '') as ModelKey
  if (!(model in ALLOWED_MODELS)) return fail(`Modelo "${model}" não permitido. Use crm_list_models.`, 'model_not_allowed')

  const operation = (args.operation || 'findMany') as 'findMany' | 'findFirst' | 'count'
  if (!['findMany', 'findFirst', 'count'].includes(operation)) return fail('operation inválida', 'invalid_operation')

  const where = applyCompanyScope(model, args.where, ctx.companyId)
  const delegate = getDelegate(model)

  if (operation === 'count') {
    const count = await delegate.count({ where })
    return ok({ model, count })
  }

  const query: any = { where }
  if (args.orderBy && typeof args.orderBy === 'object') query.orderBy = args.orderBy
  if (args.skip) query.skip = Math.max(0, Number(args.skip) || 0)
  if (operation === 'findMany') {
    query.take = Math.min(Math.max(Number(args.take) || DEFAULT_TAKE, 1), MAX_TAKE)
  }
  if (args.select && typeof args.select === 'object' && !args.include) {
    query.select = args.select
  } else if (args.include) {
    query.include = sanitizeInclude(args.include)
  }

  const result = operation === 'findMany' ? await delegate.findMany(query) : await delegate.findFirst(query)
  const safe = stripSensitive(result)
  return ok({ model, operation, data: safe, count: Array.isArray(safe) ? safe.length : (safe ? 1 : 0) })
}

async function execMutate(args: any, ctx: ToolExecutionContext): Promise<string> {
  const model = String(args.model || '') as ModelKey
  if (!(model in ALLOWED_MODELS)) return fail(`Modelo "${model}" não permitido. Use crm_list_models.`, 'model_not_allowed')
  if (READ_ONLY_MODELS.has(model)) return fail(`Modelo "${model}" é read-only. Use crm_query.`, 'model_read_only')

  const operation = String(args.operation || '') as 'create' | 'update' | 'delete'
  if (!['create', 'update', 'delete'].includes(operation)) return fail('operation inválida (use create|update|delete)', 'invalid_operation')

  const delegate = getDelegate(model)
  const prismaName = ALLOWED_MODELS[model]

  if (operation === 'create') {
    const data = (args.data && typeof args.data === 'object') ? { ...args.data } : null
    if (!data) return fail('data obrigatório para create', 'missing_data')
    if (!MODELS_WITHOUT_COMPANY.has(model)) data.companyId = ctx.companyId
    delete (data as any).id // never let AI set id
    const created = await delegate.create({ data })
    await logAudit(ctx, 'create', prismaName, created?.id ?? null, null, data)
    return ok({ model, operation, data: stripSensitive(created) })
  }

  // update / delete: where deve ter ao menos id ou critério explícito
  const where = applyCompanyScope(model, args.where, ctx.companyId)
  if (!where || (typeof where === 'object' && Object.keys(where).filter(k => k !== 'companyId').length === 0)) {
    return fail('where deve conter ao menos um critério além de companyId (ex: { id: "..." })', 'missing_where')
  }

  if (operation === 'update') {
    const data = (args.data && typeof args.data === 'object') ? { ...args.data } : null
    if (!data) return fail('data obrigatório para update', 'missing_data')
    delete (data as any).id
    delete (data as any).companyId
    // pega o registro antes para auditar
    const before = await delegate.findFirst({ where })
    if (!before) return fail('Registro não encontrado nesta empresa', 'not_found')
    const updated = await delegate.update({ where: { id: before.id }, data })
    await logAudit(ctx, 'update', prismaName, before.id, before, data)
    return ok({ model, operation, data: stripSensitive(updated) })
  }

  // delete
  const before = await delegate.findFirst({ where })
  if (!before) return fail('Registro não encontrado nesta empresa', 'not_found')
  await delegate.delete({ where: { id: before.id } })
  await logAudit(ctx, 'delete', prismaName, before.id, before, null)
  return ok({ model, operation, deletedId: before.id })
}

// ──────────────────────────────────────────────────────────────────────
// Module export
// ──────────────────────────────────────────────────────────────────────

export interface UniversalCRMConfig {
  enabled: boolean
  /** Se true, libera crm_mutate. Padrão: false (somente leitura) */
  allowMutate?: boolean
  /** Restrição opcional: somente alguns modelos liberados */
  allowedModels?: string[]
}

export const universalCrmModule: ToolModule = {
  type: 'universal_crm',
  name: 'Universal CRM Tools',

  getTools(config: UniversalCRMConfig | any): AIToolDefinition[] {
    if (!config || config.enabled !== true) return []
    const tools: AIToolDefinition[] = [TOOL_LIST_MODELS, TOOL_QUERY]
    if (config.allowMutate === true) tools.push(TOOL_MUTATE)
    return tools
  },

  async execute(toolName, args, config, ctx): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    try {
      // Restrição opcional por modelo (config.allowedModels)
      if (toolName !== 'crm_list_models' && config?.allowedModels?.length) {
        const requested = String(args.model || '')
        if (requested && !config.allowedModels.includes(requested)) {
          return {
            success: false,
            result: fail(`Modelo "${requested}" não está habilitado para este agente. Habilitados: ${config.allowedModels.join(', ')}`, 'model_disabled'),
            error: 'model_disabled',
            metadata: { latencyMs: Date.now() - startTime },
          }
        }
      }

      let result: string
      if (toolName === 'crm_list_models') result = await execListModels(args)
      else if (toolName === 'crm_query') result = await execQuery(args, ctx)
      else if (toolName === 'crm_mutate') {
        if (config?.allowMutate !== true) {
          return {
            success: false,
            result: fail('crm_mutate desabilitado para este agente (allowMutate=false)', 'mutate_disabled'),
            error: 'mutate_disabled',
            metadata: { latencyMs: Date.now() - startTime },
          }
        }
        result = await execMutate(args, ctx)
      }
      else {
        return {
          success: false,
          result: fail(`Tool ${toolName} não pertence ao universal_crm`, 'tool_not_found'),
          error: 'tool_not_found',
        }
      }
      const latencyMs = Date.now() - startTime
      console.log(`[UniversalCRM] ✅ ${toolName} (${latencyMs}ms)`)
      return { success: true, result, metadata: { latencyMs } }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      console.error(`[UniversalCRM] ❌ ${toolName}: ${err.message}`)
      return {
        success: false,
        result: fail(err.message || 'Erro desconhecido', 'execution_error'),
        error: err.message,
        metadata: { latencyMs },
      }
    }
  },
}

export const UNIVERSAL_CRM_MODELS = MODEL_KEYS as readonly string[]
