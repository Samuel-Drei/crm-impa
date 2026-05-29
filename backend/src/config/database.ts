import { PrismaClient } from '@prisma/client'
import { env } from './env.js'
import { getTenantCompanyId } from '../core/tenant-context.js'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** Models that have a companyId field and must be tenant-scoped */
const TENANT_MODELS = new Set([
  'User', 'Instance', 'Contact', 'Conversation', 'Template',
  'Campaign', 'Flow', 'Automation', 'AuditLog', 'Label',
  'CustomAttributeDefinition', 'CannedResponse', 'CustomFilter',
  'ConversationAutomation', 'Macro', 'Team', 'WindowSubscriber',
  'AIProvider', 'AIAgent', 'AIKnowledgeBase', 'AIKnowledgeSource',
  'AIKnowledgeDocument', 'AIIngestionJob', 'AITokenReport', 'AIMCPServer',
  'Pipeline', 'Stage', 'Card', 'CompanyModule', 'ScheduledMessage',
  'Organization', 'CustomerAccount', 'LeadProfile',
  'ItemCategory', 'CatalogItem', 'ItemBundle',
  'Proposal', 'Invoice', 'Payment', 'CreditNote',
  'PaymentGatewayConfig', 'Expense', 'ExpenseCategory',
  'Contract', 'ContractTemplate', 'Project', 'Task',
  'DocumentCounter', 'CustomerActivityLog',
])

/** Actions where companyId is injected into the `where` clause */
const SCOPED_ACTIONS = new Set([
  'findFirst', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
])

const client = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})

// Tenant auto-scope middleware: injects companyId into list/bulk queries
client.$use(async (params, next) => {
  const companyId = getTenantCompanyId()

  // Skip if: no tenant context, no model, or model has no companyId
  if (!companyId || !params.model || !TENANT_MODELS.has(params.model)) {
    return next(params)
  }

  if (SCOPED_ACTIONS.has(params.action)) {
    params.args = params.args || {}
    params.args.where = params.args.where || {}
    // Only inject if not already set (explicit filter takes precedence)
    if (!params.args.where.companyId) {
      params.args.where.companyId = companyId
    }
  }

  return next(params)
})

export const prisma = globalForPrisma.prisma ?? client

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
