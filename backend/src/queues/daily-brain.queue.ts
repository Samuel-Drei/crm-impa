/**
 * Daily Brain Queue — Fila Bull dedicada para o digest diário
 * 1 job por empresa por dia. Concurrency baixa para não estourar APIs de LLM/embedding.
 */

import Queue from 'bull'
import { env } from '../config/env.js'
import { prisma } from '../config/database.js'

export interface DailyBrainJobData {
  companyId: string
  date: string // YYYY-MM-DD
  trigger: 'cron' | 'manual'
}

export const dailyBrainQueue = new Queue('daily-brain', {
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 }, // 30s, 60s, 120s
    removeOnComplete: 100,
    removeOnFail: 300,
    timeout: 30 * 60 * 1000, // 30 min máx por empresa
  },
})

export function startDailyBrainWorker(): void {
  // Concurrency 2: limita carga em LLM + embeddings
  dailyBrainQueue.process('run-digest', 2, async (job) => {
    const data = job.data as DailyBrainJobData
    console.log(`[DailyBrainQueue] Processando empresa ${data.companyId} data ${data.date} (${data.trigger})`)

    // Idempotência: pula se já está DONE
    const existing = await prisma.aIDailyDigest.findUnique({
      where: { companyId_date: { companyId: data.companyId, date: data.date } },
      select: { id: true, status: true },
    })
    if (existing && existing.status === 'DONE') {
      console.log(`[DailyBrainQueue] Empresa ${data.companyId} já tem digest DONE para ${data.date} — pulando`)
      return { success: true, skipped: true }
    }

    // Cria/atualiza registro como RUNNING
    const digest = existing
      ? await prisma.aIDailyDigest.update({
          where: { id: existing.id },
          data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
          select: { id: true },
        })
      : await prisma.aIDailyDigest.create({
          data: { companyId: data.companyId, date: data.date, status: 'RUNNING', startedAt: new Date() },
          select: { id: true },
        })

    try {
      const { runDigestForCompany } = await import('../modules/ai/brain/brain-digest.service.js')
      const { persistDigest } = await import('../modules/ai/brain/brain-persist.service.js')

      const result = await runDigestForCompany({ companyId: data.companyId, date: data.date })
      const persisted = await persistDigest({ companyId: data.companyId, digestId: digest.id, digest: result })

      await prisma.aIDailyDigest.update({
        where: { id: digest.id },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          contactsProcessed: result.metrics.contactsProcessed,
          messagesProcessed: result.metrics.messagesProcessed,
          conversationsTouched: result.metrics.conversationsTouched,
          cardsTouched: result.metrics.cardsTouched,
          tasksTouched: result.metrics.tasksTouched,
          ticketsTouched: result.metrics.ticketsTouched,
          factsCreated: persisted.factsCreated,
          embeddingsGenerated: persisted.embeddingsGenerated,
          tokensUsed: result.metrics.tokensUsed,
          summary: result.executiveSummary,
        },
      })

      console.log(`[DailyBrainQueue] ✓ Empresa ${data.companyId} ${data.date}: ${persisted.factsCreated} fatos, ${persisted.embeddingsGenerated} embeddings, ${result.metrics.tokensUsed} tokens`)
      return { success: true, digestId: digest.id, ...persisted }
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[DailyBrainQueue] ✗ Empresa ${data.companyId} ${data.date}:`, msg)
      await prisma.aIDailyDigest.update({
        where: { id: digest.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: msg.slice(0, 2000) },
      })
      throw err
    }
  })

  dailyBrainQueue.on('failed', (job, err) => {
    console.error(`[DailyBrainQueue] Job ${job.id} falhou:`, err.message)
  })

  console.log('[DailyBrainQueue] Worker registrado (concurrency 2)')
}

/**
 * Enqueue manual de uma data para uma empresa (idempotente — Bull dedupe via jobId).
 */
export async function enqueueDailyBrain(
  companyId: string,
  date: string,
  trigger: 'cron' | 'manual' = 'manual',
): Promise<void> {
  const jobId = `daily-brain:${companyId}:${date}`
  await dailyBrainQueue.add(
    'run-digest',
    { companyId, date, trigger },
    { jobId },
  )
}
