import { useState, useEffect } from 'react'
import { Activity, CheckCircle, XCircle, Clock, Search, ChevronDown, ChevronUp, RefreshCw, Globe, Server, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getAIToolLogs, getAIAgents,
  type AIToolLog, type AIAgent
} from '@/services/ai.service'

export function AIToolLogs() {
  const [logs, setLogs] = useState<AIToolLog[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState({ agentId: '', toolType: '', status: '', page: 1, limit: 50 })
  const [pagination, setPagination] = useState({ total: 0, pages: 0 })

  useEffect(() => { loadAgents() }, [])
  useEffect(() => { loadData() }, [filters])

  async function loadAgents() {
    try { setAgents(await getAIAgents()) } catch {}
  }

  async function loadData() {
    setLoading(true)
    try {
      const params: Record<string, any> = { page: filters.page, limit: filters.limit }
      if (filters.agentId) params.agentId = filters.agentId
      if (filters.toolType) params.toolType = filters.toolType
      if (filters.status) params.status = filters.status
      const result = await getAIToolLogs(params)
      setLogs(result.logs || [])
      setPagination({ total: result.total || 0, pages: result.pages || 0 })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const statusColors: Record<string, string> = {
    success: 'text-green-400',
    error: 'text-red-400',
    timeout: 'text-yellow-400',
  }

  const typeIcons: Record<string, any> = {
    http_request: Globe,
    mcp: Server,
    crm: Database,
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  function formatDuration(ms: number) {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  function formatJson(data: any) {
    if (!data) return '-'
    try {
      if (typeof data === 'string') data = JSON.parse(data)
      return JSON.stringify(data, null, 2)
    } catch { return String(data) }
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-7 w-7 text-orange-500" />
            Tool Logs — Debug
          </h1>
          <p className="text-muted-foreground mt-1">
            Visualize execuções de tools dos agentes de IA com detalhes de request/response
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadData()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filters.agentId}
          onChange={e => setFilters(f => ({ ...f, agentId: e.target.value, page: 1 }))}
        >
          <option value="">Todos os agentes</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filters.toolType}
          onChange={e => setFilters(f => ({ ...f, toolType: e.target.value, page: 1 }))}
        >
          <option value="">Todos os tipos</option>
          <option value="http_request">HTTP Request</option>
          <option value="mcp">MCP</option>
          <option value="crm">CRM</option>
        </select>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
        >
          <option value="">Todos os status</option>
          <option value="success">Sucesso</option>
          <option value="error">Erro</option>
          <option value="timeout">Timeout</option>
        </select>
        <div className="text-sm text-muted-foreground flex items-center">
          {pagination.total} execução(ões)
        </div>
      </div>

      {/* Lista de logs */}
      <div className="space-y-2">
        {logs.length === 0 ? (
          <div className="text-center py-12 bg-card border rounded-lg">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Nenhuma execução encontrada</h3>
            <p className="text-muted-foreground mt-1">
              Os logs aparecem quando agentes executam ferramentas (HTTP, MCP, CRM)
            </p>
          </div>
        ) : (
          logs.map(log => {
            const isExpanded = expandedId === log.id
            const Icon = typeIcons[log.toolType] || Activity
            const StatusIcon = log.status === 'success' ? CheckCircle : log.status === 'error' ? XCircle : Clock

            return (
              <div key={log.id} className="bg-card border rounded-lg overflow-hidden">
                {/* Header */}
                <button
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{log.toolName}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {log.toolType}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(log.createdAt)}
                      {log.retryCount > 0 && (
                        <span className="ml-2 text-yellow-400">({log.retryCount} retries)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatDuration(log.durationMs ?? 0)}
                    </span>
                    <StatusIcon className={`h-4 w-4 ${statusColors[log.status] || 'text-muted-foreground'}`} />
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </button>

                {/* Detail - expandido */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4 bg-muted/10">
                    {/* Error message */}
                    {log.errorMessage && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                        <p className="text-sm text-red-400 font-medium">Erro</p>
                        <p className="text-sm text-red-300 mt-1 font-mono">{log.errorMessage}</p>
                        {log.errorStack && (
                          <pre className="text-xs text-red-300/70 mt-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {log.errorStack}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Input */}
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Input</p>
                      <pre className="bg-background border rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {formatJson(log.input)}
                      </pre>
                    </div>

                    {/* Output */}
                    {log.output && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Output</p>
                        <pre className="bg-background border rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {formatJson(log.output)}
                        </pre>
                      </div>
                    )}

                    {/* Metadata */}
                    {log.metadata && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Metadata</p>
                        <pre className="bg-background border rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {formatJson(log.metadata)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Paginação */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline" size="sm"
            disabled={filters.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {filters.page} de {pagination.pages}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={filters.page >= pagination.pages}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}
