export type FlowExecutionMode = 'editor' | 'executions'

export type FlowExecutionSession = {
  id: string
  flowId?: string
  instanceId?: string
  remoteJid: string
  currentNodeId?: string | null
  variables?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
  isActive: boolean
  waitingInput: boolean
  startedAt: string
  lastActivity: string
  completedAt?: string | null
}

type FlowExecutionTraceEntry = {
  nodeId?: unknown
}

type ClassableElement = {
  id: string
  className?: string
}

type FlowExecutionNode = ClassableElement & {
  data?: unknown
}

type FlowExecutionEdge = ClassableElement & {
  source: string
  target: string
  data?: Record<string, unknown>
}

type FlowExecutionSnapshotNode = {
  id?: unknown
  type?: unknown
  positionX?: unknown
  positionY?: unknown
  data?: unknown
}

type FlowExecutionSnapshotEdge = {
  id?: unknown
  sourceNodeId?: unknown
  targetNodeId?: unknown
  sourceHandle?: unknown
  targetHandle?: unknown
  label?: unknown
}

const executionClasses = new Set([
  'flow-execution-node-current',
  'flow-execution-node-waiting',
  'flow-execution-node-visited',
  'flow-execution-node-muted',
  'flow-execution-edge-related',
  'flow-execution-edge-static',
  'flow-execution-edge-visited',
  'flow-execution-edge-muted',
])

const cleanExecutionClassName = (className?: string) => {
  const next = (className || '')
    .split(/\s+/)
    .filter((item) => item && !executionClasses.has(item))
    .join(' ')

  return next || undefined
}

const appendClassName = (className: string | undefined, nextClassName: string) =>
  [cleanExecutionClassName(className), nextClassName].filter(Boolean).join(' ')

const cleanExecutionEdgeData = (data?: Record<string, unknown>) => {
  const next = { ...(data || {}) }
  delete next.readOnly
  return next
}

export const getFlowExecutionStatusLabel = (session: FlowExecutionSession) => {
  if (session.waitingInput) return 'Aguardando resposta'
  if (session.isActive) return 'Em execução'
  return 'Finalizada'
}

export const getFlowExecutionStatusClassName = (session: FlowExecutionSession) => {
  if (session.waitingInput) {
    return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
  }
  if (session.isActive) {
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
  }
  return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
}

export const getFlowExecutionTraceNodeIds = (
  session: Pick<FlowExecutionSession, 'context'> | null,
) => {
  const trace = session?.context?.executionTrace
  if (!Array.isArray(trace)) return []

  return trace
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const nodeId = (entry as FlowExecutionTraceEntry).nodeId
        return typeof nodeId === 'string' ? nodeId : null
      }
      return null
    })
    .filter((nodeId): nodeId is string => Boolean(nodeId))
}

export const getFlowExecutionReplaySession = <
  TSession extends Pick<FlowExecutionSession, 'context' | 'currentNodeId' | 'waitingInput' | 'isActive'>,
>(
  session: TSession | null,
  replayIndex: number,
): TSession | null => {
  if (!session) return null

  const traceNodeIds = getFlowExecutionTraceNodeIds(session)
  if (traceNodeIds.length === 0) return session

  const index = Math.min(Math.max(replayIndex, 0), traceNodeIds.length - 1)
  return {
    ...session,
    currentNodeId: traceNodeIds[index] ?? session.currentNodeId,
    waitingInput: index === traceNodeIds.length - 1 ? session.waitingInput : false,
  }
}

export const getFlowExecutionSnapshotElements = (
  session: Pick<FlowExecutionSession, 'context'> | null,
) => {
  const snapshot = session?.context?.flowSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null

  const nodesSource = (snapshot as { nodes?: unknown }).nodes
  const edgesSource = (snapshot as { edges?: unknown }).edges
  if (!Array.isArray(nodesSource) || !Array.isArray(edgesSource)) return null

  const nodes = nodesSource
    .map((node): {
      id: string
      type: string
      position: { x: number; y: number }
      data: unknown
    } | null => {
      if (!node || typeof node !== 'object') return null

      const snapshotNode = node as FlowExecutionSnapshotNode
      if (typeof snapshotNode.id !== 'string' || typeof snapshotNode.type !== 'string') {
        return null
      }

      return {
        id: snapshotNode.id,
        type: snapshotNode.type,
        position: {
          x: typeof snapshotNode.positionX === 'number' ? snapshotNode.positionX : 0,
          y: typeof snapshotNode.positionY === 'number' ? snapshotNode.positionY : 0,
        },
        data: snapshotNode.data ?? {},
      }
    })
    .filter((node): node is NonNullable<typeof node> => Boolean(node))

  const edges = edgesSource
    .map((edge): {
      id: string
      source: string
      target: string
      sourceHandle: string | undefined
      targetHandle: string | undefined
      label: unknown
    } | null => {
      if (!edge || typeof edge !== 'object') return null

      const snapshotEdge = edge as FlowExecutionSnapshotEdge
      if (
        typeof snapshotEdge.id !== 'string' ||
        typeof snapshotEdge.sourceNodeId !== 'string' ||
        typeof snapshotEdge.targetNodeId !== 'string'
      ) {
        return null
      }

      return {
        id: snapshotEdge.id,
        source: snapshotEdge.sourceNodeId,
        target: snapshotEdge.targetNodeId,
        sourceHandle:
          typeof snapshotEdge.sourceHandle === 'string'
            ? snapshotEdge.sourceHandle
            : undefined,
        targetHandle:
          typeof snapshotEdge.targetHandle === 'string'
            ? snapshotEdge.targetHandle
            : undefined,
        label: snapshotEdge.label ?? undefined,
      }
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))

  return { nodes, edges }
}

