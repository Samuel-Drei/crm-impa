type FlowHandleType = 'source' | 'target'

type FlowHandleConnection = {
  sourceHandle?: string | null
  targetHandle?: string | null
}

export const connectedHandleClassByType: Record<FlowHandleType, string> = {
  source: '!bg-emerald-500 !border-emerald-100 shadow-emerald-500/40',
  target: '!bg-amber-400 !border-amber-100 shadow-amber-400/40',
}

export const getFlowHandleAliases = (
  type: FlowHandleType,
  handleId?: string | null,
): Array<string | null> => {
  if (type === 'target' && handleId === 'target-left') {
    return ['target-left', 'target-top', null]
  }

  if (type === 'source' && handleId === 'source-right') {
    return ['source-right', 'source-bottom', null]
  }

  if (type === 'source' && handleId?.startsWith('right-')) {
    return [handleId, handleId.replace(/^right-/, '')]
  }

  return [handleId ?? null]
}

export const isFlowHandleConnected = ({
  type,
  handleId,
  connections,
}: {
  type: FlowHandleType
  handleId?: string | null
  connections: FlowHandleConnection[]
}) => {
  const aliases = getFlowHandleAliases(type, handleId)

  return connections.some((connection) => {
    const connectionHandle =
      type === 'source' ? connection.sourceHandle ?? null : connection.targetHandle ?? null

    return aliases.includes(connectionHandle)
  })
}
