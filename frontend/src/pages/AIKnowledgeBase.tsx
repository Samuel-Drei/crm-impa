import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, Plus, ChevronRight, Database, Loader2,
  Layers, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/Toast'
import {
  getAIKnowledgeBases, createAIKnowledgeBase, getRAGHealth,
  type AIKnowledgeBase as KBType,
} from '@/services/ai.service'

export function AIKnowledgeBase() {
  const navigate = useNavigate()
  const [kbs, setKbs] = useState<KBType[]>([])
  const [loading, setLoading] = useState(true)
  const [qdrantStatus, setQdrantStatus] = useState<string>('checking')
  const [showCreateKB, setShowCreateKB] = useState(false)

  useEffect(() => { loadList(); checkHealth() }, [])

  async function loadList() {
    setLoading(true)
    try { setKbs(await getAIKnowledgeBases()) } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function checkHealth() {
    try {
      const h = await getRAGHealth()
      setQdrantStatus(h.status)
    } catch { setQdrantStatus('error') }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-blue-500" />
            Base de Conhecimento
          </h1>
          <p className="text-muted-foreground mt-1">RAG — Busca semântica com Qdrant para seus agentes de IA</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${qdrantStatus === 'healthy' ? 'bg-green-500/20 text-green-400' : qdrantStatus === 'checking' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
            <Database className="h-3 w-3" />
            Qdrant: {qdrantStatus === 'healthy' ? 'Conectado' : qdrantStatus === 'checking' ? 'Verificando...' : 'Offline'}
          </div>
          <Button onClick={() => setShowCreateKB(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nova Base
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : kbs.length === 0 ? (
        <div className="text-center py-16 bg-card border rounded-lg">
          <BookOpen className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Nenhuma base de conhecimento</h3>
          <p className="text-muted-foreground mt-1 max-w-md mx-auto">
            Crie uma base para que seus agentes de IA consultem informações via busca semântica (RAG)
          </p>
          <Button className="mt-4" onClick={() => setShowCreateKB(true)}>
            <Plus className="h-4 w-4 mr-2" /> Criar primeira base
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {kbs.map(kb => {
            const totalSources = kb.sources?.length || 0
            const indexedSources = kb.sources?.filter(s => s.status === 'INDEXED').length || 0
            const totalChunks = kb.sources?.reduce((sum, s) => sum + (s.totalChunks || 0), 0) || 0
            const totalDocs = kb._count?.documents || 0
            return (
              <div
                key={kb.id}
                className="bg-card border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer group"
                onClick={() => navigate(`/ai-knowledge/${kb.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <BookOpen className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="font-medium group-hover:text-primary transition-colors">{kb.name}</h3>
                      {kb.description && <p className="text-xs text-muted-foreground line-clamp-1">{kb.description}</p>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="flex gap-3 mt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {totalSources} fonte{totalSources !== 1 && 's'}</span>
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {totalDocs} doc{totalDocs !== 1 && 's'}</span>
                  <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {totalChunks} chunk{totalChunks !== 1 && 's'}</span>
                </div>
                {kb.agents && kb.agents.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-2">Agentes: {kb.agents.map(a => a.agent.name).join(', ')}</p>
                )}
                {totalSources > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${indexedSources === totalSources ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${totalSources > 0 ? (indexedSources / totalSources) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreateKB && <CreateKBModal onClose={() => setShowCreateKB(false)} onCreated={(id) => { setShowCreateKB(false); navigate(`/ai-knowledge/${id}`) }} />}
    </div>
  )
}

function CreateKBModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const kb = await createAIKnowledgeBase({ name, description: description || undefined })
      onCreated(kb.id)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao criar') }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">Nova Base de Conhecimento</h2>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Nome *</label>
            <Input value={name} onChange={e => setName(e.target.value)} required placeholder="ex: FAQ Produtos, Manual Técnico" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Descrição</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Para que serve esta base..." />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading || !name}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Criar
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
