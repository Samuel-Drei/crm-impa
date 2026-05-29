import { useState, useEffect } from 'react'
import { Plus, Search, Building2, User, Users, X, Trash2, Mail, Phone, Edit2, UserPlus } from 'lucide-react'
import { customerAccountService } from '@/services/commercial'
import api from '@/services/api'
import { usePermissions } from '@/hooks/usePermissions'
import { useToast } from '@/components/ui/Toast'
import { CustomerDetail } from '@/pages/CustomerDetail'

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  CHURNED: 'Cancelado',
}
const statusColors: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600',
  INACTIVE: 'bg-gray-500/10 text-gray-500',
  SUSPENDED: 'bg-amber-500/10 text-amber-600',
  CHURNED: 'bg-red-500/10 text-red-600',
}
const typeLabels: Record<string, string> = {
  INDIVIDUAL: 'Pessoa Física',
  COMPANY: 'Empresa',
  GOVERNMENT: 'Governo',
}
const roleLabels: Record<string, string> = {
  ADMIN: 'Administrador',
  BILLING: 'Faturamento',
  TECHNICAL: 'Técnico',
  MEMBER: 'Membro',
}

export function Customers() {
  const toast = useToast()
  const { can } = usePermissions()
  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [organizations, setOrganizations] = useState<any[]>([])
  const [form, setForm] = useState({
    organizationId: '',
    accountType: 'INDIVIDUAL',
    billingName: '',
    billingEmail: '',
    taxId: '',
    creditLimit: '',
    paymentTermDays: '30',
    notes: '',
    contactIds: [] as string[],
  })

  const load = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      const data = await customerAccountService.list(params)
      setAccounts(data.accounts)
    } catch { toast.error('Erro ao carregar contas') }
    setLoading(false)
  }

  const loadContacts = async () => {
    try {
      const res = await api.get('/contacts', { params: { limit: 500 } })
      setContacts(res.data.contacts || [])
    } catch {}
  }
  const loadOrgs = async () => {
    try {
      const res = await api.get('/contacts/organizations', { params: { limit: 500 } })
      setOrganizations(res.data.organizations || [])
    } catch {}
  }

  useEffect(() => { load() }, [search, statusFilter])
  useEffect(() => { loadContacts(); loadOrgs() }, [])

  const openNew = () => {
    setEditing(null)
    setForm({ organizationId: '', accountType: 'INDIVIDUAL', billingName: '', billingEmail: '', taxId: '', creditLimit: '', paymentTermDays: '30', notes: '', contactIds: [] })
    setShowForm(true)
  }

  const openEdit = (acc: any) => {
    setEditing(acc)
    setForm({
      organizationId: acc.organizationId || '',
      accountType: acc.accountType,
      billingName: acc.billingName || '',
      billingEmail: acc.billingEmail || '',
      taxId: acc.taxId || '',
      creditLimit: acc.creditLimit ? String(acc.creditLimit) : '',
      paymentTermDays: String(acc.paymentTermDays || 30),
      notes: acc.notes || '',
      contactIds: acc.members?.map((m: any) => m.contactId) || [],
    })
    setShowForm(true)
  }

  const save = async () => {
    try {
      const payload: any = {
        ...form,
        organizationId: form.organizationId || null,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
        paymentTermDays: Number(form.paymentTermDays),
      }
      if (editing) {
        await customerAccountService.update(editing.id, payload)
        toast.success('Conta atualizada')
      } else {
        await customerAccountService.create(payload)
        toast.success('Conta criada')
      }
      setShowForm(false)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    }
  }

  const remove = async (id: string) => {
    if (!await toast.confirm({ title: 'Excluir conta', message: 'Excluir esta conta de cliente permanentemente?', danger: true, confirmText: 'Excluir' })) return
    try {
      await customerAccountService.delete(id)
      toast.success('Conta excluída')
      load()
    } catch { toast.error('Erro ao excluir') }
  }

  if (detailId) {
    return (
      <CustomerDetail
        accountId={detailId}
        onBack={() => setDetailId(null)}
        onEdit={(acc) => { openEdit(acc); setDetailId(null) }}
        onDeleted={() => { setDetailId(null); load() }}
      />
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-muted-foreground text-sm">Gerencie suas contas de clientes</p>
        </div>
        {can('customers:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">
            <Plus className="h-4 w-4" /> Nova Conta
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contas..." className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">Todos os status</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Nenhuma conta encontrada</p>
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/40">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contatos</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Total Gasto</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {accounts.map((acc: any) => (
                <tr key={acc.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailId(acc.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {acc.accountType === 'COMPANY' ? <Building2 className="h-4 w-4 text-muted-foreground" /> : <User className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">{acc.billingName || 'Sem nome'}</span>
                    </div>
                    {acc.billingEmail && <p className="text-xs text-muted-foreground mt-0.5">{acc.billingEmail}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{typeLabels[acc.accountType]}</td>
                  <td className="px-4 py-3 text-muted-foreground">{acc.members?.length || 0}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[acc.status]}`}>{statusLabels[acc.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">R$ {Number(acc.totalSpent || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    {can('customers:manage') && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(acc)} className="p-1.5 text-muted-foreground hover:text-primary rounded"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => remove(acc.id)} className="p-1.5 text-muted-foreground hover:text-red-500 rounded"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border/40">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Conta' : 'Nova Conta'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo de Conta</label>
                <select value={form.accountType} onChange={e => setForm(f => ({...f, accountType: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nome de Faturamento *</label>
                <input value={form.billingName} onChange={e => setForm(f => ({...f, billingName: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email de Faturamento</label>
                <input type="email" value={form.billingEmail} onChange={e => setForm(f => ({...f, billingEmail: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">CPF/CNPJ</label>
                  <input value={form.taxId} onChange={e => setForm(f => ({...f, taxId: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Limite de Crédito</label>
                  <input type="number" value={form.creditLimit} onChange={e => setForm(f => ({...f, creditLimit: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Prazo de Pagamento (dias)</label>
                <input type="number" value={form.paymentTermDays} onChange={e => setForm(f => ({...f, paymentTermDays: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Organização</label>
                <select value={form.organizationId} onChange={e => setForm(f => ({...f, organizationId: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Nenhuma</option>
                  {organizations.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Observações</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-border/40">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
              <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
