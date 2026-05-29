import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, X, Clock, Bot, User, Play, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import {
  getAISessions, getAISessionMessages, closeAISession, reopenAISession, deleteAISession,
  getAIAgents,
  type AISession, type AIMessage, type AIAgent
} from '@/services/ai.service'

export function AISessions() {
  const navigate = useNavigate()
  const toast = useToast()
  const [sessions, setSessions] = useState<any[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<any | null>(null)
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [filters, setFilters] = useState({ agentId: '', status: '', page: 1, limit: 50 })
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 })

  useEffect(() => { loadData() }, [filters])
  useEffect(() => { loadAgents() }, [])

  async function loadAgents() {
    try { setAgents(await getAIAgents()) } catch {}
  }

  async function loadData() {
    setLoading(true)
    try {
      const params: Record<string, any> = { page: filters.page, limit: filters.limit }
      if (filters.agentId) params.agentId = filters.agentId
      if (filters.status) params.status = filters.status
      const result = await getAISessions(params)
      setSessions(result.records || [])
      setPagination({ total: result.total || 0, totalPages: result.totalPages || 0 })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function openSession(session: AISession) {
    setSelectedSession(session)
    setLoadingMessages(true)
    try {
      const result = await getAISessionMessages(session.id)
      setMessages(result.messages || [])
    } catch (e) { console.error(e) }
    setLoadingMessages(false)
  }

  async function handleCloseSession(sessionId: string) {
    if (!await toast.confirm({ title: 'Encerrar sessão', message: 'Encerrar esta sessão? O bot vai parar de responder.', confirmText: 'Encerrar' })) return
    try {
      await closeAISession(sessionId)
      loadData()
      if (selectedSession?.id === sessionId) setSelectedSession(null)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleReopenSession(sessionId: string) {
    try {
      await reopenAISession(sessionId)
      loadData()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!await toast.confirm({ title: 'Excluir sessão', message: 'Excluir esta sessão e todas as mensagens? Esta ação não pode ser desfeita.', danger: true, confirmText: 'Excluir' })) return
    try {
      await deleteAISession(sessionId)
      loadData()
      if (selectedSession?.id === sessionId) setSelectedSession(null)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
  }

  const statusColors: Record<string, string> = {
    OPENED: 'bg-green-500',
    PAUSED: 'bg-yellow-500',
    CLOSED: 'bg-gray-500',
  }

  const statusLabels: Record<string, string> = {
    OPENED: 'Aberta',
    PAUSED: 'Pausada',
    CLOSED: 'Encerrada',
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function formatPhone(jid: string) {
    return jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
  }

  function getDisplayName(session: any) {
    return session.contactName || formatPhone(session.remoteJid)
  }

  function goToConversation(session: any) {
    if (session.conversationId) {
      navigate(`/messages?conversation=${session.conversationId}`)
    }
  }

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-7 w-7 text-purple-500" />
          Sessões de IA
        </h1>
        <p className="text-muted-foreground mt-1">Monitore as conversas dos agentes de IA com os clientes</p>
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
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
        >
          <option value="">Todos os status</option>
          <option value="OPENED">Abertas</option>
          <option value="PAUSED">Pausadas</option>
          <option value="CLOSED">Encerradas</option>
        </select>
        <div className="text-sm text-muted-foreground flex items-center">
          {pagination.total} sessão(ões)
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Lista de sessões */}
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="text-center py-12 bg-card border rounded-lg">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Nenhuma sessão encontrada</h3>
              <p className="text-muted-foreground mt-1">As sessões aparecem quando clientes interagem com agentes de IA</p>
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                className={`bg-card border rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors ${selectedSession?.id === session.id ? 'border-primary ring-1 ring-primary' : ''}`}
                onClick={() => openSession(session)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {session.contactAvatar ? (
                      <img
                        src={session.contactAvatar}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <User className="h-5 w-5 text-purple-500" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium">{getDisplayName(session)}</p>
                      <p className="text-xs text-muted-foreground">
                        {session.contactName && <span>{formatPhone(session.remoteJid)} • </span>}
                        {session.agent?.name || 'Agente'}
                        {' • '}{session._count?.messages || session.messageCount || 0} mensagens
                        {' • '}{session.tokensUsed || 0} tokens
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white ${statusColors[session.status]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      {statusLabels[session.status]}
                    </span>
                    <div className="flex items-center gap-1">
                      {session.conversationId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); goToConversation(session) }}
                          title="Ir para a conversa"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                      )}
                      {session.status === 'PAUSED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleReopenSession(session.id) }}
                          title="Reativar bot nesta sessão"
                        >
                          <Play className="h-3.5 w-3.5 text-green-500" />
                        </Button>
                      )}
                      {(session.status === 'OPENED' || session.status === 'PAUSED') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleCloseSession(session.id) }}
                          title="Encerrar sessão"
                        >
                          <X className="h-3.5 w-3.5 text-orange-500" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id) }}
                        title="Excluir sessão e mensagens"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Início: {formatDate(session.startedAt)}
                  </span>
                  <span>
                    Última atividade: {formatDate(session.lastActivity)}
                  </span>
                </div>
              </div>
            ))
          )}

          {/* Paginação */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                {filters.page} / {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page >= pagination.totalPages}
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
              >
                Próxima
              </Button>
            </div>
          )}
        </div>

        {/* Painel de mensagens */}
        <div className="bg-card border rounded-lg overflow-hidden">
          {selectedSession ? (
            <div className="flex flex-col h-[600px]">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedSession.contactAvatar ? (
                    <img src={selectedSession.contactAvatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <User className="h-4 w-4 text-purple-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{getDisplayName(selectedSession)}</p>
                    <p className="text-xs text-muted-foreground">{selectedSession.agent?.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {selectedSession.conversationId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToConversation(selectedSession)}
                      title="Ir para a conversa"
                    >
                      <ExternalLink className="h-4 w-4 text-blue-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSession(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm">Nenhuma mensagem</p>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          {msg.role === 'assistant' ? (
                            <Bot className="h-3 w-3" />
                          ) : (
                            <User className="h-3 w-3" />
                          )}
                          <span className="text-[10px] opacity-80">
                            {msg.role === 'assistant' ? 'IA' : selectedSession.contactName || 'Cliente'}
                            {' • '}{new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        {msg.tokensUsed && (
                          <p className="text-[10px] opacity-60 mt-1">
                            {msg.tokensUsed} tokens • {msg.latencyMs}ms
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[600px] text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Selecione uma sessão para ver as mensagens</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
