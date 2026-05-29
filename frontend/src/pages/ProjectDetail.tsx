import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft, Edit2, Trash2, Plus, X, Clock, Flag, Users, MessageSquare, StickyNote,
  BarChart3, Activity, Copy, CheckCircle2, AlertCircle, Timer, DollarSign,
  Calendar, ChevronDown, MoreHorizontal, Send, ChevronRight, Building2
} from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { projectService, taskService } from '@/services/commercial'
import type {
  Project, ProjectTask, Milestone, ProjectDiscussion, ProjectNote,
  ProjectTimesheet, ProjectActivity as ActivityType, ProjectOverview
} from '@/types'

// ── Constants ────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: 'Não Iniciado', color: 'bg-gray-500/10 text-gray-500' },
  IN_PROGRESS: { label: 'Em Progresso', color: 'bg-blue-500/10 text-blue-500' },
  ON_HOLD: { label: 'Pausado', color: 'bg-yellow-500/10 text-yellow-500' },
  COMPLETED: { label: 'Concluído', color: 'bg-green-500/10 text-green-500' },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-500/10 text-red-500' },
}

const TASK_STATUS = [
  { key: 'NOT_STARTED', label: 'A Fazer', color: 'bg-gray-500', textColor: 'text-gray-500' },
  { key: 'IN_PROGRESS', label: 'Em Progresso', color: 'bg-blue-500', textColor: 'text-blue-500' },
  { key: 'AWAITING_FEEDBACK', label: 'Aguardando', color: 'bg-yellow-500', textColor: 'text-yellow-500' },
  { key: 'COMPLETED', label: 'Concluído', color: 'bg-green-500', textColor: 'text-green-500' },
  { key: 'CANCELLED', label: 'Cancelado', color: 'bg-red-500', textColor: 'text-red-500' },
]

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Baixa', color: 'text-gray-500' },
  MEDIUM: { label: 'Média', color: 'text-blue-500' },
  HIGH: { label: 'Alta', color: 'text-orange-500' },
  URGENT: { label: 'Urgente', color: 'text-red-500' },
}

const BILLING_LABELS: Record<string, string> = { FIXED: 'Preço Fixo', HOURLY: 'Por Hora', FREE: 'Gratuito' }

type Tab = 'overview' | 'tasks' | 'milestones' | 'timesheets' | 'discussions' | 'notes' | 'activity'

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview', label: 'Visão Geral', icon: BarChart3 },
  { key: 'tasks', label: 'Tarefas', icon: CheckCircle2 },
  { key: 'milestones', label: 'Marcos', icon: Flag },
  { key: 'timesheets', label: 'Timesheets', icon: Timer },
  { key: 'discussions', label: 'Discussões', icon: MessageSquare },
  { key: 'notes', label: 'Notas', icon: StickyNote },
  { key: 'activity', label: 'Atividade', icon: Activity },
]

// ── Helper ───────────────────────────────────────────────

function fmt(d?: string) {
  return d ? new Date(d).toLocaleDateString('pt-BR') : '—'
}

