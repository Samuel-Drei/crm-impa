export type BuilderBackgroundVariant = 'dots' | 'lines' | 'cross' | 'none'
export type BuilderEdgeStyle = 'dashed' | 'solid'
export type BuilderEdgeMarker = 'none' | 'arrow' | 'arrowClosed'
export type BuilderEdgeType =
  | 'smoothstep'
  | 'step'
  | 'straight'
  | 'bezier'
  | 'simpleBezier'

type ReactFlowMarkerType = 'arrow' | 'arrowclosed'

export type BuilderEdgeMarkerConfig = {
  type: ReactFlowMarkerType
  color: string
  width: number
  height: number
  strokeWidth: number
}

export type BuilderSettings = {
  snapToGrid: boolean
  snapGrid: number
  backgroundVariant: BuilderBackgroundVariant
  backgroundGap: number
  backgroundSize: number
  controlsVisible: boolean
  minimapVisible: boolean
  defaultEdgeAnimated: boolean
  defaultEdgeType: BuilderEdgeType
  edgeStyle: BuilderEdgeStyle
  edgeColor: string
  selectedEdgeColor: string
  edgeStrokeWidth: number
  edgeMarkerEnd: BuilderEdgeMarker
  edgeMarkerSize: number
  edgeOpacity: number
}

export const builderEdgeTypeOptions: Array<{
  value: BuilderEdgeType
  label: string
}> = [
  { value: 'smoothstep', label: 'Cotovelo suave' },
  { value: 'step', label: 'Cotovelo reto' },
  { value: 'straight', label: 'Reta' },
  { value: 'bezier', label: 'Bezier' },
  { value: 'simpleBezier', label: 'Bezier simples' },
]

export const builderEdgeMarkerOptions: Array<{
  value: BuilderEdgeMarker
  label: string
}> = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'arrow', label: 'Seta aberta' },
  { value: 'arrowClosed', label: 'Seta preenchida' },
]

export const defaultBuilderSettings: BuilderSettings = {
  snapToGrid: true,
  snapGrid: 15,
  backgroundVariant: 'dots',
  backgroundGap: 20,
  backgroundSize: 1.5,
  controlsVisible: true,
  minimapVisible: false,
  defaultEdgeAnimated: false,
  defaultEdgeType: 'smoothstep',
  edgeStyle: 'dashed',
  edgeColor: '#8b5cf6',
  selectedEdgeColor: '#a855f7',
  edgeStrokeWidth: 2,
  edgeMarkerEnd: 'arrowClosed',
  edgeMarkerSize: 16,
  edgeOpacity: 1,
}

const backgroundVariants = new Set<BuilderBackgroundVariant>([
  'dots',
  'lines',
  'cross',
  'none',
])

const edgeStyles = new Set<BuilderEdgeStyle>(['dashed', 'solid'])
const edgeTypes = new Set<BuilderEdgeType>(
  builderEdgeTypeOptions.map((option) => option.value),
)
const edgeMarkers = new Set<BuilderEdgeMarker>(
  builderEdgeMarkerOptions.map((option) => option.value),
)
const hexColorPattern = /^#[0-9a-fA-F]{6}$/

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const safeNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < min || value > max) return fallback
  return value
}

const safeColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !hexColorPattern.test(value)) return fallback
  return value.toLowerCase()
}

const safeEdgeMarker = (
  value: unknown,
  fallback: BuilderEdgeMarker,
): BuilderEdgeMarker => {
  if (
    typeof value === 'string' &&
    edgeMarkers.has(value as BuilderEdgeMarker)
  ) {
    return value as BuilderEdgeMarker
  }

  return fallback
}

