/**
 * AI Agent Schedule — verifica se o agente pode responder no horário atual
 *
 * Modos:
 *  - ALWAYS: sempre (24/7)
 *  - BUSINESS_HOURS: somente dentro do horário comercial da Instance (working_hours)
 *  - OUT_OF_BUSINESS_HOURS: somente FORA do horário comercial da Instance
 *  - CUSTOM: slots customizados (similar ao impa-ai)
 *
 * Slots CUSTOM (Json):
 *   [{ dayOfWeek: 0-6, openHour, openMinutes, closeHour, closeMinutes }]
 */

import { prisma } from '../../config/database.js'

export interface ScheduleSlot {
  dayOfWeek: number       // 0=Dom .. 6=Sab
  openHour: number        // 0-23
  openMinutes: number     // 0-59
  closeHour: number       // 0-23
  closeMinutes: number    // 0-59
}

interface AgentScheduleFields {
  scheduleMode: 'ALWAYS' | 'BUSINESS_HOURS' | 'OUT_OF_BUSINESS_HOURS' | 'CUSTOM'
  scheduleTimezone: string | null
  scheduleSlots: any
}

export interface ScheduleCheckResult {
  allowed: boolean
  reason?: 'OUT_OF_BUSINESS_HOURS' | 'WITHIN_BUSINESS_HOURS' | 'OUT_OF_CUSTOM_SLOTS'
}

/**
 * Retorna {hour, minute, dayOfWeek} no fuso pedido.
 * Falha silenciosa cai em UTC-3 (Brasília).
 */
function nowInTz(tz: string): { hour: number; minute: number; dayOfWeek: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
    const parts = formatter.formatToParts(new Date())
    const get = (t: string) => parts.find(p => p.type === t)?.value || ''
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return {
      hour: parseInt(get('hour'), 10) || 0,
      minute: parseInt(get('minute'), 10) || 0,
      dayOfWeek: weekdayMap[get('weekday')] ?? new Date().getDay(),
    }
  } catch {
    const fallback = new Date(Date.now() - 3 * 60 * 60 * 1000)
    return { hour: fallback.getUTCHours(), minute: fallback.getUTCMinutes(), dayOfWeek: fallback.getUTCDay() }
  }
}

function isWithinSlot(curMin: number, slot: ScheduleSlot): boolean {
  const open = (slot.openHour ?? 0) * 60 + (slot.openMinutes ?? 0)
  const close = (slot.closeHour ?? 0) * 60 + (slot.closeMinutes ?? 0)
  if (close <= open) return false
  return curMin >= open && curMin < close
}

/**
 * Checa se o agente pode responder agora.
 * `instanceId` é necessário para os modos BUSINESS_HOURS / OUT_OF_BUSINESS_HOURS.
 */
export async function isAgentAllowedNow(
  agent: AgentScheduleFields,
  instanceId: string,
): Promise<ScheduleCheckResult> {
  const mode = agent.scheduleMode || 'ALWAYS'

  if (mode === 'ALWAYS') return { allowed: true }

  if (mode === 'CUSTOM') {
    const tz = agent.scheduleTimezone || 'America/Sao_Paulo'
    const { hour, minute, dayOfWeek } = nowInTz(tz)
    const curMin = hour * 60 + minute
    const slots: ScheduleSlot[] = Array.isArray(agent.scheduleSlots) ? agent.scheduleSlots : []
    const todaySlots = slots.filter(s => s && s.dayOfWeek === dayOfWeek)
    if (todaySlots.length === 0) return { allowed: false, reason: 'OUT_OF_CUSTOM_SLOTS' }
    const inside = todaySlots.some(s => isWithinSlot(curMin, s))
    return inside ? { allowed: true } : { allowed: false, reason: 'OUT_OF_CUSTOM_SLOTS' }
  }

  // BUSINESS_HOURS / OUT_OF_BUSINESS_HOURS — usa working_hours da instância
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { timezone: true, workingHoursEnabled: true },
  })
  const tz = instance?.timezone || 'America/Sao_Paulo'
  const { hour, minute, dayOfWeek } = nowInTz(tz)
  const curMin = hour * 60 + minute

  const wh = await prisma.workingHour.findUnique({
    where: { instanceId_dayOfWeek: { instanceId, dayOfWeek } },
  })

  // Sem config de horário ⇒ tratamos como "aberto o dia inteiro"
  let isWithinBusiness: boolean
  if (!wh) {
    isWithinBusiness = true
  } else if (wh.closedAllDay) {
    isWithinBusiness = false
  } else {
    const open = wh.openHour * 60 + wh.openMinutes
    const close = wh.closeHour * 60 + wh.closeMinutes
    isWithinBusiness = curMin >= open && curMin < close
  }

  if (mode === 'BUSINESS_HOURS') {
    return isWithinBusiness
      ? { allowed: true }
      : { allowed: false, reason: 'OUT_OF_BUSINESS_HOURS' }
  }

  // OUT_OF_BUSINESS_HOURS
  return !isWithinBusiness
    ? { allowed: true }
    : { allowed: false, reason: 'WITHIN_BUSINESS_HOURS' }
}
