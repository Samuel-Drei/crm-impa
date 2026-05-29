import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import api from '@/services/api'

interface PlanLimitInfo {
  limit: number   // -1 = unlimited, 0 = blocked, N = numeric limit
  current: number
  allowed: boolean
}

interface PlanLimitsData {
  plan: { id: string; name: string; slug: string } | null
  limits: Record<string, PlanLimitInfo>
}

/**
 * Mapping from featureKey to sidebar paths that should be blocked when limit = 0.
 * Used to show lock icons on blocked menu items.
 */
const FEATURE_TO_PATHS: Record<string, string[]> = {
  maxAiAgents: ['/ai-agents', '/ai-sessions', '/ai-tool-logs', '/ai-mcp-servers', '/ai-token-reports'],
  maxAiProviders: ['/ai-providers'],
  maxKnowledgeBases: ['/ai-knowledge'],
  maxFlows: ['/flows'],
  maxCampaigns: ['/campaigns'],
  maxTeams: ['/teams'],
  maxAutomations: ['/conversation-automations', '/macros', '/automations'],
  maxTemplates: ['/templates'],
  maxLabels: ['/labels'],
  maxInstances: ['/instances'],
  maxContacts: ['/contacts'],
}

/**
 * Mapping from path prefix to featureKey.
 * Used by pages to check if current feature is blocked.
 */
const PATH_TO_FEATURE: Record<string, string> = {
  '/ai-agents': 'maxAiAgents',
  '/ai-providers': 'maxAiProviders',
  '/ai-knowledge': 'maxKnowledgeBases',
  '/ai-sessions': 'maxAiAgents', // AI sessions depend on having agents
  '/ai-tool-logs': 'maxAiAgents',
  '/ai-mcp-servers': 'maxAiAgents',
  '/ai-token-reports': 'maxAiAgents',
  '/flows': 'maxFlows',
  '/campaigns': 'maxCampaigns',
  '/teams': 'maxTeams',
  '/conversation-automations': 'maxAutomations',
  '/macros': 'maxAutomations',
  '/automations': 'maxAutomations',
  '/templates': 'maxTemplates',
  '/labels': 'maxLabels',
}

export function usePlanLimits() {
  const { isAuthenticated, user } = useAuthStore()

  const { data, isLoading } = useQuery<PlanLimitsData>({
    queryKey: ['plan-limits', user?.companyId],
    queryFn: async () => (await api.get('/auth/plan-limits')).data,
    enabled: isAuthenticated,
    staleTime: 60_000, // Cache for 1 min
    refetchInterval: 120_000, // Refresh every 2 min
  })

  const plan = data?.plan ?? null
  const limits = data?.limits ?? {}

  /** Check if a feature is completely blocked (limit = 0) */
  function isFeatureBlocked(featureKey: string): boolean {
    const info = limits[featureKey]
    if (!info) return false // No limit defined = not blocked
    return info.limit === 0
  }

  /** Check if a feature has reached its limit */
  function isLimitReached(featureKey: string): boolean {
    const info = limits[featureKey]
    if (!info) return false
    if (info.limit === -1) return false // unlimited
    if (info.limit === 0) return true // blocked
    return info.current >= info.limit
  }

  /** Get limit info for a feature */
  function getLimit(featureKey: string): PlanLimitInfo | null {
    return limits[featureKey] ?? null
  }

  /** Check if a sidebar path is blocked by plan limits */
  function isPathBlocked(path: string): boolean {
    const featureKey = PATH_TO_FEATURE[path]
    if (!featureKey) return false
    return isFeatureBlocked(featureKey)
  }

  /** Get the feature key for a given path */
  function getFeatureForPath(path: string): string | null {
    return PATH_TO_FEATURE[path] ?? null
  }

  /** Get all blocked paths */
  function getBlockedPaths(): Set<string> {
    const blocked = new Set<string>()
    for (const [featureKey, paths] of Object.entries(FEATURE_TO_PATHS)) {
      if (isFeatureBlocked(featureKey)) {
        paths.forEach(p => blocked.add(p))
      }
    }
    return blocked
  }

  return {
    plan,
    limits,
    isLoading,
    isFeatureBlocked,
    isLimitReached,
    getLimit,
    isPathBlocked,
    getFeatureForPath,
    getBlockedPaths,
  }
}
