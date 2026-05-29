import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  BookOpen, Plus, Trash2, X, Globe, Type, FileText, Play, Youtube,
  Settings2, Search, RefreshCw, ChevronRight, Database, Loader2,
  CheckCircle2, XCircle, AlertCircle, Clock, ArrowLeft, Layers,
  MessageSquare, Send, Bot, User, DollarSign, Pencil, Download, Eye,
  HelpCircle, Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  getAIKnowledgeBase, updateAIKnowledgeBase, deleteAIKnowledgeBase,
  createAIKnowledgeSource, uploadAIKnowledgeFile, deleteAIKnowledgeSource, updateAIKnowledgeSource, reindexAIKnowledgeSource,
  getAIKnowledgeSourceMarkdown, getAIKnowledgeDocumentMarkdown,
  downloadAIKnowledgeSourceMarkdown, downloadAIKnowledgeDocumentMarkdown,
  testRAGSearch, chatWithKnowledgeBase, getEmbeddingProviders, getAIProviders,
  getAsrEstimate, confirmAsrTranscription,
  addAIKnowledgeQAPair, updateAIKnowledgeQAPair, deleteAIKnowledgeQAPair, getAIKnowledgeSource,
  type AIKnowledgeBase as KBType, type AIKnowledgeSource, type EmbeddingProviderInfo,
  type AIProvider, type AIQAPair,
} from '@/services/ai.service'

// ============================================
// Tipos auxiliares
// ============================================

type SourceType = 'TEXT' | 'URL' | 'WEBSITE' | 'YOUTUBE' | 'FILE' | 'QA'
type TabId = 'sources' | 'config' | 'chat' | 'search'

const sourceTypeConfig: Record<SourceType, { label: string; icon: any; color: string; desc: string }> = {
  TEXT: { label: 'Texto', icon: Type, color: 'blue', desc: 'Cole textos manualmente' },
  URL: { label: 'URL (Página)', icon: Globe, color: 'green', desc: 'Indexar uma página web' },
  WEBSITE: { label: 'Website (Crawl)', icon: Layers, color: 'purple', desc: 'Rastrear todo o site' },
  YOUTUBE: { label: 'YouTube', icon: Youtube, color: 'red', desc: 'Transcrição de vídeo' },
  FILE: { label: 'Arquivo (PDF/TXT)', icon: FileText, color: 'orange', desc: 'Upload de documentos' },
  QA: { label: 'Q&A', icon: HelpCircle, color: 'pink', desc: 'Perguntas e respostas manuais' },
}

const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
  QUEUED: { label: 'Na fila', icon: Clock, color: 'yellow' },
  PROCESSING: { label: 'Processando', icon: Loader2, color: 'blue' },
  INDEXED: { label: 'Indexado', icon: CheckCircle2, color: 'green' },
  ERROR: { label: 'Erro', icon: XCircle, color: 'red' },
  DISABLED: { label: 'Desativado', icon: AlertCircle, color: 'gray' },
  COMPLETED: { label: 'Concluído', icon: CheckCircle2, color: 'green' },
  FAILED: { label: 'Falhou', icon: XCircle, color: 'red' },
  CANCELLED: { label: 'Cancelado', icon: AlertCircle, color: 'gray' },
}

// ============================================
// Página principal — Detalhe da KB
// ============================================

export function AIKnowledgeBaseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as TabId) || 'sources'

  const [kb, setKb] = useState<KBType | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddSource, setShowAddSource] = useState(false)

  useEffect(() => { if (id) loadKB() }, [id])

  async function loadKB() {
    if (!id) return
    setLoading(true)
    try {
      const data = await getAIKnowledgeBase(id)
      setKb(data)
    } catch (e) {
      console.error(e)
      navigate('/ai-knowledge')
    }
    setLoading(false)
  }

  function setTab(tab: TabId) {
    setSearchParams({ tab })
  }

  async function handleDeleteKB() {
    if (!kb) return
    if (!await toast.confirm({ title: 'Excluir base', message: 'Excluir esta base de conhecimento e todos os seus dados indexados?', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAIKnowledgeBase(kb.id)
      navigate('/ai-knowledge')
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao excluir') }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!kb) return null

  const totalSources = kb.sources?.length || 0
  const totalChunks = kb.sources?.reduce((s, src) => s + (src.totalChunks || 0), 0) || 0
  const totalDocs = kb.sources?.reduce((s, src) => s + (src.documents?.length || 0), 0) || 0

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'sources', label: 'Fontes', icon: Layers },
    { id: 'config', label: 'Configurações', icon: Settings2 },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'search', label: 'Busca', icon: Search },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/ai-knowledge')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold">{kb.name}</h1>
              {kb.description && <p className="text-xs text-muted-foreground">{kb.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {totalSources} fontes</span>
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {totalDocs} docs</span>
            <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {totalChunks} chunks</span>
            <Button variant="destructive" size="sm" onClick={handleDeleteKB}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 -mb-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary bg-background'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'sources' && (
          <SourcesTab
            kb={kb}
            onAddSource={() => setShowAddSource(true)}
            onRefresh={loadKB}
          />
        )}
        {activeTab === 'config' && (
          <ConfigTab kb={kb} onSaved={loadKB} />
        )}
        {activeTab === 'chat' && (
          <ChatTab kbId={kb.id} kbName={kb.name} />
        )}
        {activeTab === 'search' && (
          <SearchTab kbId={kb.id} />
        )}
      </div>

      {/* Modal: Adicionar fonte */}
      {showAddSource && (
        <AddSourceModal
          kbId={kb.id}
          onClose={() => setShowAddSource(false)}
          onCreated={() => { setShowAddSource(false); loadKB() }}
        />
      )}
    </div>
  )
}

