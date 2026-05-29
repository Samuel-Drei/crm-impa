import { AIPromptPatchOperation } from '@prisma/client'
import type { PromptPatchPlan } from './types.js'

export class PromptPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromptPatchError'
  }
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, '\n')
}

function restoreLineEndings(value: string, original: string) {
  return original.includes('\r\n') ? value.replace(/\n/g, '\r\n') : value
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return []
  const indexes: number[] = []
  let start = 0
  while (start < haystack.length) {
    const foundAt = haystack.indexOf(needle, start)
    if (foundAt === -1) break
    indexes.push(foundAt)
    start = foundAt + needle.length
  }
  return indexes
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function fuzzyFindInContent(content: string, needle: string): { start: number; end: number } | null {
  // 1) Try trimmed lines match: trim each line and compare
  const trimmedNeedle = needle.split('\n').map(l => l.trim()).join('\n').trim()
  const trimmedContent = content.split('\n').map(l => l.trim()).join('\n')
  const trimIdx = trimmedContent.indexOf(trimmedNeedle)
  if (trimIdx !== -1) {
    // Map back to original positions
    const contentLines = content.split('\n')
    const needleLineCount = needle.split('\n').length
    let charPos = 0
    let startLine = -1
    let lineCharPos = 0

    for (let i = 0; i < contentLines.length; i++) {
      const trimmedLine = contentLines[i].trim()
      if (lineCharPos === trimIdx && startLine === -1) {
        startLine = i
      }
      lineCharPos += trimmedLine.length + 1 // +1 for \n
    }

    // Simpler approach: find the first line of needle in content
    const needleLines = needle.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (needleLines.length > 0) {
      const firstNeedleLine = needleLines[0]
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === firstNeedleLine) {
          // Check if subsequent lines match
          let allMatch = true
          let ni = 0
          for (let j = i; j < contentLines.length && ni < needleLines.length; j++) {
            const ct = contentLines[j].trim()
            if (ct.length === 0) continue // skip empty lines
            if (ct !== needleLines[ni]) { allMatch = false; break }
            ni++
          }
          if (allMatch && ni === needleLines.length) {
            // Find the actual start and end in the original content
            let startPos = 0
            for (let k = 0; k < i; k++) startPos += contentLines[k].length + 1
            // Find end: go until all needle lines are consumed
            let endLine = i
            ni = 0
            for (let j = i; j < contentLines.length && ni < needleLines.length; j++) {
              const ct = contentLines[j].trim()
              if (ct.length === 0) { endLine = j; continue }
              if (ct === needleLines[ni]) { endLine = j; ni++ }
            }
            let endPos = 0
            for (let k = 0; k <= endLine; k++) endPos += contentLines[k].length + 1
            return { start: startPos, end: Math.min(endPos, content.length) }
          }
        }
      }
    }
  }

  // 2) Try collapsing whitespace
  const collapsedNeedle = normalizeWhitespace(needle)
  const collapsedContent = normalizeWhitespace(content)
  const collapsedIdx = collapsedContent.indexOf(collapsedNeedle)
  if (collapsedIdx !== -1) {
    // Map collapsed position back to original
    let origStart = 0
    let collapsed = 0
    while (collapsed < collapsedIdx && origStart < content.length) {
      if (/\s/.test(content[origStart])) {
        // Skip whitespace in original, but only count 1 in collapsed
        while (origStart < content.length && /\s/.test(content[origStart])) origStart++
        collapsed++ // the single space in collapsed
      } else {
        origStart++
        collapsed++
      }
    }
    // Find end similarly
    let origEnd = origStart
    let needleCollapsed = 0
    while (needleCollapsed < collapsedNeedle.length && origEnd < content.length) {
      if (/\s/.test(content[origEnd])) {
        while (origEnd < content.length && /\s/.test(content[origEnd])) origEnd++
        needleCollapsed++
      } else {
        origEnd++
        needleCollapsed++
      }
    }
    return { start: origStart, end: origEnd }
  }

  // 3) Try substring: if the needle is long enough, try finding the best matching substring
  if (needle.length > 40) {
    // Try first 60% and last 60% 
    const firstPart = needle.slice(0, Math.floor(needle.length * 0.6))
    const lastPart = needle.slice(Math.floor(needle.length * 0.4))
    const firstIdx = content.indexOf(firstPart)
    const lastIdx = content.indexOf(lastPart)
    if (firstIdx !== -1 && lastIdx !== -1 && lastIdx >= firstIdx) {
      return { start: firstIdx, end: lastIdx + lastPart.length }
    }
  }

  return null
}

