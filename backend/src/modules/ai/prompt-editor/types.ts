import { AIAgentPromptField, AIPromptPatchOperation } from '@prisma/client'

export type PatchTargetStrategy = 'exact_match' | 'text_span' | 'document_end'

export interface PromptEditorFlags {
  preservePlaceholders: boolean
  preserveTools: boolean
  preserveStructure: boolean
  partialOnly: boolean
}

export interface PromptEditCandidate {
  label: string
  excerpt: string
}

export interface PromptPatchTarget {
  strategy: PatchTargetStrategy
  startMarker?: string
  endMarker?: string
}

export interface PromptPatchPlan {
  confidence: number
  operation: AIPromptPatchOperation
  target: PromptPatchTarget
  oldText: string
  newText: string
  reason: string
  needsConfirmation?: boolean
  candidates?: PromptEditCandidate[]
}

export interface PromptDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface PromptValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface PromptEditPreviewRequest {
  field: AIAgentPromptField
  instruction: string
  flags: PromptEditorFlags
  selectedCandidate?: PromptEditCandidate | null
  /** Override do provider (deve pertencer à mesma empresa). Se omitido, usa o provider do agente. */
  providerId?: string | null
  /** Override do modelo. Se omitido, usa agent.model ?? provider.model. */
  model?: string | null
}

export interface PromptEditPreviewResponse {
  field: AIAgentPromptField
  instruction: string
  originalText: string
  resultText?: string
  patch?: PromptPatchPlan
  diff?: {
    additions: number
    removals: number
    hunks: PromptDiffHunk[]
  }
  validationIssues: PromptValidationIssue[]
  needsConfirmation: boolean
  candidates?: PromptEditCandidate[]
}

export interface PromptApplyRequest {
  field: AIAgentPromptField
  instruction: string
  flags: PromptEditorFlags
  patch: PromptPatchPlan
}
