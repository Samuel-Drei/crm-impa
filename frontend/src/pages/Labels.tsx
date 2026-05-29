import { useState, useEffect } from 'react'
import { Tag, Plus, Trash2, Edit2, X } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import type { Label } from '@/types'

export function Labels() {
  const toast = useToast()
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingLabel, setEditingLabel] = useState<Label | null>(null)
  const [form, setForm] = useState({ title: '', description: '', color: '#1f93ff', showOnSidebar: true })

  useEffect(() => { loadLabels() }, [])

  async function loadLabels() {
    setLoading(true)
    try {
      const res = await api.get('/labels')
      setLabels(res.data.labels)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingLabel) {
        await api.put(`/labels/${editingLabel.id}`, form)
      } else {
        await api.post('/labels', form)
      }
      setShowForm(false)
      setEditingLabel(null)
      setForm({ title: '', description: '', color: '#1f93ff', showOnSidebar: true })
      loadLabels()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir etiqueta', message: 'Tem certeza que deseja excluir esta etiqueta?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/labels/${id}`)
      loadLabels()
    } catch (e) { console.error(e) }
  }

  function startEdit(label: Label) {
    setEditingLabel(label)
    setForm({ title: label.title, description: label.description || '', color: label.color, showOnSidebar: label.showOnSidebar })
    setShowForm(true)
  }

  const PRESET_COLORS = ['#1f93ff', '#00a884', '#e74c3c', '#f39c12', '#9b59b6', '#e91e63', '#00bcd4', '#4caf50', '#ff5722', '#607d8b']

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Tag className="h-5 w-5 text-primary" /></div>
            Etiquetas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Crie etiquetas para organizar e categorizar conversas.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingLabel(null); setForm({ title: '', description: '', color: '#1f93ff', showOnSidebar: true }) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Nova Etiqueta
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingLabel ? 'Editar Etiqueta' : 'Nova Etiqueta'}</h2>
            <button onClick={() => { setShowForm(false); setEditingLabel(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Título</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="Ex: VIP, Urgente, Lead..." className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição opcional..." className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Cor</label>
              <div className="flex items-center gap-2.5">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={`w-8 h-8 rounded-full transition-all ${form.color === c ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }} />
                ))}
                <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="w-8 h-8 rounded-lg cursor-pointer border-0" />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <input type="checkbox" checked={form.showOnSidebar} onChange={e => setForm({ ...form, showOnSidebar: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
              <label className="text-sm text-foreground">Mostrar na barra lateral</label>
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingLabel ? 'Salvar alterações' : 'Criar etiqueta'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {labels.map(label => (
          <div key={label.id} className="group bg-card border border-border/50 rounded-xl p-4 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-4 h-4 rounded-full shrink-0 ring-2 ring-background shadow-sm" style={{ backgroundColor: label.color }} />
                <div className="min-w-0">
                  <span className="text-foreground font-medium text-sm block truncate">{label.title}</span>
                  {label.description && <p className="text-muted-foreground text-xs mt-0.5 truncate">{label.description}</p>}
                  <span className="text-muted-foreground/70 text-xs">{label._count?.conversationLabels || 0} conversas</span>
                </div>
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(label)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                <button onClick={() => handleDelete(label.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {labels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Tag className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhuma etiqueta criada</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Crie sua primeira etiqueta para começar a organizar conversas.</p>
        </div>
      )}
    </div>
  )
}