const getTraceEdgeKey = (source: string, target: string) => `${source}\u0000${target}`

const getTraceEdgeKeys = (traceNodeIds: string[]) => {
  const edgeKeys = new Set<string>()

  for (let index = 0; index < traceNodeIds.length - 1; index += 1) {
    edgeKeys.add(getTraceEdgeKey(traceNodeIds[index], traceNodeIds[index + 1]))
  }

  return edgeKeys
}

export const applyFlowExecutionView = <
  TNode extends FlowExecutionNode,
  TEdge extends FlowExecutionEdge,
>({
  nodes,
  edges,
  session,
  enabled,
  traceNodeIds = [],
  animated = true,
}: {
  nodes: TNode[]
  edges: TEdge[]
  session: Pick<FlowExecutionSession, 'currentNodeId' | 'waitingInput' | 'isActive'> | null
  enabled: boolean
  traceNodeIds?: string[]
  animated?: boolean
}): { nodes: TNode[]; edges: TEdge[] } => {
  if (!enabled || (!session?.currentNodeId && traceNodeIds.length === 0)) {
    return {
      nodes: nodes.map((node) => ({
        ...node,
        className: cleanExecutionClassName(node.className),
      })),
      edges: edges.map((edge) => ({
        ...edge,
        className: cleanExecutionClassName(edge.className),
        data: cleanExecutionEdgeData(edge.data),
      })),
    }
  }

  if (!animated && traceNodeIds.length > 0) {
    const visitedNodeIds = new Set(traceNodeIds)
    const visitedEdgeKeys = getTraceEdgeKeys(traceNodeIds)

    return {
      nodes: nodes.map((node) => ({
        ...node,
        className: appendClassName(
          node.className,
          visitedNodeIds.has(node.id)
            ? 'flow-execution-node-visited'
            : 'flow-execution-node-muted',
        ),
      })),
      edges: edges.map((edge) => {
        const isVisited = visitedEdgeKeys.has(getTraceEdgeKey(edge.source, edge.target))
        return {
          ...edge,
          className: appendClassName(
            edge.className,
            isVisited ? 'flow-execution-edge-visited' : 'flow-execution-edge-muted',
          ),
          data: {
            ...cleanExecutionEdgeData(edge.data),
            readOnly: true,
          },
        }
      }),
    }
  }

  if (!session?.currentNodeId) {
    return {
      nodes: nodes.map((node) => ({
        ...node,
        className: cleanExecutionClassName(node.className),
      })),
      edges: edges.map((edge) => ({
        ...edge,
        className: cleanExecutionClassName(edge.className),
        data: cleanExecutionEdgeData(edge.data),
      })),
    }
  }

  const currentNodeId = session.currentNodeId
  const currentNodeClassName = session.waitingInput
    ? 'flow-execution-node-waiting'
    : 'flow-execution-node-current'

  return {
    nodes: nodes.map((node) => ({
      ...node,
      className:
        node.id === currentNodeId
          ? appendClassName(node.className, currentNodeClassName)
          : appendClassName(node.className, 'flow-execution-node-muted'),
    })),
    edges: edges.map((edge) => {
      const isRelated = edge.source === currentNodeId || edge.target === currentNodeId
      return {
        ...edge,
        className: appendClassName(
          edge.className,
          isRelated ? 'flow-execution-edge-related' : 'flow-execution-edge-muted',
        ),
        data: {
          ...cleanExecutionEdgeData(edge.data),
          readOnly: true,
        },
      }
    }),
  }
}
