import { useState, useEffect, useCallback } from 'react'
import {
  Activity, RefreshCw, Clock, DollarSign, Zap, AlertTriangle,
  CheckCircle2, XCircle, HelpCircle, TrendingUp, BarChart3, Heart
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  getAIProviderMetrics, getAIProvidersHealth, cleanAIProviderMetrics,
  type AIProviderMetricSummary, type AIProviderHealth
} from '@/services/ai.service'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2; bg: string }> = {
  HEALTHY: { label: 'Saudável', color: 'text-green-500', icon: CheckCircle2, bg: 'bg-green-500/10' },
  DEGRADED: { label: 'Degradado', color: 'text-yellow-500', icon: AlertTriangle, bg: 'bg-yellow-500/10' },
  DOWN: { label: 'Fora do ar', color: 'text-red-500', icon: XCircle, bg: 'bg-red-500/10' },
  UNKNOWN: { label: 'Desconhecido', color: 'text-gray-400', icon: HelpCircle, bg: 'bg-gray-500/10' },
}

export default function AIObservability() {
  const [metrics, setMetrics] = useState<AIProviderMetricSummary[]>([])
  const [health, setHealth] = useState<AIProviderHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState(24)
  const toast = useToast()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [m, h] = await Promise.all([
        getAIProviderMetrics(hours),
        getAIProvidersHealth(),
      ])
      setMetrics(m)
      setHealth(h)
    } catch (e: any) {
      toast.error('Erro ao carregar dados de observabilidade')
    }
    setLoading(false)
  }, [hours])

  useEffect(() => { loadData() }, [loadData])

  // Totais
  const totalCalls = metrics.reduce((s, m) => s + m.totalCalls, 0)
  const totalCost = metrics.reduce((s, m) => s + m.totalCostUsd, 0)
  const avgLatency = metrics.length > 0 ? metrics.reduce((s, m) => s + m.avgLatencyMs * m.totalCalls, 0) / Math.max(totalCalls, 1) : 0
  const avgSuccess = metrics.length > 0 ? metrics.reduce((s, m) => s + m.successRate * m.totalCalls, 0) / Math.max(totalCalls, 1) : 0
  const healthyCount = health.filter(h => h.healthStatus === 'HEALTHY').length
  const degradedCount = health.filter(h => h.healthStatus === 'DEGRADED').length
  const downCount = health.filter(h => h.healthStatus === 'DOWN').length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-500" />
            Observabilidade de IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas de performance, saúde e custos dos provedores de IA
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={1}>Última hora</option>
            <option value={6}>Últimas 6h</option>
            <option value={24}>Últimas 24h</option>
            <option value={72}>Últimas 72h</option>
            <option value={168}>Última semana</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={Zap} label="Total de Chamadas" value={totalCalls.toLocaleString()} color="text-blue-500" />
        <SummaryCard icon={Clock} label="Latência Média" value={`${avgLatency.toFixed(0)}ms`} color="text-purple-500" />
        <SummaryCard icon={DollarSign} label="Custo Total" value={`$${totalCost.toFixed(4)}`} color="text-green-500" />
        <SummaryCard icon={TrendingUp} label="Taxa de Sucesso" value={`${(avgSuccess * 100).toFixed(1)}%`} color="text-amber-500" />
      </div>

      {/* Health Status */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Heart className="w-5 h-5 text-red-400" />
          Status de Saúde dos Provedores
          <span className="text-xs font-normal text-muted-foreground ml-2">
            {healthyCount} saudáveis · {degradedCount} degradados · {downCount} fora do ar
          </span>
        </h2>
        {health.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum provedor ativo encontrado</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.map(h => {
              const cfg = STATUS_CONFIG[h.healthStatus] || STATUS_CONFIG.UNKNOWN
              const StatusIcon = cfg.icon
              return (
                <div key={h.id} className={`border rounded-lg p-3 ${cfg.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusIcon className={`w-5 h-5 ${cfg.color}`} />
                      <span className="font-medium text-sm">{h.name}</span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Tipo: {h.type}</span>
                    <span>Modelo: {h.model}</span>
                    {h.healthLatencyMs !== null && (
                      <span>Latência: {h.healthLatencyMs}ms</span>
                    )}
                    {h.lastHealthCheckAt && (
                      <span>Último check: {new Date(h.lastHealthCheckAt).toLocaleTimeString('pt-BR')}</span>
                    )}
                    {h.consecutiveErrors > 0 && (
                      <span className="text-red-400 col-span-2">
                        {h.consecutiveErrors} erro(s) consecutivo(s)
                      </span>
                    )}
                    {h.lastHealthError && (
                      <span className="text-red-400 col-span-2 truncate" title={h.lastHealthError}>
                        Erro: {h.lastHealthError.substring(0, 80)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Métricas por provider */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Performance por Provedor
        </h2>
        {metrics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? 'Carregando...' : 'Nenhuma métrica registrada no período selecionado'}
          </p>
        ) : (
          <div className="space-y-4">
            {metrics.map(m => (
              <div key={m.providerId} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{m.providerName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {m.providerType} · Modelos: {m.models.join(', ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{m.totalCalls.toLocaleString()} chamadas</p>
                    <p className="text-xs text-muted-foreground">${m.totalCostUsd.toFixed(4)}</p>
                  </div>
                </div>
                {/* Barras de métricas */}
                <div className="grid grid-cols-3 gap-4">
                  <MetricBar label="Latência" value={m.avgLatencyMs} unit="ms" max={10000} color="bg-purple-500" />
                  <MetricBar label="Taxa de Sucesso" value={m.successRate * 100} unit="%" max={100} color="bg-green-500" inverted />
                  <MetricBar label="Custo" value={m.totalCostUsd} unit="$" max={Math.max(totalCost, 0.01)} color="bg-amber-500" />
                </div>
                {/* Timeline mini */}
                {m.timeline.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Timeline de chamadas ({m.timeline.length} janelas)</p>
                    <div className="flex items-end gap-px h-12">
                      {m.timeline.slice(-48).map((t, i) => {
                        const maxCalls = Math.max(...m.timeline.map(t => t.calls), 1)
                        const h = Math.max((t.calls / maxCalls) * 100, 4)
                        const errColor = t.errorRate > 0.1 ? 'bg-red-400' : t.errorRate > 0 ? 'bg-yellow-400' : 'bg-blue-400'
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-t ${errColor} min-w-[3px]`}
                            style={{ height: `${h}%` }}
                            title={`${new Date(t.windowStart).toLocaleString('pt-BR')}: ${t.calls} chamadas, ${t.avgLatency.toFixed(0)}ms, ${(t.errorRate * 100).toFixed(0)}% erros`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function MetricBar({ label, value, unit, max, color, inverted }: { label: string; value: number; unit: string; max: number; color: string; inverted?: boolean }) {
  const pct = Math.min((value / Math.max(max, 0.001)) * 100, 100)
  const displayPct = inverted ? pct : pct // inverted just means higher is better visually
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{typeof value === 'number' && value < 1 && unit === '$' ? value.toFixed(6) : value.toFixed(unit === '%' ? 1 : 0)}{unit}</span>
      </div>
      <div className="h-2 bg-accent rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${displayPct}%` }} />
      </div>
    </div>
  )
}
