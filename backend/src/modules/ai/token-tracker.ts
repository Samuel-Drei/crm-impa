/**
 * Token Tracker — helper centralizado para contabilizar uso de tokens IA.
 * Garante que TODA chamada a providers de IA seja registrada no AITokenReport.
 */
import { prisma } from '../../config/database.js'
import { calculateCost } from './cost-calculator.js'

export interface TokenUsageData {
  companyId: string
  agentId: string        // ID real do agente ou tag especial (__prompt_editor__, __scheduling__, etc.)
  instanceId: string     // ID real da instância ou tag especial (__prompt_editor__, __followup__, etc.)
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Registra uso de tokens no relatório diário (upsert).
 * Silencia erros — falha no tracking jamais deve quebrar o fluxo principal.
 */
export async function trackTokenUsage(data: TokenUsageData): Promise<void> {
  try {
    const costUsd = calculateCost(data.model, data.promptTokens, data.completionTokens)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    await prisma.aITokenReport.upsert({
      where: {
        companyId_agentId_instanceId_date: {
          companyId: data.companyId,
          agentId: data.agentId,
          instanceId: data.instanceId,
          date: today,
        },
      },
      create: {
        companyId: data.companyId,
        agentId: data.agentId,
        instanceId: data.instanceId,
        date: today,
        messagesCount: 1,
        sessionsCount: 0,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        totalTokens: data.totalTokens,
        costUsd,
        modelBreakdown: [{ model: data.model, tokens: data.totalTokens, cost: costUsd }],
      },
      update: {
        messagesCount: { increment: 1 },
        promptTokens: { increment: data.promptTokens },
        completionTokens: { increment: data.completionTokens },
        totalTokens: { increment: data.totalTokens },
        costUsd: { increment: costUsd },
      },
    })
  } catch (err) {
    console.error('[TokenTracker] Falha ao registrar uso de tokens:', err)
  }
}
