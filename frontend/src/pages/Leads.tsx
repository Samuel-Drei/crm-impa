import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, User, Mail, Phone, Edit2, Trash2, X, Building2,
  Thermometer, Target, ArrowRight, Filter, BarChart3, ChevronDown,
  Flame, Snowflake, Sun, Star, Calendar, DollarSign, Kanban
} from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { leadService } from '@/services/commercial'
import { useNavigate } from 'react-router-dom'
import api from '@/services/api'

// ── Constants ──

const STATUS_OPTIONS = [
  { value: 'NEW', label: 'Novo', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  { value: 'CONTACTED', label: 'Contactado', color: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
  { value: 'QUALIFYING', label: 'Qualificando', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  { value: 'QUALIFIED', label: 'Qualificado', color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  { value: 'UNQUALIFIED', label: 'Não Qualificado', color: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  { value: 'DISQUALIFIED', label: 'Desqualificado', color: 'bg-red-500/10 text-red-600 border-red-500/20' },
]

const TEMP_OPTIONS = [
  { value: 'HOT', label: 'Quente', color: 'text-red-500', icon: Flame },
  { value: 'WARM', label: 'Morno', color: 'text-amber-500', icon: Sun },
  { value: 'COLD', label: 'Frio', color: 'text-blue-400', icon: Snowflake },
]

const SOURCE_OPTIONS = ['WhatsApp', 'Website', 'Indicação', 'Redes Sociais', 'Telefone', 'Email', 'Evento', 'Outro']

function fmt(d?: string) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—' }
function money(v?: number | string) { return `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }

function getStatusInfo(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]
}
function getTempInfo(temp: string) {
  return TEMP_OPTIONS.find(t => t.value === temp) || TEMP_OPTIONS[2]
}

// ── Component ──

export function Leads() {
  const toast = useToast()
  const { can } = usePermissions()
  const navigate = useNavigate()

  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tempFilter, setTempFilter] = useState('')
  const [stats, setStats] = useState<any>(null)

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [form, setForm] = useState({
    contactId: '',
    status: 'NEW',
    temperature: 'COLD',
    score: '',
    source: '',
    channel: '',
    estimatedBudget: '',
    qualificationNotes: '',
  })

  // Convert dialog
  const [converting, setConverting] = useState<any>(null)
  const [convertForm, setConvertForm] = useState({
    accountType: 'INDIVIDUAL',
    billingName: '',
    billingEmail: '',
    taxId: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (tempFilter) params.temperature = tempFilter
      const data = await leadService.list(params)
      setLeads(data.leads)
    } catch { toast.error('Erro ao carregar leads') }
    setLoading(false)
  }, [search, statusFilter, tempFilter])

  const loadStats = async () => {
    try { setStats(await leadService.stats()) } catch {}
  }

  const loadContacts = async () => {
    try {
      const res = await api.get('/contacts', { params: { limit: 500 } })
      setContacts(res.data.contacts || [])
    } catch {}
  }

  useEffect(() => { load(); loadStats() }, [load])

  const openNew = () => {
    setEditing(null)
    setForm({ contactId: '', status: 'NEW', temperature: 'COLD', score: '', source: '', channel: '', estimatedBudget: '', qualificationNotes: '' })
    setContactSearch('')
    loadContacts()
    setShowForm(true)
  }

  const openEdit = (lead: any) => {
    setEditing(lead)
    setForm({
      contactId: lead.contactId,
      status: lead.status,
      temperature: lead.temperature,
      score: lead.score != null ? String(lead.score) : '',
      source: lead.source || '',
      channel: lead.channel || '',
      estimatedBudget: lead.estimatedBudget ? String(lead.estimatedBudget) : '',
      qualificationNotes: lead.qualificationNotes || '',
    })
    setContactSearch(lead.contact?.name || '')
    setShowForm(true)
  }

  const save = async () => {
    try {
      if (editing) {
        const payload: any = {
          status: form.status,
          temperature: form.temperature,
          score: form.score ? Number(form.score) : null,
          source: form.source || null,
          channel: form.channel || null,
          estimatedBudget: form.estimatedBudget ? Number(form.estimatedBudget) : null,
          qualificationNotes: form.qualificationNotes || null,
        }
        await leadService.update(editing.id, payload)
        toast.success('Lead atualizado')
      } else {
        if (!form.contactId) { toast.error('Selecione um contato'); return }
        const payload: any = {
          contactId: form.contactId,
          status: form.status,
          temperature: form.temperature,
        }
        if (form.score) payload.score = Number(form.score)
        if (form.source) payload.source = form.source
        if (form.channel) payload.channel = form.channel
        if (form.estimatedBudget) payload.estimatedBudget = Number(form.estimatedBudget)
        await leadService.create(payload)
        toast.success('Lead criado')
      }
      setShowForm(false)
      load()
      loadStats()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    }
  }

  const remove = async (id: string) => {
    if (!await toast.confirm({ title: 'Excluir Lead', message: 'Este lead será excluído permanentemente.', danger: true, confirmText: 'Excluir' })) return
    try {
      await leadService.delete(id)
      toast.success('Lead excluído')
      load()
      loadStats()
    } catch { toast.error('Erro ao excluir') }
  }

  const openConvert = (lead: any) => {
    setConverting(lead)
    setConvertForm({
      accountType: 'INDIVIDUAL',
      billingName: lead.contact?.name || '',
      billingEmail: lead.contact?.email || '',
      taxId: '',
    })
  }

  const doConvert = async () => {
    if (!converting) return
    try {
      await leadService.convert(converting.id, convertForm)
      toast.success('Lead convertido em cliente!')
      setConverting(null)
      load()
      loadStats()
    } catch (err: any) { toast.error(err.response?.data?.error || 'Erro ao converter') }
  }

  const filteredContacts = contactSearch && !editing
    ? contacts.filter(c => {
        const q = contactSearch.toLowerCase()
        return c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || c.phoneNumber.includes(q)
      }).slice(0, 15)
    : []

  const statusCount = (s: string) => stats?.byStatus?.[s] || 0
  const tempCount = (t: string) => stats?.byTemperature?.[t] || 0

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground text-sm">Gerencie e qualifique seus leads</p>
        </div>
        <div className="flex items-center gap-2">
          {can('pipelines:read') && (
            <button onClick={() => navigate('/pipelines?type=leads')} className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 text-sm font-medium">
              <Kanban className="h-4 w-4" /> Ver Kanban
            </button>
          )}
          {can('contacts:write') && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">
              <Plus className="h-4 w-4" /> Novo Lead
            </button>
          )}
        </div>
      </div>

      {/* ── Stats cards ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-card border border-border/60 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          {STATUS_OPTIONS.slice(0, 4).map(s => (
            <div key={s.value} className="bg-card border border-border/60 rounded-xl p-3 text-center cursor-pointer hover:bg-muted/30"
              onClick={() => setStatusFilter(statusFilter === s.value ? '' : s.value)}>
              <p className="text-2xl font-bold text-foreground">{statusCount(s.value)}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
          {TEMP_OPTIONS.map(t => {
            const Icon = t.icon
            return (
              <div key={t.value} className="bg-card border border-border/60 rounded-xl p-3 text-center cursor-pointer hover:bg-muted/30"
                onClick={() => setTempFilter(tempFilter === t.value ? '' : t.value)}>
                <div className="flex items-center justify-center gap-1">
                  <Icon className={`h-4 w-4 ${t.color}`} />
                  <p className="text-2xl font-bold text-foreground">{tempCount(t.value)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar leads..." className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={tempFilter} onChange={e => setTempFilter(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">Temperatura</option>
          {TEMP_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {(statusFilter || tempFilter) && (
          <button onClick={() => { setStatusFilter(''); setTempFilter('') }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="h-3 w-3" /> Limpar filtros
          </button>
        )}
      </div>

      {/* ── Lead cards ── */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : leads.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Target className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Nenhum lead encontrado</p>
          {can('contacts:write') && <button onClick={openNew} className="mt-2 text-primary text-sm hover:underline">Criar primeiro lead</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {leads.map((lead: any) => {
            const st = getStatusInfo(lead.status)
            const tp = getTempInfo(lead.temperature)
            const TempIcon = tp.icon

            return (
              <div key={lead.id} className="bg-card border border-border/50 rounded-xl p-5 hover:border-border transition-colors group">
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
                      {lead.contact?.profilePicture
                        ? <img src={lead.contact.profilePicture} className="w-10 h-10 rounded-full object-cover" />
                        : (lead.contact?.name || 'L')[0].toUpperCase()
                      }
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-foreground font-medium truncate">{lead.contact?.name || 'Sem nome'}</h3>
                      {lead.contact?.email && (
                        <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                          <Mail className="h-3 w-3 shrink-0" /> {lead.contact.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <TempIcon className={`h-4 w-4 ${tp.color}`} />
                    {lead.score != null && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-500 font-medium ml-1">
                        <Star className="h-3 w-3" /> {lead.score}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${st.color}`}>{st.label}</span>
                  {lead.source && <span className="text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">{lead.source}</span>}
                </div>

                {/* Info */}
                <div className="space-y-1.5 text-xs text-muted-foreground mb-3">
                  {lead.contact?.phoneNumber && (
                    <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {lead.contact.phoneNumber}</p>
                  )}
                  {lead.estimatedBudget && (
                    <p className="flex items-center gap-1.5"><DollarSign className="h-3 w-3" /> {money(lead.estimatedBudget)}</p>
                  )}
                  <p className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Criado em {fmt(lead.createdAt)}</p>
                  {lead.convertedAt && (
                    <p className="text-green-500 font-medium flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" /> Convertido em {fmt(lead.convertedAt)}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-3 border-t border-border/30">
                  {can('contacts:write') && !lead.convertedAt && (
                    <button onClick={() => openEdit(lead)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-muted/50 text-foreground hover:bg-muted">
                      <Edit2 className="h-3 w-3" /> Editar
                    </button>
                  )}
                  {can('customers:manage') && !lead.convertedAt && (
                    <button onClick={() => openConvert(lead)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-green-500/10 text-green-600 hover:bg-green-500/20">
                      <ArrowRight className="h-3 w-3" /> Converter
                    </button>
                  )}
                  {can('contacts:delete') && (
                    <button onClick={() => remove(lead.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/8">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ FORM MODAL ═══ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border/40">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Lead' : 'Novo Lead'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Contact selector (only for new) */}
              {!editing && (
                <div>
                  <label className="block text-sm font-medium mb-1">Contato *</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input value={contactSearch} onChange={e => { setContactSearch(e.target.value); setForm(f => ({...f, contactId: ''})) }}
                      placeholder="Buscar contato..." className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  {filteredContacts.length > 0 && (
                    <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto divide-y divide-border/30">
                      {filteredContacts.map((c: any) => (
                        <button key={c.id} type="button" onClick={() => { setForm(f => ({...f, contactId: c.id})); setContactSearch(c.name) }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex justify-between ${form.contactId === c.id ? 'bg-primary/5 font-medium' : ''}`}>
                          <span>{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.phoneNumber}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.contactId && <p className="text-xs text-green-500 mt-1">Contato selecionado</p>}
                </div>
              )}

              {editing && (
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                    {(editing.contact?.name || 'L')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{editing.contact?.name}</p>
                    <p className="text-xs text-muted-foreground">{editing.contact?.phoneNumber}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Temperatura</label>
                  <select value={form.temperature} onChange={e => setForm(f => ({...f, temperature: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                    {TEMP_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Pontuação (0-100)</label>
                  <input type="number" min="0" max="100" value={form.score} onChange={e => setForm(f => ({...f, score: e.target.value}))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Orçamento Estimado</label>
                  <input type="number" value={form.estimatedBudget} onChange={e => setForm(f => ({...f, estimatedBudget: e.target.value}))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" placeholder="0.00" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Origem</label>
                  <select value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                    <option value="">Selecionar...</option>
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Canal</label>
                  <input value={form.channel} onChange={e => setForm(f => ({...f, channel: e.target.value}))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" placeholder="Ex: Instagram, Google" />
                </div>
              </div>

              {editing && (
                <div>
                  <label className="block text-sm font-medium mb-1">Notas de Qualificação</label>
                  <textarea value={form.qualificationNotes} onChange={e => setForm(f => ({...f, qualificationNotes: e.target.value}))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" rows={3} placeholder="Observações sobre a qualificação..." />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-border/40">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
              <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                {editing ? 'Salvar' : 'Criar Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CONVERT MODAL ═══ */}
      {converting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConverting(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border/40">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-green-500" /> Converter Lead em Cliente
              </h2>
              <button onClick={() => setConverting(null)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                  {(converting.contact?.name || 'L')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{converting.contact?.name}</p>
                  <p className="text-xs text-muted-foreground">{converting.contact?.email || converting.contact?.phoneNumber}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Tipo de Conta</label>
                <select value={convertForm.accountType} onChange={e => setConvertForm(f => ({...f, accountType: e.target.value}))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="INDIVIDUAL">Pessoa Física</option>
                  <option value="COMPANY">Empresa</option>
                  <option value="GOVERNMENT">Governo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nome de Faturamento</label>
                <input value={convertForm.billingName} onChange={e => setConvertForm(f => ({...f, billingName: e.target.value}))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email de Faturamento</label>
                <input type="email" value={convertForm.billingEmail} onChange={e => setConvertForm(f => ({...f, billingEmail: e.target.value}))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">CPF/CNPJ</label>
                <input value={convertForm.taxId} onChange={e => setConvertForm(f => ({...f, taxId: e.target.value}))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-border/40">
              <button onClick={() => setConverting(null)} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={doConvert} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
                <ArrowRight className="h-4 w-4" /> Converter em Cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