// ============================================
// Painel ASR — Transcrição de YouTube sem legendas
// ============================================

function AsrPanel({ source, onTranscribed }: { source: AIKnowledgeSource; onTranscribed: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState<'idle' | 'loading' | 'estimate' | 'transcribing' | 'done' | 'error'>('idle')
  const [estimate, setEstimate] = useState<any>(null)
  const [providers, setProviders] = useState<any[]>([])
  const [selectedProvider, setSelectedProvider] = useState<'openai' | 'local'>('openai')
  const [ytdlpAvailable, setYtdlpAvailable] = useState(true)
  const [error, setError] = useState('')

  const handleEstimate = async () => {
    setStep('loading')
    setError('')
    try {
      const result = await getAsrEstimate(source.id, selectedProvider)
      setEstimate(result.estimate)
      setProviders(result.providers)
      setYtdlpAvailable(result.ytdlpAvailable)
      if (result.estimate.provider !== selectedProvider) {
        setSelectedProvider(result.estimate.provider as 'openai' | 'local')
      }
      setStep('estimate')
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao estimar custo')
      setStep('error')
    }
  }

  const handleConfirm = async () => {
    if (!estimate) return
    setStep('transcribing')
    setError('')
    try {
      await confirmAsrTranscription(source.id, {
        provider: selectedProvider,
        acceptedCostUsd: estimate.estimatedCostUsd,
      })
      toast.success('Transcrição iniciada! O processamento será feito em segundo plano.')
      setStep('done')
      // Aguardar um pouco e recarregar
      setTimeout(onTranscribed, 3000)
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao iniciar transcrição')
      setStep('error')
    }
  }

  // Estado inicial — botão para solicitar estimativa
  if (step === 'idle') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-400">Sem legendas disponíveis</p>
            <p className="text-xs text-muted-foreground mt-1">
              Este vídeo não possui legendas no YouTube. É possível transcrever o áudio usando IA (OpenAI Whisper).
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
              onClick={handleEstimate}
            >
              <DollarSign className="h-3.5 w-3.5 mr-1.5" />
              Ver estimativa de custo
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Carregando estimativa
  if (step === 'loading') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
          <p className="text-sm text-blue-300">Analisando vídeo e calculando custo...</p>
        </div>
      </div>
    )
  }

  // Erro
  if (step === 'error') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
        <div className="flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400">{error}</p>
            <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setStep('idle')}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Transcrição em andamento
  if (step === 'transcribing') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
          <div>
            <p className="text-sm text-blue-300 font-medium">Transcrevendo áudio...</p>
            <p className="text-xs text-muted-foreground mt-1">
              {selectedProvider === 'local'
                ? 'Processando localmente. Pode levar alguns minutos.'
                : 'Enviando para OpenAI Whisper. Será concluído em instantes.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Concluído
  if (step === 'done') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <p className="text-sm text-green-300">Transcrição iniciada! Será processada em segundo plano.</p>
        </div>
      </div>
    )
  }

  // Estimativa de custo — tela de confirmação
  if (step === 'estimate' && estimate) {
    return (
      <div className="mt-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <DollarSign className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-400">Confirmação de Transcrição</p>
            <p className="text-xs text-muted-foreground mt-1">
              Revise os detalhes antes de confirmar.
            </p>
          </div>
        </div>

        {/* Detalhes do vídeo */}
        <div className="bg-background/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Vídeo</span>
            <span className="font-medium truncate max-w-[200px]">{estimate.title}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Duração</span>
            <span className="font-medium">{estimate.durationFormatted}</span>
          </div>
        </div>

        {/* Seletor de provider — só mostra se tiver mais de 1 opção */}
        {providers.length > 1 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Método de Transcrição</label>
          <div className={`grid gap-2 ${providers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {providers.map((p: any) => (
              <button
                key={p.id}
                disabled={!p.available}
                onClick={() => {
                  setSelectedProvider(p.id)
                  // Recalcular estimativa com novo provider
                  const isFree = p.id === 'local'
                  setEstimate({
                    ...estimate,
                    provider: p.id,
                    isFree,
                    estimatedCostUsd: isFree ? 0 : Math.ceil(estimate.durationSeconds / 60) * 0.006,
                    message: isFree
                      ? `Transcrição local (grátis). Tempo estimado: ~${Math.ceil(estimate.durationSeconds / 12)}min em CPU.`
                      : `Custo: US$ ${(Math.ceil(estimate.durationSeconds / 60) * 0.006).toFixed(4)} (${estimate.durationFormatted} × $0.006/min).`
                  })
                }}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedProvider === p.id
                    ? 'border-primary bg-primary/10'
                    : p.available
                      ? 'border-border hover:border-primary/50'
                      : 'border-border/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="font-medium text-xs">{p.name}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {p.available
                    ? p.id === 'local' ? 'Grátis (mais lento)' : '$0.006/min'
                    : p.reason || 'Indisponível'}
                </div>
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Custo final */}
        <div className={`p-3 rounded-lg text-center ${estimate.isFree ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
          {estimate.isFree ? (
            <div>
              <p className="text-lg font-bold text-green-400">GRÁTIS</p>
              <p className="text-xs text-muted-foreground mt-1">Processado localmente no servidor</p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground">Custo estimado</p>
              <p className="text-2xl font-bold text-yellow-400">US$ {estimate.estimatedCostUsd.toFixed(4)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ≈ R$ {(estimate.estimatedCostUsd * 5.5).toFixed(2)} (câmbio aproximado)
              </p>
            </div>
          )}
        </div>

        {/* Botões de ação */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => setStep('idle')}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleConfirm}
          >
            {estimate.isFree ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Transcrever (grátis)
              </>
            ) : (
              <>
                <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                Confirmar e pagar US$ {estimate.estimatedCostUsd.toFixed(4)}
              </>
            )}
          </Button>
        </div>

        {/* Aviso */}
        {!estimate.isFree && (
          <p className="text-[10px] text-muted-foreground text-center">
            O custo será cobrado da sua API key OpenAI e registrado no relatório de tokens.
          </p>
        )}
      </div>
    )
  }

  return null
}

// ============================================
// Tab: Fontes de dados
// ============================================

function SourcesTab({ kb, onAddSource, onRefresh }: { kb: KBType; onAddSource: () => void; onRefresh: () => void }) {
  const toast = useToast()
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Fontes de Dados</h2>
        <Button onClick={onAddSource}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Fonte
        </Button>
      </div>

      {(!kb.sources || kb.sources.length === 0) ? (
        <div className="text-center py-16 bg-card border rounded-lg">
          <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhuma fonte adicionada ainda</p>
          <Button className="mt-4" onClick={onAddSource}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar Fonte
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {kb.sources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              onRefresh={onRefresh}
              onReindex={async () => {
                try {
                  await reindexAIKnowledgeSource(source.id)
                  onRefresh()
                  toast.success('Reindexação iniciada')
                } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
              }}
              onDelete={async () => {
                if (!await toast.confirm({ title: 'Excluir fonte', message: `Excluir "${source.name}" e todos os dados indexados?`, danger: true, confirmText: 'Excluir' })) return
                try {
                  await deleteAIKnowledgeSource(source.id)
                  onRefresh()
                  toast.success('Fonte excluída')
                } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCard({ source, onReindex, onDelete, onRefresh }: { source: AIKnowledgeSource; onReindex: () => void; onDelete: () => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [previewing, setPreviewing] = useState<{ kind: 'source' } | { kind: 'document'; id: string; title: string } | null>(null)
  const toast = useToast()
  const cfg = sourceTypeConfig[source.type as SourceType] || sourceTypeConfig.TEXT
  const st = statusConfig[source.status] || statusConfig.QUEUED
  const Icon = cfg.icon
  const StatusIcon = st.icon

  const handleDownloadSource = async () => {
    try {
      await downloadAIKnowledgeSourceMarkdown(source.id, source.name)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao baixar markdown')
    }
  }
  const handleDownloadDoc = async (docId: string, title: string) => {
    try {
      await downloadAIKnowledgeDocumentMarkdown(docId, title)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao baixar markdown')
    }
  }

  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className={`h-9 w-9 rounded-lg bg-${cfg.color}-500/20 flex items-center justify-center flex-shrink-0`}>
            <Icon className={`h-4 w-4 text-${cfg.color}-500`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{source.name}</h3>
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-${st.color}-500/20 text-${st.color}-400`}>
                <StatusIcon className={`h-2.5 w-2.5 ${source.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
                {st.label}
              </span>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
              <span>{cfg.label}</span>
              {source.sourceUrl && <span className="truncate max-w-[250px]">{source.sourceUrl}</span>}
              <span>{source.totalChunks} chunks</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0 ml-2">
          {source.type === 'TEXT' && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} title="Editar conteúdo">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {(source.totalChunks > 0 || source.status === 'INDEXED') && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setPreviewing({ kind: 'source' })} title="Visualizar markdown">
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownloadSource} title="Baixar markdown (.md)">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onReindex} title="Re-indexar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} title="Excluir">
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </Button>
        </div>
      </div>

      {editing && (
        <EditTextSourceModal
          source={source}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onRefresh() }}
        />
      )}

      {source.errorMessage && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{source.errorMessage}</p>
        </div>
      )}

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {/* QA: editor de pares Q&A */}
          {source.type === 'QA' && (
            <QAPairsEditor source={source} onChanged={onRefresh} />
          )}
          {/* YouTube: mostrar thumbnail e metadados do vídeo */}
          {source.type === 'YOUTUBE' && source.metadata && (
            <div className="flex gap-3 items-start bg-muted/20 rounded-lg p-2">
              {(source.metadata as any).thumbnailUrl && (
                <img
                  src={(source.metadata as any).thumbnailUrl}
                  alt="Thumbnail"
                  className="w-28 h-16 rounded object-cover flex-shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="text-xs space-y-0.5">
                {(source.metadata as any).channelName && (
                  <p className="font-medium">{(source.metadata as any).channelName}</p>
                )}
                <div className="flex gap-3 text-muted-foreground">
                  {(source.metadata as any).language && <span>Idioma: {(source.metadata as any).language}</span>}
                  {(source.metadata as any).isGenerated !== undefined && (
                    <span>{(source.metadata as any).isGenerated ? '🤖 Auto-generated' : '✍️ Manual'}</span>
                  )}
                  {(source.metadata as any).duration && (
                    <span>{Math.floor((source.metadata as any).duration / 60)}min</span>
                  )}
                  {(source.metadata as any).totalSnippets && (
                    <span>{(source.metadata as any).totalSnippets} trechos</span>
                  )}
                </div>
                {(source.metadata as any).needsAsrFallback && (
                  <AsrPanel source={source} onTranscribed={onRefresh} />
                )}
              </div>
            </div>
          )}

          {source.documents && source.documents.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Documentos ({source.documents.length})</h4>
              <div className="space-y-1.5">
                {source.documents.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{doc.title}</span>
                      {doc.parsingMethod && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 rounded">{doc.parsingMethod}</span>
                      )}
                    </div>
                    <div className="flex gap-2 text-muted-foreground flex-shrink-0 items-center">
                      <span>{doc.totalChunks} chunks</span>
                      <span>{doc.tokenCount?.toLocaleString()} tokens</span>
                      {doc.pageCount && <span>{doc.pageCount} pág</span>}
                      {doc.fileSize && <span>{(doc.fileSize / 1024).toFixed(0)} KB</span>}
                      <button
                        type="button"
                        onClick={() => setPreviewing({ kind: 'document', id: doc.id, title: doc.title || 'documento' })}
                        className="ml-1 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Visualizar markdown"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadDoc(doc.id, doc.title || 'documento')}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Baixar markdown"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {source.jobs && source.jobs.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Histórico de Ingestão</h4>
              <div className="space-y-1.5">
                {source.jobs.map(job => {
                  const jst = statusConfig[job.status] || statusConfig.QUEUED
                  const JIcon = jst.icon
                  return (
                    <div key={job.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <JIcon className={`h-3 w-3 text-${jst.color}-400 ${job.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
                        <span>{job.type === 'INDEX_SOURCE' ? 'Indexação' : 'Re-indexação'}</span>
                        {job.currentStep && <span className="text-muted-foreground">— {job.currentStep}</span>}
                      </div>
                      <div className="flex gap-2 text-muted-foreground">
                        {job.progress > 0 && <span>{Math.round(job.progress)}%</span>}
                        <span>{job.chunksCreated} chunks</span>
                        <span>{new Date(job.createdAt).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {previewing && (
        <MarkdownPreviewModal
          title={previewing.kind === 'source' ? source.name : previewing.title}
          fetcher={previewing.kind === 'source'
            ? () => getAIKnowledgeSourceMarkdown(source.id)
            : () => getAIKnowledgeDocumentMarkdown(previewing.id)}
          onDownload={previewing.kind === 'source'
            ? handleDownloadSource
            : () => handleDownloadDoc((previewing as any).id, (previewing as any).title)}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  )
}

// ============================================
// Modal: Visualizar Markdown extraído
// ============================================

function MarkdownPreviewModal({
  title, fetcher, onDownload, onClose,
}: {
  title: string
  fetcher: () => Promise<string>
  onDownload: () => void | Promise<void>
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetcher()
      .then(md => { if (alive) setContent(md) })
      .catch(err => { if (alive) setError(err?.response?.data?.error || err?.message || 'Falha ao carregar markdown') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="min-w-0 flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <h3 className="font-semibold truncate">{title}</h3>
            <span className="text-[10px] uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded">markdown</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onDownload} title="Baixar .md">
              <Download className="h-3.5 w-3.5 mr-1" /> Baixar
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} title="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-muted/20">
          {loading && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando conteúdo extraído...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded p-3">{error}</div>
          )}
          {content !== null && !loading && !error && (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">{content}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Tab: Configurações (full page, não modal)
// ============================================

function ConfigTab({ kb, onSaved }: { kb: KBType; onSaved: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: kb.name,
    description: kb.description || '',
    embeddingProviderId: kb.embeddingProviderId || '',
    embeddingProvider: kb.embeddingProvider || 'openai',
    embeddingModel: kb.embeddingModel || 'text-embedding-3-small',
    chunkSize: kb.chunkSize || 1000,
    chunkOverlap: kb.chunkOverlap || 200,
    retrievalMode: kb.retrievalMode || 'semantic',
    topK: kb.topK || 5,
    scoreThreshold: kb.scoreThreshold || 0.4,
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [companyProviders, setCompanyProviders] = useState<AIProvider[]>([])
  const [embeddingCatalog, setEmbeddingCatalog] = useState<EmbeddingProviderInfo[]>([])

  useEffect(() => {
    Promise.all([
      getAIProviders().catch(() => []),
      getEmbeddingProviders().catch(() => []),
    ]).then(([providers, catalog]) => {
      setCompanyProviders(providers.filter(p => p.isActive))
      setEmbeddingCatalog(catalog)
    })
  }, [])

  const providerTypeToEmbedding: Record<string, string> = {
    OPENAI: 'openai', GEMINI: 'gemini', CLAUDE: 'openai',
    GITHUB_COPILOT: 'github_copilot',
  }

  const selectedCompanyProvider = companyProviders.find(p => p.id === form.embeddingProviderId)
  const embeddingType = selectedCompanyProvider
    ? providerTypeToEmbedding[selectedCompanyProvider.type] || 'openai'
    : form.embeddingProvider
  const catalogModels = embeddingCatalog.find(c => c.id === embeddingType)?.models || []

  // Fonte da verdade: enabledModels do provider, filtrados por embeddings.
  // Catálogo é apenas lookup para metadata (dimensões, preço, nome amigável).
  const availableModels = (() => {
    if (selectedCompanyProvider) {
      const enabledEmbeddings = (selectedCompanyProvider.enabledModels || [])
        .filter(id => /embed/i.test(id))
      if (enabledEmbeddings.length > 0) {
        return enabledEmbeddings.map(id => {
          const meta = catalogModels.find(m => m.id === id)
          return {
            id,
            name: meta?.name || id,
            dimensions: meta?.dimensions || 1536,
            pricePerMTokens: meta?.pricePerMTokens ?? 0,
          }
        })
      }
      // Provider selecionado mas sem embeddings habilitados → vazio
      return []
    }
    // Sem provider selecionado: cai no catálogo do tipo padrão
    return catalogModels
  })()

  function handleProviderSelect(providerId: string) {
    if (providerId === '') {
      setForm(f => ({ ...f, embeddingProviderId: '', embeddingProvider: 'openai' }))
      return
    }
    const prov = companyProviders.find(p => p.id === providerId)
    if (!prov) return
    const embType = providerTypeToEmbedding[prov.type] || 'openai'
    // Apenas embeddings explicitamente habilitados pelo usuário
    const enabledEmbedding = (prov.enabledModels || []).find(id => /embed/i.test(id))
    setForm(f => ({
      ...f,
      embeddingProviderId: providerId,
      embeddingProvider: embType,
      embeddingModel: enabledEmbedding || '',
    }))
  }

  async function handleSave() {
    setLoading(true)
    try {
      await updateAIKnowledgeBase(kb.id, {
        ...form,
        embeddingProviderId: form.embeddingProviderId || null,
      } as any)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
      toast.success('Configurações salvas')
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao salvar') }
    setLoading(false)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="space-y-8">
        {/* Informações gerais */}
        <section>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-500" />
            Informações Gerais
          </h2>
          <div className="bg-card border rounded-lg p-5 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Nome da Base</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Descrição</label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Descreva o propósito desta base de conhecimento..."
              />
            </div>
          </div>
        </section>

        {/* Modelo de Embedding */}
        <section>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-500" />
            Modelo de Embedding
          </h2>
          <div className="bg-card border rounded-lg p-5 space-y-4">
            <p className="text-xs text-muted-foreground">
              Selecione o provedor de IA e modelo para gerar os vetores de embedding.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Provedor de IA</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.embeddingProviderId}
                  onChange={e => handleProviderSelect(e.target.value)}
                >
                  <option value="">— Config do sistema —</option>
                  {companyProviders.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                  ))}
                </select>
                {companyProviders.length === 0 && (
                  <p className="text-[10px] text-yellow-500 mt-1">Nenhum provedor configurado</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Modelo</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                  value={availableModels.length === 0 ? '' : form.embeddingModel}
                  onChange={e => setForm(f => ({ ...f, embeddingModel: e.target.value }))}
                  disabled={!!selectedCompanyProvider && availableModels.length === 0}
                >
                  {selectedCompanyProvider && availableModels.length === 0 && (
                    <option value="">— Nenhum modelo disponível —</option>
                  )}
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.dimensions}d{m.pricePerMTokens > 0 ? ` · $${m.pricePerMTokens}/M` : ' · Grátis'})
                    </option>
                  ))}
                </select>
                {selectedCompanyProvider && availableModels.length === 0 && (
                  <p className="text-[10px] text-yellow-500 mt-1">
                    Nenhum modelo de embedding habilitado neste provedor. Habilite em "Gerenciar Modelos".
                  </p>
                )}
              </div>
            </div>

            {selectedCompanyProvider && (
              <p className="text-xs text-green-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Usando API key do provedor "{selectedCompanyProvider.name}"
              </p>
            )}

            <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground">
              <span>Dimensão atual: <strong>{kb.embeddingDimension || 1536}d</strong></span>
              {form.embeddingModel !== kb.embeddingModel && (
                <span className="text-yellow-500 ml-2">⚠ Trocar modelo exige reindexação de todos os dados</span>
              )}
            </div>
          </div>
        </section>

        {/* Chunking */}
        <section>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-green-500" />
            Chunking (Fatiamento)
          </h2>
          <div className="bg-card border rounded-lg p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Tamanho do Chunk</label>
                <Input
                  type="number" value={form.chunkSize}
                  onChange={e => setForm(f => ({ ...f, chunkSize: +e.target.value }))}
                  min={100} max={4000}
                />
                <p className="text-[10px] text-muted-foreground mt-1">100-4000 caracteres</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Sobreposição</label>
                <Input
                  type="number" value={form.chunkOverlap}
                  onChange={e => setForm(f => ({ ...f, chunkOverlap: +e.target.value }))}
                  min={0} max={500}
                />
                <p className="text-[10px] text-muted-foreground mt-1">0-500 caracteres</p>
              </div>
            </div>
          </div>
        </section>

        {/* Retrieval */}
        <section>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Search className="h-4 w-4 text-cyan-500" />
            Retrieval (Busca)
          </h2>
          <div className="bg-card border rounded-lg p-5 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Modo de Busca</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.retrievalMode}
                onChange={e => setForm(f => ({ ...f, retrievalMode: e.target.value as 'semantic' | 'keyword' | 'hybrid' }))}
              >
                <option value="semantic">Semântica (embedding)</option>
                <option value="keyword">Keyword (BM25)</option>
                <option value="hybrid">Híbrida (semantic + keyword)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Top K (resultados)</label>
                <Input
                  type="number" value={form.topK}
                  onChange={e => setForm(f => ({ ...f, topK: +e.target.value }))}
                  min={1} max={20}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Score Mínimo</label>
                <Input
                  type="number" step="0.05" value={form.scoreThreshold}
                  onChange={e => setForm(f => ({ ...f, scoreThreshold: +e.target.value }))}
                  min={0} max={1}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {saved ? <><CheckCircle2 className="h-4 w-4 mr-2" /> Salvo!</> : 'Salvar Configurações'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Tab: Chat com a base
// ============================================

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ content: string; score: number; documentTitle?: string; sourceUrl?: string }>
  tokensUsed?: number
  costUsd?: number
  model?: string
  providerName?: string
}

function ChatTab({ kbId, kbName }: { kbId: string; kbName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    getAIProviders().then(p => {
      const active = p.filter((prov: AIProvider) => prov.isActive)
      setProviders(active)
    }).catch(() => {})
  }, [])

  const currentProvider = providers.find(p => p.id === selectedProviderId)
  const availableModels = currentProvider?.enabledModels || []

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg = input.trim()
    setInput('')

    const newUserMsg: ChatMessage = { role: 'user', content: userMsg }
    setMessages(prev => [...prev, newUserMsg])
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const result = await chatWithKnowledgeBase(kbId, {
        message: userMsg,
        history,
        providerId: selectedProviderId || undefined,
        model: selectedModel || undefined,
      })

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.reply,
        sources: result.sources,
        tokensUsed: result.tokensUsed,
        costUsd: result.costUsd,
        model: result.model,
        providerName: result.providerName,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `Erro: ${e.response?.data?.error || 'Falha ao consultar a base'}`,
      }
      setMessages(prev => [...prev, errorMsg])
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Provider/Model selector bar */}
      <div className="flex-shrink-0 border-b bg-muted/20 px-6 py-3">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div className="flex items-center gap-2 flex-1">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 max-w-[200px]"
              value={selectedProviderId}
              onChange={e => { setSelectedProviderId(e.target.value); setSelectedModel('') }}
            >
              <option value="">Provedor padrão</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
              ))}
            </select>
            {selectedProviderId && availableModels.length > 0 && (
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 max-w-[200px]"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                <option value="">Modelo padrão</option>
                {availableModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </div>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="text-xs text-muted-foreground hover:text-foreground">
              Limpar chat
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Conversar com a Base</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Faça perguntas sobre o conteúdo da base "{kbName}". O assistente vai consultar os dados indexados e responder baseado no seu conhecimento.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-blue-500" />
              </div>
            )}
            <div className={`max-w-[70%] ${msg.role === 'user' ? 'order-first' : ''}`}>
              <div className={`rounded-lg px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-auto'
                  : 'bg-card border'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.sources.map((src, j) => (
                    <div key={j} className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                      <span className="text-primary font-medium">[{j + 1}] {(src.score * 100).toFixed(0)}%</span>
                      {src.documentTitle && <span className="ml-1">— {src.documentTitle}</span>}
                      <p className="truncate">{src.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Cost info */}
              {msg.tokensUsed && (
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  {msg.model && <span className="font-medium">{msg.model}</span>}
                  {msg.providerName && <span>via {msg.providerName}</span>}
                  <span>{msg.tokensUsed} tokens</span>
                  {msg.costUsd !== undefined && msg.costUsd > 0 && (
                    <span
                      className="flex items-center gap-0.5 cursor-help"
                      title={`Custo: US$ ${msg.costUsd.toFixed(6)} (valor em dólar americano)`}
                    >
                      <DollarSign className="h-2.5 w-2.5" />
                      {msg.costUsd < 0.0001 ? '<US$ 0.0001' : `US$ ${msg.costUsd.toFixed(4)}`}
                    </span>
                  )}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-primary" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-blue-500" />
            </div>
            <div className="bg-card border rounded-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t bg-card p-4">
        <form onSubmit={handleSend} className="flex gap-2 max-w-3xl mx-auto">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pergunte algo sobre esta base de conhecimento..."
            className="flex-1"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

// ============================================
// Tab: Busca semântica
// ============================================

function SearchTab({ kbId }: { kbId: string }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await testRAGSearch({ query, knowledgeBaseIds: [kbId] })
      setResults(data.results)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro na busca')
    }
    setLoading(false)
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">Busca Semântica</h2>
        <p className="text-sm text-muted-foreground">
          Teste a busca vetorial diretamente contra os chunks indexados no Qdrant.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Digite uma pergunta ou busca..."
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {results === null ? (
        <p className="text-center text-muted-foreground py-12">
          Escreva uma pergunta para testar se a busca retorna resultados relevantes
        </p>
      ) : results.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">
          Nenhum resultado encontrado.
        </p>
      ) : (
        <div className="space-y-3">
          {results.map((r, i) => (
            <div key={i} className="bg-card border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  r.score >= 0.6 ? 'bg-green-500/20 text-green-400' :
                  r.score >= 0.4 ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  Score: {(r.score * 100).toFixed(1)}%
                </span>
                {r.metadata?.document_title && (
                  <span className="text-[10px] text-muted-foreground">{r.metadata.document_title}</span>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{r.content || 'Sem conteúdo'}</p>

              {/* YouTube: mostrar timestamp e link direto */}
              {r.metadata?.youtube_url ? (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <a href={r.metadata.youtube_url as string} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-red-400 hover:text-red-300">
                    <Youtube className="h-3 w-3" />
                    {r.metadata.start_formatted && r.metadata.end_formatted
                      ? `${r.metadata.start_formatted} - ${r.metadata.end_formatted}`
                      : 'Ver no YouTube'}
                  </a>
                  {r.metadata.channel_name && (
                    <span className="text-muted-foreground">| {r.metadata.channel_name as string}</span>
                  )}
                </div>
              ) : r.metadata?.source_url ? (
                <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                  <Globe className="h-2.5 w-2.5" /> {r.metadata.source_url as string}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// Modal: Adicionar Source
// ============================================

function AddSourceModal({ kbId, onClose, onCreated }: { kbId: string; onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState<'type' | 'form'>('type')
  const [sourceType, setSourceType] = useState<SourceType>('TEXT')
  const [name, setName] = useState('')
  const [textContent, setTextContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [maxPages, setMaxPages] = useState(50)
  const [maxDepth, setMaxDepth] = useState(3)
  const [file, setFile] = useState<File | null>(null)
  const [qaQuestion, setQaQuestion] = useState('')
  const [qaAnswer, setQaAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  // Whitelist client-side (a validação efetiva é no backend)
  const ALLOWED_FILE_EXT = /\.(pdf|txt|md|markdown|html?|json)$/i
  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
    if (!f) { setFile(null); return }
    if (!ALLOWED_FILE_EXT.test(f.name)) {
      toast.error('Apenas arquivos PDF, TXT, MD, HTML ou JSON são suportados')
      e.target.value = ''
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error('Arquivo excede o limite de 50MB')
      e.target.value = ''
      return
    }
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      let uploaded: { fileUrl: string; fileName: string; fileMimeType: string; fileSize: number } | null = null
      if (sourceType === 'FILE') {
        if (!file) {
          toast.error('Selecione um arquivo')
          setLoading(false)
          return
        }
        uploaded = await uploadAIKnowledgeFile(file)
      }
      await createAIKnowledgeSource({
        knowledgeBaseId: kbId,
        type: sourceType,
        name,
        textContent: sourceType === 'TEXT' ? textContent : undefined,
        sourceUrl: ['URL', 'WEBSITE', 'YOUTUBE'].includes(sourceType) ? sourceUrl : undefined,
        crawlConfig: sourceType === 'WEBSITE' ? { maxPages, maxDepth } : undefined,
        fileUrl: uploaded?.fileUrl,
        fileName: uploaded?.fileName,
        fileMimeType: uploaded?.fileMimeType,
        fileSize: uploaded?.fileSize,
        qaItems: sourceType === 'QA' && qaQuestion.trim() && qaAnswer.trim()
          ? [{ question: qaQuestion.trim(), answer: qaAnswer.trim(), active: true, order: 0 }]
          : undefined,
      })
      onCreated()
      toast.success('Fonte adicionada com sucesso')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao adicionar fonte')
    }
    setLoading(false)
  }

  const cfg = sourceTypeConfig[sourceType]

  if (step === 'type') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card border rounded-lg w-full max-w-lg">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-bold">Adicionar Fonte de Dados</h2>
            <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <div className="p-4 grid grid-cols-1 gap-2">
            {(Object.entries(sourceTypeConfig) as [SourceType, typeof sourceTypeConfig[SourceType]][]).map(([type, cfg]) => {
              const Icon = cfg.icon
              return (
                <button
                  key={type}
                  className="flex items-center gap-3 p-3 rounded-lg border text-left transition-colors hover:bg-muted/50 hover:border-primary/50"
                  onClick={() => { setSourceType(type); setStep('form') }}
                >
                  <div className={`h-10 w-10 rounded-lg bg-${cfg.color}-500/20 flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`h-5 w-5 text-${cfg.color}-500`} />
                  </div>
                  <div>
                    <p className="font-medium">{cfg.label}</p>
                    <p className="text-xs text-muted-foreground">{cfg.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('type')}><ArrowLeft className="h-4 w-4" /></Button>
            <h2 className="text-lg font-bold">{cfg.label}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Nome da Fonte *</label>
            <Input value={name} onChange={e => setName(e.target.value)} required placeholder="ex: FAQ do site, Manual de vendas..." />
          </div>

          {sourceType === 'TEXT' && (
            <div>
              <label className="text-sm font-medium mb-1 block">Conteúdo *</label>
              <Textarea
                value={textContent} onChange={e => setTextContent(e.target.value)}
                required rows={10} placeholder="Cole aqui o conteúdo textual..."
              />
              <p className="text-xs text-muted-foreground mt-1">{textContent.length} caracteres</p>
            </div>
          )}

          {sourceType === 'URL' && (
            <div>
              <label className="text-sm font-medium mb-1 block">URL da Página *</label>
              <Input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} required type="url" placeholder="https://exemplo.com/pagina" />
            </div>
          )}

          {sourceType === 'WEBSITE' && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">URL Inicial *</label>
                <Input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} required type="url" placeholder="https://exemplo.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Máx. Páginas</label>
                  <Input type="number" value={maxPages} onChange={e => setMaxPages(+e.target.value)} min={1} max={500} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Profundidade</label>
                  <Input type="number" value={maxDepth} onChange={e => setMaxDepth(+e.target.value)} min={1} max={10} />
                </div>
              </div>
            </>
          )}

          {sourceType === 'YOUTUBE' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">URL do Vídeo *</label>
                <Input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} required type="url" placeholder="https://youtube.com/watch?v=..." />
                <p className="text-xs text-muted-foreground mt-1">
                  Cole a URL do vídeo. O sistema vai extrair automaticamente a transcrição com timestamps.
                </p>
              </div>
              {sourceUrl && /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/.test(sourceUrl) && (
                <div className="bg-muted/30 rounded-lg p-3 flex gap-3 items-center">
                  <img
                    src={`https://i.ytimg.com/vi/${sourceUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1]}/mqdefault.jpg`}
                    alt="Thumbnail"
                    className="w-24 h-14 rounded object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="text-xs text-muted-foreground">
                    <p>O transcript será extraído automaticamente (manual ou auto-generated)</p>
                    <p>Prioridade: PT-BR → PT → EN → Outros idiomas</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {sourceType === 'FILE' && (
            <div>
              <label className="text-sm font-medium mb-1 block">Arquivo *</label>
              <label className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 cursor-pointer transition-colors">
                <FileText className="h-8 w-8 text-muted-foreground" />
                {file ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground break-all">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground">Clique para selecionar um arquivo</p>
                    <p className="text-xs text-muted-foreground">PDF, TXT, MD, HTML ou JSON (máx 50MB)</p>
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.txt,.md,.markdown,.html,.htm,.json,application/pdf,text/plain,text/markdown,text/html,application/json"
                  onChange={handleFileChange}
                />
              </label>
              <p className="text-xs text-muted-foreground mt-2">O arquivo é armazenado de forma segura e isolado por empresa, com acesso autenticado.</p>
            </div>
          )}

          {sourceType === 'QA' && (
            <div className="space-y-3">
              <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg p-3 text-xs">
                Adicione abaixo o primeiro par. Após criar a fonte, você pode adicionar mais pares na visualização da fonte.
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Pergunta *</label>
                <Textarea
                  value={qaQuestion} onChange={e => setQaQuestion(e.target.value)}
                  required={sourceType === 'QA'} rows={2}
                  placeholder="Ex: Qual o horário de atendimento?"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Resposta *</label>
                <Textarea
                  value={qaAnswer} onChange={e => setQaAnswer(e.target.value)}
                  required={sourceType === 'QA'} rows={4}
                  placeholder="Ex: Atendemos de segunda a sexta, das 08h às 18h."
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Play className="h-4 w-4 mr-1" /> Adicionar e Indexar
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================
// Editor de Pares Q&A (inline)
// ============================================

function QAPairsEditor({ source, onChanged }: { source: AIKnowledgeSource; onChanged: () => void }) {
  const toast = useToast()
  const initial = (source as any).qaItems as AIQAPair[] | undefined
  const [items, setItems] = useState<AIQAPair[]>(Array.isArray(initial) ? initial : [])
  const [adding, setAdding] = useState(false)
  const [newQ, setNewQ] = useState('')
  const [newA, setNewA] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQ, setEditQ] = useState('')
  const [editA, setEditA] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const fresh = await getAIKnowledgeSource(source.id)
      const arr = (fresh as any).qaItems
      if (Array.isArray(arr)) setItems(arr)
      onChanged()
    } catch {
      onChanged()
    }
  }

  async function handleAdd() {
    if (!newQ.trim() || !newA.trim()) {
      toast.error('Preencha pergunta e resposta')
      return
    }
    setBusy(true)
    try {
      await addAIKnowledgeQAPair(source.id, { question: newQ.trim(), answer: newA.trim(), active: true })
      setNewQ(''); setNewA(''); setAdding(false)
      toast.success('Par adicionado — reindexando')
      await reload()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao adicionar par')
    }
    setBusy(false)
  }

  async function handleSaveEdit(id: string) {
    if (!editQ.trim() || !editA.trim()) {
      toast.error('Preencha pergunta e resposta')
      return
    }
    setBusy(true)
    try {
      await updateAIKnowledgeQAPair(source.id, id, { question: editQ.trim(), answer: editA.trim() })
      setEditingId(null)
      toast.success('Par atualizado — reindexando')
      await reload()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar par')
    }
    setBusy(false)
  }

  async function handleToggleActive(item: AIQAPair) {
    setBusy(true)
    try {
      await updateAIKnowledgeQAPair(source.id, item.id, { active: !(item.active !== false) })
      await reload()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar par')
    }
    setBusy(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este par?')) return
    setBusy(true)
    try {
      await deleteAIKnowledgeQAPair(source.id, id)
      toast.success('Par excluído — reindexando')
      await reload()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao excluir par')
    }
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground">Pares de Q&A ({items.length})</h4>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={busy}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar par
          </Button>
        )}
      </div>

      {adding && (
        <div className="border border-pink-500/30 bg-pink-500/5 rounded-lg p-3 space-y-2">
          <div>
            <label className="text-xs font-medium mb-1 block">Pergunta</label>
            <Textarea value={newQ} onChange={e => setNewQ(e.target.value)} rows={2} placeholder="Pergunta..." />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Resposta</label>
            <Textarea value={newA} onChange={e => setNewA(e.target.value)} rows={3} placeholder="Resposta..." />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAdding(false); setNewQ(''); setNewA('') }}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic py-2">Nenhum par cadastrado.</p>
      )}

      <div className="space-y-1.5">
        {items.map(item => {
          const active = item.active !== false
          if (editingId === item.id) {
            return (
              <div key={item.id} className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <div>
                  <label className="text-xs font-medium mb-1 block">Pergunta</label>
                  <Textarea value={editQ} onChange={e => setEditQ(e.target.value)} rows={2} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Resposta</label>
                  <Textarea value={editA} onChange={e => setEditA(e.target.value)} rows={3} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>Cancelar</Button>
                  <Button size="sm" onClick={() => handleSaveEdit(item.id)} disabled={busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Salvar
                  </Button>
                </div>
              </div>
            )
          }
          return (
            <div key={item.id} className={`border rounded-lg p-2.5 text-sm flex items-start gap-2 ${active ? '' : 'opacity-50'}`}>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium text-sm break-words">P: {item.question}</p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">R: {item.answer}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)} title={active ? 'Desativar' : 'Ativar'} disabled={busy}>
                  {active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditingId(item.id); setEditQ(item.question); setEditA(item.answer) }} disabled={busy}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)} disabled={busy}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================
// Modal: Editar Source TEXT (edita conteúdo + reindexa automaticamente)
// ============================================

function EditTextSourceModal({ source, onClose, onSaved }: { source: AIKnowledgeSource; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(source.name)
  const [textContent, setTextContent] = useState(source.textContent || '')
  const [loading, setLoading] = useState(false)

  const contentChanged = textContent !== (source.textContent || '')
  const nameChanged = name !== source.name

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nameChanged && !contentChanged) {
      onClose()
      return
    }
    setLoading(true)
    try {
      await updateAIKnowledgeSource(source.id, {
        ...(nameChanged ? { name } : {}),
        ...(contentChanged ? { textContent } : {}),
      })
      toast.success(contentChanged ? 'Texto atualizado — reindexação iniciada' : 'Nome atualizado')
      onSaved()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar fonte')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">Editar Fonte de Texto</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Nome da Fonte *</label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Conteúdo *</label>
            <Textarea
              value={textContent}
              onChange={e => setTextContent(e.target.value)}
              required
              rows={16}
              placeholder="Cole aqui o conteúdo textual..."
            />
            <p className="text-xs text-muted-foreground mt-1">{textContent.length} caracteres</p>
          </div>

          {contentChanged && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200 flex gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>O conteúdo foi alterado. Os chunks e vetores existentes serão removidos e a fonte será reindexada automaticamente.</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading || (!nameChanged && !contentChanged)}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {contentChanged ? <><RefreshCw className="h-4 w-4 mr-1" /> Salvar e Reindexar</> : <>Salvar</>}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
