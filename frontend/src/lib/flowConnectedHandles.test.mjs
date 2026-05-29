import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const loadModule = async () => {
  const source = readFileSync(
    new URL('./flowConnectedHandles.ts', import.meta.url),
    'utf8'
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

test('source handles turn connected for current and legacy output ids', async () => {
  const { isFlowHandleConnected } = await loadModule()

  assert.equal(
    isFlowHandleConnected({
      type: 'source',
      handleId: 'source-right',
      connections: [{ sourceHandle: 'source-bottom', targetHandle: 'target-left' }],
    }),
    true
  )

  assert.equal(
    isFlowHandleConnected({
      type: 'source',
      handleId: 'right-btn_1',
      connections: [{ sourceHandle: 'btn_1', targetHandle: 'target-left' }],
    }),
    true
  )

  assert.equal(
    isFlowHandleConnected({
      type: 'source',
      handleId: 'source-right',
      connections: [{ sourceHandle: null, targetHandle: 'target-left' }],
    }),
    true
  )
})

test('target handles turn connected for current and legacy input ids', async () => {
  const { isFlowHandleConnected } = await loadModule()

  assert.equal(
    isFlowHandleConnected({
      type: 'target',
      handleId: 'target-left',
      connections: [{ sourceHandle: 'source-right', targetHandle: 'target-top' }],
    }),
    true
  )

  assert.equal(
    isFlowHandleConnected({
      type: 'target',
      handleId: 'target-left',
      connections: [{ sourceHandle: 'source-right', targetHandle: null }],
    }),
    true
  )
})

test('connected handle colors are green for source and yellow for target', async () => {
  const { connectedHandleClassByType } = await loadModule()

  assert.match(connectedHandleClassByType.source, /emerald/)
  assert.match(connectedHandleClassByType.target, /amber/)
})
