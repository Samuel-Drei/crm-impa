import { useState, useEffect } from 'react'
import { Ticket as TicketIcon, Plus, Search, Filter, MessageSquare, Clock, User, Tag, ChevronRight, AlertCircle, CheckCircle2, Loader2, XCircle, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  getTickets, getTicketById, createTicket, updateTicket, deleteTicket,
  addTicketComment, getTicketCounts,
  type Ticket, type TicketStatus, type TicketPriority, type TicketCategory, type TicketComment
} from '@/services/ticket.service'

const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; icon: any }> = {
  NOVO: { label: 'Novo', color: 'bg-blue-500', icon: AlertCircle },
  EM_ANDAMENTO: { label: 'Em Andamento', color: 'bg-amber-500', icon: Loader2 },
  AGUARDANDO: { label: 'Aguardando', color: 'bg-purple-500', icon: Pause },
  RESOLVIDO: { label: 'Resolvido', color: 'bg-green-500', icon: CheckCircle2 },
  FECHADO: { label: 'Fechado', color: 'bg-gray-500', icon: CheckCircle2 },
  CANCELADO: { label: 'Cancelado', color: 'bg-red-500', icon: XCircle },
}

const PRIORITY_CONFIG: Record<TicketPriority, { label: string; color: string }> = {
  BAIXA: { label: 'Baixa', color: 'text-gray-500' },
  MEDIA: { label: 'Média', color: 'text-blue-500' },
  ALTA: { label: 'Alta', color: 'text-orange-500' },
  URGENTE: { label: 'Urgente', color: 'text-red-600 font-bold' },
}

