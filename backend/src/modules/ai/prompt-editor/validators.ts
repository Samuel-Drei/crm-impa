import type { PromptEditorFlags, PromptValidationIssue } from './types.js'

const PLACEHOLDER_REGEX = /\{\{\s*[^{}]+\s*\}\}|\{[a-zA-Z0-9_.-]+\}/g
const TOOL_NAME_REGEXES = [
  /"name"\s*:\s*"([^"]+)"/g,
  /(?:tool|function)\s*[:=]\s*`?([a-zA-Z0-9_.:-]+)`?/gi,
  /<tool[^>]*name="([^"]+)"/gi,
]

function uniqueMatches(regex: RegExp, value: string) {
  const found = new Set<string>()
  for (const match of value.matchAll(regex)) {
    if (match[1]) found.add(match[1])
    else if (match[0]) found.add(match[0])
  }
  return found
}

function extractPlaceholders(value: string) {
  return new Set(value.match(PLACEHOLDER_REGEX) || [])
}

function extractToolNames(value: string) {
  const found = new Set<string>()
  for (const regex of TOOL_NAME_REGEXES) {
    for (const item of uniqueMatches(regex, value)) found.add(item)
  }
  return found
}

function findMissingItems(before: Set<string>, after: Set<string>) {
  return [...before].filter(item => !after.has(item))
}

function seemsJson(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function codeFenceCount(value: string) {
  return (value.match(/```/g) || []).length
}

function headingCount(value: string) {
  return (value.match(/^#{1,6}\s+/gm) || []).length
}

function numberedSectionCount(value: string) {
  return (value.match(/^\d+[.)]\s+/gm) || []).length
}

export function validatePromptEdit(before: string, after: string, flags: PromptEditorFlags): PromptValidationIssue[] {
  const issues: PromptValidationIssue[] = []

  if (flags.preservePlaceholders) {
    const missing = findMissingItems(extractPlaceholders(before), extractPlaceholders(after))
    if (missing.length > 0) {
      issues.push({
        code: 'placeholders_removed',
        message: `Placeholders removidos: ${missing.join(', ')}`,
        severity: 'error',
      })
    }
  }

  if (flags.preserveTools) {
    const missing = findMissingItems(extractToolNames(before), extractToolNames(after))
    if (missing.length > 0) {
      issues.push({
        code: 'tools_removed',
        message: `Referências a tools/funções removidas: ${missing.join(', ')}`,
        severity: 'error',
      })
    }
  }

  if (flags.preserveStructure) {
    if (headingCount(before) !== headingCount(after)) {
      issues.push({
        code: 'heading_structure_changed',
        message: 'A quantidade de cabeçalhos Markdown mudou.',
        severity: 'warning',
      })
    }

    if (numberedSectionCount(before) !== numberedSectionCount(after)) {
      issues.push({
        code: 'numbered_structure_changed',
        message: 'A quantidade de seções numeradas mudou.',
        severity: 'warning',
      })
    }
  }

  if (codeFenceCount(after) % 2 !== 0) {
    issues.push({
      code: 'markdown_code_fence_unbalanced',
      message: 'O prompt final ficou com blocos de código Markdown desbalanceados.',
      severity: 'error',
    })
  }

  if (seemsJson(before) || seemsJson(after)) {
    try {
      JSON.parse(after)
    } catch {
      issues.push({
        code: 'invalid_json',
        message: 'O conteúdo final parece JSON, mas não está válido.',
        severity: 'error',
      })
    }
  }

  if (after.trim().length === 0) {
    issues.push({
      code: 'empty_prompt',
      message: 'O prompt final ficou vazio.',
      severity: 'error',
    })
  }

  if (after.length > Math.max(before.length * 1.8, before.length + 4000)) {
    issues.push({
      code: 'prompt_growth_large',
      message: 'O prompt final cresceu muito além do esperado para uma edição parcial.',
      severity: 'warning',
    })
  }

  return issues
}
