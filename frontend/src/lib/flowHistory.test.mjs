import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const loadModule = async () => {
  const source = readFileSync(new URL('./flowHistory.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

test('flow history records unique snapshots and supports undo/redo', async () => {
  const {
    canRedoFlowHistory,
    canUndoFlowHistory,
    createFlowHistory,
    pushFlowHistory,
    redoFlowHistory,
    undoFlowHistory,
  } = await loadModule()

  const initial = {
    nodes: [{ id: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } }],
    edges: [],
  }
  const addedNode = {
    nodes: [
      ...initial.nodes,
      { id: 'message', position: { x: 100, y: 0 }, data: { label: 'Message' } },
    ],
    edges: [],
  }
  const connected = {
    ...addedNode,
    edges: [{ id: 'edge-1', source: 'start', target: 'message' }],
  }

  let history = createFlowHistory(initial)
  history = pushFlowHistory(history, addedNode)
  history = pushFlowHistory(history, connected)
  history = pushFlowHistory(history, connected)

  assert.equal(history.past.length, 2)
  assert.equal(canUndoFlowHistory(history), true)
  assert.equal(canRedoFlowHistory(history), false)

  history = undoFlowHistory(history)
  assert.deepEqual(history.present, addedNode)
  assert.equal(history.future.length, 1)
  assert.equal(canRedoFlowHistory(history), true)

  history = redoFlowHistory(history)
  assert.deepEqual(history.present, connected)
  assert.equal(history.future.length, 0)
})

test('flow history clears redo when a new snapshot is pushed after undo', async () => {
  const { createFlowHistory, pushFlowHistory, redoFlowHistory, undoFlowHistory } =
    await loadModule()

  let history = createFlowHistory({ nodes: [{ id: 'a' }], edges: [] })
  history = pushFlowHistory(history, { nodes: [{ id: 'b' }], edges: [] })
  history = undoFlowHistory(history)
  history = pushFlowHistory(history, { nodes: [{ id: 'c' }], edges: [] })
  history = redoFlowHistory(history)

  assert.deepEqual(history.present, { nodes: [{ id: 'c' }], edges: [] })
  assert.equal(history.future.length, 0)
})

test('flow history clone keeps undefined optional values safe', async () => {
  const { cloneFlowHistoryValue } = await loadModule()

  assert.equal(cloneFlowHistoryValue(undefined), undefined)
  assert.deepEqual(
    cloneFlowHistoryValue({ nodes: [], edges: [{ id: 'edge-1', data: undefined }] }),
    { nodes: [], edges: [{ id: 'edge-1' }] }
  )
})
