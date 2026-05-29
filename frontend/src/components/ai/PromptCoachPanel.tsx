import { useState } from 'react'
import { AlertTriangle, Check, Info, Lightbulb, Loader2, Sparkles, Wand2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  type AIAgentPromptField,
  type CoachAnalysisResponse,
  type CoachIssue,
  type CoachIssueSeverity,
  type CoachPillarScore,
  analyzeAIAgentPrompt,
} from '@/services/ai.service'

interface PromptCoachPanelProps {
  agentId: string
  field: AIAgentPromptField
  dirty: boolean
  currentText: string
  providerId?: string | null
  model?: string | null
  onApplySuggestion: (instruction: string) => void
}

function scoreColor(score: number) {
  if (score >= 85) return { bg: 'bg-emerald-500/10', text: 'text-emerald-500', ring: 'ring-emerald-500/30' }
  if (score >= 70) return { bg: 'bg-sky-500/10', text: 'text-sky-500', ring: 'ring-sky-500/30' }
  if (score >= 50) return { bg: 'bg-amber-500/10', text: 'text-amber-500', ring: 'ring-amber-500/30' }
  if (score >= 30) return { bg: 'bg-orange-500/10', text: 'text-orange-500', ring: 'ring-orange-500/30' }
  return { bg: 'bg-rose-500/10', text: 'text-rose-500', ring: 'ring-rose-500/30' }
}

function severityIcon(sev: CoachIssueSeverity) {
  switch (sev) {
    case 'error':
      return <X className="h-3.5 w-3.5 text-rose-500" />
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    case 'info':
      return <Info className="h-3.5 w-3.5 text-sky-500" />
    case 'suggestion':
      return <Lightbulb className="h-3.5 w-3.5 text-violet-500" />
  }
}

function severityBadge(sev: CoachIssueSeverity) {
  switch (sev) {
    case 'error':
      return <span className="text-[10px] font-semibold uppercase text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">Erro</span>
    case 'warning':
      return <span className="text-[10px] font-semibold uppercase text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Atenção</span>
    case 'info':
      return <span className="text-[10px] font-semibold uppercase text-sky-500 bg-sky-500/10 px-1.5 py-0.5 rounded">Dica</span>
    case 'suggestion':
      return <span className="text-[10px] font-semibold uppercase text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded">Ideia</span>
  }
}

