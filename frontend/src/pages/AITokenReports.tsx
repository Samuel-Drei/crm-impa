import { useState, useEffect, useCallback } from 'react'
import { BarChart3, TrendingUp, Cpu, MessageSquare, DollarSign, Calendar, RefreshCw, Download, ChevronDown, Bot, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/services/api'

interface TokenReport {
  id: string
  date: string
  agentId: string | null
  agentName: string
  instanceId: string | null
  instanceName: string
  messagesCount: number
  sessionsCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  costBrl: number
}

interface ReportTotals {
  messagesCount: number
  sessionsCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  costBrl: number
}

interface AgentUsage {
  agentId: string
  agentName: string
  totalTokens: number
  costUsd: number
  costBrl: number
  messagesCount: number
}

interface InstanceUsage {
  instanceId: string
  instanceName: string
  totalTokens: number
  costUsd: number
  costBrl: number
  messagesCount: number
}

const PERIODS = [
  { value: '1d',   label: 'Hoje' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: '90d',  label: '90 dias' },
  { value: '365d', label: '1 ano' },
]

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCostUsd(n: number): string {
  if (n < 0.000001) return 'US$ 0.00'
  if (n < 0.01) return `US$ ${n.toFixed(6)}`
  return `US$ ${n.toFixed(4)}`
}

function formatCostBrl(n: number): string {
  if (n < 0.001) return `R$ ${(n * 100).toFixed(4)}¢`
  return `R$ ${n.toFixed(4)}`
}

export function AITokenReports() {
  const [period, setPeriod] = useState('7d')
  const [activeTab, setActiveTab] = useState<'timeline' | 'by-agent' | 'by-instance' | 'sessions'>('timeline')
  const [loading, setLoading] = useState(true)

  const [reports, setReports] = useState<TokenReport[]>([])
  const [totals, setTotals] = useState<ReportTotals | null>(null)
  const [agentUsage, setAgentUsage] = useState<AgentUsage[]>([])
  const [instanceUsage, setInstanceUsage] = useState<InstanceUsage[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionPage, setSessionPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [timelineRes, agentRes, instanceRes] = await Promise.all([
        api.get(`/ai/token-usage?period=${period}`),
        api.get(`/ai/token-usage/by-agent?period=${period}`),
        api.get(`/ai/token-usage/by-instance?period=${period}`),
      ])
      setReports(timelineRes.data.reports || [])
      setTotals(timelineRes.data.totals || null)
      setAgentUsage(agentRes.data || [])
      setInstanceUsage(instanceRes.data || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  async function loadSessions() {
    const res = await api.get(`/ai/token-usage/sessions?period=${period}&page=${sessionPage}`)
    setSessions(res.data.sessions || [])
    setSessionTotal(res.data.total || 0)
  }

  useEffect(() => {
    if (activeTab === 'sessions') loadSessions()
  }, [activeTab, sessionPage, period])

  function exportCsv() {
    const rows = [
      ['Data', 'Agente', 'Instância', 'Mensagens', 'Tokens Entrada', 'Tokens Saída', 'Total Tokens', 'Custo USD', 'Custo BRL'],
      ...reports.map(r => [
        new Date(r.date).toLocaleDateString('pt-BR'),
        r.agentName,
        r.instanceName,
        r.messagesCount,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.costUsd.toFixed(8),
        r.costBrl.toFixed(6),
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tokens-${period}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const maxBarValue = reports.length > 0 ? Math.max(...reports.map(r => r.totalTokens)) : 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-purple-400" />
            Relatório de Tokens & Custos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Controle rigoroso de cada token gasto — por agente, instância, dia, semana e hora
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Período:</span>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-purple-600 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-card border rounded-xl p-4 col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Mensagens</span>
            </div>
            <div className="text-2xl font-bold">{totals.messagesCount.toLocaleString('pt-BR')}</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wifi className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-muted-foreground">Sessões</span>
            </div>
            <div className="text-2xl font-bold">{totals.sessionsCount.toLocaleString('pt-BR')}</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-muted-foreground">Tokens Entrada</span>
            </div>
            <div className="text-2xl font-bold text-yellow-400">{formatTokens(totals.promptTokens)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-orange-400" />
              <span className="text-xs text-muted-foreground">Tokens Saída</span>
            </div>
            <div className="text-2xl font-bold text-orange-400">{formatTokens(totals.completionTokens)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Total Tokens</span>
            </div>
            <div className="text-2xl font-bold">{formatTokens(totals.totalTokens)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4 border-red-900/30">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Custo USD</span>
            </div>
            <div className="text-xl font-bold text-green-400 cursor-help" title="Valor em dólar americano (USD)">{formatCostUsd(totals.costUsd)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4 border-yellow-900/30">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-yellow-300" />
              <span className="text-xs text-muted-foreground">Custo BRL</span>
            </div>
            <div className="text-xl font-bold text-yellow-300 cursor-help" title="Valor aproximado em real brasileiro (BRL) — câmbio pode variar">{formatCostBrl(totals.costBrl)}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-1">
          {[
            { id: 'timeline', label: 'Timeline Diário', icon: Calendar },
            { id: 'by-agent', label: 'Por Agente', icon: Bot },
            { id: 'by-instance', label: 'Por Instância', icon: Wifi },
            { id: 'sessions', label: 'Por Sessão', icon: MessageSquare },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      ) : (
        <>
          {/* TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              {/* Bar chart */}
              {reports.length > 0 && (
                <div className="bg-card border rounded-xl p-6">
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">Tokens por dia</h3>
                  <div className="flex items-end gap-1 h-32">
                    {reports.slice().reverse().map((r, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center group relative">
                        <div
                          className="w-full bg-purple-500/30 rounded-t hover:bg-purple-500/60 transition-colors cursor-pointer"
                          style={{ height: `${(r.totalTokens / maxBarValue) * 100}%` }}
                          title={`${new Date(r.date).toLocaleDateString('pt-BR')}: ${formatTokens(r.totalTokens)} tokens | ${formatCostBrl(r.costBrl)}`}
                        />
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card border rounded p-2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                          <div className="font-medium">{new Date(r.date).toLocaleDateString('pt-BR')}</div>
                          <div>{formatTokens(r.totalTokens)} tokens</div>
                          <div className="text-green-400">{formatCostBrl(r.costBrl)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="bg-card border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Data</th>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Agente</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Msgs</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Entrada</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Saída</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Total</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">USD</th>
                      <th className="px-4 py-3 text-right text-yellow-400 font-medium">BRL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reports.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                          Nenhum dado no período selecionado
                        </td>
                      </tr>
                    ) : reports.map(r => (
                      <tr key={r.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(r.date).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Bot className="w-3 h-3 text-purple-400" />
                            {r.agentName}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.messagesCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-400">{formatTokens(r.promptTokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-orange-400">{formatTokens(r.completionTokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{formatTokens(r.totalTokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-green-400">{formatCostUsd(r.costUsd)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-300 font-semibold">{formatCostBrl(r.costBrl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* BY AGENT */}
          {activeTab === 'by-agent' && (
            <div className="bg-card border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium">Agente</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Mensagens</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Total Tokens</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Custo USD</th>
                    <th className="px-4 py-3 text-right text-yellow-400 font-medium">Custo BRL</th>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium">% do total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {agentUsage.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nenhum dado</td></tr>
                  ) : agentUsage.map((a, i) => {
                    const totalCost = agentUsage.reduce((s, x) => s + x.costUsd, 0)
                    const pct = totalCost > 0 ? (a.costUsd / totalCost * 100) : 0
                    return (
                      <tr key={i} className="hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-purple-400" />
                            <span className="font-medium">{a.agentName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{a.messagesCount.toLocaleString('pt-BR')}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatTokens(a.totalTokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-green-400">{formatCostUsd(a.costUsd)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-300 font-semibold">{formatCostBrl(a.costBrl)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-secondary rounded-full h-2">
                              <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* BY INSTANCE */}
          {activeTab === 'by-instance' && (
            <div className="bg-card border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium">Instância</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Mensagens</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Total Tokens</th>
                    <th className="px-4 py-3 text-right text-muted-foreground font-medium">Custo USD</th>
                    <th className="px-4 py-3 text-right text-yellow-400 font-medium">Custo BRL</th>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium">% do total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {instanceUsage.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nenhum dado</td></tr>
                  ) : instanceUsage.map((inst, i) => {
                    const totalCost = instanceUsage.reduce((s, x) => s + x.costUsd, 0)
                    const pct = totalCost > 0 ? (inst.costUsd / totalCost * 100) : 0
                    return (
                      <tr key={i} className="hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Wifi className="w-4 h-4 text-cyan-400" />
                            <span className="font-medium">{inst.instanceName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{inst.messagesCount.toLocaleString('pt-BR')}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatTokens(inst.totalTokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-green-400">{formatCostUsd(inst.costUsd)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-300 font-semibold">{formatCostBrl(inst.costBrl)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-secondary rounded-full h-2">
                              <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* BY SESSION */}
          {activeTab === 'sessions' && (
            <div className="space-y-3">
              <div className="bg-card border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Contato</th>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Agente</th>
                      <th className="px-4 py-3 text-left text-muted-foreground font-medium">Status</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Msgs</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Tokens</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Entrada</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Saída</th>
                      <th className="px-4 py-3 text-right text-yellow-400 font-medium">Custo BRL</th>
                      <th className="px-4 py-3 text-right text-muted-foreground font-medium">Início</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sessions.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Nenhuma sessão no período</td></tr>
                    ) : sessions.map(s => (
                      <tr key={s.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{s.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', ' (grupo)')}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Bot className="w-3 h-3 text-purple-400" />
                            <span className="text-xs">{s.agentName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            s.status === 'OPENED' ? 'bg-green-500/20 text-green-400' :
                            s.status === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>{s.status}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.messageCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatTokens(s.tokensUsed || 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-400 text-xs">{formatTokens(s.promptTokens || 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-orange-400 text-xs">{formatTokens(s.completionTokens || 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-yellow-300 font-semibold">{formatCostBrl(s.costBrl || 0)}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {new Date(s.startedAt).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {sessionTotal > 20 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{sessionTotal} sessões</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={sessionPage === 1} onClick={() => setSessionPage(p => p - 1)}>Anterior</Button>
                    <span className="text-sm px-2 py-1">Página {sessionPage}</span>
                    <Button variant="outline" size="sm" disabled={sessionPage * 20 >= sessionTotal} onClick={() => setSessionPage(p => p + 1)}>Próxima</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
