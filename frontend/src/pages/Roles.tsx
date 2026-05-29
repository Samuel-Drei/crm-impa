import { useState, useEffect, useMemo } from 'react'
import { Shield, Plus, Trash2, Edit2, X, Check, Users } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'

interface Permission {
  id: string
  slug: string
  module: string
  action: string
  description: string
}

interface Role {
  id: string
  name: string
  slug: string
  description: string | null
  type: 'SYSTEM' | 'CUSTOM'
  defaultScope: string
  conversationScope: string
  canReplyConversations: boolean
  isDefault: boolean
  permissions: Permission[]
  userCount: number
}

export function Roles() {
  const toast = useToast()
  const { can } = usePermissions()
  const [roles, setRoles] = useState<Role[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    defaultScope: 'OWN' as string,
    conversationScope: 'OWN' as string,
    canReplyConversations: true,
    isDefault: false,
    permissionIds: [] as string[],
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [rolesRes, permsRes] = await Promise.allSettled([
        api.get('/roles'),
        api.get('/roles/permissions'),
      ])
      if (rolesRes.status === 'fulfilled') setRoles(rolesRes.value.data)
      else console.error('Erro ao carregar roles:', rolesRes.reason)
      if (permsRes.status === 'fulfilled') setAllPermissions(permsRes.value.data)
      else console.error('Erro ao carregar permissões:', permsRes.reason)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // Agrupar permissões por módulo
  const permissionsByModule = useMemo(() => {
    const grouped: Record<string, Permission[]> = {}
    for (const p of allPermissions) {
      if (!grouped[p.module]) grouped[p.module] = []
      grouped[p.module].push(p)
    }
    return grouped
  }, [allPermissions])

  function resetForm() {
    setForm({ name: '', slug: '', description: '', defaultScope: 'OWN', conversationScope: 'OWN', canReplyConversations: true, isDefault: false, permissionIds: [] })
    setEditingRole(null)
    setShowForm(false)
  }

  function startEdit(role: Role) {
    setEditingRole(role)
    setForm({
      name: role.name,
      slug: role.slug,
      description: role.description || '',
      defaultScope: role.defaultScope,
      conversationScope: role.conversationScope,
      canReplyConversations: role.canReplyConversations,
      isDefault: role.isDefault,
      permissionIds: role.permissions.map(p => p.id),
    })
    setShowForm(true)
  }

  function togglePermission(id: string) {
    setForm(f => ({
      ...f,
      permissionIds: f.permissionIds.includes(id)
        ? f.permissionIds.filter(pid => pid !== id)
        : [...f.permissionIds, id],
    }))
  }

  function toggleModule(module: string) {
    const modulePermIds = permissionsByModule[module]?.map(p => p.id) || []
    const allSelected = modulePermIds.every(id => form.permissionIds.includes(id))
    setForm(f => ({
      ...f,
      permissionIds: allSelected
        ? f.permissionIds.filter(id => !modulePermIds.includes(id))
        : [...new Set([...f.permissionIds, ...modulePermIds])],
    }))
  }

  function selectAllPermissions() {
    setForm(f => ({ ...f, permissionIds: allPermissions.map(p => p.id) }))
  }

  function clearAllPermissions() {
    setForm(f => ({ ...f, permissionIds: [] }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingRole) {
        await api.put(`/roles/${editingRole.id}`, {
          name: form.name,
          description: form.description || undefined,
          defaultScope: form.defaultScope,
          conversationScope: form.conversationScope,
          canReplyConversations: form.canReplyConversations,
          isDefault: form.isDefault,
          permissionIds: form.permissionIds,
        })
        toast.success('Função atualizada')
      } else {
        await api.post('/roles', form)
        toast.success('Função criada')
      }
      resetForm()
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao salvar função')
    }
  }

  async function handleDelete(role: Role) {
    if (role.type === 'SYSTEM') return toast.error('Não é possível excluir funções do sistema')
    if (role.userCount > 0) return toast.error('Não é possível excluir função com usuários vinculados')
    if (!await toast.confirm({ title: 'Excluir função', message: `Excluir "${role.name}"?`, danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/roles/${role.id}`)
      toast.success('Função excluída')
      loadData()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao excluir')
    }
  }

  const canManage = can('roles:manage')

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Shield className="h-5 w-5 text-primary" /></div>
            Funções e Permissões
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie as funções e suas permissões de acesso.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowForm(true); setEditingRole(null); setForm({ name: '', slug: '', description: '', defaultScope: 'OWN', conversationScope: 'OWN', canReplyConversations: true, isDefault: false, permissionIds: [] }) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Nova Função
          </button>
        )}
      </div>

      {/* ── Form ── */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingRole ? 'Editar Função' : 'Nova Função'}</h2>
            <button onClick={resetForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Supervisor" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Slug</label>
                <input
                  value={form.slug}
                  onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  required
                  disabled={!!editingRole}
                  placeholder="ex: supervisor"
                  className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all disabled:opacity-50"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição da função" className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Escopo Padrão</label>
                <select value={form.defaultScope} onChange={e => setForm({ ...form, defaultScope: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  <option value="OWN">Próprio + Pool</option>
                  <option value="OWN_ONLY">Apenas Próprio</option>
                  <option value="TEAM">Time</option>
                  <option value="COMPANY">Empresa</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Escopo Conversas</label>
                <select value={form.conversationScope} onChange={e => setForm({ ...form, conversationScope: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all">
                  <option value="OWN">Próprias + Não atribuídas</option>
                  <option value="OWN_ONLY">Apenas Próprias</option>
                  <option value="TEAM">Do Time</option>
                  <option value="COMPANY">Toda Empresa</option>
                </select>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2.5 text-sm text-foreground">
                  <input type="checkbox" checked={form.canReplyConversations} onChange={e => setForm({ ...form, canReplyConversations: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                  Pode responder conversas
                </label>
                <label className="flex items-center gap-2.5 text-sm text-foreground">
                  <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                  Função padrão p/ novos usuários
                </label>
              </div>
            </div>

            {/* ── Matriz de Permissões ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-foreground">Permissões ({form.permissionIds.length}/{allPermissions.length})</label>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAllPermissions} className="text-xs text-primary hover:underline">Selecionar tudo</button>
                  <span className="text-muted-foreground">|</span>
                  <button type="button" onClick={clearAllPermissions} className="text-xs text-muted-foreground hover:underline">Limpar</button>
                </div>
              </div>
              <div className="border border-border/60 rounded-xl overflow-hidden divide-y divide-border/40">
                {Object.entries(permissionsByModule).map(([module, perms]) => {
                  const allChecked = perms.every(p => form.permissionIds.includes(p.id))
                  const someChecked = perms.some(p => form.permissionIds.includes(p.id))
                  return (
                    <div key={module} className="bg-card">
                      <button
                        type="button"
                        onClick={() => toggleModule(module)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${allChecked ? 'bg-primary border-primary' : someChecked ? 'bg-primary/30 border-primary/50' : 'border-border'}`}>
                          {(allChecked || someChecked) && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <span className="text-sm font-medium text-foreground capitalize">{module}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {perms.filter(p => form.permissionIds.includes(p.id)).length}/{perms.length}
                        </span>
                      </button>
                      <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {perms.map(p => (
                          <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              checked={form.permissionIds.includes(p.id)}
                              onChange={() => togglePermission(p.id)}
                              className="rounded border-border text-primary focus:ring-primary/30 h-3.5 w-3.5"
                            />
                            <div>
                              <span className="text-xs font-medium text-foreground">{p.action}</span>
                              {p.description && <p className="text-[10px] text-muted-foreground leading-tight">{p.description}</p>}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingRole ? 'Salvar' : 'Criar'}</button>
              <button type="button" onClick={resetForm} className="px-5 py-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 text-sm font-medium">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista de Roles ── */}
      <div className="space-y-3">
        {roles.map(role => (
          <div key={role.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-foreground font-medium">{role.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${role.type === 'SYSTEM' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'}`}>
                    {role.type === 'SYSTEM' ? 'Sistema' : 'Custom'}
                  </span>
                  {role.isDefault && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">Padrão</span>
                  )}
                </div>
                {role.description && <p className="text-muted-foreground text-sm mb-2">{role.description}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {role.userCount} usuário{role.userCount !== 1 ? 's' : ''}</span>
                  <span>{role.permissions.length} permissões</span>
                  <span>Escopo: {{ OWN: 'Próprio + Pool', OWN_ONLY: 'Apenas Próprio', TEAM: 'Time', COMPANY: 'Empresa' }[role.conversationScope] || role.conversationScope}</span>
                  <span>{role.canReplyConversations ? '✓ Pode responder' : '✗ Sem resposta'}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(role)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                  {role.type !== 'SYSTEM' && (
                    <button onClick={() => handleDelete(role)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {roles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Shield className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhuma função cadastrada</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Execute o seed para criar as funções padrão.</p>
        </div>
      )}
    </div>
  )
}
