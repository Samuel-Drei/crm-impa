import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../components/flow-builder/CustomNodes.tsx', import.meta.url),
  'utf8'
)

test('flow builder handles are constrained to left targets and right sources', () => {
  assert.equal(source.includes('Position.Top'), false)
  assert.equal(source.includes('Position.Bottom'), false)
  assert.equal(source.includes('id="target-left"'), true)
  assert.equal(source.includes('id="source-right"'), true)
})

test('flow builder keeps hidden compatibility handles for persisted old ids', () => {
  assert.equal(source.includes('id="target-top"'), true)
  assert.equal(source.includes('id="source-bottom"'), true)
  assert.equal(source.includes('compatibilityHandleStyle'), true)
})
