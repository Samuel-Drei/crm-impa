import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, TrendingDown, DollarSign, FileText, Receipt, HandIcon, FolderKanban, Briefcase } from 'lucide-react'
import { reportService } from '@/services/commercial'
import { useToast } from '@/components/ui/Toast'

const proposalStatusLabels: Record<string, string> = {
  DRAFT: 'Rascunho', SENT: 'Enviada', OPENED: 'Visualizada', REVISED: 'Revisada',
  ACCEPTED: 'Aceita', DECLINED: 'Recusada', EXPIRED: 'Expirada',
}
const invoiceStatusLabels: Record<string, string> = {
  DRAFT: 'Rascunho', SENT: 'Enviada', VIEWED: 'Visualizada', PARTIALLY_PAID: 'Parcial',
  PAID: 'Paga', OVERDUE: 'Atrasada', CANCELLED: 'Cancelada',
}
const methodLabels: Record<string, string> = {
  PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão Crédito', DEBIT_CARD: 'Cartão Débito',
  TRANSFER: 'Transferência', CASH: 'Dinheiro', OTHER: 'Outro',
}

function formatCurrency(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function getBarWidth(v: number, max: number) { return max > 0 ? Math.max((v / max) * 100, 2) : 2 }

export function Reports() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [commercial, setCommercial] = useState<any>(null)
  const [monthly, setMonthly] = useState<any[]>([])
  const [pipelineData, setPipelineData] = useState<any[]>([])
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])
  const [topClients, setTopClients] = useState<any[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo

      const [comm, rev, pipe, methods, clients] = await Promise.all([
        reportService.commercial(params),
        reportService.revenueMonthly(),
        reportService.pipeline(),
        reportService.paymentsByMethod(params),
        reportService.topClients(),
      ])

      setCommercial(comm)
      setMonthly(rev.months || [])
      setPipelineData(pipe.pipelines || [])
      setPaymentMethods(methods.methods || [])
      setTopClients(clients.clients || [])
    } catch {
      toast.error('Erro ao carregar relatórios')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-40">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  const revenue = commercial?.payments?.total || 0
  const expenses = commercial?.expenses?.total || 0
  const profit = commercial?.revenue || 0
  const maxMonthly = Math.max(...monthly.map(m => Math.max(m.revenue, m.expenses)), 1)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Relatórios Comerciais</h1>
          <p className="text-muted-foreground text-sm">Visão geral do desempenho financeiro e comercial</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm" />
          <span className="text-muted-foreground text-sm">até</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-600 mb-2"><TrendingUp className="h-4 w-4" /><span className="text-xs font-medium uppercase">Receita</span></div>
          <p className="text-xl font-bold">{formatCurrency(revenue)}</p>
          <p className="text-xs text-muted-foreground">{commercial?.payments?.count || 0} pagamentos</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-500 mb-2"><TrendingDown className="h-4 w-4" /><span className="text-xs font-medium uppercase">Despesas</span></div>
          <p className="text-xl font-bold">{formatCurrency(expenses)}</p>
          <p className="text-xs text-muted-foreground">{commercial?.expenses?.count || 0} despesas</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-primary mb-2"><DollarSign className="h-4 w-4" /><span className="text-xs font-medium uppercase">Lucro</span></div>
          <p className={`text-xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(profit)}</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-blue-500 mb-2"><FileText className="h-4 w-4" /><span className="text-xs font-medium uppercase">Propostas</span></div>
          <p className="text-xl font-bold">{commercial?.proposalsByStatus?.reduce((s: number, p: any) => s + p.count, 0) || 0}</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-amber-500 mb-2"><Briefcase className="h-4 w-4" /><span className="text-xs font-medium uppercase">Contratos</span></div>
          <p className="text-xl font-bold">{commercial?.activeContracts || 0}</p>
          <p className="text-xs text-muted-foreground">ativos</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-purple-500 mb-2"><FolderKanban className="h-4 w-4" /><span className="text-xs font-medium uppercase">Projetos</span></div>
          <p className="text-xl font-bold">{commercial?.activeProjects || 0}</p>
          <p className="text-xs text-muted-foreground">em andamento</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Receita vs Despesa mensal */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Receita vs Despesas (12 meses)</h3>
          {monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
          ) : (
            <div className="space-y-3">
              {monthly.map(m => (
                <div key={m.month} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-mono">{m.month}</span>
                    <span className={`font-medium ${m.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(m.profit)}</span>
                  </div>
                  <div className="flex gap-1 h-4">
                    <div className="bg-emerald-500/80 rounded-sm transition-all" style={{ width: `${getBarWidth(m.revenue, maxMonthly)}%` }} title={`Receita: ${formatCurrency(m.revenue)}`} />
                    <div className="bg-red-400/80 rounded-sm transition-all" style={{ width: `${getBarWidth(m.expenses, maxMonthly)}%` }} title={`Despesas: ${formatCurrency(m.expenses)}`} />
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500/80 rounded-sm" />Receita</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400/80 rounded-sm" />Despesas</span>
              </div>
            </div>
          )}
        </div>

        {/* Pipeline de vendas */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Pipeline de Vendas</h3>
          {pipelineData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem pipelines</p>
          ) : (
            <div className="space-y-4">
              {pipelineData.map(p => (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-sm text-muted-foreground">{p.totalCards} cards • {formatCurrency(p.totalValue)}</span>
                  </div>
                  <div className="flex gap-1 h-8 rounded-lg overflow-hidden bg-muted/30">
                    {p.stages.map((s: any) => {
                      const pct = p.totalCards > 0 ? (s.count / p.totalCards) * 100 : 0
                      if (pct === 0) return null
                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-center text-[10px] font-medium text-white transition-all"
                          style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: s.color || '#6366f1' }}
                          title={`${s.name}: ${s.count} cards (${formatCurrency(s.totalValue)})`}
                        >
                          {pct > 10 ? s.name : ''}
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {p.stages.map((s: any) => (
                      <span key={s.id} className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color || '#6366f1' }} />
                        {s.name} ({s.count})
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Propostas por status */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Propostas por Status</h3>
          <div className="space-y-2">
            {commercial?.proposalsByStatus?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem propostas</p>}
            {commercial?.proposalsByStatus?.map((p: any) => (
              <div key={p.status} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                <span className="text-sm">{proposalStatusLabels[p.status] || p.status}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{formatCurrency(p.total)}</span>
                  <span className="text-sm font-medium bg-muted/50 px-2 py-0.5 rounded">{p.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Faturas por status */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Faturas por Status</h3>
          <div className="space-y-2">
            {commercial?.invoicesByStatus?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem faturas</p>}
            {commercial?.invoicesByStatus?.map((i: any) => (
              <div key={i.status} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                <span className="text-sm">{invoiceStatusLabels[i.status] || i.status}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{formatCurrency(i.total)}</span>
                  <span className="text-sm font-medium bg-muted/50 px-2 py-0.5 rounded">{i.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pagamentos por método */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Pagamentos por Método</h3>
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem pagamentos</p>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map((m: any) => {
                const maxVal = Math.max(...paymentMethods.map((x: any) => x.total), 1)
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>{methodLabels[m.method] || m.method}</span>
                      <span className="font-medium">{formatCurrency(m.total)} <span className="text-xs text-muted-foreground">({m.count})</span></span>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${(m.total / maxVal) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Top clientes */}
        <div className="bg-card border border-border/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-4">Top 10 Clientes</h3>
          {topClients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem dados</p>
          ) : (
            <div className="space-y-2">
              {topClients.map((c: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground w-5">{idx + 1}.</span>
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                    </div>
                  </div>
                  <span className="text-sm font-medium">{formatCurrency(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
