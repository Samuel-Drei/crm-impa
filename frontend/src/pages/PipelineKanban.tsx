import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Kanban, Plus, Settings2, BarChart3, Search, Filter, ChevronDown,
  GripVertical, MoreHorizontal, User as UserIcon, Phone, DollarSign,
  Clock, Tag, CheckSquare, MessageSquare, Paperclip, Trash2, Trophy,
  XCircle, ArrowRight, Eye
} from 'lucide-react'
import api from '@/services/api'
import {
  getPipelines, getCards, createCard, moveCard, deleteCard,
  markCardWon, markCardLost, getPipelineMetrics
} from '@/services/pipeline.service'
import { getSocket, connectSocket, joinPipeline, leavePipeline } from '@/services/socket'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { useModuleStore } from '@/stores/module.store'
import type { Pipeline, Stage, Card, CardStatus, CardPriority, PipelineMetrics } from '@/types'
import { CardDetailPanel } from './CardDetail'

const PRIORITY_COLORS: Record<CardPriority, string> = {
  NONE: '',
  LOW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  MEDIUM: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  HIGH: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  URGENT: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

const PRIORITY_LABELS: Record<CardPriority, string> = {
  NONE: '-', LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente',
}

function formatCurrency(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

export function PipelineKanban() {
  const toast = useToast()
  const { can } = usePermissions()
  const [searchParams] = useSearchParams()
  const typeFilter = searchParams.get('type')
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<CardStatus | ''>('')
  const [filterPriority, setFilterPriority] = useState<CardPriority | ''>('')
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null) // stageId
  const [newCardTitle, setNewCardTitle] = useState('')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null)
  const [showMetrics, setShowMetrics] = useState(false)
  const [draggingCard, setDraggingCard] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const { getCustomFields, getStageValidations } = useModuleStore()
  const moduleCardFields = getCustomFields('card')

  // Load pipelines
  useEffect(() => {
    loadPipelines()
  }, [])

  // Load cards when pipeline changes
  useEffect(() => {
    if (selectedPipelineId) {
      loadPipelineData()
    }
  }, [selectedPipelineId])

  // Real-time updates via Socket.IO
  useEffect(() => {
    if (!selectedPipelineId) return

    connectSocket()
    const socket = getSocket()
    joinPipeline(selectedPipelineId)

    const onCardCreated = (data: { pipelineId: string; card: Card }) => {
      if (data.pipelineId !== selectedPipelineId) return
      setCards(prev => {
        if (prev.some(c => c.id === data.card.id)) return prev
        return [...prev, data.card]
      })
    }

    const onCardUpdated = (data: { pipelineId: string; card: Card }) => {
      if (data.pipelineId !== selectedPipelineId) return
      setCards(prev => prev.map(c => c.id === data.card.id ? { ...c, ...data.card } : c))
    }

    const onCardMoved = (data: { pipelineId: string; card: Card; oldStageId: string; newStageId: string }) => {
      if (data.pipelineId !== selectedPipelineId) return
      setCards(prev => prev.map(c => c.id === data.card.id ? { ...c, ...data.card } : c))
    }

    const onCardDeleted = (data: { pipelineId: string; cardId: string }) => {
      if (data.pipelineId !== selectedPipelineId) return
      setCards(prev => prev.filter(c => c.id !== data.cardId))
    }

    socket.on('pipeline:card-created', onCardCreated)
    socket.on('pipeline:card-updated', onCardUpdated)
    socket.on('pipeline:card-moved', onCardMoved)
    socket.on('pipeline:card-deleted', onCardDeleted)

    return () => {
      leavePipeline(selectedPipelineId)
      socket.off('pipeline:card-created', onCardCreated)
      socket.off('pipeline:card-updated', onCardUpdated)
      socket.off('pipeline:card-moved', onCardMoved)
      socket.off('pipeline:card-deleted', onCardDeleted)
    }
  }, [selectedPipelineId])

  async function loadPipelines() {
    try {
      const data = await getPipelines()
      setPipelines(data)
      if (data.length > 0) {
        // Auto-select pipeline by type if query param is present
        let target = typeFilter ? data.find((p: any) => p.type === typeFilter) : null
        if (!target) target = data.find((p: any) => p.isDefault) || data[0]
        setSelectedPipelineId(target.id)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadPipelineData() {
    try {
      const [pipelineRes, cardsRes] = await Promise.all([
        api.get(`/pipelines/${selectedPipelineId}`),
        getCards(selectedPipelineId, { limit: 200 }),
      ])
      setPipeline(pipelineRes.data.pipeline)
      setCards(cardsRes.cards)
    } catch (e) {
      console.error(e)
    }
  }

  async function loadMetrics() {
    if (!selectedPipelineId) return
    try {
      const m = await getPipelineMetrics(selectedPipelineId)
      setMetrics(m)
      setShowMetrics(true)
    } catch (e) {
      console.error(e)
    }
  }

  // Drag and drop (HTML5 native)
  const handleDragStart = useCallback((e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('text/plain', cardId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingCard(cardId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageId)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverStage(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault()
    setDragOverStage(null)
    setDraggingCard(null)

    const cardId = e.dataTransfer.getData('text/plain')
    if (!cardId) return

    const card = cards.find(c => c.id === cardId)
    if (!card || card.stageId === targetStageId) return

    // Module stage validation
    const targetStage = pipeline?.stages.find(s => s.id === targetStageId)
    if (targetStage?.slug) {
      const validations = getStageValidations(targetStage.slug)
      if (validations.length > 0) {
        const customFields = card.customFields || {}
        for (const v of validations) {
          for (const rule of v.rules) {
            const value = customFields[rule.field]
            if (rule.operator === 'not_empty' && (!value || value === '')) {
              const fieldDef = moduleCardFields.find(f => f.key === rule.field)
              toast.error(`Campo "${fieldDef?.label || rule.field}" é obrigatório para mover para "${targetStage.name}"`)
              return
            }
          }
        }
      }
    }

    // Optimistic update
    const stageCards = cards.filter(c => c.stageId === targetStageId)
    const newPosition = stageCards.length

    setCards(prev => prev.map(c =>
      c.id === cardId
        ? { ...c, stageId: targetStageId, position: newPosition, stage: pipeline?.stages.find(s => s.id === targetStageId) ? { id: targetStageId, name: pipeline.stages.find(s => s.id === targetStageId)!.name, slug: pipeline.stages.find(s => s.id === targetStageId)!.slug, color: pipeline.stages.find(s => s.id === targetStageId)!.color } : c.stage }
        : c
    ))

    try {
      await moveCard(cardId, targetStageId, newPosition)
      // Reload to get server state
      loadPipelineData()
    } catch (err) {
      // Revert
      loadPipelineData()
      toast.error('Erro ao mover card')
    }
  }, [cards, pipeline])

  const handleDragEnd = useCallback(() => {
    setDraggingCard(null)
    setDragOverStage(null)
  }, [])

  // Create card
  async function handleQuickCreate(stageId: string) {
    if (!newCardTitle.trim() || !selectedPipelineId) return
    try {
      await createCard(selectedPipelineId, { title: newCardTitle.trim(), stageId })
      setNewCardTitle('')
      setShowCreateForm(null)
      loadPipelineData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao criar card')
    }
  }

  // Delete card
  async function handleDeleteCard(cardId: string) {
    if (!await toast.confirm({ title: 'Excluir card', message: 'Tem certeza que deseja excluir este card?', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteCard(cardId)
      loadPipelineData()
    } catch (e) {
      toast.error('Erro ao excluir card')
    }
  }

  // Won/Lost
  async function handleWon(cardId: string) {
    try {
      await markCardWon(cardId)
      loadPipelineData()
      toast.success('Card marcado como ganho!')
    } catch (e) { toast.error('Erro ao marcar card') }
  }

  async function handleLost(cardId: string) {
    try {
      await markCardLost(cardId)
      loadPipelineData()
      toast.success('Card marcado como perdido')
    } catch (e) { toast.error('Erro ao marcar card') }
  }

  // Filter cards
  const filteredCards = cards.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false
    if (filterPriority && c.priority !== filterPriority) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return c.title.toLowerCase().includes(term) ||
        c.contact?.name?.toLowerCase().includes(term) ||
        c.description?.toLowerCase().includes(term)
    }
    return true
  })

  function getStageCards(stageId: string) {
    return filteredCards.filter(c => c.stageId === stageId).sort((a, b) => a.position - b.position)
  }

  function getStageTotalValue(stageId: string) {
    return getStageCards(stageId).reduce((sum, c) => sum + Number(c.value || 0), 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (pipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] gap-4">
        <Kanban className="h-16 w-16 text-muted-foreground/50" />
        <h2 className="text-xl font-semibold text-foreground">Nenhum pipeline criado</h2>
        <p className="text-muted-foreground">Vá em Configurações de Pipelines para criar seu primeiro pipeline.</p>
        {can('pipelines:manage') && (
          <a href="/pipelines/settings" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            Criar Pipeline
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Kanban className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Pipeline</h1>
          {/* Pipeline selector */}
          <select
            className="ml-2 px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            value={selectedPipelineId}
            onChange={e => setSelectedPipelineId(e.target.value)}
          >
            {pipelines.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar cards..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-48 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Filter status */}
          <select
            className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as CardStatus | '')}
          >
            <option value="">Todos status</option>
            <option value="OPEN">Aberto</option>
            <option value="WON">Ganho</option>
            <option value="LOST">Perdido</option>
          </select>

          {/* Filter priority */}
          <select
            className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none"
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value as CardPriority | '')}
          >
            <option value="">Todas prioridades</option>
            <option value="LOW">Baixa</option>
            <option value="MEDIUM">Média</option>
            <option value="HIGH">Alta</option>
            <option value="URGENT">Urgente</option>
          </select>

          {/* Metrics */}
          <button
            onClick={loadMetrics}
            className="p-2 rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Métricas"
          >
            <BarChart3 className="h-4 w-4" />
          </button>

          {/* Pipeline settings */}
          {can('pipelines:manage') && (
            <a
              href="/pipelines/settings"
              className="p-2 rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Configurações do Pipeline"
            >
              <Settings2 className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {/* Metrics bar */}
      {showMetrics && metrics && (
        <div className="flex items-center gap-6 px-4 py-2 bg-muted/50 border-b border-border text-sm">
          <span className="text-muted-foreground">Total: <strong className="text-foreground">{metrics.totalCards}</strong></span>
          <span className="text-muted-foreground">Abertos: <strong className="text-blue-600 dark:text-blue-400">{metrics.openCards}</strong></span>
          <span className="text-muted-foreground">Ganhos: <strong className="text-green-600 dark:text-green-400">{metrics.wonCards}</strong></span>
          <span className="text-muted-foreground">Perdidos: <strong className="text-red-600 dark:text-red-400">{metrics.lostCards}</strong></span>
          <span className="text-muted-foreground">Conversão: <strong className="text-foreground">{metrics.conversionRate}%</strong></span>
          <span className="text-muted-foreground">Valor aberto: <strong className="text-foreground">{formatCurrency(metrics.totalOpenValue)}</strong></span>
          <span className="text-muted-foreground">Valor ganho: <strong className="text-green-600 dark:text-green-400">{formatCurrency(metrics.totalWonValue)}</strong></span>
          <button onClick={() => setShowMetrics(false)} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      {/* Kanban Board */}
      <div ref={boardRef} className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-0 min-w-max">
          {pipeline?.stages
            .sort((a, b) => a.position - b.position)
            .map(stage => {
              const stageCards = getStageCards(stage.id)
              const stageValue = getStageTotalValue(stage.id)
              const isOver = dragOverStage === stage.id

              return (
                <div
                  key={stage.id}
                  className={`flex flex-col w-[300px] border-r border-border last:border-r-0 transition-colors ${
                    isOver ? 'bg-primary/5' : 'bg-background'
                  }`}
                  onDragOver={e => handleDragOver(e, stage.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, stage.id)}
                >
                  {/* Stage header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color || '#6b7280' }} />
                      <h3 className="text-sm font-medium text-foreground truncate">{stage.name}</h3>
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                        {stageCards.length}
                      </span>
                    </div>
                    {stageValue > 0 && (
                      <span className="text-xs text-muted-foreground font-medium">
                        {formatCurrency(stageValue)}
                      </span>
                    )}
                  </div>

                  {/* Cards list */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageCards.map(card => (
                      <KanbanCard
                        key={card.id}
                        card={card}
                        isDragging={draggingCard === card.id}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedCardId(card.id)}
                        onDelete={() => handleDeleteCard(card.id)}
                        onWon={() => handleWon(card.id)}
                        onLost={() => handleLost(card.id)}
                        canWrite={can('cards:write')}
                        canDelete={can('cards:delete')}
                        canMove={can('cards:move')}
                      />
                    ))}

                    {/* Quick create */}
                    {can('cards:write') && (
                      showCreateForm === stage.id ? (
                        <div className="p-2 bg-card rounded-lg border border-border shadow-sm">
                          <input
                            type="text"
                            autoFocus
                            placeholder="Título do card..."
                            value={newCardTitle}
                            onChange={e => setNewCardTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleQuickCreate(stage.id)
                              if (e.key === 'Escape') { setShowCreateForm(null); setNewCardTitle('') }
                            }}
                            className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              onClick={() => handleQuickCreate(stage.id)}
                              className="px-3 py-1 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90"
                            >
                              Criar
                            </button>
                            <button
                              onClick={() => { setShowCreateForm(null); setNewCardTitle('') }}
                              className="px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCreateForm(stage.id)}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Adicionar card
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* Card Detail Panel */}
      {selectedCardId && (
        <CardDetailPanel
          cardId={selectedCardId}
          onClose={() => setSelectedCardId(null)}
          onUpdate={loadPipelineData}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════
// KanbanCard component
// ══════════════════════════════════════
interface KanbanCardProps {
  card: Card
  isDragging: boolean
  onDragStart: (e: React.DragEvent, cardId: string) => void
  onDragEnd: () => void
  onClick: () => void
  onDelete: () => void
  onWon: () => void
  onLost: () => void
  canWrite: boolean
  canDelete: boolean
  canMove: boolean
}

function KanbanCard({ card, isDragging, onDragStart, onDragEnd, onClick, onDelete, onWon, onLost, canWrite, canDelete, canMove }: KanbanCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const { getCustomFields } = useModuleStore()
  const moduleFields = getCustomFields('card')
  const customFields = card.customFields || {}
  // Show up to 2 filled custom fields
  const visibleFields = moduleFields
    .filter(f => customFields[f.key] != null && customFields[f.key] !== '')
    .slice(0, 2)

  return (
    <div
      draggable={canMove}
      onDragStart={e => onDragStart(e, card.id)}
      onDragEnd={onDragEnd}
      className={`group relative bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isDragging ? 'opacity-50 rotate-2 scale-95' : ''
      } ${card.status === 'WON' ? 'border-l-2 border-l-green-500' : card.status === 'LOST' ? 'border-l-2 border-l-red-500' : ''}`}
      onClick={onClick}
    >
      {/* Priority indicator */}
      {card.priority !== 'NONE' && (
        <div className={`px-2 py-0.5 text-[10px] font-medium rounded-t-lg ${PRIORITY_COLORS[card.priority]}`}>
          {PRIORITY_LABELS[card.priority]}
        </div>
      )}

      <div className="p-2.5">
        {/* Title + menu */}
        <div className="flex items-start justify-between gap-1">
          <h4 className="text-sm font-medium text-foreground leading-tight line-clamp-2">{card.title}</h4>
          {(canWrite || canDelete) && (
            <div className="relative flex-shrink-0">
              <button
                onClick={e => { e.stopPropagation(); setShowMenu(!showMenu) }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
              >
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-36 bg-popover border border-border rounded-lg shadow-lg py-1">
                    <button
                      onClick={e => { e.stopPropagation(); setShowMenu(false); onClick() }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      <Eye className="h-3 w-3" /> Ver detalhe
                    </button>
                    {canWrite && card.status === 'OPEN' && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); setShowMenu(false); onWon() }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-green-600 hover:bg-accent"
                        >
                          <Trophy className="h-3 w-3" /> Marcar Ganho
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setShowMenu(false); onLost() }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-accent"
                        >
                          <XCircle className="h-3 w-3" /> Marcar Perdido
                        </button>
                      </>
                    )}
                    {canDelete && (
                      <button
                        onClick={e => { e.stopPropagation(); setShowMenu(false); onDelete() }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-accent"
                      >
                        <Trash2 className="h-3 w-3" /> Excluir
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Value */}
        {card.value && card.value > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            <DollarSign className="h-3 w-3 text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              {formatCurrency(card.value, card.currency)}
            </span>
          </div>
        )}

        {/* Contact */}
        {card.contact && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {card.contact.profilePicture ? (
              <img src={card.contact.profilePicture} className="h-4 w-4 rounded-full" alt="" />
            ) : (
              <UserIcon className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground truncate">{card.contact.name}</span>
          </div>
        )}

        {/* Tags */}
        {card.tags && card.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {card.tags.slice(0, 3).map(tag => (
              <span
                key={tag.id}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: tag.label?.color + '20', color: tag.label?.color }}
              >
                {tag.label?.title}
              </span>
            ))}
            {card.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{card.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Module custom fields summary */}
        {visibleFields.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {visibleFields.map(f => (
              <div key={f.key} className="flex items-center gap-1 text-[10px]">
                <span className="text-muted-foreground truncate">{f.label}:</span>
                <span className="text-foreground font-medium truncate">
                  {f.type === 'currency' ? `R$ ${customFields[f.key]}` :
                   f.type === 'boolean' ? (customFields[f.key] ? 'Sim' : 'Não') :
                   String(customFields[f.key])}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer: assignee + counts */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/50">
          <div className="flex items-center gap-1">
            {card.assignee ? (
              <div className="flex items-center gap-1" title={card.assignee.name}>
                <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-[9px] font-medium text-primary">{card.assignee.name.charAt(0).toUpperCase()}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            {card._count?.tasks ? (
              <span className="flex items-center gap-0.5 text-[10px]">
                <CheckSquare className="h-2.5 w-2.5" /> {card._count.tasks}
              </span>
            ) : null}
            {card._count?.notes ? (
              <span className="flex items-center gap-0.5 text-[10px]">
                <MessageSquare className="h-2.5 w-2.5" /> {card._count.notes}
              </span>
            ) : null}
            {card._count?.files ? (
              <span className="flex items-center gap-0.5 text-[10px]">
                <Paperclip className="h-2.5 w-2.5" /> {card._count.files}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
