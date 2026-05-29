import { useState, useEffect } from 'react'
import { Bot, Plus, Trash2, Edit2, X, Power, PowerOff, Kanban } from 'lucide-react'
import api from '@/services/api'
import { getPipelines } from '@/services/pipeline.service'
import { useToast } from '@/components/ui/Toast'
import type { ConversationAutomation, Pipeline } from '@/types'

const EVENT_LABELS: Record<string, string> = {
  conversation_created: 'Conversa Criada',
  conversation_updated: 'Conversa Atualizada',
  message_created: 'Mensagem Criada',
  conversation_opened: 'Conversa Aberta',
}

const ACTION_LABELS: Record<string, string> = {
  assign_agent: 'Atribuir Agente',
  assign_team: 'Atribuir Time',
  add_label: 'Adicionar Etiqueta',
  remove_label: 'Remover Etiqueta',
  change_status: 'Alterar Status',
  change_priority: 'Alterar Prioridade',
  send_message: 'Enviar Mensagem',
  mute_conversation: 'Silenciar Conversa',
  create_pipeline_card: 'Criar Card no Pipeline',
}

const CONDITION_ATTRS: Record<string, string> = {
  status: 'Status',
  assignee_id: 'Agente Atribuído',
  team_id: 'Time',
  priority: 'Prioridade',
  contact_name: 'Nome do Contato',
  phone_number: 'Número de Telefone',
  conversation_type: 'Tipo de Conversa',
  message_type: 'Tipo de Mensagem',
  message_content: 'Conteúdo da Mensagem',
  has_no_card_in_pipeline: 'Não possui card no Pipeline',
}

const OPERATORS: Record<string, string> = {
  equal_to: 'Igual a',
  not_equal_to: 'Diferente de',
  contains: 'Contém',
  does_not_contain: 'Não contém',
  is_present: 'Está presente',
  is_not_present: 'Não está presente',
}

// Opções de dropdown por tipo de condição
const CONDITION_OPTIONS: Record<string, { label: string; value: string }[]> = {
  status: [
    { label: 'Aberta', value: 'OPEN' },
    { label: 'Pendente', value: 'PENDING' },
    { label: 'Adiada', value: 'SNOOZED' },
    { label: 'Resolvida', value: 'RESOLVED' },
  ],
  priority: [
    { label: 'Nenhuma', value: 'nil' },
    { label: 'Baixa', value: 'LOW' },
    { label: 'Média', value: 'MEDIUM' },
    { label: 'Alta', value: 'HIGH' },
    { label: 'Urgente', value: 'URGENT' },
  ],
  conversation_type: [
    { label: 'Direta', value: 'direct' },
    { label: 'Grupo', value: 'group' },
    { label: 'Newsletter', value: 'newsletter' },
  ],
  message_type: [
    { label: 'Texto', value: 'text' },
    { label: 'Imagem', value: 'image' },
    { label: 'Vídeo', value: 'video' },
    { label: 'Áudio', value: 'audio' },
    { label: 'Documento', value: 'document' },
    { label: 'Sticker', value: 'sticker' },
    { label: 'Localização', value: 'location' },
    { label: 'Contato', value: 'contacts' },
  ],
}

// Condições que não precisam de valor (operador implícito)
const NO_VALUE_ATTRS = ['has_no_card_in_pipeline']
// Condições que usam pipeline selector
const PIPELINE_SELECTOR_ATTRS = ['has_no_card_in_pipeline']
// Condições que são texto livre
const TEXT_INPUT_ATTRS = ['contact_name', 'phone_number', 'message_content', 'assignee_id', 'team_id']

