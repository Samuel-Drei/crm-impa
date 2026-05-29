import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const loadModule = async () => {
  const source = readFileSync(new URL('./flowExecutionView.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

const sourceFrom = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('flow execution view highlights the selected waiting session', async () => {
  const { applyFlowExecutionView } = await loadModule()

  const nodes = [
    { id: 'start', data: {}, className: 'existing-node' },
    { id: 'message', data: {} },
  ]
  const edges = [
    { id: 'edge-1', source: 'start', target: 'message', data: { keep: true } },
    { id: 'edge-2', source: 'message', target: 'end' },
  ]
  const session = {
    id: 'session-1',
    currentNodeId: 'message',
    waitingInput: true,
    isActive: true,
  }

  const view = applyFlowExecutionView({ nodes, edges, session, enabled: true })

  assert.equal(
    view.nodes.find((node) => node.id === 'message').className,
    'flow-execution-node-waiting',
  )
  assert.equal(
    view.nodes.find((node) => node.id === 'start').className,
    'existing-node flow-execution-node-muted',
  )
  assert.equal(
    view.edges.find((edge) => edge.id === 'edge-1').className,
    'flow-execution-edge-related',
  )
  assert.deepEqual(view.edges.find((edge) => edge.id === 'edge-1').data, {
    keep: true,
    readOnly: true,
  })
})

test('flow execution view removes execution classes outside execution mode', async () => {
  const { applyFlowExecutionView } = await loadModule()

  const view = applyFlowExecutionView({
    enabled: false,
    session: null,
    nodes: [{ id: 'message', data: {}, className: 'flow-execution-node-waiting custom' }],
    edges: [
      {
        id: 'edge-1',
        source: 'start',
        target: 'message',
        className: 'flow-execution-edge-related custom-edge',
        data: { readOnly: true },
      },
    ],
  })

  assert.equal(view.nodes[0].className, 'custom')
  assert.equal(view.edges[0].className, 'custom-edge')
  assert.deepEqual(view.edges[0].data, {})
})

test('flow execution view derives replay node from session trace', async () => {
  const {
    getFlowExecutionReplaySession,
    getFlowExecutionTraceNodeIds,
  } = await loadModule()

  const session = {
    id: 'session-1',
    currentNodeId: 'start',
    waitingInput: false,
    isActive: false,
    context: {
      executionTrace: [
        { nodeId: 'start' },
        { nodeId: 'list' },
        { nodeId: 'reply' },
      ],
    },
  }

  assert.deepEqual(getFlowExecutionTraceNodeIds(session), ['start', 'list', 'reply'])
  assert.equal(getFlowExecutionReplaySession(session, 1).currentNodeId, 'list')
  assert.equal(getFlowExecutionReplaySession(session, 99).currentNodeId, 'reply')
})

test('completed execution view highlights the historical path without animation', async () => {
  const { applyFlowExecutionView } = await loadModule()

  const nodes = [
    { id: 'start', data: {} },
    { id: 'list', data: {} },
    { id: 'unused', data: {} },
    { id: 'reply', data: {} },
  ]
  const edges = [
    { id: 'edge-start-list', source: 'start', target: 'list' },
    { id: 'edge-list-reply', source: 'list', target: 'reply' },
    { id: 'edge-list-unused', source: 'list', target: 'unused' },
  ]

  const view = applyFlowExecutionView({
    nodes,
    edges,
    session: {
      currentNodeId: 'reply',
      waitingInput: false,
      isActive: false,
    },
    traceNodeIds: ['start', 'list', 'reply'],
    enabled: true,
    animated: false,
  })

  assert.equal(
    view.nodes.find((node) => node.id === 'start').className,
    'flow-execution-node-visited',
  )
  assert.equal(
    view.nodes.find((node) => node.id === 'unused').className,
    'flow-execution-node-muted',
  )
  assert.equal(
    view.edges.find((edge) => edge.id === 'edge-start-list').className,
    'flow-execution-edge-visited',
  )
  assert.equal(
    view.edges.find((edge) => edge.id === 'edge-list-reply').className,
    'flow-execution-edge-visited',
  )
  assert.equal(
    view.edges.find((edge) => edge.id === 'edge-list-unused').className,
    'flow-execution-edge-muted',
  )
})

test('execution snapshots are converted to react flow elements', async () => {
  const { getFlowExecutionSnapshotElements } = await loadModule()

  const snapshot = {
    nodes: [
      {
        id: 'old-message',
        type: 'MESSAGE',
        positionX: 10,
        positionY: 20,
        data: { label: 'Mensagem antiga' },
      },
    ],
    edges: [
      {
        id: 'old-edge',
        sourceNodeId: 'old-start',
        targetNodeId: 'old-message',
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        label: null,
      },
    ],
  }

  assert.deepEqual(getFlowExecutionSnapshotElements({ context: { flowSnapshot: snapshot } }), {
    nodes: [
      {
        id: 'old-message',
        type: 'MESSAGE',
        position: { x: 10, y: 20 },
        data: { label: 'Mensagem antiga' },
      },
    ],
    edges: [
      {
        id: 'old-edge',
        source: 'old-start',
        target: 'old-message',
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        label: undefined,
      },
    ],
  })
})

test('flow editor exposes n8n-like editor and executions tabs', () => {
  const source = sourceFrom('../pages/FlowEditor.tsx')

  assert.match(source, /editorMode/)
  assert.match(source, /Execuções/)
  assert.match(source, /Editor/)
  assert.match(source, /FlowExecutionsSidebar/)
  assert.match(source, /w-72 bg-white dark:bg-zinc-950 border-r/)
  assert.doesNotMatch(source, /absolute right-4 top-16/)
  assert.equal(source.includes('`/flows/${id}/sessions`'), true)
  assert.match(source, /nodesDraggable=\{!isExecutionMode\}/)
  assert.match(source, /nodesConnectable=\{!isExecutionMode\}/)
  assert.match(source, /getFlowExecutionReplaySession/)
  assert.match(source, /executionReplayIndex/)
  assert.match(source, /getFlowExecutionSnapshotElements/)
  assert.match(source, /isExecutionReplayAnimated/)
  assert.match(source, /deleteExecutionMutation/)
  assert.match(source, /api\.delete\(`\/flows\/\$\{id\}\/sessions\/\$\{sessionId\}`\)/)
  assert.match(source, /Excluir execução/)
  assert.match(source, /stopExecutionMutation/)
  assert.match(source, /api\.post\(`\/flows\/\$\{id\}\/sessions\/\$\{sessionId\}\/stop`\)/)
  assert.match(source, /Parar execução/)
  assert.match(source, /session\.isActive/)
})

test('execution view css animates highlighted nodes and traversed edges', () => {
  const source = sourceFrom('../index.css')

  assert.match(source, /flow-execution-node-ring/)
  assert.match(source, /flow-execution-edge-dash/)
  assert.match(source, /flow-execution-node-current::after/)
  assert.match(source, /flow-execution-node-waiting::after/)
  assert.match(source, /stroke-dashoffset/)
  assert.match(source, /flow-execution-node-visited/)
  assert.match(source, /flow-execution-edge-visited/)
  assert.match(source, /flow-execution-edge-related:not\(\.flow-execution-edge-static\)/)
})

test('custom edge hides destructive controls while execution view is read-only', () => {
  const source = sourceFrom('../components/flow-builder/CustomEdge.tsx')

  assert.match(source, /readOnly/)
  assert.match(source, /!readOnly/)
  assert.match(source, /Remover conexao/)
})
