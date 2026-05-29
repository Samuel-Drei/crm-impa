import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  ReactFlowProvider,
  ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  Save,
  Play,
  Pause,
  Settings,
  Loader2,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Edit3,
  Activity,
  Clock,
  RefreshCw,
  MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { nodeTypes } from '@/components/flow-builder/CustomNodes'
import CustomEdge from '@/components/flow-builder/CustomEdge'

const edgeTypes = {
  custom: CustomEdge,
  smoothstep: CustomEdge,
  step: CustomEdge,
  straight: CustomEdge,
  bezier: CustomEdge,
  simpleBezier: CustomEdge,
}

const getReactFlowBackgroundVariant = (variant: BuilderBackgroundVariant) => {
  switch (variant) {
    case 'lines':
      return BackgroundVariant.Lines
    case 'cross':
      return BackgroundVariant.Cross
    case 'dots':
    case 'none':
    default:
      return BackgroundVariant.Dots
  }
}
import { NodesSidebar } from '@/components/flow-builder/NodesSidebar'
import { NodeProperties } from '@/components/flow-builder/NodeProperties'
import { getFlowContextMenuPosition } from '@/lib/flowContextMenu'
import { cn } from '@/lib/utils'
import {
  getBuilderEdgeMarkers,
  getBuilderEdgeStyle,
  normalizeBuilderSettings,
  type BuilderBackgroundVariant,
  type BuilderSettings,
} from '@/lib/builderSettings'
import {
  areFlowHistoryValuesEqual,
  canRedoFlowHistory,
  canUndoFlowHistory,
  cloneFlowHistoryValue,
  createFlowHistory,
  pushFlowHistory,
  redoFlowHistory,
  undoFlowHistory,
  type FlowHistory,
} from '@/lib/flowHistory'
import {
  applyFlowExecutionView,
  getFlowExecutionReplaySession,
  getFlowExecutionSnapshotElements,
  getFlowExecutionStatusClassName,
  getFlowExecutionStatusLabel,
  getFlowExecutionTraceNodeIds,
  type FlowExecutionMode,
  type FlowExecutionSession,
} from '@/lib/flowExecutionView'
import api from '@/services/api'
import type { FlowWithDetails, FlowNodeData, FlowTriggerType, Instance } from '@/types'

type FlowEditorNode = Node<FlowNodeData>
type FlowEditorEdge = Edge
type FlowHistorySnapshot = {
  nodes: FlowEditorNode[]
  edges: FlowEditorEdge[]
}
type NodeContextMenu = {
  node: FlowEditorNode
  x: number
  y: number
}

const createDefaultNodeData = (type: string): FlowNodeData => {
  if (type === 'CAROUSEL') {
    return {
      label: type,
      content: '',
      footer: '',
      carouselCards: [
        {
          id: `card_${Date.now()}`,
          header: { title: '', subtitle: '', imageUrl: '', videoUrl: '' },
          body: { text: '' },
          footer: '',
          buttons: [{ id: `card_btn_${Date.now()}`, text: '', buttonType: 'reply' }],
        },
      ],
    }
  }

  return { label: type }
}

const createCanvasSnapshot = (
  nodes: FlowEditorNode[],
  edges: FlowEditorEdge[]
): FlowHistorySnapshot => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { ...node.position },
    data: cloneFlowHistoryValue(node.data),
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: edge.type,
    animated: edge.animated,
    style: cloneFlowHistoryValue(edge.style),
    markerEnd: cloneFlowHistoryValue(edge.markerEnd),
    data: cloneFlowHistoryValue(edge.data),
  })),
})

const isTextEditingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  if (!element) return false

  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable ||
    Boolean(element.closest('[contenteditable="true"]'))
  )
}

const formatExecutionDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

type FlowExecutionsSidebarProps = {
  sessions: FlowExecutionSession[]
  selectedSessionId: string | null
  isLoading: boolean
  onSelectSession: (sessionId: string) => void
  onStopSession: (session: FlowExecutionSession) => void
  onDeleteSession: (session: FlowExecutionSession) => void
  onRefresh: () => void
  getNodeLabel: (nodeId?: string | null) => string
  stoppingSessionId?: string | null
  deletingSessionId?: string | null
}

