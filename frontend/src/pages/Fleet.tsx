import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Plus, Bot, Send, Play, Pause, Trash2, Calendar, Activity,
  Briefcase, X, Sparkles, Clock, CheckCircle2, AlertTriangle, Loader2, Wand2,
  Search, MoreVertical, MessageSquare, ChevronDown, ArrowDown, Settings2, Brain,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Menu, Globe,
  Database, FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/Toast'
import { useStickyScroll } from '@/hooks/useStickyScroll'
import {
  fleetService,
  type FleetDepartment, type FleetMember, type FleetMission, type FleetOperation,
  type FleetChat, type FleetMessage, type CronPreviewResult, type BuilderProposedConfig, type ChatRuntimeStatus,
} from '@/services/fleet.service'
import api from '@/services/api'

// ============================================
// Helpers
// ============================================

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  PAUSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  ARCHIVED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
  COMPLETED: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  RUNNING: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  PENDING: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  AWAITING_APPROVAL: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  REJECTED: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
}

function fmtDate(s?: string | null) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return s }
}

function fmtRelative(s?: string | null) {
  if (!s) return '—'
  const diff = Date.now() - new Date(s).getTime()
  if (diff < 60_000) return 'agora'
  if (diff < 3600_000) return `há ${Math.floor(diff / 60_000)}min`
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)}h`
  return `há ${Math.floor(diff / 86_400_000)}d`
}

// ============================================
// Page — Layout 3-colunas (Agentes | Threads | Chat)
// ============================================

export function Fleet() {
  const toast = useToast()
  const [departments, setDepartments] = useState<FleetDepartment[]>([])
  const [members, setMembers] = useState<FleetMember[]>([])
  const [providers, setProviders] = useState<{ id: string; name: string; type: string; model: string; isActive: boolean; enabledModels?: string[] }[]>([])
  const [selectedMember, setSelectedMember] = useState<FleetMember | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'chat' | 'missions' | 'operations'>('chat')
  const [loading, setLoading] = useState(true)

  // Sidebar state — ChatGPT-style: collapsible em desktop, drawer em mobile
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('fleet-agent-sidebar-open')
    if (saved !== null) return saved === 'true'
    return window.innerWidth >= 1024
  })
  const [threadSidebarOpen, setThreadSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('fleet-thread-sidebar-open')
    if (saved !== null) return saved === 'true'
    return window.innerWidth >= 1280
  })
  useEffect(() => { localStorage.setItem('fleet-agent-sidebar-open', String(agentSidebarOpen)) }, [agentSidebarOpen])
  useEffect(() => { localStorage.setItem('fleet-thread-sidebar-open', String(threadSidebarOpen)) }, [threadSidebarOpen])

  const [showMemberModal, setShowMemberModal] = useState(false)
  const [showBuilderModal, setShowBuilderModal] = useState(false)
  const [showDeptModal, setShowDeptModal] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [deps, mems, provs] = await Promise.all([
        fleetService.listDepartments(),
        fleetService.listMembers(),
        api.get<any[]>('/ai/providers').then(r => r.data).catch(() => []),
      ])
      setDepartments(deps)
      setMembers(mems)
      setProviders(provs.map((p: any) => ({
        id: p.id, name: p.name, type: p.type, model: p.model,
        isActive: p.isActive, enabledModels: p.enabledModels,
      })))
      // Auto-selecionar primeiro membro se nenhum estiver ativo
      if (!selectedMember && mems[0]) setSelectedMember(mems[0])
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erro ao carregar Fleet')
    } finally {
      setLoading(false)
    }
  }

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(m =>
      m.name?.toLowerCase().includes(q) ||
      m.displayRole?.toLowerCase().includes(q) ||
      m.department?.name?.toLowerCase().includes(q)
    )
  }, [members, search])

  async function handleMemberChanged() {
    await loadAll()
    if (selectedMember) {
      try { setSelectedMember(await fleetService.getMember(selectedMember.id)) } catch {}
    }
  }

  async function handleMemberRemoved(id: string) {
    setSelectedMember(prev => (prev?.id === id ? null : prev))
    await loadAll()
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-zinc-50 dark:bg-zinc-950 overflow-hidden relative">
      {/* Backdrop mobile quando sidebar de agentes está aberta */}
      {agentSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setAgentSidebarOpen(false)}
        />
      )}

      {/* ─────────────── COLUNA 1: Agentes (drawer em <lg, fixo em lg+) ─────────────── */}
      <AgentSidebar
        members={filteredMembers}
        allCount={members.length}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        selectedId={selectedMember?.id || null}
        open={agentSidebarOpen}
        onClose={() => setAgentSidebarOpen(false)}
        onSelect={(m) => {
          setSelectedMember(m)
          if (window.innerWidth < 1024) setAgentSidebarOpen(false)
        }}
        onCreate={() => setShowMemberModal(true)}
        onCreateAI={() => setShowBuilderModal(true)}
        onDeleteAgent={async (m) => {
          if (!confirm(`Remover o agente "${m.name}" da Fleet? Essa ação não pode ser desfeita.`)) return
          try {
            await fleetService.deleteMember(m.id)
            await handleMemberRemoved(m.id)
          } catch (e: any) { /* toast já é do parent? */ alert(e?.response?.data?.error || 'Falha ao remover') }
        }}
      />

      {/* ─────────────── COLUNAS 2+3: Workspace do agente ─────────────── */}
      {selectedMember ? (
        <ChatWorkspace
          key={selectedMember.id}
          member={selectedMember}
          providers={providers}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onChanged={handleMemberChanged}
          onRemoved={() => handleMemberRemoved(selectedMember.id)}
          agentSidebarOpen={agentSidebarOpen}
          onToggleAgentSidebar={() => setAgentSidebarOpen(v => !v)}
          threadSidebarOpen={threadSidebarOpen}
          onToggleThreadSidebar={() => setThreadSidebarOpen(v => !v)}
        />
      ) : (
        <div className="flex-1 min-w-0 flex items-center justify-center relative">
          {/* Botão para reabrir sidebar de agentes em mobile */}
          {!agentSidebarOpen && (
            <button
              onClick={() => setAgentSidebarOpen(true)}
              className="absolute top-3 left-3 lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              title="Abrir agentes"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <div className="text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 mx-auto mb-4 flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-violet-500" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-200">IMPA Fleet</h2>
            <p className="text-sm text-zinc-500 mt-1 max-w-sm">
              {members.length === 0
                ? 'Nenhum membro ainda. Crie seu primeiro agente para começar.'
                : 'Selecione um membro à esquerda para começar a conversar.'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-5">
              <Button onClick={() => setShowBuilderModal(true)} variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300">
                <Wand2 className="w-4 h-4 mr-2" /> Criar com IA
              </Button>
              <Button onClick={() => setShowMemberModal(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
                <Plus className="w-4 h-4 mr-2" /> Novo membro
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modais */}
      {showMemberModal && (
        <CreateMemberModal
          providers={providers}
          departments={departments}
          onClose={() => setShowMemberModal(false)}
          onCreated={(created) => {
            setShowMemberModal(false)
            loadAll()
            if (created) { setSelectedMember(created); setActiveTab('chat') }
          }}
        />
      )}
      {showBuilderModal && (
        <BuilderModal
          providers={providers}
          departments={departments}
          onClose={() => setShowBuilderModal(false)}
          onCreated={() => { setShowBuilderModal(false); loadAll() }}
        />
      )}
      {showDeptModal && (
        <CreateDepartmentModal
          onClose={() => setShowDeptModal(false)}
          onCreated={() => { setShowDeptModal(false); loadAll() }}
        />
      )}
    </div>
  )
}

// ============================================
// AgentSidebar (col 1)
// ============================================

function AgentSidebar({
  members, allCount, loading, search, onSearchChange, selectedId, onSelect, onCreate, onCreateAI, onDeleteAgent,
  open, onClose,
}: {
  members: FleetMember[]
  allCount: number
  loading: boolean
  search: string
  onSearchChange: (s: string) => void
  selectedId: string | null
  onSelect: (m: FleetMember) => void
  onCreate: () => void
  onCreateAI: () => void
  onDeleteAgent: (m: FleetMember) => void
  open: boolean
  onClose: () => void
}) {
  return (
    <aside
      className={`shrink-0 flex flex-col min-h-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-all duration-200 ease-out
        ${open
          ? 'w-[18rem] max-w-[85vw] lg:w-64 lg:max-w-none'
          : 'w-0 lg:w-0 border-r-0'}
        fixed inset-y-0 left-0 z-40 lg:static lg:z-auto
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
      style={{ overflow: open ? undefined : 'hidden' }}
    >
      <div className="px-4 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">IMPA Fleet</div>
            <div className="text-[11px] text-zinc-500">{allCount} {allCount === 1 ? 'agente' : 'agentes'}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 lg:inline-flex hidden w-7 h-7 rounded-lg items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Recolher painel de agentes"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="shrink-0 lg:hidden inline-flex w-7 h-7 rounded-lg items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Buscar agente..."
            className="pl-8 h-8 text-sm bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="text-center text-xs text-zinc-500 py-8">
            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Carregando...
          </div>
        )}
        {!loading && members.length === 0 && (
          <div className="text-center text-xs text-zinc-500 py-8 px-3">
            {search ? 'Nenhum agente encontrado.' : 'Nenhum agente. Crie o primeiro abaixo.'}
          </div>
        )}
        {members.map(m => {
          const active = m.id === selectedId
          return (
            <div
              key={m.id}
              className={`group relative w-full rounded-xl transition ${
                active
                  ? 'bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/30'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
              }`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-violet-500 rounded-r-full" />}
              <button
                onClick={() => onSelect(m)}
                className="w-full text-left px-2.5 py-2 flex items-center gap-3"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ring-1 ring-black/5 dark:ring-white/5"
                  style={{ background: m.colorTag ? `linear-gradient(135deg, ${m.colorTag}40, ${m.colorTag}15)` : 'linear-gradient(135deg, #8b5cf640, #6366f115)' }}
                >
                  {m.emoji || '🤖'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {m.name}
                    <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">{m.displayRole}</div>
                </div>
                {!m.onboarded && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0 mr-6">
                    setup
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDeleteAgent(m) }}
                title="Excluir agente"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 p-2 space-y-1.5">
        <Button onClick={onCreateAI} variant="outline" size="sm" className="w-full justify-start border-violet-200 dark:border-violet-800/50 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10">
          <Wand2 className="w-3.5 h-3.5 mr-2" /> Criar com IA
        </Button>
        <Button onClick={onCreate} size="sm" className="w-full justify-start bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
          <Plus className="w-3.5 h-3.5 mr-2" /> Novo agente
        </Button>
      </div>
    </aside>
  )
}

// ============================================
// ChatWorkspace (cols 2+3) — header + tabs + content
// ============================================

function ChatWorkspace({
  member, providers, activeTab, onTabChange, onChanged, onRemoved,
  agentSidebarOpen, onToggleAgentSidebar, threadSidebarOpen, onToggleThreadSidebar,
}: {
  member: FleetMember
  providers: { id: string; name: string; type: string; model: string; isActive: boolean; enabledModels?: string[] }[]
  activeTab: 'chat' | 'missions' | 'operations'
  onTabChange: (t: 'chat' | 'missions' | 'operations') => void
  onChanged: () => void
  onRemoved: () => void
  agentSidebarOpen: boolean
  onToggleAgentSidebar: () => void
  threadSidebarOpen: boolean
  onToggleThreadSidebar: () => void
}) {
  const toast = useToast()
  const [showMissionModal, setShowMissionModal] = useState(false)
  const [showToolsModal, setShowToolsModal] = useState(false)
  const [chats, setChats] = useState<FleetChat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [chatsLoading, setChatsLoading] = useState(false)

  // Carregar chats sempre que o membro muda
  useEffect(() => {
    let cancelled = false
    async function load() {
      setChatsLoading(true)
      try {
        let cs = await fleetService.listChats({ memberId: member.id })
        // Auto-criar primeiro chat para onboarding
        if (cs.length === 0 && !member.onboarded) {
          try {
            const opened = await fleetService.openChat(member.id)
            cs = await fleetService.listChats({ memberId: member.id })
            if (!cancelled) setActiveChatId(opened.id)
          } catch {}
        } else if (cs[0] && !cancelled) {
          setActiveChatId(cs[0].id)
        }
        if (!cancelled) setChats(cs)
      } finally {
        if (!cancelled) setChatsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [member.id, member.onboarded])

  async function refreshChats() {
    try {
      const cs = await fleetService.listChats({ memberId: member.id })
      setChats(cs)
    } catch {}
  }

  function newChat() {
    setActiveChatId(null)
  }

  async function toggleStatus() {
    try {
      const newStatus = member.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
      await fleetService.updateMember(member.id, { status: newStatus } as any)
      toast.success(`Membro ${newStatus === 'ACTIVE' ? 'ativado' : 'pausado'}`)
      onChanged()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') }
  }

  async function deleteCurrentChat() {
    if (!activeChatId) return
    const target = chats.find(c => c.id === activeChatId)
    if (!confirm(`Excluir a conversa "${target?.title || 'sem título'}"? O histórico de mensagens será arquivado.`)) return
    try {
      await fleetService.archiveChat(activeChatId)
      toast.success('Conversa excluída')
      const cs = await fleetService.listChats({ memberId: member.id })
      setChats(cs)
      setActiveChatId(cs[0]?.id || null)
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha ao excluir conversa') }
  }

  return (
    <>
      {/* COLUNA 2: ThreadSidebar (apenas na aba Chat) — collapsível via toggle */}
      {activeTab === 'chat' && threadSidebarOpen && (
        <aside className="w-56 shrink-0 hidden md:flex flex-col min-h-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
          <div className="px-3 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Conversas</span>
            <div className="flex items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={newChat} title="Nova conversa">
                <Plus className="w-4 h-4" />
              </Button>
              <button
                onClick={onToggleThreadSidebar}
                className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Recolher conversas"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {chatsLoading && (
              <div className="text-center text-xs text-zinc-500 py-4">
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              </div>
            )}
            {!chatsLoading && chats.length === 0 && (
              <div className="text-center text-xs text-zinc-500 py-6 px-3">
                Nenhuma conversa ainda.<br />
                <button onClick={newChat} className="text-violet-600 hover:underline mt-1">Iniciar primeira</button>
              </div>
            )}
            {chats.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveChatId(c.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition ${
                  activeChatId === c.id
                    ? 'bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-sm'
                    : 'hover:bg-white/60 dark:hover:bg-zinc-800/40'
                }`}
              >
                <div className="text-sm font-medium truncate text-zinc-700 dark:text-zinc-200">
                  {c.title || 'Conversa sem título'}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{fmtRelative(c.updatedAt)}</div>
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* COLUNA 3: Main */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-white dark:bg-zinc-950">
        {/* Header */}
        <header className="px-3 sm:px-4 lg:px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          {/* Toggle agent sidebar (mobile + desktop quando recolhida) */}
          {!agentSidebarOpen && (
            <button
              onClick={onToggleAgentSidebar}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Mostrar agentes"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          {activeTab === 'chat' && !threadSidebarOpen && (
            <button
              onClick={onToggleThreadSidebar}
              className="shrink-0 hidden md:inline-flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Mostrar conversas"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          )}
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-xl shadow-sm ring-1 ring-black/5 dark:ring-white/5 shrink-0"
            style={{ background: member.colorTag ? `linear-gradient(135deg, ${member.colorTag}40, ${member.colorTag}15)` : 'linear-gradient(135deg, #8b5cf640, #6366f115)' }}
          >
            {member.emoji || '🤖'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm sm:text-[15px] flex items-center gap-2 min-w-0">
              <span className="truncate">{member.name}</span>
              <span className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                member.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${member.status === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                {member.status === 'ACTIVE' ? 'online' : member.status.toLowerCase()}
              </span>
              {!member.onboarded && (
                <span className="hidden md:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 shrink-0">
                  configurando
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 truncate">{member.displayRole}</div>
          </div>

          {activeTab === 'chat' && (
            <div className="hidden lg:block shrink-0">
              <ModelSelector
                member={member}
                providers={providers}
                onChange={async (providerId, model) => {
                  try {
                    await fleetService.updateMember(member.id, { providerId, model } as any)
                    onChanged()
                    toast.success('Modelo atualizado')
                  } catch (e: any) {
                    toast.error(e?.response?.data?.error || 'Falha ao trocar modelo')
                  }
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-0.5 sm:gap-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 shrink-0">
            <TabPill active={activeTab === 'chat'} onClick={() => onTabChange('chat')} icon={<MessageSquare className="w-3.5 h-3.5" />} label="Chat" />
            <TabPill active={activeTab === 'missions'} onClick={() => onTabChange('missions')} icon={<Calendar className="w-3.5 h-3.5" />} label="Missões" />
            <TabPill active={activeTab === 'operations'} onClick={() => onTabChange('operations')} icon={<Activity className="w-3.5 h-3.5" />} label="Histórico" />
          </div>

          <div className="hidden sm:flex items-center gap-1 ml-1 sm:ml-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => setShowToolsModal(true)}
              title="Ferramentas avançadas (HTTP Request)"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={toggleStatus}
              title={member.status === 'ACTIVE' ? 'Pausar agente' : 'Ativar agente'}
            >
              {member.status === 'ACTIVE' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            {activeTab === 'chat' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-red-600 disabled:text-zinc-400 disabled:opacity-50"
                onClick={deleteCurrentChat}
                disabled={!activeChatId}
                title={activeChatId ? 'Excluir esta conversa' : 'Nenhuma conversa aberta'}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Content por tab */}
        <div className="flex-1 min-h-0 flex flex-col">
          {activeTab === 'chat' && (
            <ChatThread
              member={member}
              activeChatId={activeChatId}
              onChatChanged={(id) => { setActiveChatId(id); refreshChats() }}
            />
          )}

          {activeTab === 'missions' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                <span className="text-sm text-zinc-500">Tarefas agendadas para {member.name}</span>
                <Button size="sm" variant="outline" onClick={() => setShowMissionModal(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Nova missão
                </Button>
              </div>
              <MissionsPanel member={member} onChanged={onChanged} />
              {showMissionModal && (
                <CreateMissionModal
                  member={member}
                  onClose={() => setShowMissionModal(false)}
                  onCreated={() => { setShowMissionModal(false); onChanged() }}
                />
              )}
            </div>
          )}

          {activeTab === 'operations' && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <OperationsPanel member={member} />
            </div>
          )}
        </div>
      </main>
      {showToolsModal && (
        <AdvancedToolsModal
          member={member}
          onClose={() => setShowToolsModal(false)}
          onSaved={() => { setShowToolsModal(false); onChanged() }}
        />
      )}
    </>
  )
}

function TabPill({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shrink-0 ${
        active
          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
      }`}
    >
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ============================================
// ModelSelector — troca rápida de provider/model no header do chat
// ============================================

function ModelSelector({
  member, providers, onChange,
}: {
  member: FleetMember
  providers: { id: string; name: string; type: string; model: string; isActive: boolean; enabledModels?: string[] }[]
  onChange: (providerId: string, model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const activeProviders = providers.filter(p => p.isActive)
  const currentProvider = providers.find(p => p.id === member.providerId)
  const currentLabel = currentProvider
    ? `${currentProvider.name} · ${member.model || currentProvider.model}`
    : member.model || 'Selecionar modelo'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Trocar provedor / modelo desta conversa"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition max-w-[260px]"
      >
        <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 max-h-96 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl z-30 py-1.5">
          <div className="px-3 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 dark:border-zinc-800">
            Provedores ativos
          </div>
          {activeProviders.length === 0 && (
            <div className="px-3 py-4 text-xs text-zinc-500 text-center">Nenhum provedor ativo. Configure em Configurações → IA.</div>
          )}
          {activeProviders.map(p => {
            const models = p.enabledModels && p.enabledModels.length > 0 ? p.enabledModels : [p.model]
            return (
              <div key={p.id} className="px-1 py-1">
                <div className="px-2 py-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {p.name}
                  <span className="text-[9px] text-zinc-400 font-normal uppercase">{p.type}</span>
                </div>
                <div className="space-y-0.5">
                  {models.map(m => {
                    const active = p.id === member.providerId && m === member.model
                    return (
                      <button
                        key={`${p.id}:${m}`}
                        type="button"
                        onClick={() => { setOpen(false); if (!active) onChange(p.id, m) }}
                        className={`w-full text-left text-[11.5px] px-3 py-1.5 rounded-md flex items-center gap-2 transition ${
                          active
                            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {active && <CheckCircle2 className="w-3.5 h-3.5 text-violet-600" />}
                        <span className={`font-mono truncate ${active ? '' : 'pl-[18px]'}`}>{m}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="px-3 py-2 text-[10px] text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
            A troca afeta este agente em todas as conversas. Para isolar por chat, crie outro membro da Fleet.
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// ChatThread — área de mensagens + composer
// ============================================

function ChatThread({
  member, activeChatId, onChatChanged,
}: {
  member: FleetMember
  activeChatId: string | null
  onChatChanged: (id: string) => void
}) {
  const [messages, setMessages] = useState<FleetMessage[]>([])
  const [runtime, setRuntime] = useState<ChatRuntimeStatus | null>(null)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [thinkingMode, setThinkingMode] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeChatRef = useRef<string | null>(activeChatId)
  activeChatRef.current = activeChatId

  // Polling loop: enquanto a IA estiver "running", busca msgs+runtime a cada 1.5s.
  // Sobrevive a fechar/reabrir a aba — basta reabrir o chat que retoma de onde parou.
  const startPolling = useCallback((chatId: string) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    let stopped = false
    const tick = async () => {
      if (stopped || activeChatRef.current !== chatId) return
      try {
        const [msgsRes, runtime] = await Promise.all([
          fleetService.getChatMessages(chatId),
          fleetService.getChatRuntime(chatId),
        ])
        const settledMsgsRes = runtime.running
          ? msgsRes
          : await fleetService.getChatMessages(chatId).catch(() => msgsRes)
        if (activeChatRef.current !== chatId) return
        setRuntime(runtime)
        setMessages(settledMsgsRes.messages)
        if (runtime.running || runtime.awaitingApproval) {
          setSending(true)
          pollTimerRef.current = setTimeout(tick, 1500)
        } else {
          setSending(false)
        }
      } catch {
        // Silencia erros transit\u00f3rios mas continua tentando se ainda no mesmo chat
        if (!stopped && activeChatRef.current === chatId) {
          pollTimerRef.current = setTimeout(tick, 3000)
        }
      }
    }
    tick()
    return () => { stopped = true; if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }
  }, [])

  // Carregar mensagens ao trocar de chat — e detectar se IA est\u00e1 rodando (reload-safe)
  useEffect(() => {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    let cancelled = false
    async function load() {
      if (!activeChatId) { setMessages([]); setRuntime(null); setSending(false); return }
      setLoading(true)
      try {
        const [data, runtime] = await Promise.all([
          fleetService.getChatMessages(activeChatId),
          fleetService.getChatRuntime(activeChatId).catch(() => ({
            running: false,
            operationId: null,
            status: null,
            startedAt: null,
            awaitingApproval: false,
            proposedActions: null,
            approvalRiskLevel: null,
            approvalRationale: null,
            toolsExecuted: 0,
            latestToolName: null,
            latestToolSuccess: null,
            latestSummary: null,
            recentTools: [],
          } satisfies ChatRuntimeStatus)),
        ])
        const settledData = runtime.running
          ? data
          : await fleetService.getChatMessages(activeChatId).catch(() => data)
        if (cancelled) return
        setRuntime(runtime)
        setMessages(settledData.messages)
        if (runtime.running || runtime.awaitingApproval) {
          setSending(true)
          startPolling(activeChatId)
        } else {
          setSending(false)
        }
      } catch {
        if (!cancelled) { setMessages([]); setSending(false) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    }
  }, [activeChatId, startPolling])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setInput('')
    setSending(true)

    const optimistic: FleetMessage = {
      id: 'temp-' + Date.now(),
      chatId: activeChatId || '',
      role: 'USER',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fleetService.sendMessage({
        memberId: member.id,
        chatId: activeChatId || undefined,
        message: trimmed,
        thinkingMode,
      })
      if (!activeChatId || res.chatId !== activeChatId) {
        onChatChanged(res.chatId)
      }
      // Inicia polling — backend roda em background, frontend pega bolhas conforme chegam.
      startPolling(res.chatId)
    } catch (e: any) {
      setRuntime(null)
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        chatId: activeChatId || '',
        role: 'SYSTEM',
        content: '❌ ' + (e?.response?.data?.error || e.message || 'Falha ao enviar'),
        createdAt: new Date().toISOString(),
      }])
      setSending(false)
    }
  }

  async function approveRuntimeOperation() {
    if (!runtime?.operationId || approvalBusy) return
    setApprovalBusy(true)
    try {
      await fleetService.approveOperation(runtime.operationId)
      setSending(true)
      if (activeChatId) startPolling(activeChatId)
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: 'approve-err-' + Date.now(),
        chatId: activeChatId || '',
        role: 'SYSTEM',
        content: '❌ ' + (e?.response?.data?.error || e.message || 'Falha ao aprovar'),
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setApprovalBusy(false)
    }
  }

  async function rejectRuntimeOperation() {
    if (!runtime?.operationId || approvalBusy) return
    setApprovalBusy(true)
    try {
      await fleetService.rejectOperation(runtime.operationId)
      if (activeChatId) {
        const [data, nextRuntime] = await Promise.all([
          fleetService.getChatMessages(activeChatId),
          fleetService.getChatRuntime(activeChatId).catch(() => null),
        ])
        setMessages(data.messages)
        setRuntime(nextRuntime)
      }
      setSending(false)
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: 'reject-err-' + Date.now(),
        chatId: activeChatId || '',
        role: 'SYSTEM',
        content: '❌ ' + (e?.response?.data?.error || e.message || 'Falha ao rejeitar'),
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setApprovalBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatMessages
        member={member}
        messages={messages}
        runtime={runtime}
        sending={sending}
        loading={loading}
        approvalBusy={approvalBusy}
        onApproveOperation={approveRuntimeOperation}
        onRejectOperation={rejectRuntimeOperation}
        onSuggestion={send}
      />
      <ChatComposer
        memberName={member.name}
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        disabled={sending || member.status !== 'ACTIVE'}
        thinkingMode={thinkingMode}
        onToggleThinking={() => setThinkingMode(v => !v)}
      />
    </div>
  )
}

// ============================================
// ChatMessages — lista com sticky-scroll
// ============================================

function ChatMessages({
  member, messages, runtime, sending, loading, approvalBusy, onApproveOperation, onRejectOperation, onSuggestion,
}: {
  member: FleetMember
  messages: FleetMessage[]
  runtime: ChatRuntimeStatus | null
  sending: boolean
  loading: boolean
  approvalBusy: boolean
  onApproveOperation: () => void
  onRejectOperation: () => void
  onSuggestion: (text: string) => void
}) {
  const { scrollRef, innerRef, isPinned, scrollToBottom, onScroll } = useStickyScroll<HTMLDivElement>({
    deps: [messages.length, sending],
  })

  const SUGGESTIONS = [
    `Quantos contatos eu tenho?`,
    `Liste meus pipelines`,
    `Liste minhas instâncias de WhatsApp`,
  ]

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(139,92,246,0.04), transparent 60%), radial-gradient(circle at 80% 100%, rgba(99,102,241,0.04), transparent 50%)',
        }}
      >
        <div ref={innerRef} className="max-w-3xl mx-auto px-6 py-8 space-y-4">
          {loading && (
            <div className="text-center text-zinc-400 py-12">
              <Loader2 className="w-6 h-6 animate-spin mx-auto" />
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="text-center py-12">
              <div
                className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center text-4xl ring-1 ring-black/5 dark:ring-white/5"
                style={{ background: member.colorTag ? `linear-gradient(135deg, ${member.colorTag}40, ${member.colorTag}15)` : 'linear-gradient(135deg, #8b5cf640, #6366f115)' }}
              >
                {member.emoji || '🤖'}
              </div>
              <div className="font-semibold text-lg text-zinc-700 dark:text-zinc-200">{member.name}</div>
              <div className="text-sm text-zinc-500 mt-1">{member.displayRole}</div>
              <div className="text-xs text-zinc-400 mt-3 max-w-md mx-auto">
                {member.onboarded
                  ? 'Pronto para trabalhar. Faça uma pergunta ou peça uma ação.'
                  : 'Em modo de configuração. Conte como você quer que eu trabalhe.'}
              </div>
              {member.onboarded && (
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => onSuggestion(s)}
                      className="text-xs px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-violet-50 dark:hover:bg-violet-500/10 text-zinc-700 dark:text-zinc-300 hover:text-violet-700 dark:hover:text-violet-300 transition border border-transparent hover:border-violet-200 dark:hover:border-violet-500/30"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              member={member}
              showAvatar={!messages[idx - 1] || messages[idx - 1].role !== msg.role}
            />
          ))}

          {(runtime?.running || runtime?.awaitingApproval) && (
            <OperationRuntimeCard
              runtime={runtime}
              approvalBusy={approvalBusy}
              onApprove={onApproveOperation}
              onReject={onRejectOperation}
            />
          )}
          {sending && !runtime?.awaitingApproval && <TypingIndicator member={member} />}
        </div>
      </div>

      {/* Botão flutuante "voltar pro fim" */}
      {!isPinned && messages.length > 0 && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition"
        >
          <ArrowDown className="w-3.5 h-3.5" /> Voltar para o fim
        </button>
      )}
    </div>
  )
}

// ============================================
// Verbos lúdicos para o spinner (estilo Claude Code / OpenClaude)
// ============================================

const SPINNER_VERBS_PT = [
  'Pensando', 'Maquinando', 'Tramando', 'Refletindo', 'Borbulhando',
  'Fervendo ideia', 'Costurando plano', 'Conferindo detalhes', 'Caçando dados',
  'Revirando memória', 'Cogitando', 'Ponderando', 'Ruminando', 'Mastigando',
  'Marinando', 'Destrinchando', 'Decifrando', 'Garimpando', 'Filosofando',
  'Especulando', 'Cozinhando', 'Calibrando', 'Conjurando', 'Forjando',
  'Tecendo', 'Bolando', 'Arquitetando', 'Engendrando', 'Articulando',
  'Sondando', 'Amassando', 'Fermentando', 'Costurando', 'Lapidando',
  'Refogando', 'Apurando', 'Esmiuçando', 'Triangulando',
]

const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽']

function pickRandomVerb() {
  return SPINNER_VERBS_PT[Math.floor(Math.random() * SPINNER_VERBS_PT.length)]
}

function TypingIndicator({ member }: { member: FleetMember }) {
  const [verb, setVerb] = useState(pickRandomVerb)
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const verbT = setInterval(() => setVerb(pickRandomVerb()), 2200)
    const frameT = setInterval(() => setFrame(f => (f + 1) % (SPINNER_GLYPHS.length * 2 - 2)), 110)
    const elapsedT = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => { clearInterval(verbT); clearInterval(frameT); clearInterval(elapsedT) }
  }, [])

  // Frames bidirecionais: · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢ → loop
  const idx = frame < SPINNER_GLYPHS.length ? frame : (SPINNER_GLYPHS.length * 2 - 2 - frame)
  const glyph = SPINNER_GLYPHS[Math.max(0, Math.min(idx, SPINNER_GLYPHS.length - 1))]

  return (
    <div className="flex items-end gap-2 justify-start">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0"
        style={{ background: member.colorTag ? `linear-gradient(135deg, ${member.colorTag}40, ${member.colorTag}15)` : 'linear-gradient(135deg, #8b5cf640, #6366f115)' }}
      >
        {member.emoji || '🤖'}
      </div>
      <div className="bg-white dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/40 rounded-2xl rounded-bl-md px-3.5 py-2 shadow-sm">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-violet-500 dark:text-violet-400 font-mono w-3 inline-block text-center">{glyph}</span>
          <span className="text-zinc-600 dark:text-zinc-300 italic">{verb}…</span>
          {elapsed >= 3 && (
            <span className="text-[10px] text-zinc-400 tabular-nums">{elapsed}s</span>
          )}
        </div>
      </div>
    </div>
  )
}

function OperationRuntimeCard({ runtime, approvalBusy, onApprove, onReject }: {
  runtime: ChatRuntimeStatus
  approvalBusy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const recentTools = runtime.recentTools || []
  const elapsedLabel = runtime.startedAt ? fmtRelative(runtime.startedAt) : 'agora'
  const latestTone = runtime.latestToolSuccess === false
    ? 'text-red-700 dark:text-red-300'
    : 'text-zinc-700 dark:text-zinc-200'
  const approval = runtime.proposedActions || {}
  const risks: any[] = Array.isArray(approval.risks) ? approval.risks : []

  return (
    <div className="flex justify-start pl-10">
      <div className={`max-w-[88%] w-full rounded-2xl border px-3.5 py-3 shadow-sm ${
        runtime.awaitingApproval
          ? 'border-violet-200/70 dark:border-violet-900/50 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 dark:from-violet-950/20 dark:to-fuchsia-950/10'
          : 'border-blue-200/70 dark:border-blue-900/50 bg-gradient-to-br from-blue-50/80 to-cyan-50/60 dark:from-blue-950/20 dark:to-cyan-950/10'
      }`}>
        <div className="flex items-center gap-2 text-[11.5px]">
          <Badge className={STATUS_COLORS[runtime.status || 'RUNNING']} variant="outline">{runtime.status || 'RUNNING'}</Badge>
          <span className="text-zinc-500 dark:text-zinc-400">{runtime.toolsExecuted} tool{runtime.toolsExecuted === 1 ? '' : 's'} executada{runtime.toolsExecuted === 1 ? '' : 's'}</span>
          <span className="text-zinc-400 dark:text-zinc-500 ml-auto">{elapsedLabel}</span>
        </div>

        {runtime.awaitingApproval ? (
          <div className="mt-2 space-y-2">
            <div className="text-[13px] font-semibold text-violet-900 dark:text-violet-100">Aguardando sua aprovação para executar</div>
            <div className="text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap break-words">
              {approval.rationale || runtime.approvalRationale || 'O crítico interno marcou esta operação como sensível.'}
            </div>
            {risks.length > 0 && (
              <div className="space-y-1">
                {risks.slice(0, 3).map((risk, index) => (
                  <div key={index} className="text-[11.5px] text-violet-800 dark:text-violet-200 flex gap-1.5">
                    <span className="font-mono opacity-60">{index + 1}.</span>
                    <span>{risk.title || 'Risco identificado'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={onApprove} disabled={approvalBusy} className="h-8 text-xs bg-violet-600 hover:bg-violet-700">
                {approvalBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                Aprovar e executar
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={approvalBusy} className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/20">
                <X className="w-3.5 h-3.5 mr-1.5" /> Rejeitar
              </Button>
            </div>
          </div>
        ) : (
          <div className={`mt-2 text-[13px] font-medium ${latestTone}`}>
            {runtime.latestSummary || 'Preparando execução...'}
          </div>
        )}

        {!runtime.awaitingApproval && recentTools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {recentTools.map((tool, index) => (
              <div
                key={`${tool.toolName}-${index}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                  tool.toolSuccess
                    ? 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
                    : 'border-red-200/70 bg-red-50/70 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'
                }`}
              >
                {tool.toolSuccess ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                <span className="font-mono">{tool.toolName}</span>
                {tool.durationMs > 0 && <span className="opacity-60">{(tool.durationMs / 1000).toFixed(1)}s</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// MessageBubble — render por role
// ============================================

// ─────────────────────────────────────────────
// ThinkingBubble — pensamento colapsável estilo OpenClaude (✻ Pensando…)
// ─────────────────────────────────────────────
function ThinkingBubble({ thought, durationMs }: { thought: string; durationMs?: number | null }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = thought.length > 120
  const preview = isLong ? thought.slice(0, 120).replace(/\s+\S*$/, '') + '…' : thought

  return (
    <div className="flex justify-start pl-10">
      <button
        type="button"
        onClick={() => isLong && setExpanded(v => !v)}
        className={`max-w-[85%] text-left rounded-2xl border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 dark:from-violet-950/20 dark:to-fuchsia-950/10 px-3.5 py-2 transition ${
          isLong ? 'hover:border-violet-300 dark:hover:border-violet-700/60 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-300/90">
          <span className="font-mono text-violet-500 dark:text-violet-400 text-sm leading-none">✻</span>
          <span className="italic font-normal opacity-80">Pensei</span>
          {durationMs != null && <span className="opacity-50 font-normal">· {(durationMs / 1000).toFixed(1)}s</span>}
          {isLong && (
            <ChevronDown className={`w-3 h-3 ml-auto opacity-60 transition ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
        <div className={`text-[12.5px] leading-relaxed text-violet-900/80 dark:text-violet-100/75 whitespace-pre-wrap break-words italic mt-0.5 ${
          expanded || !isLong ? '' : 'line-clamp-1'
        }`}>
          {expanded || !isLong ? thought || '(pensamento vazio)' : preview}
        </div>
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
// Renderers customizados por tool
// Retorna ReactNode quando tem render especial, ou null pra cair no genérico
// ─────────────────────────────────────────────
function renderToolCustom(msg: FleetMessage): React.ReactNode | null {
  if (!msg.toolName) return null
  const out = parseMaybeJson(msg.toolOutput)
  const inp = parseMaybeJson(msg.toolInput)
  const success = msg.toolSuccess !== false

  switch (msg.toolName) {
    case 'send_whatsapp_message':
      return <ToolRenderWhatsApp inp={inp} out={out} success={success} durationMs={msg.durationMs} />
    case 'list_contacts':
      return <ToolRenderListContacts inp={inp} out={out} success={success} durationMs={msg.durationMs} />
    case 'list_instances':
      return <ToolRenderListInstances out={out} success={success} durationMs={msg.durationMs} />
    case 'list_conversations':
      return <ToolRenderListConversations inp={inp} out={out} success={success} durationMs={msg.durationMs} />
    case 'update_todos':
      return <ToolRenderTodos inp={inp} out={out} success={success} durationMs={msg.durationMs} />
    case 'spawn_subagent':
      return <ToolRenderSpawnSubagent inp={inp} out={out} success={success} durationMs={msg.durationMs} />
    default:
      return null
  }
}

function parseMaybeJson(v: any): any {
  if (v == null) return null
  if (typeof v === 'object') return v
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}

function ToolPillFrame({
  icon, title, success, durationMs, accent = 'cyan', children, defaultOpen = true,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  success: boolean
  durationMs?: number | null
  accent?: 'cyan' | 'emerald' | 'amber' | 'sky' | 'violet'
  children?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const accentMap: Record<string, string> = {
    cyan: 'border-cyan-200 dark:border-cyan-800/50 bg-cyan-50/60 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-300',
    emerald: 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
    sky: 'border-sky-200 dark:border-sky-800/50 bg-sky-50/60 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300',
    violet: 'border-violet-200 dark:border-violet-800/50 bg-violet-50/60 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300',
  }
  const errClass = 'border-red-200 dark:border-red-800/50 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-300'
  const cls = success ? accentMap[accent] : errClass

  return (
    <div className="flex justify-start pl-10">
      <div className={`max-w-[88%] w-full rounded-2xl border ${cls} px-3 py-2`}>
        <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-1.5 text-[11.5px] font-semibold text-left">
          {success ? <span className="opacity-90">{icon}</span> : <AlertTriangle className="w-3.5 h-3.5" />}
          <span className="truncate">{title}</span>
          {durationMs != null && <span className="opacity-50 font-normal text-[10px] ml-1">{(durationMs / 1000).toFixed(2)}s</span>}
          <ChevronDown className={`w-3 h-3 ml-auto opacity-60 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && children && (
          <div className="mt-2 pt-2 border-t border-current/10">{children}</div>
        )}
      </div>
    </div>
  )
}

function ToolRenderWhatsApp({ inp, out, success, durationMs }: { inp: any; out: any; success: boolean; durationMs?: number | null }) {
  const to: string = (out?.data?.to || out?.to || inp?.to || '').toString()
  const text: string = (inp?.text || '').toString()
  const isGroup = to.endsWith('@g.us')
  const instanceName = out?.data?.instance?.name || out?.instance?.name
  const cleanedTo = to.replace('@s.whatsapp.net', '').replace('@g.us', '')
  const errorMsg = !success ? (out?.message || out?.error || 'Falha ao enviar') : null

  return (
    <ToolPillFrame
      icon={<MessageSquare className="w-3.5 h-3.5" />}
      title={
        <span>
          {success ? 'WhatsApp enviado' : 'Falha no envio'} {success && (
            <span className="font-normal opacity-80">
              · {isGroup ? '👥 Grupo' : '👤 Pessoa'} <span className="font-mono">{cleanedTo}</span>
            </span>
          )}
        </span>
      }
      success={success}
      durationMs={durationMs}
      accent="emerald"
      defaultOpen={!success}
    >
      {success ? (
        <div className="space-y-1.5">
          <div className="rounded-lg bg-white/60 dark:bg-emerald-950/30 px-3 py-2 text-[12.5px] text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap break-words border border-emerald-200/40 dark:border-emerald-800/30">
            {text || '(sem texto)'}
          </div>
          <div className="text-[10px] text-emerald-700/70 dark:text-emerald-300/60 flex items-center gap-2 px-1">
            {instanceName && <span>via {instanceName}</span>}
            <span className="opacity-60 font-mono">{to}</span>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-red-700 dark:text-red-300">{errorMsg}</div>
      )}
    </ToolPillFrame>
  )
}

function ToolRenderListContacts({ inp, out, success, durationMs }: { inp: any; out: any; success: boolean; durationMs?: number | null }) {
  const contacts: any[] = out?.data?.contacts || out?.contacts || []
  const search = inp?.search
  return (
    <ToolPillFrame
      icon={<Users className="w-3.5 h-3.5" />}
      title={
        <span>
          {contacts.length} contato{contacts.length === 1 ? '' : 's'}
          {search && <span className="font-normal opacity-70"> · busca "{search}"</span>}
        </span>
      }
      success={success}
      durationMs={durationMs}
      accent="sky"
    >
      {contacts.length === 0 ? (
        <div className="text-[12px] opacity-70">Nenhum contato encontrado.</div>
      ) : (
        <div className="space-y-1">
          {contacts.slice(0, 8).map((c: any, i: number) => (
            <div key={c.id || i} className="flex items-center gap-2 text-[12px] py-0.5">
              <div className="w-6 h-6 rounded-full bg-sky-200 dark:bg-sky-900/40 flex items-center justify-center text-[10px] font-bold text-sky-700 dark:text-sky-300 shrink-0">
                {(c.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">{c.name || '(sem nome)'}</span>
              {c.phone && <span className="font-mono text-[10.5px] opacity-70 shrink-0">{c.phone}</span>}
            </div>
          ))}
          {contacts.length > 8 && (
            <div className="text-[10.5px] opacity-60 italic pt-1">+ {contacts.length - 8} contato(s) adicionais</div>
          )}
        </div>
      )}
    </ToolPillFrame>
  )
}

function ToolRenderListInstances({ out, success, durationMs }: { out: any; success: boolean; durationMs?: number | null }) {
  const instances: any[] = out?.data?.instances || out?.instances || []
  return (
    <ToolPillFrame
      icon={<Activity className="w-3.5 h-3.5" />}
      title={<span>{instances.length} instância{instances.length === 1 ? '' : 's'} de WhatsApp</span>}
      success={success}
      durationMs={durationMs}
      accent="violet"
    >
      <div className="grid grid-cols-2 gap-1.5">
        {instances.map((inst: any, i: number) => (
          <div key={inst.id || i} className="rounded-lg border border-violet-200/50 dark:border-violet-800/30 bg-white/50 dark:bg-violet-950/20 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                inst.status === 'CONNECTED' || inst.status === 'ACTIVE'
                  ? 'bg-emerald-500'
                  : 'bg-zinc-400'
              }`} />
              <span className="text-[11.5px] font-medium truncate text-zinc-800 dark:text-zinc-100">{inst.name}</span>
            </div>
            <div className="text-[9.5px] opacity-60 mt-0.5">
              {inst.channel} · {inst.status}
            </div>
          </div>
        ))}
      </div>
    </ToolPillFrame>
  )
}

function ToolRenderListConversations({ inp, out, success, durationMs }: { inp: any; out: any; success: boolean; durationMs?: number | null }) {
  const convs: any[] = out?.data?.conversations || out?.conversations || []
  return (
    <ToolPillFrame
      icon={<MessageSquare className="w-3.5 h-3.5" />}
      title={
        <span>
          {convs.length} conversa{convs.length === 1 ? '' : 's'}
          {inp?.search && <span className="font-normal opacity-70"> · "{inp.search}"</span>}
        </span>
      }
      success={success}
      durationMs={durationMs}
      accent="sky"
    >
      <div className="space-y-1">
        {convs.slice(0, 8).map((c: any, i: number) => {
          const isGroup = String(c.contactWaId || c.jid || '').endsWith('@g.us')
          return (
            <div key={c.id || i} className="flex items-center gap-2 text-[12px] py-0.5">
              <span className="text-base shrink-0">{isGroup ? '👥' : '👤'}</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">{c.contactName || c.title || '(sem nome)'}</span>
              <span className="font-mono text-[10px] opacity-60 shrink-0 truncate">{c.contactWaId || c.jid}</span>
            </div>
          )
        })}
        {convs.length > 8 && (
          <div className="text-[10.5px] opacity-60 italic pt-1">+ {convs.length - 8} conversa(s) adicional(is)</div>
        )}
      </div>
    </ToolPillFrame>
  )
}

function ToolRenderTodos({ inp, out, success, durationMs }: { inp: any; out: any; success: boolean; durationMs?: number | null }) {
  const todos: any[] = inp?.todos || out?.data?.todos || out?.todos || []
  const done = todos.filter((t: any) => t.status === 'completed').length
  const total = todos.length
  return (
    <ToolPillFrame
      icon={<CheckCircle2 className="w-3.5 h-3.5" />}
      title={<span>Plano de tarefas · {done}/{total} concluída{total === 1 ? '' : 's'}</span>}
      success={success}
      durationMs={durationMs}
      accent="amber"
    >
      <div className="space-y-1">
        {todos.map((t: any, i: number) => {
          const status = t.status || 'pending'
          const icon = status === 'completed' ? '●' : status === 'in_progress' ? '◐' : '○'
          const cls = status === 'completed'
            ? 'text-emerald-600 dark:text-emerald-400 line-through opacity-70'
            : status === 'in_progress'
            ? 'text-amber-700 dark:text-amber-300 font-semibold'
            : 'text-zinc-700 dark:text-zinc-300'
          return (
            <div key={t.id || i} className="flex items-start gap-2 text-[12px]">
              <span className={`font-mono w-3 text-center shrink-0 ${cls}`}>{icon}</span>
              <span className={`flex-1 ${cls}`}>{t.title || t.task || '(sem título)'}</span>
            </div>
          )
        })}
      </div>
    </ToolPillFrame>
  )
}

function ToolRenderSpawnSubagent({ inp, out, success, durationMs }: { inp: any; out: any; success: boolean; durationMs?: number | null }) {
  const targetName = out?.targetMember?.name || out?.targetMemberName || out?.targetMemberId || inp?.target_member_id || 'membro da Fleet'
  const instruction = out?.instruction || inp?.instruction || ''
  const output = out?.output || ''
  const status = out?.status || (success ? 'RUNNING' : 'FAILED')
  const errorMsg = !success ? (out?.message || out?.error || 'Falha ao delegar subtarefa') : null

  return (
    <ToolPillFrame
      icon={<Bot className="w-3.5 h-3.5" />}
      title={<span>Delegação para {targetName} · {status}</span>}
      success={success}
      durationMs={durationMs}
      accent="violet"
      defaultOpen={!success || !!output}
    >
      {success ? (
        <div className="space-y-2">
          {instruction && (
            <div className="rounded-lg bg-white/60 dark:bg-violet-950/30 px-3 py-2 text-[12px] text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap break-words border border-violet-200/40 dark:border-violet-800/30">
              {instruction}
            </div>
          )}
          {output && (
            <div className="text-[12px] text-violet-900/80 dark:text-violet-100/80 whitespace-pre-wrap break-words line-clamp-6">
              {output}
            </div>
          )}
          {out?.operationId && <div className="text-[10px] opacity-60 font-mono">op {out.operationId}</div>}
        </div>
      ) : (
        <div className="text-[12px] text-red-700 dark:text-red-300">{errorMsg}</div>
      )}
    </ToolPillFrame>
  )
}

function MessageBubble({ msg, member, showAvatar }: { msg: FleetMessage; member: FleetMember; showAvatar: boolean }) {
  const [showRaw, setShowRaw] = useState(false)

  if (msg.role === 'TOOL') {
    // Render especial para a tool "think" (pensamento do agente)
    if (msg.toolName === 'think') {
      let thought = ''
      try {
        const inp = typeof msg.toolInput === 'string' ? JSON.parse(msg.toolInput) : msg.toolInput
        thought = (inp && typeof inp === 'object' && typeof inp.thought === 'string') ? inp.thought : ''
      } catch { /* noop */ }
      if (!thought && typeof msg.toolInput === 'string') thought = msg.toolInput
      return <ThinkingBubble thought={thought} durationMs={msg.durationMs} />
    }

    // Renderers customizados por tool (whatsapp, list_contacts, etc)
    const custom = renderToolCustom(msg)
    if (custom) return <>{custom}</>

    const success = msg.toolSuccess !== false
    const hasDetail = !!(msg.toolInput || msg.toolOutput)
    return (
      <div className="flex justify-start pl-10">
        <div className="flex flex-col gap-1 max-w-[85%]">
          <button
            type="button"
            disabled={!hasDetail}
            onClick={() => setShowRaw(v => !v)}
            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition self-start ${
              success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
            } ${!hasDetail ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {success ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span className="font-mono font-medium">{msg.toolName || 'tool'}</span>
            {msg.durationMs != null && <span className="opacity-60">· {(msg.durationMs / 1000).toFixed(2)}s</span>}
            {hasDetail && <ChevronDown className={`w-3 h-3 transition ${showRaw ? 'rotate-180' : ''}`} />}
          </button>
          {showRaw && hasDetail && (
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 space-y-2 text-[10px] font-mono">
              {msg.toolInput && (
                <div>
                  <div className="text-zinc-500 mb-0.5">input</div>
                  <pre className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 max-h-40 overflow-y-auto">
                    {typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput, null, 2)}
                  </pre>
                </div>
              )}
              {msg.toolOutput && (
                <div>
                  <div className="text-zinc-500 mb-0.5">output</div>
                  <pre className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 max-h-40 overflow-y-auto">
                    {typeof msg.toolOutput === 'string' ? msg.toolOutput : JSON.stringify(msg.toolOutput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (msg.role === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <div className="text-xs px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/50 max-w-[90%]">
          {msg.content}
        </div>
      </div>
    )
  }

  const isUser = msg.role === 'USER'
  return (
    <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0 ${showAvatar ? '' : 'invisible'}`}
          style={{ background: member.colorTag ? `linear-gradient(135deg, ${member.colorTag}40, ${member.colorTag}15)` : 'linear-gradient(135deg, #8b5cf640, #6366f115)' }}
        >
          {member.emoji || '🤖'}
        </div>
      )}
      <div className={`max-w-[78%] flex flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            isUser
              ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-md'
              : 'bg-white dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 border border-zinc-200/60 dark:border-zinc-700/40 rounded-bl-md'
          }`}
        >
          <SimpleMarkdown text={msg.content} />
        </div>
        <div className={`text-[10px] text-zinc-400 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {fmtRelative(msg.createdAt)}
          {msg.tokensOutput ? ` · ${msg.tokensOutput} tok` : ''}
        </div>
      </div>
    </div>
  )
}

/**
 * Renderização leve de markdown inline:
 * - **negrito**, *itálico*
 * - `code inline`
 * - quebras de linha preservadas
 * - blocos ```code``` com fundo monoespaçado
 * Não adiciona dependência (sem react-markdown).
 */
function SimpleMarkdown({ text }: { text: string }) {
  // Split por blocos de código triplos
  const parts = text.split(/```([\s\S]*?)```/g)
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          // bloco de código
          const firstNl = part.indexOf('\n')
          const lang = firstNl > 0 && firstNl < 20 ? part.slice(0, firstNl) : ''
          const code = lang ? part.slice(firstNl + 1) : part
          return (
            <pre
              key={i}
              className="my-2 p-3 rounded-lg bg-black/30 dark:bg-black/50 text-[12px] font-mono overflow-x-auto whitespace-pre"
            >
              {lang && <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">{lang}</div>}
              {code}
            </pre>
          )
        }
        return <InlineMarkdown key={i} text={part} />
      })}
    </div>
  )
}

function InlineMarkdown({ text }: { text: string }) {
  // Aplica regex em ordem: code inline, negrito, itálico
  const tokens: { type: 'text' | 'code' | 'b' | 'i'; v: string }[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', v: text.slice(last, m.index) })
    if (m[1]) tokens.push({ type: 'code', v: m[1].slice(1, -1) })
    else if (m[2]) tokens.push({ type: 'b', v: m[2].slice(2, -2) })
    else if (m[3]) tokens.push({ type: 'i', v: m[3].slice(1, -1) })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ type: 'text', v: text.slice(last) })

  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'code') return <code key={i} className="px-1 py-0.5 rounded bg-black/20 dark:bg-black/40 font-mono text-[12px]">{t.v}</code>
        if (t.type === 'b') return <strong key={i} className="font-semibold">{t.v}</strong>
        if (t.type === 'i') return <em key={i}>{t.v}</em>
        return <span key={i}>{t.v}</span>
      })}
    </>
  )
}

// ============================================
// ChatComposer
// ============================================

function ChatComposer({
  memberName, value, onChange, onSend, disabled, thinkingMode, onToggleThinking,
}: {
  memberName: string
  value: string
  onChange: (s: string) => void
  onSend: () => void
  disabled: boolean
  thinkingMode?: boolean
  onToggleThinking?: () => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className={`flex items-end gap-2 bg-zinc-100 dark:bg-zinc-900 rounded-2xl border focus-within:ring-2 transition px-3 py-2 ${
          thinkingMode
            ? 'border-violet-400 dark:border-violet-500/60 ring-2 ring-violet-500/20 focus-within:ring-violet-500/30'
            : 'border-zinc-200 dark:border-zinc-800 focus-within:border-violet-400 dark:focus-within:border-violet-500 focus-within:ring-violet-500/20'
        }`}>
          {onToggleThinking && (
            <button
              type="button"
              onClick={onToggleThinking}
              title={thinkingMode ? 'Modo Pensar ATIVO — o agente pensa antes de agir. Clique para desativar.' : 'Ativar Modo Pensar — o agente vai planejar antes de executar.'}
              className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-xs font-medium transition ${
                thinkingMode
                  ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm hover:from-violet-600 hover:to-fuchsia-600'
                  : 'bg-transparent text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Pensar</span>
            </button>
          )}
          <Textarea
            ref={taRef as any}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
            placeholder={thinkingMode ? `Pergunte com calma a ${memberName}, ele vai pensar...` : `Mensagem para ${memberName}...`}
            rows={1}
            className="flex-1 resize-none min-h-[36px] max-h-[200px] border-0 bg-transparent px-0 py-1 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none text-sm"
          />
          <Button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            size="sm"
            className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 w-9 p-0 rounded-xl shrink-0 disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-[10px] text-zinc-400 mt-1.5 px-2 text-center">
          {thinkingMode
            ? <span className="text-violet-500 dark:text-violet-400 font-medium">🧠 Modo Pensar ativo — o agente vai raciocinar antes de responder</span>
            : 'Enter para enviar · Shift+Enter para nova linha'}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Missions
// ============================================

function MissionsPanel({ member, onChanged }: { member: FleetMember; onChanged: () => void }) {
  const toast = useToast()
  const [missions, setMissions] = useState<FleetMission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { reload() }, [member.id])
  async function reload() {
    setLoading(true)
    try { setMissions(await fleetService.listMissions({ memberId: member.id })) } finally { setLoading(false) }
  }

  async function runNow(id: string) {
    try {
      await fleetService.runMission(id)
      toast.success('Missão disparada — veja em "Histórico"')
      reload()
      onChanged()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') }
  }

  async function toggle(m: FleetMission) {
    try {
      await fleetService.updateMission(m.id, { status: m.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } as any)
      reload()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') }
  }

  async function remove(id: string) {
    if (!confirm('Excluir missão?')) return
    try { await fleetService.deleteMission(id); reload() } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') }
  }

  if (loading) return <div className="p-6 text-center text-sm text-zinc-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  if (missions.length === 0) return <div className="p-6 text-center text-sm text-zinc-500">Nenhuma missão. Crie uma para automatizar tarefas recorrentes.</div>

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {missions.map(m => (
        <div key={m.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{m.title}</div>
              {m.description && <div className="text-xs text-zinc-500 truncate">{m.description}</div>}
            </div>
            <Badge className={STATUS_COLORS[m.status]} variant="outline">{m.status}</Badge>
          </div>
          <div className="text-xs text-zinc-500 mt-2 line-clamp-2">{m.instruction}</div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-500 flex-wrap">
            {m.cronExpr && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {m.cronNlOriginal || m.cronExpr}</span>}
            {m.nextRunAt && <span>próxima: {fmtDate(m.nextRunAt)}</span>}
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> {m.successRuns}</span>
            {m.failedRuns > 0 && <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" /> {m.failedRuns}</span>}
          </div>
          <div className="flex gap-1 mt-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => runNow(m.id)}>
              <Play className="w-3 h-3 mr-1" /> Executar agora
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toggle(m)}>
              {m.status === 'ACTIVE' ? <><Pause className="w-3 h-3 mr-1" /> Pausar</> : <><Play className="w-3 h-3 mr-1" /> Ativar</>}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-auto text-red-600" onClick={() => remove(m.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================
// Operations
// ============================================

function OperationsPanel({ member }: { member: FleetMember }) {
  const [ops, setOps] = useState<FleetOperation[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fleetService.listOperations({ memberId: member.id, limit: 50 })
      .then(setOps).finally(() => setLoading(false))
  }, [member.id])

  if (loading) return <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  if (ops.length === 0) return <div className="p-6 text-center text-sm text-zinc-500">Nenhuma execução ainda.</div>

  return (
    <div className="p-3 space-y-2">
      {ops.map(o => (
        <div key={o.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900">
          <div className="flex items-start gap-2">
            <Badge className={STATUS_COLORS[o.status]} variant="outline">{o.status}</Badge>
            <span className="text-xs text-zinc-500">{o.trigger}</span>
            <span className="text-xs text-zinc-400 ml-auto">{fmtRelative(o.createdAt)}</span>
          </div>
          {o.mission && <div className="text-xs text-violet-700 dark:text-violet-300 mt-1">Missão: {o.mission.title}</div>}
          <div className="text-xs text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-2">{o.instruction}</div>
          {(o.output || o.error) && (
            <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)} className="text-xs text-violet-600 mt-1 hover:underline">
              {expandedId === o.id ? 'Ocultar resposta' : 'Ver resposta'}
            </button>
          )}
          {expandedId === o.id && (
            <pre className="text-xs bg-zinc-50 dark:bg-zinc-950 rounded p-2 mt-2 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {o.error ? `❌ ${o.error}` : o.output}
            </pre>
          )}
          <div className="text-[10px] text-zinc-400 mt-2 flex gap-3">
            {o.durationMs != null && <span>{(o.durationMs / 1000).toFixed(1)}s</span>}
            {o.tokensOutput != null && <span>{(o.tokensInput || 0) + (o.tokensOutput || 0)} tokens</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================
// Modais
// ============================================

function CreateMemberModal({
  providers, departments, onClose, onCreated,
}: { providers: { id: string; name: string; type: string; model: string; isActive: boolean; enabledModels?: string[] }[]; departments: FleetDepartment[]; onClose: () => void; onCreated: (member?: FleetMember) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [displayRole, setDisplayRole] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [colorTag, setColorTag] = useState('#8b5cf6')
  const [saving, setSaving] = useState(false)

  const selectedProvider = providers.find(p => p.id === providerId)
  const modelOptions = selectedProvider?.enabledModels?.length ? selectedProvider.enabledModels : (selectedProvider ? [selectedProvider.model] : [])

  function onSelectProvider(id: string) {
    setProviderId(id)
    const p = providers.find(x => x.id === id)
    if (p && !model) setModel(p.model)
  }

  async function save() {
    if (!name || !displayRole || !providerId || !model) {
      toast.error('Preencha nome, cargo, provider e modelo')
      return
    }
    setSaving(true)
    try {
      const created = await fleetService.createMember({
        name,
        displayRole,
        providerId,
        model,
        departmentId: departmentId || null,
        emoji,
        colorTag,
      })
      toast.success(`${name} foi adicionado(a). Abrindo chat de configuração...`)
      onCreated(created)
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha ao criar') } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo membro da Fleet</DialogTitle>
          <p className="text-xs text-zinc-500">Após criar, o(a) novo(a) funcionário(a) vai conversar com você no chat para entender como deve trabalhar.</p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold mb-1 block">Nome *</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Carla, Pedro, Ana" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Cargo / Função *</label>
              <Input value={displayRole} onChange={e => setDisplayRole(e.target.value)} placeholder="Ex: SDR, Analista de Dados" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold mb-1 block">Provider AI *</label>
              <Select value={providerId} onValueChange={onSelectProvider}>
                <SelectTrigger><SelectValue placeholder="Selecione o provider..." /></SelectTrigger>
                <SelectContent>
                  {providers.filter(p => p.isActive).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-zinc-500 mt-1">Cadastre em /ai-providers</p>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Modelo *</label>
              {modelOptions.length > 1 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {modelOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o, claude-3-5-sonnet, etc" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="text-xs font-semibold mb-1 block">Setor</label>
              <Select value={departmentId || '__none__'} onValueChange={v => setDepartmentId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="(Opcional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Emoji</label>
              <Input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Cor</label>
              <Input type="color" value={colorTag} onChange={e => setColorTag(e.target.value)} className="h-9 p-1" />
            </div>
          </div>

          <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-3 text-xs text-violet-900 dark:text-violet-200">
            <strong>Como funciona:</strong> ao clicar em "Adicionar", o(a) {name || 'novo(a) membro'} abrirá uma conversa com você. Ele(a) vai se apresentar e perguntar quais são as responsabilidades, tom de voz, regras e exemplos. Conforme você responde, ele(a) configura a si mesmo(a) usando a ferramenta <code>configure_self</code>. Quando estiver tudo certo, basta dizer "está ótimo" ou "pode encerrar".
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar e abrir chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// AdvancedToolsModal — configura ferramentas HTTP customizadas para um membro
// (Estilo n8n: o admin define endpoints e o agente os chama via http_request)
// ============================================

type HTTPAuthType = 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header'
type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

interface HTTPParam {
  name: string
  in: 'path' | 'query' | 'body' | 'header'
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required: boolean
}

interface HTTPTool {
  name: string
  description: string
  method: HTTPMethod
  url: string
  auth?: {
    type: HTTPAuthType
    token?: string
    apiKey?: string
    apiKeyName?: string
    apiKeyPrefix?: string
    username?: string
    password?: string
    headerName?: string
    headerValue?: string
  }
  parameters?: HTTPParam[]
  headers?: Record<string, string>
  timeout?: number
}

function AdvancedToolsModal({
  member, onClose, onSaved,
}: { member: FleetMember; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()

  const initial: HTTPTool[] = useMemo(() => {
    const cfg = member.toolsConfig?.http_request
    if (Array.isArray(cfg)) return cfg as HTTPTool[]
    return []
  }, [member.toolsConfig])

  const initialFetch: { enabled: boolean; allowedDomains: string } = useMemo(() => {
    const cfg = member.toolsConfig?.http_fetch
    if (cfg && typeof cfg === 'object') {
      return {
        enabled: cfg.enabled === true,
        allowedDomains: Array.isArray(cfg.allowedDomains) ? cfg.allowedDomains.join('\n') : '',
      }
    }
    return { enabled: cfg === true, allowedDomains: '' }
  }, [member.toolsConfig])

  const initialUniversalCrm = useMemo(() => {
    const cfg = member.toolsConfig?.universal_crm
    if (cfg && typeof cfg === 'object') {
      return {
        enabled: cfg.enabled === true,
        allowMutate: cfg.allowMutate === true,
        allowedModels: Array.isArray(cfg.allowedModels) ? cfg.allowedModels.join('\n') : '',
      }
    }
    return { enabled: false, allowMutate: false, allowedModels: '' }
  }, [member.toolsConfig])

  const initialWorkspace = useMemo(() => {
    const cfg = member.toolsConfig?.ai_workspace
    if (cfg && typeof cfg === 'object') {
      return { enabled: cfg.enabled === true, allowWrite: cfg.allowWrite === true }
    }
    return { enabled: false, allowWrite: false }
  }, [member.toolsConfig])

  const [tools, setTools] = useState<HTTPTool[]>(initial)
  const [fetchEnabled, setFetchEnabled] = useState(initialFetch.enabled)
  const [fetchAllowedDomains, setFetchAllowedDomains] = useState(initialFetch.allowedDomains)
  const [universalCrmEnabled, setUniversalCrmEnabled] = useState(initialUniversalCrm.enabled)
  const [universalCrmMutate, setUniversalCrmMutate] = useState(initialUniversalCrm.allowMutate)
  const [universalCrmModels, setUniversalCrmModels] = useState(initialUniversalCrm.allowedModels)
  const [workspaceEnabled, setWorkspaceEnabled] = useState(initialWorkspace.enabled)
  const [workspaceWrite, setWorkspaceWrite] = useState(initialWorkspace.allowWrite)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  function addBlank() {
    setTools(prev => [...prev, {
      name: '',
      description: '',
      method: 'GET',
      url: '',
      auth: { type: 'none' },
      parameters: [],
      timeout: 30000,
    }])
    setEditingIdx(tools.length)
  }

  function update(i: number, patch: Partial<HTTPTool>) {
    setTools(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  function remove(i: number) {
    setTools(prev => prev.filter((_, idx) => idx !== i))
    if (editingIdx === i) setEditingIdx(null)
  }

  async function save() {
    // Validação básica
    for (const t of tools) {
      if (!t.name || !/^[a-z0-9_]+$/i.test(t.name)) {
        toast.error(`Nome inválido: "${t.name}". Use apenas letras, números e underscore.`)
        return
      }
      if (!t.description || t.description.length < 10) {
        toast.error(`Descrição muito curta em "${t.name}". Explique pra IA quando usar.`)
        return
      }
      if (!t.url || !/^https?:\/\//.test(t.url)) {
        toast.error(`URL inválida em "${t.name}".`)
        return
      }
    }
    setSaving(true)
    try {
      const allowedDomainsList = fetchAllowedDomains
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean)
      const allowedModelsList = universalCrmModels
        .split(/[\n,]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
      const newToolsConfig = {
        ...(member.toolsConfig || {}),
        http_request: tools,
        http_fetch: {
          enabled: fetchEnabled,
          ...(allowedDomainsList.length > 0 ? { allowedDomains: allowedDomainsList } : {}),
        },
        universal_crm: {
          enabled: universalCrmEnabled,
          allowMutate: universalCrmMutate,
          ...(allowedModelsList.length > 0 ? { allowedModels: allowedModelsList } : {}),
        },
        ai_workspace: {
          enabled: workspaceEnabled,
          allowWrite: workspaceWrite,
        },
      }
      await fleetService.updateMember(member.id, { toolsConfig: newToolsConfig } as any)
      toast.success('Configurações salvas')
      onSaved()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-violet-600" />
            Ferramentas HTTP — {member.name}
          </DialogTitle>
          <p className="text-xs text-zinc-500">
            Defina endpoints HTTP customizados (estilo n8n). O agente poderá chamá-los como ferramentas durante a conversa. Útil pra integrar com APIs externas (GitHub, Notion, Slack, ERP, etc).
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {/* HTTP Fetch genérico (URL livre) */}
          <div className={`rounded-lg border p-3 ${fetchEnabled ? 'border-violet-300 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={fetchEnabled}
                onChange={e => setFetchEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold">HTTP Fetch genérico (URL livre)</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  Permite que o agente chame <strong>qualquer URL pública</strong> em runtime (GET/POST/PUT/PATCH/DELETE/HEAD), sem precisar pré-configurar cada endpoint. Útil pra testar webhooks ou consultar APIs ad-hoc. SSRF protegido (bloqueia IPs internos).
                </p>
              </div>
            </label>
            {fetchEnabled && (
              <div className="mt-3 pl-7">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Domínios permitidos (allowlist) <span className="text-zinc-400 font-normal">— opcional, um por linha</span>
                </label>
                <textarea
                  value={fetchAllowedDomains}
                  onChange={e => setFetchAllowedDomains(e.target.value)}
                  rows={3}
                  placeholder={'api.exemplo.com\nnbilder.blackatende.com\ngithub.com'}
                  className="w-full text-xs font-mono rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Se vazio, o agente pode chamar qualquer domínio público. Para restringir, liste os domínios permitidos.
                </p>
              </div>
            )}
          </div>

          {/* Universal CRM access (super-tool) */}
          <div className={`rounded-lg border p-3 ${universalCrmEnabled ? 'border-violet-300 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={universalCrmEnabled}
                onChange={e => setUniversalCrmEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold">Acesso Universal ao CRM</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  Libera as super-tools <code className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">crm_query</code> e <code className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">crm_list_models</code> para que a IA leia QUALQUER entidade do CRM (propostas, contratos, faturas, projetos, tarefas, contatos, etc) — sem precisar de tool dedicada por entidade. Filtra automaticamente por empresa e remove campos sensíveis (senhas, tokens).
                </p>
              </div>
            </label>
            {universalCrmEnabled && (
              <div className="mt-3 pl-7 space-y-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={universalCrmMutate}
                    onChange={e => setUniversalCrmMutate(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-red-700 dark:text-red-400">Permitir escrita (crm_mutate)</span>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      ⚠️ Libera <code className="font-mono">create</code>, <code className="font-mono">update</code> e <code className="font-mono">delete</code>. Toda alteração é registrada em AuditLog. Use APENAS para agentes de confiança. Modelos críticos (faturas, pagamentos, contratos) ainda devem ter tools dedicadas com validações próprias.
                    </p>
                  </div>
                </label>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Modelos permitidos <span className="text-zinc-400 font-normal">— opcional, um por linha. Vazio = todos.</span>
                  </label>
                  <textarea
                    value={universalCrmModels}
                    onChange={e => setUniversalCrmModels(e.target.value)}
                    rows={3}
                    placeholder={'invoice\nproposal\ncontact\nproject\ntask'}
                    className="w-full text-xs font-mono rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    A IA pode usar <code className="font-mono">crm_list_models</code> para descobrir os nomes disponíveis.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* AI Workspace (filesystem sandbox) */}
          <div className={`rounded-lg border p-3 ${workspaceEnabled ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={workspaceEnabled}
                onChange={e => setWorkspaceEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold">Workspace da IA (Filesystem isolado)</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  Cria uma "oficina" isolada em <code className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/app/ai-workspace/&lt;empresa&gt;/</code> onde a IA pode criar landing pages, configs sugeridas, templates e mini-apps. <strong>NÃO toca no código de produção.</strong> Arquivos podem ser servidos publicamente em <code className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/ai-workspace/&lt;empresa&gt;/&lt;arquivo&gt;</code>.
                </p>
              </div>
            </label>
            {workspaceEnabled && (
              <div className="mt-3 pl-7">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={workspaceWrite}
                    onChange={e => setWorkspaceWrite(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <span className="text-xs font-semibold">Permitir escrita (write/delete/move)</span>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      Sem isso, a IA só lê arquivos do workspace. Com isso, pode criar/editar/remover. Extensões executáveis (<code className="font-mono">.sh</code>, <code className="font-mono">.exe</code>, etc) são bloqueadas. Limite: 5MB/arquivo, 200MB/empresa.
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Endpoints HTTP fixos (estilo n8n)</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          </div>

          {tools.length === 0 && (
            <div className="text-center py-8 px-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
              <p className="text-sm text-zinc-500 mb-3">
                Nenhuma ferramenta HTTP configurada ainda.
              </p>
              <Button onClick={addBlank} size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
                <Plus className="w-4 h-4 mr-1" /> Adicionar primeira ferramenta
              </Button>
            </div>
          )}

          {tools.map((t, i) => (
            <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  t.method === 'GET' ? 'bg-blue-100 text-blue-700' :
                  t.method === 'POST' ? 'bg-emerald-100 text-emerald-700' :
                  t.method === 'DELETE' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>{t.method}</span>
                <span className="text-sm font-mono font-semibold flex-1 min-w-0 truncate">{t.name || '(sem nome)'}</span>
                <span className="text-xs text-zinc-500 truncate hidden sm:block max-w-xs">{t.url}</span>
                <button onClick={() => setEditingIdx(editingIdx === i ? null : i)} className="text-xs text-violet-600 hover:underline">
                  {editingIdx === i ? 'Recolher' : 'Editar'}
                </button>
                <button onClick={() => remove(i)} className="text-zinc-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {editingIdx === i && (
                <div className="p-3 space-y-3 bg-white dark:bg-zinc-950">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-1">
                      <label className="text-xs font-semibold block mb-1">Método</label>
                      <Select value={t.method} onValueChange={(v) => update(i, { method: v as HTTPMethod })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['GET','POST','PUT','PATCH','DELETE','HEAD'] as HTTPMethod[]).map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold block mb-1">Nome da ferramenta *</label>
                      <Input
                        value={t.name}
                        onChange={e => update(i, { name: e.target.value })}
                        placeholder="github_list_issues"
                      />
                      <p className="text-[10px] text-zinc-500 mt-0.5">Apenas letras/números/_. A IA usa esse nome ao chamar.</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold block mb-1">URL *</label>
                    <Input
                      value={t.url}
                      onChange={e => update(i, { url: e.target.value })}
                      placeholder="https://api.github.com/repos/{owner}/{repo}/issues"
                      className="font-mono text-sm"
                    />
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      Use <code>{'{nome}'}</code> para parâmetros que a IA preenche. URLs privadas/locais são bloqueadas (SSRF).
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold block mb-1">Descrição (pra IA) *</label>
                    <Textarea
                      value={t.description}
                      onChange={e => update(i, { description: e.target.value })}
                      rows={2}
                      placeholder="Lista as issues abertas de um repositório do GitHub. Use quando o admin pedir issues."
                    />
                  </div>

                  <div className="border-t pt-3">
                    <label className="text-xs font-semibold block mb-1">Autenticação</label>
                    <Select
                      value={t.auth?.type || 'none'}
                      onValueChange={(v) => update(i, { auth: { ...(t.auth || {}), type: v as HTTPAuthType } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="api_key_header">API Key (header)</SelectItem>
                        <SelectItem value="api_key_query">API Key (query)</SelectItem>
                        <SelectItem value="basic">Basic (user:pass)</SelectItem>
                        <SelectItem value="custom_header">Header customizado</SelectItem>
                      </SelectContent>
                    </Select>

                    {t.auth?.type === 'bearer' && (
                      <Input
                        type="password"
                        value={t.auth.token || ''}
                        onChange={e => update(i, { auth: { ...t.auth!, token: e.target.value } })}
                        placeholder="Token (será enviado como Authorization: Bearer ...)"
                        className="mt-2"
                      />
                    )}
                    {(t.auth?.type === 'api_key_header' || t.auth?.type === 'api_key_query') && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Input
                          value={t.auth.apiKeyName || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, apiKeyName: e.target.value } })}
                          placeholder={t.auth?.type === 'api_key_header' ? 'X-API-Key' : 'api_key'}
                        />
                        <Input
                          type="password"
                          value={t.auth.apiKey || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, apiKey: e.target.value } })}
                          placeholder="Valor da chave"
                        />
                      </div>
                    )}
                    {t.auth?.type === 'basic' && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Input
                          value={t.auth.username || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, username: e.target.value } })}
                          placeholder="Usuário"
                        />
                        <Input
                          type="password"
                          value={t.auth.password || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, password: e.target.value } })}
                          placeholder="Senha"
                        />
                      </div>
                    )}
                    {t.auth?.type === 'custom_header' && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Input
                          value={t.auth.headerName || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, headerName: e.target.value } })}
                          placeholder="X-Custom-Auth"
                        />
                        <Input
                          type="password"
                          value={t.auth.headerValue || ''}
                          onChange={e => update(i, { auth: { ...t.auth!, headerValue: e.target.value } })}
                          placeholder="Valor"
                        />
                      </div>
                    )}
                  </div>

                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold">Parâmetros (a IA preenche)</label>
                      <button
                        onClick={() => update(i, { parameters: [...(t.parameters || []), { name: '', in: 'query', type: 'string', description: '', required: false }] })}
                        className="text-xs text-violet-600 hover:underline"
                      >
                        + Adicionar
                      </button>
                    </div>
                    {(t.parameters || []).length === 0 && (
                      <p className="text-xs text-zinc-500 italic">Nenhum parâmetro. A IA chama o endpoint sem inputs.</p>
                    )}
                    {(t.parameters || []).map((p, pi) => (
                      <div key={pi} className="grid grid-cols-12 gap-1 mb-1.5 items-center">
                        <Input
                          className="col-span-3 h-8 text-xs"
                          value={p.name}
                          onChange={e => {
                            const arr = [...(t.parameters || [])]
                            arr[pi] = { ...p, name: e.target.value }
                            update(i, { parameters: arr })
                          }}
                          placeholder="nome"
                        />
                        <Select
                          value={p.in}
                          onValueChange={(v) => {
                            const arr = [...(t.parameters || [])]
                            arr[pi] = { ...p, in: v as HTTPParam['in'] }
                            update(i, { parameters: arr })
                          }}
                        >
                          <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="query">query</SelectItem>
                            <SelectItem value="path">path</SelectItem>
                            <SelectItem value="body">body</SelectItem>
                            <SelectItem value="header">header</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={p.type}
                          onValueChange={(v) => {
                            const arr = [...(t.parameters || [])]
                            arr[pi] = { ...p, type: v as HTTPParam['type'] }
                            update(i, { parameters: arr })
                          }}
                        >
                          <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string">string</SelectItem>
                            <SelectItem value="number">number</SelectItem>
                            <SelectItem value="boolean">boolean</SelectItem>
                            <SelectItem value="object">object</SelectItem>
                            <SelectItem value="array">array</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="col-span-4 h-8 text-xs"
                          value={p.description}
                          onChange={e => {
                            const arr = [...(t.parameters || [])]
                            arr[pi] = { ...p, description: e.target.value }
                            update(i, { parameters: arr })
                          }}
                          placeholder="descrição (pra IA)"
                        />
                        <button
                          onClick={() => {
                            const arr = (t.parameters || []).filter((_, x) => x !== pi)
                            update(i, { parameters: arr })
                          }}
                          className="col-span-1 text-zinc-400 hover:text-red-600 flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold block mb-1">Timeout (ms)</label>
                      <Input
                        type="number"
                        value={t.timeout || 30000}
                        onChange={e => update(i, { timeout: parseInt(e.target.value) || 30000 })}
                        min={1000}
                        max={120000}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {tools.length > 0 && (
            <Button onClick={addBlank} variant="outline" size="sm" className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Adicionar mais uma ferramenta
            </Button>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
            <strong>⚠️ Segurança:</strong> URLs apontando para localhost, IPs privados (10.x, 192.168.x, 172.16.x), <code>169.254.169.254</code> (metadados de cloud) e <code>.local/.internal</code> são bloqueadas automaticamente. Credenciais ficam armazenadas criptografadas.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateDepartmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [color, setColor] = useState('#8b5cf6')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name) return
    setSaving(true)
    try {
      await fleetService.createDepartment({ name, icon, color } as any)
      toast.success('Setor criado')
      onCreated()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Novo setor</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold mb-1 block">Nome</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Comercial" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold mb-1 block">Emoji</label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="💼" maxLength={4} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Cor</label>
              <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 p-1" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateMissionModal({
  member, onClose, onCreated,
}: { member: FleetMember; onClose: () => void; onCreated: () => void }) {
  const missionTimezone = 'America/Sao_Paulo'
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [cronNl, setCronNl] = useState('')
  const [scheduleType, setScheduleType] = useState<'recurring' | 'once' | 'manual'>('recurring')
  const [runOnceAt, setRunOnceAt] = useState('')
  const [executionMode, setExecutionMode] = useState<'AUTONOMOUS' | 'REQUIRE_APPROVAL'>('AUTONOMOUS')
  const [preview, setPreview] = useState<CronPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  async function doPreview() {
    if (!cronNl.trim()) return
    setPreviewing(true)
    try { setPreview(await fleetService.previewCron({ nl: cronNl, count: 5, cronTimezone: missionTimezone })) }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Não consegui interpretar') }
    finally { setPreviewing(false) }
  }

  async function save() {
    if (!title || !instruction) { toast.error('Título e instrução são obrigatórios'); return }
    setSaving(true)
    try {
      await fleetService.createMission({
        memberId: member.id,
        title,
        description: description || undefined,
        instruction,
        cronNl: scheduleType === 'recurring' && cronNl ? cronNl : undefined,
        cronTimezone: scheduleType !== 'manual' ? missionTimezone : undefined,
        runOnceAt: scheduleType === 'once' && runOnceAt ? new Date(runOnceAt).toISOString() : undefined,
        executionMode,
      })
      toast.success('Missão criada')
      onCreated()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha') } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova missão para {member.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-semibold mb-1 block">Título</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Resumo diário de leads" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block">Descrição (opcional)</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block">Instrução para o membro</label>
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              rows={4}
              placeholder='Ex: "Liste todos os leads criados nas últimas 24h e me notifique com um resumo dos 3 mais quentes"'
            />
          </div>

          <div className="border-t pt-3">
            <label className="text-xs font-semibold mb-1 block">Quando executar?</label>
            <div className="flex gap-2 mb-2">
              {(['recurring', 'once', 'manual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setScheduleType(t)}
                  className={`px-3 py-1.5 rounded text-xs ${scheduleType === t ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'}`}
                >
                  {t === 'recurring' ? 'Recorrente' : t === 'once' ? 'Uma vez' : 'Manual'}
                </button>
              ))}
            </div>

            {scheduleType === 'recurring' && (
              <div>
                <Input
                  value={cronNl}
                  onChange={e => setCronNl(e.target.value)}
                  onBlur={doPreview}
                  placeholder='Ex: "todo dia às 9h", "a cada 30 minutos", "toda segunda às 8h"'
                />
                {previewing && <div className="text-xs text-zinc-500 mt-1"><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> calculando...</div>}
                {preview && (
                  <div className="mt-2 p-2 rounded bg-violet-50 dark:bg-violet-900/20 text-xs">
                    <div className="font-semibold text-violet-900 dark:text-violet-100">{preview.description}</div>
                    <div className="text-zinc-600 dark:text-zinc-400 mt-1">cron: <code>{preview.cronExpr}</code></div>
                    <div className="text-zinc-600 dark:text-zinc-400 mt-1">Próximas execuções:</div>
                    <ul className="list-disc list-inside text-zinc-700 dark:text-zinc-300">
                      {preview.nextRuns.map(d => <li key={d}>{fmtDate(d)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {scheduleType === 'once' && (
              <Input type="datetime-local" value={runOnceAt} onChange={e => setRunOnceAt(e.target.value)} />
            )}

            {scheduleType === 'manual' && (
              <div className="text-xs text-zinc-500">Executada apenas quando você clicar em "Executar agora".</div>
            )}
          </div>

          <div className="border-t pt-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Modo de execução</div>
              <div className="text-[11px] text-zinc-500">{executionMode === 'AUTONOMOUS' ? 'Executa direto, sem aprovação' : 'Pede aprovação antes de agir'}</div>
            </div>
            <Switch
              checked={executionMode === 'AUTONOMOUS'}
              onCheckedChange={v => setExecutionMode(v ? 'AUTONOMOUS' : 'REQUIRE_APPROVAL')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar missão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Builder Modal — criação conversacional do membro
// ============================================

function BuilderModal({
  providers, departments, onClose, onCreated,
}: {
  providers: { id: string; name: string; type: string; model: string; isActive: boolean; enabledModels?: string[] }[]
  departments: FleetDepartment[]
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [providerId, setProviderId] = useState(providers.find(p => p.isActive)?.id || '')
  const [model, setModel] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [config, setConfig] = useState<BuilderProposedConfig | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [started, setStarted] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const selectedProvider = providers.find(p => p.id === providerId)
  const modelOptions = selectedProvider?.enabledModels?.length ? selectedProvider.enabledModels : (selectedProvider ? [selectedProvider.model] : [])
  const effectiveModel = model || selectedProvider?.model || ''

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function onSelectProvider(id: string) {
    setProviderId(id)
    const p = providers.find(x => x.id === id)
    if (p) setModel(p.model)
  }

  async function start() {
    if (!providerId) { toast.error('Selecione um provider primeiro'); return }
    setSending(true)
    try {
      const res = await fleetService.builderChat({
        providerId,
        model: effectiveModel,
        messages: [],
        currentConfig: null,
      })
      setMessages([{ role: 'assistant', content: res.reply }])
      setConfig(res.mergedConfig)
      setIsComplete(res.isComplete)
      setStarted(true)
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha ao iniciar') } finally { setSending(false) }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const newMsgs: { role: 'user' | 'assistant'; content: string }[] = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs)
    setInput('')
    setSending(true)
    try {
      const res = await fleetService.builderChat({
        providerId,
        model: effectiveModel,
        messages: newMsgs,
        currentConfig: config,
      })
      setMessages([...newMsgs, { role: 'assistant', content: res.reply }])
      setConfig(res.mergedConfig)
      setIsComplete(res.isComplete)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha no chat')
      setMessages(newMsgs)
    } finally { setSending(false) }
  }

  async function create() {
    if (!config?.name || !config?.displayRole || !config?.systemPrompt) {
      toast.error('Configuração incompleta')
      return
    }
    setCreating(true)
    try {
      await fleetService.builderCreate({
        providerId,
        model: effectiveModel,
        config: {
          name: config.name,
          displayRole: config.displayRole,
          systemPrompt: config.systemPrompt,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          suggestedTools: config.suggestedTools,
          emoji: config.emoji,
          colorTag: config.colorTag,
        },
        departmentId: departmentId || null,
      })
      toast.success(`Membro "${config.name}" criado!`)
      onCreated()
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Falha ao criar') } finally { setCreating(false) }
  }

  const minOk = !!(config?.name && config?.displayRole && config?.systemPrompt)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-violet-600" />
            Criar funcionário com IA
          </DialogTitle>
          <p className="text-xs text-zinc-500">Converse com o designer e ele monta o funcionário pra você</p>
        </DialogHeader>

        {!started ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-md w-full space-y-4">
              <div className="text-center mb-6">
                <Wand2 className="w-12 h-12 mx-auto text-violet-500 mb-2" />
                <h3 className="text-lg font-semibold">Antes de começar</h3>
                <p className="text-sm text-zinc-500">Escolha qual IA vai me ajudar a desenhar seu funcionário</p>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Provider AI</label>
                <Select value={providerId} onValueChange={onSelectProvider}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {providers.filter(p => p.isActive).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Modelo</label>
                {modelOptions.length > 1 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {modelOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={model} onChange={e => setModel(e.target.value)} placeholder={selectedProvider?.model || 'gpt-4o'} />
                )}
              </div>
              <Button onClick={start} disabled={!providerId || sending} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Começar conversa <Send className="w-4 h-4 ml-2" /></>}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-5 min-h-0">
            <div className="col-span-3 flex flex-col border-r min-h-0">
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> pensando...
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t p-3 flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Sua resposta..."
                  disabled={sending}
                />
                <Button onClick={send} disabled={!input.trim() || sending} className="bg-violet-600 hover:bg-violet-700 text-white">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="col-span-2 flex flex-col bg-zinc-50 dark:bg-zinc-900/50 min-h-0">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold">Pré-visualização</span>
                </div>
                {isComplete && minOk && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30" variant="outline">
                    Pronto
                  </Badge>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
                {!config && (
                  <p className="text-xs text-zinc-500 italic">Conforme a conversa avança, a configuração aparece aqui...</p>
                )}
                {config && (
                  <>
                    <div className="flex items-center gap-3 pb-3 border-b">
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                        style={{ background: config.colorTag ? `${config.colorTag}20` : '#8b5cf620' }}
                      >
                        {config.emoji || '🤖'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{config.name || <span className="text-zinc-400">(sem nome)</span>}</div>
                        <div className="text-xs text-zinc-500 truncate">{config.displayRole || <span className="text-zinc-400">(sem cargo)</span>}</div>
                      </div>
                    </div>

                    {config.systemPrompt && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-zinc-500 mb-1">Personalidade</div>
                        <div className="text-xs bg-white dark:bg-zinc-900 border rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                          {config.systemPrompt}
                        </div>
                      </div>
                    )}

                    {config.suggestedTools && config.suggestedTools.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-zinc-500 mb-1">Ferramentas ({config.suggestedTools.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {config.suggestedTools.map(t => (
                            <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {config.temperature !== undefined && (
                        <div className="bg-white dark:bg-zinc-900 border rounded p-2">
                          <div className="text-[10px] text-zinc-500">Temperature</div>
                          <div className="font-semibold">{config.temperature}</div>
                        </div>
                      )}
                      {config.maxTokens !== undefined && (
                        <div className="bg-white dark:bg-zinc-900 border rounded p-2">
                          <div className="text-[10px] text-zinc-500">Max tokens</div>
                          <div className="font-semibold">{config.maxTokens}</div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold uppercase text-zinc-500 mb-1 block">Setor (opcional)</label>
                      <Select value={departmentId || '__none__'} onValueChange={v => setDepartmentId(v === '__none__' ? '' : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Nenhum</SelectItem>
                          {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
              <div className="border-t p-3">
                <Button
                  onClick={create}
                  disabled={!minOk || creating}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <><CheckCircle2 className="w-4 h-4 mr-2" /> {isComplete ? 'Criar funcionário' : 'Criar mesmo assim'}</>
                  )}
                </Button>
                {!minOk && (
                  <p className="text-[10px] text-zinc-500 text-center mt-2">Continue a conversa para definir nome, cargo e personalidade</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default Fleet
