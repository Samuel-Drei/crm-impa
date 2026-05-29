import { useState, useEffect } from 'react'
import {
  X, User as UserIcon, Phone, Mail, DollarSign, Calendar, Tag, Clock,
  CheckSquare, MessageSquare, Paperclip, Activity, Plus, ChevronDown,
  Trophy, XCircle, Trash2, Edit2, Save, CheckCircle, Circle
} from 'lucide-react'
import {
  getCard, updateCard, getCardActivities, addCardNote, addCardTask,
  updateCardTask, addCardTag, removeCardTag
} from '@/services/pipeline.service'
import api from '@/services/api'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { useModuleStore } from '@/stores/module.store'
import { DynamicFieldRenderer } from '@/components/DynamicFieldRenderer'
import type { Card, CardActivity, CardTask, CardNote, Label } from '@/types'

const PRIORITY_OPTIONS = [
  { value: 'NONE', label: '-' },
  { value: 'LOW', label: 'Baixa' },
  { value: 'MEDIUM', label: 'Média' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
]

function formatCurrency(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  cardId: string
  onClose: () => void
  onUpdate: () => void
}

export function CardDetailPanel({ cardId, onClose, onUpdate }: Props) {
  const toast = useToast()
  const { can } = usePermissions()
  const { getCustomFields, getCardTabs } = useModuleStore()
  const moduleCardFields = getCustomFields('card')
  const moduleCardTabs = getCardTabs()
  const [card, setCard] = useState<Card | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('details')
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({})
  const [activities, setActivities] = useState<CardActivity[]>([])
  const [labels, setLabels] = useState<Label[]>([])

  // Edit states
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [editingValue, setEditingValue] = useState(false)
  const [valueDraft, setValueDraft] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [showTagPicker, setShowTagPicker] = useState(false)

  useEffect(() => {
    loadCard()
    loadLabels()
  }, [cardId])

  async function loadCard() {
    setLoading(true)
    try {
      const c = await getCard(cardId)
      setCard(c)
      setCustomFieldValues(c.customFields || {})
      setTitleDraft(c.title)
      setDescDraft(c.description || '')
      setValueDraft(String(c.value || ''))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadActivities() {
    try {
      const data = await getCardActivities(cardId)
      setActivities(data.activities)
    } catch (e) { console.error(e) }
  }

  async function loadLabels() {
    try {
      const res = await api.get('/labels')
      setLabels(res.data.labels)
    } catch (e) { console.error(e) }
  }

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === card?.title) {
      setEditingTitle(false)
      return
    }
    try {
      await updateCard(cardId, { title: titleDraft.trim() } as any)
      setCard(prev => prev ? { ...prev, title: titleDraft.trim() } : null)
      setEditingTitle(false)
      onUpdate()
    } catch (e) { toast.error('Erro ao salvar título') }
  }

  async function saveDescription() {
    try {
      await updateCard(cardId, { description: descDraft || null } as any)
      setCard(prev => prev ? { ...prev, description: descDraft || undefined } : null)
      setEditingDesc(false)
      onUpdate()
    } catch (e) { toast.error('Erro ao salvar descrição') }
  }

  async function saveValue() {
    const val = valueDraft ? parseFloat(valueDraft) : null
    try {
      await updateCard(cardId, { value: val } as any)
      setCard(prev => prev ? { ...prev, value: val || undefined } : null)
      setEditingValue(false)
      onUpdate()
    } catch (e) { toast.error('Erro ao salvar valor') }
  }

  async function handlePriorityChange(priority: string) {
    try {
      await updateCard(cardId, { priority } as any)
      setCard(prev => prev ? { ...prev, priority: priority as any } : null)
      onUpdate()
    } catch (e) { toast.error('Erro ao salvar prioridade') }
  }

  async function saveCustomFields(key: string, value: any) {
    const updated = { ...customFieldValues, [key]: value }
    setCustomFieldValues(updated)
    try {
      await updateCard(cardId, { customFields: updated } as any)
      setCard(prev => prev ? { ...prev, customFields: updated } : null)
    } catch (e) { toast.error('Erro ao salvar campo personalizado') }
  }

  async function handleAddNote() {
    if (!newNote.trim()) return
    try {
      await addCardNote(cardId, newNote.trim())
      setNewNote('')
      loadCard()
    } catch (e) { toast.error('Erro ao adicionar nota') }
  }

  async function handleAddTask() {
    if (!newTaskTitle.trim()) return
    try {
      await addCardTask(cardId, { title: newTaskTitle.trim() })
      setNewTaskTitle('')
      loadCard()
    } catch (e) { toast.error('Erro ao adicionar tarefa') }
  }

  async function handleToggleTask(task: CardTask) {
    try {
      await updateCardTask(cardId, task.id, { isCompleted: !task.isCompleted })
      loadCard()
    } catch (e) { toast.error('Erro ao atualizar tarefa') }
  }

  async function handleAddTag(labelId: string) {
    try {
      await addCardTag(cardId, labelId)
      loadCard()
      onUpdate()
      setShowTagPicker(false)
    } catch (e) { toast.error('Erro ao adicionar etiqueta') }
  }

  async function handleRemoveTag(labelId: string) {
    try {
      await removeCardTag(cardId, labelId)
      loadCard()
      onUpdate()
    } catch (e) { toast.error('Erro ao remover etiqueta') }
  }

  if (loading) {
    return (
      <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 flex items-center justify-center">
        <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!card) return null

  const cardTags = card.tags || []
  const cardTasks = card.tasks || []
  const cardNotes = card.notes || []
  const completedTasks = cardTasks.filter(t => t.isCompleted).length
  const existingTagIds = new Set(cardTags.map(t => t.labelId))
  const availableLabels = labels.filter(l => !existingTagIds.has(l.id))

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: card.stage?.color || '#6b7280' }} />
            <span className="text-sm text-muted-foreground">{card.pipeline?.name} → {card.stage?.name}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Title */}
            {editingTitle && can('cards:write') ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                  className="flex-1 text-lg font-semibold px-2 py-1 border border-primary/50 rounded bg-background focus:outline-none"
                />
                <button onClick={saveTitle} className="p-1 text-primary hover:bg-primary/10 rounded"><Save className="h-4 w-4" /></button>
              </div>
            ) : (
              <h2
                className="text-lg font-semibold text-foreground cursor-pointer hover:text-primary/80 transition-colors"
                onClick={() => can('cards:write') && setEditingTitle(true)}
              >
                {card.title}
                {card.status === 'WON' && <Trophy className="inline ml-2 h-4 w-4 text-green-500" />}
                {card.status === 'LOST' && <XCircle className="inline ml-2 h-4 w-4 text-red-500" />}
              </h2>
            )}

            {/* Description */}
            {editingDesc && can('cards:write') ? (
              <div>
                <textarea
                  autoFocus
                  rows={4}
                  value={descDraft}
                  onChange={e => setDescDraft(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Descrição..."
                />
                <div className="flex gap-2 mt-1">
                  <button onClick={saveDescription} className="px-3 py-1 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90">Salvar</button>
                  <button onClick={() => setEditingDesc(false)} className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => can('cards:write') && setEditingDesc(true)}
                className="text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 rounded p-2 -m-2"
              >
                {card.description || 'Clique para adicionar descrição...'}
              </div>
            )}

            {/* Properties grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Value */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Valor
                </label>
                {editingValue && can('cards:write') ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      type="number"
                      step="0.01"
                      value={valueDraft}
                      onChange={e => setValueDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveValue(); if (e.key === 'Escape') setEditingValue(false) }}
                      className="w-full px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none"
                    />
                    <button onClick={saveValue} className="px-2 text-primary"><Save className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <p
                    className="text-sm font-medium cursor-pointer hover:text-primary"
                    onClick={() => can('cards:write') && setEditingValue(true)}
                  >
                    {card.value ? formatCurrency(card.value, card.currency) : '-'}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Prioridade</label>
                <select
                  value={card.priority}
                  onChange={e => handlePriorityChange(e.target.value)}
                  disabled={!can('cards:write')}
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none"
                >
                  {PRIORITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Contact */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <UserIcon className="h-3 w-3" /> Contato
                </label>
                <p className="text-sm">{card.contact?.name || '-'}</p>
                {card.contact?.phoneNumber && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-2.5 w-2.5" /> {card.contact.phoneNumber}
                  </p>
                )}
              </div>

              {/* Assignee */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Responsável</label>
                <p className="text-sm">{card.assignee?.name || '-'}</p>
              </div>

              {/* Team */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Time</label>
                <p className="text-sm">{card.team?.name || '-'}</p>
              </div>

              {/* Expected close */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Fechamento previsto
                </label>
                <p className="text-sm">{card.expectedCloseDate ? new Date(card.expectedCloseDate).toLocaleDateString('pt-BR') : '-'}</p>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Etiquetas
                </label>
                {can('cards:write') && (
                  <button
                    onClick={() => setShowTagPicker(!showTagPicker)}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cardTags.map(tag => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                    style={{ backgroundColor: tag.label?.color + '20', color: tag.label?.color }}
                  >
                    {tag.label?.title}
                    {can('cards:write') && (
                      <button onClick={() => handleRemoveTag(tag.labelId)} className="hover:opacity-70">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                ))}
                {cardTags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma etiqueta</span>}
              </div>
              {showTagPicker && availableLabels.length > 0 && (
                <div className="border border-border rounded-lg p-2 bg-background space-y-1 max-h-32 overflow-y-auto">
                  {availableLabels.map(l => (
                    <button
                      key={l.id}
                      onClick={() => handleAddTag(l.id)}
                      className="w-full flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-muted"
                    >
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                      {l.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Module custom fields */}
          {moduleCardFields.length > 0 && (
            <div className="px-4 pb-2">
              <DynamicFieldRenderer
                fields={moduleCardFields}
                values={customFieldValues}
                onChange={saveCustomFields}
                readOnly={!can('cards:write')}
              />
            </div>
          )}

          {/* Tabs */}
          <div className="border-t border-border">
            <div className="flex border-b border-border overflow-x-auto">
              {(['details', 'tasks', 'notes', 'activity', ...moduleCardTabs.map(t => t.key)]).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); if (tab === 'activity') loadActivities() }}
                  className={`flex-1 px-3 py-2 text-xs font-medium text-center transition-colors ${
                    activeTab === tab
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'details' && 'Info'}
                  {tab === 'tasks' && `Tarefas (${cardTasks.length})`}
                  {tab === 'notes' && `Notas (${cardNotes.length})`}
                  {tab === 'activity' && 'Atividade'}
                  {!['details', 'tasks', 'notes', 'activity'].includes(tab) && moduleCardTabs.find(t => t.key === tab)?.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {/* Details tab */}
              {activeTab === 'details' && (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`font-medium ${card.status === 'WON' ? 'text-green-600' : card.status === 'LOST' ? 'text-red-600' : 'text-foreground'}`}>
                      {card.status === 'OPEN' ? 'Aberto' : card.status === 'WON' ? 'Ganho' : card.status === 'LOST' ? 'Perdido' : 'Arquivado'}
                    </span>
                  </div>
                  {card.wonAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ganho em</span>
                      <span>{formatDate(card.wonAt)}</span>
                    </div>
                  )}
                  {card.lostAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Perdido em</span>
                      <span>{formatDate(card.lostAt)}</span>
                    </div>
                  )}
                  {card.lostReason && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Motivo</span>
                      <span>{card.lostReason}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Criado em</span>
                    <span>{formatDate(card.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Atualizado em</span>
                    <span>{formatDate(card.updatedAt)}</span>
                  </div>
                  {card.source && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Origem</span>
                      <span>{card.source}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tasks tab */}
              {activeTab === 'tasks' && (
                <div className="space-y-3">
                  {cardTasks.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {completedTasks}/{cardTasks.length} concluídas
                      <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${cardTasks.length > 0 ? (completedTasks / cardTasks.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {cardTasks.map(task => (
                    <div key={task.id} className="flex items-start gap-2 group">
                      <button
                        onClick={() => handleToggleTask(task)}
                        className="mt-0.5 flex-shrink-0"
                        disabled={!can('cards:write')}
                      >
                        {task.isCompleted
                          ? <CheckCircle className="h-4 w-4 text-green-500" />
                          : <Circle className="h-4 w-4 text-muted-foreground hover:text-primary" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${task.isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {task.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {task.assignee && (
                            <span className="text-[10px] text-muted-foreground">{task.assignee.name}</span>
                          )}
                          {task.dueDate && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {can('cards:write') && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Nova tarefa..."
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddTask() }}
                        className="flex-1 px-2 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={handleAddTask}
                        className="px-2 py-1.5 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Notes tab */}
              {activeTab === 'notes' && (
                <div className="space-y-3">
                  {can('cards:write') && (
                    <div>
                      <textarea
                        rows={3}
                        placeholder="Adicionar nota..."
                        value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={!newNote.trim()}
                        className="mt-1 px-3 py-1 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 disabled:opacity-50"
                      >
                        Adicionar
                      </button>
                    </div>
                  )}

                  {cardNotes.map(note => (
                    <div key={note.id} className="p-2.5 bg-muted/50 rounded-lg border border-border/50">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{note.author?.name}</span>
                        <span>•</span>
                        <span>{formatDate(note.createdAt)}</span>
                        {note.isPrivate && <span className="px-1 py-0.5 bg-yellow-500/10 text-yellow-600 rounded text-[9px]">Privada</span>}
                      </div>
                    </div>
                  ))}

                  {cardNotes.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhuma nota adicionada</p>
                  )}
                </div>
              )}

              {/* Activity tab */}
              {activeTab === 'activity' && (
                <div className="space-y-3">
                  {activities.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhuma atividade registrada</p>
                  )}
                  {activities.map(act => (
                    <div key={act.id} className="flex items-start gap-2">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">{act.content}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          {act.actorName && <span>{act.actorName}</span>}
                          <span>{formatDate(act.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Module tabs */}
              {moduleCardTabs.map(mTab => (
                activeTab === mTab.key && (
                  <div key={mTab.key} className="space-y-3">
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Conteúdo do módulo "{mTab.label}" será exibido aqui quando configurado.
                    </p>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
