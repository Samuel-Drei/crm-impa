import { useState, useEffect, useCallback } from 'react'
import {
  Star, Users, TrendingUp, MessageSquare, RefreshCw, Download,
  Calendar, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, Minus,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadialBarChart, RadialBar, Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import api from '@/services/api'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface Instance { id: string; name: string; channel: string }

interface CsatResponse {
  id: string
  rating: number
  feedbackMessage: string | null
  createdAt: string
  contact: { id: string; name: string; phoneNumber: string; profilePicture: string | null }
  assignedAgent: { id: string; name: string; email: string } | null
  conversation: { id: string; remoteJid: string }
}

interface CsatMetrics {
  averageRating: number
  totalResponses: number
  distribution: { rating: number; count: number }[]
  byAgent: { agentId: string | null; agentName: string; averageRating: number; count: number }[]
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PERIODS = [
  { label: 'Hoje',    days: 0 },
  { label: '7 dias',  days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
]

const RATING_META: Record<number, { label: string; color: string; hex: string }> = {
  1: { label: 'PÃ©ssimo',   color: 'text-red-500',    hex: '#ef4444' },
  2: { label: 'Ruim',      color: 'text-orange-500', hex: '#f97316' },
  3: { label: 'Regular',   color: 'text-yellow-500', hex: '#eab308' },
  4: { label: 'Bom',       color: 'text-lime-500',   hex: '#84cc16' },
  5: { label: 'Excelente', color: 'text-green-500',  hex: '#22c55e' },
}

const LIMIT = 20

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toDateStr(d: Date) { return d.toISOString().split('T')[0] }

function getRange(days: number): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date()
  if (days > 0) start.setDate(start.getDate() - (days - 1))
  return { startDate: toDateStr(start), endDate: toDateStr(end) }
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5 items-center">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
      ))}
    </span>
  )
}

