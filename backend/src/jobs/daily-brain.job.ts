/**
 * Daily Brain Cron Job
 *
 * Verifica a cada 5 minutos se alguma empresa precisa rodar o digest do dia anterior.
 * Cada empresa roda às 02:00 da SUA timezone (não do servidor).
 * Idempotente — usa jobId determinístico no Bull.
 */

import { prisma } from '../config/database.js'
import { enqueueDailyBrain } from '../queues/daily-brain.queue.js'
import { yesterdayInTz } from '../modules/ai/brain/brain-digest.service.js'

// Janela default 02:00–03:00; cada empresa pode customizar dailyBrainHour
const DEFAULT_HOUR = 2

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 min

function getCurrentHourInTz(timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hour: '2-digit',
    })
    const parts = dtf.formatToParts(new Date())
    const h = parts.find(p => p.type === 'hour')?.value
    return Number(h)
  } catch {
    return new Date().getUTCHours()
  }
}

async function tick() {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true, dailyBrainEnabled: true },
      select: { id: true, name: true, dailyBrainTimezone: true, dailyBrainHour: true },
    })

    for (const c of companies) {
      const tz = c.dailyBrainTimezone || 'America/Sao_Paulo'
      const targetHour = Number.isInteger(c.dailyBrainHour) ? c.dailyBrainHour : DEFAULT_HOUR
      const hour = getCurrentHourInTz(tz)
      if (hour !== targetHour) continue

      const date = yesterdayInTz(tz)

      // Idempotência rápida via tabela (a fila também valida)
      const existing = await prisma.aIDailyDigest.findUnique({
        where: { companyId_date: { companyId: c.id, date } },
        select: { status: true },
      })
      if (existing && (existing.status === 'DONE' || existing.status === 'RUNNING')) continue

      try {
        await enqueueDailyBrain(c.id, date, 'cron')
        console.log(`[DailyBrainCron] Enfileirado ${c.name} (${c.id}) data ${date} TZ ${tz}`)
      } catch (err) {
        console.warn(`[DailyBrainCron] Falha ao enfileirar ${c.id}:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.error('[DailyBrainCron] Tick falhou:', (err as Error).message)
  }
}

export function startDailyBrainCron() {
  console.log('[DailyBrainCron] Iniciado — checa a cada 5 min, dispara cada empresa na hora configurada (dailyBrainHour) da sua timezone')
  // Primeiro tick em 60s pra não competir com boot
  setTimeout(tick, 60_000)
  setInterval(tick, CHECK_INTERVAL_MS)
}
