import { createProvider } from '../providers/index.js'
import { getProviderWithSecrets } from '../ai.service.js'
import { trackTokenUsage } from '../token-tracker.js'
import type { CoachIssue } from './types.js'

/**
 * Revisor baseado em IA: lê o prompt atual, retorna issues que as heurísticas
 * estáticas não conseguem detectar (ambiguidade, contradições sutis, lacunas
 * semânticas), e um resumo executivo.
 *
 * Saída é JSON estrito:
 * {
 *   "summary": "texto curto em PT-BR",
 *   "issues": [{ "pillar": "rules", "severity": "warning", "title": "...", "message": "...", "excerpt": "...", "suggestionLabel": "...", "suggestionInstruction": "..." }]
 * }
 */

export interface ReviewerResult {
  issues: CoachIssue[]
  summary?: string
  aiUsed: boolean
}

function buildSystemPrompt() {
  return [
    'Você é um auditor sênior de prompts de assistentes virtuais (Sistema Prompt de agentes de IA para atendimento).',
    'Sua função é CRITICAR o prompt apresentado — não reescrevê-lo.',
    'Aponte até 6 problemas semânticos concretos que as heurísticas automáticas não detectariam. Exemplos:',
    '- Ambiguidade: instruções que podem ser interpretadas de várias formas',
    '- Contradições: duas instruções que se contradizem',
    '- Lacunas críticas: cenários importantes que o prompt não cobre',
    '- Tom inconsistente: mistura de formal/informal sem critério',
    '- Instruções técnicas demais para clientes finais',
    '- Falta de diferenciação: prompt genérico que serve para qualquer negócio',
    '- Redundância: mesma regra repetida de formas diferentes',
    '',
    'Para cada problema, dê:',
    '- `pillar`: um de role | goal | rules | tone | structure | examples | variables | fallback | flow | quality',
    '- `severity`: error (impede funcionamento) | warning (degrada muito) | info (pode melhorar) | suggestion (opcional)',
    '- `title`: 3-8 palavras',
    '- `message`: explicação em PT-BR, direta, em 1-3 frases',
    '- `excerpt`: trecho exato do prompt (opcional)',
    '- `suggestionLabel`: rótulo curto de ação (ex: "Adicionar exemplo", "Tornar específico")',
    '- `suggestionInstruction`: instrução que será passada ao EDITOR PATCH-ONLY. Deve:',
    '    1. Ser executável como patch parcial (não reescrever tudo)',
    '    2. Incluir "Preserve o resto do prompt."',
    '    3. Ser em PT-BR, imperativa, concreta',
    '',
    'Escreva também um `summary` curto (2-3 frases) com o diagnóstico geral.',
    'IMPORTANTE: seja DIRETO e não tente agradar. Se o prompt está bom, diga; se é ruim, não suavize.',
    'Responda SOMENTE com JSON válido, sem markdown, sem comentários.',
    '',
    'Formato esperado:',
    '{"summary":"...","issues":[{"pillar":"rules","severity":"warning","title":"...","message":"...","excerpt":"...","suggestionLabel":"...","suggestionInstruction":"..."}]}',
  ].join('\n')
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Resposta da IA não contém JSON válido')
  }
  return trimmed.slice(firstBrace, lastBrace + 1)
}

function normalizeIssue(raw: any, index: number): CoachIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const validPillars = new Set(['role', 'goal', 'rules', 'tone', 'structure', 'examples', 'variables', 'fallback', 'flow', 'quality'])
  const validSeverities = new Set(['error', 'warning', 'info', 'suggestion'])
  const pillar = validPillars.has(raw.pillar) ? raw.pillar : 'quality'
  const severity = validSeverities.has(raw.severity) ? raw.severity : 'info'
  const title = String(raw.title || '').trim().slice(0, 120)
  const message = String(raw.message || '').trim().slice(0, 600)
  if (!title || !message) return null
  const suggestion =
    raw.suggestionInstruction && String(raw.suggestionInstruction).trim()
      ? {
          label: String(raw.suggestionLabel || 'Aplicar sugestão').slice(0, 80),
          instruction: String(raw.suggestionInstruction).trim().slice(0, 800),
        }
      : undefined
  return {
    id: `ai_${index}_${pillar}`,
    pillar,
    severity,
    title,
    message,
    excerpt: raw.excerpt ? String(raw.excerpt).slice(0, 240) : undefined,
    source: 'ai',
    suggestion,
  }
}

export async function runAIReview(params: {
  text: string
  companyId: string
  agentId: string
  providerId: string
  model: string
}): Promise<ReviewerResult> {
  const { text, companyId, agentId, providerId, model } = params

  const provider = await getProviderWithSecrets(providerId, companyId)
  if (!provider) throw new Error('Provider não encontrado')
  if (!provider.isActive) throw new Error(`Provider "${provider.name}" está inativo`)

  const modelName = model || provider.model
  const providerImpl = createProvider(provider.type, provider.apiKey, provider.baseUrl, provider.oauthData)

  const completion = await providerImpl.chat({
    model: modelName,
    systemPrompt: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          'Analise o prompt abaixo (delimitado por <prompt>) e retorne o JSON com summary + issues.',
          '<prompt>',
          text,
          '</prompt>',
        ].join('\n'),
      },
    ],
    temperature: 0.2,
    maxTokens: 1800,
  })

  await trackTokenUsage({
    companyId,
    agentId,
    instanceId: '__prompt_coach__',
    model: completion.model || modelName,
    promptTokens: completion.promptTokens || Math.floor(completion.tokensUsed * 0.7),
    completionTokens: completion.completionTokens || Math.floor(completion.tokensUsed * 0.3),
    totalTokens: completion.tokensUsed,
  })

  let parsed: any
  try {
    parsed = JSON.parse(extractJsonObject(completion.content))
  } catch {
    return { issues: [], summary: undefined, aiUsed: true }
  }

  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : []
  const issues = rawIssues
    .slice(0, 10)
    .map((r: any, i: number) => normalizeIssue(r, i))
    .filter((i: CoachIssue | null): i is CoachIssue => !!i)

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 500) : undefined

  return { issues, summary, aiUsed: true }
}
