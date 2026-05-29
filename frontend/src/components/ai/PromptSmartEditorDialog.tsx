import { useEffect, useMemo, useState } from 'react'
import { Wand2, History, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  type AIAgentPromptField,
  type AIAgentPromptVersion,
  type PromptDiffHunk,
  type PromptEditCandidate,
  type PromptEditorFlags,
  previewAIAgentPromptEdit,
  applyAIAgentPromptEdit,
  listAIAgentPromptVersions,
  restoreAIAgentPromptVersion,
} from '@/services/ai.service'

interface PromptSmartEditorDialogProps {
  agentId?: string
  field: AIAgentPromptField
  currentText: string
  onApplied: (newValue: string) => void
}

const DEFAULT_FLAGS: PromptEditorFlags = {
  preservePlaceholders: true,
  preserveTools: true,
  preserveStructure: true,
  partialOnly: true,
}

function fieldLabel(field: AIAgentPromptField) {
  return field === 'SYSTEM_PROMPT' ? 'Prompt do Sistema' : 'Prompt de Follow-up'
}

function HunkView({ hunk }: { hunk: PromptDiffHunk }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 text-xs bg-muted/60 border-b">
        -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
      </div>
      <pre className="text-xs p-3 overflow-x-auto bg-background whitespace-pre-wrap">
        {hunk.lines.map((line, index) => {
          const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'ctx'
          const className = kind === 'add'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : kind === 'remove'
              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
              : 'text-muted-foreground'

          return (
            <div key={`${index}-${line.slice(0, 8)}`} className={className}>
              {line}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

export function PromptSmartEditorDialog({ agentId, field, currentText, onApplied }: PromptSmartEditorDialogProps) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [flags, setFlags] = useState<PromptEditorFlags>(DEFAULT_FLAGS)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<any | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<PromptEditCandidate | null>(null)
  const [versions, setVersions] = useState<AIAgentPromptVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null)

  const blockedByMissingId = !agentId

  const hasBlockingIssue = useMemo(
    () => (preview?.validationIssues || []).some((issue: any) => issue.severity === 'error'),
    [preview],
  )

  async function loadVersions() {
    if (!agentId) return
    setLoadingVersions(true)
    try {
      const data = await listAIAgentPromptVersions(agentId)
      setVersions(data.filter(v => v.field === field))
    } catch {
      toast.error('Não foi possível carregar o histórico de versões')
    } finally {
      setLoadingVersions(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadVersions()
    }
  }, [open])

  async function handleGeneratePreview() {
    if (!agentId) {
      toast.warning('Salve o agente antes de usar o editor inteligente')
      return
    }
    if (!instruction.trim()) {
      toast.warning('Descreva a alteração desejada em linguagem natural')
      return
    }

    setLoadingPreview(true)
    try {
      const data = await previewAIAgentPromptEdit(agentId, {
        field,
        instruction: instruction.trim(),
        flags,
        selectedCandidate,
      })
      setPreview(data)

      if (data.needsConfirmation) {
        toast.warning('A IA pediu confirmação do trecho alvo antes de aplicar')
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Falha ao gerar preview inteligente')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleApply() {
    if (!agentId || !preview?.patch) return
    setApplying(true)
    try {
      const data = await applyAIAgentPromptEdit(agentId, {
        field,
        instruction: instruction.trim(),
        flags,
        patch: preview.patch,
      })

      const newValue = field === 'SYSTEM_PROMPT'
        ? data.agent.systemPrompt
        : (data.agent.followUpPrompt || '')

      onApplied(newValue)
      toast.success('Edição parcial aplicada com sucesso')
      setPreview(null)
      setInstruction('')
      await loadVersions()
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Falha ao aplicar edição parcial')
    } finally {
      setApplying(false)
    }
  }

  async function handleRestore(versionId: string) {
    if (!agentId) return
    setRestoringVersionId(versionId)
    try {
      const data = await restoreAIAgentPromptVersion(agentId, versionId)
      const newValue = field === 'SYSTEM_PROMPT'
        ? data.agent.systemPrompt
        : (data.agent.followUpPrompt || '')

      onApplied(newValue)
      toast.success('Versão restaurada com sucesso')
      await loadVersions()
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Falha ao restaurar versão')
    } finally {
      setRestoringVersionId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="gap-2">
          <Wand2 className="h-4 w-4" />
          Editar com IA
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-blue-500" />
            Editor Inteligente de Prompt
          </DialogTitle>
          <DialogDescription>
            {fieldLabel(field)} em modo patch: altera somente o trecho necessário e preserva o restante.
          </DialogDescription>
        </DialogHeader>

        {blockedByMissingId ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
            Salve o agente primeiro para habilitar preview, versionamento e restauração.
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <label className="text-sm font-medium block">Peça a alteração</label>
              <Textarea
                rows={4}
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="Ex: deixe a abertura mais humanizada sem mexer nas regras"
              />

              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={flags.preservePlaceholders} onChange={e => setFlags(f => ({ ...f, preservePlaceholders: e.target.checked }))} /> Preservar placeholders</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={flags.preserveTools} onChange={e => setFlags(f => ({ ...f, preserveTools: e.target.checked }))} /> Preservar tools</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={flags.preserveStructure} onChange={e => setFlags(f => ({ ...f, preserveStructure: e.target.checked }))} /> Preservar estrutura</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={flags.partialOnly} onChange={e => setFlags(f => ({ ...f, partialOnly: e.target.checked }))} /> Só edição parcial</label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleGeneratePreview} disabled={loadingPreview || blockedByMissingId}>
                  {loadingPreview ? 'Gerando...' : 'Gerar sugestão'}
                </Button>
                {preview?.needsConfirmation && (preview?.candidates || []).length > 0 ? (
                  <Button type="button" variant="secondary" onClick={handleGeneratePreview} disabled={loadingPreview || !selectedCandidate}>
                    Confirmar trecho e tentar novamente
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => { setPreview(null); setSelectedCandidate(null) }}>
                  Limpar preview
                </Button>
              </div>
            </div>

            {preview?.needsConfirmation && (preview?.candidates || []).length > 0 ? (
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Confirme o trecho alvo
                </div>
                <div className="space-y-2">
                  {(preview.candidates || []).map((candidate: PromptEditCandidate, idx: number) => (
                    <label key={`${idx}-${candidate.label}`} className="block rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                      <div className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="candidate"
                          checked={selectedCandidate?.label === candidate.label && selectedCandidate?.excerpt === candidate.excerpt}
                          onChange={() => setSelectedCandidate(candidate)}
                        />
                        <div>
                          <div className="font-medium text-sm">{candidate.label}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2">{candidate.excerpt}</div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {preview?.resultText ? (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-xl border bg-card p-4">
                    <div className="text-sm font-medium mb-2">Original</div>
                    <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-[280px] border rounded p-3 bg-muted/30">{preview.originalText}</pre>
                  </div>
                  <div className="rounded-xl border bg-card p-4">
                    <div className="text-sm font-medium mb-2">Resultado</div>
                    <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-[280px] border rounded p-3 bg-muted/30">{preview.resultText}</pre>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium">Diff visual</div>
                    <div className="text-xs text-muted-foreground">
                      +{preview.diff?.additions || 0} / -{preview.diff?.removals || 0}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {(preview.diff?.hunks || []).map((hunk: PromptDiffHunk, idx: number) => (
                      <HunkView key={idx} hunk={hunk} />
                    ))}
                  </div>
                </div>

                {(preview.validationIssues || []).length > 0 ? (
                  <div className="rounded-xl border bg-card p-4">
                    <div className="text-sm font-medium mb-2">Validações</div>
                    <div className="space-y-2">
                      {(preview.validationIssues || []).map((issue: any, idx: number) => (
                        <div key={`${idx}-${issue.code}`} className={`text-xs rounded p-2 ${issue.severity === 'error' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleApply} disabled={applying || hasBlockingIssue || blockedByMissingId}>
                    {applying ? 'Aplicando...' : 'Aplicar patch'}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleGeneratePreview} disabled={loadingPreview || blockedByMissingId}>
                    Gerar nova sugestão
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3 h-fit">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4" /> Histórico
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={loadVersions} disabled={loadingVersions || blockedByMissingId}>
                <RefreshCw className={`h-4 w-4 ${loadingVersions ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma versão registrada para este campo.</p>
              ) : (
                versions.map(version => (
                  <div key={version.id} className="rounded-lg border p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</div>
                    <div className="text-sm font-medium line-clamp-2">{version.instruction}</div>
                    <div className="text-xs text-muted-foreground">
                      Confiança: {typeof version.confidence === 'number' ? version.confidence.toFixed(2) : '-'}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setInstruction(version.instruction)
                          setPreview({
                            originalText: currentText,
                            resultText: version.resultText,
                            diff: version.diffJson,
                            validationIssues: version.warnings || [],
                            needsConfirmation: false,
                          })
                        }}
                      >
                        Ver diff
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleRestore(version.id)}
                        disabled={restoringVersionId === version.id}
                      >
                        {restoringVersionId === version.id ? 'Restaurando...' : <><Check className="h-3 w-3 mr-1" /> Restaurar</>}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