function FlowExecutionsSidebar({
  sessions,
  selectedSessionId,
  isLoading,
  onSelectSession,
  onStopSession,
  onDeleteSession,
  onRefresh,
  getNodeLabel,
  stoppingSessionId,
  deletingSessionId,
}: FlowExecutionsSidebarProps) {
  return (
    <div className="w-72 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 overflow-y-auto shadow-lg">
      <div className="sticky top-0 bg-white dark:bg-zinc-950 z-10 border-b border-gray-100 dark:border-zinc-800">
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Execuções
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Histórico do fluxo
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Atualizar execuções"
              title="Atualizar execuções"
              className="h-8 w-8 shrink-0 p-0"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-zinc-900 dark:text-gray-300">
            <span>Total</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {sessions.length}
            </span>
          </div>
        </div>
      </div>

      <div className="p-3">
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando execuções
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-zinc-800 dark:text-gray-400">
            Nenhuma execução para este fluxo.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const selected = session.id === selectedSessionId
              const isStopping = stoppingSessionId === session.id
              const isDeleting = deletingSessionId === session.id
              return (
                <div
                  key={session.id}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md border p-3 transition-colors',
                    selected
                      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                        <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="truncate">{session.remoteJid}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        Node atual: {getNodeLabel(session.currentNodeId)}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatExecutionDate(session.lastActivity)}
                      </span>
                      <span className="font-mono">{session.id.slice(0, 8)}</span>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'border text-[10px]',
                        getFlowExecutionStatusClassName(session),
                      )}
                    >
                      {getFlowExecutionStatusLabel(session)}
                    </Badge>
                    {session.isActive ? (
                      <button
                        type="button"
                        onClick={() => onStopSession(session)}
                        disabled={isStopping}
                        aria-label="Parar execução"
                        title="Parar execução"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-amber-50 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
                      >
                        {isStopping ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDeleteSession(session)}
                        disabled={isDeleting}
                        aria-label="Excluir execução"
                        title="Excluir execução"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FlowEditorContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<FlowEditorNode, FlowEditorEdge> | null>(null)

  const [nodes, setNodes] = useNodesState<FlowEditorNode>([])
  const [edges, setEdges] = useEdgesState<FlowEditorEdge>([])
  const nodesRef = useRef<FlowEditorNode[]>([])
  const edgesRef = useRef<FlowEditorEdge[]>([])
  const savedSnapshotRef = useRef<FlowHistorySnapshot>(createCanvasSnapshot([], []))
  const [flowHistory, setFlowHistory] = useState<FlowHistory<FlowHistorySnapshot> | null>(null)
  const [selectedNode, setSelectedNode] = useState<FlowEditorNode | null>(null)
  const [editingNode, setEditingNode] = useState<FlowEditorNode | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [editorMode, setEditorMode] = useState<FlowExecutionMode>('editor')
  const [selectedExecutionSessionId, setSelectedExecutionSessionId] =
    useState<string | null>(null)
  const [stoppingExecutionSessionId, setStoppingExecutionSessionId] =
    useState<string | null>(null)
  const [deletingExecutionSessionId, setDeletingExecutionSessionId] =
    useState<string | null>(null)
  const [executionReplayIndex, setExecutionReplayIndex] = useState(0)
  const canUndo = canUndoFlowHistory(flowHistory)
  const canRedo = canRedoFlowHistory(flowHistory)
  const isExecutionMode = editorMode === 'executions'

  const updateUnsavedChanges = useCallback((snapshot: FlowHistorySnapshot) => {
    setHasUnsavedChanges(
      !areFlowHistoryValuesEqual(snapshot, savedSnapshotRef.current)
    )
  }, [])

  const replaceCanvasState = useCallback(
    (snapshot: FlowHistorySnapshot) => {
      const nextNodes = cloneFlowHistoryValue(snapshot.nodes)
      const nextEdges = cloneFlowHistoryValue(snapshot.edges)

      nodesRef.current = nextNodes
      edgesRef.current = nextEdges
      setNodes(nextNodes)
      setEdges(nextEdges)
    },
    [setEdges, setNodes]
  )

  const commitCanvasSnapshot = useCallback(
    (nextNodes: FlowEditorNode[], nextEdges: FlowEditorEdge[]) => {
      const snapshot = createCanvasSnapshot(nextNodes, nextEdges)

      setFlowHistory((currentHistory) =>
        currentHistory
          ? pushFlowHistory(currentHistory, snapshot)
          : createFlowHistory(snapshot)
      )
      updateUnsavedChanges(snapshot)
    },
    [updateUnsavedChanges]
  )

  const setCanvasState = useCallback(
    (
      nextNodes: FlowEditorNode[],
      nextEdges: FlowEditorEdge[],
      options?: { commit?: boolean }
    ) => {
      nodesRef.current = nextNodes
      edgesRef.current = nextEdges
      setNodes(nextNodes)
      setEdges(nextEdges)

      if (options?.commit) {
        commitCanvasSnapshot(nextNodes, nextEdges)
      }
    },
    [commitCanvasSnapshot, setEdges, setNodes]
  )

  const { data: flow, isLoading } = useQuery<FlowWithDetails>({
    queryKey: ['flow', id],
    queryFn: async () => {
      const response = await api.get(`/flows/${id}`)
      return response.data
    },
  })

  const { data: instances } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: async () => {
      const response = await api.get('/instances')
      return response.data
    },
  })

  const { data: builderSettingsData } = useQuery<Record<string, unknown> | null>({
    queryKey: ['builder-settings'],
    queryFn: async () => {
      const response = await api.get('/users/me/builder-settings')
      return response.data
    },
  })

  const {
    data: executionSessions = [],
    isLoading: executionSessionsLoading,
  } = useQuery<FlowExecutionSession[]>({
    queryKey: ['flow-sessions', id],
    queryFn: async () => {
      const response = await api.get(`/flows/${id}/sessions`)
      return response.data
    },
    enabled: isExecutionMode && Boolean(id),
    refetchInterval: isExecutionMode ? 5000 : false,
  })

  const deleteExecutionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/flows/${id}/sessions/${sessionId}`)
      return sessionId
    },
    onSuccess: (sessionId) => {
      toast.success('Execução excluída do histórico.')
      if (selectedExecutionSessionId === sessionId) {
        setSelectedExecutionSessionId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['flow-sessions', id] })
    },
    onError: () => {
      toast.error('Não foi possível excluir a execução.')
    },
    onSettled: () => {
      setDeletingExecutionSessionId(null)
    },
  })

  const stopExecutionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await api.post(`/flows/${id}/sessions/${sessionId}/stop`)
      return sessionId
    },
    onSuccess: () => {
      toast.success('Execução parada.')
      queryClient.invalidateQueries({ queryKey: ['flow-sessions', id] })
    },
    onError: () => {
      toast.error('Não foi possível parar a execução.')
    },
    onSettled: () => {
      setStoppingExecutionSessionId(null)
    },
  })

  const builderSettings = useMemo(
    () => normalizeBuilderSettings(builderSettingsData),
    [builderSettingsData],
  )
  const [previewBuilderSettings, setPreviewBuilderSettings] =
    useState<BuilderSettings | null>(null)
  const effectiveBuilderSettings = useMemo(
    () => previewBuilderSettings ?? builderSettings,
    [builderSettings, previewBuilderSettings],
  )
  const builderEdgeStyle = useMemo(
    () => getBuilderEdgeStyle(effectiveBuilderSettings),
    [effectiveBuilderSettings],
  )
  const builderEdgeMarkers = useMemo(
    () => getBuilderEdgeMarkers(effectiveBuilderSettings),
    [effectiveBuilderSettings],
  )
  const builderSettingsRef = useRef(effectiveBuilderSettings)
  const selectedExecutionSession = useMemo(() => {
    if (!executionSessions.length) return null

    return (
      executionSessions.find((session) => session.id === selectedExecutionSessionId) ??
      executionSessions[0]
    )
  }, [executionSessions, selectedExecutionSessionId])
  const executionTraceNodeIds = useMemo(
    () => getFlowExecutionTraceNodeIds(selectedExecutionSession),
    [selectedExecutionSession],
  )
  const executionSnapshotElements = useMemo(
    () => getFlowExecutionSnapshotElements(selectedExecutionSession),
    [selectedExecutionSession],
  )
  const executionBaseNodes = useMemo(
    () =>
      isExecutionMode && executionSnapshotElements
        ? (executionSnapshotElements.nodes as FlowEditorNode[])
        : nodes,
    [executionSnapshotElements, isExecutionMode, nodes],
  )
  const executionBaseEdges = useMemo(
    () =>
      isExecutionMode && executionSnapshotElements
        ? (executionSnapshotElements.edges as FlowEditorEdge[])
        : edges,
    [edges, executionSnapshotElements, isExecutionMode],
  )
  const isExecutionReplayAnimated = Boolean(selectedExecutionSession?.isActive)
  const replayedExecutionSession = useMemo(
    () =>
      isExecutionReplayAnimated
        ? getFlowExecutionReplaySession(selectedExecutionSession, executionReplayIndex)
        : selectedExecutionSession,
    [executionReplayIndex, isExecutionReplayAnimated, selectedExecutionSession],
  )
  const flowExecutionView = useMemo(
    () =>
      applyFlowExecutionView({
        nodes: executionBaseNodes,
        edges: executionBaseEdges,
        session: replayedExecutionSession,
        enabled: isExecutionMode,
        traceNodeIds: executionTraceNodeIds,
        animated: isExecutionReplayAnimated,
      }),
    [
      executionBaseEdges,
      executionBaseNodes,
      executionTraceNodeIds,
      isExecutionMode,
      isExecutionReplayAnimated,
      replayedExecutionSession,
    ],
  )
  const getExecutionNodeLabel = useCallback(
    (nodeId?: string | null) => {
      if (!nodeId) return 'Sem node atual'
      const node = nodesRef.current.find((currentNode) => currentNode.id === nodeId)
      return String(node?.data?.label || node?.type || nodeId)
    },
    [],
  )
  const handleStopExecutionSession = useCallback(
    async (session: FlowExecutionSession) => {
      if (!session.isActive) {
        toast.warning('Esta execução já está finalizada.')
        return
      }

      const confirmed = await toast.confirm({
        title: 'Parar execução',
        message: 'Parar esta execução em andamento? O fluxo não continuará a partir desta sessão.',
        danger: true,
        confirmText: 'Parar',
      })

      if (!confirmed) return

      setStoppingExecutionSessionId(session.id)
      stopExecutionMutation.mutate(session.id)
    },
    [stopExecutionMutation, toast],
  )
  const handleDeleteExecutionSession = useCallback(
    async (session: FlowExecutionSession) => {
      if (session.isActive) {
        toast.warning('Execuções em andamento não podem ser excluídas.')
        return
      }

      const confirmed = await toast.confirm({
        title: 'Excluir execução',
        message: 'Excluir esta execução do histórico? Esta ação não pode ser desfeita.',
        danger: true,
        confirmText: 'Excluir',
      })

      if (!confirmed) return

      setDeletingExecutionSessionId(session.id)
      deleteExecutionMutation.mutate(session.id)
    },
    [deleteExecutionMutation, toast],
  )

  const [flowSettings, setFlowSettings] = useState({
    name: '',
    description: '',
    triggerType: 'KEYWORD' as FlowTriggerType,
    triggerValue: '',
    instanceId: '',
    inactivityTimeout: 5,
    timeoutMessage: 'Sessao encerrada por inatividade. Envie uma mensagem para iniciar novamente.',
  })

  useEffect(() => {
    if (!isExecutionMode) return
    if (executionSessions.length === 0) {
      setSelectedExecutionSessionId(null)
      return
    }
    if (
      selectedExecutionSessionId &&
      executionSessions.some((session) => session.id === selectedExecutionSessionId)
    ) {
      return
    }
    setSelectedExecutionSessionId(executionSessions[0].id)
  }, [executionSessions, isExecutionMode, selectedExecutionSessionId])

  useEffect(() => {
    setExecutionReplayIndex(
      isExecutionReplayAnimated
        ? 0
        : Math.max(executionTraceNodeIds.length - 1, 0),
    )
  }, [
    isExecutionReplayAnimated,
    selectedExecutionSession?.id,
    selectedExecutionSession?.startedAt,
    selectedExecutionSession?.completedAt,
  ])

  useEffect(() => {
    const lastTraceIndex = executionTraceNodeIds.length - 1
    if (executionReplayIndex <= lastTraceIndex) return
    setExecutionReplayIndex(Math.max(lastTraceIndex, 0))
  }, [executionReplayIndex, executionTraceNodeIds.length])

  useEffect(() => {
    if (!isExecutionMode || !isExecutionReplayAnimated || executionTraceNodeIds.length <= 1) {
      return
    }

    const intervalId = window.setInterval(() => {
      setExecutionReplayIndex((currentIndex) =>
        currentIndex >= executionTraceNodeIds.length - 1
          ? currentIndex
          : currentIndex + 1,
      )
    }, 850)

    return () => window.clearInterval(intervalId)
  }, [
    executionTraceNodeIds.length,
    isExecutionMode,
    isExecutionReplayAnimated,
    selectedExecutionSession?.completedAt,
    selectedExecutionSession?.id,
  ])

  useEffect(() => {
    builderSettingsRef.current = effectiveBuilderSettings

    if (edgesRef.current.length === 0) return

    const nextEdges = edgesRef.current.map((edge) => ({
      ...edge,
      type: effectiveBuilderSettings.defaultEdgeType,
      animated: effectiveBuilderSettings.defaultEdgeAnimated,
      markerEnd: builderEdgeMarkers.markerEnd,
      style: {
        ...edge.style,
        ...builderEdgeStyle,
      },
    }))

    edgesRef.current = nextEdges
    setEdges(nextEdges)
  }, [builderEdgeMarkers, builderEdgeStyle, effectiveBuilderSettings, setEdges])

  // Load flow data
  useEffect(() => {
    if (flow) {
      // Convert flow nodes to React Flow format
      const rfNodes: FlowEditorNode[] = flow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.positionX, y: node.positionY },
        data: node.data,
      }))

      const currentBuilderSettings = builderSettingsRef.current
      const currentEdgeStyle = getBuilderEdgeStyle(currentBuilderSettings)
      const currentEdgeMarkers = getBuilderEdgeMarkers(currentBuilderSettings)

      // Convert flow edges to React Flow format
      const rfEdges: FlowEditorEdge[] = flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        label: edge.label || undefined,
        type: currentBuilderSettings.defaultEdgeType,
        animated: currentBuilderSettings.defaultEdgeAnimated,
        style: currentEdgeStyle,
        markerEnd: currentEdgeMarkers.markerEnd,
      }))

      const initialSnapshot = createCanvasSnapshot(rfNodes, rfEdges)
      savedSnapshotRef.current = initialSnapshot
      setFlowHistory(createFlowHistory(initialSnapshot))
      replaceCanvasState(initialSnapshot)
      setHasUnsavedChanges(false)
      const settings = (flow.settings || {}) as Record<string, any>
      setFlowSettings({
        name: flow.name,
        description: flow.description || '',
        triggerType: flow.triggerType,
        triggerValue: flow.triggerValue || '',
        instanceId: flow.instanceId || '',
        inactivityTimeout: settings.inactivityTimeout || 5,
        timeoutMessage: settings.timeoutMessage || 'Sessao encerrada por inatividade. Envie uma mensagem para iniciar novamente.',
      })
    }
  }, [flow, replaceCanvasState])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentNodes = nodesRef.current
      const currentEdges = edgesRef.current
      // Convert React Flow format to API format
      const apiNodes = currentNodes.map((node) => ({
        id: node.id,
        type: node.type,
        positionX: node.position.x,
        positionY: node.position.y,
        data: node.data,
        label: node.data?.label,
      }))

      const apiEdges = currentEdges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        label: edge.label,
      }))

      await api.put(`/flows/${id}/canvas`, {
        nodes: apiNodes,
        edges: apiEdges,
      })
    },
    onSuccess: () => {
      const savedSnapshot = createCanvasSnapshot(nodesRef.current, edgesRef.current)
      savedSnapshotRef.current = savedSnapshot
      setHasUnsavedChanges(false)
      queryClient.invalidateQueries({ queryKey: ['flow', id] })
    },
  })

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: typeof flowSettings) => {
      const { inactivityTimeout, timeoutMessage, ...rest } = data
      await api.put(`/flows/${id}`, {
        ...rest,
        instanceId: data.instanceId || null,
        settings: { inactivityTimeout, timeoutMessage },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flow', id] })
      setSettingsOpen(false)
    },
  })

  const updateBuilderSettingsMutation = useMutation({
    mutationFn: async (settings: BuilderSettings) => {
      const response = await api.put('/users/me/builder-settings', settings)
      return response.data
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['builder-settings'], normalizeBuilderSettings(settings))
      setPreviewBuilderSettings(null)
      toast.success('Configurações do Builder salvas')
    },
    onError: () => {
      toast.error('Não foi possível salvar as configurações do Builder')
    },
  })

  const toggleStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      await api.put(`/flows/${id}`, { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flow', id] })
    },
  })

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return

      const currentBuilderSettings = builderSettingsRef.current
      const currentEdgeMarkers = getBuilderEdgeMarkers(currentBuilderSettings)

      const newEdge: FlowEditorEdge = {
        id: `edge_${Date.now()}`,
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
        type: currentBuilderSettings.defaultEdgeType,
        animated: currentBuilderSettings.defaultEdgeAnimated,
        style: getBuilderEdgeStyle(currentBuilderSettings),
        markerEnd: currentEdgeMarkers.markerEnd,
      }

      const nextEdges = addEdge<FlowEditorEdge>(newEdge, edgesRef.current)
      setCanvasState(nodesRef.current, nextEdges, { commit: true })
    },
    [setCanvasState]
  )

  // Listen for edge delete events from CustomEdge
  useEffect(() => {
    const handleDeleteEdge = (event: CustomEvent<{ id: string }>) => {
      const nextEdges = edgesRef.current.filter((e) => e.id !== event.detail.id)
      setCanvasState(nodesRef.current, nextEdges, { commit: true })
    }

    window.addEventListener('deleteEdge', handleDeleteEdge as EventListener)
    return () => {
      window.removeEventListener('deleteEdge', handleDeleteEdge as EventListener)
    }
  }, [setCanvasState])

  const openNodeEditor = useCallback((node: FlowEditorNode) => {
    if (isExecutionMode) return
    const currentNode = nodesRef.current.find((n) => n.id === node.id) ?? node
    setSelectedNode(currentNode)
    setEditingNode(currentNode)
    setNodeContextMenu(null)
  }, [isExecutionMode])

  // Listen for edit node events from ActionButtons (pencil icon)
  useEffect(() => {
    const handleEditNode = (event: CustomEvent<{ id: string }>) => {
      const node = nodesRef.current.find(n => n.id === event.detail.id)
      if (node) openNodeEditor(node)
    }

    window.addEventListener('editNode', handleEditNode as EventListener)
    return () => {
      window.removeEventListener('editNode', handleEditNode as EventListener)
    }
  }, [openNodeEditor])

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (isExecutionMode) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [isExecutionMode])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (isExecutionMode) return
      event.preventDefault()

      const type = event.dataTransfer.getData('application/reactflow')
      if (!type || !reactFlowInstance || !reactFlowWrapper.current) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode: FlowEditorNode = {
        id: `node_${Date.now()}`,
        type,
        position,
        data: createDefaultNodeData(type),
      }

      const nextNodes = [...nodesRef.current, newNode]
      setCanvasState(nextNodes, edgesRef.current, { commit: true })
    },
    [isExecutionMode, reactFlowInstance, setCanvasState]
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: FlowEditorNode) => {
    setSelectedNode(node)
    setNodeContextMenu(null)
  }, [])

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: FlowEditorNode) => {
    if (isExecutionMode) return
    openNodeEditor(node)
  }, [isExecutionMode, openNodeEditor])

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowEditorNode) => {
      if (isExecutionMode) return
      event.preventDefault()

      const position = getFlowContextMenuPosition({
        clientX: event.clientX,
        clientY: event.clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })

      setSelectedNode(node)
      setNodeContextMenu({ node, ...position })
    },
    [isExecutionMode]
  )

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setEditingNode(null)
    setNodeContextMenu(null)
  }, [])

  const updateNodeData = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      const nextNodes = nodesRef.current.map((node) =>
        node.id === nodeId ? { ...node, data } : node
      )
      const updatedNode = nextNodes.find((node) => node.id === nodeId) ?? null
      setCanvasState(nextNodes, edgesRef.current, { commit: true })
      setSelectedNode((current) => (current?.id === nodeId ? updatedNode : current))
      setEditingNode((current) => (current?.id === nodeId ? updatedNode : current))
    },
    [setCanvasState]
  )

  const deleteNode = useCallback((node: FlowEditorNode) => {
    if (node.type === 'START') {
      toast.warning('Não é possível excluir o node de início')
      return
    }
    const nextNodes = nodesRef.current.filter((n) => n.id !== node.id)
    const nextEdges = edgesRef.current.filter(
      (e) => e.source !== node.id && e.target !== node.id
    )
    setCanvasState(nextNodes, nextEdges, { commit: true })
    setSelectedNode(null)
    setEditingNode(null)
    setNodeContextMenu(null)
  }, [setCanvasState, toast])

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return
    deleteNode(selectedNode)
  }, [deleteNode, selectedNode])

  const duplicateNode = useCallback((node: FlowEditorNode) => {
    if (node.type === 'START') return
    const nodeToDuplicate =
      nodesRef.current.find((currentNode) => currentNode.id === node.id) ?? node
    const newNode: FlowEditorNode = {
      id: `node_${Date.now()}`,
      type: nodeToDuplicate.type,
      position: {
        x: nodeToDuplicate.position.x + 50,
        y: nodeToDuplicate.position.y + 80,
      },
      data: cloneFlowHistoryValue(nodeToDuplicate.data),
    }
    const nextNodes = [...nodesRef.current, newNode]
    setCanvasState(nextNodes, edgesRef.current, { commit: true })
    setSelectedNode(newNode)
    setNodeContextMenu(null)
  }, [setCanvasState])

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return
    duplicateNode(selectedNode)
  }, [duplicateNode, selectedNode])

  const restoreHistorySnapshot = useCallback(
    (nextHistory: FlowHistory<FlowHistorySnapshot>) => {
      replaceCanvasState(nextHistory.present)
      setFlowHistory(nextHistory)
      setSelectedNode(null)
      setEditingNode(null)
      updateUnsavedChanges(nextHistory.present)
    },
    [replaceCanvasState, updateUnsavedChanges]
  )

  const undoCanvas = useCallback(() => {
    if (!flowHistory || !canUndoFlowHistory(flowHistory)) return
    restoreHistorySnapshot(undoFlowHistory(flowHistory))
  }, [flowHistory, restoreHistorySnapshot])

  const redoCanvas = useCallback(() => {
    if (!flowHistory || !canRedoFlowHistory(flowHistory)) return
    restoreHistorySnapshot(redoFlowHistory(flowHistory))
  }, [flowHistory, restoreHistorySnapshot])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifierPressed = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const isTyping = isTextEditingTarget(e.target)

      if (key === 'escape' && nodeContextMenu) {
        setNodeContextMenu(null)
        return
      }

      if (isExecutionMode) return

      if (isModifierPressed && !e.altKey && !isTyping) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          undoCanvas()
          return
        }
        if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault()
          redoCanvas()
          return
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode && !isTyping) {
          deleteSelectedNode()
        }
      }
      if (isModifierPressed && key === 's') {
        e.preventDefault()
        saveMutation.mutate()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNode, deleteSelectedNode, isExecutionMode, nodeContextMenu, redoCanvas, saveMutation, undoCanvas])

  useEffect(() => {
    if (!nodeContextMenu) return

    const closeContextMenu = () => setNodeContextMenu(null)
    window.addEventListener('click', closeContextMenu)
    window.addEventListener('blur', closeContextMenu)

    return () => {
      window.removeEventListener('click', closeContextMenu)
      window.removeEventListener('blur', closeContextMenu)
    }
  }, [nodeContextMenu])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!flow) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Fluxo nao encontrado</p>
      </div>
    )
  }

  const getStatusConfig = (status: string) => {
    const config: Record<string, { label: string; variant: string }> = {
      DRAFT: { label: 'Rascunho', variant: 'outline' },
      ACTIVE: { label: 'Ativo', variant: 'default' },
      INACTIVE: { label: 'Inativo', variant: 'secondary' },
    }
    return config[status] || config.DRAFT
  }

  const statusConfig = getStatusConfig(flow.status)

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="h-16 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between px-6 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/flows')}
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>

          <div className="h-6 w-px bg-gray-200 dark:bg-zinc-700" />

          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-gray-900 dark:text-white">{flow.name}</h1>
            <Badge
              variant={statusConfig.variant as any}
              className={
                flow.status === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0'
                  : flow.status === 'INACTIVE'
                  ? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400 border-0'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0'
              }
            >
              {statusConfig.label}
            </Badge>
            {hasUnsavedChanges && (
              <Badge className="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                Alteracoes nao salvas
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isExecutionMode ? (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={undoCanvas}
                  disabled={!canUndo}
                  className="border-gray-200 dark:border-zinc-700"
                  aria-label="Desfazer"
                  title="Desfazer"
                >
                  <Undo2 className="h-4 w-4 mr-1" />
                  Desfazer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={redoCanvas}
                  disabled={!canRedo}
                  className="border-gray-200 dark:border-zinc-700"
                  aria-label="Refazer"
                  title="Refazer"
                >
                  <Redo2 className="h-4 w-4 mr-1" />
                  Refazer
                </Button>
              </div>

              {selectedNode && selectedNode.type !== 'START' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={duplicateSelectedNode}
                    className="border-gray-200 dark:border-zinc-700"
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    Duplicar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deleteSelectedNode}
                    className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 dark:border-red-800 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
                className="border-gray-200 dark:border-zinc-700"
              >
                <Settings className="h-4 w-4 mr-2" />
                Configuracoes
              </Button>

              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar Layout
              </Button>
            </>
          ) : null}

          {flow.status === 'ACTIVE' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleStatusMutation.mutate('INACTIVE')}
              className="border-gray-200 dark:border-zinc-700"
            >
              <Pause className="h-4 w-4 mr-2" />
              Desativar
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => toggleStatusMutation.mutate('ACTIVE')}
              className="bg-purple-500 hover:bg-purple-600 text-white shadow-sm"
            >
              <Play className="h-4 w-4 mr-2" />
              Ativar
            </Button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex overflow-hidden">
        {isExecutionMode ? (
          <FlowExecutionsSidebar
            sessions={executionSessions}
            selectedSessionId={selectedExecutionSession?.id ?? null}
            isLoading={executionSessionsLoading}
            onSelectSession={setSelectedExecutionSessionId}
            onStopSession={handleStopExecutionSession}
            onDeleteSession={handleDeleteExecutionSession}
            onRefresh={() =>
              queryClient.invalidateQueries({ queryKey: ['flow-sessions', id] })
            }
            getNodeLabel={getExecutionNodeLabel}
            stoppingSessionId={stoppingExecutionSessionId}
            deletingSessionId={deletingExecutionSessionId}
          />
        ) : (
          <NodesSidebar
            builderSettings={effectiveBuilderSettings}
            isBuilderSettingsSaving={updateBuilderSettingsMutation.isPending}
            onBuilderSettingsPreview={setPreviewBuilderSettings}
            onBuilderSettingsSave={(settings) =>
              updateBuilderSettingsMutation.mutate(settings)
            }
            onBuilderSettingsCancel={() => setPreviewBuilderSettings(null)}
          />
        )}

        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={flowExecutionView.nodes}
            edges={flowExecutionView.edges}
            onNodesChange={(changes) => {
              if (isExecutionMode) return
              const nextNodes = applyNodeChanges<FlowEditorNode>(
                changes,
                nodesRef.current
              )
              const removedNodeIds = changes
                .filter((change) => change.type === 'remove')
                .map((change) => change.id)
              const nextEdges = removedNodeIds.length
                ? edgesRef.current.filter(
                    (edge) =>
                      !removedNodeIds.includes(edge.source) &&
                      !removedNodeIds.includes(edge.target)
                  )
                : edgesRef.current

              setCanvasState(nextNodes, nextEdges)

              if (
                removedNodeIds.length > 0 ||
                changes.some(
                  (change) =>
                    change.type === 'position' && change.dragging !== true
                )
              ) {
                commitCanvasSnapshot(nextNodes, nextEdges)
              }
            }}
            onEdgesChange={(changes) => {
              if (isExecutionMode) return
              const nextEdges = applyEdgeChanges<FlowEditorEdge>(
                changes,
                edgesRef.current
              )
              setCanvasState(nodesRef.current, nextEdges)

              if (changes.some((change) => change.type === 'remove')) {
                commitCanvasSnapshot(nodesRef.current, nextEdges)
              }
            }}
            onConnect={isExecutionMode ? undefined : onConnect}
            onInit={setReactFlowInstance}
            onDrop={isExecutionMode ? undefined : onDrop}
            onDragOver={isExecutionMode ? undefined : onDragOver}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={isExecutionMode ? undefined : onNodeDoubleClick}
            onNodeContextMenu={isExecutionMode ? undefined : onNodeContextMenu}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable={!isExecutionMode}
            nodesConnectable={!isExecutionMode}
            elementsSelectable={!isExecutionMode}
            snapToGrid={effectiveBuilderSettings.snapToGrid}
            snapGrid={[
              effectiveBuilderSettings.snapGrid,
              effectiveBuilderSettings.snapGrid,
            ]}
            defaultEdgeOptions={{
              type: effectiveBuilderSettings.defaultEdgeType,
              animated: effectiveBuilderSettings.defaultEdgeAnimated,
              style: builderEdgeStyle,
              markerEnd: builderEdgeMarkers.markerEnd,
            }}
            className={cn(
              'bg-gray-100 dark:bg-zinc-950',
              isExecutionMode && 'flow-execution-canvas',
            )}
          >
            {effectiveBuilderSettings.controlsVisible ? (
              <Controls
                className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg"
                showInteractive={false}
              />
            ) : null}
            {effectiveBuilderSettings.minimapVisible ? (
              <MiniMap
                className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg"
                nodeColor="#8b5cf6"
                maskColor="rgba(15, 23, 42, 0.08)"
              />
            ) : null}
            {effectiveBuilderSettings.backgroundVariant !== 'none' ? (
              <Background
                variant={getReactFlowBackgroundVariant(
                  effectiveBuilderSettings.backgroundVariant
                )}
                gap={effectiveBuilderSettings.backgroundGap}
                size={effectiveBuilderSettings.backgroundSize}
                color="#d1d5db"
                className="dark:opacity-20"
              />
            ) : null}
          </ReactFlow>

          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEditorMode('editor')}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  editorMode === 'editor'
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-950'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-zinc-900 dark:hover:text-white',
                )}
              >
                <Edit3 className="h-3.5 w-3.5" />
                Editor
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedNode(null)
                  setEditingNode(null)
                  setNodeContextMenu(null)
                  setEditorMode('executions')
                }}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  editorMode === 'executions'
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-950'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-zinc-900 dark:hover:text-white',
                )}
              >
                <Activity className="h-3.5 w-3.5" />
                Execuções
                {executionSessions.length > 0 ? (
                  <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
                    {executionSessions.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {nodeContextMenu && (
            <div
              role="menu"
              aria-label="Ações do node"
              className="fixed z-50 w-[180px] rounded-md border border-gray-200 bg-white p-1 text-sm text-gray-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-200"
              style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
                onClick={() => openNodeEditor(nodeContextMenu.node)}
              >
                <Edit3 className="h-4 w-4 text-emerald-600" />
                Editar
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={nodeContextMenu.node.type === 'START'}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none disabled:pointer-events-none disabled:opacity-45 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
                onClick={() => duplicateNode(nodeContextMenu.node)}
              >
                <Copy className="h-4 w-4 text-purple-600" />
                Duplicar
              </button>
              <div className="-mx-1 my-1 h-px bg-gray-100 dark:bg-zinc-800" />
              <button
                type="button"
                role="menuitem"
                disabled={nodeContextMenu.node.type === 'START'}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none disabled:pointer-events-none disabled:opacity-45 dark:hover:bg-red-950/30 dark:focus:bg-red-950/30"
                onClick={() => deleteNode(nodeContextMenu.node)}
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </button>
            </div>
          )}
        </div>

        {editingNode && (
          <NodeProperties
            node={editingNode}
            onUpdate={updateNodeData}
            onClose={() => setEditingNode(null)}
            allNodes={nodes}
          />
        )}
      </div>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configuracoes do Fluxo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={flowSettings.name}
                onChange={(e) => setFlowSettings({ ...flowSettings, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descricao</Label>
              <Textarea
                value={flowSettings.description}
                onChange={(e) =>
                  setFlowSettings({ ...flowSettings, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Gatilho</Label>
              <Select
                value={flowSettings.triggerType}
                onValueChange={(value: FlowTriggerType) =>
                  setFlowSettings({ ...flowSettings, triggerType: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KEYWORD">Palavra-chave</SelectItem>
                  <SelectItem value="ALL">Todas as mensagens</SelectItem>
                  <SelectItem value="BUTTON_REPLY">Resposta de botao</SelectItem>
                  <SelectItem value="LIST_REPLY">Resposta de lista</SelectItem>
                  <SelectItem value="WEBHOOK">Webhook externo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {flowSettings.triggerType === 'KEYWORD' && (
              <div className="space-y-2">
                <Label>Palavra-chave</Label>
                <Input
                  value={flowSettings.triggerValue}
                  onChange={(e) =>
                    setFlowSettings({ ...flowSettings, triggerValue: e.target.value })
                  }
                  placeholder="oi, ola, menu"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Instancia</Label>
              <Select
                value={flowSettings.instanceId}
                onValueChange={(value) =>
                  setFlowSettings({ ...flowSettings, instanceId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas as instancias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas as instancias</SelectItem>
                  {Array.isArray(instances) && instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tempo de inatividade (minutos)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={flowSettings.inactivityTimeout}
                onChange={(e) =>
                  setFlowSettings({ ...flowSettings, inactivityTimeout: parseInt(e.target.value) || 5 })
                }
                placeholder="5"
              />
              <p className="text-xs text-gray-500">
                Encerra a sessao do fluxo automaticamente apos esse tempo sem interacao.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Mensagem de encerramento</Label>
              <Textarea
                value={flowSettings.timeoutMessage}
                onChange={(e) =>
                  setFlowSettings({ ...flowSettings, timeoutMessage: e.target.value })
                }
                placeholder="Sessao encerrada por inatividade..."
                rows={3}
              />
              <p className="text-xs text-gray-500">
                Mensagem enviada ao usuario quando o fluxo e encerrado por inatividade.
              </p>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => updateSettingsMutation.mutate(flowSettings)}
              disabled={updateSettingsMutation.isPending}
            >
              {updateSettingsMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorContent />
    </ReactFlowProvider>
  )
}