const CATEGORY_OPTIONS: { value: TicketCategory; label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'MELHORIA', label: 'Melhoria' },
  { value: 'SUPORTE', label: 'Suporte' },
  { value: 'INFRAESTRUTURA', label: 'Infraestrutura' },
  { value: 'FINANCEIRO', label: 'Financeiro' },
  { value: 'COMERCIAL', label: 'Comercial' },
  { value: 'OUTRO', label: 'Outro' },
]

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [search, setSearch] = useState('')
  const [commentText, setCommentText] = useState('')
  const toast = useToast()

  // Create form
  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIA' as TicketPriority, category: 'OUTRO' as TicketCategory })

  const loadTickets = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterStatus) params.status = filterStatus
      if (search) params.search = search
      const data = await getTickets(params)
      setTickets(data.tickets)
      const c = await getTicketCounts()
      setCounts(c)
    } catch { toast.error('Erro ao carregar tickets') }
    setLoading(false)
  }

  useEffect(() => { loadTickets() }, [filterStatus, search])

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Título é obrigatório')
    try {
      await createTicket(form)
      toast.success('Ticket criado')
      setShowCreate(false)
      setForm({ title: '', description: '', priority: 'MEDIA', category: 'OUTRO' })
      loadTickets()
    } catch { toast.error('Erro ao criar ticket') }
  }

  const handleStatusChange = async (ticket: Ticket, status: TicketStatus) => {
    try {
      const updated = await updateTicket(ticket.id, { status })
      setSelectedTicket(updated)
      loadTickets()
      toast.success(`Status → ${STATUS_CONFIG[status].label}`)
    } catch { toast.error('Erro ao atualizar status') }
  }

  const handleComment = async () => {
    if (!selectedTicket || !commentText.trim()) return
    try {
      await addTicketComment(selectedTicket.id, commentText)
      setCommentText('')
      const updated = await getTicketById(selectedTicket.id)
      setSelectedTicket(updated)
      loadTickets()
    } catch { toast.error('Erro ao adicionar comentário') }
  }

  const openTicket = async (t: Ticket) => {
    const full = await getTicketById(t.id)
    setSelectedTicket(full)
  }

  const totalOpen = (counts.NOVO || 0) + (counts.EM_ANDAMENTO || 0) + (counts.AGUARDANDO || 0)

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className={`${selectedTicket ? 'w-1/2 border-r' : 'w-full'} flex flex-col`}>
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TicketIcon className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold">Tickets Internos</h1>
              {totalOpen > 0 && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">{totalOpen} abertos</span>}
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> Novo Ticket
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar tickets..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="h-9 px-3 border rounded-md text-sm bg-background">
              <option value="">Todos</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {/* Mini cards de contagem */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
              <button key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
                className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 transition-colors ${filterStatus === status ? 'bg-accent' : ''}`}>
                <div className={`w-2 h-2 rounded-full ${cfg.color}`} />
                {cfg.label} <span className="font-mono">{counts[status] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Create Modal */}
        {showCreate && (
          <div className="p-4 border-b bg-accent/30 space-y-3">
            <h3 className="font-medium text-sm">Novo Ticket</h3>
            <Input placeholder="Título *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="Descrição (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="min-h-[80px]" />
            <div className="flex gap-2">
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as TicketPriority }))} className="h-9 px-3 border rounded-md text-sm bg-background flex-1">
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as TicketCategory }))} className="h-9 px-3 border rounded-md text-sm bg-background flex-1">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleCreate}>Criar Ticket</Button>
            </div>
          </div>
        )}

        {/* Ticket List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <TicketIcon className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">Nenhum ticket encontrado</p>
            </div>
          ) : (
            tickets.map(ticket => {
              const statusCfg = STATUS_CONFIG[ticket.status]
              const priorityCfg = PRIORITY_CONFIG[ticket.priority]
              const StatusIcon = statusCfg.icon
              return (
                <button key={ticket.id} onClick={() => openTicket(ticket)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-accent/50 transition-colors ${selectedTicket?.id === ticket.id ? 'bg-accent' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusIcon className={`h-3.5 w-3.5 flex-shrink-0 ${statusCfg.color.replace('bg-', 'text-')}`} />
                        <span className="font-mono text-xs text-muted-foreground">{ticket.code}</span>
                        <span className={`text-xs ${priorityCfg.color}`}>{priorityCfg.label}</span>
                      </div>
                      <p className="text-sm font-medium truncate">{ticket.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" />{ticket.createdBy?.name}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(ticket.createdAt).toLocaleDateString('pt-BR')}</span>
                        {ticket._count.comments > 0 && <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{ticket._count.comments}</span>}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedTicket && (
        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{selectedTicket.code}</span>
                <h2 className="text-base font-bold">{selectedTicket.title}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTicket(null)}>✕</Button>
            </div>
            {selectedTicket.description && <p className="text-sm text-muted-foreground mb-3">{selectedTicket.description}</p>}

            {/* Status buttons */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(Object.entries(STATUS_CONFIG) as [TicketStatus, typeof STATUS_CONFIG[TicketStatus]][]).map(([status, cfg]) => (
                <button key={status} onClick={() => handleStatusChange(selectedTicket, status)}
                  className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 transition-colors ${selectedTicket.status === status ? `${cfg.color} text-white` : 'hover:bg-accent'}`}>
                  {cfg.label}
                </button>
              ))}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Criado por:</span> {selectedTicket.createdBy?.name}</div>
              <div><span className="text-muted-foreground">Atribuído a:</span> {selectedTicket.assignee?.name || '—'}</div>
              <div><span className="text-muted-foreground">Categoria:</span> {CATEGORY_OPTIONS.find(c => c.value === selectedTicket.category)?.label}</div>
              <div><span className="text-muted-foreground">Prioridade:</span> <span className={PRIORITY_CONFIG[selectedTicket.priority].color}>{PRIORITY_CONFIG[selectedTicket.priority].label}</span></div>
              {selectedTicket.team && <div><span className="text-muted-foreground">Time:</span> {selectedTicket.team.name}</div>}
              {selectedTicket.contact && <div><span className="text-muted-foreground">Contato:</span> {selectedTicket.contact.name}</div>}
              {selectedTicket.dueDate && <div><span className="text-muted-foreground">Prazo:</span> {new Date(selectedTicket.dueDate).toLocaleDateString('pt-BR')}</div>}
              {selectedTicket.tags.length > 0 && (
                <div className="col-span-2 flex items-center gap-1 flex-wrap">
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  {selectedTicket.tags.map(t => <span key={t} className="text-xs bg-accent px-1.5 py-0.5 rounded">{t}</span>)}
                </div>
              )}
            </div>
          </div>

          {/* Comments */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selectedTicket.comments?.map(c => (
              <div key={c.id} className={`rounded-lg p-3 text-sm ${c.isInternal ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-accent/50'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-xs">{c.author.name}</span>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString('pt-BR')}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.content}</p>
              </div>
            ))}
            {(!selectedTicket.comments || selectedTicket.comments.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum comentário ainda</p>
            )}
          </div>

          {/* Comment Input */}
          <div className="p-3 border-t flex gap-2">
            <Input placeholder="Adicionar comentário..." value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleComment()} className="flex-1" />
            <Button size="sm" onClick={handleComment} disabled={!commentText.trim()}>Enviar</Button>
          </div>
        </div>
      )}
    </div>
  )
}
