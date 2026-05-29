import type { AIAgentPromptField } from '@prisma/client'

/** Severidade de um problema detectado no prompt */
export type CoachIssueSeverity = 'error' | 'warning' | 'info' | 'suggestion'

/** Categoria/pilar avaliado */
export type CoachPillar =
  | 'role'           // Papel / Persona
  | 'goal'           // Objetivo claro
  | 'rules'          // Regras / Limites
  | 'tone'           // Tom / Estilo
  | 'structure'      // Organização / Seções
  | 'examples'       // Few-shot examples
  | 'variables'      // Placeholders usados
  | 'fallback'       // Tratamento de erro / "não sei"
  | 'flow'           // CTA / próximos passos
  | 'quality'        // Problemas de redação genéricos

/** Um problema específico detectado */
export interface CoachIssue {
  id: string
  pillar: CoachPillar
  severity: CoachIssueSeverity
  title: string
  message: string
  /** Trecho do prompt onde o problema aparece (se detectável) */
  excerpt?: string
  /** Sugestão de correção aplicável automaticamente */
  suggestion?: {
    label: string
    /** Instrução que será passada ao prompt-editor patch-only */
    instruction: string
  }
  /** Se veio de heurística estática ou de IA */
  source: 'static' | 'ai'
}

/** Pontuação por pilar */
export interface CoachPillarScore {
  pillar: CoachPillar
  label: string
  score: number      // 0..maxScore
  maxScore: number
  notes?: string
}

/** Resposta da análise completa */
export interface CoachAnalysisResponse {
  field: AIAgentPromptField
  /** Pontuação global 0..100 */
  score: number
  /** Rótulo: "Excelente" | "Bom" | "Precisa melhorar" | "Crítico" */
  grade: string
  /** Breakdown por pilar */
  pillars: CoachPillarScore[]
  /** Issues detectadas (estáticas + IA) */
  issues: CoachIssue[]
  /** Resumo textual gerado pela IA (se disponível) */
  summary?: string
  /** Estatísticas simples */
  stats: {
    chars: number
    words: number
    lines: number
    sections: number      // contagem de headings markdown
    placeholders: number  // {variavel}
    examples: number      // blocos de exemplo detectados
  }
  /** Se a IA foi usada (depende do provider/model) */
  aiUsed: boolean
}

/** Request para análise */
export interface CoachAnalyzeRequest {
  field: AIAgentPromptField
  /** Se true, usa IA (reviewer) além das heurísticas estáticas */
  useAI?: boolean
  /** Override de provider/model (igual prompt-editor) */
  providerId?: string
  model?: string
}
