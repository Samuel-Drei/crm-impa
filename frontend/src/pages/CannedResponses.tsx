import { useState, useEffect } from 'react'
import { MessageSquare, Plus, Trash2, Edit2, X, Copy, Check } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import type { CannedResponse } from '@/types'

export function CannedResponses() {
  const toast = useToast()
  const [responses, setResponses] = useState<CannedResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingResponse, setEditingResponse] = useState<CannedResponse | null>(null)
  const [form, setForm] = useState({ shortCode: '', content: '' })
  const [search, setSearch] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => { loadResponses() }, [])

  async function loadResponses() {
    setLoading(true)
    try {
      const res = await api.get('/canned-responses')
      setResponses(res.data.responses)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingResponse) {
        await api.put(`/canned-responses/${editingResponse.id}`, form)
      } else {
        await api.post('/canned-responses', form)
      }
      setShowForm(false)
      setEditingResponse(null)
      setForm({ shortCode: '', content: '' })
      loadResponses()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir resposta', message: 'Excluir esta resposta pronta?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/canned-responses/${id}`)
      loadResponses()
    } catch (e) { console.error(e) }
  }

  function startEdit(r: CannedResponse) {
    setEditingResponse(r)
    setForm({ shortCode: r.shortCode, content: r.content })
    setShowForm(true)
  }

  function copyContent(r: CannedResponse) {
    navigator.clipboard.writeText(r.content)
    setCopiedId(r.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = responses.filter(r =>
    r.shortCode.toLowerCase().includes(search.toLowerCase()) ||
    r.content.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><MessageSquare className="h-5 w-5 text-primary" /></div>
            Respostas Prontas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Use <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">/atalho</code> durante o chat para inserir rapidamente.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingResponse(null); setForm({ shortCode: '', content: '' }) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Nova Resposta
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingResponse ? 'Editar Resposta' : 'Nova Resposta'}</h2>
            <button onClick={() => { setShowForm(false); setEditingResponse(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Atalho (shortCode)</label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground font-mono text-lg">/</span>
                <input value={form.shortCode} onChange={e => setForm({ ...form, shortCode: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} required placeholder="saudacao" className="flex-1 bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Conteúdo</label>
              <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} required rows={4} placeholder="Olá! Como posso ajudar?" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingResponse ? 'Salvar' : 'Criar'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="relative">
        <MessageSquare className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar respostas..." className="w-full bg-card border border-border/60 rounded-xl px-4 py-2.5 text-foreground text-sm pl-10 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
      </div>

      <div className="space-y-3">
        {filtered.map(r => (
          <div key={r.id} className="group bg-card border border-border/50 rounded-xl p-4 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <span className="text-primary font-mono text-sm font-medium">/{r.shortCode}</span>
                <p className="text-foreground/80 mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{r.content}</p>
              </div>
              <div className="flex gap-0.5 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => copyContent(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8">
                  {copiedId === r.id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </button>
                <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><MessageSquare className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">{search ? 'Nenhuma resposta encontrada' : 'Nenhuma resposta pronta criada'}</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Crie respostas prontas para agilizar o atendimento no chat.</p>
        </div>
      )}
    </div>
  )
}
