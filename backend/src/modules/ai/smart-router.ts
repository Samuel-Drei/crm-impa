/**
 * Smart Router — Roteamento inteligente de modelos/providers
 * 
 * Seleciona o melhor provider+modelo com base em métricas reais:
 * - Latência média (peso 0.3)
 * - Taxa de erro (peso 0.4)
 * - Custo por chamada (peso 0.3)
 * 
 * Fallback automático quando o provider principal falha.
 */

import { prisma } from '../../config/database.js'
import { AIProviderType, RoutingStrategy } from '@prisma/client'
import { getPricing } from './cost-calculator.js'

// ============================================
// TIPOS
// ============================================

interface ProviderCandidate {
  providerId: string
  providerType: AIProviderType
  model: string
  score: number
  avgLatencyMs: number
  errorRate: number
  avgCostPerCall: number
  totalCalls: number
}

interface RoutingDecision {
  providerId: string
  model: string
  candidates: ProviderCandidate[]
  reason: string
}

interface MetricWindow {
  companyId: string
  providerId: string
  model: string
  totalCalls: number
  successCalls: number
  errorCalls: number
  timeoutCalls: number
  avgLatencyMs: number
  p95LatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  avgCostPerCall: number
  totalCostUsd: number
  avgTokensPerCall: number
  errorRate: number
}

// ============================================
// PESOS DO SCORING
// ============================================
const WEIGHT_LATENCY = 0.3
const WEIGHT_ERROR   = 0.4
const WEIGHT_COST    = 0.3

const MIN_CALLS_FOR_ROUTING = 5  // Mínimo de chamadas para considerar métricas

// ============================================
// REGISTRAR MÉTRICA APÓS CADA CHAMADA
// ============================================

export async function recordMetric(params: {
  companyId: string
  providerId: string
  model: string
  latencyMs: number
  success: boolean
  timeout: boolean
  costUsd: number
  tokensUsed: number
}) {
  const { companyId, providerId, model, latencyMs, success, timeout, costUsd, tokensUsed } = params

  // Janela de 1 hora
  const now = new Date()
  const windowStart = new Date(now)
  windowStart.setMinutes(0, 0, 0)
  const windowEnd = new Date(windowStart)
  windowEnd.setHours(windowEnd.getHours() + 1)

  try {
    // Buscar métrica existente para esta janela
    const existing = await prisma.aIProviderMetric.findUnique({
      where: {
        companyId_providerId_model_windowStart: {
          companyId, providerId, model, windowStart,
        },
      },
    })

    if (existing) {
      const newTotal = existing.totalCalls + 1
      const newSuccess = existing.successCalls + (success ? 1 : 0)
      const newErrors = existing.errorCalls + (!success && !timeout ? 1 : 0)
      const newTimeouts = existing.timeoutCalls + (timeout ? 1 : 0)
      const newAvgLatency = (existing.avgLatencyMs * existing.totalCalls + latencyMs) / newTotal
      const newAvgCost = (existing.avgCostPerCall * existing.totalCalls + costUsd) / newTotal
      const newAvgTokens = (existing.avgTokensPerCall * existing.totalCalls + tokensUsed) / newTotal

      // p95 aproximado: manter o maior se estiver no top 5%
      const newP95 = latencyMs > existing.p95LatencyMs ? latencyMs : existing.p95LatencyMs

      await prisma.aIProviderMetric.update({
        where: { id: existing.id },
        data: {
          totalCalls: newTotal,
          successCalls: newSuccess,
          errorCalls: newErrors,
          timeoutCalls: newTimeouts,
          avgLatencyMs: newAvgLatency,
          p95LatencyMs: newP95,
          minLatencyMs: Math.min(existing.minLatencyMs || latencyMs, latencyMs),
          maxLatencyMs: Math.max(existing.maxLatencyMs || 0, latencyMs),
          avgCostPerCall: newAvgCost,
          totalCostUsd: existing.totalCostUsd + costUsd,
          avgTokensPerCall: newAvgTokens,
          errorRate: (newErrors + newTimeouts) / newTotal,
        },
      })
    } else {
      await prisma.aIProviderMetric.create({
        data: {
          companyId,
          providerId,
          model,
          totalCalls: 1,
          successCalls: success ? 1 : 0,
          errorCalls: !success && !timeout ? 1 : 0,
          timeoutCalls: timeout ? 1 : 0,
          avgLatencyMs: latencyMs,
          p95LatencyMs: latencyMs,
          minLatencyMs: latencyMs,
          maxLatencyMs: latencyMs,
          avgCostPerCall: costUsd,
          totalCostUsd: costUsd,
          avgTokensPerCall: tokensUsed,
          errorRate: success ? 0 : 1,
          windowStart,
          windowEnd,
        },
      })
    }
  } catch (err) {
    console.warn('[SmartRouter] Failed to record metric:', (err as Error).message)
  }
}

