import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronDown, Loader2, Kanban, ArrowRight } from 'lucide-react'
import { getPipelines, createCard } from '@/services/pipeline.service'
import type { Pipeline, Stage } from '@/types'

interface AddToPipelineModalProps {
  conversationId: string
  contactId?: string | null
  contactName?: string | null
  onClose: () => void
  onSuccess: (card: any) => void
}

export default function AddToPipelineModal({
  conversationId,
  contactId,
  contactName,
  onClose,
  onSuccess,
}: AddToPipelineModalProps) {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [selectedStageId, setSelectedStageId] = useState<string>('')
  const [cardTitle, setCardTitle] = useState(contactName || '')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const { data: pipelines, isLoading } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
    staleTime: 30000,
  })

  const selectedPipeline = pipelines?.find(p => p.id === selectedPipelineId)
  const stages = selectedPipeline?.stages
    ?.filter(s => !s.isWon && !s.isLost)
    ?.sort((a, b) => a.position - b.position) || []

  // Auto-select first pipeline and first stage
  useEffect(() => {
    if (pipelines?.length && !selectedPipelineId) {
      const defaultPipeline = pipelines.find(p => p.isDefault && p.isActive) || pipelines.find(p => p.isActive) || pipelines[0]
      if (defaultPipeline) setSelectedPipelineId(defaultPipeline.id)
    }
  }, [pipelines, selectedPipelineId])

  useEffect(() => {
    if (stages.length && !stages.find(s => s.id === selectedStageId)) {
      setSelectedStageId(stages[0].id)
    }
  }, [stages, selectedStageId])

  useEffect(() => {
    if (contactName && !cardTitle) setCardTitle(contactName)
  }, [contactName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPipelineId || !selectedStageId || !cardTitle.trim()) return

    setCreating(true)
    setError('')
    try {
      const card = await createCard(selectedPipelineId, {
        title: cardTitle.trim(),
        stageId: selectedStageId,
        conversationId,
        contactId: contactId || undefined,
      })
      onSuccess(card)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao criar card')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--chat-sidebar)] rounded-xl shadow-2xl w-[420px] max-h-[90vh] overflow-hidden border border-[var(--chat-border-strong)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--chat-border)]">
          <div className="flex items-center gap-2">
            <Kanban className="h-5 w-5 text-[var(--chat-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--chat-text-primary)]">Adicionar ao Pipeline</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--chat-sidebar-active)] transition-colors">
            <X className="h-4 w-4 text-[var(--chat-text-secondary)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-accent)]" />
            </div>
          ) : !pipelines?.length ? (
            <p className="text-sm text-[var(--chat-text-secondary)] text-center py-4">
              Nenhum pipeline encontrado. Crie um primeiro.
            </p>
          ) : (
            <>
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-[var(--chat-text-secondary)] mb-1.5">
                  Título do Card
                </label>
                <input
                  type="text"
                  value={cardTitle}
                  onChange={e => setCardTitle(e.target.value)}
                  placeholder="Ex: Negociação com João"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--chat-header)] border border-[var(--chat-border)] text-sm text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--chat-accent)]"
                  autoFocus
                />
              </div>

              {/* Pipeline selector */}
              <div>
                <label className="block text-xs font-medium text-[var(--chat-text-secondary)] mb-1.5">
                  Pipeline
                </label>
                <select
                  value={selectedPipelineId}
                  onChange={e => { setSelectedPipelineId(e.target.value); setSelectedStageId('') }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--chat-header)] border border-[var(--chat-border)] text-sm text-[var(--chat-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--chat-accent)] appearance-none cursor-pointer"
                >
                  {pipelines.filter(p => p.isActive).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Stage selector — visual */}
              {selectedPipeline && (
                <div>
                  <label className="block text-xs font-medium text-[var(--chat-text-secondary)] mb-1.5">
                    Etapa
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selectedPipeline.stages
                      ?.sort((a, b) => a.position - b.position)
                      .map((stage, idx) => (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => setSelectedStageId(stage.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                            selectedStageId === stage.id
                              ? 'ring-2 ring-[var(--chat-accent)] border-[var(--chat-accent)] bg-[var(--chat-accent)]/10 text-[var(--chat-text-primary)]'
                              : 'border-[var(--chat-border)] bg-[var(--chat-header)] text-[var(--chat-text-secondary)] hover:border-[var(--chat-accent)]/50'
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: stage.color || '#6366f1' }}
                          />
                          {stage.name}
                          {stage.isWon && <span className="text-emerald-400 text-[10px]">✓</span>}
                          {stage.isLost && <span className="text-red-400 text-[10px]">✗</span>}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--chat-text-secondary)] hover:bg-[var(--chat-header)] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !cardTitle.trim() || !selectedStageId}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--chat-accent)] text-white hover:bg-[var(--chat-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5" />
                  )}
                  Adicionar
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
