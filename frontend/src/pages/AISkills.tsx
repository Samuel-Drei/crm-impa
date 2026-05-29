import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Plus, Pencil, Trash2, RefreshCw, Search, X, Wand2, Globe2, Bot, Star, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  listAISkills, createAISkill, updateAISkill, deleteAISkill,
  reindexAISkill, reindexAllAISkills, previewAISkills,
  getAIAgents,
  type AIAgentSkill, type AIAgent, type ActiveSkillPreview,
} from '@/services/ai.service'

type Filter = 'all' | 'global' | string // string = agentId

export function AISkills() {
  const toast = useToast()
  const [skills, setSkills] = useState<AIAgentSkill[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Partial<AIAgentSkill> | null>(null)
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState<string | null>(null)
  const [reindexingAll, setReindexingAll] = useState(false)

  // Preview / playground
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewAgentId, setPreviewAgentId] = useState<string>('')
  const [previewMessage, setPreviewMessage] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ skills: ActiveSkillPreview[]; promptPreview: string } | null>(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [sk, ag] = await Promise.all([
        listAISkills({ includeGlobal: true }),
        getAIAgents(),
      ])
      setSkills(sk)
      setAgents(ag)
      if (!previewAgentId && ag[0]) setPreviewAgentId(ag[0].id)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao carregar skills')
    }
    setLoading(false)
  }

  const filteredSkills = useMemo(() => {
    let list = skills
    if (filter === 'global') list = list.filter(s => !s.agentId)
    else if (filter !== 'all') list = list.filter(s => s.agentId === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)) ||
        s.conditions.some(c => c.toLowerCase().includes(q))
      )
    }
    return list.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
  }, [skills, filter, search])

  function startCreate() {
    setEditing({
      name: '',
      description: '',
      conditions: [],
      instructions: '',
      examples: '',
      tags: [],
      priority: 50,
      isActive: true,
      agentId: null,
      relatedSkillIds: [],
    })
  }

  async function handleSave() {
    if (!editing?.name?.trim() || !editing?.instructions?.trim()) {
      toast.error('Nome e instruções são obrigatórios')
      return
    }
    setSaving(true)
    try {
      const payload: Partial<AIAgentSkill> = {
        name: editing.name,
        description: editing.description || undefined,
        conditions: editing.conditions || [],
        instructions: editing.instructions,
        examples: editing.examples || undefined,
        tags: editing.tags || [],
        priority: editing.priority ?? 50,
        isActive: editing.isActive ?? true,
        agentId: editing.agentId || null,
        relatedSkillIds: editing.relatedSkillIds || [],
      }
      if (editing.id) {
        await updateAISkill(editing.id, payload)
        toast.success('Skill atualizada e re-indexada')
      } else {
        await createAISkill(payload)
        toast.success('Skill criada e indexada')
      }
      setEditing(null)
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao salvar')
    }
    setSaving(false)
  }

  async function handleDelete(s: AIAgentSkill) {
    if (!await toast.confirm({
      title: 'Excluir skill',
      message: `Excluir "${s.name}"? O vetor no Qdrant também será removido.`,
      danger: true,
      confirmText: 'Excluir',
    })) return
    try {
      await deleteAISkill(s.id)
      toast.success('Skill excluída')
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro')
    }
  }

  async function handleReindex(id: string) {
    setReindexing(id)
    try {
      await reindexAISkill(id)
      toast.success('Re-indexada')
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro')
    }
    setReindexing(null)
  }

  async function handleReindexAll() {
    if (!await toast.confirm({
      title: 'Re-indexar todas',
      message: 'Vai gerar embeddings para TODAS as skills da empresa. Pode consumir tokens. Continuar?',
      confirmText: 'Re-indexar tudo',
    })) return
    setReindexingAll(true)
    try {
      const r = await reindexAllAISkills()
      toast.success(`Concluído: ${r.ok} ok, ${r.failed} falharam`)
      loadAll()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro')
    }
    setReindexingAll(false)
  }

  async function runPreview() {
    if (!previewAgentId || !previewMessage.trim()) {
      toast.error('Selecione um agente e digite uma mensagem')
      return
    }
    setPreviewLoading(true)
    setPreviewResult(null)
    try {
      const r = await previewAISkills({ agentId: previewAgentId, message: previewMessage, topK: 3 })
      setPreviewResult(r)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro no preview')
    }
    setPreviewLoading(false)
  }

  function agentName(id: string | null | undefined) {
    if (!id) return 'Global'
    return agents.find(a => a.id === id)?.name || '?'
  }

  if (loading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-500" />
            Skills (Memória Procedural)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Procedimentos vetorizados — selecionados automaticamente pelo agente conforme a mensagem do usuário.
            Skills com priority ≥ 100 são <strong>always-on</strong> (entram no prefixo cacheado).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Wand2 className="w-4 h-4 mr-1" /> Preview
          </Button>
          <Button variant="outline" onClick={handleReindexAll} disabled={reindexingAll}>
            <RefreshCw className={`w-4 h-4 mr-1 ${reindexingAll ? 'animate-spin' : ''}`} /> Re-indexar tudo
          </Button>
          <Button onClick={startCreate}>
            <Plus className="w-4 h-4 mr-1" /> Nova Skill
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-md text-sm border ${filter === 'all' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
        >Todas ({skills.length})</button>
        <button
          onClick={() => setFilter('global')}
          className={`px-3 py-1.5 rounded-md text-sm border flex items-center gap-1 ${filter === 'global' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
        ><Globe2 className="w-3.5 h-3.5" /> Globais ({skills.filter(s => !s.agentId).length})</button>
        {agents.map(a => {
          const count = skills.filter(s => s.agentId === a.id).length
          if (count === 0) return null
          return (
            <button
              key={a.id}
              onClick={() => setFilter(a.id)}
              className={`px-3 py-1.5 rounded-md text-sm border flex items-center gap-1 ${filter === a.id ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
            ><Bot className="w-3.5 h-3.5" /> {a.name} ({count})</button>
          )
        })}
        <div className="ml-auto relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm w-64"
          />
        </div>
      </div>

      {/* Lista */}
      {filteredSkills.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center text-gray-500">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhuma skill ainda. Crie a primeira!</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredSkills.map(s => (
            <div key={s.id} className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-base">{s.name}</h3>
                    <span className="text-xs text-gray-400">{s.slug}</span>
                    {!s.isActive && <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">inativa</span>}
                    {s.priority >= 100 && (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded flex items-center gap-1">
                        <Star className="w-3 h-3" /> always-on
                      </span>
                    )}
                    <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded">prio {s.priority}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded flex items-center gap-1">
                      {s.agentId ? <><Bot className="w-3 h-3" /> {agentName(s.agentId)}</> : <><Globe2 className="w-3 h-3" /> global</>}
                    </span>
                    {s.qdrantPointId ? (
                      <span className="text-xs text-green-600">● indexada</span>
                    ) : (
                      <span className="text-xs text-orange-600">○ sem vetor</span>
                    )}
                    {s.hitCount > 0 && (
                      <span className="text-xs text-gray-500">{s.hitCount} hits</span>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5">{s.description}</p>
                  )}
                  {s.conditions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <ListChecks className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                      {s.conditions.map((c, i) => (
                        <span key={i} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">{c}</span>
                      ))}
                    </div>
                  )}
                  {s.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.tags.map((t, i) => (
                        <span key={i} className="text-xs px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => handleReindex(s.id)} disabled={reindexing === s.id} title="Re-indexar vetor">
                    <RefreshCw className={`w-4 h-4 ${reindexing === s.id ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(s)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Edit */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing.id ? 'Editar Skill' : 'Nova Skill'}</h2>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Nome *</label>
                <input
                  value={editing.name || ''}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  placeholder="ex: Calcular frete por CEP"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Descrição</label>
                <input
                  value={editing.description || ''}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  placeholder="Resumo curto do que esta skill faz"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Quando usar (uma condição por linha)</label>
                <textarea
                  value={(editing.conditions || []).join('\n')}
                  onChange={e => setEditing({ ...editing, conditions: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm"
                  placeholder={'Cliente pergunta sobre frete\nCliente envia CEP\nCliente quer prazo de entrega'}
                />
                <p className="text-xs text-gray-500 mt-1">Estas condições viram parte do embedding — descreva quando esta skill deve ser ativada.</p>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Instruções *</label>
                <textarea
                  value={editing.instructions || ''}
                  onChange={e => setEditing({ ...editing, instructions: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  placeholder="Passo a passo / regras que o agente deve seguir quando esta skill for ativada"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Exemplos (opcional)</label>
                <textarea
                  value={editing.examples || ''}
                  onChange={e => setEditing({ ...editing, examples: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  placeholder="Exemplo 1: Usuário: ... → Resposta: ..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Agente</label>
                  <select
                    value={editing.agentId || ''}
                    onChange={e => setEditing({ ...editing, agentId: e.target.value || null })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  >
                    <option value="">🌐 Global (todos os agentes)</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">
                    Prioridade: <strong>{editing.priority ?? 50}</strong> {(editing.priority ?? 50) >= 100 && '⭐ always-on'}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1000"
                    step="10"
                    value={editing.priority ?? 50}
                    onChange={e => setEditing({ ...editing, priority: Number(e.target.value) })}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">≥100 = always-on no prefixo cacheado.</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Tags (separadas por vírgula)</label>
                <input
                  value={(editing.tags || []).join(', ')}
                  onChange={e => setEditing({ ...editing, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  placeholder="vendas, frete, calculo"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="active"
                  type="checkbox"
                  checked={editing.isActive ?? true}
                  onChange={e => setEditing({ ...editing, isActive: e.target.checked })}
                />
                <label htmlFor="active" className="text-sm">Ativa</label>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando + indexando...' : (editing.id ? 'Salvar' : 'Criar')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-500" />
                Preview de seleção de skills
              </h2>
              <button onClick={() => { setPreviewOpen(false); setPreviewResult(null) }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="text-sm font-medium block mb-1">Agente</label>
                  <select
                    value={previewAgentId}
                    onChange={e => setPreviewAgentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  >
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium block mb-1">Mensagem do usuário</label>
                  <input
                    value={previewMessage}
                    onChange={e => setPreviewMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runPreview()}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    placeholder="Ex: Quanto custa o frete pro CEP 01310-100?"
                  />
                </div>
              </div>
              <Button onClick={runPreview} disabled={previewLoading} className="w-full">
                {previewLoading ? 'Buscando skills...' : 'Executar preview'}
              </Button>

              {previewResult && (
                <div className="space-y-3">
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Skills ativadas ({previewResult.skills.length})</h3>
                    {previewResult.skills.length === 0 ? (
                      <p className="text-sm text-gray-500">Nenhuma skill foi ativada para esta mensagem.</p>
                    ) : (
                      <div className="space-y-2">
                        {previewResult.skills.map(s => (
                          <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded p-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <strong>{s.name}</strong>
                              <span className="text-xs text-gray-400">{s.slug}</span>
                              {s.alwaysOn && <span className="text-xs px-1.5 bg-amber-100 text-amber-800 rounded">always-on</span>}
                              {typeof s.score === 'number' && (
                                <span className="text-xs px-1.5 bg-green-100 text-green-800 rounded">
                                  similaridade {(s.score * 100).toFixed(1)}%
                                </span>
                              )}
                              <span className="text-xs text-gray-500">prio {s.priority}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm mb-2">Bloco que será injetado no prompt</h3>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-80">
                      {previewResult.promptPreview || '(vazio)'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
