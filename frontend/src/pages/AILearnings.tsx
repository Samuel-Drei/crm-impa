import { useState, useEffect } from 'react'
import { Brain, Plus, Archive, Trash2, X, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  listAILearnings, createAILearning, updateAILearning, deleteAILearning,
  getAIAgents, type AIAgentLearning, type AIAgent,
} from '@/services/ai.service'

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'Geral' },
  { value: 'tone', label: 'Tom' },
  { value: 'process', label: 'Processo' },
  { value: 'rule', label: 'Regra' },
  { value: 'avoid', label: 'Evitar' },
  { value: 'preference', label: 'Preferência' },
]

export function AILearnings() {
  const toast = useToast()
  const [items, setItems] = useState<AIAgentLearning[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ agentId: '', category: '', active: 'true' })
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 })
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<AIAgentLearning | null>(null)
  const [form, setForm] = useState({ agentId: '', trigger: '', lesson: '', category: 'general', confidence: 0.7 })

  useEffect(() => { getAIAgents().then(setAgents).catch(() => {}) }, [])
  useEffect(() => { load() }, [filters, pagination.page])

  async function load() {
    setLoading(true)
    try {
      const params: any = { page: pagination.page, limit: 50 }
      if (filters.agentId) params.agentId = filters.agentId
      if (filters.category) params.category = filters.category
      if (filters.active) params.active = filters.active
      const r = await listAILearnings(params)
      setItems(r.items)
      setPagination(p => ({ ...p, total: r.total, totalPages: r.totalPages }))
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao carregar') }
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm({ agentId: agents[0]?.id || '', trigger: '', lesson: '', category: 'general', confidence: 0.7 })
    setShowCreate(true)
  }

  function openEdit(item: AIAgentLearning) {
    setEditing(item)
    setForm({ agentId: item.agentId, trigger: item.trigger, lesson: item.lesson, category: item.category, confidence: item.confidence })
    setShowCreate(true)
  }

  async function handleSave() {
    if (!form.agentId || !form.trigger.trim() || !form.lesson.trim()) {
      toast.error('Agente, trigger e lição são obrigatórios')
      return
    }
    try {
      if (editing) {
        await updateAILearning(editing.id, { trigger: form.trigger, lesson: form.lesson, category: form.category, confidence: form.confidence })
        toast.success('Lição atualizada')
      } else {
        await createAILearning(form)
        toast.success('Lição criada')
      }
      setShowCreate(false)
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleArchive(item: AIAgentLearning) {
    try {
      await updateAILearning(item.id, { active: !item.active })
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleDelete(item: AIAgentLearning) {
    if (!await toast.confirm({ title: 'Excluir lição', message: `Excluir permanentemente esta lição?`, danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAILearning(item.id)
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-500" /> Aprendizado de Agentes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Lições registradas pelos agentes — injetadas automaticamente no system prompt.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Recarregar</Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova lição</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-end gap-3 flex-wrap p-4 border rounded-xl bg-card">
        <div>
          <label className="text-xs font-medium block mb-1">Agente</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background min-w-[200px]" value={filters.agentId} onChange={e => { setFilters({ ...filters, agentId: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todos</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Categoria</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.category} onChange={e => { setFilters({ ...filters, category: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todas</option>
            {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Status</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.active} onChange={e => { setFilters({ ...filters, active: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todas</option>
            <option value="true">Ativas</option>
            <option value="false">Arquivadas</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground ml-auto">{pagination.total} lições</div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-xl">Nenhuma lição encontrada.</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className={`border rounded-xl p-4 ${!item.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">{item.category}</span>
                    <span className="text-xs text-muted-foreground">{item.agent?.name || item.agentId}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">conf {(item.confidence * 100).toFixed(0)}%</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">aplicada {item.appliedCount}×</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.sourceType}</span>
                    {!item.active && <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">arquivada</span>}
                  </div>
                  <div className="text-sm">
                    <div className="font-medium text-muted-foreground mb-1">Quando: <span className="text-foreground font-normal">{item.trigger}</span></div>
                    <div className="font-medium text-muted-foreground">Faça: <span className="text-foreground font-normal">{item.lesson}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleArchive(item)} title={item.active ? 'Arquivar' : 'Reativar'}>
                    {item.active ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} className="text-red-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Anterior</Button>
          <span className="text-sm">Página {pagination.page} de {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Próxima</Button>
        </div>
      )}

      {/* Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-background border rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing ? 'Editar lição' : 'Nova lição'}</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <div className="text-sm font-medium mb-1">Agente</div>
                <select disabled={!!editing} className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })}>
                  <option value="">Selecione...</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="block">
                <div className="text-sm font-medium mb-1">Trigger (quando)</div>
                <Input value={form.trigger} onChange={e => setForm({ ...form, trigger: e.target.value })} placeholder="ex: cliente pergunta sobre preços" maxLength={500} />
              </label>
              <label className="block">
                <div className="text-sm font-medium mb-1">Lição (faça)</div>
                <Textarea rows={3} value={form.lesson} onChange={e => setForm({ ...form, lesson: e.target.value })} placeholder="ex: sempre confirme o produto antes de informar valor" maxLength={1000} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm font-medium mb-1">Categoria</div>
                  <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <div className="text-sm font-medium mb-1">Confiança ({(form.confidence * 100).toFixed(0)}%)</div>
                  <input type="range" min={0} max={1} step={0.05} value={form.confidence} onChange={e => setForm({ ...form, confidence: Number(e.target.value) })} className="w-full" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button onClick={handleSave}>{editing ? 'Salvar' : 'Criar'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
