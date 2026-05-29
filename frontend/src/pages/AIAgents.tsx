import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Plus, Trash2, Edit2, Play, Pause, Brain, MessageSquare, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  getAIAgents, deleteAIAgent, updateAIAgent,
  getAIProviders, getAIStats,
  type AIAgent, type AIProvider, type AIStats
} from '@/services/ai.service'
import api from '@/services/api'

export function AIAgents() {
  const navigate = useNavigate()
  const toast = useToast()
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [stats, setStats] = useState<AIStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [agentsRes, providersRes, statsRes, instancesRes] = await Promise.allSettled([
        getAIAgents(), getAIProviders(), getAIStats(), api.get('/instances'),
      ])
      if (agentsRes.status === 'fulfilled') setAgents(agentsRes.value)
      if (providersRes.status === 'fulfilled') setProviders(providersRes.value)
      if (instancesRes.status === 'fulfilled') setInstances(instancesRes.value.data || [])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir agente', message: 'Tem certeza que deseja excluir este agente?', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAIAgent(id)
      loadData()
      toast.success('Agente excluído')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao excluir')
    }
  }

  async function handleToggleStatus(agent: AIAgent) {
    const newStatus = agent.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await updateAIAgent(agent.id, { status: newStatus } as any)
      loadData()
    } catch (e) { console.error(e) }
  }

  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30',
    INACTIVE: 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30',
    DRAFT: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  }

  const triggerLabels: Record<string, string> = {
    ALL: 'Todas mensagens',
    KEYWORD: 'Palavra-chave',
    ADVANCED: 'Regex avançado',
    NONE: 'Desabilitado',
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
      {/* Header com Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-7 w-7 text-purple-500" />
            Agentes de IA
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie seus agentes de inteligência artificial para WhatsApp</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/ai-templates')}>
            <Sparkles className="h-4 w-4 mr-2" /> Usar Template
          </Button>
          <Button onClick={() => { if (providers.length === 0) { toast.warning('Configure um Provider de IA primeiro!'); return }; navigate('/ai-agents/new') }}>
            <Plus className="h-4 w-4 mr-2" /> Novo Agente
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Agentes Ativos</p>
            <p className="text-2xl font-bold text-green-500">{stats.activeAgents}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Sessões Abertas</p>
            <p className="text-2xl font-bold text-blue-500">{stats.openSessions}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Mensagens IA</p>
            <p className="text-2xl font-bold text-purple-500">{stats.totalMessages}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Tokens (24h)</p>
            <p className="text-2xl font-bold text-orange-500">{stats.tokensLast24h.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="text-center py-12 bg-card border rounded-lg">
          <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Nenhum agente configurado</h3>
          <p className="text-muted-foreground mt-1">Crie seu primeiro agente de IA para responder automaticamente no WhatsApp</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map(agent => (
            <div key={agent.id} className="bg-card border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <Brain className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <h3 className="font-medium flex items-center gap-2">
                      {agent.name}
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[agent.status]}`}>
                        {agent.status}
                      </span>
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {agent.provider?.name} ({agent.provider?.model}) • {triggerLabels[agent.triggerType]}
                      {agent.triggerValue && `: ${agent.triggerValue}`}
                      {(agent as any).instanceIds?.length > 0 && (
                        <span> • {(agent as any).instanceIds.map((id: string) => instances.find((i: any) => i.id === id)?.name || id.slice(0,8)).join(', ')}</span>
                      )}
                      {!(agent as any).instanceIds?.length && <span> • Todas instâncias</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-2">
                    <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
                    {agent._count?.messages || 0} msgs • {agent._count?.sessions || 0} sessões
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleStatus(agent)}
                    title={agent.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                  >
                    {agent.status === 'ACTIVE' ? <Pause className="h-4 w-4 text-yellow-500" /> : <Play className="h-4 w-4 text-green-500" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/ai-agents/${agent.id}`)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(agent.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
              {agent.description && (
                <p className="text-sm text-muted-foreground mt-2 ml-13">{agent.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
