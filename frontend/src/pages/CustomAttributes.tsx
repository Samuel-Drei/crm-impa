import { useState, useEffect } from 'react'
import { SlidersHorizontal, Plus, Trash2, Edit2, X } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import type { CustomAttributeDefinition } from '@/types'

export function CustomAttributes() {
  const toast = useToast()
  const [definitions, setDefinitions] = useState<CustomAttributeDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CustomAttributeDefinition | null>(null)
  const [activeTab, setActiveTab] = useState<'CONVERSATION' | 'CONTACT'>('CONVERSATION')
  const [form, setForm] = useState({
    attributeKey: '',
    attributeDisplayName: '',
    attributeDisplayType: 'TEXT' as string,
    attributeModel: 'CONVERSATION' as string,
    attributeValues: '' as string,
    description: '',
  })

  useEffect(() => { loadDefinitions() }, [])

  async function loadDefinitions() {
    setLoading(true)
    try {
      const res = await api.get('/custom-attributes')
      setDefinitions(res.data.definitions)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      ...form,
      attributeModel: activeTab,
      attributeValues: form.attributeDisplayType === 'LIST' && form.attributeValues
        ? form.attributeValues.split(',').map(v => v.trim()).filter(Boolean)
        : undefined,
    }
    try {
      if (editing) {
        await api.put(`/custom-attributes/${editing.id}`, payload)
      } else {
        await api.post('/custom-attributes', payload)
      }
      setShowForm(false)
      setEditing(null)
      resetForm()
      loadDefinitions()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir atributo', message: 'Excluir este atributo personalizado?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/custom-attributes/${id}`)
      loadDefinitions()
    } catch (e) { console.error(e) }
  }

  function resetForm() {
    setForm({ attributeKey: '', attributeDisplayName: '', attributeDisplayType: 'TEXT', attributeModel: 'CONVERSATION', attributeValues: '', description: '' })
  }

  function startEdit(d: CustomAttributeDefinition) {
    setEditing(d)
    setForm({
      attributeKey: d.attributeKey,
      attributeDisplayName: d.attributeDisplayName,
      attributeDisplayType: d.attributeDisplayType,
      attributeModel: d.attributeModel,
      attributeValues: (d.attributeValues || []).join(', '),
      description: d.description || '',
    })
    setActiveTab(d.attributeModel)
    setShowForm(true)
  }

  const filtered = definitions.filter(d => d.attributeModel === activeTab)
  const typeLabels: Record<string, string> = { TEXT: 'Texto', NUMBER: 'Número', LINK: 'Link', DATE: 'Data', LIST: 'Lista', CHECKBOX: 'Checkbox' }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><SlidersHorizontal className="h-5 w-5 text-primary" /></div>
            Atributos Personalizados
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Defina campos extras para conversas e contatos.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditing(null); resetForm() }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Novo Atributo
        </button>
      </div>

      <div className="flex gap-1.5">
        {(['CONVERSATION', 'CONTACT'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40'}`}>
            {tab === 'CONVERSATION' ? 'Conversa' : 'Contato'}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Atributo' : 'Novo Atributo'}</h2>
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome de exibição</label>
                <input value={form.attributeDisplayName} onChange={e => {
                  const name = e.target.value
                  setForm({ ...form, attributeDisplayName: name, attributeKey: editing ? form.attributeKey : name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })
                }} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Chave (auto)</label>
                <input value={form.attributeKey} readOnly className="w-full bg-muted border border-border rounded-lg px-3.5 py-2.5 text-muted-foreground text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Tipo</label>
                <select value={form.attributeDisplayType} onChange={e => setForm({ ...form, attributeDisplayType: e.target.value as any })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
            </div>
            {form.attributeDisplayType === 'LIST' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Valores (separados por vírgula)</label>
                <input value={form.attributeValues} onChange={e => setForm({ ...form, attributeValues: e.target.value })} placeholder="Opção 1, Opção 2, Opção 3" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
            )}
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(d => (
          <div key={d.id} className="group bg-card border border-border/50 rounded-xl px-5 py-3.5 flex items-center justify-between hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-foreground font-medium text-sm">{d.attributeDisplayName}</span>
                <span className="text-muted-foreground text-xs ml-2.5 font-mono">{d.attributeKey}</span>
              </div>
              <span className="text-xs bg-muted/60 text-foreground/70 px-2.5 py-0.5 rounded-lg">{typeLabels[d.attributeDisplayType]}</span>
              {d.description && <span className="text-muted-foreground text-sm">{d.description}</span>}
            </div>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(d)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(d.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><SlidersHorizontal className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhum atributo personalizado</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Defina campos extras para {activeTab === 'CONVERSATION' ? 'conversas' : 'contatos'}.</p>
        </div>
      )}
    </div>
  )
}
