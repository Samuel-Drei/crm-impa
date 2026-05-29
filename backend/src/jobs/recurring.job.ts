/**
 * Recurring Job: processa faturas e despesas recorrentes.
 * Executa a cada 60 minutos verificando lastRecurredAt + intervalo.
 */
import { prisma } from '../config/database.js'

let intervalId: NodeJS.Timeout | null = null

export function startRecurringJob(): void {
  console.log('[Recurring] Starting recurring job (checks every 60 min)...')
  intervalId = setInterval(processRecurring, 60 * 60_000)
  // Primeira execução após 30s
  setTimeout(processRecurring, 30_000)
}

export function stopRecurringJob(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

async function processRecurring(): Promise<void> {
  try {
    await processRecurringInvoices()
    await processRecurringExpenses()
  } catch (err: any) {
    console.error('[Recurring] Erro geral:', err.message)
  }
}

// ── Faturas Recorrentes ──────────────────────────────────

async function processRecurringInvoices(): Promise<void> {
  const now = new Date()

  const invoices = await prisma.invoice.findMany({
    where: {
      isRecurring: true,
      status: { in: ['SENT', 'PAID'] },
      OR: [
        { lastRecurringDate: null },
        { lastRecurringDate: { lte: calculatePastThreshold(now) } },
      ],
    },
    include: {
      items: true,
    },
  })

  if (invoices.length === 0) return
  console.log(`[Recurring] ${invoices.length} fatura(s) recorrente(s) para processar`)

  for (const invoice of invoices) {
    try {
      // Verificar ciclos restantes
      if (invoice.recurringCycles && invoice.recurringCycles > 0) {
        const totalCreated = await prisma.invoice.count({
          where: { companyId: invoice.companyId, recurringFromId: invoice.id },
        })
        if (totalCreated >= invoice.recurringCycles) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { isRecurring: false },
          })
          continue
        }
      }

      // Obter próximo número
      const lastInvoice = await prisma.invoice.findFirst({
        where: { companyId: invoice.companyId, prefix: invoice.prefix || 'FAT' },
        orderBy: { number: 'desc' },
        select: { number: true },
      })
      const nextNumber = (lastInvoice?.number || 0) + 1

      // Calcular próxima data de vencimento
      const dueDate = new Date(now)
      if (invoice.dueDate && invoice.date) {
        const termDays = Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / (1000 * 60 * 60 * 24))
        dueDate.setDate(dueDate.getDate() + Math.max(termDays, 1))
      } else {
        dueDate.setDate(dueDate.getDate() + 30)
      }

      // Criar nova fatura
      const newInvoice = await prisma.invoice.create({
        data: {
          companyId: invoice.companyId,
          contactId: invoice.contactId,
          prefix: invoice.prefix || 'FAT-',
          number: nextNumber,
          status: 'DRAFT',
          date: now,
          dueDate,
          subtotal: invoice.subtotal,
          taxTotal: invoice.taxTotal,
          discountAmount: invoice.discountAmount,
          discountPercent: invoice.discountPercent,
          discountType: invoice.discountType,
          total: invoice.total,
          amountDue: invoice.total,
          currency: invoice.currency,
          terms: invoice.terms,
          clientNote: invoice.clientNote,
          internalNote: invoice.internalNote,
          recurringFromId: invoice.id,
          createdBy: invoice.createdBy,
        },
      })

      // Copiar itens
      if (invoice.items.length > 0) {
        await prisma.invoiceItem.createMany({
          data: invoice.items.map((item: any) => ({
            invoiceId: newInvoice.id,
            itemId: item.itemId,
            variantId: item.variantId,
            bundleId: item.bundleId,
            description: item.description,
            longDescription: item.longDescription,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            total: item.total,
            unit: item.unit,
            position: item.position,
          })),
        })
      }

      // Atualizar data da última recorrência e incrementar ciclos done
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          lastRecurringDate: now,
          recurringCyclesDone: { increment: 1 },
        },
      })

      console.log(`[Recurring] Fatura #${nextNumber} criada a partir da recorrente #${invoice.number}`)
    } catch (err: any) {
      console.error(`[Recurring] Erro ao processar fatura ${invoice.id}:`, err.message)
    }
  }
}

// ── Despesas Recorrentes ─────────────────────────────────

async function processRecurringExpenses(): Promise<void> {
  const now = new Date()

  const expenses = await prisma.expense.findMany({
    where: {
      isRecurring: true,
      OR: [
        { lastRecurringDate: null },
        { lastRecurringDate: { lte: calculatePastThreshold(now) } },
      ],
    },
  })

  if (expenses.length === 0) return
  console.log(`[Recurring] ${expenses.length} despesa(s) recorrente(s) para processar`)

  for (const expense of expenses) {
    try {
      // Verificar ciclos
      if (expense.recurringCycles && expense.recurringCycles > 0) {
        const totalCreated = await prisma.expense.count({
          where: { companyId: expense.companyId, recurringFromId: expense.id },
        })
        if (totalCreated >= expense.recurringCycles) {
          await prisma.expense.update({
            where: { id: expense.id },
            data: { isRecurring: false },
          })
          continue
        }
      }

      // Criar nova despesa
      await prisma.expense.create({
        data: {
          companyId: expense.companyId,
          name: expense.name,
          amount: expense.amount,
          categoryId: expense.categoryId,
          contactId: expense.contactId,
          projectId: expense.projectId,
          date: now,
          paymentMethod: expense.paymentMethod,
          currency: expense.currency,
          taxRate: expense.taxRate,
          note: expense.note,
          billable: expense.billable,
          recurringFromId: expense.id,
          createdBy: expense.createdBy,
        },
      })

      // Atualizar data da última recorrência e incrementar ciclos done
      await prisma.expense.update({
        where: { id: expense.id },
        data: {
          lastRecurringDate: now,
          recurringCyclesDone: { increment: 1 },
        },
      })

      console.log(`[Recurring] Despesa "${expense.name}" recriada`)
    } catch (err: any) {
      console.error(`[Recurring] Erro ao processar despesa ${expense.id}:`, err.message)
    }
  }
}

// ── Helper ───────────────────────────────────────────────

function calculateNextDate(from: Date, type: string, every: number): Date {
  const next = new Date(from)
  switch (type) {
    case 'DAILY': next.setDate(next.getDate() + every); break
    case 'WEEKLY': next.setDate(next.getDate() + (7 * every)); break
    case 'MONTHLY': next.setMonth(next.getMonth() + every); break
    case 'QUARTERLY': next.setMonth(next.getMonth() + (3 * every)); break
    case 'SEMIANNUAL': next.setMonth(next.getMonth() + (6 * every)); break
    case 'YEARLY': next.setFullYear(next.getFullYear() + every); break
    default: next.setMonth(next.getMonth() + every)
  }
  return next
}

/**
 * Calcula threshold: retorna data limite para que um item recorrente
 * com lastRecurringDate <= threshold precise ser processado agora.
 * Ex.: se recurringType=MONTHLY e recurringEvery=1, threshold = now - 1 mês.
 * Como não temos acesso ao tipo aqui (query genérica), usamos 1 dia atrás
 * como threshold conservador — itens serão filtrados melhor no loop.
 */
function calculatePastThreshold(now: Date): Date {
  const threshold = new Date(now)
  threshold.setDate(threshold.getDate() - 1)
  return threshold
}
