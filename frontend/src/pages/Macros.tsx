import { useState, useEffect } from 'react'
import { Wand2, Plus, Trash2, Edit2, X, Play, Power, PowerOff } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import type { Macro } from '@/types'

export function Macros() {
  const toast = useToast()
  const [macros, setMacros] = useState<Macro[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Macro | null>(null)
  const [form, setForm] = useState({
    name: '',
    visibility: 'PERSONAL' as 'PERSONAL' | 'GLOBAL',
    actions: [] as any[],
  })
  const [newAction, setNewAction] = useState({ actionName: '', actionParams: '' })

  useEffect(() => { loadMacros() }, [])

  async function loadMacros() {
    setLoading(true)
    try {
      const res = await api.get('/macros')
      setMacros(res.data.macros)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editing) {
        await api.put(`/macros/${editing.id}`, form)
      } else {
        await api.post('/macros', form)
      }
      setShowForm(false)
      setEditing(null)
      setForm({ name: '', visibility: 'PERSONAL', actions: [] })
      loadMacros()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir macro', message: 'Excluir esta macro?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/macros/${id}`)
      loadMacros()
    } catch (e) { console.error(e) }
  }

  function startEdit(m: Macro) {
    setEditing(m)
    setForm({ name: m.name, visibility: m.visibility, actions: m.actions })
    setShowForm(true)
  }

  function addAction() {
    if (!newAction.actionName) return
    setForm({
      ...form,
      actions: [...form.actions, {
        actionName: newAction.actionName,
        actionParams: newAction.actionParams ? newAction.actionParams.split(',').map(s => s.trim()) : [],
      }],
    })
    setNewAction({ actionName: '', actionParams: '' })
  }

  function removeAction(idx: number) {
    setForm({ ...form, actions: form.actions.filter((_, i) => i !== idx) })
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
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Wand2 className="h-5 w-5 text-primary" /></div>
            Macros
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Sequências de ações que podem ser executadas em uma conversa com um clique.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', visibility: 'PERSONAL', actions: [] }) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Nova Macro
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Macro' : 'Nova Macro'}</h2>
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Visibilidade</label>
                <select value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value as any })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  <option value="PERSONAL">Pessoal (só eu)</option>
                  <option value="GLOBAL">Global (toda equipe)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Ações ({form.actions.length})</label>
              <div className="space-y-2 mb-3">
                {form.actions.map((action, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2.5">
                    <span className="text-xs text-muted-foreground w-5 font-mono">{idx + 1}.</span>
                    <span className="text-foreground/80 text-sm flex-1">{ACTION_LABELS[action.actionName] || action.actionName}</span>
                    {action.actionParams?.length > 0 && (
                      <span className="text-muted-foreground text-xs">{action.actionParams.join(', ')}</span>
                    )}
                    <button type="button" onClick={() => removeAction(idx)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select value={newAction.actionName} onChange={e => setNewAction({ ...newAction, actionName: e.target.value })} className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="">Selecionar ação...</option>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input value={newAction.actionParams} onChange={e => setNewAction({ ...newAction, actionParams: e.target.value })} placeholder="Parâmetros (opcional)" className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30" />
                <button type="button" onClick={addAction} className="px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 text-sm font-medium transition-colors">Adicionar</button>
              </div>
            </div>

            <div className="pt-2">
              <button type="submit" disabled={form.actions.length === 0} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {macros.map(macro => (
          <div key={macro.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-foreground font-medium">{macro.name}</h3>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${macro.visibility === 'GLOBAL' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {macro.visibility === 'GLOBAL' ? 'Global' : 'Pessoal'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {(macro.actions as any[]).map((action, idx) => (
                    <span key={idx} className="text-xs bg-muted/60 text-foreground/70 px-2.5 py-1 rounded-lg">
                      {idx + 1}. {ACTION_LABELS[action.actionName] || action.actionName}
                    </span>
                  ))}
                </div>
                {macro.createdBy && (
                  <span className="text-muted-foreground text-xs mt-2 block">Criado por {macro.createdBy.name}</span>
                )}
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(macro)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(macro.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {macros.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Wand2 className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhuma macro criada</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Crie macros para automatizar ações em conversas.</p>
        </div>
      )}
    </div>
  )
}
