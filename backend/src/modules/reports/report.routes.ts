import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

const periodQuery = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

export async function reportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── Dashboard Unificado (KPIs + Séries temporais) ──────
  fastify.get('/dashboard', { preHandler: [requirePermission('proposals:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = periodQuery.parse(request.query)

      const dateFrom = query.dateFrom ? new Date(query.dateFrom) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d })()
      const dateTo = query.dateTo ? new Date(query.dateTo) : new Date()
      dateTo.setHours(23, 59, 59, 999)

      // Período anterior (mesma duração para comparação)
      const periodMs = dateTo.getTime() - dateFrom.getTime()
      const prevFrom = new Date(dateFrom.getTime() - periodMs)
      const prevTo = new Date(dateFrom.getTime() - 1)

      const dateFilter = { gte: dateFrom, lte: dateTo }
      const prevDateFilter = { gte: prevFrom, lte: prevTo }

      try {
      // ═══ Queries paralelas ═══
      const [
        // Leads
        leadsTotal, leadsPrev, leadsConverted, leadsConvertedPrev,
        leadsByStatus, leadsByTemperature, leadsByDate,
        // Clientes
        customersTotal, customersPrev, customersActive,
        // Pipeline / Oportunidades
        openCards, wonCards, lostCards, wonCardsPrev,
        totalWonValue, totalOpenValue,
        totalWonValuePrev,
        // Faturas
        invoicesByStatus,
        // Pagamentos
        paymentsReceived, paymentsReceivedPrev,
        paymentsPending,
        paymentsOverdue,
        paymentsByMethod,
        // Despesas
        expensesTotal, expensesTotalPrev,
        expensesByCategory,
        // Séries temporais (pagamentos e despesas por dia)
        paymentsDaily, expensesDaily,
        // Top clientes
        topClientPayments,
        // Pipeline stages
        pipelineStages,
      ] = await Promise.all([
        // Leads current
        prisma.leadProfile.count({ where: { companyId, createdAt: dateFilter } }),
        prisma.leadProfile.count({ where: { companyId, createdAt: prevDateFilter } }),
        prisma.leadProfile.count({ where: { companyId, convertedAt: dateFilter } }),
        prisma.leadProfile.count({ where: { companyId, convertedAt: prevDateFilter } }),
        prisma.leadProfile.groupBy({ by: ['status'], where: { companyId, createdAt: dateFilter }, _count: true }),
        prisma.leadProfile.groupBy({ by: ['temperature'], where: { companyId, createdAt: dateFilter }, _count: true }),
        prisma.leadProfile.findMany({
          where: { companyId, createdAt: dateFilter },
          select: { createdAt: true, convertedAt: true },
          orderBy: { createdAt: 'asc' },
        }),

        // Clientes
        prisma.customerAccount.count({ where: { companyId, createdAt: dateFilter } }),
        prisma.customerAccount.count({ where: { companyId, createdAt: prevDateFilter } }),
        prisma.customerAccount.count({ where: { companyId, status: 'ACTIVE' } }),

        // Pipeline cards
        prisma.card.count({ where: { companyId, status: 'OPEN', createdAt: dateFilter } }),
        prisma.card.count({ where: { companyId, status: 'WON', wonAt: dateFilter } }),
        prisma.card.count({ where: { companyId, status: 'LOST', lostAt: dateFilter } }),
        prisma.card.count({ where: { companyId, status: 'WON', wonAt: prevDateFilter } }),

        // Values
        prisma.card.aggregate({ where: { companyId, status: 'WON', wonAt: dateFilter }, _sum: { value: true } }),
        prisma.card.aggregate({ where: { companyId, status: 'OPEN' }, _sum: { value: true } }),
        prisma.card.aggregate({ where: { companyId, status: 'WON', wonAt: prevDateFilter }, _sum: { value: true } }),

        // Faturas
        prisma.invoice.groupBy({
          by: ['status'],
          where: { companyId, date: dateFilter },
          _count: true,
          _sum: { total: true, amountPaid: true, amountDue: true },
        }),

        // Pagamentos recebidos
        prisma.payment.aggregate({ where: { companyId, status: 'CONFIRMED', date: dateFilter }, _sum: { amount: true }, _count: true }),
        prisma.payment.aggregate({ where: { companyId, status: 'CONFIRMED', date: prevDateFilter }, _sum: { amount: true }, _count: true }),
        // Pagamentos pendentes
        prisma.payment.aggregate({ where: { companyId, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
        // Faturas vencidas
        prisma.invoice.aggregate({ where: { companyId, status: 'OVERDUE' }, _sum: { amountDue: true }, _count: true }),
        // Pagamentos por método
        prisma.payment.groupBy({
          by: ['method'],
          where: { companyId, status: 'CONFIRMED', date: dateFilter },
          _sum: { amount: true },
          _count: true,
        }),

        // Despesas
        prisma.expense.aggregate({ where: { companyId, date: dateFilter }, _sum: { amount: true }, _count: true }),
        prisma.expense.aggregate({ where: { companyId, date: prevDateFilter }, _sum: { amount: true }, _count: true }),
        prisma.expense.groupBy({
          by: ['categoryId'],
          where: { companyId, date: dateFilter },
          _sum: { amount: true },
          _count: true,
        }),

        // Séries temporais
        prisma.payment.findMany({
          where: { companyId, status: 'CONFIRMED', date: dateFilter },
          select: { date: true, amount: true },
          orderBy: { date: 'asc' },
        }),
        prisma.expense.findMany({
          where: { companyId, date: dateFilter },
          select: { date: true, amount: true },
          orderBy: { date: 'asc' },
        }),

        // Top clientes
        prisma.payment.groupBy({
          by: ['invoiceId'],
          where: { companyId, status: 'CONFIRMED', date: dateFilter },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: 20,
        }),

        // Pipeline stages (com mais dados)
        prisma.pipeline.findMany({
          where: { companyId },
          take: 1,
          orderBy: { isDefault: 'desc' },
          include: {
            stages: {
              orderBy: { position: 'asc' },
              include: {
                cards: {
                  where: { status: { not: 'ARCHIVED' } },
                  select: { value: true, status: true },
                },
              },
            },
          },
        }),
      ])

      // Processar top clientes
      const invoiceIds = topClientPayments.map(c => c.invoiceId).filter(Boolean)
      const invoices = invoiceIds.length > 0
        ? await prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: { id: true, contactId: true, contact: { select: { name: true } } },
          })
        : []
      const invMap = new Map(invoices.map(i => [i.id, i]))
      const clientAgg = new Map<string, { name: string; total: number }>()
      for (const e of topClientPayments) {
        const inv = invMap.get(e.invoiceId)
        if (!inv) continue
        const ex = clientAgg.get(inv.contactId)
        const val = e._sum.amount?.toNumber() || 0
        if (ex) ex.total += val
        else clientAgg.set(inv.contactId, { name: inv.contact.name, total: val })
      }
      const topClients = Array.from(clientAgg.values()).sort((a, b) => b.total - a.total).slice(0, 5)

      // Processar categorias de despesas
      const categoryIds = expensesByCategory.map(e => e.categoryId).filter(Boolean) as string[]
      const categories = categoryIds.length > 0
        ? await prisma.itemCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
        : []
      const catMap = new Map(categories.map(c => [c.id, c.name]))

      // Agregar leads por dia
      const leadsDailyMap = new Map<string, { leads: number; converted: number }>()
      for (const l of leadsByDate) {
        const key = l.createdAt.toISOString().slice(0, 10)
        const ex = leadsDailyMap.get(key) || { leads: 0, converted: 0 }
        ex.leads++
        if (l.convertedAt && l.convertedAt >= dateFrom && l.convertedAt <= dateTo) ex.converted++
        leadsDailyMap.set(key, ex)
      }

      // Agregar receita/despesa por dia
      const financialDailyMap = new Map<string, { revenue: number; expenses: number }>()
      for (const p of paymentsDaily) {
        const key = p.date.toISOString().slice(0, 10)
        const ex = financialDailyMap.get(key) || { revenue: 0, expenses: 0 }
        ex.revenue += Number(p.amount)
        financialDailyMap.set(key, ex)
      }
      for (const e of expensesDaily) {
        const key = e.date.toISOString().slice(0, 10)
        const ex = financialDailyMap.get(key) || { revenue: 0, expenses: 0 }
        ex.expenses += Number(e.amount)
        financialDailyMap.set(key, ex)
      }

      // Helpers
      const pct = (curr: number, prev: number) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100)
      const receivedVal = paymentsReceived._sum.amount?.toNumber() || 0
      const receivedPrevVal = paymentsReceivedPrev._sum.amount?.toNumber() || 0
      const expVal = expensesTotal._sum.amount?.toNumber() || 0
      const expPrevVal = expensesTotalPrev._sum.amount?.toNumber() || 0
      const wonVal = totalWonValue._sum.value?.toNumber() || 0
      const wonPrevVal = totalWonValuePrev._sum.value?.toNumber() || 0
      const openVal = totalOpenValue._sum.value?.toNumber() || 0
      const pendingVal = paymentsPending._sum.amount?.toNumber() || 0
      const overdueVal = paymentsOverdue._sum.amountDue?.toNumber() || 0

      // Pipeline stages formatting
      const funnel = pipelineStages[0]?.stages.map(s => ({
        name: s.name,
        color: s.color,
        count: s.cards.length,
        value: s.cards.reduce((sum, c) => sum + (Number(c.value) || 0), 0),
      })) || []

      return reply.send({
        // ═══ KPIs ═══
        kpis: {
          leads: { value: leadsTotal, prev: leadsPrev, change: pct(leadsTotal, leadsPrev) },
          leadsConverted: { value: leadsConverted, prev: leadsConvertedPrev, change: pct(leadsConverted, leadsConvertedPrev) },
          customers: { value: customersTotal, prev: customersPrev, change: pct(customersTotal, customersPrev) },
          customersActive: customersActive,
          conversionRate: leadsTotal > 0 ? Math.round((leadsConverted / leadsTotal) * 100) : 0,
          opportunitiesOpen: openCards,
          opportunitiesWon: wonCards,
          opportunitiesLost: lostCards,
          wonValue: { value: wonVal, prev: wonPrevVal, change: pct(wonVal, wonPrevVal) },
          openValue: openVal,
          received: { value: receivedVal, prev: receivedPrevVal, change: pct(receivedVal, receivedPrevVal) },
          pending: pendingVal,
          overdue: overdueVal,
          expenses: { value: expVal, prev: expPrevVal, change: pct(expVal, expPrevVal) },
          profit: receivedVal - expVal,
        },

        // ═══ Séries temporais ═══
        leadsSeries: Array.from(leadsDailyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, leads: d.leads, converted: d.converted })),
        financialSeries: Array.from(financialDailyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, revenue: d.revenue, expenses: d.expenses, profit: d.revenue - d.expenses })),

        // ═══ Breakdowns ═══
        leadsByStatus: leadsByStatus.map(s => ({ status: s.status, count: s._count })),
        leadsByTemperature: leadsByTemperature.map(t => ({ temperature: t.temperature, count: t._count })),
        invoicesByStatus: invoicesByStatus.map(i => ({
          status: i.status,
          count: i._count,
          total: i._sum.total?.toNumber() || 0,
        })),
        paymentsByMethod: paymentsByMethod.map(m => ({
          method: m.method,
          total: m._sum.amount?.toNumber() || 0,
          count: m._count,
        })),
        expensesByCategory: expensesByCategory.map(e => ({
          category: e.categoryId ? (catMap.get(e.categoryId) || 'Outros') : 'Sem categoria',
          total: e._sum.amount?.toNumber() || 0,
          count: e._count,
        })),

        // ═══ Funnel / Pipeline ═══
        funnel,

        // ═══ Top Clientes ═══
        topClients,
      })
      } catch (err) {
        request.log.warn({ err }, 'reports/dashboard: DB error, returning empty dashboard')
        return reply.send({
          kpis: {
            leads: { value: 0, prev: 0, change: 0 }, leadsConverted: { value: 0, prev: 0, change: 0 },
            customers: { value: 0, prev: 0, change: 0 }, customersActive: 0, conversionRate: 0,
            opportunitiesOpen: 0, opportunitiesWon: 0, opportunitiesLost: 0,
            wonValue: { value: 0, prev: 0, change: 0 }, openValue: 0,
            received: { value: 0, prev: 0, change: 0 }, pending: 0, overdue: 0,
            expenses: { value: 0, prev: 0, change: 0 }, profit: 0,
          },
          leadsSeries: [], financialSeries: [], leadsByStatus: [], leadsByTemperature: [],
          invoicesByStatus: [], paymentsByMethod: [], expensesByCategory: [], funnel: [], topClients: [],
        })
      }
    }
  )

  // ── Dashboard Comercial ────────────────────────────────
  fastify.get('/commercial', { preHandler: [requirePermission('proposals:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = periodQuery.parse(request.query)

      const dateFilter: any = {}
      if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom)
      if (query.dateTo) dateFilter.lte = new Date(query.dateTo)
      const hasDateFilter = Object.keys(dateFilter).length > 0

      // Propostas por status
      const proposalsByStatus = await prisma.proposal.groupBy({
        by: ['status'],
        where: { companyId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
        _count: true,
        _sum: { total: true },
      })

      // Faturas por status
      const invoicesByStatus = await prisma.invoice.groupBy({
        by: ['status'],
        where: { companyId, ...(hasDateFilter ? { date: dateFilter } : {}) },
        _count: true,
        _sum: { total: true },
      })

      // Pagamentos totais
      const paymentTotals = await prisma.payment.aggregate({
        where: { companyId, status: 'CONFIRMED', ...(hasDateFilter ? { date: dateFilter } : {}) },
        _sum: { amount: true },
        _count: true,
      })

      // Despesas totais
      const expenseTotals = await prisma.expense.aggregate({
        where: { companyId, ...(hasDateFilter ? { date: dateFilter } : {}) },
        _sum: { amount: true },
        _count: true,
      })

      // Contratos ativos
      const activeContracts = await prisma.contract.count({
        where: { companyId, status: 'ACTIVE' },
      })

      // Projetos em andamento
      const activeProjects = await prisma.project.count({
        where: { companyId, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
      })

      return reply.send({
        proposalsByStatus: proposalsByStatus.map(p => ({
          status: p.status,
          count: p._count,
          total: p._sum.total?.toNumber() || 0,
        })),
        invoicesByStatus: invoicesByStatus.map(i => ({
          status: i.status,
          count: i._count,
          total: i._sum.total?.toNumber() || 0,
        })),
        payments: {
          total: paymentTotals._sum.amount?.toNumber() || 0,
          count: paymentTotals._count,
        },
        expenses: {
          total: expenseTotals._sum.amount?.toNumber() || 0,
          count: expenseTotals._count,
        },
        activeContracts,
        activeProjects,
        revenue: (paymentTotals._sum.amount?.toNumber() || 0) - (expenseTotals._sum.amount?.toNumber() || 0),
      })
    }
  )

  // ── Receita mensal (últimos 12 meses) ──────────────────
  fastify.get('/revenue-monthly', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const twelveMonthsAgo = new Date()
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

      const payments = await prisma.payment.findMany({
        where: {
          companyId,
          status: 'CONFIRMED',
          date: { gte: twelveMonthsAgo },
        },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      })

      const expenses = await prisma.expense.findMany({
        where: {
          companyId,
          date: { gte: twelveMonthsAgo },
        },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      })

      // Agregar por mês
      const monthlyData: Record<string, { revenue: number; expenses: number }> = {}

      for (const p of payments) {
        const key = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}`
        if (!monthlyData[key]) monthlyData[key] = { revenue: 0, expenses: 0 }
        monthlyData[key].revenue += Number(p.amount)
      }

      for (const e of expenses) {
        const key = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`
        if (!monthlyData[key]) monthlyData[key] = { revenue: 0, expenses: 0 }
        monthlyData[key].expenses += Number(e.amount)
      }

      const months = Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          revenue: data.revenue,
          expenses: data.expenses,
          profit: data.revenue - data.expenses,
        }))

      return reply.send({ months })
    }
  )

  // ── Pipeline de vendas ─────────────────────────────────
  fastify.get('/pipeline', { preHandler: [requirePermission('pipelines:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const pipelines = await prisma.pipeline.findMany({
        where: { companyId },
        include: {
          stages: {
            orderBy: { position: 'asc' },
            include: {
              _count: { select: { cards: true } },
              cards: {
                where: { status: { not: 'ARCHIVED' } },
                select: { value: true },
              },
            },
          },
        },
      })

      const pipelineData = pipelines.map(p => ({
        id: p.id,
        name: p.name,
        stages: p.stages.map(s => ({
          id: s.id,
          name: s.name,
          color: s.color,
          count: s._count.cards,
          totalValue: s.cards.reduce((sum, c) => sum + (Number(c.value) || 0), 0),
        })),
        totalCards: p.stages.reduce((sum, s) => sum + s._count.cards, 0),
        totalValue: p.stages.reduce((sum, s) =>
          sum + s.cards.reduce((cardSum, c) => cardSum + (Number(c.value) || 0), 0), 0),
      }))

      return reply.send({ pipelines: pipelineData })
    }
  )

  // ── Pagamentos por método ──────────────────────────────
  fastify.get('/payments-by-method', { preHandler: [requirePermission('payments:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = periodQuery.parse(request.query)

      const dateFilter: any = {}
      if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom)
      if (query.dateTo) dateFilter.lte = new Date(query.dateTo)
      const hasDateFilter = Object.keys(dateFilter).length > 0

      const byMethod = await prisma.payment.groupBy({
        by: ['method'],
        where: {
          companyId,
          status: 'CONFIRMED',
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true },
        _count: true,
      })

      return reply.send({
        methods: byMethod.map(m => ({
          method: m.method,
          total: m._sum.amount?.toNumber() || 0,
          count: m._count,
        })),
      })
    }
  )

  // ── Top clientes ───────────────────────────────────────
  fastify.get('/top-clients', { preHandler: [requirePermission('invoices:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const topClients = await prisma.payment.groupBy({
        by: ['invoiceId'],
        where: { companyId, status: 'CONFIRMED' },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      })

      // Buscar dados do contato através da fatura
      const invoiceIds = topClients.map(c => c.invoiceId).filter(Boolean)
      const invoices = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, contactId: true, contact: { select: { id: true, name: true, email: true } } },
      })

      const invoiceMap = new Map(invoices.map(i => [i.id, i]))

      // Agregar por contato
      const clientMap = new Map<string, { name: string; email: string | null; total: number; count: number }>()
      for (const entry of topClients) {
        const inv = invoiceMap.get(entry.invoiceId)
        if (!inv) continue
        const key = inv.contactId
        const existing = clientMap.get(key)
        const total = entry._sum.amount?.toNumber() || 0
        if (existing) {
          existing.total += total
          existing.count++
        } else {
          clientMap.set(key, {
            name: inv.contact.name,
            email: inv.contact.email,
            total,
            count: 1,
          })
        }
      }

      const clients = Array.from(clientMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)

      return reply.send({ clients })
    }
  )
}