function resolveExactMatchTarget(content: string, oldText: string) {
  const matches = findAllOccurrences(content, oldText)
  if (matches.length === 1) {
    return { start: matches[0], end: matches[0] + oldText.length }
  }
  if (matches.length > 1) {
    throw new PromptPatchError('Trecho antigo aparece múltiplas vezes; confirmação necessária')
  }

  // Exact match failed — try fuzzy matching
  const fuzzy = fuzzyFindInContent(content, oldText)
  if (fuzzy) {
    return fuzzy
  }

  throw new PromptPatchError('Trecho antigo não encontrado no prompt atual')
}

function resolveSpanTarget(content: string, startMarker?: string, endMarker?: string) {
  if (!startMarker) throw new PromptPatchError('Marcador inicial ausente para operação por trecho')
  const start = content.indexOf(startMarker)
  if (start === -1) {
    throw new PromptPatchError('Marcador inicial não encontrado no prompt atual')
  }

  const from = start + startMarker.length
  if (!endMarker) {
    return { start: from, end: content.length }
  }

  const end = content.indexOf(endMarker, from)
  if (end === -1) {
    throw new PromptPatchError('Marcador final não encontrado no prompt atual')
  }

  return { start: from, end }
}

export function applyPromptPatch(content: string, patch: PromptPatchPlan): string {
  const normalizedContent = normalizeLineEndings(content)
  const normalizedOld = normalizeLineEndings(patch.oldText || '')
  const normalizedNew = normalizeLineEndings(patch.newText || '')

  let result = normalizedContent

  switch (patch.operation) {
    case 'REPLACE': {
      if (patch.target.strategy === 'text_span') {
        const span = resolveSpanTarget(normalizedContent, patch.target.startMarker, patch.target.endMarker)
        result = `${normalizedContent.slice(0, span.start)}${normalizedNew}${normalizedContent.slice(span.end)}`
        break
      }

      const exact = resolveExactMatchTarget(normalizedContent, normalizedOld)
      result = `${normalizedContent.slice(0, exact.start)}${normalizedNew}${normalizedContent.slice(exact.end)}`
      break
    }

    case 'INSERT_BEFORE': {
      const exact = patch.target.strategy === 'text_span'
        ? resolveSpanTarget(normalizedContent, patch.target.startMarker, patch.target.endMarker)
        : resolveExactMatchTarget(normalizedContent, normalizedOld)
      result = `${normalizedContent.slice(0, exact.start)}${normalizedNew}${normalizedContent.slice(exact.start)}`
      break
    }

    case 'INSERT_AFTER': {
      const exact = patch.target.strategy === 'text_span'
        ? resolveSpanTarget(normalizedContent, patch.target.startMarker, patch.target.endMarker)
        : resolveExactMatchTarget(normalizedContent, normalizedOld)
      const insertAt = patch.target.strategy === 'text_span' ? exact.end : exact.end
      result = `${normalizedContent.slice(0, insertAt)}${normalizedNew}${normalizedContent.slice(insertAt)}`
      break
    }

    case 'APPEND': {
      result = normalizedContent.endsWith('\n')
        ? `${normalizedContent}${normalizedNew}`
        : `${normalizedContent}\n${normalizedNew}`
      break
    }

    case 'REMOVE': {
      if (patch.target.strategy === 'text_span') {
        const span = resolveSpanTarget(normalizedContent, patch.target.startMarker, patch.target.endMarker)
        result = `${normalizedContent.slice(0, span.start)}${normalizedContent.slice(span.end)}`
        break
      }

      const exact = resolveExactMatchTarget(normalizedContent, normalizedOld)
      result = `${normalizedContent.slice(0, exact.start)}${normalizedContent.slice(exact.end)}`
      break
    }

    default:
      throw new PromptPatchError(`Operação não suportada: ${patch.operation}`)
  }

  if (result === normalizedContent) {
    throw new PromptPatchError('O patch não produziu nenhuma alteração no prompt')
  }

  return restoreLineEndings(result, content)
}