function RatingPill({ rating }: { rating: number }) {
  const m = RATING_META[rating]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-muted ${m.color}`}>
      <Star className="w-3 h-3 fill-current" /> {rating} â€” {m.label}
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// custom tooltip for recharts
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-popover border rounded-lg shadow-xl p-3 text-sm">
      <p className="font-semibold text-foreground mb-1">
        <Star className="inline w-3.5 h-3.5 mr-1 fill-yellow-400 text-yellow-400" />
        {d.rating} â€” {RATING_META[d.rating]?.label}
      </p>
      <p className="text-muted-foreground">{d.count} resposta{d.count !== 1 ? 's' : ''} ({d.pct}%)</p>
    </div>
  )
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function CSATReport() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [instanceId, setInstanceId] = useState('')
  const [activePeriod, setActivePeriod] = useState(1) // index into PERIODS
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [page, setPage] = useState(1)

  const [metrics, setMetrics] = useState<CsatMetrics | null>(null)
  const [responses, setResponses] = useState<CsatResponse[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  // init date range
  useEffect(() => {
    const r = getRange(PERIODS[activePeriod].days)
    setStartDate(r.startDate)
    setEndDate(r.endDate)
  }, [])

  // load instances once
  useEffect(() => {
    api.get('/instances').then(r => {
      const list: Instance[] = r.data?.instances || r.data || []
      setInstances(list)
      if (list.length > 0) setInstanceId(list[0].id)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!instanceId || !startDate || !endDate) return
    setLoading(true)
    try {
      const dateParams = { startDate, endDate }
      const respParams: any = { ...dateParams, page: String(page), limit: String(LIMIT) }
      if (ratingFilter) respParams.rating = ratingFilter

      const [mRes, rRes] = await Promise.all([
        api.get(`/channel-settings/${instanceId}/csat/metrics`, { params: dateParams }),
        api.get(`/channel-settings/${instanceId}/csat/responses`, { params: respParams }),
      ])
      setMetrics(mRes.data)
      setResponses(rRes.data.responses || [])
      setTotal(rRes.data.total || 0)
    } catch { /* noop */ }
    setLoading(false)
  }, [instanceId, startDate, endDate, ratingFilter, page])

  useEffect(() => { load() }, [load])

  function applyPeriod(idx: number) {
    setActivePeriod(idx)
    const r = getRange(PERIODS[idx].days)
    setStartDate(r.startDate)
    setEndDate(r.endDate)
    setPage(1)
  }

  function exportCsv() {
    if (!responses.length) return
    const rows = [
      ['Contato', 'Telefone', 'Nota', 'Label', 'Agente', 'ComentÃ¡rio', 'Data'],
      ...responses.map(r => [
        r.contact.name,
        r.contact.phoneNumber,
        r.rating,
        RATING_META[r.rating]?.label,
        r.assignedAgent?.name ?? '',
        (r.feedbackMessage ?? '').replace(/,/g, ';'),
        new Date(r.createdAt).toLocaleString('pt-BR'),
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `csat-${startDate}-${endDate}.csv`
    a.click()
  }

  // Derived
  const chartData = [1,2,3,4,5].map(r => {
    const d = metrics?.distribution.find(x => x.rating === r)
    const count = d?.count ?? 0
    const pct = metrics && metrics.totalResponses > 0 ? Math.round(count / metrics.totalResponses * 100) : 0
    return { rating: r, count, pct, fill: RATING_META[r].hex }
  })

  const avg = metrics?.averageRating ?? 0
  const positiveCount = metrics?.distribution.filter(d => d.rating >= 4).reduce((s, d) => s + d.count, 0) ?? 0
  const negativCount  = metrics?.distribution.filter(d => d.rating <= 2).reduce((s, d) => s + d.count, 0) ?? 0
  const totalPages = Math.ceil(total / LIMIT)

  const satisfaction = metrics && metrics.totalResponses > 0
    ? Math.round(positiveCount / metrics.totalResponses * 100)
    : 0

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="w-6 h-6 fill-yellow-400 text-yellow-400" />
            Pesquisa de SatisfaÃ§Ã£o (CSAT)
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AvaliaÃ§Ãµes recebidas ao final de cada atendimento resolvido
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!responses.length}>
            <Download className="w-4 h-4 mr-1.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      {/* â”€â”€ Filters â”€â”€ */}
      <div className="bg-card border rounded-xl p-4 flex flex-wrap gap-4 items-end">
        {/* Canal */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Canal</label>
          <select
            value={instanceId}
            onChange={e => { setInstanceId(e.target.value); setPage(1) }}
            className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[140px]"
          >
            {instances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        {/* PerÃ­odo rÃ¡pido */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">PerÃ­odo</label>
          <div className="flex gap-1">
            {PERIODS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => applyPeriod(idx)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                  activePeriod === idx
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Datas customizadas */}
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">De</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setActivePeriod(-1); setPage(1) }}
              className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">AtÃ©</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setActivePeriod(-1); setPage(1) }}
              className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Nota */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Nota</label>
          <select
            value={ratingFilter}
            onChange={e => { setRatingFilter(e.target.value); setPage(1) }}
            className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todas as notas</option>
            {[1,2,3,4,5].map(n => (
              <option key={n} value={n}>{'â­'.repeat(n)} {n} â€” {RATING_META[n].label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      )}

      {!loading && metrics && (
        <>
          {/* â”€â”€ KPI Cards â”€â”€ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Nota MÃ©dia â€” big card */}
            <div className="bg-card border rounded-xl p-5 flex items-center gap-4 col-span-2 lg:col-span-1">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/30" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none"
                    stroke={avg >= 4 ? '#22c55e' : avg >= 3 ? '#eab308' : '#ef4444'}
                    strokeWidth="2.5"
                    strokeDasharray={`${(avg / 5) * 100} 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold">{avg > 0 ? avg.toFixed(1) : 'â€”'}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Nota MÃ©dia</p>
                <p className="text-2xl font-bold">{avg > 0 ? avg.toFixed(2) : 'â€”'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {avg > 0 ? RATING_META[Math.round(avg)]?.label : 'Sem respostas'}
                </p>
              </div>
            </div>

            <div className="bg-card border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <p className="text-3xl font-bold">{metrics.totalResponses}</p>
              <p className="text-xs text-muted-foreground mt-1">avaliaÃ§Ãµes no perÃ­odo</p>
            </div>

            <div className="bg-card border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <ThumbsUp className="w-5 h-5 text-green-500" />
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${satisfaction >= 70 ? 'bg-green-500/15 text-green-600' : satisfaction >= 50 ? 'bg-yellow-500/15 text-yellow-600' : 'bg-red-500/15 text-red-600'}`}>
                  {satisfaction}%
                </span>
              </div>
              <p className="text-3xl font-bold text-green-500">{positiveCount}</p>
              <p className="text-xs text-muted-foreground mt-1">positivas (4 ou 5 â­)</p>
            </div>

            <div className="bg-card border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <ThumbsDown className="w-5 h-5 text-red-500" />
                <span className="text-xs text-muted-foreground">
                  {metrics.totalResponses > 0 ? Math.round(negativCount / metrics.totalResponses * 100) : 0}%
                </span>
              </div>
              <p className="text-3xl font-bold text-red-500">{negativCount}</p>
              <p className="text-xs text-muted-foreground mt-1">negativas (1 ou 2 â­)</p>
            </div>
          </div>

          {/* â”€â”€ Charts row â”€â”€ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* DistribuiÃ§Ã£o â€” recharts horizontal bar */}
            <div className="bg-card border rounded-xl p-5 lg:col-span-3">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                DistribuiÃ§Ã£o por Nota
              </h2>
              {metrics.totalResponses === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                  <Star className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Nenhuma avaliaÃ§Ã£o no perÃ­odo</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={[...chartData].reverse()}
                    layout="vertical"
                    margin={{ top: 0, right: 50, left: 10, bottom: 0 }}
                    barSize={18}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="rating"
                      tickFormatter={v => `${v}â­`}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted)/0.3)' }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} label={{ position: 'right', fontSize: 11, fill: 'hsl(var(--muted-foreground))', formatter: (v: number) => v > 0 ? v : '' }}>
                      {[...chartData].reverse().map((entry) => (
                        <Cell key={entry.rating} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Por Agente */}
            <div className="bg-card border rounded-xl p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-500" />
                Por Agente
              </h2>
              {metrics.byAgent.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                  <Users className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Sem dados</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                  {[...metrics.byAgent]
                    .filter(a => a.agentId)
                    .sort((a, b) => b.averageRating - a.averageRating)
                    .map(agent => {
                      const pct = (agent.averageRating / 5) * 100
                      const hex = RATING_META[Math.round(agent.averageRating)]?.hex ?? '#6366f1'
                      return (
                        <div key={agent.agentId} className="flex items-center gap-3">
                          <Avatar name={agent.agentName} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium truncate">{agent.agentName}</span>
                              <span className="text-sm font-bold ml-2 flex-shrink-0" style={{ color: hex }}>
                                {agent.averageRating.toFixed(1)}
                              </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: hex }} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{agent.count} avaliaÃ§Ã£o{agent.count !== 1 ? 'Ãµes' : ''}</p>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>

          {/* â”€â”€ Responses table â”€â”€ */}
          <div className="bg-card border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-green-500" />
                Respostas Individuais
                <span className="ml-1 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-normal">{total}</span>
              </h2>
            </div>

            {responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
                <Star className="w-12 h-12 opacity-10" />
                <p className="text-sm">Nenhuma avaliaÃ§Ã£o para os filtros selecionados</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium">Contato</th>
                      <th className="text-left px-4 py-2.5 font-medium">Nota</th>
                      <th className="text-left px-4 py-2.5 font-medium">ComentÃ¡rio</th>
                      <th className="text-left px-4 py-2.5 font-medium">Agente</th>
                      <th className="text-left px-4 py-2.5 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {responses.map(r => (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={r.contact.name || r.contact.phoneNumber} />
                            <div>
                              <p className="font-medium text-foreground">{r.contact.name || r.contact.phoneNumber}</p>
                              {r.contact.name && <p className="text-xs text-muted-foreground">{r.contact.phoneNumber}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <RatingPill rating={r.rating} />
                            <StarRow rating={r.rating} />
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          {r.feedbackMessage
                            ? <p className="text-xs text-muted-foreground italic line-clamp-2" title={r.feedbackMessage}>"{r.feedbackMessage}"</p>
                            : <span className="text-xs text-muted-foreground/40">â€”</span>}
                        </td>
                        <td className="px-4 py-3">
                          {r.assignedAgent
                            ? <div className="flex items-center gap-2">
                                <Avatar name={r.assignedAgent.name} />
                                <span className="text-sm">{r.assignedAgent.name}</span>
                              </div>
                            : <span className="text-xs text-muted-foreground">Sem agente</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * LIMIT + 1}â€“{Math.min(page * LIMIT, total)} de {total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-muted-foreground px-2">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-md border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !metrics && instanceId && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Star className="w-16 h-16 opacity-10" />
          <p className="text-base">Nenhuma avaliaÃ§Ã£o encontrada para este canal</p>
          <p className="text-sm opacity-60">Habilite o CSAT em InstÃ¢ncias â†’ ConfiguraÃ§Ãµes â†’ aba CSAT</p>
        </div>
      )}
    </div>
  )
}