// ============================================
// SELECIONAR MELHOR PROVIDER
// ============================================

export async function selectBestProvider(params: {
  companyId: string
  excludeProviderIds?: string[]
  preferredModel?: string
  strategy?: RoutingStrategy
  allowedProviderIds?: string[]
}): Promise<RoutingDecision | null> {
  const { companyId, excludeProviderIds = [], strategy = 'BEST_PERFORMANCE', allowedProviderIds } = params

  // Buscar providers ativos da empresa (excluir DOWN pelo heartbeat)
  const whereClause: any = {
    companyId,
    isActive: true,
    id: { notIn: excludeProviderIds },
    healthStatus: { notIn: ['DOWN'] },
  }
  // Se há lista de providers permitidos, filtrar por ela
  if (allowedProviderIds && allowedProviderIds.length > 0) {
    whereClause.id = { in: allowedProviderIds, notIn: excludeProviderIds }
  }

  const providers = await prisma.aIProvider.findMany({
    where: whereClause,
    select: { id: true, type: true, model: true, name: true, healthStatus: true },
  })

  if (providers.length === 0) return null

  // Buscar métricas das últimas 24 horas
  const since = new Date()
  since.setHours(since.getHours() - 24)

  const metrics = await prisma.aIProviderMetric.findMany({
    where: {
      companyId,
      providerId: { in: providers.map(p => p.id) },
      windowStart: { gte: since },
    },
  })

  // Agregar métricas por provider+model
  const aggregated = new Map<string, MetricWindow>()
  for (const m of metrics) {
    const key = `${m.providerId}:${m.model}`
    const existing = aggregated.get(key)
    if (!existing) {
      aggregated.set(key, {
        companyId: m.companyId,
        providerId: m.providerId,
        model: m.model,
        totalCalls: m.totalCalls,
        successCalls: m.successCalls,
        errorCalls: m.errorCalls,
        timeoutCalls: m.timeoutCalls,
        avgLatencyMs: m.avgLatencyMs,
        p95LatencyMs: m.p95LatencyMs,
        minLatencyMs: m.minLatencyMs,
        maxLatencyMs: m.maxLatencyMs,
        avgCostPerCall: m.avgCostPerCall,
        totalCostUsd: m.totalCostUsd,
        avgTokensPerCall: m.avgTokensPerCall,
        errorRate: m.errorRate,
      })
    } else {
      const totalCalls = existing.totalCalls + m.totalCalls
      existing.avgLatencyMs = (existing.avgLatencyMs * existing.totalCalls + m.avgLatencyMs * m.totalCalls) / totalCalls
      existing.avgCostPerCall = (existing.avgCostPerCall * existing.totalCalls + m.avgCostPerCall * m.totalCalls) / totalCalls
      existing.totalCalls = totalCalls
      existing.successCalls += m.successCalls
      existing.errorCalls += m.errorCalls
      existing.timeoutCalls += m.timeoutCalls
      existing.totalCostUsd += m.totalCostUsd
      existing.p95LatencyMs = Math.max(existing.p95LatencyMs, m.p95LatencyMs)
      existing.errorRate = (existing.errorCalls + existing.timeoutCalls) / totalCalls
    }
  }

  // Construir candidatos com score
  const candidates: ProviderCandidate[] = []

  for (const provider of providers) {
    const key = `${provider.id}:${provider.model}`
    const metric = aggregated.get(key)

    if (metric && metric.totalCalls >= MIN_CALLS_FOR_ROUTING) {
      candidates.push({
        providerId: provider.id,
        providerType: provider.type,
        model: provider.model,
        avgLatencyMs: metric.avgLatencyMs,
        errorRate: metric.errorRate,
        avgCostPerCall: metric.avgCostPerCall,
        totalCalls: metric.totalCalls,
        score: 0, // calculado abaixo
      })
    } else {
      // Sem métricas suficientes: usar custo teórico como estimativa
      const pricing = getPricing(provider.model)
      const estimatedCost = pricing ? (pricing.inputPer1M * 500 + pricing.outputPer1M * 200) / 1_000_000 : 0.001
      candidates.push({
        providerId: provider.id,
        providerType: provider.type,
        model: provider.model,
        avgLatencyMs: 2000, // estimativa conservadora
        errorRate: 0,
        avgCostPerCall: estimatedCost,
        totalCalls: 0,
        score: 0,
      })
    }
  }

  if (candidates.length === 0) return null

  // ── ROUND_ROBIN: seleção aleatória (distribui carga / evita rate limit) ──
  if (strategy === 'ROUND_ROBIN') {
    // Filtrar apenas providers saudáveis (não DEGRADED e sem erros altos)
    const healthy = candidates.filter(c => c.errorRate < 0.5)
    const pool = healthy.length > 0 ? healthy : candidates
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return {
      providerId: pick.providerId,
      model: pick.model,
      candidates,
      reason: `Round-robin: distribuição aleatória entre ${pool.length} providers`,
    }
  }

  // Normalizar e calcular scores (menor = melhor para todos os fatores)
  const maxLatency = Math.max(...candidates.map(c => c.avgLatencyMs), 1)
  const maxCost = Math.max(...candidates.map(c => c.avgCostPerCall), 0.000001)

  // ── COST_OPTIMIZED: prioriza custo ──
  const wLatency = strategy === 'COST_OPTIMIZED' ? 0.1 : WEIGHT_LATENCY
  const wError   = strategy === 'COST_OPTIMIZED' ? 0.3 : WEIGHT_ERROR
  const wCost    = strategy === 'COST_OPTIMIZED' ? 0.6 : WEIGHT_COST

  for (const c of candidates) {
    const latencyScore = c.avgLatencyMs / maxLatency     // 0-1, menor melhor
    const errorScore = c.errorRate                        // 0-1, menor melhor
    const costScore = c.avgCostPerCall / maxCost          // 0-1, menor melhor

    // Score final: menor = melhor
    c.score = (latencyScore * wLatency) + (errorScore * wError) + (costScore * wCost)

    // Penalizar providers DEGRADED (heartbeat)
    const provider = providers.find(p => p.id === c.providerId)
    if (provider?.healthStatus === 'DEGRADED') {
      c.score += 0.3 // Penalidade significativa
    }
  }

  // Ordenar por score (menor primeiro)
  candidates.sort((a, b) => a.score - b.score)

  const best = candidates[0]
  const stratLabel = strategy === 'COST_OPTIMIZED' ? 'custo otimizado' : 'melhor performance'
  return {
    providerId: best.providerId,
    model: best.model,
    candidates,
    reason: best.totalCalls >= MIN_CALLS_FOR_ROUTING
      ? `${stratLabel}: latência=${best.avgLatencyMs.toFixed(0)}ms, erros=${(best.errorRate * 100).toFixed(1)}%, custo=$${best.avgCostPerCall.toFixed(6)}`
      : `${stratLabel} (estimativa, ${best.totalCalls} chamadas)`,
  }
}

