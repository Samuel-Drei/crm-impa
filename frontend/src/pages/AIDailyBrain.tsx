import { useState, useEffect } from 'react'
import { Brain, RefreshCw, Play, Power, Clock, Database, Sparkles, AlertTriangle, CheckCircle2, Loader2, Settings, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import api from '@/services/api'

interface DailyDigest {
  id: string
  date: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'
  startedAt: string | null
  finishedAt: string | null
  contactsProcessed: number
  messagesProcessed: number
  conversationsTouched: number
  cardsTouched: number
  tasksTouched: number
  ticketsTouched: number
  factsCreated: number
  embeddingsGenerated: number
  tokensUsed: number
  summary: string | null
  errorMessage: string | null
  createdAt: string
}

interface DailyBrainStatus {
  enabled: boolean
  timezone: string
  hour: number
  embeddingProviderId: string | null
  embeddingModel: string | null
  embeddingProvider: { id: string; name: string; type: string } | null
  lastRun: DailyDigest | null
  totalContactsInBrain: number
  totalFactsFromDigest: number
  knowledgeBase: {
    id: string
    totalChunks: number
    totalTokens: number
    embeddingModel: string
  } | null
}

interface EmbeddingOption {
  id: string
  name: string
  type: string
  isDefault: boolean
  embeddingKey: string
  providerLabel: string
  models: Array<{ id: string; name: string; dimensions: number; pricePerMTokens: number }>
}

export function AIDailyBrain() {
  const toast = useToast()
  const [status, setStatus] = useState<DailyBrainStatus | null>(null)
  const [digests, setDigests] = useState<DailyDigest[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [selected, setSelected] = useState<DailyDigest | null>(null)

  // Settings modais
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showEmbeddingModal, setShowEmbeddingModal] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [embeddingOptions, setEmbeddingOptions] = useState<EmbeddingOption[]>([])
  const [scheduleHour, setScheduleHour] = useState(2)
  const [scheduleTz, setScheduleTz] = useState('America/Sao_Paulo')
  const [embProviderId, setEmbProviderId] = useState<string>('')
  const [embModel, setEmbModel] = useState<string>('')

  async function loadAll() {
    setLoading(true)
    try {
      const [s, d] = await Promise.all([
        api.get<DailyBrainStatus>('/ai/daily-brain/status'),
        api.get<{ digests: DailyDigest[] }>('/ai/daily-brain/digests'),
      ])
      setStatus(s.data)
      setDigests(d.data.digests)
      setScheduleHour(s.data.hour ?? 2)
      setScheduleTz(s.data.timezone || 'America/Sao_Paulo')
      setEmbProviderId(s.data.embeddingProviderId || '')
      setEmbModel(s.data.embeddingModel || '')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao carregar')
    }
    setLoading(false)
  }

  async function loadEmbeddingOptions() {
    try {
      const res = await api.get<{ providers: EmbeddingOption[] }>('/ai/daily-brain/embedding-options')
      setEmbeddingOptions(res.data.providers)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao carregar providers')
    }
  }

  useEffect(() => { loadAll() }, [])

  async function openScheduleModal() {
    if (!status) return
    setScheduleHour(status.hour ?? 2)
    setScheduleTz(status.timezone || 'America/Sao_Paulo')
    setShowScheduleModal(true)
  }

  async function openEmbeddingModal() {
    if (!status) return
    setEmbProviderId(status.embeddingProviderId || '')
    setEmbModel(status.embeddingModel || '')
    if (embeddingOptions.length === 0) await loadEmbeddingOptions()
    setShowEmbeddingModal(true)
  }

  async function saveSchedule() {
    setSavingSettings(true)
    try {
      await api.patch('/ai/daily-brain/settings', { hour: scheduleHour, timezone: scheduleTz })
      toast.success('Agendamento atualizado')
      setShowScheduleModal(false)
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao salvar')
    }
    setSavingSettings(false)
  }

  async function saveEmbedding() {
    setSavingSettings(true)
    try {
      await api.patch('/ai/daily-brain/settings', {
        embeddingProviderId: embProviderId || null,
        embeddingModel: embModel || null,
      })
      toast.success('Provider/modelo de embedding atualizado. Próximo digest usará a nova configuração.')
      setShowEmbeddingModal(false)
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao salvar')
    }
    setSavingSettings(false)
  }

  async function runDigest(date?: string) {
    setRunning(true)
    try {
      await api.post('/ai/daily-brain/run', date ? { date } : {})
      toast.success('Digest enfileirado. Aguarde alguns minutos e recarregue.')
      setTimeout(loadAll, 2000)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao enfileirar')
    }
    setRunning(false)
  }

  async function toggleEnabled() {
    if (!status) return
    try {
      const res = await api.post<{ dailyBrainEnabled: boolean }>('/ai/daily-brain/toggle', {
        enabled: !status.enabled,
      })
      setStatus({ ...status, enabled: res.data.dailyBrainEnabled })
      toast.success(res.data.dailyBrainEnabled ? 'Cérebro diário ativado' : 'Cérebro diário desativado')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao alterar')
    }
  }

  function statusBadge(s: DailyDigest['status']) {
    const map = {
      DONE:    { label: 'Concluído', cls: 'bg-green-500/15 text-green-400 border-green-500/30',  icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
      RUNNING: { label: 'Rodando',   cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',     icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
      PENDING: { label: 'Pendente',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: <Clock className="w-3.5 h-3.5" /> },
      FAILED:  { label: 'Falhou',    cls: 'bg-red-500/15 text-red-400 border-red-500/30',       icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    }
    const c = map[s]
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${c.cls}`}>
        {c.icon}{c.label}
      </span>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" />
            Cérebro Diário do CRM
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Job noturno que vetoriza tudo que aconteceu ontem (mensagens, deals, notas, tickets)
            e transforma em memória de longo prazo. Os agentes usam isso via RAG (tool <code className="px-1 bg-muted rounded text-foreground">recall_daily_history</code>) e injeção automática no prompt.
          </p>
        </div>
        <Button onClick={loadAll} variant="outline" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <button
            type="button"
            onClick={openScheduleModal}
            className="bg-card border rounded-lg p-4 text-left hover:border-purple-500/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estado & Agenda</span>
              <Settings className="w-4 h-4 text-muted-foreground group-hover:text-purple-400 transition-colors" />
            </div>
            <div className="mt-2 text-xl font-semibold flex items-center gap-2">
              <Power className={`w-4 h-4 ${status.enabled ? 'text-green-400' : 'text-muted-foreground'}`} />
              {status.enabled ? 'Ativo' : 'Desativado'}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {String(status.hour ?? 2).padStart(2, '0')}:00 — {status.timezone}
            </div>
            <div className="mt-2">
              <Button
                size="sm"
                variant={status.enabled ? 'outline' : 'default'}
                onClick={(e) => { e.stopPropagation(); toggleEnabled() }}
              >
                <Power className="w-3.5 h-3.5" />
                {status.enabled ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
          </button>

          <button
            type="button"
            onClick={openEmbeddingModal}
            className="bg-card border rounded-lg p-4 text-left hover:border-blue-500/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Embedding</span>
              <Settings className="w-4 h-4 text-muted-foreground group-hover:text-blue-400 transition-colors" />
            </div>
            <div className="mt-2 text-base font-semibold flex items-center gap-2 truncate">
              <Cpu className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="truncate">
                {status.embeddingProvider?.name || 'Padrão da empresa'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate" title={status.embeddingModel || status.knowledgeBase?.embeddingModel || ''}>
              {status.embeddingModel || status.knowledgeBase?.embeddingModel || 'Modelo padrão por tipo'}
            </div>
          </button>

          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Contatos no cérebro</div>
            <div className="mt-2 text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              {status.totalContactsInBrain.toLocaleString('pt-BR')}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Total de nós únicos</div>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Fatos extraídos</div>
            <div className="mt-2 text-2xl font-semibold">
              {status.totalFactsFromDigest.toLocaleString('pt-BR')}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Pelo digest noturno</div>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Base vetorizada</div>
            <div className="mt-2 text-2xl font-semibold flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-400" />
              {status.knowledgeBase ? status.knowledgeBase.totalChunks.toLocaleString('pt-BR') : 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {status.knowledgeBase ? `${status.knowledgeBase.embeddingModel}` : 'Não inicializada'}
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">Rodar manualmente</h2>
            <p className="text-xs text-muted-foreground">Padrão: ontem na timezone da empresa.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="bg-background border border-input rounded px-3 py-1.5 text-sm text-foreground [color-scheme:dark]"
            />
            <Button onClick={() => runDigest(customDate || undefined)} disabled={running}>
              <Play className="w-4 h-4" />
              {running ? 'Enfileirando...' : 'Rodar agora'}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Histórico de digests</h2>
          <span className="text-xs text-muted-foreground">{digests.length} registros</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Carregando...</div>
        ) : digests.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            Nenhum digest ainda. Rode manualmente acima para gerar o primeiro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Data</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Contatos</th>
                  <th className="text-right px-4 py-2">Mensagens</th>
                  <th className="text-right px-4 py-2">Cards</th>
                  <th className="text-right px-4 py-2">Fatos</th>
                  <th className="text-right px-4 py-2">Chunks</th>
                  <th className="text-right px-4 py-2">Tokens</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {digests.map(d => (
                  <tr key={d.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => setSelected(d)}>
                    <td className="px-4 py-2 font-mono">{d.date}</td>
                    <td className="px-4 py-2">{statusBadge(d.status)}</td>
                    <td className="px-4 py-2 text-right">{d.contactsProcessed}</td>
                    <td className="px-4 py-2 text-right">{d.messagesProcessed}</td>
                    <td className="px-4 py-2 text-right">{d.cardsTouched}</td>
                    <td className="px-4 py-2 text-right">{d.factsCreated}</td>
                    <td className="px-4 py-2 text-right">{d.embeddingsGenerated}</td>
                    <td className="px-4 py-2 text-right">{d.tokensUsed.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); runDigest(d.date) }}
                        disabled={running}
                        title="Reprocessar esta data"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-card border rounded-lg max-w-2xl w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Digest {selected.date}</h3>
              {statusBadge(selected.status)}
            </div>
            {selected.summary && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3 text-sm">
                <div className="text-xs uppercase text-purple-400 font-semibold mb-1">Resumo executivo</div>
                {selected.summary}
              </div>
            )}
            {selected.errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-400">
                <div className="text-xs uppercase font-semibold mb-1">Erro</div>
                {selected.errorMessage}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>Contatos: <strong>{selected.contactsProcessed}</strong></div>
              <div>Mensagens: <strong>{selected.messagesProcessed}</strong></div>
              <div>Conversas: <strong>{selected.conversationsTouched}</strong></div>
              <div>Cards: <strong>{selected.cardsTouched}</strong></div>
              <div>Tickets: <strong>{selected.ticketsTouched}</strong></div>
              <div>Tasks: <strong>{selected.tasksTouched}</strong></div>
              <div>Fatos criados: <strong>{selected.factsCreated}</strong></div>
              <div>Embeddings: <strong>{selected.embeddingsGenerated}</strong></div>
              <div>Tokens: <strong>{selected.tokensUsed.toLocaleString('pt-BR')}</strong></div>
              <div>Início: <strong>{selected.startedAt ? new Date(selected.startedAt).toLocaleString('pt-BR') : '-'}</strong></div>
              <div>Fim: <strong>{selected.finishedAt ? new Date(selected.finishedAt).toLocaleString('pt-BR') : '-'}</strong></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSelected(null)}>Fechar</Button>
              <Button onClick={() => { runDigest(selected.date); setSelected(null) }} disabled={running}>
                <RefreshCw className="w-4 h-4" />
                Reprocessar
              </Button>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowScheduleModal(false)}>
          <div className="bg-card border rounded-lg max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-400" />
                Agendamento do Cérebro Diário
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Define quando o job noturno será executado para esta empresa.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Hora de execução (0–23)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={scheduleHour}
                  onChange={e => setScheduleHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                  className="bg-background border border-input rounded px-3 py-2 text-foreground w-24"
                />
                <span className="text-muted-foreground text-sm">:00 ({String(scheduleHour).padStart(2, '0')}:00)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                A janela é de 1 hora — qualquer minuto dentro de {String(scheduleHour).padStart(2, '0')}:00–{String(scheduleHour).padStart(2, '0')}:59 dispara o job.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Timezone</label>
              <input
                type="text"
                value={scheduleTz}
                onChange={e => setScheduleTz(e.target.value)}
                placeholder="America/Sao_Paulo"
                className="bg-background border border-input rounded px-3 py-2 text-foreground w-full"
              />
              <p className="text-xs text-muted-foreground">
                Use o formato IANA (ex: America/Sao_Paulo, America/Manaus, UTC).
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowScheduleModal(false)}>Cancelar</Button>
              <Button onClick={saveSchedule} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {showEmbeddingModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowEmbeddingModal(false)}>
          <div className="bg-card border rounded-lg max-w-lg w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Cpu className="w-5 h-5 text-blue-400" />
                Provider e Modelo de Embedding
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Define qual provider/modelo é usado para vetorizar o conteúdo do cérebro diário.
                Deixe em branco para usar o provider default da empresa.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Provider</label>
              <select
                value={embProviderId}
                onChange={e => {
                  setEmbProviderId(e.target.value)
                  setEmbModel('')
                }}
                className="bg-background border border-input rounded px-3 py-2 text-foreground w-full"
              >
                <option value="">— Usar default da empresa —</option>
                {embeddingOptions.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.providerLabel}){p.isDefault ? ' • default' : ''}
                  </option>
                ))}
              </select>
            </div>

            {embProviderId && (() => {
              const sel = embeddingOptions.find(p => p.id === embProviderId)
              if (!sel) return null
              return (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Modelo</label>
                  <select
                    value={embModel}
                    onChange={e => setEmbModel(e.target.value)}
                    className="bg-background border border-input rounded px-3 py-2 text-foreground w-full"
                  >
                    <option value="">— Padrão por tipo —</option>
                    {sel.models.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} • {m.dimensions}d • ${m.pricePerMTokens}/1M tokens
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-amber-400 flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Mudar a dimensão do embedding pode invalidar buscas em chunks antigos.
                    Reprocessar digests passados é recomendado se a dimensão mudar.
                  </p>
                </div>
              )
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEmbeddingModal(false)}>Cancelar</Button>
              <Button onClick={saveEmbedding} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
