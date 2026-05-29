import type { AIAgentPromptField } from '@prisma/client'
import { prisma } from '../../../config/database.js'
import { computeStats, runStaticAnalysis } from './analyzer.js'
import { computeScore } from './scorer.js'
import { runAIReview } from './reviewer.js'
import type { CoachAnalysisResponse, CoachAnalyzeRequest, CoachIssue } from './types.js'

function getFieldValue(agent: { systemPrompt: string; followUpPrompt: string | null }, field: AIAgentPromptField) {
  return field === 'SYSTEM_PROMPT' ? agent.systemPrompt : (agent.followUpPrompt || '')
}

async function getCoachAgent(agentId: string, companyId: string) {
  const agent = await prisma.aIAgent.findFirst({
    where: { id: agentId, companyId },
    include: {
      provider: { select: { id: true, type: true, model: true } },
    },
  })
  if (!agent) throw new Error('Agente não encontrado')
  return agent
}

/**
 * Deduplica issues priorizando IA sobre estática quando ambas tocam no mesmo pillar com
 * mensagem muito semelhante (heurística simples por título normalizado).
 */
function mergeIssues(staticIssues: CoachIssue[], aiIssues: CoachIssue[]): CoachIssue[] {
  const seen = new Set<string>()
  const out: CoachIssue[] = []
  // AI primeiro — crítica contextual ganha precedência
  for (const issue of [...aiIssues, ...staticIssues]) {
    const key = `${issue.pillar}:${issue.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 40)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  // ordena por severidade (error → warning → info → suggestion)
  const sevRank: Record<string, number> = { error: 0, warning: 1, info: 2, suggestion: 3 }
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
  return out
}

export async function analyzePrompt(
  agentId: string,
  companyId: string,
  request: CoachAnalyzeRequest,
): Promise<CoachAnalysisResponse> {
  const agent = await getCoachAgent(agentId, companyId)
  const text = getFieldValue(agent, request.field)

  const stats = computeStats(text)
  const staticIssues = runStaticAnalysis(text, stats)

  let aiIssues: CoachIssue[] = []
  let summary: string | undefined
  let aiUsed = false

  if (request.useAI && text.trim().length > 0) {
    try {
      const providerId = request.providerId || agent.providerId
      const model = request.model || agent.model || agent.provider.model
      const result = await runAIReview({ text, companyId, agentId, providerId, model })
      aiIssues = result.issues
      summary = result.summary
      aiUsed = result.aiUsed
    } catch (err: any) {
      // Não fatal — análise estática ainda retorna
      console.error('[PromptCoach] AI review failed:', err?.message)
    }
  }

  const issues = mergeIssues(staticIssues, aiIssues)
  const { score, pillars, grade } = computeScore(stats, issues, text)

  return {
    field: request.field,
    score,
    grade,
    pillars,
    issues,
    summary,
    aiUsed,
    stats: {
      chars: stats.chars,
      words: stats.words,
      lines: stats.lines,
      sections: stats.sections,
      placeholders: stats.placeholders,
      examples: stats.examples,
    },
  }
}
