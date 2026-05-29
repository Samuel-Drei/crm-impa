import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import {
  Users,
  TrendingUp,
  Target,
  Briefcase,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CreditCard,
  Receipt,
  Wallet,
  AlertTriangle,
  PieChart,
  BarChart3,
  Calendar,
  ChevronDown,
  RefreshCw,
  Trophy,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPie,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
} from 'recharts'
import { reportService } from '@/services/commercial'
import { usePermissions } from '@/hooks/usePermissions'

// ═══ Tipos ═══
interface DashboardData {
  kpis: {
    leads: { value: number; prev: number; change: number }
    leadsConverted: { value: number; prev: number; change: number }
    customers: { value: number; prev: number; change: number }
    customersActive: number
    conversionRate: number
    opportunitiesOpen: number
    opportunitiesWon: number
    opportunitiesLost: number
    wonValue: { value: number; prev: number; change: number }
    openValue: number
    received: { value: number; prev: number; change: number }
    pending: number
    overdue: number
    expenses: { value: number; prev: number; change: number }
    profit: number
  }
  leadsSeries: { date: string; leads: number; converted: number }[]
  financialSeries: { date: string; revenue: number; expenses: number; profit: number }[]
  leadsByStatus: { status: string; count: number }[]
  leadsByTemperature: { temperature: string; count: number }[]
  invoicesByStatus: { status: string; count: number; total: number }[]
  paymentsByMethod: { method: string; total: number; count: number }[]
  expensesByCategory: { category: string; total: number; count: number }[]
  funnel: { name: string; color: string; count: number; value: number }[]
  topClients: { name: string; total: number }[]
}

// ═══ Constantes ═══
const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe']
const PIE_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6']

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Novo', CONTACTED: 'Contatado', QUALIFYING: 'Qualificando',
  QUALIFIED: 'Qualificado', UNQUALIFIED: 'Não qualificado', DISQUALIFIED: 'Desqualificado',
  DRAFT: 'Rascunho', SENT: 'Enviada', VIEWED: 'Visualizada',
  PARTIAL: 'Parcial', PAID: 'Paga', OVERDUE: 'Vencida', CANCELLED: 'Cancelada',
}

const TEMP_LABELS: Record<string, string> = { HOT: 'Quente', WARM: 'Morno', COLD: 'Frio' }
const TEMP_COLORS: Record<string, string> = { HOT: '#ef4444', WARM: '#f59e0b', COLD: '#3b82f6' }

const METHOD_LABELS: Record<string, string> = {
  PIX: 'PIX', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão Crédito',
  DEBIT_CARD: 'Cartão Débito', TRANSFER: 'Transferência', CASH: 'Dinheiro', OTHER: 'Outro',
}

type PeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'this_week' | 'this_month' | 'this_year' | 'custom'

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'this_week', label: 'Esta semana' },
  { key: 'this_month', label: 'Este mês' },
  { key: 'this_year', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' },
]

function getDateRange(period: PeriodKey, customFrom?: string, customTo?: string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'today': return { dateFrom: today.toISOString(), dateTo: now.toISOString() }
    case 'yesterday': { const y = new Date(today); y.setDate(y.getDate() - 1); return { dateFrom: y.toISOString(), dateTo: today.toISOString() } }
    case '7d': { const d = new Date(today); d.setDate(d.getDate() - 7); return { dateFrom: d.toISOString(), dateTo: now.toISOString() } }
    case '30d': { const d = new Date(today); d.setDate(d.getDate() - 30); return { dateFrom: d.toISOString(), dateTo: now.toISOString() } }
    case 'this_week': { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return { dateFrom: d.toISOString(), dateTo: now.toISOString() } }
    case 'this_month': return { dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), dateTo: now.toISOString() }
    case 'this_year': return { dateFrom: new Date(now.getFullYear(), 0, 1).toISOString(), dateTo: now.toISOString() }
    case 'custom': return { dateFrom: customFrom || today.toISOString(), dateTo: customTo || now.toISOString() }
    default: return { dateFrom: new Date(today.getTime() - 30 * 86400000).toISOString(), dateTo: now.toISOString() }
  }
}

