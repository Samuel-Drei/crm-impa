import type { CoachIssue, CoachPillar, CoachPillarScore } from './types.js'
import type { PromptStats } from './analyzer.js'
import { pillarLabel } from './analyzer.js'

/**
 * Rubrica de pontuação — 100 pontos totais:
 *   role       10
 *   goal       10
 *   rules      20
 *   fallback   10
 *   examples   15
 *   tone       10
 *   structure  10
 *   variables  10
 *   flow        5
 */
const MAX: Record<CoachPillar, number> = {
  role: 10,
  goal: 10,
  rules: 20,
  fallback: 10,
  examples: 15,
  tone: 10,
  structure: 10,
  variables: 10,
  flow: 5,
  quality: 0, // não soma diretamente; entra como penalidade
}

function scoreRole(stats: PromptStats): number {
  if (!stats.hasRole) return 0
  // bônus se também tiver especialização/contexto
  return stats.words > 50 ? MAX.role : Math.round(MAX.role * 0.7)
}

function scoreGoal(stats: PromptStats): number {
  return stats.hasGoal ? MAX.goal : 0
}

function scoreRules(stats: PromptStats, text: string): number {
  if (!stats.hasRules) return 0
  // Quantas regras reais? Procura padrões "nunca", "sempre", "não pode/deve"
  const ruleCount =
    (text.match(/\b(nunca|sempre|n[aã]o (pode|deve)|proibid|obrigat|must( not)?)\b/gi) || []).length
  if (ruleCount >= 5) return MAX.rules
  if (ruleCount >= 3) return Math.round(MAX.rules * 0.75)
  if (ruleCount >= 1) return Math.round(MAX.rules * 0.5)
  return Math.round(MAX.rules * 0.25)
}

function scoreFallback(stats: PromptStats): number {
  return stats.hasFallback ? MAX.fallback : 0
}

function scoreExamples(stats: PromptStats): number {
  if (stats.examples === 0) return 0
  if (stats.examples >= 3) return MAX.examples
  if (stats.examples >= 2) return Math.round(MAX.examples * 0.75)
  return Math.round(MAX.examples * 0.5)
}

function scoreTone(stats: PromptStats): number {
  return stats.hasTone ? MAX.tone : 0
}

function scoreStructure(stats: PromptStats): number {
  if (stats.sections >= 4) return MAX.structure
  if (stats.sections >= 2) return Math.round(MAX.structure * 0.7)
  if (stats.sections >= 1) return Math.round(MAX.structure * 0.4)
  // prompts curtos não precisam de seções
  if (stats.words < 120) return Math.round(MAX.structure * 0.6)
  return 0
}

function scoreVariables(stats: PromptStats): number {
  if (stats.placeholders === 0) return Math.round(MAX.variables * 0.5) // neutro, pode não precisar
  // tem placeholders conhecidos (contact_name, current_datetime, etc)?
  const known = ['{contact_name}', '{current_datetime}', '{current_date}', '{current_time}', '{remote_jid}']
  const anyKnown = known.some((k) => stats.uniquePlaceholders.has(k))
  return anyKnown ? MAX.variables : Math.round(MAX.variables * 0.6)
}

function scoreFlow(stats: PromptStats): number {
  return stats.hasFlow ? MAX.flow : 0
}

/** Aplica penalidades de issues severas não cobertas pela rubrica acima. */
function applyQualityPenalty(base: number, issues: CoachIssue[]): number {
  let penalty = 0
  for (const issue of issues) {
    if (issue.pillar !== 'quality') continue
    if (issue.severity === 'error') penalty += 8
    else if (issue.severity === 'warning') penalty += 4
    else if (issue.severity === 'info') penalty += 1
  }
  return Math.max(0, base - penalty)
}

function grade(score: number): string {
  if (score >= 85) return 'Excelente'
  if (score >= 70) return 'Bom'
  if (score >= 50) return 'Precisa melhorar'
  if (score >= 30) return 'Fraco'
  return 'Crítico'
}

export function computeScore(stats: PromptStats, issues: CoachIssue[], text: string) {
  const pillars: CoachPillarScore[] = [
    { pillar: 'role', label: pillarLabel('role'), score: scoreRole(stats), maxScore: MAX.role },
    { pillar: 'goal', label: pillarLabel('goal'), score: scoreGoal(stats), maxScore: MAX.goal },
    { pillar: 'rules', label: pillarLabel('rules'), score: scoreRules(stats, text), maxScore: MAX.rules },
    { pillar: 'fallback', label: pillarLabel('fallback'), score: scoreFallback(stats), maxScore: MAX.fallback },
    { pillar: 'examples', label: pillarLabel('examples'), score: scoreExamples(stats), maxScore: MAX.examples },
    { pillar: 'tone', label: pillarLabel('tone'), score: scoreTone(stats), maxScore: MAX.tone },
    { pillar: 'structure', label: pillarLabel('structure'), score: scoreStructure(stats), maxScore: MAX.structure },
    { pillar: 'variables', label: pillarLabel('variables'), score: scoreVariables(stats), maxScore: MAX.variables },
    { pillar: 'flow', label: pillarLabel('flow'), score: scoreFlow(stats), maxScore: MAX.flow },
  ]

  const raw = pillars.reduce((sum, p) => sum + p.score, 0)
  const final = applyQualityPenalty(raw, issues)
  return { score: final, pillars, grade: grade(final) }
}
