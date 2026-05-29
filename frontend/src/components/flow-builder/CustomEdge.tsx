import { memo } from 'react'
import {
  EdgeProps,
  getBezierPath,
  getSimpleBezierPath,
  getSmoothStepPath,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
} from '@xyflow/react'
import { X } from 'lucide-react'
import type { BuilderEdgeType } from '@/lib/builderSettings'

type BuilderEdgeCssVariables = React.CSSProperties & {
  '--builder-selected-edge-color'?: string
  '--builder-selected-edge-width'?: string
}

type CustomEdgeData = {
  readOnly?: boolean
}

const numberOrFallback = (value: unknown, fallback: number) => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

const getEdgePathByType = ({
  type,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: Pick<
  EdgeProps,
  | 'type'
  | 'sourceX'
  | 'sourceY'
  | 'targetX'
  | 'targetY'
  | 'sourcePosition'
  | 'targetPosition'
>) => {
  const edgeType = type === 'custom' ? 'smoothstep' : type

  switch (edgeType as BuilderEdgeType) {
    case 'step':
      return getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 0,
      })
    case 'straight':
      return getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      })
    case 'bezier':
      return getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })
    case 'simpleBezier':
      return getSimpleBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })
    case 'smoothstep':
    default:
      return getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8,
      })
  }
}

function CustomEdge({
  id,
  type,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getEdgePathByType({
    type,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const onEdgeClick = (evt: React.MouseEvent) => {
    evt.stopPropagation()
    // Dispatch custom event to delete this edge
    window.dispatchEvent(new CustomEvent('deleteEdge', { detail: { id } }))
  }
  const edgeStyle = style as BuilderEdgeCssVariables
  const defaultStroke = String(edgeStyle.stroke ?? '#8b5cf6')
  const defaultStrokeWidth = numberOrFallback(edgeStyle.strokeWidth, 2)
  const selectedStroke = edgeStyle['--builder-selected-edge-color'] ?? '#a855f7'
  const selectedStrokeWidth = numberOrFallback(
    edgeStyle['--builder-selected-edge-width'],
    defaultStrokeWidth + 0.5,
  )
  const glowStrokeWidth = Math.max(selectedStrokeWidth + 3.5, 6)
  const strokeDasharray = edgeStyle.strokeDasharray ?? '8 4'
  const readOnly = Boolean((data as CustomEdgeData | undefined)?.readOnly)

  return (
    <>
      {/* Shadow/glow effect for selected edges */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={selectedStroke}
          strokeWidth={glowStrokeWidth}
          strokeOpacity={0.3}
          style={{ filter: 'blur(4px)' }}
        />
      )}

      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? selectedStroke : defaultStroke,
          strokeWidth: selected ? selectedStrokeWidth : defaultStrokeWidth,
          strokeDasharray,
          strokeLinecap: 'round',
        }}
      />

      {!readOnly ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={onEdgeClick}
              className="
                w-5 h-5
                bg-white dark:bg-zinc-800
                border-2 border-red-400
                hover:bg-red-500 hover:border-red-500
                rounded-full
                flex items-center justify-center
                text-red-500 hover:text-white
                shadow-lg
                transition-all duration-200
                hover:scale-110
                active:scale-95
                opacity-70 hover:opacity-100
              "
              title="Remover conexao"
            >
              <X className="w-3 h-3" strokeWidth={3} />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export default memo(CustomEdge)
