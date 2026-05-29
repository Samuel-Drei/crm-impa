import { useState, useEffect } from 'react'
import { CheckSquare, Plus, Trash2, Edit2, X, Clock, GripVertical } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { taskService, projectService } from '@/services/commercial'
import type { ProjectTask, Project } from '@/types'

type ViewMode = 'list' | 'kanban'

const STATUSES = [
  { key: 'NOT_STARTED', label: 'A Fazer', color: 'bg-gray-500' },
  { key: 'IN_PROGRESS', label: 'Em Progresso', color: 'bg-blue-500' },
  { key: 'AWAITING_FEEDBACK', label: 'Aguardando', color: 'bg-yellow-500' },
  { key: 'COMPLETED', label: 'Concluído', color: 'bg-green-500' },
]

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Baixa', color: 'text-gray-500' },
  MEDIUM: { label: 'Média', color: 'text-blue-500' },
  HIGH: { label: 'Alta', color: 'text-orange-500' },
  URGENT: { label: 'Urgente', color: 'text-red-500' },
}

export function Tasks() {
  const toast = useToast()
  const { can } = usePermissions()
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProjectTask | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [projectFilter, setProjectFilter] = useState('')
  const [showTimeForm, setShowTimeForm] = useState<string | null>(null)
  const [timeHours, setTimeHours] = useState('')

  const emptyForm = { name: '', description: '', status: 'NOT_STARTED', priority: 'MEDIUM', projectId: '', dueDate: '', billable: true }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { load(); loadProjects() }, [projectFilter])

  async function load() {
    setLoading(true)
    try {
      const res = await taskService.list({ projectId: projectFilter || undefined, limit: 200 })
      setTasks(res.tasks)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadProjects() {
    try { const res = await projectService.list({ limit: 100 }); setProjects(res.projects) } catch (e) { console.error(e) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...form, dueDate: form.dueDate || undefined }
      if (editing) { await taskService.update(editing.id, data) }
      else { await taskService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir tarefa', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await taskService.delete(id); load() } catch (e) { console.error(e) }
  }

  async function handleStatusChange(taskId: string, newStatus: string) {
    try { await taskService.update(taskId, { status: newStatus }); load() } catch (e) { console.error(e) }
  }

  async function handleAddTime(taskId: string) {
    if (!timeHours) return
    try {
      const minutes = Math.round(Number(timeHours) * 60)
      if (minutes < 1) return
      await taskService.addTime(taskId, { minutes })
      setShowTimeForm(null); setTimeHours(''); load()
      toast.success('Tempo registrado!')
    } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditing(null); setForm(emptyForm) }

  function startEdit(t: ProjectTask) {
    setEditing(t)
    setForm({
      name: t.name, description: t.description || '', status: t.status, priority: t.priority,
      projectId: t.projectId || '', dueDate: t.dueDate ? t.dueDate.split('T')[0] : '',
      billable: t.billable
    })
    setShowForm(true)
  }

  function openNew() { closeForm(); setShowForm(true) }

  if (loading && tasks.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  // Group for kanban
  const grouped = STATUSES.map(s => ({ ...s, tasks: tasks.filter(t => t.status === s.key) }))

  return (
    <div className="p-6 space-y-6 max-w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><CheckSquare className="h-5 w-5 text-primary" /></div>
            Tarefas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie tarefas dos projetos.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
            <button onClick={() => setViewMode('kanban')} className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'kanban' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Kanban</button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-sm ${viewMode === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Lista</button>
          </div>
          {can('tasks:manage') && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
              <Plus className="h-4 w-4" /> Nova Tarefa
            </button>
          )}
        </div>
      </div>

      {/* Project Filter */}
      <div className="flex items-center gap-3">
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
          <option value="">Todos os projetos</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Tarefa' : 'Nova Tarefa'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Projeto *</label>
                <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="">Selecione...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Prioridade</label>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Prazo</label>
                <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>

            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
            </div>
            <div className="flex items-center gap-2.5">
              <input type="checkbox" checked={form.billable} onChange={e => setForm({ ...form, billable: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
              <label className="text-sm text-foreground">Faturável</label>
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Tarefa'}</button>
            </div>
          </form>
        </div>
      )}

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {grouped.map(col => (
            <div key={col.key} className="bg-muted/20 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <span className="text-sm font-medium text-foreground">{col.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">{col.tasks.length}</span>
              </div>
              <div className="space-y-2">
                {col.tasks.map(task => {
                  const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.MEDIUM
                  return (
                    <div key={task.id} className="bg-card border border-border/50 rounded-lg p-3 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-medium text-foreground line-clamp-2">{task.name}</span>
                        {can('tasks:manage') && (
                          <div className="flex gap-0.5 shrink-0 ml-1">
                            <button onClick={() => startEdit(task)} className="p-1 rounded text-muted-foreground hover:text-primary"><Edit2 className="h-3 w-3" /></button>
                            <button onClick={() => handleDelete(task.id)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}
                      </div>
                      {task.project && <p className="text-xs text-muted-foreground mb-2">{task.project.name}</p>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium ${pr.color}`}>{pr.label}</span>
                        {task.dueDate && <span className="text-xs text-muted-foreground">{new Date(task.dueDate).toLocaleDateString('pt-BR')}</span>}
                        {(task.timeTracked || 0) > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" />{Math.floor((task.timeTracked || 0) / 60)}h{(task.timeTracked || 0) % 60 > 0 ? `${(task.timeTracked || 0) % 60}m` : ''}</span>
                        )}
                      </div>
                      {/* Quick time log */}
                      {can('tasks:manage') && (
                        <>
                          {showTimeForm === task.id ? (
                            <div className="flex gap-1 mt-2">
                              <input type="number" step="0.25" value={timeHours} onChange={e => setTimeHours(e.target.value)} placeholder="Horas" className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none" />
                              <button onClick={() => handleAddTime(task.id)} className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs">OK</button>
                              <button onClick={() => { setShowTimeForm(null); setTimeHours('') }} className="px-2 py-1 bg-muted text-foreground rounded text-xs">X</button>
                            </div>
                          ) : (
                            <button onClick={() => setShowTimeForm(task.id)} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"><Clock className="h-3 w-3" /> Registrar tempo</button>
                          )}
                        </>
                      )}
                      {/* Quick status change */}
                      {can('tasks:manage') && (
                        <div className="flex gap-1 mt-2">
                          {STATUSES.filter(s => s.key !== task.status).map(s => (
                            <button key={s.key} onClick={() => handleStatusChange(task.id, s.key)} className="px-1.5 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted" title={s.label}>
                              <div className={`w-2 h-2 rounded-full ${s.color} inline-block`} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tarefa</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Projeto</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Prioridade</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Prazo</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tempo</th>
                {can('tasks:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {tasks.map(task => {
                const st = STATUSES.find(s => s.key === task.status) || STATUSES[0]
                const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.MEDIUM
                return (
                  <tr key={task.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium">{task.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{task.project?.name || '—'}</td>
                    <td className="px-4 py-3">
                      {can('tasks:manage') ? (
                        <select value={task.status} onChange={e => handleStatusChange(task.id, e.target.value)} className="bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none">
                          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs"><div className={`w-2 h-2 rounded-full ${st.color}`} />{st.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium ${pr.color}`}>{pr.label}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{task.dueDate ? new Date(task.dueDate).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{(task.timeTracked || 0) > 0 ? `${Math.floor((task.timeTracked || 0) / 60)}h${(task.timeTracked || 0) % 60 > 0 ? `${(task.timeTracked || 0) % 60}m` : ''}` : '—'}</td>
                    {can('tasks:manage') && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => startEdit(task)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleDelete(task.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><CheckSquare className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhuma tarefa</h3>
              <p className="text-muted-foreground text-sm">Crie tarefas para seus projetos.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