function fmtDateTime(d?: string) {
  return d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

function minutesToHM(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
}

// ── Component ────────────────────────────────────────────

interface Props {
  projectId: string
  onBack: () => void
  onEdit: (p: Project) => void
  onDeleted: () => void
}

export function ProjectDetail({ projectId, onBack, onEdit, onDeleted }: Props) {
  const toast = useToast()
  const { can } = usePermissions()

  const [project, setProject] = useState<Project | null>(null)
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Task inline form
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null)
  const emptyTaskForm = { name: '', description: '', status: 'NOT_STARTED', priority: 'MEDIUM', milestoneId: '', dueDate: '', billable: false }
  const [taskForm, setTaskForm] = useState(emptyTaskForm)

  // Milestone form
  const [showMsForm, setShowMsForm] = useState(false)
  const [msForm, setMsForm] = useState({ name: '', description: '', dueDate: '', color: '#3b82f6' })

  // Discussion
  const [showDiscForm, setShowDiscForm] = useState(false)
  const [discForm, setDiscForm] = useState({ subject: '', description: '' })
  const [openDiscussion, setOpenDiscussion] = useState<ProjectDiscussion | null>(null)
  const [commentText, setCommentText] = useState('')

  // Notes
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteForm, setNoteForm] = useState({ title: '', content: '' })
  const [editingNote, setEditingNote] = useState<ProjectNote | null>(null)

  // Timesheet
  const [showTsForm, setShowTsForm] = useState(false)
  const [tsForm, setTsForm] = useState({ startTime: '', endTime: '', note: '', taskId: '' })

  // Copy
  const [showCopyForm, setShowCopyForm] = useState(false)
  const [copyForm, setCopyForm] = useState({ name: '', startDate: '', deadline: '', copyTasks: true, copyMilestones: true, copyMembers: true })

  // Status
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [p, ov] = await Promise.all([
        projectService.get(projectId),
        projectService.overview(projectId),
      ])
      setProject(p)
      setOverview(ov)
    } catch { toast.error('Erro ao carregar projeto') }
    setLoading(false)
  }, [projectId])

  useEffect(() => { reload() }, [reload])

  if (loading || !project) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  const st = STATUS_MAP[project.status] || STATUS_MAP.NOT_STARTED

  // ═══════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════

  async function handleChangeStatus(newStatus: string) {
    setShowStatusMenu(false)
    const completeAllTasks = newStatus === 'COMPLETED'
      ? await toast.confirm({ title: 'Completar tarefas?', message: 'Deseja marcar todas as tarefas como concluídas?', confirmText: 'Sim', cancelText: 'Não' })
      : false
    try {
      await projectService.changeStatus(project!.id, { status: newStatus, completeAllTasks })
      toast.success('Status alterado')
      reload()
    } catch { toast.error('Erro ao alterar status') }
  }

  async function handleDeleteProject() {
    if (!await toast.confirm({ title: 'Excluir projeto', message: `"${project!.name}" será excluído permanentemente.`, danger: true, confirmText: 'Excluir' })) return
    try { await projectService.delete(project!.id); onDeleted() } catch { toast.error('Erro ao excluir') }
  }

  async function handleCopy(e: React.FormEvent) {
    e.preventDefault()
    try {
      await projectService.copy(project!.id, { ...copyForm, startDate: copyForm.startDate || undefined, deadline: copyForm.deadline || undefined })
      setShowCopyForm(false)
      toast.success('Projeto copiado!')
    } catch { toast.error('Erro ao copiar') }
  }

  // ── Tasks
  async function handleTaskSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data = {
      ...taskForm,
      projectId: project!.id,
      milestoneId: taskForm.milestoneId || null,
      dueDate: taskForm.dueDate || undefined,
    }
    try {
      if (editingTask) { await taskService.update(editingTask.id, data) }
      else { await taskService.create(data) }
      setShowTaskForm(false); setEditingTask(null); setTaskForm(emptyTaskForm)
      reload()
    } catch { toast.error('Erro ao salvar tarefa') }
  }

  async function deleteTask(id: string) {
    if (!await toast.confirm({ title: 'Excluir tarefa', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await taskService.delete(id); reload() } catch { toast.error('Erro') }
  }

  async function changeTaskStatus(taskId: string, newStatus: string) {
    try { await taskService.update(taskId, { status: newStatus }); reload() } catch { toast.error('Erro') }
  }

  function startEditTask(t: ProjectTask) {
    setEditingTask(t)
    setTaskForm({
      name: t.name, description: t.description || '', status: t.status, priority: t.priority,
      milestoneId: t.milestoneId || '', dueDate: t.dueDate ? t.dueDate.split('T')[0] : '', billable: t.billable,
    })
    setShowTaskForm(true)
  }

  // ── Milestones
  async function handleMsSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await projectService.addMilestone(project!.id, {
        name: msForm.name, description: msForm.description || undefined,
        dueDate: msForm.dueDate || undefined, color: msForm.color,
      })
      setShowMsForm(false); setMsForm({ name: '', description: '', dueDate: '', color: '#3b82f6' })
      reload()
    } catch { toast.error('Erro') }
  }

  async function deleteMs(msId: string) {
    if (!await toast.confirm({ title: 'Excluir marco', message: 'As tarefas vinculadas serão desvinculadas.', danger: true, confirmText: 'Excluir' })) return
    try { await projectService.deleteMilestone(project!.id, msId); reload() } catch { toast.error('Erro') }
  }

  // ── Discussions
  async function handleDiscSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await projectService.createDiscussion(project!.id, discForm)
      setShowDiscForm(false); setDiscForm({ subject: '', description: '' })
      reload()
    } catch { toast.error('Erro') }
  }

  async function viewDiscussion(d: ProjectDiscussion) {
    try {
      const full = await projectService.getDiscussion(project!.id, d.id)
      setOpenDiscussion(full)
    } catch { toast.error('Erro') }
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim() || !openDiscussion) return
    try {
      await projectService.addComment(project!.id, openDiscussion.id, { content: commentText })
      setCommentText('')
      const full = await projectService.getDiscussion(project!.id, openDiscussion.id)
      setOpenDiscussion(full)
      reload()
    } catch { toast.error('Erro') }
  }

  async function deleteDiscussion(dId: string) {
    if (!await toast.confirm({ title: 'Excluir discussão', message: 'Todos os comentários serão excluídos.', danger: true, confirmText: 'Excluir' })) return
    try { await projectService.deleteDiscussion(project!.id, dId); if (openDiscussion?.id === dId) setOpenDiscussion(null); reload() } catch { toast.error('Erro') }
  }

  // ── Notes
  async function handleNoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingNote) { await projectService.updateNote(project!.id, editingNote.id, noteForm) }
      else { await projectService.createNote(project!.id, noteForm) }
      setShowNoteForm(false); setEditingNote(null); setNoteForm({ title: '', content: '' })
      reload()
    } catch { toast.error('Erro') }
  }

  async function deleteNote(nId: string) {
    if (!await toast.confirm({ title: 'Excluir nota', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await projectService.deleteNote(project!.id, nId); reload() } catch { toast.error('Erro') }
  }

  // ── Timesheets
  async function handleTsSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await projectService.createTimesheet(project!.id, {
        startTime: tsForm.startTime ? new Date(tsForm.startTime).toISOString() : new Date().toISOString(),
        endTime: tsForm.endTime ? new Date(tsForm.endTime).toISOString() : undefined,
        note: tsForm.note || undefined,
        taskId: tsForm.taskId || undefined,
      })
      setShowTsForm(false); setTsForm({ startTime: '', endTime: '', note: '', taskId: '' })
      reload()
    } catch { toast.error('Erro') }
  }

  async function deleteTs(tsId: string) {
    if (!await toast.confirm({ title: 'Excluir timesheet', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await projectService.deleteTimesheet(project!.id, tsId); reload() } catch { toast.error('Erro') }
  }

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-foreground truncate">{project.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Status dropdown */}
            <div className="relative">
              <button onClick={() => can('projects:manage') && setShowStatusMenu(!showStatusMenu)} className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color} ${can('projects:manage') ? 'cursor-pointer hover:opacity-80' : ''} flex items-center gap-1`}>
                {st.label}
                {can('projects:manage') && <ChevronDown className="h-3 w-3" />}
              </button>
              {showStatusMenu && (
                <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 py-1 min-w-[160px]">
                  {Object.entries(STATUS_MAP).map(([k, v]) => (
                    <button key={k} onClick={() => handleChangeStatus(k)} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${k === project.status ? 'font-medium' : ''}`}>
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${v.color.split(' ')[0].replace('/10', '')}`} />
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{BILLING_LABELS[project.billingType] || project.billingType}</span>
            {project.contact && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                <Building2 className="h-3 w-3" />
                {project.contact.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Progress badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-lg">
            <div className="w-16 bg-muted rounded-full h-2">
              <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${project.progress}%` }} />
            </div>
            <span className="text-xs font-medium text-foreground">{project.progress}%</span>
          </div>
          {/* Members avatars */}
          {(project.members || []).length > 0 && (
            <div className="flex -space-x-2">
              {project.members!.slice(0, 5).map(m => (
                <div key={m.id} title={m.user?.name || m.userId} className="w-8 h-8 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center text-xs font-medium text-primary">
                  {(m.user?.name || 'U')[0].toUpperCase()}
                </div>
              ))}
              {project.members!.length > 5 && (
                <div className="w-8 h-8 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs text-muted-foreground">
                  +{project.members!.length - 5}
                </div>
              )}
            </div>
          )}
          {can('projects:manage') && (
            <div className="flex gap-1">
              <button onClick={() => onEdit(project)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Editar"><Edit2 className="h-4 w-4" /></button>
              <button onClick={() => { setCopyForm({ name: `${project.name} (cópia)`, startDate: '', deadline: '', copyTasks: true, copyMilestones: true, copyMembers: true }); setShowCopyForm(true) }} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Copiar"><Copy className="h-4 w-4" /></button>
              <button onClick={handleDeleteProject} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8" title="Excluir"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>

      {/* Copy dialog */}
      {showCopyForm && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-foreground">Copiar Projeto</h3>
            <button onClick={() => setShowCopyForm(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleCopy} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                <input value={copyForm.name} onChange={e => setCopyForm({ ...copyForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Data Início</label>
                <input type="date" value={copyForm.startDate} onChange={e => setCopyForm({ ...copyForm, startDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Prazo</label>
                <input type="date" value={copyForm.deadline} onChange={e => setCopyForm({ ...copyForm, deadline: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={copyForm.copyTasks} onChange={e => setCopyForm({ ...copyForm, copyTasks: e.target.checked })} className="rounded border-border text-primary h-4 w-4" /> Copiar tarefas</label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={copyForm.copyMilestones} onChange={e => setCopyForm({ ...copyForm, copyMilestones: e.target.checked })} className="rounded border-border text-primary h-4 w-4" /> Copiar marcos</label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={copyForm.copyMembers} onChange={e => setCopyForm({ ...copyForm, copyMembers: e.target.checked })} className="rounded border-border text-primary h-4 w-4" /> Copiar membros</label>
            </div>
            <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">Copiar</button>
          </form>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.key === 'tasks' && <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{project.tasks?.length || 0}</span>}
                {tab.key === 'discussions' && <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{project.discussions?.length || 0}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══════ TAB: OVERVIEW ═══════ */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          {/* Client info + Description */}
          <div className={`grid gap-4 ${project.contact && project.description ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {project.contact && (
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" /> Cliente
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nome</span>
                    <span className="text-foreground font-medium">{project.contact.name}</span>
                  </div>
                  {project.contact.email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <a href={`mailto:${project.contact.email}`} className="text-primary hover:underline">{project.contact.email}</a>
                    </div>
                  )}
                  {project.contact.phoneNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Telefone</span>
                      <span className="text-foreground">{project.contact.phoneNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {project.description && (
              <div className="bg-muted/30 rounded-xl p-5">
                <h3 className="text-sm font-medium text-foreground mb-2">Descrição</h3>
                <p className="text-sm text-foreground/80">{project.description}</p>
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-xs text-muted-foreground">Tarefas</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{overview.tasks.completed}<span className="text-sm font-normal text-muted-foreground">/{overview.tasks.total}</span></p>
              {overview.tasks.overdue > 0 && <p className="text-xs text-red-500 mt-1"><AlertCircle className="h-3 w-3 inline mr-0.5" />{overview.tasks.overdue} atrasada{overview.tasks.overdue > 1 ? 's' : ''}</p>}
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="h-4 w-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Tempo Total</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{minutesToHM(overview.time.totalTrackedMinutes + overview.time.totalTimesheetMinutes)}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <p className="text-xs text-muted-foreground">Faturado</p>
              </div>
              <p className="text-2xl font-bold text-foreground">R$ {overview.financial.invoiceTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              {overview.financial.amountPaid > 0 && <p className="text-xs text-green-500 mt-1">R$ {overview.financial.amountPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} pago</p>}
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-purple-500" />
                <p className="text-xs text-muted-foreground">Prazo</p>
              </div>
              {overview.timeline.daysRemaining !== null ? (
                <>
                  <p className={`text-2xl font-bold ${overview.timeline.isOverdue ? 'text-red-500' : 'text-foreground'}`}>
                    {overview.timeline.isOverdue ? `${Math.abs(overview.timeline.daysRemaining)}d atraso` : `${overview.timeline.daysRemaining}d`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{fmt(project.deadline)}</p>
                </>
              ) : (
                <p className="text-lg text-muted-foreground">Sem prazo</p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="bg-card border border-border/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-foreground">Progresso do Projeto</h3>
              <span className="text-sm font-bold text-foreground">{project.progress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div className="bg-primary rounded-full h-3 transition-all duration-500" style={{ width: `${project.progress}%` }} />
            </div>
            {/* Task status breakdown */}
            <div className="flex gap-4 mt-3 flex-wrap">
              {TASK_STATUS.filter(s => overview.tasks.byStatus[s.key]).map(s => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                  <span className="text-xs text-muted-foreground">{s.label}: {overview.tasks.byStatus[s.key]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline + Financial grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border/60 rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2"><Calendar className="h-4 w-4" /> Cronograma</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Início</span><span className="text-foreground">{fmt(project.startDate)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Prazo</span><span className="text-foreground">{fmt(project.deadline)}</span></div>
                {overview.timeline.daysElapsed !== null && <div className="flex justify-between"><span className="text-muted-foreground">Dias transcorridos</span><span className="text-foreground">{overview.timeline.daysElapsed}d</span></div>}
                {overview.timeline.totalDays !== null && <div className="flex justify-between"><span className="text-muted-foreground">Duração total</span><span className="text-foreground">{overview.timeline.totalDays}d</span></div>}
              </div>
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Financeiro</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Faturas</span><span className="text-foreground">{overview.financial.invoiceCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total Faturado</span><span className="text-foreground">R$ {overview.financial.invoiceTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span className="text-green-500">R$ {overview.financial.amountPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Despesas</span><span className="text-red-500">R$ {overview.financial.expenseTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
              </div>
            </div>
          </div>

          {/* Members */}
          {(project.members || []).length > 0 && (
            <div className="bg-card border border-border/60 rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2"><Users className="h-4 w-4" /> Membros ({project.members!.length})</h3>
              <div className="flex flex-wrap gap-2">
                {project.members!.map(m => (
                  <div key={m.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                      {(m.user?.name || 'U')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm text-foreground">{m.user?.name || m.userId}</p>
                      {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: TASKS ═══════ */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">{project.tasks?.length || 0} tarefas</h3>
            {can('projects:manage') && (
              <button onClick={() => { setEditingTask(null); setTaskForm(emptyTaskForm); setShowTaskForm(true) }} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Nova Tarefa
              </button>
            )}
          </div>

          {/* Task form */}
          {showTaskForm && (
            <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-foreground">{editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}</h3>
                <button onClick={() => { setShowTaskForm(false); setEditingTask(null) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-4 w-4" /></button>
              </div>
              <form onSubmit={handleTaskSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                    <input value={taskForm.name} onChange={e => setTaskForm({ ...taskForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Marco</label>
                    <select value={taskForm.milestoneId} onChange={e => setTaskForm({ ...taskForm, milestoneId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      <option value="">Sem marco</option>
                      {(project.milestones || []).map(ms => <option key={ms.id} value={ms.id}>{ms.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
                    <select value={taskForm.status} onChange={e => setTaskForm({ ...taskForm, status: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      {TASK_STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Prioridade</label>
                    <select value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Prazo</label>
                    <input type="date" value={taskForm.dueDate} onChange={e => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={taskForm.billable} onChange={e => setTaskForm({ ...taskForm, billable: e.target.checked })} className="rounded border-border text-primary h-4 w-4" /> Faturável</label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                  <textarea value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
                <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium">{editingTask ? 'Salvar' : 'Criar Tarefa'}</button>
              </form>
            </div>
          )}

          {/* Kanban by status */}
          <div className="overflow-x-auto">
            <div className="grid grid-cols-4 gap-3 min-w-[800px]">
              {TASK_STATUS.filter(s => s.key !== 'CANCELLED').map(col => {
                const colTasks = (project.tasks || []).filter(t => t.status === col.key)
                return (
                  <div key={col.key} className="bg-muted/20 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                      <span className="text-sm font-medium text-foreground">{col.label}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{colTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {colTasks.map(task => {
                        const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.MEDIUM
                        return (
                          <div key={task.id} className="bg-card border border-border/50 rounded-lg p-3 hover:shadow-md transition-all">
                            <div className="flex items-start justify-between mb-1">
                              <span className="text-sm font-medium text-foreground line-clamp-2">{task.name}</span>
                              {can('projects:manage') && (
                                <div className="flex gap-0.5 shrink-0 ml-1">
                                  <button onClick={() => startEditTask(task)} className="p-1 rounded text-muted-foreground hover:text-primary"><Edit2 className="h-3 w-3" /></button>
                                  <button onClick={() => deleteTask(task.id)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              )}
                            </div>
                            {task.milestone && <p className="text-xs text-primary/70 mb-1"><Flag className="h-3 w-3 inline mr-0.5" />{task.milestone.name}</p>}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-medium ${pr.color}`}>{pr.label}</span>
                              {task.dueDate && <span className="text-xs text-muted-foreground">{fmt(task.dueDate)}</span>}
                              {task.timeTracked > 0 && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" />{minutesToHM(task.timeTracked)}</span>}
                            </div>
                            {/* Quick status buttons */}
                            {can('projects:manage') && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {TASK_STATUS.filter(s => s.key !== task.status && s.key !== 'CANCELLED').map(s => (
                                  <button key={s.key} onClick={() => changeTaskStatus(task.id, s.key)} className="px-1.5 py-0.5 text-[10px] rounded bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted">{s.label}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ TAB: MILESTONES ═══════ */}
      {activeTab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">{project.milestones?.length || 0} marcos</h3>
            {can('projects:manage') && (
              <button onClick={() => setShowMsForm(true)} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Novo Marco
              </button>
            )}
          </div>

          {showMsForm && (
            <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
              <form onSubmit={handleMsSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                    <input value={msForm.name} onChange={e => setMsForm({ ...msForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Prazo</label>
                    <input type="date" value={msForm.dueDate} onChange={e => setMsForm({ ...msForm, dueDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Cor</label>
                    <input type="color" value={msForm.color} onChange={e => setMsForm({ ...msForm, color: e.target.value })} className="w-full h-[42px] bg-background border border-border rounded-lg px-1 py-1 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                  <textarea value={msForm.description} onChange={e => setMsForm({ ...msForm, description: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">Criar Marco</button>
                  <button type="button" onClick={() => setShowMsForm(false)} className="px-5 py-2.5 bg-muted text-foreground rounded-lg text-sm">Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {/* Milestones Kanban — milestones as columns, tasks as cards */}
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-fit pb-4">
              {/* Unassigned column */}
              {(() => {
                const unassigned = (project.tasks || []).filter(t => !t.milestoneId)
                return unassigned.length > 0 ? (
                  <div className="bg-muted/20 rounded-xl p-3 min-w-[280px] max-w-[320px] shrink-0">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span className="text-sm font-medium text-muted-foreground">Sem Marco</span>
                      <span className="text-xs text-muted-foreground ml-auto">{unassigned.length}</span>
                    </div>
                    <div className="space-y-2">
                      {unassigned.map(t => (
                        <MilestoneTaskCard key={t.id} task={t} canManage={can('projects:manage')} onEdit={startEditTask} onDelete={deleteTask} onStatusChange={changeTaskStatus} />
                      ))}
                    </div>
                  </div>
                ) : null
              })()}

              {(project.milestones || []).map(ms => {
                const msTasks = (project.tasks || []).filter(t => t.milestoneId === ms.id)
                const completedCount = msTasks.filter(t => t.status === 'COMPLETED').length
                const progress = msTasks.length > 0 ? Math.round((completedCount / msTasks.length) * 100) : 0
                return (
                  <div key={ms.id} className="bg-muted/20 rounded-xl p-3 min-w-[280px] max-w-[320px] shrink-0">
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ms.color || '#3b82f6' }} />
                      <span className="text-sm font-medium text-foreground truncate">{ms.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{msTasks.length}</span>
                      {can('projects:manage') && (
                        <button onClick={() => deleteMs(ms.id)} className="p-1 rounded text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="h-3 w-3" /></button>
                      )}
                    </div>
                    <div className="px-1 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-1.5">
                          <div className="rounded-full h-1.5 transition-all" style={{ width: `${progress}%`, backgroundColor: ms.color || '#3b82f6' }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{progress}%</span>
                      </div>
                      {ms.dueDate && <p className="text-[10px] text-muted-foreground mt-1">Prazo: {fmt(ms.dueDate)}</p>}
                    </div>
                    <div className="space-y-2">
                      {msTasks.map(t => (
                        <MilestoneTaskCard key={t.id} task={t} canManage={can('projects:manage')} onEdit={startEditTask} onDelete={deleteTask} onStatusChange={changeTaskStatus} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ TAB: TIMESHEETS ═══════ */}
      {activeTab === 'timesheets' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">{project.timesheets?.length || 0} registros</h3>
            {can('projects:manage') && (
              <button onClick={() => setShowTsForm(true)} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Registrar Tempo
              </button>
            )}
          </div>

          {showTsForm && (
            <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
              <form onSubmit={handleTsSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Início *</label>
                    <input type="datetime-local" value={tsForm.startTime} onChange={e => setTsForm({ ...tsForm, startTime: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Fim</label>
                    <input type="datetime-local" value={tsForm.endTime} onChange={e => setTsForm({ ...tsForm, endTime: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Tarefa</label>
                    <select value={tsForm.taskId} onChange={e => setTsForm({ ...tsForm, taskId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      <option value="">Nenhuma</option>
                      {(project.tasks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nota</label>
                    <input value={tsForm.note} onChange={e => setTsForm({ ...tsForm, note: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" placeholder="O que foi feito..." />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">Registrar</button>
                  <button type="button" onClick={() => setShowTsForm(false)} className="px-5 py-2.5 bg-muted text-foreground rounded-lg text-sm">Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {/* Timesheet table */}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Início</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Fim</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Duração</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Tarefa</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Nota</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(project.timesheets || []).map(ts => {
                  const linkedTask = (project.tasks || []).find(t => t.id === ts.taskId)
                  return (
                    <tr key={ts.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm text-foreground">{fmtDateTime(ts.startTime)}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{ts.endTime ? fmtDateTime(ts.endTime) : '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{minutesToHM(ts.duration)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{linkedTask?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{ts.note || '—'}</td>
                      <td className="px-4 py-3">
                        {can('projects:manage') && (
                          <button onClick={() => deleteTs(ts.id)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {(project.timesheets || []).length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">Nenhum registro de tempo ainda.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: DISCUSSIONS ═══════ */}
      {activeTab === 'discussions' && (
        <div className="space-y-4">
          {openDiscussion ? (
            /* Discussion detail */
            <div className="space-y-4">
              <button onClick={() => setOpenDiscussion(null)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ArrowLeft className="h-4 w-4" /> Voltar às discussões
              </button>
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <h3 className="text-lg font-medium text-foreground">{openDiscussion.subject}</h3>
                {openDiscussion.description && <p className="text-sm text-foreground/80 mt-2">{openDiscussion.description}</p>}
                <p className="text-xs text-muted-foreground mt-2">Criado em {fmtDateTime(openDiscussion.createdAt)}</p>
              </div>

              {/* Comments */}
              <div className="space-y-3">
                {(openDiscussion.comments || []).map(c => (
                  <div key={c.id} className="bg-card border border-border/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">{c.authorName[0].toUpperCase()}</div>
                      <span className="text-sm font-medium text-foreground">{c.authorName}</span>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))}
              </div>

              {/* Comment form */}
              <form onSubmit={sendComment} className="flex gap-2">
                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Escreva um comentário..." className="flex-1 bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                <button type="submit" disabled={!commentText.trim()} className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
                  <Send className="h-4 w-4" /> Enviar
                </button>
              </form>
            </div>
          ) : (
            /* Discussion list */
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">{project.discussions?.length || 0} discussões</h3>
                {can('projects:manage') && (
                  <button onClick={() => setShowDiscForm(true)} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                    <Plus className="h-4 w-4" /> Nova Discussão
                  </button>
                )}
              </div>

              {showDiscForm && (
                <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
                  <form onSubmit={handleDiscSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Assunto *</label>
                      <input value={discForm.subject} onChange={e => setDiscForm({ ...discForm, subject: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                      <textarea value={discForm.description} onChange={e => setDiscForm({ ...discForm, description: e.target.value })} rows={3} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">Criar</button>
                      <button type="button" onClick={() => setShowDiscForm(false)} className="px-5 py-2.5 bg-muted text-foreground rounded-lg text-sm">Cancelar</button>
                    </div>
                  </form>
                </div>
              )}

              <div className="space-y-2">
                {(project.discussions || []).map(d => (
                  <div key={d.id} className="bg-card border border-border/50 rounded-lg p-4 flex items-center justify-between hover:shadow-sm transition-all cursor-pointer" onClick={() => viewDiscussion(d)}>
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-foreground truncate">{d.subject}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground"><MessageSquare className="h-3 w-3 inline mr-0.5" />{d._count?.comments || 0} comentários</span>
                        <span className="text-xs text-muted-foreground">{fmtDateTime(d.lastActivityAt)}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
                {(project.discussions || []).length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma discussão ainda. Crie uma para colaborar com a equipe.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════ TAB: NOTES ═══════ */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">{project.notes?.length || 0} notas</h3>
              <p className="text-xs text-muted-foreground">Notas são privadas e visíveis apenas para você.</p>
            </div>
            <button onClick={() => { setEditingNote(null); setNoteForm({ title: '', content: '' }); setShowNoteForm(true) }} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Nova Nota
            </button>
          </div>

          {showNoteForm && (
            <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
              <form onSubmit={handleNoteSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Título *</label>
                  <input value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Conteúdo</label>
                  <textarea value={noteForm.content} onChange={e => setNoteForm({ ...noteForm, content: e.target.value })} rows={5} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">{editingNote ? 'Salvar' : 'Criar Nota'}</button>
                  <button type="button" onClick={() => { setShowNoteForm(false); setEditingNote(null) }} className="px-5 py-2.5 bg-muted text-foreground rounded-lg text-sm">Cancelar</button>
                </div>
              </form>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(project.notes || []).map(n => (
              <div key={n.id} className="bg-card border border-border/50 rounded-xl p-5 group">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-foreground">{n.title}</h4>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingNote(n); setNoteForm({ title: n.title, content: n.content || '' }); setShowNoteForm(true) }} className="p-1.5 rounded text-muted-foreground hover:text-primary"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deleteNote(n.id)} className="p-1.5 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {n.content && <p className="text-sm text-foreground/70 whitespace-pre-wrap line-clamp-4">{n.content}</p>}
                <p className="text-xs text-muted-foreground mt-3">{fmtDateTime(n.createdAt)}</p>
              </div>
            ))}
          </div>
          {(project.notes || []).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma nota ainda. Suas notas são privadas.</div>
          )}
        </div>
      )}

      {/* ═══════ TAB: ACTIVITY ═══════ */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">Atividade Recente</h3>
          <div className="space-y-1">
            {(project.activities || []).map((act, i) => (
              <div key={act.id} className="flex gap-3 py-3 relative">
                {/* Timeline line */}
                {i < (project.activities || []).length - 1 && (
                  <div className="absolute left-[13px] top-[36px] bottom-0 w-px bg-border" />
                )}
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 z-10">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{act.content || act.type}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtDateTime(act.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
          {(project.activities || []).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-component ────────────────────────────────────────

function MilestoneTaskCard({ task, canManage, onEdit, onDelete, onStatusChange }: {
  task: ProjectTask
  canManage: boolean
  onEdit: (t: ProjectTask) => void
  onDelete: (id: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  const st = TASK_STATUS.find(s => s.key === task.status) || TASK_STATUS[0]
  const pr = PRIORITY_MAP[task.priority] || PRIORITY_MAP.MEDIUM

  return (
    <div className="bg-card border border-border/50 rounded-lg p-3 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-1">
        <span className="text-sm text-foreground line-clamp-2">{task.name}</span>
        {canManage && (
          <div className="flex gap-0.5 shrink-0 ml-1">
            <button onClick={() => onEdit(task)} className="p-1 rounded text-muted-foreground hover:text-primary"><Edit2 className="h-3 w-3" /></button>
            <button onClick={() => onDelete(task.id)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${st.color}/10 ${st.textColor}`}>{st.label}</span>
        <span className={`text-[10px] ${pr.color}`}>{pr.label}</span>
        {task.dueDate && <span className="text-[10px] text-muted-foreground">{fmt(task.dueDate)}</span>}
      </div>
      {canManage && task.status !== 'COMPLETED' && (
        <button onClick={() => onStatusChange(task.id, 'COMPLETED')} className="mt-2 text-[10px] text-green-600 hover:text-green-700 flex items-center gap-0.5">
          <CheckCircle2 className="h-3 w-3" /> Concluir
        </button>
      )}
    </div>
  )
}
