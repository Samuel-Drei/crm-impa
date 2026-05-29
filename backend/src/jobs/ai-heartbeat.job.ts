/**
 * AI Heartbeat Job — Monitoramento de saúde dos provedores de IA
 * 
 * Verifica periodicamente a disponibilidade dos providers ativos:
 * - Faz chamada leve (listModels) para verificar conectividade
 * - Atualiza healthStatus: HEALTHY | DEGRADED | DOWN | UNKNOWN
 * - Detecta degradação por erros consecutivos
 * - Integra com smart-router (providers DOWN são excluídos automaticamente)
 * 
 * Intervalo: 5 minutos por padrão
 */

import { prisma } from '../config/database.js'
import { decryptSafe, decryptJSONSafe } from '../config/encryption.js'
import { createProvider } from '../modules/ai/providers/index.js'

const CHECK_INTERVAL_MS = 5 * 60 * 1000  // 5 minutos
const DEGRADED_THRESHOLD = 3   // erros consecutivos para DEGRADED
const DOWN_THRESHOLD = 5       // erros consecutivos para DOWN
const HEALTHY_AFTER = 2        // checks com sucesso para voltar a HEALTHY

type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'

export function startAIHeartbeatJob() {
  console.log('[Heartbeat] Starting AI provider health check job (interval: 5 min)')
  // Primeiro check 30s após boot
  setTimeout(() => runHealthChecks(), 30_000)
  setInterval(() => runHealthChecks(), CHECK_INTERVAL_MS)
}

async function runHealthChecks() {
  try {
    // Buscar todos os providers ativos de todas as empresas
    const providers = await prisma.aIProvider.findMany({
      where: { isActive: true },
      select: {
        id: true,
        companyId: true,
        name: true,
        type: true,
        apiKey: true,
        baseUrl: true,
        model: true,
        oauthData: true,
        healthStatus: true,
        consecutiveErrors: true,
      },
    })

    if (providers.length === 0) return

    console.log(`[Heartbeat] Checking ${providers.length} active AI providers...`)

    // Processar em paralelo mas com limite de concorrência (5 de cada vez)
    const CONCURRENCY = 5
    for (let i = 0; i < providers.length; i += CONCURRENCY) {
      const batch = providers.slice(i, i + CONCURRENCY)
      await Promise.allSettled(batch.map(p => checkProvider(p)))
    }
  } catch (err) {
    console.error('[Heartbeat] Job error:', (err as Error).message)
  }
}

async function checkProvider(provider: {
  id: string
  companyId: string
  name: string
  type: string
  apiKey: string
  baseUrl: string | null
  model: string
  oauthData: any
  healthStatus: string
  consecutiveErrors: number
}) {
  const startTime = Date.now()
  let newStatus: HealthStatus
  let error: string | null = null
  let latencyMs: number

  try {
    // Decriptar credenciais
    const apiKey = decryptSafe(provider.apiKey) as string
    const oauthData = provider.oauthData ? decryptJSONSafe(provider.oauthData as string) : undefined

    if (!apiKey || apiKey === provider.apiKey) {
      // API key não pode ser decriptada — marcar como UNKNOWN
      await prisma.aIProvider.update({
        where: { id: provider.id },
        data: { healthStatus: 'UNKNOWN', lastHealthCheckAt: new Date(), lastHealthError: 'Cannot decrypt API key' },
      })
      return
    }

    // Criar instância do provider e verificar conectividade via listModels
    const instance = createProvider(provider.type as any, apiKey, provider.baseUrl, oauthData)
    
    // Timeout de 15 segundos para o health check
    const result = await Promise.race([
      instance.listModels(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check timeout (15s)')), 15_000)),
    ])

    latencyMs = Date.now() - startTime

    // Sucesso: determinar se é HEALTHY ou saindo de DEGRADED
    if (provider.consecutiveErrors >= DEGRADED_THRESHOLD) {
      // Estava degradado/down — precisa de mais checks com sucesso
      const newErrors = Math.max(0, provider.consecutiveErrors - HEALTHY_AFTER)
      newStatus = newErrors < DEGRADED_THRESHOLD ? 'HEALTHY' : 'DEGRADED'
      await prisma.aIProvider.update({
        where: { id: provider.id },
        data: {
          healthStatus: newStatus,
          lastHealthCheckAt: new Date(),
          lastHealthError: null,
          healthLatencyMs: latencyMs,
          consecutiveErrors: newErrors,
        },
      })
    } else {
      newStatus = 'HEALTHY'
      await prisma.aIProvider.update({
        where: { id: provider.id },
        data: {
          healthStatus: 'HEALTHY',
          lastHealthCheckAt: new Date(),
          lastHealthError: null,
          healthLatencyMs: latencyMs,
          consecutiveErrors: 0,
        },
      })
    }

    if (provider.healthStatus !== 'HEALTHY' && newStatus === 'HEALTHY') {
      console.log(`[Heartbeat] ✅ ${provider.name} recovered → HEALTHY (${latencyMs}ms)`)
    }
  } catch (err) {
    latencyMs = Date.now() - startTime
    error = (err as Error).message?.substring(0, 500)
    const newErrors = provider.consecutiveErrors + 1

    if (newErrors >= DOWN_THRESHOLD) {
      newStatus = 'DOWN'
    } else if (newErrors >= DEGRADED_THRESHOLD) {
      newStatus = 'DEGRADED'
    } else {
      newStatus = provider.healthStatus as HealthStatus
    }

    await prisma.aIProvider.update({
      where: { id: provider.id },
      data: {
        healthStatus: newStatus,
        lastHealthCheckAt: new Date(),
        lastHealthError: error,
        healthLatencyMs: latencyMs,
        consecutiveErrors: newErrors,
      },
    })

    if (newStatus !== provider.healthStatus) {
      console.warn(`[Heartbeat] ⚠️ ${provider.name}: ${provider.healthStatus} → ${newStatus} (${newErrors} errors: ${error})`)
    }
  }
}