export function ConversationAutomations() {
  const toast = useToast()
  const [automations, setAutomations] = useState<ConversationAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ConversationAutomation | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    eventName: 'conversation_created',
    conditions: [] as any[],
    actions: [] as any[],
    isActive: true,
  })

  useEffect(() => { loadAutomations() }, [])

  async function loadAutomations() {
    setLoading(true)
    try {
      const res = await api.get('/conversation-automations')
      setAutomations(res.data.automations)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editing) {
        await api.put(`/conversation-automations/${editing.id}`, form)
      } else {
        await api.post('/conversation-automations', form)
      }
      setShowForm(false)
      setEditing(null)
      resetForm()
      loadAutomations()
    } catch (e) { console.error(e) }
  }

  async function toggleActive(auto: ConversationAutomation) {
    try {
      await api.put(`/conversation-automations/${auto.id}`, { isActive: !auto.isActive })
      loadAutomations()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir automação', message: 'Excluir esta automação?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/conversation-automations/${id}`)
      loadAutomations()
    } catch (e) { console.error(e) }
  }

  function resetForm() {
    setForm({ name: '', description: '', eventName: 'conversation_created', conditions: [], actions: [], isActive: true })
  }

  function startEdit(a: ConversationAutomation) {
    setEditing(a)
    setForm({
      name: a.name,
      description: a.description || '',
      eventName: a.eventName,
      conditions: a.conditions,
      actions: a.actions,
      isActive: a.isActive,
    })
    setShowForm(true)
  }

  // Condition builder
  const [newCondition, setNewCondition] = useState({ attributeKey: 'status', filterOperator: 'equal_to', values: '' as string, pipelineId: '' })
  function addCondition() {
    if (PIPELINE_SELECTOR_ATTRS.includes(newCondition.attributeKey)) {
      if (!newCondition.pipelineId) return
      setForm({
        ...form,
        conditions: [...form.conditions, {
          attributeKey: newCondition.attributeKey,
          filterOperator: 'equal_to',
          values: [newCondition.pipelineId],
        }],
      })
    } else {
      setForm({
        ...form,
        conditions: [...form.conditions, {
          attributeKey: newCondition.attributeKey,
          filterOperator: newCondition.filterOperator,
          values: newCondition.values ? newCondition.values.split(',').map(v => v.trim()).filter(Boolean) : [],
        }],
      })
    }
    setNewCondition({ attributeKey: 'status', filterOperator: 'equal_to', values: '', pipelineId: '' })
  }

  // Action builder
  const [newAction, setNewAction] = useState({ actionName: 'assign_agent', actionParams: '' })
  // Pipeline card action builder
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineAction, setPipelineAction] = useState({ pipelineId: '', stageId: '', titleTemplate: '{{contact_name}}' })

  useEffect(() => {
    getPipelines().then(setPipelines).catch(() => {})
  }, [])

  const selectedPipelineForAction = pipelines.find(p => p.id === pipelineAction.pipelineId)

  function addAction() {
    if (newAction.actionName === 'create_pipeline_card') {
      if (!pipelineAction.pipelineId || !pipelineAction.stageId) return
      setForm({
        ...form,
        actions: [...form.actions, {
          actionName: 'create_pipeline_card',
          actionParams: [pipelineAction.pipelineId, pipelineAction.stageId, pipelineAction.titleTemplate || '{{contact_name}}'],
        }],
      })
      setPipelineAction({ pipelineId: '', stageId: '', titleTemplate: '{{contact_name}}' })
    } else {
      setForm({
        ...form,
        actions: [...form.actions, {
          actionName: newAction.actionName,
          actionParams: newAction.actionParams ? newAction.actionParams.split(',').map(v => v.trim()) : [],
        }],
      })
    }
    setNewAction({ actionName: 'assign_agent', actionParams: '' })
  }

  function getConditionLabel(c: any) {
    if (c.attributeKey === 'has_no_card_in_pipeline') {
      const pipeline = pipelines.find(p => p.id === c.values?.[0])
      return `Não possui card em: ${pipeline?.name || c.values?.[0]}`
    }
    // Traduzir valores de dropdown
    const opts = CONDITION_OPTIONS[c.attributeKey]
    const valLabels = c.values?.map((v: string) => {
      const opt = opts?.find(o => o.value === v)
      return opt?.label || v
    })
    return `${CONDITION_ATTRS[c.attributeKey] || c.attributeKey} ${OPERATORS[c.filterOperator] || c.filterOperator} ${valLabels?.join(', ') || ''}`
  }

  function getPipelineStageLabel(actionParams: any[]) {
    const [pId, sId, title] = actionParams
    const pipeline = pipelines.find(p => p.id === pId)
    const stage = pipeline?.stages?.find(s => s.id === sId)
    return `${pipeline?.name || pId} → ${stage?.name || sId}${title ? ` (${title})` : ''}`
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Bot className="h-5 w-5 text-primary" /></div>
            Automações de Conversa
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Regras automáticas que são executadas quando eventos ocorrem nas conversas.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditing(null); resetForm() }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Nova Automação
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Automação' : 'Nova Automação'}</h2>
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Evento Gatilho</label>
                <select value={form.eventName} onChange={e => setForm({ ...form, eventName: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>

            {/* Conditions */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Condições</label>
              {form.conditions.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2.5 mb-1.5">
                  <span className="text-foreground/80 text-sm flex-1">{getConditionLabel(c)}</span>
                  <button type="button" onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <div className="flex gap-2 mt-2 flex-wrap">
                <select value={newCondition.attributeKey} onChange={e => setNewCondition({ ...newCondition, attributeKey: e.target.value, values: '', pipelineId: '' })} className="bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  {Object.entries(CONDITION_ATTRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {!PIPELINE_SELECTOR_ATTRS.includes(newCondition.attributeKey) && (
                  <select value={newCondition.filterOperator} onChange={e => setNewCondition({ ...newCondition, filterOperator: e.target.value })} className="bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    {Object.entries(OPERATORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
                {/* Pipeline selector para has_no_card_in_pipeline */}
                {PIPELINE_SELECTOR_ATTRS.includes(newCondition.attributeKey) && (
                  <select
                    value={newCondition.pipelineId}
                    onChange={e => setNewCondition({ ...newCondition, pipelineId: e.target.value })}
                    className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">Selecione o Pipeline...</option>
                    {pipelines.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {/* Dropdown para condições com opções predefinidas */}
                {!PIPELINE_SELECTOR_ATTRS.includes(newCondition.attributeKey) && CONDITION_OPTIONS[newCondition.attributeKey] && (
                  <select
                    value={newCondition.values}
                    onChange={e => setNewCondition({ ...newCondition, values: e.target.value })}
                    className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">Selecione...</option>
                    {CONDITION_OPTIONS[newCondition.attributeKey].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {/* Texto livre para condições sem opções predefinidas */}
                {!PIPELINE_SELECTOR_ATTRS.includes(newCondition.attributeKey) && !CONDITION_OPTIONS[newCondition.attributeKey] && (
                  <input value={newCondition.values} onChange={e => setNewCondition({ ...newCondition, values: e.target.value })} placeholder="Valores (separados por vírgula)" className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30" />
                )}
                <button type="button" onClick={addCondition} className="px-3.5 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors">+</button>
              </div>
            </div>

            {/* Actions */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Ações</label>
              {form.actions.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2.5 mb-1.5">
                  <span className="text-foreground/80 text-sm flex-1">
                    {a.actionName === 'create_pipeline_card'
                      ? <span className="flex items-center gap-1.5"><Kanban className="h-3.5 w-3.5 text-primary" /> {ACTION_LABELS[a.actionName]} — {getPipelineStageLabel(a.actionParams)}</span>
                      : <>{ACTION_LABELS[a.actionName] || a.actionName} {a.actionParams?.length > 0 ? `(${a.actionParams.join(', ')})` : ''}</>
                    }
                  </span>
                  <button type="button" onClick={() => setForm({ ...form, actions: form.actions.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <div className="space-y-2 mt-2">
                <div className="flex gap-2">
                  <select value={newAction.actionName} onChange={e => setNewAction({ ...newAction, actionName: e.target.value })} className="bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {newAction.actionName !== 'create_pipeline_card' && (
                    <input value={newAction.actionParams} onChange={e => setNewAction({ ...newAction, actionParams: e.target.value })} placeholder="Parâmetros" className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  )}
                  {newAction.actionName !== 'create_pipeline_card' && (
                    <button type="button" onClick={addAction} className="px-3.5 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors">+</button>
                  )}
                </div>
                {newAction.actionName === 'create_pipeline_card' && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                    <p className="text-xs font-medium text-primary flex items-center gap-1.5"><Kanban className="h-3.5 w-3.5" /> Configurar Card no Pipeline</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Pipeline</label>
                        <select
                          value={pipelineAction.pipelineId}
                          onChange={e => setPipelineAction({ ...pipelineAction, pipelineId: e.target.value, stageId: '' })}
                          className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                        >
                          <option value="">Selecione...</option>
                          {pipelines.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Etapa</label>
                        <select
                          value={pipelineAction.stageId}
                          onChange={e => setPipelineAction({ ...pipelineAction, stageId: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                          disabled={!pipelineAction.pipelineId}
                        >
                          <option value="">Selecione...</option>
                          {selectedPipelineForAction?.stages?.sort((a, b) => a.position - b.position).map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.isWon ? ' ✓' : ''}{s.isLost ? ' ✗' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Título do Card <span className="text-muted-foreground/60">(use {'{{contact_name}}'} ou {'{{phone}}'} como variáveis)</span>
                      </label>
                      <input
                        value={pipelineAction.titleTemplate}
                        onChange={e => setPipelineAction({ ...pipelineAction, titleTemplate: e.target.value })}
                        placeholder="{{contact_name}}"
                        className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addAction}
                      disabled={!pipelineAction.pipelineId || !pipelineAction.stageId}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Adicionar Ação
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2">
              <button type="submit" disabled={form.actions.length === 0} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98] disabled:opacity-50">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {automations.map(auto => (
          <div key={auto.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-foreground font-medium">{auto.name}</h3>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${auto.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {auto.isActive ? 'Ativa' : 'Inativa'}
                  </span>
                  <span className="text-xs bg-blue-500/10 text-blue-400 px-2.5 py-0.5 rounded-full font-medium">{EVENT_LABELS[auto.eventName] || auto.eventName}</span>
                </div>
                {auto.description && <p className="text-muted-foreground text-sm mt-1">{auto.description}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {(auto.conditions as any[]).map((c, i) => (
                    <span key={i} className="text-xs bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-lg">Se {getConditionLabel(c)}</span>
                  ))}
                  {(auto.actions as any[]).map((a, i) => (
                    <span key={i} className={`text-xs px-2.5 py-1 rounded-lg ${a.actionName === 'create_pipeline_card' ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-500'}`}>
                      → {a.actionName === 'create_pipeline_card'
                        ? <><Kanban className="h-3 w-3 inline mr-1" />{getPipelineStageLabel(a.actionParams)}</>
                        : <>{ACTION_LABELS[a.actionName] || a.actionName}</>
                      }
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => toggleActive(auto)} className={`p-1.5 rounded-lg transition-colors ${auto.isActive ? 'text-primary hover:text-destructive hover:bg-destructive/8' : 'text-muted-foreground hover:text-primary hover:bg-primary/8'}`}>
                  {auto.isActive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                </button>
                <button onClick={() => startEdit(auto)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(auto.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {automations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Bot className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhuma automação criada</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Crie automações para que ações sejam executadas automaticamente nas conversas.</p>
        </div>
      )}
    </div>
  )
}