function PillarBar({ pillar }: { pillar: CoachPillarScore }) {
  const pct = pillar.maxScore === 0 ? 0 : Math.round((pillar.score / pillar.maxScore) * 100)
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{pillar.label}</span>
        <span className="font-mono text-foreground/80">
          {pillar.score}/{pillar.maxScore}
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function IssueCard({
  issue,
  onApply,
}: {
  issue: CoachIssue
  onApply: (instruction: string) => void
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">{severityIcon(issue.severity)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-semibold">{issue.title}</h4>
            {severityBadge(issue.severity)}
            {issue.source === 'ai' && (
              <span className="text-[10px] font-semibold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                <Sparkles className="h-2.5 w-2.5" />
                IA
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{issue.message}</p>
          {issue.excerpt && (
            <pre className="mt-1.5 text-[11px] font-mono bg-muted/50 p-1.5 rounded border-l-2 border-amber-500/60 whitespace-pre-wrap break-words">
              {issue.excerpt.slice(0, 160)}
              {issue.excerpt.length > 160 ? '…' : ''}
            </pre>
          )}
        </div>
      </div>
      {issue.suggestion && (
        <div className="pl-5.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1"
            onClick={() => onApply(issue.suggestion!.instruction)}
          >
            <Wand2 className="h-3 w-3" />
            {issue.suggestion.label}
          </Button>
        </div>
      )}
    </div>
  )
}

export function PromptCoachPanel({
  agentId,
  field,
  dirty,
  currentText,
  providerId,
  model,
  onApplySuggestion,
}: PromptCoachPanelProps) {
  const [analysis, setAnalysis] = useState<CoachAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [useAI, setUseAI] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function runAnalysis() {
    if (dirty) {
      setError('Salve as alterações antes de analisar o prompt atual.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await analyzeAIAgentPrompt(agentId, {
        field,
        useAI,
        providerId: providerId || undefined,
        model: model || undefined,
      })
      setAnalysis(result)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Falha ao analisar prompt')
    } finally {
      setLoading(false)
    }
  }

  const colors = analysis ? scoreColor(analysis.score) : null

  const issuesBySeverity: Record<CoachIssueSeverity, CoachIssue[]> = {
    error: [],
    warning: [],
    info: [],
    suggestion: [],
  }
  analysis?.issues.forEach((i) => issuesBySeverity[i.severity].push(i))

  return (
    <div className="p-4 space-y-4">
      {/* Intro */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Assistente de Prompt</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Um revisor crítico que analisa seu prompt atual, pontua em 9 dimensões e aponta problemas com
              sugestões acionáveis. Clique em <strong>Analisar agora</strong> para começar.
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={runAnalysis} disabled={loading || dirty} size="sm" className="gap-1.5">
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analisando…
            </>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5" />
              {analysis ? 'Analisar novamente' : 'Analisar agora'}
            </>
          )}
        </Button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input"
          />
          <span>Incluir revisão por IA</span>
        </label>
      </div>

      {dirty && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Você tem alterações não salvas. A análise utiliza a <strong>versão persistida</strong> do prompt,
            então salve antes para obter resultados precisos.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400 flex gap-2">
          <X className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!analysis && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Sparkles className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-xs text-center max-w-xs">
            Clique em "Analisar agora" para receber um diagnóstico completo do seu prompt com pontuação e
            sugestões concretas.
          </p>
        </div>
      )}

      {analysis && colors && (
        <>
          {/* Score & Grade */}
          <div className={`rounded-lg border p-4 ${colors.bg} ring-1 ${colors.ring}`}>
            <div className="flex items-center gap-4">
              <div className={`text-4xl font-bold font-mono tabular-nums ${colors.text}`}>
                {analysis.score}
                <span className="text-base opacity-60">/100</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold ${colors.text}`}>{analysis.grade}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {analysis.stats.words} palavras • {analysis.stats.sections} seções •{' '}
                  {analysis.stats.examples} exemplos • {analysis.stats.placeholders} variáveis
                </div>
                {analysis.aiUsed && (
                  <div className="text-[10px] text-primary mt-1 inline-flex items-center gap-0.5">
                    <Sparkles className="h-2.5 w-2.5" />
                    Revisado por IA
                  </div>
                )}
              </div>
            </div>
            {analysis.summary && (
              <p className="text-xs text-muted-foreground mt-3 italic leading-relaxed border-l-2 border-primary/30 pl-2">
                {analysis.summary}
              </p>
            )}
          </div>

          {/* Pillars */}
          <div className="rounded-lg border p-3 space-y-2.5">
            <h4 className="text-xs font-semibold">Pontuação por dimensão</h4>
            <div className="grid grid-cols-1 gap-2.5">
              {analysis.pillars.map((p) => (
                <PillarBar key={p.pillar} pillar={p} />
              ))}
            </div>
          </div>

          {/* Issues */}
          {analysis.issues.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
              <Check className="h-6 w-6 mx-auto text-emerald-500 mb-1" />
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Nenhum problema detectado!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(['error', 'warning', 'info', 'suggestion'] as CoachIssueSeverity[]).map((sev) => {
                const items = issuesBySeverity[sev]
                if (items.length === 0) return null
                return (
                  <div key={sev} className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {sev === 'error'
                        ? `Críticos (${items.length})`
                        : sev === 'warning'
                          ? `Atenção (${items.length})`
                          : sev === 'info'
                            ? `Dicas (${items.length})`
                            : `Ideias (${items.length})`}
                    </h4>
                    <div className="space-y-2">
                      {items.map((issue) => (
                        <IssueCard key={issue.id} issue={issue} onApply={onApplySuggestion} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
