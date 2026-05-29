import { useState, useEffect } from 'react'
import { FileText, Trash2, X, RefreshCw, Eye, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  listAIArtifacts, getAIArtifact, updateAIArtifact, deleteAIArtifact,
  getAIAgents, type AIArtifact, type AIAgent,
} from '@/services/ai.service'

const TYPE_OPTIONS = ['markdown', 'json', 'html', 'table', 'code', 'image_url', 'pdf_url', 'other']

export function AIArtifacts() {
  const toast = useToast()
  const [items, setItems] = useState<AIArtifact[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ agentId: '', type: '', status: '' })
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 })
  const [selected, setSelected] = useState<AIArtifact | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => { getAIAgents().then(setAgents).catch(() => {}) }, [])
  useEffect(() => { load() }, [filters, pagination.page])

  async function load() {
    setLoading(true)
    try {
      const params: any = { page: pagination.page, limit: 50, rootOnly: 'true' }
      if (filters.agentId) params.agentId = filters.agentId
      if (filters.type) params.type = filters.type
      if (filters.status) params.status = filters.status
      const r = await listAIArtifacts(params)
      setItems(r.items)
      setPagination(p => ({ ...p, total: r.total, totalPages: r.totalPages }))
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao carregar') }
    setLoading(false)
  }

  async function openDetail(item: AIArtifact) {
    setSelected(item)
    setLoadingDetail(true)
    try {
      const full = await getAIArtifact(item.id)
      setSelected(full)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
    setLoadingDetail(false)
  }

  async function loadVersion(versionId: string) {
    setLoadingDetail(true)
    try {
      const v = await getAIArtifact(versionId)
      setSelected(v)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
    setLoadingDetail(false)
  }

  async function handleApprove(item: AIArtifact) {
    try {
      const updated = await updateAIArtifact(item.id, { status: 'approved' })
      setSelected({ ...item, ...updated })
      load()
      toast.success('Aprovado')
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleArchive(item: AIArtifact) {
    try {
      const updated = await updateAIArtifact(item.id, { status: 'archived' })
      setSelected({ ...item, ...updated })
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleDelete(item: AIArtifact) {
    if (!await toast.confirm({ title: 'Excluir artefato', message: 'Excluir este artefato e todas as versões?', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAIArtifact(item.id)
      setSelected(null)
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      approved: 'bg-green-500/10 text-green-600',
      draft: 'bg-blue-500/10 text-blue-500',
      archived: 'bg-gray-500/10 text-gray-500',
    }
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[status] || 'bg-muted'}`}>{status}</span>
  }

  function renderContent(art: AIArtifact) {
    const content = art.content || ''
    if (art.type === 'json') {
      try { return <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded">{JSON.stringify(JSON.parse(content), null, 2)}</pre> }
      catch { return <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded">{content}</pre> }
    }
    if (art.type === 'markdown' || art.type === 'code') {
      return <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded font-mono">{content}</pre>
    }
    if (art.type === 'html') {
      return <div className="prose prose-sm max-w-none border rounded p-3" dangerouslySetInnerHTML={{ __html: content }} />
    }
    if (art.type === 'image_url') {
      return <img src={content} alt={art.name} className="max-w-full rounded border" />
    }
    if (art.type === 'pdf_url') {
      return <a href={content} target="_blank" rel="noopener" className="text-purple-500 hover:underline">{content}</a>
    }
    return <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded">{content}</pre>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-purple-500" /> Artefatos de IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Saídas estruturadas e versionadas dos agentes (markdown, JSON, código, etc).</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Recarregar</Button>
      </div>

      <div className="flex items-end gap-3 flex-wrap p-4 border rounded-xl bg-card">
        <div>
          <label className="text-xs font-medium block mb-1">Agente</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background min-w-[200px]" value={filters.agentId} onChange={e => { setFilters({ ...filters, agentId: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todos</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Tipo</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.type} onChange={e => { setFilters({ ...filters, type: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todos</option>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Status</label>
          <select className="border rounded-md px-3 py-2 text-sm bg-background" value={filters.status} onChange={e => { setFilters({ ...filters, status: e.target.value }); setPagination(p => ({ ...p, page: 1 })) }}>
            <option value="">Todos</option>
            <option value="draft">Rascunho</option>
            <option value="approved">Aprovado</option>
            <option value="archived">Arquivado</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground ml-auto">{pagination.total} artefatos</div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-xl">Nenhum artefato encontrado.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item => (
            <div key={item.id} className="border rounded-xl p-4 hover:border-purple-400 transition cursor-pointer" onClick={() => openDetail(item)}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{item.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{new Date(item.createdAt).toLocaleString('pt-BR')}</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium shrink-0">{item.type}</span>
              </div>
              {item.description && <div className="text-xs text-muted-foreground line-clamp-2 mb-2">{item.description}</div>}
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(item.status)}
                <span className="text-xs text-muted-foreground">v{item.version}</span>
                {item.remoteJid && <span className="text-xs text-muted-foreground truncate">{item.remoteJid.split('@')[0]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>Anterior</Button>
          <span className="text-sm">Página {pagination.page} de {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>Próxima</Button>
        </div>
      )}

      {/* Detail */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-background border rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">{selected.type}</span>
                  {statusBadge(selected.status)}
                  <span>v{selected.version}</span>
                  <span>·</span>
                  <span>{new Date(selected.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {selected.status !== 'approved' && <Button variant="outline" size="sm" onClick={() => handleApprove(selected)}><Check className="h-4 w-4 mr-1" /> Aprovar</Button>}
                {selected.status !== 'archived' && <Button variant="outline" size="sm" onClick={() => handleArchive(selected)}>Arquivar</Button>}
                <Button variant="ghost" size="sm" onClick={() => handleDelete(selected)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex">
              <div className="flex-1 overflow-auto p-5">
                {selected.description && <p className="text-sm text-muted-foreground mb-3">{selected.description}</p>}
                {loadingDetail ? <div className="text-center text-muted-foreground py-10">Carregando...</div> : renderContent(selected)}
              </div>
              {selected.versions && selected.versions.length > 0 && (
                <div className="w-56 border-l p-3 overflow-auto bg-muted/20">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Versões</div>
                  <div className="space-y-1">
                    {selected.versions.map(v => (
                      <button key={v.id} onClick={() => loadVersion(v.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent ${selected.id === v.id ? 'bg-accent font-medium' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span>v{v.version}</span>
                          {selected.id === v.id && <Eye className="h-3 w-3" />}
                        </div>
                        <div className="text-muted-foreground text-[10px]">{new Date(v.createdAt).toLocaleDateString('pt-BR')}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
