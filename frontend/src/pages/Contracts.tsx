import { useState, useEffect, useCallback } from 'react'
import { ScrollText, Plus, Trash2, Edit2, X, Eye, CheckCircle, RefreshCw, FileText, ChevronRight, Search, Copy, Lock, Save } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { contractService, customerAccountService } from '@/services/commercial'
import type { Contract } from '@/types'

type TemplateItem = { id: string; name: string; category: string; description: string; icon: string; content: string; isDefault: boolean }

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  SENT: { label: 'Enviado', color: 'bg-blue-500/10 text-blue-500' },
  ACTIVE: { label: 'Ativo', color: 'bg-green-500/10 text-green-500' },
  EXPIRED: { label: 'Expirado', color: 'bg-red-500/10 text-red-500' },
  CANCELLED: { label: 'Cancelado', color: 'bg-gray-500/10 text-gray-400' },
  RENEWED: { label: 'Renovado', color: 'bg-cyan-500/10 text-cyan-500' },
}

export function Contracts() {
  const toast = useToast()
  const { can } = usePermissions()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [detail, setDetail] = useState<Contract | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [showRenew, setShowRenew] = useState(false)
  const [renewForm, setRenewForm] = useState({ newEndDate: '', newValue: '', notes: '' })
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState('')
  const [customers, setCustomers] = useState<any[]>([])
  // Template editor
  const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [templateForm, setTemplateForm] = useState({ name: '', category: '', description: '', icon: '📄', content: '' })

  const emptyForm = { subject: '', customerId: '', type: '', startDate: '', endDate: '', value: 0, content: '', notes: '', autoRenew: false, renewalDays: 30 }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const res = await contractService.list({ status: statusFilter || undefined })
      setContracts(res.contracts)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function viewDetail(id: string) {
    try { const c = await contractService.get(id); setDetail(c) } catch (e) { console.error(e) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...form, value: Number(form.value), renewalDays: Number(form.renewalDays), endDate: form.endDate || undefined, customerId: form.customerId || undefined }
      if (editing) { await contractService.update(editing.id, data) }
      else { await contractService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir contrato', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await contractService.delete(id); load() } catch (e) { console.error(e) }
  }

  async function handleRenew() {
    if (!detail) return
    try {
      await contractService.renew(detail.id, { newEndDate: renewForm.newEndDate, newValue: renewForm.newValue ? Number(renewForm.newValue) : undefined, notes: renewForm.notes || undefined })
      setShowRenew(false); setRenewForm({ newEndDate: '', newValue: '', notes: '' })
      viewDetail(detail.id); toast.success('Contrato renovado!')
    } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  async function loadTemplates() {
    try { const t = await contractService.getTemplates(); setTemplates(t) } catch (e) { console.error(e) }
  }

  async function loadCustomers() {
    try { const res = await customerAccountService.list({ limit: 200 }); setCustomers(res.accounts) } catch (e) { console.error(e) }
  }

  function selectTemplate(template: TemplateItem) {
    setForm({
      ...emptyForm,
      subject: template.name,
      type: template.category,
      content: template.content,
      startDate: new Date().toISOString().split('T')[0],
    })
    setShowTemplates(false)
    setShowForm(true)
    loadCustomers()
  }

  function openTemplates() {
    loadTemplates()
    setShowTemplates(true)
  }

  // ── Template CRUD ──
  async function handleCloneTemplate(template: TemplateItem) {
    try {
      await contractService.cloneTemplate(template.id)
      toast.success('Modelo clonado!')
      loadTemplates()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteTemplate(template: TemplateItem) {
    if (template.isDefault) return
    if (!await toast.confirm({ title: 'Excluir modelo', message: `Excluir "${template.name}"?`, danger: true, confirmText: 'Excluir' })) return
    try {
      await contractService.deleteTemplate(template.id)
      toast.success('Modelo excluído!')
      loadTemplates()
    } catch (e) { console.error(e) }
  }

  function openNewTemplate() {
    setEditingTemplate(null)
    setTemplateForm({ name: '', category: '', description: '', icon: '📄', content: '' })
    setShowTemplateForm(true)
  }

  function openEditTemplate(template: TemplateItem) {
    if (template.isDefault) return
    setEditingTemplate(template)
    setTemplateForm({
      name: template.name,
      category: template.category,
      description: template.description || '',
      icon: template.icon || '📄',
      content: template.content,
    })
    setShowTemplateForm(true)
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingTemplate) {
        await contractService.updateTemplate(editingTemplate.id, templateForm)
        toast.success('Modelo atualizado!')
      } else {
        await contractService.createTemplate(templateForm)
        toast.success('Modelo criado!')
      }
      setShowTemplateForm(false)
      setEditingTemplate(null)
      loadTemplates()
    } catch (e) { console.error(e) }
  }

  // ── Auto-fill merge fields ──
  const applyMergeData = useCallback(async (contactId: string, currentContent: string) => {
    if (!contactId || !currentContent) return currentContent
    try {
      const mergeData = await contractService.getMergeData(contactId)
      let content = currentContent
      for (const [key, value] of Object.entries(mergeData)) {
        if (value) content = content.replaceAll(key, value)
      }
      // Auto-fill date fields from form
      const today = new Date()
      content = content.replaceAll('{{DATA_ATUAL}}', today.toLocaleDateString('pt-BR'))
      return content
    } catch (e) {
      console.error(e)
      return currentContent
    }
  }, [])

  async function handleCustomerChange(customerId: string) {
    setForm(prev => ({ ...prev, customerId }))
    if (customerId && form.content) {
      const updatedContent = await applyMergeData(customerId, form.content)
      setForm(prev => ({ ...prev, customerId, content: updatedContent }))
    }
  }

  function startEdit(c: Contract) {
    setEditing(c)
    setForm({
      subject: c.subject, customerId: c.customerId, type: c.type,
      startDate: c.startDate.split('T')[0], endDate: c.endDate ? c.endDate.split('T')[0] : '',
      value: c.value, content: c.content || '', notes: c.notes || '',
      autoRenew: c.autoRenew, renewalDays: c.renewalDays
    })
    loadCustomers()
    setShowForm(true)
  }

  function openNew() { closeForm(); loadCustomers(); setShowForm(true) }

  // Auto-fill DATA_INICIO and DATA_FIM when dates change
  function handleDateChange(field: 'startDate' | 'endDate', value: string) {
    setForm(prev => {
      let content = prev.content
      if (value && content) {
        const formatted = new Date(value + 'T12:00:00').toLocaleDateString('pt-BR')
        if (field === 'startDate') content = content.replaceAll('{{DATA_INICIO}}', formatted)
        if (field === 'endDate') content = content.replaceAll('{{DATA_FIM}}', formatted)
      }
      return { ...prev, [field]: value, content }
    })
  }

  // Auto-fill VALOR when value changes
  function handleValueChange(value: number) {
    setForm(prev => {
      let content = prev.content
      if (value > 0 && content) {
        content = content.replaceAll('{{VALOR}}', value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
      }
      return { ...prev, value, content }
    })
  }

  if (loading && contracts.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  // ── DETAIL VIEW ──
  if (detail) {
    const st = STATUS_MAP[detail.status] || STATUS_MAP.DRAFT
    return (
      <div className="p-6 space-y-6 max-w-5xl">
        <button onClick={() => setDetail(null)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">&larr; Voltar</button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{detail.number} — {detail.subject}</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
          </div>
          <div className="flex gap-2">
            {(detail.status === 'ACTIVE' || detail.status === 'EXPIRED') && can('contracts:manage') && (
              <button onClick={() => setShowRenew(true)} className="flex items-center gap-2 px-3 py-2 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-700"><RefreshCw className="h-4 w-4" /> Renovar</button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <p className="text-sm font-medium text-foreground mt-1">{detail.customer?.name || '—'}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Tipo</p>
            <p className="text-sm font-medium text-foreground mt-1">{detail.type || '—'}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Valor</p>
            <p className="text-lg font-semibold text-foreground mt-1">R$ {detail.value.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Período</p>
            <p className="text-sm font-medium text-foreground mt-1">
              {new Date(detail.startDate).toLocaleDateString('pt-BR')} — {detail.endDate ? new Date(detail.endDate).toLocaleDateString('pt-BR') : 'Indeterminado'}
            </p>
          </div>
        </div>

        {detail.signedAt && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm font-medium text-green-500">Assinado digitalmente</p>
              <p className="text-xs text-muted-foreground">Por {detail.signedByName} em {new Date(detail.signedAt).toLocaleString('pt-BR')}</p>
            </div>
          </div>
        )}

        {detail.content && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <h3 className="text-foreground font-medium mb-3">Conteúdo</h3>
            <div className="prose prose-sm max-w-none text-foreground/80 whitespace-pre-wrap">{detail.content}</div>
          </div>
        )}

        {/* Renewals */}
        {(detail.renewals || []).length > 0 && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <h3 className="text-foreground font-medium mb-4 flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Histórico de Renovações</h3>
            <div className="space-y-2">
              {detail.renewals!.map(r => (
                <div key={r.id} className="bg-muted/20 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm text-foreground">{new Date(r.oldEndDate).toLocaleDateString('pt-BR')} → {new Date(r.newEndDate).toLocaleDateString('pt-BR')}</span>
                    {r.newValue && <span className="text-xs text-muted-foreground ml-2">R$ {r.newValue.toFixed(2)}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{r.renewedBy?.name} • {new Date(r.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Renew Modal */}
        {showRenew && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <h3 className="text-foreground font-medium mb-4">Renovar Contrato</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nova Data Final *</label>
                <input type="date" value={renewForm.newEndDate} onChange={e => setRenewForm({ ...renewForm, newEndDate: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Novo Valor</label>
                <input type="number" step="0.01" value={renewForm.newValue} onChange={e => setRenewForm({ ...renewForm, newValue: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Observações</label>
                <input value={renewForm.notes} onChange={e => setRenewForm({ ...renewForm, notes: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleRenew} className="px-5 py-2.5 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 text-sm font-medium">Renovar</button>
              <button onClick={() => setShowRenew(false)} className="px-5 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 text-sm">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── LIST VIEW ──
  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><ScrollText className="h-5 w-5 text-primary" /></div>
            Contratos
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie contratos com clientes.</p>
        </div>
        {can('contracts:manage') && (
          <div className="flex gap-2">
            <button onClick={openTemplates} className="flex items-center gap-2 px-4 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
              <FileText className="h-4 w-4" /> Usar Modelo
            </button>
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
              <Plus className="h-4 w-4" /> Novo Contrato
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-lg text-sm ${!statusFilter ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>Todos</button>
        {Object.entries(STATUS_MAP).map(([k, v]) => (
          <button key={k} onClick={() => setStatusFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${statusFilter === k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>{v.label}</button>
        ))}
      </div>

      {/* Templates Gallery */}
      {showTemplates && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-medium text-foreground flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Modelos de Contrato</h2>
              <p className="text-sm text-muted-foreground mt-1">Selecione um modelo para usar, ou crie o seu próprio</p>
            </div>
            <div className="flex gap-2">
              {can('contracts:manage') && (
                <button onClick={openNewTemplate} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 font-medium">
                  <Plus className="h-4 w-4" /> Criar Modelo
                </button>
              )}
              <button onClick={() => setShowTemplates(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
            </div>
          </div>

          {/* Template Form (create/edit) */}
          {showTemplateForm && (
            <div className="bg-muted/20 border border-border/60 rounded-xl p-5 mb-5">
              <h3 className="text-foreground font-medium mb-4">{editingTemplate ? 'Editar Modelo' : 'Novo Modelo'}</h3>
              <form onSubmit={handleSaveTemplate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                    <input value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Categoria *</label>
                    <input value={templateForm.category} onChange={e => setTemplateForm({ ...templateForm, category: e.target.value })} required placeholder="Ex: Serviços, Tecnologia" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Ícone</label>
                    <input value={templateForm.icon} onChange={e => setTemplateForm({ ...templateForm, icon: e.target.value })} placeholder="📄" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                  <input value={templateForm.description} onChange={e => setTemplateForm({ ...templateForm, description: e.target.value })} placeholder="Breve descrição do modelo" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Conteúdo *</label>
                  <textarea value={templateForm.content} onChange={e => setTemplateForm({ ...templateForm, content: e.target.value })} required rows={10} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 resize-y font-mono text-[13px] leading-relaxed" />
                  <p className="text-xs text-muted-foreground mt-1.5">Campos dinâmicos: {'{{CONTRATANTE_NOME}}'}, {'{{CONTRATANTE_DOCUMENTO}}'}, {'{{CONTRATANTE_ENDERECO}}'}, {'{{CONTRATANTE_EMAIL}}'}, {'{{CONTRATADA_NOME}}'}, {'{{CONTRATADA_DOCUMENTO}}'}, {'{{CONTRATADA_EMAIL}}'}, {'{{VALOR}}'}, {'{{DATA_INICIO}}'}, {'{{DATA_FIM}}'}, {'{{OBJETO}}'}, {'{{CIDADE}}'}, {'{{DATA_ATUAL}}'}</p>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">
                    <Save className="h-4 w-4" /> {editingTemplate ? 'Salvar' : 'Criar Modelo'}
                  </button>
                  <button type="button" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null) }} className="px-5 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 text-sm">Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {/* Search & Category filter */}
          <div className="flex gap-3 mb-5 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} placeholder="Buscar modelo..." className="w-full bg-background border border-border rounded-lg pl-9 pr-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setTemplateCategory('')} className={`px-3 py-1.5 rounded-lg text-sm ${!templateCategory ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>Todos</button>
              {[...new Set(templates.map(t => t.category))].map(cat => (
                <button key={cat} onClick={() => setTemplateCategory(cat)} className={`px-3 py-1.5 rounded-lg text-sm ${templateCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>{cat}</button>
              ))}
            </div>
          </div>

          {/* Template cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates
              .filter(t => !templateCategory || t.category === templateCategory)
              .filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.description.toLowerCase().includes(templateSearch.toLowerCase()))
              .map(template => (
                <div
                  key={template.id}
                  className="group text-left bg-background border border-border/60 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <span className="text-2xl">{template.icon}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                        {template.name}
                        {template.isDefault && <Lock className="h-3 w-3 text-muted-foreground/60" />}
                      </h3>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                        {template.category}
                        {template.isDefault ? ' • Padrão' : ' • Personalizado'}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{template.description}</p>
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border/40">
                    <button onClick={() => selectTemplate(template)} className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-medium hover:bg-primary/20 flex-1 justify-center" title="Usar este modelo">
                      <ChevronRight className="h-3.5 w-3.5" /> Usar
                    </button>
                    <button onClick={() => handleCloneTemplate(template)} className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/60 text-muted-foreground rounded-lg text-xs hover:bg-muted hover:text-foreground" title="Duplicar modelo">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {!template.isDefault && can('contracts:manage') && (
                      <>
                        <button onClick={() => openEditTemplate(template)} className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/60 text-muted-foreground rounded-lg text-xs hover:bg-muted hover:text-foreground" title="Editar modelo">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDeleteTemplate(template)} className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/60 text-muted-foreground rounded-lg text-xs hover:bg-destructive/10 hover:text-destructive" title="Excluir modelo">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Contrato' : 'Novo Contrato'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Assunto *</label>
                <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Cliente</label>
                <select value={form.customerId} onChange={e => handleCustomerChange(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40">
                  <option value="">Selecionar cliente...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.billingName || c.organization?.name || c.id}</option>)}
                </select>
                {form.content && form.content.includes('{{CONTRATANTE_') && form.customerId && (
                  <p className="text-xs text-green-500 mt-1">Campos do cliente preenchidos automaticamente</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Tipo</label>
                <input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="Ex: Prestação de Serviços" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Data Início *</label>
                <input type="date" value={form.startDate} onChange={e => handleDateChange('startDate', e.target.value)} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Data Fim</label>
                <input type="date" value={form.endDate} onChange={e => handleDateChange('endDate', e.target.value)} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Valor *</label>
                <input type="number" step="0.01" value={form.value} onChange={e => handleValueChange(Number(e.target.value))} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Dias p/ Renovação</label>
                <input type="number" value={form.renewalDays} onChange={e => setForm({ ...form, renewalDays: Number(e.target.value) })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-foreground">Conteúdo do Contrato</label>
                {!editing && (
                  <button type="button" onClick={openTemplates} className="text-sm text-primary hover:underline flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Usar modelo</button>
                )}
              </div>
              <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={12} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 resize-y font-mono text-[13px] leading-relaxed" />
              <p className="text-xs text-muted-foreground mt-1.5">Use campos dinâmicos: {'{{CONTRATANTE_NOME}}'}, {'{{CONTRATADA_NOME}}'}, {'{{VALOR}}'}, {'{{DATA_INICIO}}'}, {'{{DATA_FIM}}'}, {'{{OBJETO}}'}, {'{{CIDADE}}'}, {'{{DATA_ATUAL}}'}</p>
            </div>
            <div className="flex items-center gap-2.5">
              <input type="checkbox" checked={form.autoRenew} onChange={e => setForm({ ...form, autoRenew: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
              <label className="text-sm text-foreground">Renovação automática</label>
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Contrato'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nº</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assunto</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Período</th>
              {can('contracts:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {contracts.map(c => {
              const st = STATUS_MAP[c.status] || STATUS_MAP.DRAFT
              return (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => viewDetail(c.id)}>
                  <td className="px-4 py-3 text-foreground font-medium">{c.number}</td>
                  <td className="px-4 py-3 text-foreground">{c.subject}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.customer?.name || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {c.value.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(c.startDate).toLocaleDateString('pt-BR')} — {c.endDate ? new Date(c.endDate).toLocaleDateString('pt-BR') : '∞'}</td>
                  {can('contracts:manage') && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => viewDetail(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {contracts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4"><ScrollText className="h-10 w-10 text-muted-foreground/50" /></div>
            <h3 className="text-foreground font-medium mb-1">Nenhum contrato</h3>
            <p className="text-muted-foreground text-sm mb-4">Crie seu primeiro contrato usando um de nossos modelos.</p>
            {can('contracts:manage') && (
              <button onClick={openTemplates} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm">
                <FileText className="h-4 w-4" /> Ver Modelos de Contrato
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
