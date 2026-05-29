import { useState, useEffect } from 'react'
import { Plus, Search, FileX, X, Ban, ArrowRight } from 'lucide-react'
import { creditNoteService, invoiceService } from '@/services/commercial'
import { usePermissions } from '@/hooks/usePermissions'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'

const statusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  APPLIED: 'Aplicada',
  VOID: 'Anulada',
}
const statusColors: Record<string, string> = {
  OPEN: 'bg-blue-500/10 text-blue-600',
  APPLIED: 'bg-emerald-500/10 text-emerald-600',
  VOID: 'bg-red-500/10 text-red-600',
}

export function CreditNotes() {
  const toast = useToast()
  const { can } = usePermissions()
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showApply, setShowApply] = useState<any>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [form, setForm] = useState({ contactId: '', invoiceId: '', amount: '', reason: '', note: '' })
  const [applyForm, setApplyForm] = useState({ invoiceId: '', amount: '' })

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (statusFilter) params.status = statusFilter
      const data = await creditNoteService.list(params)
      setNotes(data.creditNotes)
    } catch { toast.error('Erro ao carregar notas de crédito') }
    setLoading(false)
  }

  const loadContacts = async () => {
    try {
      const res = await api.get('/contacts', { params: { limit: 500 } })
      setContacts(res.data.contacts || [])
    } catch {}
  }

  const loadInvoices = async () => {
    try {
      const data = await invoiceService.list({ limit: 200 })
      setInvoices(data.invoices)
    } catch {}
  }

  useEffect(() => { load() }, [statusFilter])
  useEffect(() => { loadContacts(); loadInvoices() }, [])

  const openNew = () => {
    setForm({ contactId: '', invoiceId: '', amount: '', reason: '', note: '' })
    setShowForm(true)
  }

  const save = async () => {
    try {
      const payload = {
        contactId: form.contactId,
        invoiceId: form.invoiceId || null,
        amount: Number(form.amount),
        reason: form.reason || undefined,
        note: form.note || undefined,
      }
      await creditNoteService.create(payload)
      toast.success('Nota de crédito criada')
      setShowForm(false)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao criar')
    }
  }

  const applyCredit = async () => {
    if (!showApply) return
    try {
      await creditNoteService.apply(showApply.id, {
        invoiceId: applyForm.invoiceId,
        amount: Number(applyForm.amount),
      })
      toast.success('Crédito aplicado à fatura')
      setShowApply(null)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao aplicar')
    }
  }

  const voidNote = async (id: string) => {
    if (!confirm('Anular esta nota de crédito?')) return
    try {
      await creditNoteService.void(id)
      toast.success('Nota anulada')
      load()
    } catch (err: any) { toast.error(err.response?.data?.error || 'Erro ao anular') }
  }

  const openApplyModal = (note: any) => {
    setShowApply(note)
    setApplyForm({ invoiceId: '', amount: String(Number(note.amountRemaining)) })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notas de Crédito</h1>
          <p className="text-muted-foreground text-sm">Gerencie créditos e estornos para clientes</p>
        </div>
        {can('invoices:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">
            <Plus className="h-4 w-4" /> Nova Nota de Crédito
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">Todos os status</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : notes.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <FileX className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Nenhuma nota de crédito encontrada</p>
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/40">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usado</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Restante</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fatura Ref.</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Motivo</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {notes.map((note: any) => (
                <tr key={note.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">NC-{note.number}</td>
                  <td className="px-4 py-3 font-medium">R$ {Number(note.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">R$ {Number(note.amountUsed).toFixed(2)}</td>
                  <td className="px-4 py-3 font-medium text-primary">R$ {Number(note.amountRemaining).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[note.status]}`}>{statusLabels[note.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{note.invoice ? `${note.invoice.prefix || ''}${note.invoice.number}` : '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{note.reason || '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(note.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3 text-right">
                    {can('invoices:manage') && note.status === 'OPEN' && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openApplyModal(note)} className="p-1.5 text-muted-foreground hover:text-primary rounded" title="Aplicar a fatura">
                          <ArrowRight className="h-4 w-4" />
                        </button>
                        <button onClick={() => voidNote(note.id)} className="p-1.5 text-muted-foreground hover:text-red-500 rounded" title="Anular">
                          <Ban className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal criar nota de crédito */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-border/40">
              <h2 className="text-lg font-semibold">Nova Nota de Crédito</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Contato *</label>
                <select value={form.contactId} onChange={e => setForm(f => ({...f, contactId: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Selecionar...</option>
                  {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Valor *</label>
                <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Fatura de referência</label>
                <select value={form.invoiceId} onChange={e => setForm(f => ({...f, invoiceId: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Nenhuma</option>
                  {invoices.map((i: any) => <option key={i.id} value={i.id}>{i.prefix || ''}{i.number} - R$ {Number(i.total).toFixed(2)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Motivo</label>
                <input value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Observação</label>
                <textarea value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-border/40">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={save} disabled={!form.contactId || !form.amount} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">Criar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aplicar crédito */}
      {showApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-border/40">
              <h2 className="text-lg font-semibold">Aplicar Crédito NC-{showApply.number}</h2>
              <button onClick={() => setShowApply(null)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">Saldo disponível: <span className="font-medium text-foreground">R$ {Number(showApply.amountRemaining).toFixed(2)}</span></p>
              <div>
                <label className="block text-sm font-medium mb-1">Fatura *</label>
                <select value={applyForm.invoiceId} onChange={e => setApplyForm(f => ({...f, invoiceId: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Selecionar fatura...</option>
                  {invoices.filter(i => ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(i.status)).map((i: any) => (
                    <option key={i.id} value={i.id}>{i.prefix || ''}{i.number} — Deve: R$ {Number(i.amountDue).toFixed(2)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Valor a aplicar *</label>
                <input type="number" step="0.01" value={applyForm.amount} onChange={e => setApplyForm(f => ({...f, amount: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-border/40">
              <button onClick={() => setShowApply(null)} className="px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={applyCredit} disabled={!applyForm.invoiceId || !applyForm.amount} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
