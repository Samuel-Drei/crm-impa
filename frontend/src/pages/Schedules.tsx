import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays, Plus, Pause, Play, Trash2, Copy, Eye, X,
  Clock, Send, Image, Video, Mic, FileText, Bot, AlertCircle,
  ChevronDown, Filter, List, Calendar as CalendarIcon, Search,
  Edit2, CheckCircle2, XCircle, RefreshCw, Sparkles,
} from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import api from '../services/api'
import { useToast } from '@/components/ui/Toast'

// ── Types ──
interface Schedule {
  id: string
  companyId: string
  instanceId: string
  contactId?: string
  remoteJid: string
  name: string
  messageType: string
  content?: string
  mediaUrl?: string
  mediaFileName?: string
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR'
  recurrence: 'ONCE' | 'DAILY' | 'EVERY_X_DAYS' | 'WEEKLY' | 'SPECIFIC_DAYS' | 'MONTHLY'
  timezone: string
  scheduledAt: string
  recurrenceRule?: {
    intervalDays?: number
    weekDays?: number[]
    dayOfMonth?: number
    endDate?: string
    maxOccurrences?: number
  }
  nextExecutionAt?: string
  lastExecutedAt?: string
  aiEnabled: boolean
  aiProviderId?: string
  aiModel?: string
  aiPrompt?: string
  totalSent: number
  totalFailed: number
  maxOccurrences?: number
  errorMessage?: string
  createdById: string
  createdAt: string
  updatedAt: string
  instance?: { id: string; name: string; channel: string; status: string }
  contact?: { id: string; name: string; phoneNumber: string }
  createdBy?: { id: string; name: string }
  aiProvider?: { id: string; name: string; type: string }
  logs?: ScheduleLog[]
  _count?: { logs: number }
}

interface ScheduleLog {
  id: string
  status: string
  content?: string
  messageId?: string
  error?: string
  aiUsed: boolean
  executedAt: string
}

interface CalendarEvent {
  id: string
  scheduleId: string
  title: string
  start: string
  end: string
  type: 'executed' | 'scheduled' | 'future'
  messageType: string
  status: string
  instance?: { id: string; name: string }
  contact?: { id: string; name: string; phoneNumber: string }
  remoteJid: string
  aiUsed?: boolean
}

interface Instance {
  id: string
  name: string
  channel: string
  status: string
}

interface AIProvider {
  id: string
  name: string
  type: string
  model: string
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  ACTIVE: { label: 'Ativo', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: Play },
  PAUSED: { label: 'Pausado', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Pause },
  COMPLETED: { label: 'Concluído', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelado', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-400', icon: XCircle },
  ERROR: { label: 'Erro', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: AlertCircle },
}

const RECURRENCE_MAP: Record<string, string> = {
  ONCE: 'Único',
  DAILY: 'Diário',
  EVERY_X_DAYS: 'A cada X dias',
  WEEKLY: 'Semanal',
  SPECIFIC_DAYS: 'Dias específicos',
  MONTHLY: 'Mensal',
}

const MSG_TYPE_ICON: Record<string, any> = {
  text: Send,
  image: Image,
  video: Video,
  audio: Mic,
  document: FileText,
}

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const EVENT_COLORS: Record<string, string> = {
  executed: '#10b981',
  scheduled: '#3b82f6',
  future: '#8b5cf6',
}

