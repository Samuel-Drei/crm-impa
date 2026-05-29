import { useState, useEffect } from 'react'
import { Server, Plus, Pencil, Trash2, RefreshCw, Wifi, WifiOff, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  getAIMCPServers, createAIMCPServer, updateAIMCPServer, deleteAIMCPServer, discoverMCPTools,
  type AIMCPServer
} from '@/services/ai.service'

export function AIMCPServers() {
  const toast = useToast()
  const [servers, setServers] = useState<AIMCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<AIMCPServer> | null>(null)
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try { setServers(await getAIMCPServers()) } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSave() {
    if (!editing?.name || !editing?.serverUrl) return
    setSaving(true)
    try {
      if (editing.id) {
        await updateAIMCPServer(editing.id, editing)
      } else {
        await createAIMCPServer(editing)
      }
      setEditing(null)
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao salvar')
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir servidor MCP', message: 'Excluir este servidor MCP? Tools vinculados deixarão de funcionar.', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAIMCPServer(id)
      loadData()
      toast.success('Servidor excluído')
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleDiscover(id: string) {
    setDiscovering(id)
    try {
      const result = await discoverMCPTools(id)
      toast.success(`Descobertas ${Array.isArray(result.tools) ? result.tools.length : 0} tool(s)`)
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao descobrir tools')
    }
    setDiscovering(null)
  }

  async function handleToggle(server: AIMCPServer) {
    try {
      await updateAIMCPServer(server.id, { isActive: !server.isActive })
      loadData()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (loading && servers.length === 0) {
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
            <Server className="h-7 w-7 text-blue-500" />
            Servidores MCP
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie servidores MCP (Model Context Protocol) para integrar tools externos
          </p>
        </div>
        <Button onClick={() => setEditing({ transport: 'sse', authType: 'none', timeout: 30000, sseReadTimeout: 60000 })}>
          <Plus className="h-4 w-4 mr-1" /> Novo Servidor
        </Button>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {servers.length === 0 && !editing ? (
          <div className="text-center py-12 bg-card border rounded-lg">
            <Server className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Nenhum servidor MCP</h3>
            <p className="text-muted-foreground mt-1">
              Conecte servidores MCP para expandir as capacidades dos agentes de IA
            </p>
            <Button className="mt-4" onClick={() => setEditing({ transport: 'sse', authType: 'none', timeout: 30000, sseReadTimeout: 60000 })}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar Servidor
            </Button>
          </div>
        ) : (
          servers.map(server => {
            const discoveredCount = Array.isArray(server.discoveredTools) ? server.discoveredTools.length : 0

            return (
              <div key={server.id} className="bg-card border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {server.isActive ? (
                    <Wifi className="h-5 w-5 text-green-400 shrink-0" />
                  ) : (
                    <WifiOff className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{server.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {server.transport.toUpperCase()}
                      </span>
                      {server.authType !== 'none' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                          {server.authType}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{server.serverUrl}</p>
                    {server.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{server.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{discoveredCount} tool(s)</span>
                      {server.lastDiscoveredAt && (
                        <span>Última descoberta: {formatDate(server.lastDiscoveredAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => handleDiscover(server.id)}
                      disabled={discovering === server.id}
                      title="Descobrir tools"
                    >
                      <Search className={`h-4 w-4 ${discovering === server.id ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(server)} title={server.isActive ? 'Desativar' : 'Ativar'}>
                      {server.isActive ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(server)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(server.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Tools descobertas */}
                {discoveredCount > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(server.discoveredTools as any[]).map((tool: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground" title={tool.description}>
                        {tool.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Modal de edição */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing.id ? 'Editar' : 'Novo'} Servidor MCP</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nome *</label>
                <input
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                  value={editing.name || ''}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Meu servidor MCP"
                />
              </div>

              <div>
                <label className="text-sm font-medium">URL do Servidor *</label>
                <input
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                  value={editing.serverUrl || ''}
                  onChange={e => setEditing({ ...editing, serverUrl: e.target.value })}
                  placeholder="https://mcp-server.example.com/sse"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Descrição</label>
                <input
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                  value={editing.description || ''}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Servidor para integração com..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Transporte</label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                    value={editing.transport || 'sse'}
                    onChange={e => setEditing({ ...editing, transport: e.target.value as any })}
                  >
                    <option value="sse">SSE</option>
                    <option value="streamable_http">Streamable HTTP</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Autenticação</label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                    value={editing.authType || 'none'}
                    onChange={e => setEditing({ ...editing, authType: e.target.value as any })}
                  >
                    <option value="none">Nenhuma</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="header">Header Customizado</option>
                    <option value="query">Query Param</option>
                  </select>
                </div>
              </div>

              {editing.authType && editing.authType !== 'none' && (
                <div className="grid grid-cols-2 gap-3">
                  {editing.authType !== 'bearer' && (
                    <div>
                      <label className="text-sm font-medium">
                        {editing.authType === 'header' ? 'Nome do Header' : 'Nome do Param'}
                      </label>
                      <input
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                        value={editing.authKey || ''}
                        onChange={e => setEditing({ ...editing, authKey: e.target.value })}
                        placeholder={editing.authType === 'header' ? 'X-API-Key' : 'api_key'}
                      />
                    </div>
                  )}
                  <div className={editing.authType === 'bearer' ? 'col-span-2' : ''}>
                    <label className="text-sm font-medium">
                      {editing.authType === 'bearer' ? 'Token' : 'Valor'}
                    </label>
                    <input
                      type="password"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                      value={editing.authValue || ''}
                      onChange={e => setEditing({ ...editing, authValue: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Timeout (ms)</label>
                  <input
                    type="number"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                    value={editing.timeout || 30000}
                    onChange={e => setEditing({ ...editing, timeout: parseInt(e.target.value) || 30000 })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">SSE Read Timeout (ms)</label>
                  <input
                    type="number"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                    value={editing.sseReadTimeout || 60000}
                    onChange={e => setEditing({ ...editing, sseReadTimeout: parseInt(e.target.value) || 60000 })}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || !editing.name || !editing.serverUrl}>
                {saving ? 'Salvando...' : editing.id ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
