import { useState, useEffect } from 'react'
import { CreditCard, Plus, RefreshCw, X, Settings, DollarSign } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { paymentService, gatewayService, asaasService, invoiceService } from '@/services/commercial'
import type { Payment, PaymentGatewayConfig, Invoice } from '@/types'

type Tab = 'payments' | 'gateways'

const METHOD_LABELS: Record<string, string> = { PIX: 'PIX', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão Crédito', DEBIT_CARD: 'Cartão Débito', TRANSFER: 'Transferência', CASH: 'Dinheiro', OTHER: 'Outro' }
const STATUS_COLORS: Record<string, string> = { PENDING: 'bg-yellow-500/10 text-yellow-500', CONFIRMED: 'bg-green-500/10 text-green-500', FAILED: 'bg-red-500/10 text-red-500', REFUNDED: 'bg-purple-500/10 text-purple-500', CANCELLED: 'bg-gray-500/10 text-gray-400' }

export function Payments() {
  const toast = useToast()
  const { can } = usePermissions()
  const [tab, setTab] = useState<Tab>('payments')
  const [payments, setPayments] = useState<Payment[]>([])
  const [gateways, setGateways] = useState<PaymentGatewayConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [invoices, setInvoices] = useState<Invoice[]>([])

  const emptyPayForm = { invoiceId: '', amount: 0, method: 'PIX' as const, notes: '' }
  const emptyGwForm = { provider: 'ASAAS' as string, name: '', active: true, isDefault: false, credentials: {} as Record<string, string> }
  const [payForm, setPayForm] = useState(emptyPayForm)
  const [gwForm, setGwForm] = useState(emptyGwForm)
  const [editingGw, setEditingGw] = useState<PaymentGatewayConfig | null>(null)

  useEffect(() => { load() }, [tab])

  async function load() {
    setLoading(true)
    try {
      if (tab === 'payments') {
        const res = await paymentService.list()
        setPayments(res.payments)
      } else {
        const gw = await gatewayService.list()
        setGateways(gw)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadInvoices() {
    try { const res = await invoiceService.list({ limit: 50 }); setInvoices(res.invoices) } catch (e) { console.error(e) }
  }

  // ── Payment ──
  async function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await paymentService.create({ ...payForm, amount: Number(payForm.amount) })
      setShowForm(false); setPayForm(emptyPayForm); load()
      toast.success('Pagamento registrado!')
    } catch (e) { console.error(e) }
  }

  async function handleRefund(id: string) {
    if (!await toast.confirm({ title: 'Estornar pagamento', message: 'Tem certeza?', danger: true, confirmText: 'Estornar' })) return
    try { await paymentService.refund(id); load(); toast.success('Pagamento estornado') } catch (e) { console.error(e) }
  }

  // ── Gateway ──
  async function handleGwSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingGw) { await gatewayService.update(editingGw.id, gwForm) }
      else { await gatewayService.create(gwForm) }
      setShowForm(false); setEditingGw(null); setGwForm(emptyGwForm); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteGw(id: string) {
    if (!await toast.confirm({ title: 'Excluir gateway', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await gatewayService.delete(id); load() } catch (e) { console.error(e) }
  }

  function openNewPayment() { setShowForm(true); loadInvoices() }
  function startEditGw(gw: PaymentGatewayConfig) {
    setEditingGw(gw)
    setGwForm({ provider: gw.provider as any, name: gw.name, active: gw.active, isDefault: gw.isDefault, credentials: { ...gw.credentials } })
    setShowForm(true)
  }

  if (loading && payments.length === 0 && gateways.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><CreditCard className="h-5 w-5 text-primary" /></div>
            Pagamentos
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Pagamentos recebidos e configuração de gateways.</p>
        </div>
        {can('payments:manage') && (
          <button onClick={() => { tab === 'payments' ? openNewPayment() : (() => { setShowForm(true); setEditingGw(null); setGwForm(emptyGwForm) })() }} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> {tab === 'payments' ? 'Registrar Pagamento' : 'Novo Gateway'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        <button onClick={() => { setTab('payments'); setShowForm(false) }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'payments' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <DollarSign className="h-4 w-4" /> Pagamentos
        </button>
        <button onClick={() => { setTab('gateways'); setShowForm(false) }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'gateways' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <Settings className="h-4 w-4" /> Gateways
        </button>
      </div>

      {/* Payment Form */}
      {showForm && tab === 'payments' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">Registrar Pagamento</h2>
            <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handlePaySubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Fatura *</label>
              <select value={payForm.invoiceId} onChange={e => setPayForm({ ...payForm, invoiceId: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                <option value="">Selecione...</option>
                {invoices.filter(i => i.amountDue > 0).map(i => <option key={i.id} value={i.id}>{i.number} — R$ {i.amountDue.toFixed(2)} pendente</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Valor *</label>
              <input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: Number(e.target.value) })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Método *</label>
              <select value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value as any })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Observações</label>
              <input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div className="md:col-span-2 pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">Registrar Pagamento</button>
            </div>
          </form>
        </div>
      )}

      {/* Gateway Form */}
      {showForm && tab === 'gateways' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingGw ? 'Editar Gateway' : 'Novo Gateway'}</h2>
            <button onClick={() => { setShowForm(false); setEditingGw(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleGwSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Provider *</label>
                <select value={gwForm.provider} onChange={e => setGwForm({ ...gwForm, provider: e.target.value as any })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="ASAAS">Asaas</option>
                  <option value="STRIPE">Stripe</option>
                  <option value="MERCADOPAGO">Mercado Pago</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                <input value={gwForm.name} onChange={e => setGwForm({ ...gwForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            {gwForm.provider !== 'MANUAL' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">API Key</label>
                <input value={gwForm.credentials.apiKey || ''} onChange={e => setGwForm({ ...gwForm, credentials: { ...gwForm.credentials, apiKey: e.target.value } })} placeholder="Chave da API" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <input type="checkbox" checked={gwForm.active} onChange={e => setGwForm({ ...gwForm, active: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                <label className="text-sm text-foreground">Ativo</label>
              </div>
              <div className="flex items-center gap-2.5">
                <input type="checkbox" checked={gwForm.isDefault} onChange={e => setGwForm({ ...gwForm, isDefault: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                <label className="text-sm text-foreground">Padrão</label>
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingGw ? 'Salvar' : 'Criar Gateway'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Payments Table */}
      {tab === 'payments' && (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fatura</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Método</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                {can('payments:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {payments.map(pay => (
                <tr key={pay.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-foreground font-medium">{pay.invoice?.number || pay.invoiceId}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {pay.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{METHOD_LABELS[pay.method] || pay.method}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[pay.status] || ''}`}>{pay.status}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{pay.paidAt ? new Date(pay.paidAt).toLocaleDateString('pt-BR') : new Date(pay.createdAt).toLocaleDateString('pt-BR')}</td>
                  {can('payments:manage') && (
                    <td className="px-4 py-3 text-right">
                      {pay.status === 'CONFIRMED' && (
                        <button onClick={() => handleRefund(pay.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-orange-500 hover:bg-orange-500/8" title="Estornar"><RefreshCw className="h-3.5 w-3.5" /></button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {payments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><CreditCard className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhum pagamento</h3>
              <p className="text-muted-foreground text-sm">Os pagamentos aparecerão aqui.</p>
            </div>
          )}
        </div>
      )}

      {/* Gateways list */}
      {tab === 'gateways' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {gateways.map(gw => (
            <div key={gw.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">{gw.name}</span>
                    {gw.isDefault && <span className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary">Padrão</span>}
                  </div>
                  <p className="text-muted-foreground text-xs mt-1">{gw.provider}</p>
                  <span className={`mt-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${gw.active ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>{gw.active ? 'Ativo' : 'Inativo'}</span>
                </div>
                {can('payments:manage') && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEditGw(gw)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Settings className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDeleteGw(gw.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {gateways.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Settings className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhum gateway configurado</h3>
              <p className="text-muted-foreground text-sm">Configure gateways de pagamento.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
