import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const sourceFrom = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('builder settings panel is reusable and emits preview changes', () => {
  const panelUrl = new URL(
    '../components/flow-builder/BuilderSettingsPanel.tsx',
    import.meta.url,
  )

  assert.equal(existsSync(panelUrl), true)

  const source = readFileSync(panelUrl, 'utf8')

  assert.match(source, /type BuilderSettingsPanelProps/)
  assert.match(source, /onChange/)
  assert.match(source, /normalizeBuilderSettings/)
  assert.match(source, /builder-edge-color/)
  assert.match(source, /Restaurar padrão/)
})

test('nodes sidebar exposes builder settings inside the toolbox', () => {
  const source = sourceFrom('../components/flow-builder/NodesSidebar.tsx')

  assert.match(source, /BuilderSettingsPanel/)
  assert.match(source, /builderSettings/)
  assert.match(source, /onBuilderSettingsPreview/)
  assert.match(source, /Aparência/)
  assert.match(source, /Componentes/)
})

test('flow editor previews builder settings before saving them', () => {
  const source = sourceFrom('../pages/FlowEditor.tsx')

  assert.match(source, /previewBuilderSettings/)
  assert.match(source, /effectiveBuilderSettings/)
  assert.match(source, /updateBuilderSettingsMutation/)
  assert.match(source, /setPreviewBuilderSettings\(null\)/)
  assert.match(source, /builderSettings=\{effectiveBuilderSettings\}/)
  assert.match(source, /onBuilderSettingsPreview=\{setPreviewBuilderSettings\}/)
})

test('flows list does not expose builder settings outside the editor toolbox', () => {
  const source = sourceFrom('../pages/Flows.tsx')

  assert.doesNotMatch(source, /Configurações do Builder/)
  assert.doesNotMatch(source, /BuilderSettingsDialog/)
  assert.doesNotMatch(source, /builderSettingsOpen/)
  assert.doesNotMatch(source, /users\/me\/builder-settings/)
})