export const normalizeBuilderSettings = (
  value: Partial<BuilderSettings> | Record<string, unknown> | null | undefined,
): BuilderSettings => {
  const input = value && typeof value === 'object' ? value : {}

  return {
    snapToGrid: isBoolean(input.snapToGrid)
      ? input.snapToGrid
      : defaultBuilderSettings.snapToGrid,
    snapGrid: safeNumber(input.snapGrid, defaultBuilderSettings.snapGrid, 5, 80),
    backgroundVariant:
      typeof input.backgroundVariant === 'string' &&
      backgroundVariants.has(input.backgroundVariant as BuilderBackgroundVariant)
        ? (input.backgroundVariant as BuilderBackgroundVariant)
        : defaultBuilderSettings.backgroundVariant,
    backgroundGap: safeNumber(
      input.backgroundGap,
      defaultBuilderSettings.backgroundGap,
      8,
      80,
    ),
    backgroundSize: safeNumber(
      input.backgroundSize,
      defaultBuilderSettings.backgroundSize,
      0.5,
      4,
    ),
    controlsVisible: isBoolean(input.controlsVisible)
      ? input.controlsVisible
      : defaultBuilderSettings.controlsVisible,
    minimapVisible: isBoolean(input.minimapVisible)
      ? input.minimapVisible
      : defaultBuilderSettings.minimapVisible,
    defaultEdgeAnimated: isBoolean(input.defaultEdgeAnimated)
      ? input.defaultEdgeAnimated
      : defaultBuilderSettings.defaultEdgeAnimated,
    defaultEdgeType:
      typeof input.defaultEdgeType === 'string' &&
      edgeTypes.has(input.defaultEdgeType as BuilderEdgeType)
        ? (input.defaultEdgeType as BuilderEdgeType)
        : defaultBuilderSettings.defaultEdgeType,
    edgeStyle:
      typeof input.edgeStyle === 'string' &&
      edgeStyles.has(input.edgeStyle as BuilderEdgeStyle)
        ? (input.edgeStyle as BuilderEdgeStyle)
        : defaultBuilderSettings.edgeStyle,
    edgeColor: safeColor(input.edgeColor, defaultBuilderSettings.edgeColor),
    selectedEdgeColor: safeColor(
      input.selectedEdgeColor,
      defaultBuilderSettings.selectedEdgeColor,
    ),
    edgeStrokeWidth: safeNumber(
      input.edgeStrokeWidth,
      defaultBuilderSettings.edgeStrokeWidth,
      1,
      6,
    ),
    edgeMarkerEnd: safeEdgeMarker(
      input.edgeMarkerEnd,
      defaultBuilderSettings.edgeMarkerEnd,
    ),
    edgeMarkerSize: safeNumber(
      input.edgeMarkerSize,
      defaultBuilderSettings.edgeMarkerSize,
      8,
      32,
    ),
    edgeOpacity: safeNumber(
      input.edgeOpacity,
      defaultBuilderSettings.edgeOpacity,
      0.2,
      1,
    ),
  }
}

export const getBuilderEdgeStyle = (settings: BuilderSettings) => ({
  stroke: settings.edgeColor,
  strokeWidth: settings.edgeStrokeWidth,
  strokeDasharray: settings.edgeStyle === 'dashed' ? '8 4' : 'none',
  opacity: settings.edgeOpacity,
  '--builder-selected-edge-color': settings.selectedEdgeColor,
  '--builder-selected-edge-width': `${settings.edgeStrokeWidth + 0.5}`,
})

const markerTypeByPreference: Record<
  Exclude<BuilderEdgeMarker, 'none'>,
  ReactFlowMarkerType
> = {
  arrow: 'arrow',
  arrowClosed: 'arrowclosed',
}

const getBuilderEdgeMarker = (
  settings: BuilderSettings,
  marker: BuilderEdgeMarker,
): BuilderEdgeMarkerConfig | undefined => {
  if (marker === 'none') return undefined

  return {
    type: markerTypeByPreference[marker],
    color: settings.edgeColor,
    width: settings.edgeMarkerSize,
    height: settings.edgeMarkerSize,
    strokeWidth: settings.edgeStrokeWidth,
  }
}

export const getBuilderEdgeMarkers = (settings: BuilderSettings) => ({
  markerEnd: getBuilderEdgeMarker(settings, settings.edgeMarkerEnd),
})
