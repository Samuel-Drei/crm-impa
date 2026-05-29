import { useState, useEffect } from 'react'
import { Shield, AlertTriangle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { listFleetCriticReviews, type FleetCriticReview } from '@/services/fleet.service'

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-600 border-green-500/30',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  critical: 'bg-red-500/10 text-red-600 border-red-500/30',
}

const REC_COLORS: Record<string, string> = {
  proceed: 'bg-green-500/10 text-green-600',
  proceed_with_caution: 'bg-yellow-500/10 text-yellow-600',
  request_approval: 'bg-blue-500/10 text-blue-500',
  block: 'bg-red-500/10 text-red-600',
}

export function FleetCriticReviews() {
  const toast = useToast()
  const [items, setItems] = useState<FleetCriticReview[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ riskLevel: '', recommendation: '' })
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => { load() }, [filters, pagination.page])

  async function load() {
    setLoading(true)
    try {
      const params: any = { page: pagination.page, limit: 50 }
      if (filters.riskLevel) params.riskLevel = filters.riskLevel
      if (filters.recommendation) params.recommendation = filters.recommendation
      const r = await listFleetCriticReviews(params)
      setItems(r.items)
      setPagination(p => ({ ...p, total: r.total, totalPages: r.totalPages }))
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao carregar') }
    setLoading(false)
  }

  function toggle(id: string) { setExpanded(prev => ({ ...prev, [id]: !prev[id] })) }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-purple-500" /> Revisões Adversariais (Raven)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Análise crítica automática de operações de risco antes da execução.</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Recarregar</Button>
      </div>

      <div className="flex items-end gap-3 flex-wrap p-4 border rounded-xl bg-card">
        <div>
          <label className="text-xs font-medium block mb-1">Nível de risco</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.riskLevel} onChange={e => { setFilters({ ...filters, riskLevel: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todos</option>
            <option value="low">Baixo</option>
            <option value="medium">Médio</option>
            <option value="high">Alto</option>
            <option value="critical">Crítico</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Recomendação</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.recommendation} onChange={e => { setFilters({ ...filters, recommendation: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todas</option>
            <option value="proceed">Prosseguir</option>
            <option value="proceed_with_caution">Prosseguir com cautela</option>
            <option value="request_approval">Pedir aprovação</option>
            <option value="block">Bloquear</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground ml-auto">{pagination.total} revisões</div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-xl">Nenhuma revisão encontrada.</div>
      ) : (
        <div className="space-y-2">
          {items.map(rev => {
            const op = rev.operation
            const isOpen = expanded[rev.id]
            return (
              <div key={rev.id} className={`border rounded-xl overflow-hidden ${rev.blocked ? 'border-red-500/40' : ''}`}>
                <button className="w-full p-4 flex items-start gap-3 text-left hover:bg-accent/30" onClick={() => toggle(rev.id)}>
                  <div className="shrink-0 mt-0.5">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${RISK_COLORS[rev.riskLevel]}`}>{rev.riskLevel.toUpperCase()}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${REC_COLORS[rev.recommendation]}`}>{rev.recommendation}</span>
                      {rev.blocked && <span className="text-xs px-2 py-0.5 rounded bg-red-500 text-white font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> BLOQUEADA</span>}
                      {op?.member && <span className="text-xs text-muted-foreground">{op.member.name} ({op.member.displayRole || 'Colaborador'})</span>}
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(rev.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="text-sm font-medium line-clamp-1">{op?.instruction || '(sem instrução)'}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{rev.rationale}</div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t p-4 space-y-4 bg-muted/20">
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Racional do crítico</h4>
                      <p className="text-sm">{rev.rationale}</p>
                    </div>
                    {rev.risks && rev.risks.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Riscos identificados</h4>
                        <div className="space-y-2">
                          {rev.risks.map((r, i) => (
                            <div key={i} className="border rounded-lg p-3 bg-background">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs px-2 py-0.5 rounded ${RISK_COLORS[r.severity] || 'bg-muted'}`}>{r.severity}</span>
                                <span className="text-sm font-medium">{r.title}</span>
                              </div>
                              <div className="text-xs text-muted-foreground"><strong>Mitigação:</strong> {r.mitigation}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {rev.perspectives && rev.perspectives.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Perspectivas</h4>
                        <div className="space-y-2">
                          {rev.perspectives.map((p, i) => (
                            <div key={i} className="border-l-2 border-purple-500 pl-3">
                              <div className="text-xs font-medium uppercase text-purple-500">{p.role}</div>
                              <div className="text-sm">{p.concern}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pt-2 border-t">
                      <span>Provider: {rev.provider || 'n/a'}</span>
                      <span>·</span>
                      <span>Modelo: {rev.model || 'n/a'}</span>
                      <span>·</span>
                      <span>Operação: {rev.operationId.substring(0, 8)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Anterior</Button>
          <span className="text-sm">Página {pagination.page} de {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Próxima</Button>
        </div>
      )}
    </div>
  )
}
