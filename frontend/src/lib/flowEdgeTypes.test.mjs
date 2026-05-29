import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const flowEditorSource = () =>
  readFileSync(new URL('../pages/FlowEditor.tsx', import.meta.url), 'utf8')

const customEdgeSource = () =>
  readFileSync(new URL('../components/flow-builder/CustomEdge.tsx', import.meta.url), 'utf8')

const builderSettingsDialogSource = () =>
  readFileSync(
    new URL('../components/flow-builder/BuilderSettingsDialog.tsx', import.meta.url),
    'utf8'
  )

const builderSettingsPanelSource = () =>
  readFileSync(
    new URL('../components/flow-builder/BuilderSettingsPanel.tsx', import.meta.url),
    'utf8'
  )

const userRoutesSource = () =>
  readFileSync(
    new URL('../../../backend/src/modules/users/user.routes.ts', import.meta.url),
    'utf8'
  )

test('flow editor registers all supported builder edge types', () => {
  const source = flowEditorSource()

  for (const edgeType of ['smoothstep', 'step', 'straight', 'bezier', 'simpleBezier']) {
    assert.match(source, new RegExp(`${edgeType}:\\s*CustomEdge`))
  }
})

test('custom edge renders supported path variants while keeping delete control', () => {
  const source = customEdgeSource()

  for (const helper of [
    'getSmoothStepPath',
    'getStraightPath',
    'getBezierPath',
    'getSimpleBezierPath',
  ]) {
    assert.match(source, new RegExp(helper))
  }

  assert.match(source, /case 'step'/)
  assert.match(source, /borderRadius:\s*0/)
  assert.match(source, /deleteEdge/)
})

test('flow editor applies only final marker preferences to existing and new edges', () => {
  const source = flowEditorSource()

  assert.match(source, /getBuilderEdgeMarkers/)
  assert.match(source, /builderEdgeMarkers/)
  assert.doesNotMatch(source, /markerStart:\s*builderEdgeMarkers\.markerStart/)
  assert.match(source, /markerEnd:\s*builderEdgeMarkers\.markerEnd/)
})

test('custom edge uses builder selected-edge styling without start markers', () => {
  const source = customEdgeSource()

  assert.doesNotMatch(source, /markerStart=\{markerStart\}/)
  assert.match(source, /--builder-selected-edge-color/)
  assert.match(source, /--builder-selected-edge-width/)
})

test('builder settings dialog exposes edge appearance controls through the panel', () => {
  const dialogSource = builderSettingsDialogSource()
  const panelSource = builderSettingsPanelSource()

  assert.match(dialogSource, /BuilderSettingsPanel/)

  for (const controlId of [
    'builder-edge-color',
    'builder-selected-edge-color',
    'builder-edge-stroke-width',
    'builder-edge-opacity',
    'builder-edge-marker-end',
    'builder-edge-marker-size',
  ]) {
    assert.match(panelSource, new RegExp(controlId))
  }
  assert.doesNotMatch(panelSource, /builder-edge-marker-start/)
})

test('backend builder settings schema accepts safe edge appearance fields', () => {
  const source = userRoutesSource()

  for (const field of [
    'edgeColor',
    'selectedEdgeColor',
    'edgeStrokeWidth',
    'edgeOpacity',
    'edgeMarkerEnd',
    'edgeMarkerSize',
  ]) {
    assert.match(source, new RegExp(field))
  }
  assert.doesNotMatch(source, /edgeMarkerStart/)
})
