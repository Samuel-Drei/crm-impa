/**
 * Fleet Scheduler Job: verifica missões agendadas a cada 30s e dispara execução.
 */
import { runDueMissions } from '../modules/fleet/fleet.service.js'

let intervalId: NodeJS.Timeout | null = null

const TICK_MS = 30_000

export function startFleetSchedulerJob(): void {
  console.log('[Fleet] Starting scheduler (checks every 30s)...')
  intervalId = setInterval(tick, TICK_MS)
  setTimeout(tick, 15_000)
}

export function stopFleetSchedulerJob(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

async function tick(): Promise<void> {
  try {
    const r = await runDueMissions(new Date())
    if (r.fired > 0 || r.errors > 0) {
      console.log(`[Fleet] Scheduler tick: ${r.fired} disparada(s), ${r.errors} erro(s)`)
    }
  } catch (err: any) {
    console.error('[Fleet] Erro no scheduler:', err.message)
  }
}
