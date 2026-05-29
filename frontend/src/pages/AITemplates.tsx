import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Search, Sparkles, ArrowLeft, Loader2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  getAITemplates, getAITemplateCategories, createAgentFromTemplate,
  getAIProviders,
  type AIAgentTemplate, type AIProvider
} from '@/services/ai.service'

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  beginner: { label: 'Iniciante', color: 'bg-green-500/20 text-green-700 dark:text-green-400' },
  intermediate: { label: 'Intermediário', color: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' },
  advanced: { label: 'Avançado', color: 'bg-red-500/20 text-red-700 dark:text-red-400' },
}

export function AITemplates() {
  const navigate = useNavigate()
  const toast = useToast()
  const [templates, setTemplates] = useState<AIAgentTemplate[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<AIAgentTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [agentName, setAgentName] = useState('')

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadTemplates() }, [selectedCategory, search])

  async function loadData() {
    setLoading(true)
    try {
      const [tpls, cats, provs] = await Promise.all([
        getAITemplates(),
        getAITemplateCategories(),
        getAIProviders(),
      ])
      setTemplates(tpls)
      setCategories(cats)
      setProviders(provs)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadTemplates() {
    try {
      const params: any = {}
      if (selectedCategory) params.category = selectedCategory
      if (search) params.search = search
      const tpls = await getAITemplates(params)
      setTemplates(tpls)
    } catch (e) { console.error(e) }
  }

  async function handleCreateAgent() {
    if (!selectedTemplate || !selectedProvider) {
      toast.warning('Selecione um provider')
      return
    }
    setCreating(true)
    try {
      const result = await createAgentFromTemplate(selectedTemplate.id, {
        providerId: selectedProvider,
        name: agentName || undefined,
      })
      toast.success(`Agente "${result.agent.name}" criado a partir do template "${result.template.name}"!`)
      navigate(`/ai-agents/${result.agent.id}`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao criar agente')
    }
    setCreating(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="sm" onClick={() => navigate('/ai-agents')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-amber-500" />
            Galeria de Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Escolha um template pronto e crie seu agente em segundos
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              !selectedCategory ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
            }`}
          >
            Todos
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? '' : cat)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors capitalize ${
                cat === selectedCategory ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(template => (
          <div
            key={template.id}
            onClick={() => { setSelectedTemplate(template); setAgentName(`${template.name} (cópia)`) }}
            className={`cursor-pointer bg-card border rounded-xl p-5 hover:shadow-lg transition-all ${
              selectedTemplate?.id === template.id ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/50'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                  style={{ backgroundColor: template.color ? `${template.color}20` : '#6366F120' }}
                >
                  {template.icon || '🤖'}
                </div>
                <div>
                  <h3 className="font-semibold">{template.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize">{template.category}</p>
                </div>
              </div>
              {template.usageCount > 0 && (
                <span className="text-xs text-muted-foreground">{template.usageCount}x usado</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{template.description}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full ${DIFFICULTY_LABELS[template.difficulty]?.color || 'bg-gray-500/20'}`}>
                {DIFFICULTY_LABELS[template.difficulty]?.label || template.difficulty}
              </span>
              {template.tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-accent text-muted-foreground">
                  {tag}
                </span>
              ))}
              {template.followUpEnabled && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400">
                  follow-up
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Nenhum template encontrado</p>
        </div>
      )}

      {/* Painel de criação (quando template selecionado) */}
      {selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTemplate(null)}>
          <div className="bg-card border rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                style={{ backgroundColor: selectedTemplate.color ? `${selectedTemplate.color}20` : '#6366F120' }}
              >
                {selectedTemplate.icon || '🤖'}
              </div>
              <div>
                <h2 className="text-xl font-bold">{selectedTemplate.name}</h2>
                <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
              </div>
            </div>

            {/* Preview do prompt */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-1 block">Prompt do Sistema (preview)</label>
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                {selectedTemplate.systemPrompt.substring(0, 500)}
                {selectedTemplate.systemPrompt.length > 500 && '...'}
              </div>
            </div>

            {/* Configurações */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Nome do Agente</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder={`${selectedTemplate.name} (cópia)`}
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Provider de IA *</label>
                <select
                  value={selectedProvider}
                  onChange={e => setSelectedProvider(e.target.value)}
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                >
                  <option value="">Selecione um provider...</option>
                  {providers.filter(p => p.isActive).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                  ))}
                </select>
                {providers.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">Nenhum provider configurado. Configure um primeiro.</p>
                )}
              </div>
            </div>

            {/* Info rápida */}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-4">
              <div>Timeout: {selectedTemplate.sessionTimeout}min</div>
              <div>Follow-up: {selectedTemplate.followUpEnabled ? 'Sim' : 'Não'}</div>
              <div>Contexto CRM: Sim</div>
              <div>Dificuldade: {DIFFICULTY_LABELS[selectedTemplate.difficulty]?.label}</div>
            </div>

            {/* Botões */}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Cancelar</Button>
              <Button onClick={handleCreateAgent} disabled={creating || !selectedProvider}>
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
                Criar Agente
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
