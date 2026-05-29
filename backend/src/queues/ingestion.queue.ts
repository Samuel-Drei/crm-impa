/**
 * Ingestion Queue — Fila Bull dedicada para processamento de knowledge bases
 * Inspirado no Firecrawl (BullMQ queue-worker) + Dify (Celery dataset tasks)
 * 
 * Substitui o setImmediate() por processamento robusto com:
 * - Retry automático em caso de falha
 * - Concorrência controlada (evita sobrecarga de embeddings)
 * - Persistência do job (sobrevive a restart do server)
 * - Visibilidade de progresso via Bull events
 */

import Queue from 'bull'
import { env } from '../config/env.js'
import { prisma } from '../config/database.js'

export const ingestionQueue = new Queue('knowledge-ingestion', {
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: 100, // Manter últimos 100 jobs completos
    removeOnFail: 200,     // Manter últimos 200 jobs com erro
  },
})

// Tipos de job
export interface IngestionJobData {
  sourceId: string
  jobId: string
  companyId: string
  type: 'INDEX_SOURCE' | 'REINDEX_SOURCE' | 'DELETE_SOURCE'
}

/**
 * Registra o worker da fila de ingestão
 * Deve ser chamado uma vez no startup do server
 */
export function startIngestionWorker(): void {
  // Concurrency = 2: evita sobrecarregar a API de embeddings da OpenAI
  ingestionQueue.process('process-source', 2, async (job) => {
    const data = job.data as IngestionJobData
    console.log(`[IngestionQueue] Processando source ${data.sourceId} (job: ${data.jobId}, tipo: ${data.type})`)

    // Import dinâmico para evitar dependência circular
    const { processSource, deleteSourceData } = await import('../modules/ai/rag/ingestion.pipeline.js')

    if (data.type === 'DELETE_SOURCE') {
      await deleteSourceData(data.sourceId)
      return { success: true, type: 'delete' }
    }

    await processSource(data.sourceId, data.jobId)
    return { success: true, type: data.type }
  })

  // Event handlers para logging e rastreabilidade
  ingestionQueue.on('completed', (job, result) => {
    console.log(`[IngestionQueue] Job ${job.id} concluído:`, result)
  })

  ingestionQueue.on('failed', async (job, err) => {
    console.error(`[IngestionQueue] Job ${job.id} falhou (tentativa ${job.attemptsMade}/${job.opts.attempts}):`, err.message)

    // Atualizar status no Postgres se esgotou retries
    const data = job.data as IngestionJobData
    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      try {
        await prisma.aIIngestionJob.update({
          where: { id: data.jobId },
          data: {
            status: 'ERROR',
            errorMessage: `Falha após ${job.attemptsMade} tentativas: ${err.message}`,
            currentStep: 'error',
          },
        })
        await prisma.aIKnowledgeSource.update({
          where: { id: data.sourceId },
          data: { status: 'ERROR', errorMessage: err.message },
        })
      } catch {
        // Ignorar erros de atualização no handler
      }
    }
  })

  ingestionQueue.on('stalled', (job) => {
    console.warn(`[IngestionQueue] Job ${job.id} travou (stalled) — será re-tentado`)
  })

  console.log('[IngestionQueue] Worker de ingestão iniciado (concurrency: 2)')
}

/**
 * Adiciona um job de ingestão à fila
 */
export async function enqueueIngestion(data: IngestionJobData): Promise<string> {
  const job = await ingestionQueue.add('process-source', data, {
    jobId: data.jobId, // Usar jobId do Prisma como ID do Bull (idempotente)
  })
  return job.id as string
}

/**
 * Obtém status de um job na fila
 */
export async function getIngestionJobStatus(jobId: string): Promise<{
  state: string
  progress: number
  attemptsMade: number
} | null> {
  const job = await ingestionQueue.getJob(jobId)
  if (!job) return null

  const state = await job.getState()
  return {
    state,
    progress: typeof job.progress() === 'number' ? job.progress() as number : 0,
    attemptsMade: job.attemptsMade,
  }
}