// ═══ Formatadores ═══
const fmtCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
const fmtCurrencyFull = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtNumber = (v: number) => new Intl.NumberFormat('pt-BR').format(v)
const fmtDate = (d: string) => { const [, m, day] = d.split('-'); return `${day}/${m}` }

// ═══ Tooltip ═══
function CustomTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold">{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ═══ Componentes ═══
function KpiCard({ title, value, change, icon: Icon, color, subtitle }: {
  title: string; value: string | number; change?: number; icon: any; color: string; subtitle?: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/40 bg-card p-4 transition-all duration-300 hover:shadow-lg hover:border-border/60 hover:-translate-y-0.5">
      <div className="absolute top-0 right-0 w-24 h-24 opacity-[0.04] transform translate-x-6 -translate-y-6">
        <Icon className="w-full h-full" style={{ color }} />
      </div>
      <div className="flex items-start justify-between mb-3">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon className="h-4.5 w-4.5" style={{ color }} />
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md ${
            change > 0 ? 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400'
            : change < 0 ? 'text-red-500 bg-red-500/10 dark:text-red-400'
            : 'text-muted-foreground bg-muted/50'
          }`}>
            {change > 0 ? <ArrowUpRight className="h-3 w-3" /> : change < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

function ChartCard({ children, title, subtitle, className = '' }: {
  children: React.ReactNode; title: string; subtitle?: string; className?: string
}) {
  return (
    <div className={`rounded-xl border border-border/40 bg-card p-5 ${className}`}>
      <div className="mb-4">
        <h4 className="text-sm font-semibold">{title}</h4>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center">
      <div className="text-center">
        <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
        <p className="text-xs text-muted-foreground/60">{text}</p>
      </div>
    </div>
  )
}

// ═══ Dashboard ═══
export function Dashboard() {
  const { can } = usePermissions()
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)
  const [activeTab, setActiveTab] = useState<'commercial' | 'financial'>('commercial')

  const dateRange = useMemo(() => getDateRange(period, customFrom, customTo), [period, customFrom, customTo])

  const { data, isLoading, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard-v2', dateRange],
    queryFn: () => reportService.dashboard(dateRange),
    refetchInterval: 5 * 60 * 1000,
  })

  const kpis = data?.kpis

  const leadsFunnelData = useMemo(() => {
    if (!data?.leadsByStatus?.length) return []
    const order = ['NEW', 'CONTACTED', 'QUALIFYING', 'QUALIFIED']
    return order.map(s => {
      const found = data.leadsByStatus.find(l => l.status === s)
      return found ? { name: STATUS_LABELS[s] || s, value: found.count } : null
    }).filter(Boolean) as { name: string; value: number }[]
  }, [data?.leadsByStatus])

  const tempData = useMemo(() => {
    if (!data?.leadsByTemperature?.length) return []
    return data.leadsByTemperature.map(t => ({
      name: TEMP_LABELS[t.temperature] || t.temperature,
      value: t.count,
      fill: TEMP_COLORS[t.temperature] || '#94a3b8',
    }))
  }, [data?.leadsByTemperature])

  const methodData = useMemo(() => {
    if (!data?.paymentsByMethod?.length) return []
    return data.paymentsByMethod.map((m, i) => ({
      name: METHOD_LABELS[m.method] || m.method,
      value: m.total,
      fill: PIE_COLORS[i % PIE_COLORS.length],
    }))
  }, [data?.paymentsByMethod])

  const expCatData = useMemo(() => {
    if (!data?.expensesByCategory?.length) return []
    return data.expensesByCategory.sort((a, b) => b.total - a.total).map((e, i) => ({
      name: e.category,
      value: e.total,
      fill: PIE_COLORS[i % PIE_COLORS.length],
    }))
  }, [data?.expensesByCategory])

  const periodLabel = PERIOD_OPTIONS.find(p => p.key === period)?.label || 'Período'

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Visão geral comercial e financeira</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowPeriodMenu(!showPeriodMenu)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border/50 bg-card hover:bg-accent/50 transition-colors"
            >
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{periodLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {showPeriodMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPeriodMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-border/50 bg-card shadow-xl p-1">
                  {PERIOD_OPTIONS.filter(p => p.key !== 'custom').map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => { setPeriod(opt.key); setShowPeriodMenu(false) }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                        period === opt.key ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <div className="border-t border-border/30 mt-1 pt-1">
                    <p className="px-3 py-1 text-xs text-muted-foreground font-medium">Personalizado</p>
                    <div className="px-3 py-1 space-y-1.5">
                      <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPeriod('custom') }} className="w-full px-2 py-1.5 text-xs rounded-md border border-border/50 bg-background" />
                      <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPeriod('custom') }} className="w-full px-2 py-1.5 text-xs rounded-md border border-border/50 bg-background" />
                      <button onClick={() => setShowPeriodMenu(false)} className="w-full py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90">Aplicar</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => refetch()} className="p-2 rounded-lg border border-border/50 bg-card hover:bg-accent/50 transition-colors" title="Atualizar dados">
            <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && !data && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card p-4">
              <div className="h-9 w-9 rounded-lg bg-muted/50 animate-pulse mb-3" />
              <div className="h-7 w-20 bg-muted/50 rounded animate-pulse mb-1" />
              <div className="h-3 w-16 bg-muted/30 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {data && kpis && (
        <>
          {/* KPIs principais */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <KpiCard title="Leads Recebidos" value={fmtNumber(kpis.leads.value)} change={kpis.leads.change} icon={Target} color="#6366f1" subtitle="vs período anterior" />
            <KpiCard title="Leads Convertidos" value={fmtNumber(kpis.leadsConverted.value)} change={kpis.leadsConverted.change} icon={TrendingUp} color="#10b981" subtitle="vs período anterior" />
            <KpiCard title="Clientes Gerados" value={fmtNumber(kpis.customers.value)} change={kpis.customers.change} icon={Users} color="#06b6d4" subtitle={`${kpis.customersActive} ativos`} />
            <KpiCard title="Taxa de Conversão" value={`${kpis.conversionRate}%`} icon={PieChart} color="#8b5cf6" subtitle="leads → clientes" />
          </div>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <KpiCard title="Valor Fechado" value={fmtCurrency(kpis.wonValue.value)} change={kpis.wonValue.change} icon={Trophy} color="#10b981" subtitle="oportunidades ganhas" />
            <KpiCard title="Valor em Aberto" value={fmtCurrency(kpis.openValue)} icon={Briefcase} color="#f59e0b" subtitle={`${kpis.opportunitiesOpen} oportunidades`} />
            <KpiCard title="Total Recebido" value={fmtCurrency(kpis.received.value)} change={kpis.received.change} icon={DollarSign} color="#10b981" subtitle="pagamentos confirmados" />
            <KpiCard title="Total Despesas" value={fmtCurrency(kpis.expenses.value)} change={kpis.expenses.change} icon={CreditCard} color="#ef4444" subtitle="no período" />
          </div>

          {/* Mini KPIs financeiros */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-amber-500/10">
                <Wallet className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-bold">{fmtCurrency(kpis.pending)}</p>
                <p className="text-[10px] text-muted-foreground">A Receber (Pendente)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-500">{fmtCurrency(kpis.overdue)}</p>
                <p className="text-[10px] text-muted-foreground">Vencido / Inadimplente</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-500/10">
                <Receipt className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(kpis.profit)}</p>
                <p className="text-[10px] text-muted-foreground">Resultado (Lucro/Prejuízo)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-indigo-500/10">
                <Briefcase className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <p className="text-sm font-bold">{kpis.opportunitiesWon + kpis.opportunitiesLost + kpis.opportunitiesOpen}</p>
                <p className="text-[10px] text-muted-foreground">{kpis.opportunitiesWon} ganhas · {kpis.opportunitiesLost} perdidas</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg w-fit">
            <button onClick={() => setActiveTab('commercial')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'commercial' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              Comercial
            </button>
            <button onClick={() => setActiveTab('financial')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'financial' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              Financeiro
            </button>
          </div>

          {/* ═══ ABA COMERCIAL ═══ */}
          {activeTab === 'commercial' && (
            <div className="space-y-5">
              <SectionHeader icon={Target} title="Performance Comercial" subtitle="Leads, conversões e pipeline" />

              <div className="grid gap-5 lg:grid-cols-2">
                {/* Evolução de Leads */}
                <ChartCard title="Evolução de Leads" subtitle="Novos leads e conversões por dia">
                  {data.leadsSeries.length > 0 ? (
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.leadsSeries}>
                          <defs>
                            <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradConverted" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} className="text-muted-foreground" />
                          <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                          <Tooltip content={<CustomTooltip formatter={fmtNumber} />} />
                          <Area type="monotone" dataKey="leads" name="Novos Leads" stroke="#6366f1" fill="url(#gradLeads)" strokeWidth={2} />
                          <Area type="monotone" dataKey="converted" name="Convertidos" stroke="#10b981" fill="url(#gradConverted)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState text="Sem dados de leads no período" />}
                </ChartCard>

                {/* Funil do Pipeline */}
                <ChartCard title="Funil do Pipeline" subtitle="Distribuição por estágio">
                  {data.funnel.length > 0 ? (
                    <div className="space-y-3">
                      {data.funnel.map((stage, i) => {
                        const maxCount = Math.max(...data.funnel.map(s => s.count), 1)
                        const pct = (stage.count / maxCount) * 100
                        return (
                          <div key={i} className="group">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: stage.color }} />
                                <span className="text-xs font-medium">{stage.name}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-muted-foreground">{stage.count} cards</span>
                                <span className="font-semibold">{fmtCurrency(stage.value)}</span>
                              </div>
                            </div>
                            <div className="h-7 bg-muted/20 rounded-lg overflow-hidden relative">
                              <div
                                className="h-full rounded-lg transition-all duration-700 flex items-center px-2"
                                style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: `${stage.color}30`, borderLeft: `3px solid ${stage.color}` }}
                              >
                                {pct > 15 && <span className="text-[10px] font-semibold" style={{ color: stage.color }}>{Math.round(pct)}%</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div className="flex items-center justify-between pt-2 border-t border-border/30 mt-3">
                        <span className="text-xs text-muted-foreground">Total pipeline</span>
                        <span className="text-sm font-bold">{fmtCurrency(data.funnel.reduce((s, f) => s + f.value, 0))}</span>
                      </div>
                    </div>
                  ) : <EmptyState text="Sem dados de pipeline" />}
                </ChartCard>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                {/* Leads por Status */}
                <ChartCard title="Leads por Status" subtitle="Distribuição atual">
                  {leadsFunnelData.length > 0 ? (
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={leadsFunnelData} layout="vertical" barSize={20}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                          <Tooltip content={<CustomTooltip formatter={fmtNumber} />} />
                          <Bar dataKey="value" name="Leads" radius={[0, 6, 6, 0]}>
                            {leadsFunnelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState text="Sem dados de leads" />}
                </ChartCard>

                {/* Leads por Temperatura */}
                <ChartCard title="Temperatura dos Leads" subtitle="Quente, morno e frio">
                  {tempData.length > 0 ? (
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPie>
                          <Pie data={tempData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                            {tempData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                          </Pie>
                          <Tooltip content={<CustomTooltip formatter={fmtNumber} />} />
                          <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>} />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState text="Sem dados de temperatura" />}
                </ChartCard>

                {/* Top Clientes */}
                <ChartCard title="Top Clientes" subtitle="Maiores receitas no período">
                  {data.topClients.length > 0 ? (
                    <div className="space-y-3">
                      {data.topClients.map((client, i) => {
                        const maxTotal = Math.max(...data.topClients.map(c => c.total), 1)
                        const barPct = (client.total / maxTotal) * 100
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{i + 1}</div>
                                <span className="text-xs font-medium truncate max-w-[120px]">{client.name}</span>
                              </div>
                              <span className="text-xs font-semibold">{fmtCurrency(client.total)}</span>
                            </div>
                            <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : <EmptyState text="Sem dados de clientes" />}
                </ChartCard>
              </div>
            </div>
          )}

          {/* ═══ ABA FINANCEIRA ═══ */}
          {activeTab === 'financial' && (
            <div className="space-y-5">
              <SectionHeader icon={DollarSign} title="Performance Financeira" subtitle="Receitas, despesas e fluxo de caixa" />

              {/* Receita vs Despesas */}
              <ChartCard title="Receita vs Despesas" subtitle="Comparativo diário no período">
                {data.financialSeries.length > 0 ? (
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.financialSeries}>
                        <defs>
                          <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtCurrency(v)} />
                        <Tooltip content={<CustomTooltip formatter={fmtCurrencyFull} />} />
                        <Legend iconType="circle" iconSize={8} formatter={(v: string) => <span className="text-xs">{v}</span>} />
                        <Area type="monotone" dataKey="revenue" name="Receita" stroke="#10b981" fill="url(#gradRevenue)" strokeWidth={2.5} />
                        <Area type="monotone" dataKey="expenses" name="Despesas" stroke="#ef4444" fill="url(#gradExpenses)" strokeWidth={2} strokeDasharray="5 5" />
                        <Line type="monotone" dataKey="profit" name="Resultado" stroke="#6366f1" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState text="Sem dados financeiros no período" />}
              </ChartCard>

              <div className="grid gap-5 lg:grid-cols-2">
                {/* Pagamentos por Método */}
                <ChartCard title="Pagamentos por Método" subtitle="Distribuição de métodos de pagamento">
                  {methodData.length > 0 ? (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPie>
                          <Pie data={methodData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                            {methodData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                          </Pie>
                          <Tooltip content={<CustomTooltip formatter={fmtCurrencyFull} />} />
                          <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-xs">{value}</span>} />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </div>
                  ) : <EmptyState text="Sem pagamentos no período" />}
                </ChartCard>

                {/* Despesas por Categoria */}
                <ChartCard title="Despesas por Categoria" subtitle="Distribuição de gastos">
                  {expCatData.length > 0 ? (
                    <div className="space-y-3">
                      {expCatData.map((cat, i) => {
                        const total = expCatData.reduce((s, c) => s + c.value, 0)
                        const pct = total > 0 ? (cat.value / total) * 100 : 0
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cat.fill }} />
                                <span className="text-xs font-medium">{cat.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</span>
                                <span className="text-xs font-semibold">{fmtCurrency(cat.value)}</span>
                              </div>
                            </div>
                            <div className="h-2 bg-muted/20 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: cat.fill }} />
                            </div>
                          </div>
                        )
                      })}
                      <div className="flex items-center justify-between pt-2 border-t border-border/30 mt-2">
                        <span className="text-xs text-muted-foreground">Total de despesas</span>
                        <span className="text-sm font-bold">{fmtCurrency(expCatData.reduce((s, c) => s + c.value, 0))}</span>
                      </div>
                    </div>
                  ) : <EmptyState text="Sem despesas no período" />}
                </ChartCard>
              </div>

              {/* Faturas por Status */}
              <ChartCard title="Faturas por Status" subtitle="Distribuição de faturas no período">
                {data.invoicesByStatus.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                    {data.invoicesByStatus.map((inv, i) => {
                      const statusColors: Record<string, string> = {
                        DRAFT: '#94a3b8', SENT: '#3b82f6', VIEWED: '#8b5cf6',
                        PARTIAL: '#f59e0b', PAID: '#10b981', OVERDUE: '#ef4444', CANCELLED: '#6b7280',
                      }
                      const color = statusColors[inv.status] || '#94a3b8'
                      return (
                        <div key={i} className="text-center p-3 rounded-xl border border-border/30 bg-card">
                          <div className="text-xl font-bold" style={{ color }}>{inv.count}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{STATUS_LABELS[inv.status] || inv.status}</div>
                          <div className="text-[10px] font-semibold mt-0.5">{fmtCurrency(inv.total)}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : <EmptyState text="Sem faturas no período" />}
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  )
}
