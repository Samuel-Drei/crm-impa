import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const loadModule = async () => {
  const source = readFileSync(new URL('./flowContextMenu.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  return import(url)
}

test('flow context menu keeps requested position when it fits viewport', async () => {
  const { getFlowContextMenuPosition } = await loadModule()

  assert.deepEqual(
    getFlowContextMenuPosition({
      clientX: 120,
      clientY: 140,
      viewportWidth: 900,
      viewportHeight: 600,
      menuWidth: 180,
      menuHeight: 130,
    }),
    { x: 120, y: 140 }
  )
})

test('flow context menu clamps to viewport edges', async () => {
  const { getFlowContextMenuPosition } = await loadModule()

  assert.deepEqual(
    getFlowContextMenuPosition({
      clientX: 840,
      clientY: 570,
      viewportWidth: 900,
      viewportHeight: 600,
      menuWidth: 180,
      menuHeight: 130,
      margin: 8,
    }),
    { x: 712, y: 462 }
  )
})

test('flow context menu falls back to margin in very small viewports', async () => {
  const { getFlowContextMenuPosition } = await loadModule()

  assert.deepEqual(
    getFlowContextMenuPosition({
      clientX: 20,
      clientY: 20,
      viewportWidth: 120,
      viewportHeight: 100,
      menuWidth: 180,
      menuHeight: 130,
      margin: 8,
    }),
    { x: 8, y: 8 }
  )
})