// ============================================
// OBTER MÉTRICAS PARA DASHBOARD
// ============================================

export async function getProviderMetrics(companyId: string, hours: number = 24) {
  const since = new Date()
  since.setHours(since.getHours() - hours)

  const metrics = await prisma.aIProviderMetric.findMany({
    where: { companyId, windowStart: { gte: since } },
    include: { provider: { select: { name: true, type: true } } },
    orderBy: { windowStart: 'desc' },
  })

  // Agregar por provider
  const byProvider = new Map<string, {
    providerId: string
    providerName: string
    providerType: AIProviderType
    totalCalls: number
    successRate: number
    avgLatencyMs: number
    totalCostUsd: number
    models: string[]
    timeline: { windowStart: Date; calls: number; avgLatency: number; errorRate: number }[]
  }>()

  for (const m of metrics) {
    const key = m.providerId
    const existing = byProvider.get(key)
    if (!existing) {
      byProvider.set(key, {
        providerId: m.providerId,
        providerName: m.provider.name,
        providerType: m.provider.type,
        totalCalls: m.totalCalls,
        successRate: m.successCalls / Math.max(m.totalCalls, 1),
        avgLatencyMs: m.avgLatencyMs,
        totalCostUsd: m.totalCostUsd,
        models: [m.model],
        timeline: [{ windowStart: m.windowStart, calls: m.totalCalls, avgLatency: m.avgLatencyMs, errorRate: m.errorRate }],
      })
    } else {
      const totalCalls = existing.totalCalls + m.totalCalls
      existing.avgLatencyMs = (existing.avgLatencyMs * existing.totalCalls + m.avgLatencyMs * m.totalCalls) / totalCalls
      existing.totalCalls = totalCalls
      existing.totalCostUsd += m.totalCostUsd
      if (!existing.models.includes(m.model)) existing.models.push(m.model)
      existing.timeline.push({ windowStart: m.windowStart, calls: m.totalCalls, avgLatency: m.avgLatencyMs, errorRate: m.errorRate })
    }
  }

  return Array.from(byProvider.values())
}

// ============================================
// LIMPAR MÉTRICAS ANTIGAS
// ============================================

export async function cleanOldMetrics(companyId: string, retentionDays: number = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)

  const { count } = await prisma.aIProviderMetric.deleteMany({
    where: { companyId, windowEnd: { lt: cutoff } },
  })

  return { deleted: count }
}
