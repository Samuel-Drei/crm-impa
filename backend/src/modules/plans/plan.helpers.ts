import { prisma } from '../../config/database.js'

/** Default plan definitions with their limits */
const DEFAULT_PLANS = [
  {
    name: 'Gratuito',
    slug: 'free',
    description: 'Plano gratuito com recursos limitados',
    price: 0,
    isDefault: true,
    sortOrder: 0,
    limits: {
      maxUsers: 3,
      maxInstances: 1,
      maxContacts: 500,
      maxCampaigns: 5,
      maxFlows: 3,
      maxTeams: 1,
      maxAiAgents: 0,
      maxAiProviders: 0,
      maxKnowledgeBases: 0,
      maxTemplates: 10,
      maxAutomations: 3,
      maxLabels: 10,
    },
  },
  {
    name: 'Básico',
    slug: 'basic',
    description: 'Plano básico para pequenas empresas',
    price: 97,
    isDefault: false,
    sortOrder: 1,
    limits: {
      maxUsers: 10,
      maxInstances: 3,
      maxContacts: 5000,
      maxCampaigns: 50,
      maxFlows: 20,
      maxTeams: 5,
      maxAiAgents: 2,
      maxAiProviders: 1,
      maxKnowledgeBases: 2,
      maxTemplates: 50,
      maxAutomations: 20,
      maxLabels: 50,
    },
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'Plano profissional para empresas em crescimento',
    price: 297,
    isDefault: false,
    sortOrder: 2,
    limits: {
      maxUsers: 50,
      maxInstances: 10,
      maxContacts: 50000,
      maxCampaigns: 500,
      maxFlows: 100,
      maxTeams: 20,
      maxAiAgents: 10,
      maxAiProviders: 5,
      maxKnowledgeBases: 10,
      maxTemplates: 200,
      maxAutomations: 100,
      maxLabels: -1,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Plano enterprise com acesso total e ilimitado',
    price: 997,
    isDefault: false,
    sortOrder: 3,
    limits: {
      maxUsers: -1,
      maxInstances: -1,
      maxContacts: -1,
      maxCampaigns: -1,
      maxFlows: -1,
      maxTeams: -1,
      maxAiAgents: -1,
      maxAiProviders: -1,
      maxKnowledgeBases: -1,
      maxTemplates: -1,
      maxAutomations: -1,
      maxLabels: -1,
    },
  },
]

/**
 * Ensures default plans exist in the database.
 * Creates missing plans and their limits; does not overwrite existing customizations.
 * Also links any unlinked companies to their plan by slug match.
 */
export async function ensureDefaultPlans() {
  for (const planDef of DEFAULT_PLANS) {
    const existing = await prisma.plan.findUnique({ where: { slug: planDef.slug } })

    if (!existing) {
      const plan = await prisma.plan.create({
        data: {
          name: planDef.name,
          slug: planDef.slug,
          description: planDef.description,
          price: planDef.price,
          isDefault: planDef.isDefault,
          sortOrder: planDef.sortOrder,
        },
      })

      // Create limits for this plan
      for (const [featureKey, limitValue] of Object.entries(planDef.limits)) {
        await prisma.planLimit.create({
          data: { planId: plan.id, featureKey, limitValue },
        })
      }

      console.log(`[Plans] Created plan: ${plan.name} with ${Object.keys(planDef.limits).length} limits`)
    }
  }

  // Link existing companies that have plan string but no planId
  const unlinked = await prisma.company.findMany({
    where: { planId: null },
    select: { id: true, plan: true },
  })

  for (const company of unlinked) {
    const plan = await prisma.plan.findUnique({ where: { slug: company.plan || 'free' } })
    if (plan) {
      await prisma.company.update({
        where: { id: company.id },
        data: { planId: plan.id },
      })
      console.log(`[Plans] Linked company ${company.id} to plan ${plan.slug}`)
    }
  }
}

/**
 * Feature key to Prisma model mapping for counting resources.
 */
export const FEATURE_KEY_MODEL_MAP: Record<string, string> = {
  maxUsers: 'user',
  maxInstances: 'instance',
  maxContacts: 'contact',
  maxCampaigns: 'campaign',
  maxFlows: 'flow',
  maxTeams: 'team',
  maxAiAgents: 'aIAgent',
  maxAiProviders: 'aIProvider',
  maxKnowledgeBases: 'aIKnowledgeBase',
  maxTemplates: 'template',
  maxAutomations: '_automation_composite', // Special: sum of multiple models
  maxLabels: 'label',
}

/**
 * Check if a company has reached its plan limit for a given feature.
 * Returns { allowed: boolean, current: number, limit: number, planName: string }
 */
export async function checkPlanLimit(companyId: string, featureKey: string): Promise<{
  allowed: boolean
  current: number
  limit: number
  planName: string
}> {
  // Fetch company with plan + limits
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      planRef: {
        select: {
          name: true,
          limits: {
            where: { featureKey },
            select: { limitValue: true },
          },
        },
      },
    },
  })

  // No plan assigned = no limits (for backward compat, treat as unlimited)
  if (!company?.planRef) {
    return { allowed: true, current: 0, limit: -1, planName: 'Sem plano' }
  }

  const limitRow = company.planRef.limits[0]
  if (!limitRow) {
    // Feature key not defined for this plan = no limit
    return { allowed: true, current: 0, limit: -1, planName: company.planRef.name }
  }

  const limitValue = limitRow.limitValue

  // -1 = unlimited
  if (limitValue === -1) {
    return { allowed: true, current: 0, limit: -1, planName: company.planRef.name }
  }

  // 0 = completely blocked (module not available)
  if (limitValue === 0) {
    return { allowed: false, current: 0, limit: 0, planName: company.planRef.name }
  }

  // Count current resources
  let currentCount = 0

  if (featureKey === 'maxAutomations') {
    // Sum of conversation automations + macros
    const [automations, macros] = await Promise.all([
      prisma.conversationAutomation.count({ where: { companyId } }),
      prisma.macro.count({ where: { companyId } }),
    ])
    currentCount = automations + macros
  } else if (featureKey === 'maxInstances') {
    // Only count active instances (soft-deleted have isActive: false)
    currentCount = await prisma.instance.count({ where: { companyId, isActive: true } })
  } else {
    const modelName = FEATURE_KEY_MODEL_MAP[featureKey]
    if (modelName && (prisma as any)[modelName]) {
      currentCount = await (prisma as any)[modelName].count({ where: { companyId } })
    }
  }

  return {
    allowed: currentCount < limitValue,
    current: currentCount,
    limit: limitValue,
    planName: company.planRef.name,
  }
}