// ── Component ──
export default function Schedules() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterInstance, setFilterInstance] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [calendarRange, setCalendarRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    end: new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).toISOString(),
  })

  // Form state
  const [form, setForm] = useState({
    instanceId: '',
    remoteJid: '',
    contactId: '',
    name: '',
    messageType: 'text',
    content: '',
    mediaUrl: '',
    mediaFileName: '',
    recurrence: 'ONCE',
    timezone: 'America/Sao_Paulo',
    scheduledAt: '',
    recurrenceRule: {
      intervalDays: 2,
      weekDays: [] as number[],
      dayOfMonth: 1,
      endDate: '',
      maxOccurrences: undefined as number | undefined,
    },
    aiEnabled: false,
    aiProviderId: '',
    aiModel: '',
    aiPrompt: '',
  })

  // ── Queries ──
  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['schedules', filterStatus, filterInstance],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterInstance) params.set('instanceId', filterInstance)
      const { data } = await api.get(`/schedules?${params}`)
      return data as Schedule[]
    },
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances-list'],
    queryFn: async () => {
      const { data } = await api.get('/instances')
      return (data.instances || data) as Instance[]
    },
  })

  const { data: aiProviders = [] } = useQuery({
    queryKey: ['ai-providers-list'],
    queryFn: async () => {
      const { data } = await api.get('/ai/providers')
      return (data.providers || data) as AIProvider[]
    },
  })

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['schedule-calendar', calendarRange.start, calendarRange.end, filterInstance],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('start', calendarRange.start)
      params.set('end', calendarRange.end)
      if (filterInstance) params.set('instanceId', filterInstance)
      const { data } = await api.get(`/schedules/calendar/events?${params}`)
      return data as CalendarEvent[]
    },
    enabled: view === 'calendar',
  })

  const { data: detail } = useQuery({
    queryKey: ['schedule-detail', detailId],
    queryFn: async () => {
      const { data } = await api.get(`/schedules/${detailId}`)
      return data as Schedule
    },
    enabled: !!detailId,
  })

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { data: result } = await api.post('/schedules', data)
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-calendar'] })
      toast.success('Agendamento criado com sucesso')
      resetForm()
    },
    onError: (err: any) => toast.error(err.response?.data?.error || err.message || 'Erro ao criar'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: result } = await api.put(`/schedules/${id}`, data)
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-detail'] })
      toast.success('Agendamento atualizado')
      resetForm()
    },
    onError: (err: any) => toast.error(err.response?.data?.error || err.message || 'Erro ao atualizar'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/schedules/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-calendar'] })
      toast.success('Agendamento removido')
      setDetailId(null)
    },
    onError: (err: any) => toast.error(err.response?.data?.error || err.message || 'Erro ao remover'),
  })

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/schedules/${id}/duplicate`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Agendamento duplicado')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || err.message || 'Erro ao duplicar'),
  })

  // ── Helpers ──
  const resetForm = useCallback(() => {
    setShowForm(false)
    setEditingId(null)
    setForm({
      instanceId: '', remoteJid: '', contactId: '', name: '', messageType: 'text',
      content: '', mediaUrl: '', mediaFileName: '', recurrence: 'ONCE',
      timezone: 'America/Sao_Paulo', scheduledAt: '',
      recurrenceRule: { intervalDays: 2, weekDays: [], dayOfMonth: 1, endDate: '', maxOccurrences: undefined },
      aiEnabled: false, aiProviderId: '', aiModel: '', aiPrompt: '',
    })
  }, [])

  const openEdit = useCallback((s: Schedule) => {
    setForm({
      instanceId: s.instanceId,
      remoteJid: s.remoteJid,
      contactId: s.contactId || '',
      name: s.name,
      messageType: s.messageType,
      content: s.content || '',
      mediaUrl: s.mediaUrl || '',
      mediaFileName: s.mediaFileName || '',
      recurrence: s.recurrence,
      timezone: s.timezone,
      scheduledAt: s.scheduledAt ? new Date(s.scheduledAt).toISOString().slice(0, 16) : '',
      recurrenceRule: {
        intervalDays: s.recurrenceRule?.intervalDays || 2,
        weekDays: s.recurrenceRule?.weekDays || [],
        dayOfMonth: s.recurrenceRule?.dayOfMonth || 1,
        endDate: s.recurrenceRule?.endDate ? new Date(s.recurrenceRule.endDate).toISOString().slice(0, 16) : '',
        maxOccurrences: s.recurrenceRule?.maxOccurrences,
      },
      aiEnabled: s.aiEnabled,
      aiProviderId: s.aiProviderId || '',
      aiModel: s.aiModel || '',
      aiPrompt: s.aiPrompt || '',
    })
    setEditingId(s.id)
    setShowForm(true)
  }, [])

  const handleSubmit = useCallback(() => {
    const payload: any = {
      ...form,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      contactId: form.contactId || undefined,
      mediaUrl: form.mediaUrl || undefined,
      mediaFileName: form.mediaFileName || undefined,
      aiProviderId: form.aiEnabled ? form.aiProviderId || undefined : undefined,
      aiModel: form.aiEnabled ? form.aiModel || undefined : undefined,
      aiPrompt: form.aiEnabled ? form.aiPrompt || undefined : undefined,
    }

    // Limpar recurrenceRule conforme tipo
    if (form.recurrence === 'ONCE') {
      delete payload.recurrenceRule
    } else {
      const rule: any = {}
      if (form.recurrence === 'EVERY_X_DAYS') rule.intervalDays = form.recurrenceRule.intervalDays
      if (form.recurrence === 'SPECIFIC_DAYS') rule.weekDays = form.recurrenceRule.weekDays
      if (form.recurrence === 'MONTHLY') rule.dayOfMonth = form.recurrenceRule.dayOfMonth
      if (form.recurrenceRule.endDate) rule.endDate = new Date(form.recurrenceRule.endDate).toISOString()
      if (form.recurrenceRule.maxOccurrences) rule.maxOccurrences = form.recurrenceRule.maxOccurrences
      payload.recurrenceRule = rule
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }, [form, editingId, createMutation, updateMutation])

  const toggleWeekDay = useCallback((day: number) => {
    setForm(prev => ({
      ...prev,
      recurrenceRule: {
        ...prev.recurrenceRule,
        weekDays: prev.recurrenceRule.weekDays.includes(day)
          ? prev.recurrenceRule.weekDays.filter(d => d !== day)
          : [...prev.recurrenceRule.weekDays, day].sort((a, b) => a - b),
      },
    }))
  }, [])

  const filtered = useMemo(() => {
    if (!searchQuery) return schedules
    const q = searchQuery.toLowerCase()
    return schedules.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.remoteJid.includes(q) ||
      s.contact?.name?.toLowerCase().includes(q) ||
      s.contact?.phoneNumber?.includes(q) ||
      s.instance?.name?.toLowerCase().includes(q)
    )
  }, [schedules, searchQuery])

  const fullCalendarEvents = useMemo(() =>
    calendarEvents.map(evt => ({
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      backgroundColor: EVENT_COLORS[evt.type] || '#6b7280',
      borderColor: EVENT_COLORS[evt.type] || '#6b7280',
      extendedProps: evt,
    })),
  [calendarEvents])

  const formatDate = (d: string) => {
    if (!d) return '—'
    return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // ── Render ──
  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Agendamento de Mensagens</h1>
          <span className="text-sm text-muted-foreground">
            {schedules.length} agendamento{schedules.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="h-4 w-4" /> Lista
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'calendar' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <CalendarIcon className="h-4 w-4" /> Calendário
            </button>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Novo Agend. de Mensagem
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome, contato, número..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_MAP).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <select
          value={filterInstance}
          onChange={e => setFilterInstance(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Todas as instâncias</option>
          {instances.map(inst => (
            <option key={inst.id} value={inst.id}>{inst.name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === 'list' ? (
          /* ── LIST VIEW ── */
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <CalendarDays className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-lg font-medium">Nenhum agendamento encontrado</p>
                <p className="text-sm mt-1">Crie seu primeiro agendamento clicando no botão acima</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filtered.map(sched => {
                  const statusInfo = STATUS_MAP[sched.status] || STATUS_MAP.ACTIVE
                  const StatusIcon = statusInfo.icon
                  const TypeIcon = MSG_TYPE_ICON[sched.messageType] || Send
                  return (
                    <div
                      key={sched.id}
                      className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted hover:shadow-md transition-all cursor-pointer group"
                      onClick={() => setDetailId(sched.id)}
                    >
                      {/* Icon */}
                      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary shrink-0">
                        <TypeIcon className="h-5 w-5" />
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-foreground truncate">{sched.name}</h3>
                          {sched.aiEnabled && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                              <Sparkles className="h-3 w-3" /> IA
                            </span>
                          )}
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                            <StatusIcon className="h-3 w-3" /> {statusInfo.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {RECURRENCE_MAP[sched.recurrence]} — {formatDate(sched.scheduledAt)}
                          </span>
                          {sched.contact && (
                            <span className="truncate">{sched.contact.name || sched.contact.phoneNumber}</span>
                          )}
                          {sched.instance && (
                            <span className="text-muted-foreground">{sched.instance.name}</span>
                          )}
                        </div>
                      </div>
                      {/* Stats */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-600">{sched.totalSent}</div>
                          <div className="text-[10px]">Enviados</div>
                        </div>
                        {sched.totalFailed > 0 && (
                          <div className="text-center">
                            <div className="text-lg font-semibold text-red-500">{sched.totalFailed}</div>
                            <div className="text-[10px]">Falhas</div>
                          </div>
                        )}
                        {sched.nextExecutionAt && (
                          <div className="text-center">
                            <div className="text-xs font-medium text-primary">{formatDate(sched.nextExecutionAt)}</div>
                            <div className="text-[10px]">Próximo envio</div>
                          </div>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
                        {sched.status === 'ACTIVE' && (
                          <button
                            onClick={() => updateMutation.mutate({ id: sched.id, data: { status: 'PAUSED' } })}
                            className="p-1.5 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/30 text-yellow-600"
                            title="Pausar"
                          >
                            <Pause className="h-4 w-4" />
                          </button>
                        )}
                        {sched.status === 'PAUSED' && (
                          <button
                            onClick={() => updateMutation.mutate({ id: sched.id, data: { status: 'ACTIVE' } })}
                            className="p-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                            title="Reativar"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(sched)}
                          className="p-1.5 rounded-lg hover:bg-background text-muted-foreground"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => duplicateMutation.mutate(sched.id)}
                          className="p-1.5 rounded-lg hover:bg-background text-muted-foreground"
                          title="Duplicar"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Remover este agendamento?')) deleteMutation.mutate(sched.id) }}
                          className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                          title="Remover"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── CALENDAR VIEW ── */
          <div className="p-6 h-full">
            <div className="bg-muted rounded-xl border border-border p-4 h-full schedule-calendar">
              <FullCalendar
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                initialView="dayGridMonth"
                locale={ptBrLocale}
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,listWeek',
                }}
                events={fullCalendarEvents}
                height="auto"
                eventClick={(info) => {
                  const props = info.event.extendedProps as CalendarEvent
                  if (props.scheduleId) setDetailId(props.scheduleId)
                }}
                datesSet={(dateInfo) => {
                  setCalendarRange({
                    start: dateInfo.startStr,
                    end: dateInfo.endStr,
                  })
                }}
                eventContent={(arg) => {
                  const props = arg.event.extendedProps as CalendarEvent
                  const TypeIcon = MSG_TYPE_ICON[props.messageType] || Send
                  return (
                    <div className="flex items-center gap-1 px-1 py-0.5 text-xs truncate w-full">
                      <TypeIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{arg.event.title}</span>
                      {props.aiUsed && <Sparkles className="h-3 w-3 shrink-0 text-purple-300" />}
                    </div>
                  )
                }}
              />
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 px-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EVENT_COLORS.executed }} />
                Executado
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EVENT_COLORS.scheduled }} />
                Agendado
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: EVENT_COLORS.future }} />
                Futuro (recorrente)
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── FORM MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={resetForm}>
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
              <h2 className="text-lg font-semibold text-foreground">
                {editingId ? 'Editar Agendamento' : 'Novo Agendamento de Mensagem'}
              </h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Nome do agendamento</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Lembrete semanal para João"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Instância + Destinatário */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Instância</label>
                  <select
                    value={form.instanceId}
                    onChange={e => setForm(f => ({ ...f, instanceId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">Selecionar instância</option>
                    {instances.map(inst => (
                      <option key={inst.id} value={inst.id}>
                        {inst.name} ({inst.channel}) {inst.status !== 'CONNECTED' ? '⚠️' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Destinatário (JID)</label>
                  <input
                    type="text"
                    value={form.remoteJid}
                    onChange={e => setForm(f => ({ ...f, remoteJid: e.target.value }))}
                    placeholder="5511999999999@s.whatsapp.net"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Tipo de mensagem */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Tipo de mensagem</label>
                <div className="flex gap-2">
                  {['text', 'image', 'video', 'audio', 'document'].map(t => {
                    const Icon = MSG_TYPE_ICON[t] || Send
                    return (
                      <button
                        key={t}
                        onClick={() => setForm(f => ({ ...f, messageType: t }))}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${form.messageType === t
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {t === 'text' ? 'Texto' : t === 'image' ? 'Imagem' : t === 'video' ? 'Vídeo' : t === 'audio' ? 'Áudio' : 'Documento'}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Conteúdo */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {form.messageType === 'text' ? 'Mensagem' : 'Legenda (opcional)'}
                </label>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder={form.messageType === 'text' ? 'Texto da mensagem...' : 'Legenda da mídia...'}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Media URL (se não for texto) */}
              {form.messageType !== 'text' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">URL da mídia</label>
                  <input
                    type="text"
                    value={form.mediaUrl}
                    onChange={e => setForm(f => ({ ...f, mediaUrl: e.target.value }))}
                    placeholder="https://example.com/media.jpg ou /uploads/arquivo.pdf"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}

              {/* ── Agendamento ── */}
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" /> Configuração de Agendamento
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Data e hora</label>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Timezone</label>
                    <select
                      value={form.timezone}
                      onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="America/Sao_Paulo">São Paulo (BRT)</option>
                      <option value="America/Manaus">Manaus (AMT)</option>
                      <option value="America/Bahia">Bahia (BRT)</option>
                      <option value="America/Fortaleza">Fortaleza (BRT)</option>
                      <option value="America/Belem">Belém (BRT)</option>
                      <option value="America/Cuiaba">Cuiabá (AMT)</option>
                      <option value="America/Recife">Recife (BRT)</option>
                      <option value="America/Porto_Velho">Porto Velho (AMT)</option>
                      <option value="America/Rio_Branco">Rio Branco (ACT)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                </div>

                {/* Recorrência */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground mb-1">Recorrência</label>
                  <select
                    value={form.recurrence}
                    onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="ONCE">Envio único</option>
                    <option value="DAILY">Todos os dias</option>
                    <option value="EVERY_X_DAYS">A cada X dias</option>
                    <option value="WEEKLY">Toda semana</option>
                    <option value="SPECIFIC_DAYS">Dias específicos da semana</option>
                    <option value="MONTHLY">Mensalmente</option>
                  </select>
                </div>

                {/* Opções extras por tipo de recorrência */}
                {form.recurrence === 'EVERY_X_DAYS' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-foreground mb-1">A cada quantos dias?</label>
                    <input
                      type="number"
                      min={1}
                      value={form.recurrenceRule.intervalDays}
                      onChange={e => setForm(f => ({
                        ...f,
                        recurrenceRule: { ...f.recurrenceRule, intervalDays: parseInt(e.target.value) || 1 },
                      }))}
                      className="w-24 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}

                {form.recurrence === 'SPECIFIC_DAYS' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-foreground mb-1">Dias da semana</label>
                    <div className="flex gap-2">
                      {WEEKDAY_NAMES.map((name, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleWeekDay(idx)}
                          className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${form.recurrenceRule.weekDays.includes(idx)
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {form.recurrence === 'MONTHLY' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-foreground mb-1">Dia do mês</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.recurrenceRule.dayOfMonth}
                      onChange={e => setForm(f => ({
                        ...f,
                        recurrenceRule: { ...f.recurrenceRule, dayOfMonth: parseInt(e.target.value) || 1 },
                      }))}
                      className="w-24 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}

                {/* Fim da recorrência */}
                {form.recurrence !== 'ONCE' && (
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Data final (opcional)</label>
                      <input
                        type="datetime-local"
                        value={form.recurrenceRule.endDate}
                        onChange={e => setForm(f => ({
                          ...f,
                          recurrenceRule: { ...f.recurrenceRule, endDate: e.target.value },
                        }))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Máx. de envios (opcional)</label>
                      <input
                        type="number"
                        min={1}
                        value={form.recurrenceRule.maxOccurrences || ''}
                        onChange={e => setForm(f => ({
                          ...f,
                          recurrenceRule: { ...f.recurrenceRule, maxOccurrences: e.target.value ? parseInt(e.target.value) : undefined },
                        }))}
                        placeholder="Sem limite"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── IA ── */}
              <div className="border-t border-border pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" /> Personalização com IA
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.aiEnabled}
                      onChange={e => setForm(f => ({ ...f, aiEnabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                  </label>
                </div>

                {form.aiEnabled && (
                  <div className="space-y-3 pl-1">
                    <p className="text-xs text-muted-foreground">
                      A IA reescreverá a mensagem levemente antes de cada envio para evitar repetição.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">Provider de IA</label>
                        <select
                          value={form.aiProviderId}
                          onChange={e => setForm(f => ({ ...f, aiProviderId: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="">Selecionar provider</option>
                          {aiProviders.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">Modelo (opcional)</label>
                        <input
                          type="text"
                          value={form.aiModel}
                          onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))}
                          placeholder="gpt-4o-mini"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">Mini-prompt (instrução para a IA)</label>
                      <textarea
                        value={form.aiPrompt}
                        onChange={e => setForm(f => ({ ...f, aiPrompt: e.target.value }))}
                        placeholder="Ex: Reescreva mantendo tom informal e amigável. Use variações de cumprimento."
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={resetForm}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name || !form.instanceId || !form.remoteJid || !form.scheduledAt || (form.messageType === 'text' && !form.content)}
                className="px-6 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingId ? 'Salvar alterações' : 'Criar agendamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DETAIL MODAL ── */}
      {detailId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailId(null)}>
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{detail.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const si = STATUS_MAP[detail.status] || STATUS_MAP.ACTIVE
                    const SI = si.icon
                    return (
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${si.color}`}>
                        <SI className="h-3 w-3" /> {si.label}
                      </span>
                    )
                  })()}
                  {detail.aiEnabled && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                      <Sparkles className="h-3 w-3" /> IA ativa
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Instância</span>
                  <p className="font-medium text-foreground">{detail.instance?.name || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Destinatário</span>
                  <p className="font-medium text-foreground">{detail.contact?.name || detail.remoteJid}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Tipo</span>
                  <p className="font-medium text-foreground capitalize">{detail.messageType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Recorrência</span>
                  <p className="font-medium text-foreground">{RECURRENCE_MAP[detail.recurrence]}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Primeiro envio</span>
                  <p className="font-medium text-foreground">{formatDate(detail.scheduledAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Próximo envio</span>
                  <p className="font-medium text-foreground">{detail.nextExecutionAt ? formatDate(detail.nextExecutionAt) : '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Enviados</span>
                  <p className="font-medium text-green-600">{detail.totalSent}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Falhas</span>
                  <p className="font-medium text-red-500">{detail.totalFailed}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Criado por</span>
                  <p className="font-medium text-foreground">{detail.createdBy?.name || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Timezone</span>
                  <p className="font-medium text-foreground">{detail.timezone}</p>
                </div>
              </div>

              {/* Conteúdo */}
              {detail.content && (
                <div>
                  <span className="text-sm text-muted-foreground">Conteúdo</span>
                  <div className="mt-1 p-3 rounded-lg bg-muted text-sm text-foreground whitespace-pre-wrap">
                    {detail.content}
                  </div>
                </div>
              )}

              {/* Erro */}
              {detail.errorMessage && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {detail.errorMessage}
                </div>
              )}

              {/* Histórico de envios */}
              {detail.logs && detail.logs.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">Histórico de envios</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {detail.logs.map(log => (
                      <div
                        key={log.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg text-sm ${log.status === 'SENT'
                          ? 'bg-green-50 dark:bg-green-900/10'
                          : 'bg-red-50 dark:bg-red-900/10'
                        }`}
                      >
                        {log.status === 'SENT' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground">{formatDate(log.executedAt)}</span>
                            {log.aiUsed && (
                              <span className="flex items-center gap-0.5 text-[10px] text-purple-600 dark:text-purple-400">
                                <Sparkles className="h-3 w-3" /> IA
                              </span>
                            )}
                          </div>
                          {log.error && <p className="text-xs text-red-500 mt-0.5 truncate">{log.error}</p>}
                          {log.content && log.aiUsed && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate" title={log.content}>
                              IA: {log.content}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <div className="flex items-center gap-2">
                {detail.status === 'ACTIVE' && (
                  <button
                    onClick={() => { updateMutation.mutate({ id: detail.id, data: { status: 'PAUSED' } }); setDetailId(null) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-yellow-300 text-yellow-700 text-sm hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors"
                  >
                    <Pause className="h-4 w-4" /> Pausar
                  </button>
                )}
                {detail.status === 'PAUSED' && (
                  <button
                    onClick={() => { updateMutation.mutate({ id: detail.id, data: { status: 'ACTIVE' } }); setDetailId(null) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-300 text-green-700 text-sm hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                  >
                    <Play className="h-4 w-4" /> Reativar
                  </button>
                )}
                {(detail.status === 'ACTIVE' || detail.status === 'PAUSED') && (
                  <button
                    onClick={() => { updateMutation.mutate({ id: detail.id, data: { status: 'CANCELLED' } }); setDetailId(null) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/20 transition-colors"
                  >
                    <XCircle className="h-4 w-4" /> Cancelar
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setDetailId(null); openEdit(detail) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-muted transition-colors"
                >
                  <Edit2 className="h-4 w-4" /> Editar
                </button>
                <button
                  onClick={() => { duplicateMutation.mutate(detail.id); setDetailId(null) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-muted transition-colors"
                >
                  <Copy className="h-4 w-4" /> Duplicar
                </button>
                <button
                  onClick={() => { if (confirm('Remover este agendamento permanentemente?')) { deleteMutation.mutate(detail.id) } }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="h-4 w-4" /> Remover
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
