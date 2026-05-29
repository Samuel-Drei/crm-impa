import { useState, useEffect, useMemo } from 'react'
import { FolderKanban, Plus, Trash2, Edit2, X, Eye, Users, Flag, Building2, Search } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { projectService } from '@/services/commercial'
import api from '@/services/api'
import { ProjectDetail } from './ProjectDetail'
import type { Project, Contact } from '@/types'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: 'Não Iniciado', color: 'bg-gray-500/10 text-gray-500' },
  IN_PROGRESS: { label: 'Em Progresso', color: 'bg-blue-500/10 text-blue-500' },
  ON_HOLD: { label: 'Pausado', color: 'bg-yellow-500/10 text-yellow-500' },
  COMPLETED: { label: 'Concluído', color: 'bg-green-500/10 text-green-500' },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-500/10 text-red-500' },
}

const BILLING_LABELS: Record<string, string> = { FIXED: 'Preço Fixo', HOURLY: 'Por Hora', FREE: 'Gratuito' }

export function Projects() {
  const toast = useToast()
  const { can } = usePermissions()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [showContactDropdown, setShowContactDropdown] = useState(false)

  const emptyForm = { name: '', description: '', status: 'NOT_STARTED', startDate: '', deadline: '', billingType: 'FIXED', fixedCost: '', hourlyRate: '', progressMode: 'auto', contactId: '' }
  const [form, setForm] = useState(emptyForm)

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts.slice(0, 20)
    const q = contactSearch.toLowerCase()
    return contacts.filter(c => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || c.phoneNumber.includes(q)).slice(0, 20)
  }, [contacts, contactSearch])

  useEffect(() => { load() }, [statusFilter])
  useEffect(() => { loadContacts() }, [])

  async function loadContacts() {
    try {
      const res = await api.get('/contacts', { params: { limit: 500 } })
      setContacts(res.data.contacts || res.data)
    } catch (e) { console.error(e) }
  }

  async function load() {
    setLoading(true)
    try {
      const res = await projectService.list({ status: statusFilter || undefined })
      setProjects(res.projects)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = {
        ...form,
        contactId: form.contactId || null,
        fixedCost: form.fixedCost ? Number(form.fixedCost) : undefined,
        hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
        startDate: form.startDate || undefined,
        deadline: form.deadline || undefined,
      }
      if (editing) { await projectService.update(editing.id, data) }
      else { await projectService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir projeto', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await projectService.delete(id); if (detailId === id) setDetailId(null); load() } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  function startEdit(p: Project) {
    setEditing(p)
    setForm({
      name: p.name, description: p.description || '', status: p.status,
      startDate: p.startDate ? p.startDate.split('T')[0] : '', deadline: p.deadline ? p.deadline.split('T')[0] : '',
      billingType: p.billingType || 'FIXED', fixedCost: p.fixedCost?.toString() || '', hourlyRate: p.hourlyRate?.toString() || '',
      progressMode: p.progressMode || 'auto', contactId: p.contactId || '',
    })
    setContactSearch(p.contact?.name || '')
    setShowForm(true)
    setDetailId(null)
  }

  function openNew() { closeForm(); setContactSearch(''); setShowForm(true) }

  if (loading && projects.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  // ── DETAIL VIEW ──
  if (detailId) {
    return (
      <ProjectDetail
        projectId={detailId}
        onBack={() => { setDetailId(null); load() }}
        onEdit={startEdit}
        onDeleted={() => { setDetailId(null); load() }}
      />
    )
  }

  // ── LIST VIEW ──
  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><FolderKanban className="h-5 w-5 text-primary" /></div>
            Projetos
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie projetos e acompanhe progresso.</p>
        </div>
        {can('projects:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> Novo Projeto
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-lg text-sm ${!statusFilter ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>Todos</button>
        {Object.entries(STATUS_MAP).map(([k, v]) => (
          <button key={k} onClick={() => setStatusFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${statusFilter === k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>{v.label}</button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Projeto' : 'Novo Projeto'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  <Building2 className="h-3.5 w-3.5 inline mr-1" />Cliente
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    value={contactSearch}
                    onChange={e => { setContactSearch(e.target.value); setShowContactDropdown(true); if (!e.target.value) setForm({ ...form, contactId: '' }) }}
                    onFocus={() => setShowContactDropdown(true)}
                    onBlur={() => setTimeout(() => setShowContactDropdown(false), 200)}
                    placeholder="Buscar cliente..."
                    className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40"
                  />
                  {form.contactId && (
                    <button type="button" onClick={() => { setForm({ ...form, contactId: '' }); setContactSearch('') }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {showContactDropdown && (
                  <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredContacts.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum contato encontrado</div>
                    ) : filteredContacts.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setForm({ ...form, contactId: c.id }); setContactSearch(c.name); setShowContactDropdown(false) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between ${form.contactId === c.id ? 'bg-primary/5 font-medium' : ''}`}
                      >
                        <div>
                          <span className="text-foreground">{c.name}</span>
                          {c.email && <span className="text-muted-foreground ml-2 text-xs">{c.email}</span>}
                        </div>
                        {c.phoneNumber && <span className="text-muted-foreground text-xs">{c.phoneNumber}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Data Início</label>
                <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Prazo</label>
                <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Cobrança</label>
                <select value={form.billingType} onChange={e => setForm({ ...form, billingType: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  {Object.entries(BILLING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{form.billingType === 'HOURLY' ? 'Valor/Hora (R$)' : 'Custo Fixo (R$)'}</label>
                <input type="number" step="0.01" value={form.billingType === 'HOURLY' ? form.hourlyRate : form.fixedCost} onChange={e => setForm({ ...form, [form.billingType === 'HOURLY' ? 'hourlyRate' : 'fixedCost']: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 resize-none" />
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Projeto'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => {
          const st = STATUS_MAP[p.status] || STATUS_MAP.NOT_STARTED
          return (
            <div key={p.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200 cursor-pointer" onClick={() => setDetailId(p.id)}>
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h3 className="text-foreground font-medium truncate">{p.name}</h3>
                  {p.contact && <p className="text-muted-foreground text-xs mt-0.5 flex items-center gap-1"><Building2 className="h-3 w-3" />{p.contact.name}</p>}
                </div>
                {can('projects:manage') && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                <span className="text-xs text-muted-foreground">{BILLING_LABELS[p.billingType] || p.billingType}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${p.progress}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{p.progress}% concluído</span>
                <span>{p._count?.tasks || 0} tarefas</span>
              </div>
              {p.deadline && (
                <p className="text-xs text-muted-foreground mt-2">Prazo: {new Date(p.deadline).toLocaleDateString('pt-BR')}</p>
              )}
            </div>
          )
        })}
      </div>

      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><FolderKanban className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhum projeto</h3>
          <p className="text-muted-foreground text-sm">Crie seu primeiro projeto.</p>
        </div>
      )}
    </div>
  )
}
