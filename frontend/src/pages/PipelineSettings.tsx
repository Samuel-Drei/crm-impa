import { useState, useEffect } from 'react'
import {
  Kanban, Plus, Trash2, Edit2, X, Save, GripVertical, ChevronRight,
  ChevronDown, Settings2, Check, Star
} from 'lucide-react'
import {
  getPipelines, createPipeline, updatePipeline, deletePipeline,
  addStage, updateStage, deleteStage, reorderStages
} from '@/services/pipeline.service'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { useModuleStore } from '@/stores/module.store'
import type { Pipeline, Stage } from '@/types'

const STAGE_COLORS = [
  '#6b7280', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#ef4444', '#06b6d4', '#f97316', '#84cc16',
]

export function PipelineSettings() {
  const toast = useToast()
  const { can } = usePermissions()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', type: 'sales' })
  const [newStageName, setNewStageName] = useState('')
  const [newStageColor, setNewStageColor] = useState('#3b82f6')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [stageEditForm, setStageEditForm] = useState({ name: '', color: '' })
  const { getPipelineTemplates } = useModuleStore()
  const templates = getPipelineTemplates()

  async function handleCreateFromTemplate(template: any) {
    try {
      await createPipeline({
        name: template.name,
        description: template.description || '',
        type: 'custom',
        stages: template.stages.map((s: any) => ({ name: s.name, color: s.color })),
      })
      setShowTemplates(false)
      loadPipelines()
      toast.success(`Pipeline "${template.name}" criado do template!`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao criar pipeline do template')
    }
  }
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => { loadPipelines() }, [])

  async function loadPipelines() {
    setLoading(true)
    try {
      const data = await getPipelines()
      setPipelines(data)
      if (data.length > 0 && !expandedId) setExpandedId(data[0].id)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleCreatePipeline(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    try {
      await createPipeline({
        name: form.name,
        description: form.description,
        type: form.type,
        stages: [
          { name: 'Novo Lead', color: '#3b82f6' },
          { name: 'Qualificação', color: '#8b5cf6' },
          { name: 'Proposta', color: '#f59e0b' },
          { name: 'Negociação', color: '#f97316' },
          { name: 'Fechamento', color: '#10b981' },
        ],
      })
      setShowCreateForm(false)
      setForm({ name: '', description: '', type: 'sales' })
      loadPipelines()
      toast.success('Pipeline criado com sucesso!')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao criar pipeline')
    }
  }

  async function handleUpdatePipeline(id: string) {
    try {
      await updatePipeline(id, { name: form.name, description: form.description })
      setEditingPipelineId(null)
      loadPipelines()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar pipeline')
    }
  }

  async function handleDeletePipeline(id: string) {
    if (!await toast.confirm({ title: 'Excluir pipeline', message: 'Todos os cards serão excluídos. Esta ação é irreversível!', danger: true, confirmText: 'Excluir' })) return
    try {
      await deletePipeline(id)
      loadPipelines()
      toast.success('Pipeline excluído')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao excluir pipeline')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await updatePipeline(id, { isDefault: true })
      loadPipelines()
      toast.success('Pipeline padrão definido')
    } catch (e) { toast.error('Erro ao definir padrão') }
  }

  async function handleAddStage(pipelineId: string) {
    if (!newStageName.trim()) return
    try {
      await addStage(pipelineId, { name: newStageName, color: newStageColor })
      setNewStageName('')
      setNewStageColor('#3b82f6')
      loadPipelines()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao adicionar stage')
    }
  }

  async function handleUpdateStage(pipelineId: string, stageId: string) {
    try {
      await updateStage(pipelineId, stageId, stageEditForm)
      setEditingStageId(null)
      loadPipelines()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar stage')
    }
  }

  async function handleDeleteStage(pipelineId: string, stageId: string) {
    if (!await toast.confirm({ title: 'Excluir stage', message: 'Tem certeza? Cards neste stage precisam ser movidos primeiro.', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteStage(pipelineId, stageId)
      loadPipelines()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao excluir stage')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Configurações de Pipelines</h1>
            <p className="text-sm text-muted-foreground">Gerencie seus pipelines e stages do Kanban</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/pipelines" className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent">
            ← Voltar ao Kanban
          </a>
          {can('pipelines:manage') && templates.length > 0 && (
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1.5 px-3 py-2 border border-primary text-primary text-sm rounded-lg hover:bg-primary/10"
            >
              <Kanban className="h-4 w-4" /> Criar do Template
            </button>
          )}
          {can('pipelines:manage') && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Novo Pipeline
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form onSubmit={handleCreatePipeline} className="mb-6 p-4 bg-card border border-border rounded-lg space-y-3">
          <h3 className="font-medium text-foreground">Criar Pipeline</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              autoFocus
              type="text"
              placeholder="Nome do pipeline"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value })}
              className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none"
            >
              <option value="sales">Vendas</option>
              <option value="support">Suporte</option>
              <option value="recruitment">Recrutamento</option>
              <option value="custom">Customizado</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Descrição (opcional)"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90">
        

      {/* Templates list */}
      {showTemplates && (
        <div className="mb-6 p-4 bg-card border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-foreground">Criar Pipeline a partir de Template</h3>
            <button onClick={() => setShowTemplates(false)} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3">
            {templates.map(tpl => (
              <div key={tpl.name} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                <div>
                  <p className="font-medium text-sm text-foreground">{tpl.name}</p>
                  {tpl.description && <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tpl.stages.map((s: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-background rounded border border-border/50">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleCreateFromTemplate(tpl)}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 flex-shrink-0"
                >
                  Usar Template
                </button>
              </div>
            ))}
          </div>
        </div>
      )}      Criar
            </button>
            <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Será criado com 5 stages padrão que você pode customizar depois.</p>
        </form>
      )}

      {/* Pipeline list */}
      <div className="space-y-3">
        {pipelines.map(pipeline => {
          const isExpanded = expandedId === pipeline.id

          return (
            <div key={pipeline.id} className="bg-card border border-border rounded-lg overflow-hidden">
              {/* Pipeline header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : pipeline.id)}
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <Kanban className="h-4 w-4 text-primary" />
                  {editingPipelineId === pipeline.id ? (
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleUpdatePipeline(pipeline.id); if (e.key === 'Escape') setEditingPipelineId(null) }}
                        className="px-2 py-1 text-sm border border-primary/50 rounded bg-background focus:outline-none"
                      />
                      <button onClick={() => handleUpdatePipeline(pipeline.id)} className="p-1 text-primary hover:bg-primary/10 rounded"><Save className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setEditingPipelineId(null)} className="p-1 text-muted-foreground hover:bg-muted rounded"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <div>
                      <h3 className="font-medium text-foreground">{pipeline.name}</h3>
                      {pipeline.description && <p className="text-xs text-muted-foreground">{pipeline.description}</p>}
                    </div>
                  )}
                  {pipeline.isDefault && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">Padrão</span>
                  )}
                </div>

                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <span className="text-xs text-muted-foreground">{pipeline.stages?.length || 0} stages · {pipeline._count?.cards || 0} cards</span>
                  {can('pipelines:manage') && (
                    <>
                      {!pipeline.isDefault && (
                        <button
                          onClick={() => handleSetDefault(pipeline.id)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          title="Definir como padrão"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingPipelineId(pipeline.id); setForm({ name: pipeline.name, description: pipeline.description || '', type: pipeline.type }) }}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        title="Editar"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeletePipeline(pipeline.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Stages */}
              {isExpanded && (
                <div className="border-t border-border">
                  <div className="p-4 space-y-2">
                    {pipeline.stages
                      ?.sort((a, b) => a.position - b.position)
                      .map(stage => (
                        <div key={stage.id} className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg group">
                          <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color || '#6b7280' }} />

                          {editingStageId === stage.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                autoFocus
                                value={stageEditForm.name}
                                onChange={e => setStageEditForm({ ...stageEditForm, name: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') handleUpdateStage(pipeline.id, stage.id); if (e.key === 'Escape') setEditingStageId(null) }}
                                className="flex-1 px-2 py-1 text-sm border border-border rounded bg-background focus:outline-none"
                              />
                              <div className="flex gap-1">
                                {STAGE_COLORS.map(c => (
                                  <button
                                    key={c}
                                    onClick={() => setStageEditForm({ ...stageEditForm, color: c })}
                                    className={`w-4 h-4 rounded-full ${stageEditForm.color === c ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                              <button onClick={() => handleUpdateStage(pipeline.id, stage.id)} className="p-1 text-primary"><Save className="h-3.5 w-3.5" /></button>
                              <button onClick={() => setEditingStageId(null)} className="p-1 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <>
                              <span className="flex-1 text-sm text-foreground">{stage.name}</span>
                              <span className="text-xs text-muted-foreground">{stage._count?.cards || 0} cards</span>
                              {stage.isDefault && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Inicial</span>}
                              {stage.isWon && <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded">Ganho</span>}
                              {stage.isLost && <span className="text-[10px] text-red-600 bg-red-500/10 px-1.5 py-0.5 rounded">Perdido</span>}
                              {can('pipelines:manage') && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => { setEditingStageId(stage.id); setStageEditForm({ name: stage.name, color: stage.color }) }}
                                    className="p-1 rounded hover:bg-accent text-muted-foreground"
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteStage(pipeline.id, stage.id)}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}

                    {/* Add stage */}
                    {can('pipelines:manage') && (
                      <div className="flex items-center gap-2 mt-2 pl-3">
                        <input
                          type="text"
                          placeholder="Nome do stage..."
                          value={newStageName}
                          onChange={e => setNewStageName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddStage(pipeline.id) }}
                          className="flex-1 px-2.5 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <div className="flex gap-0.5">
                          {STAGE_COLORS.slice(0, 5).map(c => (
                            <button
                              key={c}
                              onClick={() => setNewStageColor(c)}
                              className={`w-4 h-4 rounded-full ${newStageColor === c ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <button
                          onClick={() => handleAddStage(pipeline.id)}
                          disabled={!newStageName.trim()}
                          className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {pipelines.length === 0 && !showCreateForm && (
        <div className="text-center py-12">
          <Kanban className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-muted-foreground">Nenhum pipeline criado ainda.</p>
          <p className="text-sm text-muted-foreground mt-1">Clique em "Novo Pipeline" para começar.</p>
        </div>
      )}
    </div>
  )
}
