import { structuredPatch } from 'diff'
import type { PromptDiffHunk } from './types.js'

export function buildPromptDiff(oldText: string, newText: string) {
  const patch = structuredPatch('prompt-before', 'prompt-after', oldText, newText, '', '', {
    context: 3,
  })

  const hunks: PromptDiffHunk[] = (patch.hunks || []).map(hunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }))

  let additions = 0
  let removals = 0

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      if (line.startsWith('-') && !line.startsWith('---')) removals += 1
    }
  }

  return { additions, removals, hunks }
}
