import { useState, useEffect } from 'react'
import { Users, Plus, Trash2, UserPlus, X, Edit2 } from 'lucide-react'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import type { Team, User } from '@/types'

export function Teams() {
  const toast = useToast()
  const { can } = usePermissions()
  const canManageTeams = can('teams:manage')
  const [teams, setTeams] = useState<Team[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [form, setForm] = useState({ name: '', description: '', allowAutoAssign: true })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [teamsRes, usersRes] = await Promise.all([
        api.get('/teams'),
        api.get('/users'),
      ])
      setTeams(teamsRes.data.teams)
      setUsers(usersRes.data.users || usersRes.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingTeam) {
        await api.put(`/teams/${editingTeam.id}`, form)
      } else {
        await api.post('/teams', form)
      }
      setShowForm(false)
      setEditingTeam(null)
      setForm({ name: '', description: '', allowAutoAssign: true })
      loadData()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir time', message: 'Tem certeza que deseja excluir este time?', danger: true, confirmText: 'Excluir' })) return
    try {
      await api.delete(`/teams/${id}`)
      loadData()
    } catch (e) { console.error(e) }
  }

  async function addMember(teamId: string, userId: string) {
    try {
      await api.post(`/teams/${teamId}/members`, { userId })
      loadData()
    } catch (e) { console.error(e) }
  }

  async function removeMember(teamId: string, userId: string) {
    try {
      await api.delete(`/teams/${teamId}/members/${userId}`)
      loadData()
    } catch (e) { console.error(e) }
  }

  function startEdit(team: Team) {
    setEditingTeam(team)
    setForm({ name: team.name, description: team.description || '', allowAutoAssign: team.allowAutoAssign })
    setShowForm(true)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Users className="h-5 w-5 text-primary" /></div>
            Times
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Organize agentes em equipes para atribuição de conversas.</p>
        </div>
        {canManageTeams && (
          <button
            onClick={() => { setShowForm(true); setEditingTeam(null); setForm({ name: '', description: '', allowAutoAssign: true }) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Novo Time
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingTeam ? 'Editar Time' : 'Novo Time'}</h2>
            <button onClick={() => { setShowForm(false); setEditingTeam(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Nome</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 transition-all" />
            </div>
            <div className="flex items-center gap-2.5">
              <input type="checkbox" checked={form.allowAutoAssign} onChange={e => setForm({ ...form, allowAutoAssign: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
              <label className="text-sm text-foreground">Permitir auto-atribuição</label>
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingTeam ? 'Salvar' : 'Criar'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map(team => (
          <div key={team.id} className="group bg-card border border-border/50 rounded-xl p-5 hover:shadow-md hover:border-border transition-all duration-200">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-foreground font-medium">{team.name}</h3>
                {team.description && <p className="text-muted-foreground text-sm mt-1">{team.description}</p>}
              </div>
              {canManageTeams && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(team)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(team.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Membros ({team.members?.length || 0})</span>
                <div className="relative group/add">
                  <button className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><UserPlus className="h-4 w-4" /></button>
                  <div className="hidden group-hover/add:block absolute right-0 top-full mt-1 bg-popover border border-border rounded-xl shadow-lg z-10 w-48 max-h-48 overflow-y-auto">
                    {users
                      .filter(u => !team.members?.some(m => m.userId === u.id))
                      .map(u => (
                        <button key={u.id} onClick={() => addMember(team.id, u.id)} className="w-full text-left px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 first:rounded-t-xl last:rounded-b-xl transition-colors">
                          {u.name}
                        </button>
                      ))}
                  </div>
                </div>
              </div>

              {team.members?.map(member => (
                <div key={member.id} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                  <span className="text-sm text-foreground/80">{member.user?.name || member.userId}</span>
                  <button onClick={() => removeMember(team.id, member.userId)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
              <span>{team._count?.conversations || 0} conversas</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${team.allowAutoAssign ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {team.allowAutoAssign ? 'Auto-assign ON' : 'Auto-assign OFF'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {teams.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Users className="h-10 w-10 text-muted-foreground/50" /></div>
          <h3 className="text-foreground font-medium mb-1">Nenhum time criado</h3>
          <p className="text-muted-foreground text-sm max-w-xs">Crie times para organizar a atribuição de conversas.</p>
        </div>
      )}
    </div>
  )
}
