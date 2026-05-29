import { useState, useEffect } from 'react'
import { Users as UsersIcon, Plus, Trash2, Edit2, X, Shield, Check } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuthStore } from '@/stores/auth.store'

interface UserItem {
  id: string
  name: string
  email: string
  role: string
  roleId: string
  roleName: string
  isActive: boolean
  teams: { id: string; name: string }[]
  createdAt: string
}

interface RoleOption {
  id: string
  name: string
  slug: string
  type: string
}

export function UsersPage() {
  const toast = useToast()
  const { can } = usePermissions()
  const currentUser = useAuthStore().user
  const [users, setUsers] = useState<UserItem[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '', isActive: true })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
      ])
      setUsers(usersRes.data)
      setRoles(rolesRes.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function resetForm() {
    setForm({ name: '', email: '', password: '', roleId: '', isActive: true })
    setEditingUser(null)
    setShowForm(false)
  }

  function startEdit(user: UserItem) {
    setEditingUser(user)
    setForm({ name: user.name, email: user.email, password: '', roleId: user.roleId, isActive: user.isActive })
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingUser) {
        const payload: any = { name: form.name, email: form.email, roleId: form.roleId, isActive: form.isActive }
        if (form.password) payload.password = form.password
        await api.put(`/users/${editingUser.id}`, payload)
        toast.success('Usuário atualizado')
      } else {
        if (!form.password) return toast.error('Senha é obrigatória para novo usuário')
        await api.post('/users', {
          name: form.name,
          email: form.email,
          password: form.password,
          roleId: form.roleId || undefined,
        })
        toast.success('Usuário criado')
      }
      resetForm()
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao salvar usuário')
    }
  }

  async function handleDelete(user: UserItem) {
    if (user.id === currentUser?.id) return toast.error('Você não pode excluir a si mesmo')
    if (!await toast.confirm({ title: 'Excluir usuário', message: `Excluir "${user.name}"? Esta ação não pode ser desfeita.`, danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/users/${user.id}`)
      toast.success('Usuário excluído')
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao excluir')
    }
  }

  async function toggleActive(user: UserItem) {
    try {
      await api.put(`/users/${user.id}`, { isActive: !user.isActive })
      toast.success(user.isActive ? 'Usuário desativado' : 'Usuário ativado')
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao atualizar')
    }
  }

  const canManage = can('users:manage')

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><UsersIcon className="h-5 w-5 text-primary" /></div>
            Usuários
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie os usuários e suas funções de acesso.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Novo Usuário
          </button>
        )}
      </div>

      {/* ── Form ── */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h2>
            <button onClick={resetForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Nome completo" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder="email@exemplo.com" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{editingUser ? 'Nova Senha (deixe vazio para manter)' : 'Senha'}</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required={!editingUser} minLength={6} placeholder="Mín. 6 caracteres" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Função</label>
                <select value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  <option value="">Padrão (Atendente)</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.slug})</option>
                  ))}
                </select>
              </div>
            </div>
            {editingUser && (
              <label className="flex items-center gap-2.5 text-sm text-foreground">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                Usuário ativo
              </label>
            )}
            <div className="pt-2 flex gap-3">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingUser ? 'Salvar' : 'Criar'}</button>
              <button type="button" onClick={resetForm} className="px-5 py-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 text-sm font-medium">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tabela de Usuários ── */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Usuário</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Função</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Times</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                {canManage && <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <div>
                      <span className="text-sm font-medium text-foreground">{user.name}</span>
                      {user.id === currentUser?.id && <span className="ml-1.5 text-[10px] text-primary font-medium">(você)</span>}
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                      <Shield className="h-3 w-3" />
                      {user.roleName}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {user.teams?.length > 0 ? user.teams.map(t => (
                        <span key={t.id} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">{t.name}</span>
                      )) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {canManage && user.id !== currentUser?.id ? (
                      <button onClick={() => toggleActive(user)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${user.isActive ? 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'}`}>
                        <Check className="h-3 w-3" />
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </button>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${user.isActive ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}`}>
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => startEdit(user)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                        {user.id !== currentUser?.id && (
                          <button onClick={() => handleDelete(user)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {users.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><UsersIcon className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhum usuário cadastrado</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Adicione usuários para sua equipe.</p>
        </div>
      )}
    </div>
  )
}
