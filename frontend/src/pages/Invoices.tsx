import { useState, useEffect } from 'react'
import { Receipt, Plus, Trash2, Edit2, X, Eye, DollarSign, Send, Ban, Clock, CheckCircle, AlertTriangle, FileText, FileCheck } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { invoiceService, catalogService, customerAccountService, paymentService } from '@/services/commercial'
import type { Invoice, CatalogItem } from '@/types'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  SENT: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-500' },
  VIEWED: { label: 'Visualizada', color: 'bg-cyan-500/10 text-cyan-500' },
  PARTIAL: { label: 'Pago Parcial', color: 'bg-yellow-500/10 text-yellow-500' },
  PAID: { label: 'Paga', color: 'bg-green-500/10 text-green-500' },
  OVERDUE: { label: 'Vencida', color: 'bg-red-500/10 text-red-500' },
  CANCELLED: { label: 'Cancelada', color: 'bg-gray-500/10 text-gray-400' },
}

export function Invoices() {
  const toast = useToast()
  const { can } = usePermissions()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ amount: 0, method: 'PIX', note: '' })

  const emptyForm = { customerId: '', dueDate: '', notes: '', terms: '', recurring: false, recurringCycle: 'MONTHLY', items: [{ description: '', quantity: 1, unit: 'un', unitPrice: 0, discount: 0, taxRate: 0, catalogItemId: '' }] }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const res = await invoiceService.list({ status: statusFilter || undefined })
      setInvoices(res.invoices)
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
    try { const inv = await invoiceService.get(id); setDetail(inv); setShowPaymentForm(false) } catch (e) { console.error(e) }
  }

  async function handleStatusChange(id: string, status: string, label: string) {
    if (!await toast.confirm({ title: `Alterar status`, message: `Deseja marcar esta fatura como "${label}"?`, confirmText: label })) return
    try { await invoiceService.updateStatus(id, status); toast.success(`Fatura marcada como ${label}`); viewDetail(id); load() } catch (e: any) { toast.error(e?.response?.data?.error || 'Erro ao alterar status') }
  }

  async function handleRegisterPayment() {
    if (!detail || paymentForm.amount <= 0) return
    try {
      await paymentService.create({ invoiceId: detail.id, amount: paymentForm.amount, method: paymentForm.method, note: paymentForm.note || undefined })
      toast.success('Pagamento registrado!')
      setShowPaymentForm(false)
      setPaymentForm({ amount: 0, method: 'PIX', note: '' })
      viewDetail(detail.id)
      load()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Erro ao registrar pagamento') }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...form, items: form.items.map((it, i) => ({ ...it, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discount: Number(it.discount), taxRate: Number(it.taxRate), sortOrder: i, catalogItemId: it.catalogItemId || undefined })), dueDate: form.dueDate || undefined }
      if (editing) { await invoiceService.update(editing.id, data) }
      else { await invoiceService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir fatura', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await invoiceService.delete(id); load() } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  function startEdit(inv: Invoice) {
    setEditing(inv)
    setForm({
      customerId: inv.customerId, dueDate: inv.dueDate ? inv.dueDate.split('T')[0] : '', notes: inv.notes || '', terms: inv.terms || '',
      recurring: inv.recurring, recurringCycle: inv.recurringCycle || 'MONTHLY',
      items: inv.items.map(it => ({ description: it.description, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, discount: it.discount, taxRate: it.taxRate, catalogItemId: it.catalogItemId || '' }))
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

  if (loading && invoices.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  // ── DETAIL VIEW ──
  if (detail) {
    const st = STATUS_MAP[detail.status] || STATUS_MAP.DRAFT
    const isOverdue = detail.dueDate && new Date(detail.dueDate) < new Date() && !['PAID', 'CANCELLED'].includes(detail.status)
    return (
      <div className="p-6 space-y-6 max-w-5xl">
        <button onClick={() => setDetail(null)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">&larr; Voltar</button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{detail.number}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
              {isOverdue && <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Vencida</span>}
              {detail.recurring && <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-500">Recorrente ({detail.recurringCycle})</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {detail.status === 'DRAFT' && can('invoices:manage') && (
              <button onClick={() => handleStatusChange(detail.id, 'SENT', 'Enviada')} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 shadow-sm"><Send className="h-4 w-4" /> Enviar</button>
            )}
            {['SENT', 'VIEWED', 'PARTIAL', 'OVERDUE'].includes(detail.status) && detail.amountDue > 0 && can('invoices:manage') && (
              <button onClick={() => { setShowPaymentForm(true); setPaymentForm({ amount: detail.amountDue, method: 'PIX', note: '' }) }} className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 shadow-sm"><DollarSign className="h-4 w-4" /> Registrar Pagamento</button>
            )}
            {!['PAID', 'CANCELLED'].includes(detail.status) && can('invoices:manage') && (
              <button onClick={() => handleStatusChange(detail.id, 'CANCELLED', 'Cancelada')} className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 shadow-sm"><Ban className="h-4 w-4" /> Cancelar</button>
            )}
            {can('invoices:manage') && !['PAID', 'CANCELLED'].includes(detail.status) && (
              <button onClick={() => startEdit(detail)} className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 shadow-sm"><Edit2 className="h-4 w-4" /> Editar</button>
            )}
          </div>
        </div>

        {/* Payment registration form */}
        {showPaymentForm && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2"><DollarSign className="h-4 w-4 text-green-500" /> Registrar Pagamento</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Valor *</label>
                <input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Método</label>
                <select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30">
                  <option value="PIX">PIX</option>
                  <option value="CREDIT_CARD">Cartão de Crédito</option>
                  <option value="DEBIT_CARD">Cartão de Débito</option>
                  <option value="BANK_TRANSFER">Transferência</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="CASH">Dinheiro</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Observação</label>
                <input value={paymentForm.note} onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })} placeholder="Opcional" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
              </div>
              <div className="flex items-end gap-2">
                <button onClick={handleRegisterPayment} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 font-medium">Confirmar</button>
                <button onClick={() => setShowPaymentForm(false)} className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80">Cancelar</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <p className="text-sm font-medium text-foreground mt-1">{detail.customer?.name || '—'}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Vencimento</p>
            <p className={`text-sm font-medium mt-1 ${isOverdue ? 'text-red-500' : 'text-foreground'}`}>
              {detail.dueDate ? new Date(detail.dueDate).toLocaleDateString('pt-BR') : '—'}
              {isOverdue && <span className="text-xs ml-1">(vencida)</span>}
            </p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold text-foreground mt-1">R$ {detail.total.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Saldo Devedor</p>
            <p className={`text-lg font-semibold mt-1 ${detail.amountDue > 0 ? 'text-red-500' : 'text-green-500'}`}>R$ {detail.amountDue.toFixed(2)}</p>
          </div>
        </div>

        {/* Progress bar for payment */}
        {detail.total > 0 && (
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Progresso do Pagamento</span>
              <span className="text-xs font-medium text-foreground">{Math.round((detail.amountPaid / detail.total) * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (detail.amountPaid / detail.total) * 100)}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-green-500">Pago: R$ {detail.amountPaid.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">Restante: R$ {detail.amountDue.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Items Table */}
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
            <h3 className="text-sm font-medium text-foreground">Itens da Fatura</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Descrição</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qtd</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Preço Unit.</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Desc.</th>
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
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {it.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20">
              <tr><td colSpan={5} className="px-4 py-2 text-right font-medium text-muted-foreground">Total</td><td className="px-4 py-2 text-right font-semibold text-foreground">R$ {detail.total.toFixed(2)}</td></tr>
              <tr><td colSpan={5} className="px-4 py-2 text-right text-muted-foreground">Pago</td><td className="px-4 py-2 text-right text-green-500">R$ {detail.amountPaid.toFixed(2)}</td></tr>
              <tr><td colSpan={5} className="px-4 py-2 text-right font-medium text-muted-foreground">A pagar</td><td className="px-4 py-2 text-right font-semibold text-red-500">R$ {detail.amountDue.toFixed(2)}</td></tr>
            </tfoot>
          </table>
        </div>

        {/* Notes & Terms */}
        {((detail as any).notes || (detail as any).terms) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(detail as any).notes && (
              <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Notas</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{(detail as any).notes}</p>
              </div>
            )}
            {(detail as any).terms && (
              <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><FileCheck className="h-4 w-4 text-muted-foreground" /> Termos e Condições</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{(detail as any).terms}</p>
              </div>
            )}
          </div>
        )}

        {/* Payments */}
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <h3 className="text-foreground font-medium mb-4 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Pagamentos ({(detail.payments || []).length})</h3>
          {(detail.payments || []).length === 0 && <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>}
          <div className="space-y-2">
            {(detail.payments || []).map(pay => (
              <div key={pay.id} className="flex items-center justify-between bg-muted/20 rounded-lg px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-foreground">R$ {pay.amount.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground ml-2">{pay.method === 'PIX' ? 'PIX' : pay.method === 'CREDIT_CARD' ? 'Cartão de Crédito' : pay.method === 'TRANSFER' ? 'Transferência' : pay.method === 'BOLETO' ? 'Boleto' : pay.method === 'CASH' ? 'Dinheiro' : pay.method}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pay.status === 'CONFIRMED' ? 'bg-green-500/10 text-green-500' : pay.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500'}`}>
                    {pay.status === 'CONFIRMED' ? 'Confirmado' : pay.status === 'PENDING' ? 'Pendente' : pay.status === 'REFUNDED' ? 'Estornado' : pay.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{pay.paidAt ? new Date(pay.paidAt).toLocaleDateString('pt-BR') : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  const totalValue = invoices.reduce((s, inv) => s + inv.total, 0)
  const totalPaid = invoices.reduce((s, inv) => s + inv.amountPaid, 0)
  const totalDue = invoices.reduce((s, inv) => s + inv.amountDue, 0)
  const overdueCount = invoices.filter(inv => inv.dueDate && new Date(inv.dueDate) < new Date() && !['PAID', 'CANCELLED'].includes(inv.status)).length

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Receipt className="h-5 w-5 text-primary" /></div>
            Faturas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie faturas e acompanhe pagamentos.</p>
        </div>
        {can('invoices:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> Nova Fatura
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
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Total Faturado</p>
            <p className="text-xl font-semibold text-foreground mt-1">R$ {totalValue.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> Total Recebido</p>
            <p className="text-xl font-semibold text-green-500 mt-1">R$ {totalPaid.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" /> A Receber</p>
            <p className="text-xl font-semibold text-yellow-500 mt-1">R$ {totalDue.toFixed(2)}</p>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" /> Vencidas</p>
            <p className="text-2xl font-semibold text-red-500 mt-1">{overdueCount}</p>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Fatura' : 'Nova Fatura'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Cliente</label>
                <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40">
                  <option value="">Selecionar cliente...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.billingName || c.organization?.name || c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Vencimento</label>
                <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div className="flex items-center gap-2.5 pt-6">
                <input type="checkbox" checked={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                <label className="text-sm text-foreground">Recorrente</label>
              </div>
              {form.recurring && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Ciclo</label>
                  <select value={form.recurringCycle} onChange={e => setForm({ ...form, recurringCycle: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="WEEKLY">Semanal</option>
                    <option value="MONTHLY">Mensal</option>
                    <option value="QUARTERLY">Trimestral</option>
                    <option value="SEMI_ANNUAL">Semestral</option>
                    <option value="ANNUAL">Anual</option>
                  </select>
                </div>
              )}
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
                      <label className="text-xs text-muted-foreground">Catálogo</label>
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
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Fatura'}</button>
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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pago</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vencimento</th>
              {can('invoices:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {invoices.map(inv => {
              const st = STATUS_MAP[inv.status] || STATUS_MAP.DRAFT
              const isOverdue = inv.dueDate && new Date(inv.dueDate) < new Date() && !['PAID', 'CANCELLED'].includes(inv.status)
              return (
                <tr key={inv.id} className={`hover:bg-muted/20 transition-colors cursor-pointer ${isOverdue ? 'bg-red-500/3' : ''}`} onClick={() => viewDetail(inv.id)}>
                  <td className="px-4 py-3 text-foreground font-medium">{inv.number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.customer?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                    {isOverdue && inv.status !== 'OVERDUE' && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-500">Vencida</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-green-500">R$ {inv.amountPaid.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '—'}</td>
                  {can('invoices:manage') && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => viewDetail(inv.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(inv)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(inv.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {invoices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Receipt className="h-10 w-10 text-muted-foreground/50" /></div>
            <h3 className="text-foreground font-medium mb-1">Nenhuma fatura</h3>
            <p className="text-muted-foreground text-sm">Crie sua primeira fatura.</p>
          </div>
        )}
      </div>
    </div>
  )
}
