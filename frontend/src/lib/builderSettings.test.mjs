import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const loadModule = async () => {
  const source = readFileSync(new URL('./builderSettings.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

test('builder settings use safe defaults when no user settings exist', async () => {
  const { defaultBuilderSettings, normalizeBuilderSettings } = await loadModule()

  assert.deepEqual(normalizeBuilderSettings(null), defaultBuilderSettings)
  assert.deepEqual(normalizeBuilderSettings(undefined), defaultBuilderSettings)
})

test('builder settings keep supported values and ignore invalid values', async () => {
  const { normalizeBuilderSettings } = await loadModule()

  const settings = normalizeBuilderSettings({
    snapToGrid: false,
    snapGrid: 30,
    backgroundVariant: 'lines',
    backgroundGap: 25,
    backgroundSize: 2,
    controlsVisible: false,
    minimapVisible: true,
    defaultEdgeAnimated: true,
    defaultEdgeType: 'bezier',
    edgeStyle: 'solid',
    edgeColor: '#10b981',
    selectedEdgeColor: '#f43f5e',
    edgeStrokeWidth: 4,
    edgeMarkerEnd: 'arrowClosed',
    edgeMarkerSize: 24,
    edgeOpacity: 0.75,
  })
  assert.equal(Object.hasOwn(settings, 'edgeMarkerStart'), false)

  assert.deepEqual(settings, {
    snapToGrid: false,
    snapGrid: 30,
    backgroundVariant: 'lines',
    backgroundGap: 25,
    backgroundSize: 2,
    controlsVisible: false,
    minimapVisible: true,
    defaultEdgeAnimated: true,
    defaultEdgeType: 'bezier',
    edgeStyle: 'solid',
    edgeColor: '#10b981',
    selectedEdgeColor: '#f43f5e',
    edgeStrokeWidth: 4,
    edgeMarkerEnd: 'arrowClosed',
    edgeMarkerSize: 24,
    edgeOpacity: 0.75,
  })

  const fallback = normalizeBuilderSettings({
    snapToGrid: 'yes',
    snapGrid: 999,
    backgroundVariant: 'grid',
    backgroundGap: 3,
    backgroundSize: 99,
    controlsVisible: 'no',
    minimapVisible: 'yes',
    defaultEdgeAnimated: 'false',
    defaultEdgeType: 'loop',
    edgeStyle: 'glow',
    edgeColor: 'purple',
    selectedEdgeColor: '#12345',
    edgeStrokeWidth: 99,
    edgeMarkerEnd: 'diamond',
    edgeMarkerStart: 'circle',
    edgeMarkerSize: 99,
    edgeOpacity: 2,
  })

  assert.equal(fallback.snapToGrid, true)
  assert.equal(fallback.snapGrid, 15)
  assert.equal(fallback.backgroundVariant, 'dots')
  assert.equal(fallback.backgroundGap, 20)
  assert.equal(fallback.backgroundSize, 1.5)
  assert.equal(fallback.controlsVisible, true)
  assert.equal(fallback.minimapVisible, false)
  assert.equal(fallback.defaultEdgeAnimated, false)
  assert.equal(fallback.defaultEdgeType, 'smoothstep')
  assert.equal(fallback.edgeStyle, 'dashed')
  assert.equal(fallback.edgeColor, '#8b5cf6')
  assert.equal(fallback.selectedEdgeColor, '#a855f7')
  assert.equal(fallback.edgeStrokeWidth, 2)
  assert.equal(fallback.edgeMarkerEnd, 'arrowClosed')
  assert.equal(Object.hasOwn(fallback, 'edgeMarkerStart'), false)
  assert.equal(fallback.edgeMarkerSize, 16)
  assert.equal(fallback.edgeOpacity, 1)
})

test('builder settings expose supported edge type options', async () => {
  const { builderEdgeTypeOptions, defaultBuilderSettings, normalizeBuilderSettings } =
    await loadModule()

  assert.equal(defaultBuilderSettings.defaultEdgeType, 'smoothstep')
  assert.deepEqual(
    builderEdgeTypeOptions.map((option) => option.value),
    ['smoothstep', 'step', 'straight', 'bezier', 'simpleBezier']
  )
  assert.equal(
    normalizeBuilderSettings({ defaultEdgeType: 'simpleBezier' }).defaultEdgeType,
    'simpleBezier'
  )
})

test('builder settings convert edge style preferences to React Flow style', async () => {
  const { defaultBuilderSettings, getBuilderEdgeStyle } = await loadModule()

  assert.deepEqual(getBuilderEdgeStyle(defaultBuilderSettings), {
    stroke: '#8b5cf6',
    strokeWidth: 2,
    strokeDasharray: '8 4',
    opacity: 1,
    '--builder-selected-edge-color': '#a855f7',
    '--builder-selected-edge-width': '2.5',
  })

  assert.deepEqual(
    getBuilderEdgeStyle({
      ...defaultBuilderSettings,
      edgeStyle: 'solid',
      edgeColor: '#10b981',
      selectedEdgeColor: '#f43f5e',
      edgeStrokeWidth: 4,
      edgeOpacity: 0.75,
    }),
    {
      stroke: '#10b981',
      strokeWidth: 4,
      strokeDasharray: 'none',
      opacity: 0.75,
      '--builder-selected-edge-color': '#f43f5e',
      '--builder-selected-edge-width': '4.5',
    }
  )
})

test('builder settings convert marker preferences to React Flow markers', async () => {
  const { defaultBuilderSettings, getBuilderEdgeMarkers } = await loadModule()

  assert.deepEqual(getBuilderEdgeMarkers(defaultBuilderSettings), {
    markerEnd: {
      type: 'arrowclosed',
      color: '#8b5cf6',
      width: 16,
      height: 16,
      strokeWidth: 2,
    },
  })

  assert.deepEqual(
    getBuilderEdgeMarkers({
      ...defaultBuilderSettings,
      edgeColor: '#10b981',
      edgeStrokeWidth: 3,
      edgeMarkerStart: 'arrow',
      edgeMarkerEnd: 'none',
      edgeMarkerSize: 24,
    }),
    {
      markerEnd: undefined,
    }
  )
})
