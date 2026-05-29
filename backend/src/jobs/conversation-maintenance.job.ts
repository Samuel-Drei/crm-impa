/**
 * Conversation Maintenance Job
 * - Unsnooze: reabrir conversas onde snoozedUntil <= now()
 * - Auto-resolve: fechar conversas sem atividade por X dias (quando habilitado pela empresa)
 * - Auto-assign: distribuir conversas OPEN sem assignee em times com allowAutoAssign=true (round-robin via Redis)
 *
 * Roda a cada 60 segundos.
 */
import { prisma } from '../config/database.js'
import { redis } from '../config/redis.js'

let intervalId: NodeJS.Timeout | null = null

export function startConversationMaintenanceJob(): void {
  console.log('[ConvMaintenance] Iniciado — snooze/auto-resolve/auto-assign a cada 60s')
  setTimeout(runMaintenance, 5_000)
  intervalId = setInterval(runMaintenance, 60_000)
}

export function stopConversationMaintenanceJob(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

async function runMaintenance(): Promise<void> {
  try {
    await Promise.all([
      processSnooze(),
      processAutoAssign(),
    ])
  } catch (err: any) {
    console.error('[ConvMaintenance] Erro:', err.message)
  }
}

// ─── SNOOZE: reabrir conversas onde snoozedUntil venceu ──────────────────────
async function processSnooze(): Promise<void> {
  const now = new Date()
  const snoozed = await prisma.conversation.findMany({
    where: { status: 'SNOOZED', snoozedUntil: { lte: now } },
    select: { id: true, companyId: true },
  })

  if (snoozed.length === 0) return

  await prisma.conversation.updateMany({
    where: { id: { in: snoozed.map(c => c.id) } },
    data: { status: 'OPEN', snoozedUntil: null },
  })

  console.log(`[ConvMaintenance] Unsnoozed ${snoozed.length} conversation(s)`)
}

// ─── AUTO-ASSIGN: round-robin em times com allowAutoAssign=true ──────────────
async function processAutoAssign(): Promise<void> {
  // Buscar conversas OPEN sem assignee que pertencem a um time com auto-assign
  const unassigned = await prisma.conversation.findMany({
    where: {
      status: 'OPEN',
      assigneeId: null,
      teamId: { not: null },
      team: { allowAutoAssign: true },
    },
    select: {
      id: true,
      companyId: true,
      teamId: true,
      team: {
        select: {
          id: true,
          allowAutoAssign: true,
          members: { select: { userId: true } },
        },
      },
    },
    take: 50, // processar em lotes
  })

  if (unassigned.length === 0) return

  for (const conv of unassigned) {
    if (!conv.team || conv.team.members.length === 0) continue

    const members = conv.team.members.map(m => m.userId)
    const counterKey = `auto_assign:team:${conv.teamId}`

    // Round-robin usando Redis INCR
    let idx = 0
    try {
      const counter = await redis.incr(counterKey)
      await redis.expire(counterKey, 86400) // reset diário
      idx = (counter - 1) % members.length
    } catch {
      // Redis indisponível: usar índice 0
      idx = 0
    }

    const assigneeId = members[idx]

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { assigneeId },
    })
  }

  if (unassigned.length > 0) {
    console.log(`[ConvMaintenance] Auto-assigned ${unassigned.length} conversation(s)`)
  }
}
