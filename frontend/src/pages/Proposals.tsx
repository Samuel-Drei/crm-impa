import { useState, useEffect } from 'react'
import { FileText, Plus, Trash2, Edit2, X, Eye, Send, CheckCircle, XCircle, ArrowRight, MessageSquare, Clock, Copy, FileCheck, Ban, RotateCcw, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { proposalService, catalogService, customerAccountService } from '@/services/commercial'
import type { Proposal, CatalogItem } from '@/types'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  SENT: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-500' },
  OPEN: { label: 'Aberta', color: 'bg-cyan-500/10 text-cyan-500' },
  REVISED: { label: 'Revisada', color: 'bg-yellow-500/10 text-yellow-500' },
  DECLINED: { label: 'Recusada', color: 'bg-red-500/10 text-red-500' },
  ACCEPTED: { label: 'Aceita', color: 'bg-green-500/10 text-green-500' },
  EXPIRED: { label: 'Expirada', color: 'bg-orange-500/10 text-orange-500' },
}

export function Proposals() {
  const toast = useToast()
  const { can } = usePermissions()
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [detail, setDetail] = useState<Proposal | null>(null)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [commentText, setCommentText] = useState('')

  const emptyForm = { subject: '', customerId: '', notes: '', terms: '', openTill: '', items: [{ description: '', quantity: 1, unit: 'un', unitPrice: 0, discount: 0, taxRate: 0, catalogItemId: '' }] }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const res = await proposalService.list({ status: statusFilter || undefined })
      setProposals(res.proposals)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadCatalog() {
    try { const res = await catalogService.list({ limit: 100 }); setCatalogItems(res.items) } catch (e) { console.error(e) }
  }

  async function loadCustomers() {
    try { const res = await customerAccountService.list({ limit: 200 }); setCustomers(res.accounts) } catch (e) { console.error(e) }
  }

  async function viewDetail(id: string) {
    try { const p = await proposalService.get(id); setDetail(p) } catch (e) { console.error(e) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...form, items: form.items.map((it, i) => ({ ...it, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discount: Number(it.discount), taxRate: Number(it.taxRate), sortOrder: i, catalogItemId: it.catalogItemId || undefined })), customerId: form.customerId || undefined, openTill: form.openTill || undefined }
      if (editing) { await proposalService.update(editing.id, data) }
      else { await proposalService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir proposta', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await proposalService.delete(id); load() } catch (e) { console.error(e) }
  }

  async function handleConvert(id: string) {
    if (!await toast.confirm({ title: 'Converter em Fatura', message: 'Isso criará uma fatura a partir desta proposta.', confirmText: 'Converter' })) return
    try { await proposalService.convertToInvoice(id); toast.success('Fatura criada!'); load() } catch (e) { console.error(e) }
  }

  async function handleComment() {
    if (!detail || !commentText.trim()) return
    try { await proposalService.addComment(detail.id, commentText); setCommentText(''); viewDetail(detail.id) } catch (e) { console.error(e) }
  }

  async function handleStatusChange(id: string, status: string, label: string) {
    if (!await toast.confirm({ title: `Alterar status`, message: `Deseja marcar esta proposta como "${label}"?`, confirmText: label })) return
    try { await proposalService.updateStatus(id, status); toast.success(`Proposta marcada como ${label}`); viewDetail(id); load() } catch (e: any) { toast.error(e?.response?.data?.error || 'Erro ao alterar status') }
  }

  async function handleCopyLink(hash: string) {
    const url = `${window.location.origin}/p/${hash}`
    await navigator.clipboard.writeText(url)
    toast.success('Link copiado!')
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  function startEdit(p: Proposal) {
    setEditing(p)
    setForm({
      subject: p.subject, customerId: p.customerId || '', notes: p.notes || '', terms: p.terms || '',
      openTill: p.openTill ? p.openTill.split('T')[0] : '',
      items: p.items.map(it => ({ description: it.description, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, discount: it.discount, taxRate: it.taxRate, catalogItemId: it.catalogItemId || '' }))
    })
    loadCatalog()
    loadCustomers()
    setShowForm(true)
  }

  function openNew() { closeForm(); loadCatalog(); loadCustomers(); setShowForm(true) }

  function addItem() { setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit: 'un', unitPrice: 0, discount: 0, taxRate: 0, catalogItemId: '' }] }) }
  function removeItem(idx: number) { setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }) }
  function updateItem(idx: number, field: string, value: any) {
    const items = [...form.items]
    items[idx] = { ...items[idx], [field]: value }
    // Auto-fill from catalog
    if (field === 'catalogItemId' && value) {
      const cat = catalogItems.find(c => c.id === value)
      if (cat) { items[idx] = { ...items[idx], description: cat.name, unitPrice: Number(cat.price ?? 0), unit: cat.unit || 'un', taxRate: cat.taxRate || 0, catalogItemId: value } }
    }
    setForm({ ...form, items })
  }

  function calcLineTotal(it: typeof form.items[0]) {
    const sub = Number(it.quantity) * Number(it.unitPrice)
    const disc = sub * (Number(it.discount) / 100)
    const tax = (sub - disc) * (Number(it.taxRate) / 100)
    return sub - disc + tax
  }

  if (loading && proposals.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  // ── DETAIL VIEW ──
  if (detail) {
    const st = STATUS_MAP[detail.status] || STATUS_MAP.DRAFT
    return (
      <div className="p-6 space-y-6 max-w-5xl">
        <button onClick={() => setDetail(null)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">&larr; Voltar</button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{detail.number} — {detail.subject}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
              {(detail as any).sentAt && <span className="text-xs text-muted-foreground flex items-center gap-1"><Send className="h-3 w-3" /> Enviada em {new Date((detail as any).sentAt).toLocaleDateString('pt-BR')}</span>}
              {(detail as any).acceptedAt && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Aceita em {new Date((detail as any).acceptedAt).toLocaleDateString('pt-BR')}</span>}
              {(detail as any).declinedAt && <span className="text-xs text-red-500 flex items-center gap-1"><XCircle className="h-3 w-3" /> Recusada em {new Date((detail as any).declinedAt).toLocaleDateString('pt-BR')}</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Status action buttons */}
            {detail.status === 'DRAFT' && can('proposals:manage') && (
              <button onClick={() => handleStatusChange(detail.id, 'SENT', 'Enviada')} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 shadow-sm"><Send className="h-4 w-4" /> Enviar</button>
            )}
            {(detail.status === 'SENT' || detail.status === 'OPEN' || detail.status === 'REVISED') && can('proposals:manage') && (
              <>
                <button onClick={() => handleStatusChange(detail.id, 'ACCEPTED', 'Aceita')} className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 shadow-sm"><CheckCircle className="h-4 w-4" /> Aceitar</button>
                <button onClick={() => handleStatusChange(detail.id, 'DECLINED', 'Recusada')} className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 shadow-sm"><XCircle className="h-4 w-4" /> Recusar</button>
                <button onClick={() => handleStatusChange(detail.id, 'REVISED', 'Revisada')} className="flex items-center gap-2 px-3 py-2 bg-yellow-600 text-white rounded-lg text-sm hover:bg-yellow-700 shadow-sm"><RotateCcw className="h-4 w-4" /> Revisar</button>
              </>
            )}
            {detail.status === 'ACCEPTED' && can('invoices:manage') && (
              <button onClick={() => handleConvert(detail.id)} className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 shadow-sm"><ArrowRight className="h-4 w-4" /> Converter em Fatura</button>
            )}
            {detail.status === 'DECLINED' && can('proposals:manage') && (
              <button onClick={() => handleStatusChange(detail.id, 'DRAFT', 'Rascunho')} className="flex items-center gap-2 px-3 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700 shadow-sm"><RotateCcw className="h-4 w-4" /> Reabrir</button>
            )}
            {can('proposals:manage') && (
              <button onClick={() => startEdit(detail)} className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 shadow-sm"><Edit2 className="h-4 w-4" /> Editar</button>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <p className="text-sm font-medium text-foreground mt-1">{detail.customer?.name || '—'}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Validade</p>
            <p className={`text-sm font-medium mt-1 ${detail.openTill && new Date(detail.openTill) < new Date() ? 'text-red-500' : 'text-foreground'}`}>
              {detail.openTill ? new Date(detail.openTill).toLocaleDateString('pt-BR') : '—'}
              {detail.openTill && new Date(detail.openTill) < new Date() && <span className="text-xs ml-1">(expirada)</span>}
            </p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold text-foreground mt-1">R$ {detail.total.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Criado em</p>
            <p className="text-sm font-medium text-foreground mt-1">{new Date(detail.createdAt).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
            <h3 className="text-sm font-medium text-foreground">Itens da Proposta</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Descrição</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qtd</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Preço Unit.</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Desc.</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Imposto</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {detail.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-3 text-foreground">{it.description}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{it.quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">R$ {it.unitPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{it.discount > 0 ? `${it.discount}%` : '—'}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{it.taxRate > 0 ? `${it.taxRate}%` : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {it.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20">
              <tr><td colSpan={6} className="px-4 py-2 text-right font-medium text-muted-foreground">Subtotal</td><td className="px-4 py-2 text-right font-medium text-foreground">R$ {detail.subtotal.toFixed(2)}</td></tr>
              {detail.discountTotal > 0 && <tr><td colSpan={6} className="px-4 py-2 text-right text-muted-foreground">Descontos</td><td className="px-4 py-2 text-right text-red-500">- R$ {detail.discountTotal.toFixed(2)}</td></tr>}
              {detail.taxTotal > 0 && <tr><td colSpan={6} className="px-4 py-2 text-right text-muted-foreground">Impostos</td><td className="px-4 py-2 text-right text-muted-foreground">R$ {detail.taxTotal.toFixed(2)}</td></tr>}
              <tr><td colSpan={6} className="px-4 py-3 text-right font-semibold text-foreground">Total</td><td className="px-4 py-3 text-right font-semibold text-foreground text-lg">R$ {detail.total.toFixed(2)}</td></tr>
            </tfoot>
          </table>
        </div>

        {/* Notes & Terms */}
        {(detail.notes || detail.terms) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detail.notes && (
              <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Notas</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.notes}</p>
              </div>
            )}
            {detail.terms && (
              <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><FileCheck className="h-4 w-4 text-muted-foreground" /> Termos e Condições</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.terms}</p>
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <h3 className="text-foreground font-medium mb-4 flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Comentários ({(detail.comments || []).length})</h3>
          <div className="space-y-3 mb-4">
            {(detail.comments || []).length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            {(detail.comments || []).map(c => (
              <div key={c.id} className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-foreground">{c.user.name}</span>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString('pt-BR')}</span>
                </div>
                <p className="text-sm text-foreground/80">{c.content}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Adicionar comentário..." onKeyDown={e => e.key === 'Enter' && handleComment()} className="flex-1 bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            <button onClick={handleComment} disabled={!commentText.trim()} className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  const totalValue = proposals.reduce((s, p) => s + p.total, 0)
  const acceptedCount = proposals.filter(p => p.status === 'ACCEPTED').length
  const pendingCount = proposals.filter(p => ['DRAFT', 'SENT', 'OPEN', 'REVISED'].includes(p.status)).length
  const declinedCount = proposals.filter(p => p.status === 'DECLINED').length

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><FileText className="h-5 w-5 text-primary" /></div>
            Propostas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Crie e gerencie propostas comerciais.</p>
        </div>
        {can('proposals:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> Nova Proposta
          </button>
        )}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-lg text-sm ${!statusFilter ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>Todas</button>
        {Object.entries(STATUS_MAP).map(([k, v]) => (
          <button key={k} onClick={() => setStatusFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${statusFilter === k ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>{v.label}</button>
        ))}
      </div>

      {/* Summary cards */}
      {proposals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Total de Propostas</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{proposals.length}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Valor Total</p>
            <p className="text-xl font-semibold text-foreground mt-1">R$ {totalValue.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> Aceitas</p>
            <p className="text-2xl font-semibold text-green-500 mt-1">{acceptedCount}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" /> Pendentes</p>
            <p className="text-2xl font-semibold text-yellow-500 mt-1">{pendingCount}</p>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Proposta' : 'Nova Proposta'}</h2>
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
                <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40">
                  <option value="">Selecionar cliente...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.billingName || c.organization?.name || c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Validade até</label>
                <input type="date" value={form.openTill} onChange={e => setForm({ ...form, openTill: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">Itens</label>
                <button type="button" onClick={addItem} className="text-sm text-primary hover:underline flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Adicionar</button>
              </div>
              <div className="space-y-2">
                {form.items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-muted/20 rounded-lg p-3">
                    <div className="col-span-12 md:col-span-3">
                      <label className="text-xs text-muted-foreground">Item do Catálogo</label>
                      <select value={it.catalogItemId} onChange={e => updateItem(idx, 'catalogItemId', e.target.value)} className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                        <option value="">Manual</option>
                        {catalogItems.map(c => <option key={c.id} value={c.id}>{c.name} — R$ {Number(c.price ?? 0).toFixed(2)}</option>)}
                      </select>
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <label className="text-xs text-muted-foreground">Descrição *</label>
                      <input value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} required className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <label className="text-xs text-muted-foreground">Qtd</label>
                      <input type="number" min="1" value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <label className="text-xs text-muted-foreground">Preço Unit.</label>
                      <input type="number" step="0.01" value={it.unitPrice} onChange={e => updateItem(idx, 'unitPrice', e.target.value)} className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <label className="text-xs text-muted-foreground">Desc.%</label>
                      <input type="number" step="0.01" value={it.discount} onChange={e => updateItem(idx, 'discount', e.target.value)} className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="text-xs text-muted-foreground">Total</label>
                      <p className="py-2 text-sm font-medium text-foreground">R$ {calcLineTotal(it).toFixed(2)}</p>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {form.items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right mt-2">
                <span className="text-sm font-medium text-foreground">Total: R$ {form.items.reduce((s, it) => s + calcLineTotal(it), 0).toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Notas</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Termos</label>
                <textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
              </div>
            </div>

            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Proposta'}</button>
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
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Validade</th>
              {can('proposals:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {proposals.map(p => {
              const st = STATUS_MAP[p.status] || STATUS_MAP.DRAFT
              return (
                <tr key={p.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => viewDetail(p.id)}>
                  <td className="px-4 py-3 text-foreground font-medium">{p.number}</td>
                  <td className="px-4 py-3 text-foreground">{p.subject}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.customer?.name || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {p.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.openTill ? new Date(p.openTill).toLocaleDateString('pt-BR') : '—'}</td>
                  {can('proposals:manage') && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => viewDetail(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {proposals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4"><FileText className="h-10 w-10 text-muted-foreground/50" /></div>
            <h3 className="text-foreground font-medium mb-1">Nenhuma proposta</h3>
            <p className="text-muted-foreground text-sm">Crie sua primeira proposta comercial.</p>
          </div>
        )}
      </div>
    </div>
  )
}
