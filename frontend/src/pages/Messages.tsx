import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/usePermissions'
import {
  Send,
  Search,
  Loader2,
  MessageSquare,
  Image,
  Video,
  Mic,
  FileText,
  Check,
  Clock,
  AlertCircle,
  Smile,
  Paperclip,
  ArrowDown,
  ArrowUp,
  Users,
  Phone,
  X,
  Play,
  Square,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Info,
  Shield,
  Star,
  ZoomIn,
  ZoomOut,
  Tag,
  UserPlus,
  CircleDot,
  Hash,
  ChevronDown,
  Filter,
  MessageCircle,
  Megaphone,
  RefreshCw,
  Pencil,
  Mail,
  Globe,
  Calendar,
  Link2,
  CheckSquare,
  Type,
  Lock,
  StickyNote,
  Bot,
  User,
  MousePointerClick,
  Kanban,
  ExternalLink,
  RotateCcw,
  CalendarClock,
  Pause,
  Plus,
  MoreVertical,
  CheckCircle2,
  Archive,
  MessageSquarePlus,
  Target,
  Building2,
  ArrowRight,
  Flame,
  Snowflake,
  Pin,
  PinOff,
  BookPlus,
  Briefcase,
} from 'lucide-react'
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import api from '@/services/api'
import { leadService, customerAccountService } from '@/services/commercial'
import { getSocket, connectSocket, joinInstance } from '@/services/socket'
import type { Instance, Message } from '@/types'
import InteractiveComposer from '@/components/InteractiveComposer'
import { useToast } from '@/components/ui/Toast'
import InteractiveMessageBubble from '@/components/InteractiveMessageBubble'
import CreateFAQFromMessageModal from '@/components/messages/CreateFAQFromMessageModal'
import AddToPipelineModal from '@/components/AddToPipelineModal'
import NewConversationDialog from '@/components/NewConversationDialog'
import { getCardsByConversation } from '@/services/pipeline.service'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const BACKEND_URL = import.meta.env.VITE_API_URL || ''

function getAuthToken(): string {
  try {
    const raw = localStorage.getItem('auth-storage')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed?.state?.token || ''
    }
  } catch { /* ignore */ }
  return ''
}

function linkifyText(text: string): any {
  if (!text) return text
  const urlPattern = /(https?:\/\/[^\s<>"']+)/g
  const parts = text.split(urlPattern)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline hover:text-blue-600 break-all">{part}</a>
    ) : part
  )
}

function getMediaDisplayUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('http://host.docker.internal')) {
    url = url.replace(/https?:\/\/host\.docker\.internal:\d+/, BACKEND_URL)
  }
  // Relative paths like /uploads/xxx — cookie sent automatically via withCredentials
  if (url.startsWith('/uploads/')) {
    return BACKEND_URL ? `${BACKEND_URL}${url}` : url
  }
  return url
}

interface ConversationLabel {
  id: string
  title: string
  color: string
}

interface Conversation {
  conversationId: string
  remoteJid: string
  status: string
  priority: string | null
  assigneeId: string | null
  teamId: string | null
  assigneeName: string | null
  teamName: string | null
  lastMessage: string
  lastMessageType: string
  lastDirection: 'INBOUND' | 'OUTBOUND'
  lastMessageAt: string
  contactName: string | null
  profilePicture: string | null
  unreadCount: number
  labels: ConversationLabel[]
  metadata?: any
  aiSessionStatus?: string
  aiAgentName?: string
}

// ── Helpers ──────────────────────────────────────────
function formatPhone(jid: string) {
  if (!jid) return ''
  if (jid.includes('@g.us')) {
    const num = jid.replace('@g.us', '')
    return `Grupo ${num.slice(-8)}`
  }
  if (jid.includes('@newsletter')) {
    const num = jid.replace('@newsletter', '')
    return `Canal ${num.slice(-8)}`
  }
  if (jid.includes('@broadcast')) {
    return 'Status/Broadcast'
  }
  const clean = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '')
  if (clean.length === 13) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  if (clean.length === 12) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`
  return clean
}

function getInitials(name: string | null, jid: string) {
  if (name) {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  }
  const clean = jid.replace(/@.*/, '').replace(/\D/g, '')
  return clean.slice(-2)
}

function formatMessageTime(dateStr: string) {
  const d = new Date(dateStr)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ontem'
  return format(d, 'dd/MM/yyyy')
}

function formatChatTime(dateStr: string) {
  return format(new Date(dateStr), 'HH:mm')
}

function formatDateSeparator(dateStr: string) {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Hoje'
  if (isYesterday(d)) return 'Ontem'
  return format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function isSameDay(d1: string, d2: string) {
  const a = new Date(d1), b = new Date(d2)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const AVATAR_COLORS = [
  'bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-orange-600',
]

// Cores para nomes de participantes em grupos (estilo WhatsApp)
const SENDER_NAME_COLORS = [
  '#00a884', '#53bdeb', '#e068c8', '#fc9b41',
  '#7f66ff', '#e74c3c', '#d4a017', '#06d6a0',
  '#ff6b6b', '#51cf66', '#339af0', '#9b59b6',
  '#ff922b', '#20c997', '#748ffc', '#e84393',
]

function senderNameColor(phone: string) {
  let hash = 0
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash)
  return SENDER_NAME_COLORS[Math.abs(hash) % SENDER_NAME_COLORS.length]
}

function avatarColor(jid: string) {
  let hash = 0
  for (let i = 0; i < jid.length; i++) hash = jid.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function lastMsgPreview(conv: Conversation) {
  const prefix = conv.lastDirection === 'OUTBOUND' ? 'Você: ' :
    ((conv.remoteJid.includes('@g.us') || conv.remoteJid.includes('@newsletter')) && conv.metadata?.senderName) ? `${conv.metadata.senderName}: ` : ''
  if (conv.lastMessageType === 'note') return `🔒 Nota privada`
  if (conv.lastMessageType === 'image') return `${prefix}📷 Foto`
  if (conv.lastMessageType === 'video') return `${prefix}🎥 Vídeo`
  if (conv.lastMessageType === 'audio') return `${prefix}🎵 Áudio`
  if (conv.lastMessageType === 'document') return `${prefix}📄 Documento`
  if (conv.lastMessageType === 'sticker') return `${prefix}🏷️ Sticker`
  if (conv.lastMessageType === 'location') return `${prefix}📍 Localização`
  if (conv.lastMessageType === 'contact') return `${prefix}👤 Contato`
  return `${prefix}${truncate(conv.lastMessage || '', 45)}`
}

function MessageStatus({ status }: { status: string }) {
  switch (status) {
    case 'PENDING': return <span title="Enviando..."><Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" /></span>
    case 'SENT': return <span title="Mensagem enviada"><Check className="h-3.5 w-3.5 text-gray-400 shrink-0" /></span>
    case 'DELIVERED': return <span title="Mensagem enviada"><Check className="h-3.5 w-3.5 text-gray-400 shrink-0" /></span>
    case 'READ': return <span title="Mensagem enviada"><Check className="h-3.5 w-3.5 text-gray-400 shrink-0" /></span>
    case 'FAILED': return <span title="Falha no envio"><AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" /></span>
    default: return null
  }
}

function MessageTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'image': return <Image className="h-3.5 w-3.5 mr-1 text-gray-400" />
    case 'video': return <Video className="h-3.5 w-3.5 mr-1 text-gray-400" />
    case 'audio': return <Mic className="h-3.5 w-3.5 mr-1 text-gray-400" />
    case 'document': return <FileText className="h-3.5 w-3.5 mr-1 text-gray-400" />
    case 'sticker': return <span className="mr-1 text-gray-400 text-xs">🏷️</span>
    default: return null
  }
}

// ── Main Component ───────────────────────────────────
export function Messages() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { can } = usePermissions()
  const [searchParams, setSearchParams] = useSearchParams()
  const canReply = can('conversations:reply')
  const canAssign = can('conversations:assign')
  const canManage = can('conversations:manage')
  const [selectedInstance, setSelectedInstance] = useState<string>('')
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [messageText, setMessageText] = useState('')
  const [sending, setSending] = useState(false)
  const [isNoteMode, setIsNoteMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [fileAccept, setFileAccept] = useState('*/*')
  const [fileMType, setFileMType] = useState<'image' | 'video' | 'audio' | 'document'>('document')
  // Media preview before send
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'audio' | 'document'>('image')
  const [captionText, setCaptionText] = useState('')
  // Audio recording
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  // Interactive composer
  const [showInteractiveComposer, setShowInteractiveComposer] = useState(false)
  const [sendingInteractive, setSendingInteractive] = useState(false)
  // Schedule message from chat
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    scheduledAt: '',
    name: '',
    recurrence: 'ONCE' as 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY',
    content: '',
    caption: '',
  })
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleFiles, setScheduleFiles] = useState<File[]>([])
  // Pause/resume recording
  const [isPaused, setIsPaused] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Audio transcription
  const [transcribing, setTranscribing] = useState<string | null>(null) // messageId being transcribed
  const [transcriptions, setTranscriptions] = useState<Record<string, { text: string; provider?: string; costUsd?: number }>>({})
  // AI session state
  const [aiStatus, setAiStatus] = useState<{ active: boolean; sessionId: string | null; agentName: string | null; status: string | null } | null>(null)
  const [togglingAI, setTogglingAI] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  // Older messages pagination (infinite scroll up)
  const [olderMessages, setOlderMessages] = useState<Message[]>([])
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const preserveScrollHeightRef = useRef<number | null>(null)
  // AI memory toasts ("Memória atualizada" style)
  const [memoryToasts, setMemoryToasts] = useState<Array<{ id: string; label: string; detail: string; agentName: string }>>([])
  // Auto-dismiss memory toasts after 6s
  useEffect(() => {
    if (memoryToasts.length === 0) return
    const t = setTimeout(() => setMemoryToasts(prev => prev.slice(1)), 6000)
    return () => clearTimeout(t)
  }, [memoryToasts])
  // Unread messages scroll
  const unreadCountOnOpenRef = useRef<number>(0)
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const chatJustOpenedRef = useRef(false)
  // Pending scroll to quoted message after cross-chat navigation
  const pendingScrollToStanzaRef = useRef<string | null>(null)
  // Media lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string>('')
  const [lightboxType, setLightboxType] = useState<'image' | 'video'>('image')
  // In-chat message search
  const [showChatSearch, setShowChatSearch] = useState(false)
  const [chatSearchTerm, setChatSearchTerm] = useState('')
  const [chatSearchResults, setChatSearchResults] = useState<number[]>([])
  const [chatSearchIndex, setChatSearchIndex] = useState(-1)
  const chatSearchInputRef = useRef<HTMLInputElement>(null)
  // Contact info panel
  const [showContactInfo, setShowContactInfo] = useState(false)
  const [contactInfoData, setContactInfoData] = useState<any>(null)
  const [loadingContactInfo, setLoadingContactInfo] = useState(false)
  // Notes history panel
  const [contactNotes, setContactNotes] = useState<Message[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [showNotesPanel, setShowNotesPanel] = useState(false)
  // Contact inline editing
  const [editingContactField, setEditingContactField] = useState<string | null>(null)
  const [editingContactValue, setEditingContactValue] = useState('')
  const [savingContactField, setSavingContactField] = useState(false)
  const [editingContactTags, setEditingContactTags] = useState('')
  const [showCustomAttrEditor, setShowCustomAttrEditor] = useState<string | null>(null)
  const [customAttrEditValue, setCustomAttrEditValue] = useState<any>('')
  // Pipeline modal
  const [showPipelineModal, setShowPipelineModal] = useState(false)
  // New conversation dialog
  const [showNewConversation, setShowNewConversation] = useState(false)
  // Context menu for conversations
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conv: any } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<any | null>(null)
  // CRM filters & panels
  const [statusFilter, setStatusFilter] = useState<string>('OPEN')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL')
  const [typeFilter, setTypeFilter] = useState<string>('DIRECT')
  const [labelFilter, setLabelFilter] = useState<string>('')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [showLabelFilterDD, setShowLabelFilterDD] = useState(false)
  const [showAssigneeFilterDD, setShowAssigneeFilterDD] = useState(false)
  const filterDropdownRef = useRef<HTMLDivElement>(null)
  const labelFilterRef = useRef<HTMLDivElement>(null)
  const assigneeFilterRef = useRef<HTMLDivElement>(null)
  // Canned responses autocomplete
  const [showCannedMenu, setShowCannedMenu] = useState(false)
  const [cannedSearch, setCannedSearch] = useState('')
  const [cannedIndex, setCannedIndex] = useState(0)
  // CRM dropdowns in header/detail
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const [showAssignDropdown, setShowAssignDropdown] = useState(false)
  const [showTeamDropdown, setShowTeamDropdown] = useState(false)
  const [showLabelDropdown, setShowLabelDropdown] = useState(false)
  const [showAiAgentDropdown, setShowAiAgentDropdown] = useState(false)
  const [faqModal, setFaqModal] = useState<{ question: string; answer: string } | null>(null)
  const [showHeaderMenu, setShowHeaderMenu] = useState(false)
  const [headerMenuSub, setHeaderMenuSub] = useState<'agents' | 'teams' | 'labels' | null>(null)
  const statusDropdownRef = useRef<HTMLDivElement>(null)
  const assignDropdownRef = useRef<HTMLDivElement>(null)
  const teamDropdownRef = useRef<HTMLDivElement>(null)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const aiAgentDropdownRef = useRef<HTMLDivElement>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)

  // ── Data Queries ──
  const { data: instances } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: async () => (await api.get('/instances')).data,
  })

  // Auto-select first connected instance
  useEffect(() => {
    if (!selectedInstance && instances?.length) {
      const connected = instances.find(i => i.status === 'CONNECTED')
      setSelectedInstance(connected?.id || instances[0].id)
    }
  }, [instances, selectedInstance])

  // Pre-populate React Query cache from sessionStorage on page load (one-time)
  useEffect(() => {
    if (!selectedInstance) return
    try {
      const cached = sessionStorage.getItem(`convs-${selectedInstance}`)
      if (cached && !queryClient.getQueryData(['conversations', selectedInstance])) {
        queryClient.setQueryData(['conversations', selectedInstance], JSON.parse(cached))
      }
    } catch {}
  }, [selectedInstance, queryClient])

  const { data: conversationsData, isLoading: loadingConversations } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ['conversations', selectedInstance],
    queryFn: async () => {
      const res = (await api.get(`/messages/conversations/${selectedInstance}`)).data
      try { sessionStorage.setItem(`convs-${selectedInstance}`, JSON.stringify(res)) } catch {}
      return res
    },
    enabled: !!selectedInstance,
    refetchInterval: 30000,
    staleTime: 10000,
  })
  const conversations = useMemo(() => conversationsData?.conversations || [], [conversationsData])

  // Auto-select conversation from ?phone= query param
  useEffect(() => {
    const phone = searchParams.get('phone')
    if (!phone) return

    const jid = `${phone}@s.whatsapp.net`

    // If conversations are loaded, try to find locally first
    if (conversations.length) {
      const found = conversations.find((c: any) => c.remoteJid === jid)
      if (found) {
        setSelectedChat(jid)
        setSearchParams({}, { replace: true })
        return
      }
    }

    // If not found locally (or conversations not loaded yet), search across all instances via backend
    if (instances?.length) {
      api.get(`/messages/find-by-phone/${phone}`).then(res => {
        const conv = res.data?.conversation
        if (conv) {
          // Switch to the correct instance if needed
          if (conv.instanceId !== selectedInstance) {
            setSelectedInstance(conv.instanceId)
          }
          // Wait a tick for instance switch to trigger conversation reload, then select
          setTimeout(() => {
            setSelectedChat(conv.remoteJid)
            setSearchParams({}, { replace: true })
          }, conv.instanceId !== selectedInstance ? 1500 : 100)
        }
      }).catch(() => {})
    }
  }, [searchParams, conversations, instances])

  // Deleted conversations (loaded only when filter is DELETED)
  const { data: deletedConvsData } = useQuery<{ conversations: any[] }>({
    queryKey: ['deleted-conversations', selectedInstance],
    queryFn: async () => (await api.get(`/messages/conversations/${selectedInstance}?deleted=true`)).data,
    enabled: !!selectedInstance && statusFilter === 'DELETED',
    staleTime: 30000,
  })
  const deletedConversations = useMemo(() => deletedConvsData?.conversations || [], [deletedConvsData])

  // CRM data: labels, teams, users, canned responses
  const { data: labelsData } = useQuery<{ labels: { id: string; title: string; color: string; description?: string }[] }>({
    queryKey: ['labels'],
    queryFn: async () => (await api.get('/labels')).data,
    staleTime: 60000,
  })
  const allLabels = useMemo(() => labelsData?.labels || [], [labelsData])

  const { data: teamsData } = useQuery<{ teams: { id: string; name: string; description?: string }[] }>({
    queryKey: ['teams'],
    queryFn: async () => (await api.get('/teams')).data,
    staleTime: 60000,
  })
  const allTeams = useMemo(() => teamsData?.teams || [], [teamsData])

  const { data: usersData } = useQuery<{ id: string; name: string; email: string; role: string }[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
    staleTime: 60000,
  })
  const allUsers = useMemo(() => usersData || [], [usersData])

  // ── AI Agents para atribuição ──
  const { data: aiAgentsData } = useQuery<{ id: string; name: string; status: string }[]>({
    queryKey: ['ai-agents-list'],
    queryFn: async () => {
      const res = (await api.get('/ai/agents')).data
      return (res.agents || res || []).filter((a: any) => a.status === 'ACTIVE')
    },
    staleTime: 60000,
  })
  const allAiAgents = useMemo(() => aiAgentsData || [], [aiAgentsData])

  const { data: cannedData } = useQuery<{ responses: { id: string; shortCode: string; content: string }[] }>({
    queryKey: ['canned-responses'],
    queryFn: async () => (await api.get('/canned-responses')).data,
    staleTime: 60000,
  })
  const cannedResponses = useMemo(() => cannedData?.responses || [], [cannedData])

  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ['chat-messages', selectedInstance, selectedChat],
    queryFn: async () => {
      const res = (await api.get(`/messages/${selectedInstance}?remoteJid=${selectedChat}&limit=80`)).data
      try { sessionStorage.setItem(`msgs-${selectedChat}`, JSON.stringify(res)) } catch {}
      return res
    },
    enabled: !!selectedInstance && !!selectedChat,
    staleTime: 2000,
    refetchInterval: 15000,
  })
  // Reset older-messages state ao trocar de chat e capturar hasMore inicial
  useEffect(() => {
    setOlderMessages([])
    setHasMoreOlder(false)
    loadingOlderRef.current = false
    setLoadingOlder(false)
  }, [selectedInstance, selectedChat])
  useEffect(() => {
    if (messagesData?.hasMore !== undefined) setHasMoreOlder(!!messagesData.hasMore)
  }, [messagesData])

  // Carregar mensagens mais antigas quando o usuário rola pra cima
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlder || !selectedInstance || !selectedChat) return
    // Pegar a mensagem mais antiga atualmente carregada
    const allMsgs = [...olderMessages, ...(messagesData?.messages || [])]
    const oldest = allMsgs[0]
    if (!oldest) return
    const before = oldest.createdAt
    loadingOlderRef.current = true
    setLoadingOlder(true)
    // Preservar scrollHeight pra manter a posição visual após prepend
    const el = messagesContainerRef.current
    if (el) preserveScrollHeightRef.current = el.scrollHeight
    try {
      const res = (await api.get(`/messages/${selectedInstance}?remoteJid=${selectedChat}&limit=80&before=${encodeURIComponent(before)}`)).data
      const newMsgs: Message[] = res?.messages || []
      if (newMsgs.length > 0) {
        setOlderMessages(prev => [...newMsgs, ...prev])
      }
      setHasMoreOlder(!!res?.hasMore)
    } catch (e) {
      console.warn('[Messages] loadOlder falhou:', e)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [hasMoreOlder, selectedInstance, selectedChat, olderMessages, messagesData])

  // Após prepend de mensagens antigas, restaurar a posição de scroll
  useLayoutEffect(() => {
    const el = messagesContainerRef.current
    if (!el || preserveScrollHeightRef.current == null) return
    const delta = el.scrollHeight - preserveScrollHeightRef.current
    if (delta > 0) el.scrollTop = el.scrollTop + delta
    preserveScrollHeightRef.current = null
  }, [olderMessages])
  const chatMessages: Message[] = useMemo(() => {
    const baseMsgs = messagesData?.messages || []
    // Merge: olderMessages (prepended) + base (latest 80 + previously loaded)
    const msgs = [...olderMessages, ...baseMsgs]
    // Dedup: remover mensagens OUTBOUND duplicadas (mesmo conteúdo+tipo em ≤3s)
    const seen = new Map<string, number>()
    const seenIds = new Set<string>()
    return msgs.filter((msg: Message) => {
      // Dedup por id (caso older e base se sobreponham)
      if (seenIds.has(msg.id)) return false
      seenIds.add(msg.id)
      if (msg.direction !== 'OUTBOUND') return true
      const ts = new Date(msg.createdAt).getTime()
      const key = `${msg.direction}-${msg.type}-${msg.content}`
      const prevTs = seen.get(key)
      if (prevTs !== undefined && Math.abs(ts - prevTs) < 3000) return false
      seen.set(key, ts)
      return true
    })
  }, [messagesData, olderMessages])

  // ── Conversation Events (Activity Log) ──
  const { data: eventsData } = useQuery({
    queryKey: ['conversation-events', selectedInstance, selectedChat],
    queryFn: async () => (await api.get(`/conversations/events/${selectedInstance}/${encodeURIComponent(selectedChat!)}`)).data,
    enabled: !!selectedInstance && !!selectedChat,
    staleTime: 5000,
    refetchInterval: 30000,
  })

  // Merge messages and events into a single timeline
  const timelineItems = useMemo(() => {
    const items: Array<{ type: 'message'; data: Message } | { type: 'event'; data: any }> = []
    for (const msg of chatMessages) {
      items.push({ type: 'message', data: msg })
    }
    for (const evt of (eventsData?.events || [])) {
      items.push({ type: 'event', data: evt })
    }
    items.sort((a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime())
    return items
  }, [chatMessages, eventsData])

  // ── AI Session Status ──
  useEffect(() => {
    if (!selectedInstance || !selectedChat) { setAiStatus(null); return }
    const fetchAI = async () => {
      try {
        const res = await api.get(`/ai/session-status/${selectedInstance}/${encodeURIComponent(selectedChat)}`)
        setAiStatus(res.data)
      } catch { setAiStatus(null) }
    }
    fetchAI()
    const interval = setInterval(fetchAI, 10000) // Poll every 10s
    return () => clearInterval(interval)
  }, [selectedInstance, selectedChat])

  const toggleAI = async (action: 'pause' | 'resume') => {
    if (!selectedInstance || !selectedChat || togglingAI) return
    setTogglingAI(true)
    try {
      const res = await api.post(`/ai/session-toggle/${selectedInstance}/${encodeURIComponent(selectedChat)}`, { action })
      setAiStatus(prev => prev ? { ...prev, active: res.data.status === 'OPENED', status: res.data.status } : null)
    } catch (err) { console.error('Toggle AI error:', err) }
    finally { setTogglingAI(false) }
  }

  // Index of the first unread INBOUND message (for the divider)
  // Walk backwards counting only INBOUND messages until we reach unreadCount
  const unreadDividerIdx = useMemo(() => {
    const count = unreadCountOnOpenRef.current
    if (count <= 0 || !chatMessages.length) return -1
    let inboundSeen = 0
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].direction === 'INBOUND') {
        inboundSeen++
        if (inboundSeen === count) return i
      }
    }
    return -1
  }, [chatMessages])

  // Fetch group metadata (names, participant counts) for all groups
  const { data: groupsMetaData } = useQuery<{ groups: Record<string, { name: string; description?: string; participantCount: number; profilePicture?: string | null }> }>({
    queryKey: ['groups-metadata', selectedInstance],
    queryFn: async () => (await api.get(`/messages/groups-metadata/${selectedInstance}`)).data,
    enabled: !!selectedInstance,
    staleTime: 5 * 60 * 1000, // Cache 5 min
    refetchOnWindowFocus: false,
  })
  const groupsMeta = useMemo(() => groupsMetaData?.groups || {}, [groupsMetaData])

  // Fetch newsletter metadata (names, descriptions)
  const { data: newslettersMetaData } = useQuery<{ newsletters: Record<string, { name: string; description?: string; subscriberCount?: number; profilePicture?: string | null }> }>({
    queryKey: ['newsletters-metadata', selectedInstance],
    queryFn: async () => (await api.get(`/messages/newsletters-metadata/${selectedInstance}`)).data,
    enabled: !!selectedInstance,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const newslettersMeta = useMemo(() => newslettersMetaData?.newsletters || {}, [newslettersMetaData])

  // Avatars cache: keyed by remoteJid -> local avatar URL
  const [avatarCache, setAvatarCache] = useState<Record<string, string | null>>({})
  const avatarFetchedRef = useRef<Set<string>>(new Set())

  // Resolve avatar URL for display (handle relative paths)
  const getAvatarUrl = useCallback((avatarPath: string | null | undefined): string => {
    if (!avatarPath) return ''
    if (avatarPath.startsWith('/uploads/')) {
      return BACKEND_URL ? `${BACKEND_URL}${avatarPath}` : avatarPath
    }
    return avatarPath
  }, [])

  // Fetch avatars for conversations that don't have one cached yet
  const conversationsLen = conversations.length
  useEffect(() => {
    if (!selectedInstance || !conversationsLen) return

    // Build list of jids that need avatar fetching and batch cache updates
    const jidsToFetch: string[] = []
    const batchUpdates: Record<string, string> = {}

    for (const conv of conversations) {
      const jid = conv.remoteJid
      if (avatarFetchedRef.current.has(jid)) continue

      // If conversation already has profilePicture from DB, batch it
      if (conv.profilePicture) {
        batchUpdates[jid] = conv.profilePicture
        avatarFetchedRef.current.add(jid)
        continue
      }
      // If group has profilePicture from groups-metadata, batch it
      if (jid.includes('@g.us') && groupsMeta[jid]?.profilePicture) {
        batchUpdates[jid] = groupsMeta[jid].profilePicture!
        avatarFetchedRef.current.add(jid)
        continue
      }
      // Need to fetch from API
      jidsToFetch.push(jid)
    }

    // Apply batch updates in one setState call
    if (Object.keys(batchUpdates).length > 0) {
      setAvatarCache(prev => ({ ...prev, ...batchUpdates }))
    }

    // Fetch avatars from API for those missing (one at a time with delay)
    if (jidsToFetch.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const jid of jidsToFetch.slice(0, 20)) {
        if (cancelled) break
        avatarFetchedRef.current.add(jid)
        try {
          const res = await api.get(`/messages/avatar/${selectedInstance}/${encodeURIComponent(jid)}`)
          const avatar = res.data?.avatar || null
          if (avatar && !cancelled) {
            setAvatarCache(prev => ({ ...prev, [jid]: avatar }))
          }
        } catch {}
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 300))
      }
    })()

    return () => { cancelled = true }
  }, [selectedInstance, conversations, groupsMeta])

  // Fetch group info when opening a group chat (participants, description)
  const { data: groupInfoData } = useQuery<{ groupInfo: any }>({
    queryKey: ['group-info', selectedInstance, selectedChat],
    queryFn: async () => (await api.get(`/messages/group-info/${selectedInstance}/${selectedChat}`)).data,
    enabled: !!selectedInstance && !!selectedChat && !!selectedChat?.includes('@g.us'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const groupInfo = groupInfoData?.groupInfo

  // Build a map of participant JIDs → names from group info
  const participantNames = useMemo(() => {
    const map: Record<string, string> = {}
    if (groupInfo?.Participants) {
      for (const p of groupInfo.Participants) {
        const jid = p.JID || ''
        const phone = jid.replace('@s.whatsapp.net', '').replace(/@.*/, '')
        if (phone) map[phone] = '' // Will be filled from message metadata
      }
    }
    return map
  }, [groupInfo])

  // Build participant name map from messages metadata (best available names)
  const senderNamesMap = useMemo(() => {
    const map: Record<string, string> = { ...participantNames }
    for (const msg of chatMessages) {
      const meta = (msg as any).metadata
      if (meta?.senderPhone) {
        if (meta.senderName && meta.senderName !== meta.senderPhone) {
          map[meta.senderPhone] = meta.senderName
        } else if (!map[meta.senderPhone]) {
          map[meta.senderPhone] = ''
        }
      }
    }
    return map
  }, [chatMessages, participantNames])

  // ── Socket.IO Real-time ──
  // Debounce timer para invalidateQueries de conversas (evita storm em bursts de eventos)
  const conversationsInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedInvalidateConversations = useCallback((instanceId: string) => {
    if (conversationsInvalidateTimer.current) clearTimeout(conversationsInvalidateTimer.current)
    conversationsInvalidateTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['conversations', instanceId] })
    }, 2000)
  }, [queryClient])

  useEffect(() => {
    if (!selectedInstance) return
    connectSocket()
    const socket = getSocket()
    joinInstance(selectedInstance)

    const handleNewMessage = (data: any, eventDirection: 'INBOUND' | 'OUTBOUND') => {
      if (data.instanceId !== selectedInstance) return

      const normalizedFrom = (data.from || '').replace(/@.*/, '').replace(/\D/g, '')
      const normalizedChat = (selectedChat || '').replace(/@.*/, '').replace(/\D/g, '')
      const isCurrentChat = normalizedFrom === normalizedChat && !!selectedChat

      // Usar direction do payload se presente, senão usar baseado no nome do evento socket
      const direction = data.direction || eventDirection

      // Optimistic update: adicionar mensagem direto no cache (instantâneo, sem HTTP)
      if (isCurrentChat && data.content) {
        const now = new Date().toISOString()
        const optimisticMsg: Message = {
          id: data.messageId || `socket_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          instanceId: data.instanceId,
          remoteJid: data.from || selectedChat || '',
          messageId: data.messageId || `socket_${Date.now()}`,
          direction,
          status: direction === 'OUTBOUND' ? 'SENT' : 'DELIVERED',
          type: data.type || 'text',
          content: data.content,
          mediaUrl: data.mediaUrl,
          metadata: data.metadata,
          createdAt: data.timestamp || now,
        }

        queryClient.setQueryData(
          ['chat-messages', selectedInstance, selectedChat],
          (old: any) => {
            if (!old?.messages) return old
            // Dedup: não adicionar se já existe com mesmo messageId
            const exists = old.messages.some((m: Message) => m.messageId === optimisticMsg.messageId)
            if (exists) return old
            // Para OUTBOUND, deduplicar contra otimismos `sending_*` com mesmo conteúdo+tipo.
            // Fazer isso SEMPRE (mesmo sem data.messageId) — Evo Go às vezes não retorna o
            // messageId real no envio, e o socket chega com messageId undefined →
            // sem essa proteção, a msg apareceria 2x até o refetch.
            let filtered = old.messages
            if (direction === 'OUTBOUND') {
              const msgType = data.type || 'text'
              const msgContent = data.content
              let consumed = false
              filtered = old.messages.filter((m: Message) => {
                if (
                  !consumed
                  && typeof m.id === 'string'
                  && m.id.startsWith('sending_')
                  && m.direction === 'OUTBOUND'
                  && m.content === msgContent
                  && m.type === msgType
                ) {
                  consumed = true
                  return false
                }
                return true
              })
            }
            return { ...old, messages: [...filtered, optimisticMsg] }
          }
        )

        // Auto-marca como lida
        api.post(`/messages/mark-read/${selectedInstance}`, { remoteJid: selectedChat }).catch(() => {})
      }

      // Atualizar conversa na sidebar (optimistic — sem refetch HTTP)
      queryClient.setQueryData(
        ['conversations', selectedInstance],
        (old: any) => {
          if (!old) return old
          const convs = Array.isArray(old) ? old : old?.conversations || old
          if (!Array.isArray(convs)) return old

          const normalizedFrom2 = (data.from || '').replace(/@.*/, '').replace(/\D/g, '')
          const idx = convs.findIndex((c: Conversation) => {
            const nJid = (c.remoteJid || '').replace(/@.*/, '').replace(/\D/g, '')
            return nJid === normalizedFrom2
          })

          if (idx >= 0) {
            const updated = [...convs]
            updated[idx] = {
              ...updated[idx],
              lastMessage: data.content || updated[idx].lastMessage,
              lastMessageType: data.type || updated[idx].lastMessageType,
              lastDirection: direction,
              lastMessageAt: data.timestamp || new Date().toISOString(),
              unreadCount: isCurrentChat ? 0 : (updated[idx].unreadCount || 0) + (direction !== 'OUTBOUND' ? 1 : 0),
            }
            // Mover para o topo
            const [conv] = updated.splice(idx, 1)
            updated.unshift(conv)
            return Array.isArray(old) ? updated : { ...old, conversations: updated }
          }
          return old
        }
      )

      // Refetch em background para garantir consistência (não-bloqueante)
      // Debounced: cancela timers anteriores para evitar N refetches em burst de mensagens
      debouncedInvalidateConversations(selectedInstance)
      if (isCurrentChat) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedInstance, selectedChat] })
        }, 3000)
      }
    }

    const handleAiSessionUpdate = (data: any) => {
      if (data.instanceId !== selectedInstance) return
      // NÃO invalida conversations aqui — cada mensagem da IA emite este evento e causaria
      // um storm de refetches. O indicador de IA na sidebar é atualizado pelo handleNewMessage.
      // Update AI status if the event is for the currently selected chat
      const normalizedEvent = (data.remoteJid || '').replace(/@.*/, '').replace(/\D/g, '')
      const normalizedChat = (selectedChat || '').replace(/@.*/, '').replace(/\D/g, '')
      if (normalizedEvent === normalizedChat && selectedChat) {
        // Refresh AI session query for the panel
        queryClient.invalidateQueries({ queryKey: ['ai-session'] })
        if (data.status === 'RESOLVED') {
          setAiStatus(null)
        } else {
          setAiStatus({
            active: data.status === 'OPENED',
            sessionId: data.sessionId || null,
            agentName: data.agentName || null,
            status: data.status,
          })
        }
      }
    }

    const handleConversationEvent = (data: any) => {
      if (data.instanceId !== selectedInstance) return
      // Refresh events for the currently open chat
      const normalizedEvent = (data.remoteJid || '').replace(/@.*/, '').replace(/\D/g, '')
      const normalizedChat = (selectedChat || '').replace(/@.*/, '').replace(/\D/g, '')
      if (normalizedEvent === normalizedChat && selectedChat) {
        queryClient.invalidateQueries({ queryKey: ['conversation-events', selectedInstance, selectedChat] })
      }
    }

    socket.on('message-received', (data: any) => handleNewMessage(data, 'INBOUND'))
    socket.on('message-sent', (data: any) => handleNewMessage(data, 'OUTBOUND'))
    socket.on('new-note', (data: any) => handleNewMessage(data, 'INBOUND'))
    socket.on('ai-session-update', handleAiSessionUpdate)
    socket.on('conversation-event', handleConversationEvent)
    const handleConversationAiPause = (data: any) => {
      if (data.instanceId !== selectedInstance) return
      queryClient.invalidateQueries({ queryKey: ['ai-session'] })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    }
    socket.on('conversation-ai-pause', handleConversationAiPause)

    // Memória da IA atualizada (estilo ChatGPT "Memória atualizada")
    const handleMemoryUpdated = (data: any) => {
      if (data.instanceId !== selectedInstance) return
      const normalizedEvent = (data.remoteJid || '').replace(/@.*/, '').replace(/\D/g, '')
      const normalizedChat = (selectedChat || '').replace(/@.*/, '').replace(/\D/g, '')
      if (normalizedEvent !== normalizedChat) return
      const action = data.action
      let label = 'Memória atualizada'
      let detail = ''
      if (action === 'save' && data.fact) detail = data.fact
      else if (action === 'preference' && data.key) detail = `${data.key}: ${data.value || ''}`
      else if (action === 'forget') { label = 'Memória removida'; detail = `${data.count || 0} item(s)` }
      setMemoryToasts(prev => [
        ...prev.slice(-4),
        { id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, label, detail, agentName: data.agentName || 'IA' },
      ])
    }
    socket.on('ai-memory-updated', handleMemoryUpdated)

    return () => {
    socket.off('message-received', handleNewMessage as any)
    socket.off('message-sent', handleNewMessage as any)
    socket.off('new-note', handleNewMessage as any)
      socket.off('ai-session-update', handleAiSessionUpdate)
      socket.off('conversation-event', handleConversationEvent)
      socket.off('conversation-ai-pause', handleConversationAiPause)
      socket.off('ai-memory-updated', handleMemoryUpdated)
    }
  }, [selectedInstance, selectedChat, queryClient])

  // ── Mark messages as read when opening a chat ──
  useEffect(() => {
    if (!selectedInstance || !selectedChat) return
    api.post(`/messages/mark-read/${selectedInstance}`, { remoteJid: selectedChat })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      })
      .catch(() => {})
  }, [selectedInstance, selectedChat, queryClient])

  // ── Auto-scroll ──
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    if (!chatMessages.length) return
    // Chat just opened — scroll to unread divider or bottom
    if (chatJustOpenedRef.current) {
      chatJustOpenedRef.current = false
      if (unreadCountOnOpenRef.current > 0) {
        // Wait for the divider to render in the DOM
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (unreadDividerRef.current) {
              unreadDividerRef.current.scrollIntoView({ behavior: 'instant', block: 'start' })
              isNearBottomRef.current = false
              setShowScrollBtn(true)
            } else {
              scrollToBottom(false)
            }
          }, 30)
        })
        return
      }
      scrollToBottom(false)
      return
    }
    // Normal: new messages while viewing — scroll only if near bottom
    if (isNearBottomRef.current) {
      scrollToBottom(false)
    }
  }, [chatMessages, scrollToBottom])

  useEffect(() => {
    if (selectedChat && !chatJustOpenedRef.current) {
      setTimeout(() => scrollToBottom(false), 100)
    }
  }, [selectedChat, scrollToBottom])

  // Scroll to a quoted message after cross-chat navigation
  useEffect(() => {
    if (!pendingScrollToStanzaRef.current || !chatMessages.length) return
    const stanzaId = pendingScrollToStanzaRef.current
    // Small delay to ensure DOM is rendered
    const timer = setTimeout(() => {
      const origIdx = chatMessages.findIndex(m => m.messageId === stanzaId)
      if (origIdx >= 0) {
        const el = document.getElementById(`msg-${origIdx}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ring-1', 'ring-[var(--chat-accent)]/60', 'rounded-lg')
          setTimeout(() => el.classList.remove('ring-1', 'ring-[var(--chat-accent)]/60', 'rounded-lg'), 2500)
        }
      }
      pendingScrollToStanzaRef.current = null
    }, 300)
    return () => clearTimeout(timer)
  }, [chatMessages])

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    isNearBottomRef.current = nearBottom
    setShowScrollBtn(!nearBottom)
    // Infinite scroll up: ao chegar próximo do topo, carrega mais antigas
    if (el.scrollTop < 200 && hasMoreOlder && !loadingOlderRef.current) {
      loadOlderMessages()
    }
  }, [hasMoreOlder, loadOlderMessages])

  // ── Send Message ──
  const sendingRef = useRef(false)
  const handleSend = async () => {
    if (!messageText.trim() || !selectedInstance || !selectedChat || sending || sendingRef.current) return
    const text = messageText.trim()
    setMessageText('')
    setSending(true)
    sendingRef.current = true

    const optimisticId = `sending_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    // Optimistic update: mostrar mensagem INSTANTANEAMENTE na UI
    if (!isNoteMode) {
      const optimisticMsg: Message = {
        id: optimisticId,
        instanceId: selectedInstance,
        remoteJid: selectedChat,
        messageId: optimisticId,
        direction: 'OUTBOUND',
        status: 'SENDING' as any,
        type: 'text',
        content: text,
        createdAt: new Date().toISOString(),
      }
      queryClient.setQueryData(
        ['chat-messages', selectedInstance, selectedChat],
        (old: any) => {
          if (!old?.messages) return old
          return { ...old, messages: [...old.messages, optimisticMsg] }
        }
      )
      scrollToBottom()
    }

    try {
      if (isNoteMode) {
        await api.post('/messages/note', {
          instanceId: selectedInstance,
          remoteJid: selectedChat,
          content: text,
        })
        queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedInstance, selectedChat] })
      } else {
        await api.post('/messages/send', {
          instanceId: selectedInstance,
          to: selectedChat,
          text,
        })
        // Não remover a msg otimista — ela fica visível até o refetch/socket
        // trazer a msg real e sobrescrever o array inteiro. Assim não há
        // janela de "mensagem sumiu".
      }
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    } catch (err) {
      console.error('Send error:', err)
      // Remover msg otimista e restaurar texto
      queryClient.setQueryData(
        ['chat-messages', selectedInstance, selectedChat],
        (old: any) => {
          if (!old?.messages) return old
          return { ...old, messages: old.messages.filter((m: Message) => m.messageId !== optimisticId) }
        }
      )
      setMessageText(text)
    } finally {
      setSending(false)
      sendingRef.current = false
      inputRef.current?.focus()
    }
  }

  // ── Send Interactive Message ──
  const handleSendInteractive = async (payload: any) => {
    if (!selectedInstance || !selectedChat) return
    setSendingInteractive(true)
    try {
      await api.post('/messages/send-interactive', {
        instanceId: selectedInstance,
        to: selectedChat,
        interactive: payload,
      })
      setShowInteractiveComposer(false)
      queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedInstance, selectedChat] })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      setTimeout(() => scrollToBottom(), 200)
    } catch (err: any) {
      console.error('Send interactive error:', err)
      throw err
    } finally {
      setSendingInteractive(false)
    }
  }

  // ── Schedule Message from Chat ──
  const handleOpenScheduleModal = () => {
    if (!messageText.trim() && !previewFile) {
      toast.warning('Digite uma mensagem ou anexe um arquivo para agendar')
      return
    }
    const now = new Date()
    now.setMinutes(now.getMinutes() + 30)
    now.setSeconds(0, 0)
    const localISO = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + 'T' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0')
    setScheduleForm({
      scheduledAt: localISO,
      name: messageText.trim().slice(0, 50) || (previewFile?.name || 'Agendamento'),
      recurrence: 'ONCE',
      content: messageText.trim(),
      caption: captionText.trim(),
    })
    setScheduleFiles(previewFile ? [previewFile] : [])
    setShowScheduleModal(true)
  }

  const handleScheduleMessage = async () => {
    if (!selectedInstance || !selectedChat || !scheduleForm.scheduledAt) return
    setScheduleSaving(true)
    try {
      const scheduledDate = new Date(scheduleForm.scheduledAt)
      const filesToSchedule = scheduleFiles.length > 0 ? scheduleFiles : (previewFile ? [previewFile] : [])

      if (filesToSchedule.length > 0) {
        // Schedule each file separately
        for (const file of filesToSchedule) {
          const fileType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document'
          const payload: any = {
            instanceId: selectedInstance,
            remoteJid: selectedChat,
            name: scheduleForm.name || 'Agendamento',
            messageType: fileType,
            recurrence: scheduleForm.recurrence,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
            scheduledAt: scheduledDate.toISOString(),
          }
          const formData = new FormData()
          formData.append('file', file)
          const { data: uploadResult } = await api.post('/schedules/upload-media', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          payload.mediaUrl = uploadResult.url
          payload.mediaFileName = uploadResult.fileName || file.name
          if (scheduleForm.caption.trim()) payload.content = scheduleForm.caption.trim()
          await api.post('/schedules', payload)
        }
      } else {
        // Text-only schedule
        const payload: any = {
          instanceId: selectedInstance,
          remoteJid: selectedChat,
          name: scheduleForm.name || 'Agendamento',
          messageType: 'text',
          content: scheduleForm.content.trim() || undefined,
          recurrence: scheduleForm.recurrence,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
          scheduledAt: scheduledDate.toISOString(),
        }
        await api.post('/schedules', payload)
      }
      toast.success(filesToSchedule.length > 1 ? `${filesToSchedule.length} mensagens agendadas com sucesso!` : 'Mensagem agendada com sucesso!')
      setShowScheduleModal(false)
      setMessageText('')
      setPreviewFile(null)
      setPreviewUrl('')
      setCaptionText('')
      setScheduleFiles([])
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      queryClient.invalidateQueries({ queryKey: ['contact-schedules', selectedInstance, selectedChat] })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao agendar mensagem')
    } finally {
      setScheduleSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Canned responses navigation
    if (showCannedMenu) {
      const filtered = cannedResponses.filter(r =>
        !cannedSearch || r.shortCode.toLowerCase().includes(cannedSearch.toLowerCase()) || r.content.toLowerCase().includes(cannedSearch.toLowerCase())
      )
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCannedIndex(prev => (prev + 1) % Math.max(filtered.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCannedIndex(prev => (prev - 1 + filtered.length) % Math.max(filtered.length, 1))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && filtered.length > 0) {
        e.preventDefault()
        setMessageText(filtered[cannedIndex]?.content || '')
        setShowCannedMenu(false)
        setCannedSearch('')
        setCannedIndex(0)
        return
      }
      if (e.key === 'Escape') {
        setShowCannedMenu(false)
        setCannedSearch('')
        setCannedIndex(0)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    // Alt+P toggles note mode
    if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault()
      setIsNoteMode(v => !v)
    }
  }

  // Detect "/" for canned responses autocomplete
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setMessageText(val)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    // Check if message starts with "/" for canned responses
    if (val.startsWith('/')) {
      setShowCannedMenu(true)
      setCannedSearch(val.slice(1))
      setCannedIndex(0)
    } else {
      setShowCannedMenu(false)
      setCannedSearch('')
    }
  }

  // ── Close emoji/attach/CRM menus on outside click ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setShowStatusDropdown(false)
      }
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false)
      }
      if (teamDropdownRef.current && !teamDropdownRef.current.contains(e.target as Node)) {
        setShowTeamDropdown(false)
      }
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setShowLabelDropdown(false)
      }
      if (aiAgentDropdownRef.current && !aiAgentDropdownRef.current.contains(e.target as Node)) {
        setShowAiAgentDropdown(false)
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false)
      }
      if (labelFilterRef.current && !labelFilterRef.current.contains(e.target as Node)) {
        setShowLabelFilterDD(false)
      }
      if (assigneeFilterRef.current && !assigneeFilterRef.current.contains(e.target as Node)) {
        setShowAssigneeFilterDD(false)
      }
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setShowHeaderMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Emoji select ──
  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessageText(prev => prev + emojiData.emoji)
  }

  // ── Open file picker for given media type ──
  const openFilePicker = (mediaType: 'image' | 'video' | 'audio' | 'document') => {
    const acceptMap = {
      image: 'image/*',
      video: 'video/*',
      audio: 'audio/*',
      document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
    }
    setFileMType(mediaType)
    setFileAccept(acceptMap[mediaType])
    setShowAttachMenu(false)
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  // ── Upload + send media file ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedInstance || !selectedChat) return
    e.target.value = ''
    // Show preview overlay instead of sending immediately
    setPreviewFile(file)
    setPreviewType(fileMType)
    setPreviewUrl(URL.createObjectURL(file))
    setCaptionText('')
  }

  // ── Send media with optional caption (from preview) ──
  const sendMediaWithCaption = async () => {
    if (!previewFile || !selectedInstance || !selectedChat || uploading) return
    setUploading(true)
    
    // Capture file data before closing preview
    const file = previewFile
    const type = previewType
    const caption = captionText.trim()
    const instId = selectedInstance
    const chatJid = selectedChat
    const localUrl = previewUrl // Local blob URL for instant preview
    const optimisticId = `sending_media_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    
    // Close preview immediately for a responsive feel
    setPreviewFile(null)
    setCaptionText('')
    setUploading(false)
    // Don't revoke previewUrl yet — it's used by optimistic message

    // Optimistic update: mostrar mídia INSTANTANEAMENTE na UI com preview local
    const optimisticMsg: Message = {
      id: optimisticId,
      instanceId: instId,
      remoteJid: chatJid,
      messageId: optimisticId,
      direction: 'OUTBOUND',
      status: 'SENDING' as any,
      type,
      content: caption || file.name,
      mediaUrl: localUrl,
      createdAt: new Date().toISOString(),
    }
    queryClient.setQueryData(
      ['chat-messages', instId, chatJid],
      (old: any) => {
        if (!old?.messages) return old
        return { ...old, messages: [...old.messages, optimisticMsg] }
      }
    )
    scrollToBottom()
    
    // Send in background
    try {
      const formData = new FormData()
      formData.append('instanceId', instId)
      formData.append('to', chatJid)
      formData.append('mediaType', type)
      if (caption) formData.append('caption', caption)
      formData.append('file', file)
      const res = await api.post('/messages/send-media-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const realMessageId: string = res.data?.messageId || ''
      const serverMediaUrl: string = res.data?.mediaUrl || ''

      // Atualiza a msg otimista IN-PLACE com os dados reais (não remover!)
      // Removendo a otimista antes da refetch causa "buraco" se o socket atrasar
      // ou se o backend salvar duplicado e o dedup eliminar a versão errada.
      queryClient.setQueryData(
        ['chat-messages', instId, chatJid],
        (old: any) => {
          if (!old?.messages) return old
          let foundOptimistic = false
          const messages = old.messages.map((m: Message) => {
            if (m.messageId === optimisticId) {
              foundOptimistic = true
              return {
                ...m,
                messageId: realMessageId || m.messageId,
                id: realMessageId || m.id,
                status: 'SENT' as any,
                mediaUrl: serverMediaUrl || m.mediaUrl,
              }
            }
            // Se o socket já trouxe a versão real, remover a otimista para evitar duplicata
            if (
              realMessageId
              && m.messageId === realMessageId
              && typeof m.id === 'string'
              && !m.id.startsWith('sending_')
            ) {
              foundOptimistic = true
            }
            return m
          })
          // Filtra optimistic remanescente caso o socket já tenha adicionado a real
          const finalMessages = foundOptimistic && messages.some((m: Message) => m.messageId === realMessageId && typeof m.id === 'string' && !m.id.startsWith('sending_'))
            ? messages.filter((m: Message) => !(typeof m.id === 'string' && m.id.startsWith('sending_') && m.messageId !== realMessageId))
            : messages
          return { ...old, messages: finalMessages }
        }
      )
      queryClient.invalidateQueries({ queryKey: ['conversations', instId] })
    } catch (err) {
      console.error('Upload error:', err)
      // Remover msg otimista em caso de erro
      queryClient.setQueryData(
        ['chat-messages', instId, chatJid],
        (old: any) => {
          if (!old?.messages) return old
          return { ...old, messages: old.messages.filter((m: Message) => m.messageId !== optimisticId) }
        }
      )
    } finally {
      // Não revogar imediatamente — a UI ainda pode estar mostrando o blob
      // antes do swap para serverMediaUrl. Aguarda 2s para garantir que a img/video
      // tenha tempo de carregar a URL do servidor.
      if (localUrl) setTimeout(() => URL.revokeObjectURL(localUrl), 2000)
    }
  }

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewFile(null)
    setPreviewUrl('')
    setCaptionText('')
  }

  // ── Ctrl+V paste image from clipboard ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!selectedInstance || !selectedChat) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue
          setPreviewFile(file)
          setPreviewType('image')
          setPreviewUrl(URL.createObjectURL(file))
          setCaptionText('')
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [selectedInstance, selectedChat])

  // ── Audio recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      recordingIntervalRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      console.error('Mic access error:', err)
    }
  }

  const cancelRecording = () => {
    const state = mediaRecorderRef.current?.state
    if (state === 'recording' || state === 'paused') {
      mediaRecorderRef.current!.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop())
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      }
      mediaRecorderRef.current!.stop()
    }
    audioChunksRef.current = []
    setIsRecording(false)
    setRecordingTime(0)
    setIsPaused(false)
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
    }
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      recordingIntervalRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    }
  }

  const sendRecording = async () => {
    if (!mediaRecorderRef.current || !selectedInstance || !selectedChat || uploading) return
    const recorder = mediaRecorderRef.current
    recorder.onstop = async () => {
      recorder.stream?.getTracks().forEach(t => t.stop())
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      setIsRecording(false)
      setRecordingTime(0)
      setIsPaused(false)

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      if (blob.size === 0) return
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('instanceId', selectedInstance)
        formData.append('to', selectedChat!)
        formData.append('mediaType', 'audio')
        formData.append('file', blob, `audio_${Date.now()}.webm`)
        await api.post('/messages/send-media-upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedInstance, selectedChat] })
        queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
        setTimeout(() => scrollToBottom(), 200)
      } catch (err) {
        console.error('Audio upload error:', err)
      } finally {
        setUploading(false)
      }
    }
    recorder.stop()
  }

  const scheduleRecording = async () => {
    if (!mediaRecorderRef.current || !selectedInstance || !selectedChat) return
    const recorder = mediaRecorderRef.current
    recorder.onstop = () => {
      recorder.stream?.getTracks().forEach(t => t.stop())
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      setIsRecording(false)
      setRecordingTime(0)
      setIsPaused(false)

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      if (blob.size === 0) return
      const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' })
      setPreviewFile(file)
      setPreviewUrl(URL.createObjectURL(blob))
      setPreviewType('audio')
      // Open schedule modal directly (state updates are batched)
      const now = new Date()
      now.setMinutes(now.getMinutes() + 30)
      now.setSeconds(0, 0)
      const localISO = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + 'T' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0')
      setScheduleForm({ scheduledAt: localISO, name: file.name, recurrence: 'ONCE', content: '', caption: '' })
      setScheduleFiles([file])
      setShowScheduleModal(true)
    }
    recorder.stop()
  }

  const formatRecordingTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // ── Audio transcription ──
  async function handleTranscribeAudio(messageId: string) {
    // Check if already transcribed
    if (transcriptions[messageId]) return

    setTranscribing(messageId)
    try {
      const { data } = await api.post(`/messages/transcribe/${messageId}`)
      setTranscriptions(prev => ({
        ...prev,
        [messageId]: {
          text: data.text,
          provider: data.provider,
          costUsd: data.costUsd,
        },
      }))
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Erro ao transcrever áudio'
      // Show inline error
      setTranscriptions(prev => ({
        ...prev,
        [messageId]: { text: `❌ ${errorMsg}` },
      }))
    } finally {
      setTranscribing(null)
    }
  }

  // ── Filter conversations ──

  // ── In-chat message search ──
  useEffect(() => {
    if (!chatSearchTerm.trim() || !chatMessages.length) {
      setChatSearchResults([])
      setChatSearchIndex(-1)
      return
    }
    const term = chatSearchTerm.toLowerCase()
    const results: number[] = []
    chatMessages.forEach((msg, idx) => {
      const meta = (msg as any).metadata
      const matchContent = msg.content?.toLowerCase().includes(term)
      const matchType = msg.type?.toLowerCase().includes(term)
      const matchSender = meta?.senderName?.toLowerCase().includes(term) || meta?.senderPhone?.includes(term)
      const matchMedia = (msg as any).mediaUrl?.toLowerCase().includes(term)
      if (matchContent || matchType || matchSender || matchMedia) {
        results.push(idx)
      }
    })
    setChatSearchResults(results)
    setChatSearchIndex(results.length > 0 ? results.length - 1 : -1)
  }, [chatSearchTerm, chatMessages])

  // Scroll to highlighted search result
  useEffect(() => {
    if (chatSearchIndex < 0 || chatSearchResults.length === 0) return
    const msgIdx = chatSearchResults[chatSearchIndex]
    const el = document.getElementById(`msg-${msgIdx}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [chatSearchIndex, chatSearchResults])

  // Close chat search when switching chats
  useEffect(() => {
    setShowChatSearch(false)
    setChatSearchTerm('')
    setShowContactInfo(false)
    setContactInfoData(null)
    // Pre-populate messages cache from sessionStorage
    if (selectedChat) {
      try {
        const cached = sessionStorage.getItem(`msgs-${selectedChat}`)
        if (cached && !queryClient.getQueryData(['chat-messages', selectedInstance, selectedChat])) {
          queryClient.setQueryData(['chat-messages', selectedInstance, selectedChat], JSON.parse(cached))
        }
      } catch {}
    }
  }, [selectedChat, selectedInstance, queryClient])

  // ── CRM Actions ──
  const updateConvStatus = useCallback(async (conversationId: string, newStatus: string) => {
    try {
      await api.patch(`/conversations/${conversationId}/status`, { status: newStatus })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    } catch (err) {
      console.error('updateConvStatus error:', err)
    }
  }, [selectedInstance, queryClient])

  const updateConvAssignment = useCallback(async (conversationId: string, assigneeId: string | null, teamId: string | null) => {
    try {
      await api.patch(`/conversations/${conversationId}/assignment`, { assigneeId, teamId })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    } catch (err) {
      console.error('updateConvAssignment error:', err)
    }
  }, [selectedInstance, queryClient])

  const addLabelToConv = useCallback(async (conversationId: string, labelId: string) => {
    try {
      await api.post(`/labels/conversations/${conversationId}`, { labelId })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    } catch (err) {
      console.error('addLabelToConv error:', err)
    }
  }, [selectedInstance, queryClient])

  const removeLabelFromConv = useCallback(async (conversationId: string, labelId: string) => {
    try {
      await api.delete(`/labels/conversations/${conversationId}/${labelId}`)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
    } catch (err) {
      console.error('removeLabelFromConv error:', err)
    }
  }, [selectedInstance, queryClient])

  const assignAiAgent = useCallback(async (conversationId: string, agentId: string) => {
    try {
      await api.post(`/conversations/${conversationId}/assign-ai`, { agentId })
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      queryClient.invalidateQueries({ queryKey: ['ai-session'] })
    } catch (err) {
      console.error('assignAiAgent error:', err)
    }
  }, [selectedInstance, queryClient])

  const removeAiAgent = useCallback(async (conversationId: string) => {
    try {
      await api.delete(`/conversations/${conversationId}/assign-ai`)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      queryClient.invalidateQueries({ queryKey: ['ai-session'] })
    } catch (err) {
      console.error('removeAiAgent error:', err)
    }
  }, [selectedInstance, queryClient])

  // ── Contact info fetching (with caching — only calls Evo Go API when needed) ──
  const contactInfoCache = useRef<Record<string, { data: any; timestamp: number }>>({})
  const CONTACT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes local cache

  const fetchContactInfo = useCallback(async (forceRefresh = false) => {
    if (!selectedInstance || !selectedChat) return
    const jid = selectedChat
    const cacheKey = `${selectedInstance}:${jid}`
    
    // Check local cache first (instant load)
    const cached = contactInfoCache.current[cacheKey]
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CONTACT_CACHE_TTL) {
      setContactInfoData(cached.data)
      setShowContactInfo(true)
      return
    }

    setLoadingContactInfo(true)
    setShowContactInfo(true)
    try {
      const isGrp = jid.includes('@g.us')
      const isNl = jid.includes('@newsletter')

      if (isNl) {
        const nl = newslettersMeta[jid]
        const data = {
          type: 'newsletter',
          Name: nl?.name || jid.replace('@newsletter', ''),
          Description: nl?.description || '',
          SubscriberCount: nl?.subscriberCount || 0,
        }
        setContactInfoData(data)
        contactInfoCache.current[cacheKey] = { data, timestamp: Date.now() }
      } else if (isGrp) {
        const res = await api.get(`/messages/group-info/${selectedInstance}/${encodeURIComponent(jid)}`)
        const data = { type: 'group', ...res.data.groupInfo }
        setContactInfoData(data)
        contactInfoCache.current[cacheKey] = { data, timestamp: Date.now() }
        // Update avatarCache if a new local profile picture was returned after sync
        if (forceRefresh && data.profilePicture) {
          setAvatarCache((prev: Record<string, string | null>) => ({ ...prev, [jid]: data.profilePicture }))
        }
      } else {
        // Contact: backend now caches Evo Go data, returns instantly from DB on subsequent calls
        const refreshParam = forceRefresh ? '?refresh=true' : ''
        const res = await api.get(`/messages/contact-info/${selectedInstance}/${encodeURIComponent(jid)}${refreshParam}`)
        const data = { type: 'contact', ...res.data.contactInfo }
        setContactInfoData(data)
        contactInfoCache.current[cacheKey] = { data, timestamp: Date.now() }
        // Update avatarCache if a new local profile picture was returned after sync
        if (forceRefresh && data.profilePicture) {
          setAvatarCache((prev: Record<string, string | null>) => ({ ...prev, [jid]: data.profilePicture }))
        }
      }
    } catch (err) {
      console.error('Contact info error:', err)
      setContactInfoData({ type: selectedChat.includes('@g.us') ? 'group' : selectedChat.includes('@newsletter') ? 'newsletter' : 'contact', error: true })
    } finally {
      setLoadingContactInfo(false)
    }
  }, [selectedInstance, selectedChat, newslettersMeta])

  // ── Fetch notes for the current contact ──
  const fetchContactNotes = useCallback(async () => {
    if (!selectedInstance || !selectedChat) return
    setLoadingNotes(true)
    try {
      const { data } = await api.get(`/messages/notes/${selectedInstance}/${encodeURIComponent(selectedChat)}`)
      setContactNotes(data.notes || [])
    } catch (err) {
      console.error('Fetch notes error:', err)
      setContactNotes([])
    } finally {
      setLoadingNotes(false)
    }
  }, [selectedInstance, selectedChat])

  // ── Contact inline editing ──
  const saveContactField = useCallback(async (field: string, value: any) => {
    if (!contactInfoData?.contactId) return
    setSavingContactField(true)
    try {
      const payload: any = {}
      if (field === 'tags') {
        payload.tags = typeof value === 'string'
          ? value.split(',').map((t: string) => t.trim()).filter(Boolean)
          : value
      } else {
        payload[field] = value
      }
      await api.put(`/contacts/${contactInfoData.contactId}`, payload)
      // Update local cache
      const updatedData = { ...contactInfoData, ...payload }
      setContactInfoData(updatedData)
      const cacheKey = `${selectedInstance}:${selectedChat}`
      contactInfoCache.current[cacheKey] = { data: updatedData, timestamp: Date.now() }
      // Also invalidate contacts list cache
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    } catch (err) {
      console.error('Save contact field error:', err)
    } finally {
      setSavingContactField(false)
      setEditingContactField(null)
    }
  }, [contactInfoData, selectedInstance, selectedChat, queryClient])

  const saveCustomAttribute = useCallback(async (attributeKey: string, value: any) => {
    if (!contactInfoData?.contactId) return
    setSavingContactField(true)
    try {
      await api.post(`/custom-attributes/contacts/${contactInfoData.contactId}`, {
        attributeKey,
        value,
      })
      // Update local cache
      const newMeta = { ...(contactInfoData.metadata || {}), [attributeKey]: value }
      const updatedData = { ...contactInfoData, metadata: newMeta }
      setContactInfoData(updatedData)
      const cacheKey = `${selectedInstance}:${selectedChat}`
      contactInfoCache.current[cacheKey] = { data: updatedData, timestamp: Date.now() }
    } catch (err) {
      console.error('Save custom attribute error:', err)
    } finally {
      setSavingContactField(false)
      setShowCustomAttrEditor(null)
    }
  }, [contactInfoData, selectedInstance, selectedChat])

  // Close context menu on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Pin / Unpin conversation
  const handlePinConversation = useCallback((conv: any) => {
    const isPinned = !!conv.pinnedAt
    const newPinnedAt = isPinned ? null : new Date().toISOString()

    const applyPin = (pinnedAt: string | null) => {
      queryClient.setQueryData(
        ['conversations', selectedInstance],
        (old: any) => {
          if (!old?.conversations) return old
          const updated = {
            ...old,
            conversations: old.conversations.map((c: any) =>
              c.conversationId === conv.conversationId
                ? { ...c, pinnedAt }
                : c
            ),
          }
          // Keep sessionStorage in sync so reload shows correct state
          try { sessionStorage.setItem(`convs-${selectedInstance}`, JSON.stringify(updated)) } catch {}
          return updated
        }
      )
    }

    // Optimistic update FIRST — instant visual feedback
    applyPin(newPinnedAt)
    setContextMenu(null)
    // Fire API in background — no await
    api.post(`/conversations/${conv.conversationId}/${isPinned ? 'unpin' : 'pin'}`)
      .catch((err) => {
        console.error('Erro ao fixar conversa:', err)
        applyPin(conv.pinnedAt ?? null)
      })
  }, [selectedInstance, queryClient])

  // Delete conversation (soft-delete)
  const handleDeleteConversation = useCallback(async (conv: any) => {
    setDeleteConfirm(conv)
    setContextMenu(null)
  }, [])

  const confirmDelete = useCallback(async () => {
    const conv = deleteConfirm
    if (!conv) return
    setDeleteConfirm(null)
    try {
      await api.delete(`/conversations/${conv.conversationId}`)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      if (selectedChat === conv.remoteJid) {
        setSelectedChat('')
      }
    } catch (err) {
      console.error('Erro ao apagar conversa:', err)
    }
  }, [deleteConfirm, selectedInstance, selectedChat, queryClient])

  // Restore conversation
  const handleRestoreConversation = useCallback(async (conv: any) => {
    try {
      await api.post(`/conversations/${conv.conversationId}/restore`)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
      queryClient.invalidateQueries({ queryKey: ['deleted-conversations', selectedInstance] })
    } catch (err) {
      console.error('Erro ao restaurar conversa:', err)
      alert('Erro ao restaurar a conversa')
    }
  }, [selectedInstance, queryClient])

  // Conversation counts
  const convCounts = useMemo(() => {
    const counts = { DIRECT: 0, GROUP: 0, CHANNEL: 0, ALL_STATUS: 0, OPEN: 0, PENDING: 0, CLOSED: 0, SNOOZED: 0 }
    for (const c of conversations) {
      if (c.remoteJid.includes('@g.us')) counts.GROUP++
      else if (c.remoteJid.includes('@newsletter')) counts.CHANNEL++
      else counts.DIRECT++
      counts.ALL_STATUS++
      if (c.status && (counts as any)[c.status] !== undefined) (counts as any)[c.status]++
    }
    return counts
  }, [conversations])

  const filteredConversations = useMemo(() => {
    // When viewing deleted, use deletedConversations list
    const sourceList = statusFilter === 'DELETED' ? deletedConversations : conversations
    const filtered = sourceList.filter((c: any) => {
    // Type filter
    if (typeFilter === 'DIRECT' && (c.remoteJid.includes('@g.us') || c.remoteJid.includes('@newsletter'))) return false
    if (typeFilter === 'GROUP' && !c.remoteJid.includes('@g.us')) return false
    if (typeFilter === 'CHANNEL' && !c.remoteJid.includes('@newsletter')) return false
    // Status filter (skip for DELETED since we already filtered the source)
    if (statusFilter !== 'ALL' && statusFilter !== 'DELETED' && c.status !== statusFilter) return false
    // Assignee filter
    if (assigneeFilter === 'MINE' && !c.assigneeId) return false
    if (assigneeFilter === 'UNASSIGNED' && c.assigneeId) return false
    // Label filter
    if (labelFilter && !c.labels?.some((l: any) => l.id === labelFilter)) return false
    // Text search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        c.remoteJid.toLowerCase().includes(term) ||
        (c.contactName && c.contactName.toLowerCase().includes(term)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(term))
      )
    }
    return true
    })
    // Pinned conversations always on top (stable sort)
    return [...filtered].sort((a: any, b: any) => {
      const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
      const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
      if (aPinned && !bPinned) return -1
      if (!aPinned && bPinned) return 1
      return 0
    })
  }, [statusFilter, deletedConversations, conversations, typeFilter, assigneeFilter, labelFilter, searchTerm])

  const selectedConv = conversations.find(c => c.remoteJid === selectedChat)
  const currentInstance = instances?.find(i => i.id === selectedInstance)
  const isGroup = selectedChat?.includes('@g.us')
  const isNewsletter = selectedChat?.includes('@newsletter')

  // Cards vinculados à conversa selecionada
  const { data: conversationCards, refetch: refetchConversationCards } = useQuery({
    queryKey: ['conversation-cards', selectedConv?.conversationId],
    queryFn: () => getCardsByConversation(selectedConv!.conversationId),
    enabled: !!selectedConv?.conversationId,
    staleTime: 15000,
  })

  // Sessão de IA ativa da conversa selecionada
  const { data: aiSessionData, refetch: refetchAiSession } = useQuery<{
    session: { id: string; agentId: string; agentName: string; status: string; messageCount: number; tokensUsed: number; startedAt: string; lastActivity: string } | null;
    aiPaused?: boolean;
    aiPausedAt?: string | null;
    aiPausedReason?: string | null;
  }>({
    queryKey: ['ai-session', selectedConv?.conversationId],
    queryFn: async () => (await api.get(`/conversations/${selectedConv?.conversationId}/ai-session`)).data,
    enabled: !!selectedConv?.conversationId,
    staleTime: 10000,
  })
  const activeAiSession = aiSessionData?.session || null
  const conversationAiPaused = aiSessionData?.aiPaused === true

  // Toggle manual de pausa da IA por conversa (mesmo sem sessão criada)
  const toggleConversationAiPause = useCallback(async (paused: boolean, reason?: string) => {
    if (!selectedConv?.conversationId) return
    try {
      await api.patch(`/conversations/${selectedConv.conversationId}/ai-pause`, { paused, reason })
      await refetchAiSession()
    } catch (err: any) {
      console.error('[ai-pause] failed:', err?.response?.data || err.message)
      alert(err?.response?.data?.error || 'Falha ao alterar pausa da IA')
    }
  }, [selectedConv?.conversationId, refetchAiSession])

  // Scheduled messages for current contact
  const { data: contactSchedules } = useQuery({
    queryKey: ['contact-schedules', selectedInstance, selectedChat],
    queryFn: async () => {
      const { data } = await api.get('/schedules', { params: { remoteJid: selectedChat, instanceId: selectedInstance } })
      return data
    },
    enabled: !!selectedInstance && !!selectedChat && showContactInfo,
    staleTime: 15000,
  })

  // Helper: get display name for a conversation (uses group metadata or contact name)
  const getConvDisplayName = useCallback((conv: Conversation) => {
    if (conv.remoteJid.includes('@newsletter')) {
      const meta = newslettersMeta[conv.remoteJid]
      if (meta?.name) return meta.name
      if (conv.contactName && !conv.contactName.startsWith('Canal ')) return conv.contactName
      return formatPhone(conv.remoteJid)
    }
    if (conv.remoteJid.includes('@g.us')) {
      // Try group metadata first, then contact name
      const meta = groupsMeta[conv.remoteJid]
      if (meta?.name) return meta.name
      if (conv.contactName && !conv.contactName.startsWith('Grupo ')) return conv.contactName
    }
    return conv.contactName || formatPhone(conv.remoteJid)
  }, [groupsMeta, newslettersMeta])

  // Get group name for header
  const chatDisplayName = useMemo(() => {
    if (!selectedChat) return ''
    if (isNewsletter) {
      const nl = newslettersMeta[selectedChat]
      if (nl?.name) return nl.name
      if (selectedConv?.contactName && !selectedConv.contactName.startsWith('Canal ')) return selectedConv.contactName
      return formatPhone(selectedChat)
    }
    if (isGroup) {
      const gn = groupInfo?.Name || groupsMeta[selectedChat]?.name
      if (gn) return gn
      if (selectedConv?.contactName && !selectedConv.contactName.startsWith('Grupo ')) return selectedConv.contactName
    }
    return selectedConv?.contactName || formatPhone(selectedChat)
  }, [selectedChat, isGroup, isNewsletter, groupInfo, groupsMeta, newslettersMeta, selectedConv])

  // Group subtitle (participant count)
  const groupSubtitle = useMemo(() => {
    if (isNewsletter) {
      const nl = newslettersMeta[selectedChat || '']
      if (nl?.subscriberCount) return `${nl.subscriberCount} inscritos`
      return 'Canal'
    }
    if (!isGroup) return formatPhone(selectedChat || '')
    const count = groupInfo?.ParticipantCount || groupInfo?.Participants?.length || groupsMeta[selectedChat || '']?.participantCount
    if (count) return `${count} participantes`
    return 'Grupo'
  }, [isGroup, isNewsletter, selectedChat, groupInfo, groupsMeta, newslettersMeta])

  return (
    <div className="flex h-full bg-[var(--chat-sidebar)] rounded-xl overflow-hidden border border-[var(--chat-border)]">
      {/* ═══════ LEFT PANEL: Conversations List ═══════ */}
      <div className="w-[380px] min-w-[320px] flex flex-col border-r border-[var(--chat-border)] bg-[var(--chat-sidebar)]">
        {/* Header */}
        <div className="h-14 px-4 flex items-center justify-between bg-[var(--chat-header)]">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-[var(--chat-accent)] text-white text-sm font-medium">
                {currentInstance?.name?.slice(0, 2).toUpperCase() || 'WA'}
              </AvatarFallback>
            </Avatar>
            <select
              className="bg-transparent text-[var(--chat-text-primary)] text-sm font-medium border-none outline-none cursor-pointer"
              value={selectedInstance}
              onChange={e => { setSelectedInstance(e.target.value); setSelectedChat(null); setAvatarCache({}); avatarFetchedRef.current.clear() }}
            >
              {instances?.map(inst => (
                <option key={inst.id} value={inst.id} className="bg-[var(--chat-dropdown-bg)] text-[var(--chat-text-primary)]">
                  {inst.name} {inst.status === 'CONNECTED' ? '●' : '○'}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowNewConversation(true)}
            className="p-2 rounded-lg text-[var(--chat-text-secondary)] hover:text-[var(--chat-accent)] hover:bg-[var(--chat-sidebar-active)] transition-colors"
            title="Nova conversa"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 bg-[var(--chat-sidebar)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--chat-text-secondary)]" />
            <input
              type="text"
              placeholder="Pesquisar ou começar uma nova conversa"
              className="w-full pl-10 pr-3 py-1.5 rounded-lg bg-[var(--chat-header)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] text-sm border-none outline-none focus:ring-1 focus:ring-[var(--chat-accent)]/30"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Type Tabs: Conversas | Grupos | Canais */}
        <div className="flex items-center bg-[var(--chat-header)] border-b border-[var(--chat-border)]">
          {[
            { key: 'DIRECT', label: 'Conversas', icon: MessageCircle, count: convCounts.DIRECT },
            { key: 'GROUP', label: 'Grupos', icon: Users, count: convCounts.GROUP },
            { key: 'CHANNEL', label: 'Canais', icon: Megaphone, count: convCounts.CHANNEL },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors relative ${
                typeFilter === f.key
                  ? 'text-[var(--chat-accent)]'
                  : 'text-[var(--chat-text-secondary)] hover:text-[var(--chat-text-primary)]'
              }`}
            >
              <f.icon className="h-3.5 w-3.5" />
              {f.label}
              {f.count > 0 && (
                <span className={`text-[10px] min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 ${
                  typeFilter === f.key ? 'bg-[var(--chat-accent)]/20 text-[var(--chat-accent)]' : 'bg-[var(--chat-sidebar-active)] text-[var(--chat-text-secondary)]'
                }`}>{f.count}</span>
              )}
              {typeFilter === f.key && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--chat-accent)] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Compact Filter Row: Status dropdown + Label dropdown + Assignee dropdown */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[var(--chat-sidebar)] border-b border-[var(--chat-border)]/50">
          {/* Status dropdown */}
          <div className="relative" ref={filterDropdownRef}>
            <button
              onClick={() => setShowFilterDropdown(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-all ${
                statusFilter !== 'ALL'
                  ? 'bg-[var(--chat-accent)]/15 text-[var(--chat-accent)] font-semibold ring-1 ring-[var(--chat-accent)]/30'
                  : 'text-[var(--chat-text-secondary)] hover:bg-[var(--chat-header)]'
              }`}
            >
              <CircleDot className={`h-3 w-3 ${
                statusFilter === 'OPEN' ? 'text-green-400' :
                statusFilter === 'PENDING' ? 'text-yellow-400' :
                statusFilter === 'SNOOZED' ? 'text-blue-400' :
                statusFilter === 'RESOLVED' ? 'text-gray-400' :
                statusFilter === 'DELETED' ? 'text-red-400' : 'text-[var(--chat-text-secondary)]'
              }`} />
              {statusFilter === 'ALL' ? 'Status' : statusFilter === 'OPEN' ? 'Abertas' : statusFilter === 'PENDING' ? 'Pendentes' : statusFilter === 'SNOOZED' ? 'Adiadas' : statusFilter === 'DELETED' ? 'Deletadas' : 'Resolvidas'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showFilterDropdown && (
              <div className="absolute z-30 left-0 mt-1 w-40 py-1 rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg">
                {[
                  { key: 'ALL', label: 'Todos os status', dot: 'bg-gray-500' },
                  { key: 'OPEN', label: 'Abertas', dot: 'bg-green-400' },
                  { key: 'PENDING', label: 'Pendentes', dot: 'bg-yellow-400' },
                  { key: 'SNOOZED', label: 'Adiadas', dot: 'bg-blue-400' },
                  { key: 'RESOLVED', label: 'Resolvidas', dot: 'bg-gray-400' },
                  { key: 'DELETED', label: 'Deletadas', dot: 'bg-red-400' },
                ].map(s => (
                  <button
                    key={s.key}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--chat-dropdown-hover)] transition-colors ${
                      statusFilter === s.key ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'
                    }`}
                    onClick={() => { setStatusFilter(s.key); setShowFilterDropdown(false) }}
                  >
                    <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                    {s.label}
                    <span className="ml-auto text-[10px] text-[var(--chat-text-secondary)]">
                      {s.key === 'ALL' ? convCounts.ALL_STATUS : (convCounts as any)[s.key] || 0}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Label filter dropdown */}
          <div className="relative" ref={labelFilterRef}>
            <button
              onClick={() => setShowLabelFilterDD(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-all ${
                labelFilter
                  ? 'bg-[var(--chat-accent)]/15 text-[var(--chat-accent)] font-semibold ring-1 ring-[var(--chat-accent)]/30'
                  : 'text-[var(--chat-text-secondary)] hover:bg-[var(--chat-header)]'
              }`}
            >
              <Tag className="h-3 w-3" />
              {labelFilter ? allLabels.find(l => l.id === labelFilter)?.title || 'Etiqueta' : 'Etiqueta'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showLabelFilterDD && (
              <div className="absolute z-30 left-0 mt-1 w-44 py-1 rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[250px] overflow-y-auto custom-scrollbar">
                <button
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--chat-dropdown-hover)] transition-colors ${!labelFilter ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                  onClick={() => { setLabelFilter(''); setShowLabelFilterDD(false) }}
                >
                  Todas etiquetas
                </button>
                {allLabels.map(l => (
                  <button
                    key={l.id}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--chat-dropdown-hover)] transition-colors ${labelFilter === l.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                    onClick={() => { setLabelFilter(l.id); setShowLabelFilterDD(false) }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color || '#6b7280' }} />
                    <span className="truncate">{l.title}</span>
                  </button>
                ))}
                {allLabels.length === 0 && (
                  <p className="px-3 py-1.5 text-[10px] text-[var(--chat-text-secondary)]">Nenhuma etiqueta criada</p>
                )}
              </div>
            )}
          </div>

          {/* Assignee compact dropdown */}
          <div className="relative ml-auto" ref={assigneeFilterRef}>
            <button
              onClick={() => setShowAssigneeFilterDD(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-all ${
                assigneeFilter !== 'ALL'
                  ? 'bg-[var(--chat-accent)]/15 text-[var(--chat-accent)] font-semibold ring-1 ring-[var(--chat-accent)]/30'
                  : 'text-[var(--chat-text-secondary)] hover:bg-[var(--chat-header)]'
              }`}
            >
              <UserPlus className="h-3 w-3" />
              {assigneeFilter === 'ALL' ? 'Agente' : assigneeFilter === 'MINE' ? 'Minhas' : 'Sem agente'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showAssigneeFilterDD && (
              <div className="absolute z-30 right-0 mt-1 w-36 py-1 rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg">
                {[
                  { key: 'ALL', label: 'Todos' },
                  { key: 'MINE', label: 'Minhas' },
                  { key: 'UNASSIGNED', label: 'Sem agente' },
                ].map(f => (
                  <button
                    key={f.key}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--chat-dropdown-hover)] transition-colors ${assigneeFilter === f.key ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                    onClick={() => { setAssigneeFilter(f.key); setShowAssigneeFilterDD(false) }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Active filters indicator - clear all */}
          {(statusFilter !== 'OPEN' || assigneeFilter !== 'ALL' || labelFilter) && (
            <button
              onClick={() => { setStatusFilter('OPEN'); setAssigneeFilter('ALL'); setLabelFilter('') }}
              className="p-1 rounded hover:bg-[var(--chat-dropdown-hover)] transition-colors" title="Limpar filtros"
            >
              <X className="h-3 w-3 text-[var(--chat-text-secondary)]" />
            </button>
          )}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loadingConversations ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-accent)]" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <MessageSquare className="h-12 w-12 text-[var(--chat-text-secondary)] mb-3" />
              <p className="text-[var(--chat-text-secondary)] text-sm text-center">
                {!selectedInstance ? 'Selecione uma instância' :
                  searchTerm ? 'Nenhuma conversa encontrada' :
                  `Nenhuma ${typeFilter === 'GROUP' ? 'grupo' : typeFilter === 'CHANNEL' ? 'canal' : 'conversa'}${
                    statusFilter !== 'ALL' ? ` ${statusFilter === 'OPEN' ? 'aberta' : statusFilter === 'PENDING' ? 'pendente' : statusFilter === 'SNOOZED' ? 'adiada' : statusFilter === 'DELETED' ? 'deletada' : 'resolvida'}` : ''
                  }${labelFilter ? ` com esta etiqueta` : ''}`
                }
              </p>
            </div>
          ) : (
            filteredConversations.map(conv => (
              <div
                key={conv.remoteJid}
                onClick={() => {
                  unreadCountOnOpenRef.current = conv.unreadCount || 0
                  chatJustOpenedRef.current = true
                  // Force refetch even if clicking the same conversation
                  if (selectedChat === conv.remoteJid) {
                    queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedInstance, conv.remoteJid] })
                  }
                  setSelectedChat(conv.remoteJid)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, conv })
                }}
                className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors border-b border-[var(--chat-border)]/50 ${
                  selectedChat === conv.remoteJid
                    ? 'bg-[var(--chat-sidebar-active)]'
                    : 'hover:bg-[var(--chat-header)]'
                }`}
              >
                <Avatar className="h-12 w-12 shrink-0">
                  {avatarCache[conv.remoteJid] ? (
                    <AvatarImage src={getAvatarUrl(avatarCache[conv.remoteJid])} alt={conv.contactName || ''} className="object-cover" />
                  ) : null}
                  <AvatarFallback className={`${avatarColor(conv.remoteJid)} text-white text-sm font-medium`}>
                    {conv.remoteJid.includes('@g.us')
                      ? <Users className="h-5 w-5" />
                      : conv.remoteJid.includes('@newsletter')
                      ? <Mic className="h-5 w-5" />
                      : getInitials(conv.contactName, conv.remoteJid)
                    }
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5 truncate">
                      {/* Status dot indicator */}
                      <span className={`h-2 w-2 rounded-full shrink-0 ${
                        conv.status === 'OPEN' ? 'bg-green-400' :
                        conv.status === 'PENDING' ? 'bg-yellow-400' :
                        conv.status === 'SNOOZED' ? 'bg-blue-400' :
                        conv.status === 'RESOLVED' ? 'bg-gray-500' :
                        'bg-gray-600'
                      }`} title={{
                        OPEN: 'Aberta', PENDING: 'Pendente', SNOOZED: 'Adiada', RESOLVED: 'Resolvida'
                      }[conv.status as string] || conv.status || 'Sem status'} />
                      {conv.pinnedAt && (
                        <Pin className="h-3 w-3 shrink-0 text-[var(--chat-accent)] opacity-70" aria-label="Conversa fixada" />
                      )}
                      <span className="text-[var(--chat-text-primary)] text-[15px] font-normal truncate">
                        {getConvDisplayName(conv)}
                      </span>
                      {conv.aiSessionStatus && (
                        <span className={`shrink-0 text-xs ${conv.aiSessionStatus === 'OPENED' ? 'text-purple-400' : 'text-yellow-400'}`} title={conv.aiSessionStatus === 'OPENED' ? `IA ativa: ${conv.aiAgentName || 'IA'}` : `IA pausada: ${conv.aiAgentName || 'IA'}`}>
                          🤖
                        </span>
                      )}
                    </div>
                    <span className={`text-xs shrink-0 ml-2 ${conv.unreadCount > 0 ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-secondary)]'}`}>
                      {formatMessageTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-[var(--chat-text-secondary)] text-sm truncate pl-3.5">
                      {conv.lastDirection === 'OUTBOUND' && (
                        <span title="Mensagem enviada"><Check className="h-4 w-4 mr-1 shrink-0 text-[var(--chat-tick-read)]" /></span>
                      )}
                      <MessageTypeIcon type={conv.lastMessageType} />
                      <span className="truncate">{lastMsgPreview(conv)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">
                      {conv.assigneeName && (
                        <span className="text-[10px] text-[var(--chat-text-secondary)] flex items-center gap-0.5" title={conv.assigneeName}>
                          <UserPlus className="h-3 w-3" />
                        </span>
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="bg-[var(--chat-accent)] text-[var(--chat-unread-badge-text)] text-xs font-medium rounded-full h-5 min-w-[20px] flex items-center justify-center px-1.5">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* CRM: labels */}
                  {conv.labels?.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 pl-3.5 flex-wrap">
                      {conv.labels.slice(0, 3).map((lbl: any) => (
                        <span key={lbl.id} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full text-white leading-none" style={{ backgroundColor: lbl.color || '#6b7280' }}>
                          {lbl.title}
                        </span>
                      ))}
                      {conv.labels.length > 3 && (
                        <span className="text-[10px] text-[var(--chat-text-secondary)]">+{conv.labels.length - 3}</span>
                      )}
                    </div>
                  )}
                  {/* Restore button for deleted conversations */}
                  {statusFilter === 'DELETED' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestoreConversation(conv) }}
                      className="mt-1.5 ml-3.5 text-[11px] px-2 py-1 bg-green-500/15 text-green-400 rounded-md hover:bg-green-500/25 transition-colors flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restaurar
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Delete confirmation dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] rounded-xl shadow-2xl p-6 w-80 mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start gap-3 mb-4">
                <Trash2 className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[var(--chat-text-primary)] font-medium text-sm">Apagar conversa</p>
                  <p className="text-[var(--chat-text-secondary)] text-sm mt-1">
                    Apagar a conversa com <span className="font-medium text-[var(--chat-text-primary)]">{deleteConfirm.contactName || deleteConfirm.remoteJid}</span>?
                  </p>
                  <p className="text-[var(--chat-text-secondary)] text-xs mt-2">O histórico será preservado e poderá ser consultado na aba "Deletadas".</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-1.5 text-sm rounded-lg text-[var(--chat-text-secondary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors">Cancelar</button>
                <button onClick={confirmDelete} className="px-4 py-1.5 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors">Apagar</button>
              </div>
            </div>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="fixed z-50 py-1 min-w-[160px] rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handlePinConversation(contextMenu.conv)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-hover)] transition-colors"
            >
              {contextMenu.conv.pinnedAt ? (
                <><PinOff className="h-3.5 w-3.5" />Desafixar conversa</>
              ) : (
                <><Pin className="h-3.5 w-3.5" />Fixar conversa</>
              )}
            </button>
            <div className="my-1 border-t border-[var(--chat-border)]" />
            <button
              onClick={() => handleDeleteConversation(contextMenu.conv)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Apagar conversa
            </button>
          </div>
        )}
      </div>

      {/* ═══════ RIGHT PANEL: Chat Area ═══════ */}
      {!selectedChat ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-[var(--chat-scrollbtn)]">
          <div className="text-center max-w-md">
            <div className="w-[300px] h-[200px] mx-auto mb-8 flex items-center justify-center">
              <MessageSquare className="h-24 w-24 text-[var(--chat-text-secondary)]" strokeWidth={1} />
            </div>
            <h2 className="text-[var(--chat-text-primary)] text-3xl font-light mb-3">CRM IMPA WhatsApp</h2>
            <p className="text-[var(--chat-text-secondary)] text-sm leading-relaxed">
              Envie e receba mensagens em tempo real. Selecione uma conversa ao lado para começar.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Chat Header */}
          <div className="h-14 px-4 flex items-center gap-3 bg-[var(--chat-header)] border-b border-[var(--chat-border)] shrink-0">
            <div className="cursor-pointer" onClick={() => fetchContactInfo()}>
              <Avatar className="h-10 w-10">
                {selectedChat && avatarCache[selectedChat] ? (
                  <AvatarImage src={getAvatarUrl(avatarCache[selectedChat])} alt={chatDisplayName} className="object-cover" />
                ) : null}
                <AvatarFallback className={`${avatarColor(selectedChat)} text-white text-sm font-medium`}>
                  {isGroup
                    ? <Users className="h-5 w-5" />
                    : getInitials(selectedConv?.contactName || null, selectedChat)
                  }
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => fetchContactInfo()}>
              <div className="flex items-center gap-2">
                <h3 className="text-[var(--chat-text-primary)] text-base font-normal truncate">
                  {chatDisplayName}
                </h3>
                {selectedConv?.status && selectedConv.status !== 'OPEN' && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                    selectedConv.status === 'RESOLVED' ? 'bg-gray-600 text-gray-200' :
                    selectedConv.status === 'PENDING' ? 'bg-yellow-600/80 text-yellow-100' :
                    selectedConv.status === 'SNOOZED' ? 'bg-blue-600/80 text-blue-100' :
                    'bg-[var(--chat-sidebar-active)] text-[var(--chat-text-secondary)]'
                  }`}>
                    {selectedConv.status === 'RESOLVED' ? 'Resolvida' : selectedConv.status === 'PENDING' ? 'Pendente' : selectedConv.status === 'SNOOZED' ? 'Adiada' : selectedConv.status}
                  </span>
                )}
                {aiStatus?.active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-purple-600 text-purple-100 flex items-center gap-1 animate-pulse">
                    🤖 {aiStatus.agentName || 'IA'}
                  </span>
                )}
                {aiStatus?.status === 'PAUSED' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-yellow-600 text-yellow-100 flex items-center gap-1">
                    ⏸ IA Pausada
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-[var(--chat-text-secondary)] text-xs truncate">
                  {groupSubtitle}
                </p>
                {selectedConv?.assigneeName && (
                  <span className="text-[10px] text-[var(--chat-text-secondary)] flex items-center gap-0.5 shrink-0">· <UserPlus className="h-2.5 w-2.5" />{selectedConv.assigneeName.split(' ')[0]}</span>
                )}
                {selectedConv?.teamName && (
                  <span className="text-[10px] text-[var(--chat-text-secondary)] flex items-center gap-0.5 shrink-0">· <Users className="h-2.5 w-2.5" />{selectedConv.teamName}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* AI pause/resume button */}
              {aiStatus?.active && (
                <button
                  onClick={() => toggleAI('pause')}
                  disabled={togglingAI}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 text-xs transition-colors"
                  title="Pausar IA — quando você enviar uma mensagem, a IA para automaticamente"
                >
                  <Square className="h-3 w-3" /> Pausar IA
                </button>
              )}
              {aiStatus?.status === 'PAUSED' && (
                <button
                  onClick={() => toggleAI('resume')}
                  disabled={togglingAI}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-600/20 text-green-300 hover:bg-green-600/40 text-xs transition-colors"
                  title="Retomar IA — a IA voltará a responder automaticamente"
                >
                  <Play className="h-3 w-3" /> Retomar IA
                </button>
              )}
              {/* ── Resolve / Reopen button ── */}
              {selectedConv?.conversationId && canManage && (
                selectedConv.status === 'RESOLVED' ? (
                  <button
                    onClick={() => updateConvStatus(selectedConv.conversationId, 'OPEN')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--chat-dropdown-hover)] text-[var(--chat-text-secondary)] hover:bg-emerald-600/20 hover:text-emerald-400 border border-[var(--chat-border)] transition-colors"
                    title="Reabrir conversa"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reabrir
                  </button>
                ) : (
                  <button
                    onClick={() => updateConvStatus(selectedConv.conversationId, 'RESOLVED')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-sm"
                    title="Resolver conversa"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Resolver
                  </button>
                )
              )}
              <button
                className={`p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors ${showChatSearch ? 'bg-[var(--chat-dropdown-hover)]' : ''}`}
                title="Pesquisar na conversa"
                onClick={() => { setShowChatSearch(v => !v); if (!showChatSearch) setTimeout(() => chatSearchInputRef.current?.focus(), 100) }}
              >
                <Search className="h-5 w-5 text-[var(--chat-text-secondary)]" />
              </button>
              <button
                className={`p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors ${showContactInfo ? 'bg-[var(--chat-dropdown-hover)]' : ''}`}
                title="Dados do contato"
                onClick={() => fetchContactInfo()}
              >
                <Info className="h-5 w-5 text-[var(--chat-text-secondary)]" />
              </button>
              {/* ⋮ Quick Actions Menu */}
              <div className="relative" ref={headerMenuRef}>
                <button
                  className={`p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors ${showHeaderMenu ? 'bg-[var(--chat-dropdown-hover)]' : ''}`}
                  title="Ações rápidas"
                  onClick={() => { setShowHeaderMenu(v => !v); setHeaderMenuSub(null) }}
                >
                  <MoreVertical className="h-5 w-5 text-[var(--chat-text-secondary)]" />
                </button>
                {showHeaderMenu && selectedConv?.conversationId && (
                  <div className="absolute right-0 top-full mt-1 w-52 py-1 rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-xl z-50">
                    {/* ── Status ── */}
                    <p className="px-3 py-1 text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider">Status</p>
                    {[
                      { key: 'OPEN', label: 'Reabrir conversa', color: 'bg-emerald-400', icon: <RefreshCw className="h-3.5 w-3.5" /> },
                      { key: 'RESOLVED', label: 'Marcar como resolvida', color: 'bg-gray-400', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
                      { key: 'PENDING', label: 'Marcar como pendente', color: 'bg-amber-400', icon: <Clock className="h-3.5 w-3.5" /> },
                      { key: 'SNOOZED', label: 'Adiar conversa', color: 'bg-blue-400', icon: <Pause className="h-3.5 w-3.5" /> },
                    ].filter(s => s.key !== selectedConv.status).map(s => (
                      <button
                        key={s.key}
                        disabled={!canManage}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors text-[var(--chat-text-primary)] ${!canManage ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() => { updateConvStatus(selectedConv.conversationId, s.key); setShowHeaderMenu(false) }}
                      >
                        {s.icon}
                        <span className="flex-1">{s.label}</span>
                        <span className={`h-2 w-2 rounded-full ${s.color}`} />
                      </button>
                    ))}
                    <div className="my-1 border-t border-[var(--chat-border)]" />
                    {/* ── Atribuição ── */}
                    <p className="px-3 py-1 text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider">Atribuição</p>
                    {/* Atribuir agente */}
                    <button
                      disabled={!canAssign}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors text-[var(--chat-text-primary)] ${!canAssign ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => setHeaderMenuSub(headerMenuSub === 'agents' ? null : 'agents')}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span className="flex-1">Atribuir agente</span>
                      {selectedConv.assigneeName && <span className="text-[10px] text-[var(--chat-text-secondary)] truncate max-w-[60px]">{selectedConv.assigneeName.split(' ')[0]}</span>}
                      <ChevronDown className={`h-3 w-3 text-[var(--chat-text-secondary)] transition-transform ${headerMenuSub === 'agents' ? 'rotate-180' : ''}`} />
                    </button>
                    {headerMenuSub === 'agents' && (
                      <div className="mx-2 mb-1 py-0.5 rounded-md bg-[var(--chat-sidebar)] max-h-[160px] overflow-y-auto custom-scrollbar">
                        <button
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                          onClick={() => { updateConvAssignment(selectedConv.conversationId, null, selectedConv.teamId); setShowHeaderMenu(false) }}
                        >
                          <X className="h-3 w-3 text-[var(--chat-text-secondary)]" /> Remover
                        </button>
                        {allUsers.map(u => (
                          <button
                            key={u.id}
                            className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${selectedConv.assigneeId === u.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                            onClick={() => { updateConvAssignment(selectedConv.conversationId, u.id, selectedConv.teamId); setShowHeaderMenu(false) }}
                          >
                            <UserPlus className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                            <span className="truncate flex-1">{u.name}</span>
                            <span className="text-[9px] text-[var(--chat-text-secondary)]">{u.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Atribuir time */}
                    <button
                      disabled={!canAssign}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors text-[var(--chat-text-primary)] ${!canAssign ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => setHeaderMenuSub(headerMenuSub === 'teams' ? null : 'teams')}
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="flex-1">Atribuir time</span>
                      {selectedConv.teamName && <span className="text-[10px] text-[var(--chat-text-secondary)] truncate max-w-[60px]">{selectedConv.teamName}</span>}
                      <ChevronDown className={`h-3 w-3 text-[var(--chat-text-secondary)] transition-transform ${headerMenuSub === 'teams' ? 'rotate-180' : ''}`} />
                    </button>
                    {headerMenuSub === 'teams' && (
                      <div className="mx-2 mb-1 py-0.5 rounded-md bg-[var(--chat-sidebar)] max-h-[160px] overflow-y-auto custom-scrollbar">
                        <button
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                          onClick={() => { updateConvAssignment(selectedConv.conversationId, selectedConv.assigneeId, null); setShowHeaderMenu(false) }}
                        >
                          <X className="h-3 w-3 text-[var(--chat-text-secondary)]" /> Remover
                        </button>
                        {allTeams.map((t: any) => (
                          <button
                            key={t.id}
                            className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${selectedConv.teamId === t.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                            onClick={() => { updateConvAssignment(selectedConv.conversationId, selectedConv.assigneeId, t.id); setShowHeaderMenu(false) }}
                          >
                            <Users className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                            <span className="truncate">{t.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Etiquetas */}
                    <button
                      disabled={!canManage}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors text-[var(--chat-text-primary)] ${!canManage ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => setHeaderMenuSub(headerMenuSub === 'labels' ? null : 'labels')}
                    >
                      <Tag className="h-3.5 w-3.5" />
                      <span className="flex-1">Etiquetas</span>
                      {selectedConv.labels?.length > 0 && <span className="text-[10px] text-[var(--chat-text-secondary)]">{selectedConv.labels.length}</span>}
                      <ChevronDown className={`h-3 w-3 text-[var(--chat-text-secondary)] transition-transform ${headerMenuSub === 'labels' ? 'rotate-180' : ''}`} />
                    </button>
                    {headerMenuSub === 'labels' && (
                      <div className="mx-2 mb-1 py-0.5 rounded-md bg-[var(--chat-sidebar)] max-h-[160px] overflow-y-auto custom-scrollbar">
                        {allLabels.map((l: any) => {
                          const isActive = selectedConv.labels?.some((cl: any) => cl.id === l.id || cl.labelId === l.id)
                          return (
                            <button
                              key={l.id}
                              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${isActive ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                              onClick={() => {
                                if (isActive) { removeLabelFromConv(selectedConv.conversationId, l.id) }
                                else { addLabelToConv(selectedConv.conversationId, l.id) }
                              }}
                            >
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color || '#888' }} />
                              <span className="truncate">{l.title}</span>
                              {isActive && <Check className="h-3 w-3 ml-auto shrink-0" />}
                            </button>
                          )
                        })}
                        {allLabels.length === 0 && <p className="px-2.5 py-1.5 text-[10px] text-[var(--chat-text-secondary)]">Nenhuma etiqueta criada</p>}
                      </div>
                    )}
                    <div className="my-1 border-t border-[var(--chat-border)]" />
                    {/* ── Apagar ── */}
                    <button
                      disabled={!canManage}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-red-500/10 transition-colors text-red-400 ${!canManage ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => { setShowHeaderMenu(false); handleDeleteConversation(selectedConv) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="flex-1">Apagar conversa</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* In-Chat Search Bar */}
          {showChatSearch && (
            <div className="px-3 py-2 bg-[var(--chat-header)] border-b border-[var(--chat-border)] flex items-center gap-2 shrink-0">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--chat-text-secondary)]" />
                <input
                  ref={chatSearchInputRef}
                  type="text"
                  placeholder="Pesquisar mensagens..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[var(--chat-sidebar-active)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] text-sm border-none outline-none focus:ring-1 focus:ring-[var(--chat-accent)]/30"
                  value={chatSearchTerm}
                  onChange={e => setChatSearchTerm(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && chatSearchResults.length > 0) {
                      setChatSearchIndex(prev => prev > 0 ? prev - 1 : chatSearchResults.length - 1)
                    }
                    if (e.key === 'Escape') {
                      setShowChatSearch(false)
                      setChatSearchTerm('')
                    }
                  }}
                  autoFocus
                />
              </div>
              {chatSearchResults.length > 0 && (
                <span className="text-[var(--chat-text-secondary)] text-xs whitespace-nowrap">
                  {chatSearchResults.length - chatSearchIndex} de {chatSearchResults.length}
                </span>
              )}
              {chatSearchResults.length === 0 && chatSearchTerm.trim() && (
                <span className="text-[var(--chat-text-secondary)] text-xs whitespace-nowrap">Nenhum resultado</span>
              )}
              <button
                className="p-1.5 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                title="Anterior"
                onClick={() => setChatSearchIndex(prev => prev > 0 ? prev - 1 : chatSearchResults.length - 1)}
                disabled={chatSearchResults.length === 0}
              >
                <ArrowUp className="h-4 w-4 text-[var(--chat-text-secondary)]" />
              </button>
              <button
                className="p-1.5 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                title="Próximo"
                onClick={() => setChatSearchIndex(prev => prev < chatSearchResults.length - 1 ? prev + 1 : 0)}
                disabled={chatSearchResults.length === 0}
              >
                <ArrowDown className="h-4 w-4 text-[var(--chat-text-secondary)]" />
              </button>
              <button
                className="p-1.5 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                title="Fechar"
                onClick={() => { setShowChatSearch(false); setChatSearchTerm('') }}
              >
                <X className="h-4 w-4 text-[var(--chat-text-secondary)]" />
              </button>
            </div>
          )}

          {/* Memory toasts (estilo "Memória atualizada" do ChatGPT) */}
          {memoryToasts.length > 0 && (
            <div className="absolute top-20 right-4 z-30 flex flex-col gap-2 pointer-events-none">
              {memoryToasts.map(t => (
                <div
                  key={t.id}
                  className="bg-[var(--chat-accent)]/95 text-white px-3 py-2 rounded-lg shadow-lg text-xs max-w-xs animate-in fade-in slide-in-from-top-2"
                >
                  <div className="font-semibold flex items-center gap-1">
                    <span>🧠</span> {t.label}
                  </div>
                  {t.detail && <div className="opacity-90 mt-0.5 line-clamp-2">{t.detail}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Messages Area */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-[4%] md:px-[6%] lg:px-[8%] py-3 space-y-0.5 custom-scrollbar chat-pattern-bg"
          >
            {loadingMessages ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-accent)]" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-[var(--chat-text-secondary)] text-sm bg-[var(--chat-date-bg)] px-4 py-2 rounded-lg shadow">
                  Nenhuma mensagem nesta conversa
                </p>
              </div>
            ) : (
              <>
                {/* Loader de mensagens antigas (infinite scroll up) */}
                {loadingOlder && (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--chat-accent)]" />
                    <span className="ml-2 text-xs text-[var(--chat-text-secondary)]">Carregando mensagens antigas...</span>
                  </div>
                )}
                {!loadingOlder && !hasMoreOlder && chatMessages.length >= 80 && (
                  <div className="flex items-center justify-center py-2">
                    <span className="text-[10px] text-[var(--chat-text-secondary)] bg-[var(--chat-date-bg)] px-2 py-0.5 rounded-full opacity-60">
                      Início da conversa
                    </span>
                  </div>
                )}
                {timelineItems.map((item, timelineIdx) => {
                  // ── Render conversation event ──
                  if (item.type === 'event') {
                    const evt = item.data
                    const eventIcons: Record<string, string> = {
                      ai_session_started: '🤖',
                      ai_session_ended: '🤖',
                      ai_session_paused: '⏸️',
                      ai_session_resumed: '▶️',
                      status_changed: '🔄',
                      assignee_changed: '👤',
                      team_changed: '👥',
                      custom_field_set: '✏️',
                      label_added: '🏷️',
                      label_removed: '🏷️',
                      note_added: '📝',
                      contact_updated: '📋',
                      lead_created: '🎯',
                      lead_converted: '✅',
                      customer_created: '🏢',
                    }
                    const icon = eventIcons[evt.eventType] || 'ℹ️'
                    const time = new Date(evt.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <div key={`evt-${evt.id}`} className="flex items-center justify-center my-1.5">
                        <div className="flex items-center gap-1.5 bg-[var(--chat-date-bg)] text-[var(--chat-text-secondary)] text-[11px] px-3 py-1 rounded-lg shadow max-w-[80%]">
                          <span>{icon}</span>
                          <span className="truncate">{evt.description}</span>
                          <span className="text-[10px] opacity-70 shrink-0 ml-1">{time}</span>
                        </div>
                      </div>
                    )
                  }

                  // ── Render message ──
                  const msg = item.data as Message
                  const idx = chatMessages.indexOf(msg)
                  const showUnreadDivider = unreadDividerIdx >= 0 && idx === unreadDividerIdx

                  const prevMsg = idx > 0 ? chatMessages[idx - 1] : null
                  const showDateSep = !prevMsg || !isSameDay(prevMsg.createdAt, msg.createdAt)
                  const isOut = msg.direction === 'OUTBOUND'
                  const isNote = msg.type === 'note' || (msg as any).metadata?.isNote
                  const senderMeta = (msg as any).metadata
                  const senderPhone = senderMeta?.senderPhone || ''
                  const senderName = senderMeta?.senderName || ''
                  const showSenderInfo = isGroup && !isOut && senderPhone

                  // For groups: check if same sender as previous (by phone, not just direction)
                  const prevSenderPhone = prevMsg ? ((prevMsg as any).metadata?.senderPhone || '') : ''
                  const sameSender = prevMsg && prevMsg.direction === msg.direction && !showDateSep &&
                    (!isGroup || (senderPhone && senderPhone === prevSenderPhone))

                  // Navigate to private chat with this sender
                  const openSenderChat = (phone: string) => {
                    if (!phone) return
                    // Check if conversation exists, then navigate
                    const jid = phone.includes('@') ? phone : phone
                    unreadCountOnOpenRef.current = 0
                    chatJustOpenedRef.current = true
                    setSelectedChat(jid)
                  }

                  return (
                    <div key={msg.id} id={`msg-${idx}`}>
                      {showUnreadDivider && (
                        <div ref={unreadDividerRef} className="flex items-center my-4 gap-3 px-4">
                          <div className="flex-1 border-t border-[var(--chat-unread-divider-border)]" />
                          <span className="bg-[var(--chat-unread-divider-bg)] text-[var(--chat-unread-divider-text)] text-[11px] px-3 py-1.5 rounded-md whitespace-nowrap shadow-sm">
                            {unreadCountOnOpenRef.current} {unreadCountOnOpenRef.current === 1 ? 'mensagem não lida' : 'mensagens não lidas'}
                          </span>
                          <div className="flex-1 border-t border-[var(--chat-unread-divider-border)]" />
                        </div>
                      )}
                      {showDateSep && (
                        <div className="flex items-center justify-center my-3">
                          <span className="bg-[var(--chat-date-bg)] text-[var(--chat-text-secondary)] text-[11px] px-3 py-1 rounded-lg shadow uppercase tracking-wide">
                            {formatDateSeparator(msg.createdAt)}
                          </span>
                        </div>
                      )}

                      <div className={`flex ${isNote ? 'justify-center' : isOut ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-[2px]' : 'mt-2'}`}>
                        <div
                          className={`group relative max-w-[75%] px-2.5 py-1.5 rounded-lg shadow-sm ${
                            chatSearchResults.includes(idx) && chatSearchResults[chatSearchIndex] === idx
                              ? 'ring-2 ring-[var(--chat-accent)]'
                              : chatSearchResults.includes(idx)
                                ? 'ring-1 ring-[var(--chat-accent)]/40'
                                : ''
                          } ${
                            isNote
                              ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                              : isOut
                                ? 'bg-[var(--chat-bubble-out)] text-[var(--chat-text-bubble)]'
                                : 'bg-[var(--chat-bubble-in)] text-[var(--chat-text-bubble)]'
                          } ${!sameSender && !isNote ? (isOut ? 'rounded-tr-none' : 'rounded-tl-none') : ''}`}
                        >
                          {!sameSender && !isNote && (
                            <div className={`absolute top-0 w-3 h-3 overflow-hidden ${isOut ? '-right-[6px]' : '-left-[6px]'}`}>
                              <div className={`w-3 h-3 ${isOut ? 'bg-[var(--chat-bubble-out)]' : 'bg-[var(--chat-bubble-in)]'} ${isOut ? '-translate-x-1/2 rotate-45 origin-top-left' : 'translate-x-1/2 -rotate-45 origin-top-right'}`} />
                            </div>
                          )}

                          {/* Criar FAQ a partir desta resposta da IA */}
                          {isOut && msg.sentByAIAgent && !isNote && (() => {
                            // localizar última mensagem inbound antes desta
                            let prevInbound: typeof msg | null = null
                            for (let i = idx - 1; i >= 0; i--) {
                              if (chatMessages[i].direction === 'INBOUND') { prevInbound = chatMessages[i]; break }
                            }
                            const question = prevInbound?.content || ''
                            const answer = msg.content || ''
                            return (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setFaqModal({ question, answer }) }}
                                title="Criar FAQ a partir desta resposta"
                                className="absolute -top-2 -left-2 opacity-0 group-hover:opacity-100 transition-opacity bg-pink-500 hover:bg-pink-600 text-white rounded-full p-1.5 shadow-lg z-10"
                              >
                                <BookPlus className="h-3 w-3" />
                              </button>
                            )
                          })()}

                          {/* Note header */}
                          {isNote && (
                            <div className="flex items-center gap-1.5 mb-1">
                              <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Nota privada</span>
                              {msg.sentByAIAgent ? (
                                <>
                                  <span className="text-[11px] text-amber-600 dark:text-amber-400/70">— {msg.sentByAIAgent.name}</span>
                                  <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">I.A.</span>
                                </>
                              ) : msg.sentByUser ? (
                                <span className="text-[11px] text-amber-600 dark:text-amber-400/70">— {msg.sentByUser.name}</span>
                              ) : senderMeta?.authorName ? (
                                <span className="text-[11px] text-amber-600 dark:text-amber-400/70">— {senderMeta.authorName}</span>
                              ) : senderMeta?.fromAI ? (
                                <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">I.A.</span>
                              ) : null}
                            </div>
                          )}

                          {/* Sender badge for outbound messages (non-note) */}
                          {isOut && !isNote && !sameSender && (msg.sentByUser || msg.sentByAIAgent) && (
                            <div className="flex items-center gap-1 mb-0.5">
                              {msg.sentByAIAgent ? (
                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                  <Bot className="h-2.5 w-2.5" />
                                  {msg.sentByAIAgent.name}
                                </span>
                              ) : msg.sentByUser ? (
                                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                  <User className="h-2.5 w-2.5" />
                                  {msg.sentByUser.name}
                                </span>
                              ) : null}
                            </div>
                          )}

                          {/* Sender info for group messages */}
                          {showSenderInfo && !sameSender && !isNote && (
                            <p
                              className="text-[12.5px] font-medium mb-0.5 cursor-pointer hover:underline"
                              style={{ color: senderNameColor(senderPhone) }}
                              onClick={() => openSenderChat(senderPhone)}
                              title={`Abrir conversa com ${senderName || senderPhone}`}
                            >
                              {senderName || formatPhone(senderPhone)}
                              {senderName && (
                                <span className="text-[11px] text-[var(--chat-text-secondary)] font-normal ml-1.5">
                                  ~{formatPhone(senderPhone)}
                                </span>
                              )}
                            </p>
                          )}

                          {/* Quoted message bubble (reply) */}
                          {msg.metadata?.quotedStanzaId && (
                            <div
                              className={`rounded-md mb-1 px-2.5 py-1.5 border-l-[3px] cursor-pointer hover:brightness-110 transition-all ${
                                isOut
                                  ? 'bg-[var(--chat-bubble-out-darker)] border-l-[var(--chat-quoted-border-out)]'
                                  : 'bg-[var(--chat-quoted-bg-in)] border-l-[var(--chat-quoted-border-in)]'
                              }`}
                              onClick={() => {
                                const quotedJid = msg.metadata?.quotedRemoteJid
                                const stanzaId = msg.metadata?.quotedStanzaId

                                // If quoted message is from a different chat (e.g. group), navigate there
                                if (quotedJid && quotedJid !== selectedChat) {
                                  // Store the stanzaId to scroll to after navigation
                                  pendingScrollToStanzaRef.current = stanzaId || null
                                  unreadCountOnOpenRef.current = 0
                                  chatJustOpenedRef.current = true
                                  setSelectedChat(quotedJid)
                                  return
                                }

                                // Scroll to the original message if it exists in the current view
                                const origIdx = chatMessages.findIndex(m => m.messageId === stanzaId)
                                if (origIdx >= 0) {
                                  const el = document.getElementById(`msg-${origIdx}`)
                                  if (el) {
                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    el.classList.add('ring-1', 'ring-[var(--chat-accent)]/60', 'rounded-lg')
                                    setTimeout(() => el.classList.remove('ring-1', 'ring-[var(--chat-accent)]/60', 'rounded-lg'), 2000)
                                  }
                                }
                              }}
                            >
                              {/* Group origin indicator for cross-chat replies */}
                              {msg.metadata?.quotedRemoteJid?.includes('@g.us') && (
                                <p className="text-[10px] text-[var(--chat-accent)] flex items-center gap-1 mb-0.5 font-medium">
                                  <Users className="h-3 w-3" />
                                  Do grupo: {groupsMeta[msg.metadata?.quotedRemoteJid]?.name
                                    || conversations.find(c => c.remoteJid === msg.metadata?.quotedRemoteJid)?.contactName
                                    || msg.metadata?.quotedRemoteJid?.replace('@g.us', '')}
                                </p>
                              )}
                              {msg.metadata?.quotedParticipant && (
                                <p className="text-[11px] font-medium mb-0.5" style={{ color: senderNameColor(msg.metadata.quotedParticipant) }}>
                                  {formatPhone(msg.metadata.quotedParticipant)}
                                </p>
                              )}
                              {msg.metadata.quotedType && msg.metadata.quotedType !== 'text' && (
                                <p className="text-[10px] text-[var(--chat-text-secondary)] flex items-center gap-1 mb-0.5">
                                  {msg.metadata.quotedType === 'image' && '📷 Imagem'}
                                  {msg.metadata.quotedType === 'video' && '🎥 Vídeo'}
                                  {msg.metadata.quotedType === 'audio' && '🎵 Áudio'}
                                  {msg.metadata.quotedType === 'document' && '📄 Documento'}
                                  {msg.metadata.quotedType === 'sticker' && '🏷️ Sticker'}
                                </p>
                              )}
                              <p className="text-[11.5px] text-[var(--chat-text-secondary)] line-clamp-2 leading-snug">
                                {msg.metadata.quotedContent || '...'}
                              </p>
                            </div>
                          )}

                          {msg.type === 'image' && (msg as any).mediaUrl && (
                            <img
                              src={getMediaDisplayUrl((msg as any).mediaUrl)}
                              alt=""
                              className="rounded-md mb-1 max-w-[280px] max-h-[220px] object-cover cursor-pointer hover:brightness-90 transition-all"
                              onClick={() => { setLightboxUrl(getMediaDisplayUrl((msg as any).mediaUrl)); setLightboxType('image') }}
                            />
                          )}

                          {msg.type === 'sticker' && (msg as any).mediaUrl && (
                            <img
                              src={getMediaDisplayUrl((msg as any).mediaUrl)}
                              alt="Sticker"
                              className="mb-1 max-w-[180px] max-h-[180px] object-contain cursor-pointer"
                              onClick={() => { setLightboxUrl(getMediaDisplayUrl((msg as any).mediaUrl)); setLightboxType('image') }}
                            />
                          )}

                          {msg.type === 'video' && (msg as any).mediaUrl && (
                            <div
                              className="relative rounded-md mb-1 max-w-full cursor-pointer group"
                              onClick={() => { setLightboxUrl(getMediaDisplayUrl((msg as any).mediaUrl)); setLightboxType('video') }}
                            >
                              <video
                                src={getMediaDisplayUrl((msg as any).mediaUrl)}
                                className="rounded-md max-w-[280px] max-h-[220px]"
                                preload="metadata"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md group-hover:bg-black/40 transition-colors">
                                <div className="bg-[var(--chat-accent)] rounded-full p-3">
                                  <Play className="h-6 w-6 text-white fill-white" />
                                </div>
                              </div>
                            </div>
                          )}

                          {msg.type === 'audio' && (msg as any).mediaUrl && (
                            <div className="mb-1">
                              <audio
                                src={getMediaDisplayUrl((msg as any).mediaUrl)}
                                controls
                                className="max-w-full min-w-[200px] h-[36px]"
                                preload="metadata"
                              />
                              {/* Transcrição já salva no metadata */}
                              {(msg.metadata as any)?.transcription && !transcriptions[msg.messageId] && (
                                <div className="mt-1.5 px-2 py-1.5 rounded bg-black/10 dark:bg-black/20 text-xs text-[var(--chat-text-primary)]">
                                  <span className="text-[var(--chat-tick-read)] font-medium">transcrição:</span>{' '}
                                  {(msg.metadata as any).transcription}
                                </div>
                              )}
                              {/* Transcrição recém-feita */}
                              {transcriptions[msg.messageId] && (
                                <div className="mt-1.5 px-2 py-1.5 rounded bg-black/10 dark:bg-black/20 text-xs text-[var(--chat-text-primary)]">
                                  <span className="text-[var(--chat-tick-read)] font-medium">transcrição:</span>{' '}
                                  {transcriptions[msg.messageId].text}
                                  {transcriptions[msg.messageId].costUsd ? (
                                    <span
                                      className="ml-1 opacity-60 cursor-help"
                                      title={`Custo: US$ ${transcriptions[msg.messageId].costUsd?.toFixed(4)} (valor em dólar americano)`}
                                    >
                                      US$ {transcriptions[msg.messageId].costUsd?.toFixed(4)}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                              {/* Botão de transcrever */}
                              {!(msg.metadata as any)?.transcription && !transcriptions[msg.messageId] && (
                                <button
                                  onClick={() => handleTranscribeAudio(msg.messageId)}
                                  disabled={transcribing === msg.messageId}
                                  className="mt-1 flex items-center gap-1 text-xs text-[var(--chat-tick-read)] hover:text-[var(--chat-accent)] transition-colors disabled:opacity-50"
                                >
                                  {transcribing === msg.messageId ? (
                                    <><Loader2 className="h-3 w-3 animate-spin" /> transcrevendo...</>
                                  ) : (
                                    <><Mic className="h-3 w-3" /> transcrição</>
                                  )}
                                </button>
                              )}
                            </div>
                          )}

                          {msg.type === 'document' && (msg as any).mediaUrl && (
                            <a
                              href={getMediaDisplayUrl((msg as any).mediaUrl)}
                              download
                              className="flex items-center gap-2 bg-[var(--chat-media-overlay)] rounded-md px-3 py-2 mb-1 hover:bg-[var(--chat-sidebar-hover)] transition-colors"
                            >
                              <FileText className="h-8 w-8 text-[var(--chat-tick-read)] shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-[var(--chat-text-primary)] truncate">{msg.content || 'Documento'}</p>
                              </div>
                              <Download className="h-4 w-4 text-[var(--chat-text-secondary)] shrink-0" />
                            </a>
                          )}

                          {/* ═══════ INTERACTIVE MESSAGE BUBBLE ═══════ */}
                          {['button', 'list', 'poll', 'pix', 'carousel'].includes(msg.type) && (msg.metadata as any)?.interactive && (
                            <InteractiveMessageBubble
                              data={(msg.metadata as any).interactive}
                              isOutbound={isOut}
                            />
                          )}

                          <div className="flex items-end gap-2">
                            {/* Show text content: for media with mediaUrl only show if there's a caption; hide for interactive bubbles */}
                            {(['button', 'list', 'poll', 'pix', 'carousel'].includes(msg.type) && (msg.metadata as any)?.interactive) ? null
                            : (msg.type === 'text' || !((msg as any).mediaUrl)) ? (
                              <p className="text-[14.2px] leading-[19px] whitespace-pre-wrap break-words min-w-0">
                                {msg.type !== 'text' && msg.type !== 'image' && msg.type !== 'video' && msg.type !== 'audio' && msg.type !== 'document' && msg.type !== 'sticker' && (
                                  <span className="inline-flex items-center mr-1">
                                    <MessageTypeIcon type={msg.type} />
                                  </span>
                                )}
                                {linkifyText(msg.content)}
                              </p>
                            ) : (msg.content && msg.content !== '[Imagem]' && msg.content !== '[Vídeo]' && msg.content !== '[Áudio]' && msg.content !== '[Documento]' && msg.content !== '[Sticker]' && !msg.content.startsWith('[')) ? (
                              <p className="text-[14.2px] leading-[19px] whitespace-pre-wrap break-words min-w-0">
                                {linkifyText(msg.content)}
                              </p>
                            ) : null}
                            <span className="flex items-center gap-0.5 shrink-0 ml-1 -mb-0.5">
                              <span className="text-[11px] text-[var(--chat-text-secondary)]">{formatChatTime(msg.createdAt)}</span>
                              {isOut && <MessageStatus status={msg.status} />}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </>
            )}

            {showScrollBtn && (
              <button
                onClick={() => scrollToBottom()}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-[var(--chat-header)] text-[var(--chat-text-secondary)] rounded-full p-2 shadow-lg hover:bg-[var(--chat-sidebar-active)] transition-colors z-10"
              >
                <ArrowDown className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Media Preview Overlay */}
          {previewFile && (
            <div className="absolute inset-0 z-50 bg-[var(--chat-sidebar)] flex flex-col">
              {/* Preview header */}
              <div className="h-14 px-4 flex items-center gap-3 bg-[var(--chat-header)] border-b border-[var(--chat-border)] shrink-0">
                <button onClick={closePreview} className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors">
                  <X className="h-5 w-5 text-[var(--chat-text-secondary)]" />
                </button>
                <span className="text-[var(--chat-text-primary)] text-base font-normal">
                  {previewType === 'image' ? 'Enviar imagem' : previewType === 'video' ? 'Enviar vídeo' : previewType === 'audio' ? 'Enviar áudio' : 'Enviar documento'}
                </span>
              </div>

              {/* Preview content */}
              <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
                {previewType === 'image' && (
                  <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
                )}
                {previewType === 'video' && (
                  <video src={previewUrl} controls className="max-w-full max-h-full rounded-lg" />
                )}
                {previewType === 'audio' && (
                  <div className="flex flex-col items-center gap-4">
                    <Mic className="h-16 w-16 text-[var(--chat-accent)]" />
                    <audio src={previewUrl} controls className="min-w-[300px]" />
                    <p className="text-[var(--chat-text-secondary)] text-sm">{previewFile.name}</p>
                  </div>
                )}
                {previewType === 'document' && (
                  <div className="flex flex-col items-center gap-4 bg-[var(--chat-header)] rounded-xl p-8">
                    <FileText className="h-16 w-16 text-[var(--chat-tick-read)]" />
                    <p className="text-[var(--chat-text-primary)] text-base">{previewFile.name}</p>
                    <p className="text-[var(--chat-text-secondary)] text-sm">{(previewFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                )}
              </div>

              {/* Caption + send */}
              <div className="px-4 py-3 bg-[var(--chat-header)] border-t border-[var(--chat-border)] flex items-end gap-3">
                {previewType !== 'audio' && (
                  <div className="flex-1">
                    <textarea
                      className="w-full px-3 py-2 rounded-lg bg-[var(--chat-sidebar-active)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] text-sm border-none outline-none focus:ring-1 focus:ring-[var(--chat-accent)]/20 resize-none"
                      placeholder="Adicione uma legenda..."
                      value={captionText}
                      onChange={e => setCaptionText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMediaWithCaption() } }}
                      rows={Math.min(captionText.split('\n').length, 5) || 1}
                      autoFocus
                    />
                  </div>
                )}
                {previewType === 'audio' && <div className="flex-1" />}
                <div className="flex items-center gap-2">
                  <button
                    onClick={sendMediaWithCaption}
                    disabled={uploading}
                    className="p-3 rounded-full bg-[var(--chat-accent)] hover:bg-[var(--chat-accent-hover)] transition-colors disabled:opacity-50"
                    title="Enviar agora"
                  >
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    ) : (
                      <Send className="h-5 w-5 text-white" />
                    )}
                  </button>
                  {can('schedules:manage') && (
                    <button
                      onClick={handleOpenScheduleModal}
                      disabled={uploading}
                      className="p-3 rounded-full bg-[var(--chat-sidebar-active)] hover:bg-[var(--chat-dropdown-hover)] transition-colors disabled:opacity-50 relative"
                      title="Agendar envio"
                    >
                      <Send className="h-4 w-4 text-[var(--chat-text-secondary)]" />
                      <Clock className="h-2.5 w-2.5 text-[var(--chat-accent)] absolute bottom-1.5 right-1.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI Active Banner */}
          {aiStatus?.active && (
            <div className="px-3 py-1.5 bg-purple-600/15 dark:bg-purple-900/30 border-t border-purple-400/40 dark:border-purple-500/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300">
                <span className="animate-pulse">🤖</span>
                <span><strong>{aiStatus.agentName}</strong> está respondendo esta conversa</span>
              </div>
              <span className="text-[10px] text-purple-600 dark:text-purple-400">Envie uma mensagem para pausar a IA</span>
            </div>
          )}
          {aiStatus?.status === 'PAUSED' && (
            <div className="px-3 py-1.5 bg-amber-500/15 dark:bg-yellow-900/20 border-t border-amber-400/50 dark:border-yellow-500/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-yellow-300">
                <span>⏸</span>
                <span>IA pausada — atendimento humano ativo</span>
              </div>
              <button
                onClick={() => toggleAI('resume')}
                disabled={togglingAI}
                className="text-[10px] px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-500 transition-colors font-medium shadow-sm"
              >
                Retomar IA
              </button>
            </div>
          )}

          {/* Message Input */}
          <div className="px-3 py-2 bg-[var(--chat-header)] border-t border-[var(--chat-border)] shrink-0">
            {!canReply ? (
              <div className="flex items-center justify-center py-3 text-xs text-[var(--chat-text-secondary)] gap-2">
                <Shield className="h-4 w-4" />
                <span>Você não tem permissão para responder conversas</span>
              </div>
            ) : isRecording ? (
              /* Recording mode */
              <div className="flex items-center gap-3">
                <button onClick={cancelRecording} className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors" title="Cancelar">
                  <Trash2 className="h-6 w-6 text-[#ea4335]" />
                </button>
                <div className="flex-1 flex items-center gap-3 bg-[var(--chat-sidebar-active)] rounded-lg px-4 py-2">
                  <div className={`h-3 w-3 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-[#ea4335] animate-pulse'}`} />
                  <span className="text-[var(--chat-text-primary)] text-sm font-mono">{formatRecordingTime(recordingTime)}</span>
                  <span className="text-[var(--chat-text-secondary)] text-sm">{isPaused ? 'Pausado' : 'Gravando…'}</span>
                </div>
                <button
                  onClick={isPaused ? resumeRecording : pauseRecording}
                  className="p-2.5 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                  title={isPaused ? 'Retomar gravação' : 'Pausar gravação'}
                >
                  {isPaused ? <Mic className="h-5 w-5 text-teal-400" /> : <Pause className="h-5 w-5 text-yellow-400" />}
                </button>
                <button onClick={sendRecording} className="p-3 rounded-full bg-[var(--chat-accent)] hover:bg-[var(--chat-accent-hover)] transition-colors" title="Enviar agora">
                  <Send className="h-5 w-5 text-white" />
                </button>
                {can('schedules:manage') && (
                  <button onClick={scheduleRecording} className="p-3 rounded-full bg-[var(--chat-sidebar-active)] hover:bg-[var(--chat-dropdown-hover)] transition-colors relative" title="Agendar envio">
                    <Send className="h-4 w-4 text-[var(--chat-text-secondary)]" />
                    <Clock className="h-2.5 w-2.5 text-[var(--chat-accent)] absolute bottom-1.5 right-1.5" />
                  </button>
                )}
              </div>
            ) : (
              /* Normal input mode */
              <div className="flex flex-col gap-0">
                {/* Note mode banner */}
                {isNoteMode && (
                  <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-amber-500/15 border border-amber-500/30 rounded-lg text-amber-300 text-xs">
                    <Lock className="h-3 w-3" />
                    <span className="font-medium">Modo Nota Privada</span>
                    <span className="text-amber-400/70">— Apenas atendentes veem • Não é enviada ao cliente</span>
                  </div>
                )}
                <div className="flex items-end gap-2">

                {/* Note toggle */}
                <button
                  className={`p-2 rounded-full transition-colors shrink-0 mb-0.5 ${isNoteMode ? 'bg-amber-500/20 text-amber-400' : 'hover:bg-[var(--chat-dropdown-hover)] text-[var(--chat-text-secondary)]'}`}
                  title={isNoteMode ? 'Voltar para resposta (Alt+P)' : 'Nota privada (Alt+P)'}
                  onClick={() => setIsNoteMode(v => !v)}
                >
                  <StickyNote className="h-5 w-5" />
                </button>
                {/* Emoji Picker */}
                <div className="relative shrink-0 mb-0.5" ref={emojiPickerRef}>
                  <button
                    className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                    title="Emoji"
                    onClick={() => { setShowEmojiPicker(v => !v); setShowAttachMenu(false) }}
                  >
                    <Smile className="h-6 w-6 text-[var(--chat-text-secondary)]" />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-12 left-0 z-50">
                      <EmojiPicker
                        theme={Theme.DARK}
                        onEmojiClick={handleEmojiClick}
                        width={320}
                        height={380}
                        searchPlaceholder="Pesquisar emoji..."
                      />
                    </div>
                  )}
                </div>

                {/* Attach Menu */}
                <div className="relative shrink-0 mb-0.5" ref={attachMenuRef}>
                  <button
                    className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                    title="Anexar"
                    onClick={() => { setShowAttachMenu(v => !v); setShowEmojiPicker(false) }}
                  >
                    <Paperclip className="h-6 w-6 text-[var(--chat-text-secondary)]" />
                  </button>
                  {showAttachMenu && (
                    <div className="absolute bottom-12 left-0 z-50 bg-[var(--chat-dropdown-bg)] rounded-lg shadow-xl overflow-hidden min-w-[160px] border border-[var(--chat-border-strong)]">
                      <button onClick={() => openFilePicker('image')} className="flex items-center gap-3 w-full px-4 py-3 text-[var(--chat-text-primary)] text-sm hover:bg-[var(--chat-dropdown-hover)] transition-colors">
                        <Image className="h-5 w-5 text-[var(--chat-accent)]" /> Imagem
                      </button>
                      <button onClick={() => openFilePicker('video')} className="flex items-center gap-3 w-full px-4 py-3 text-[var(--chat-text-primary)] text-sm hover:bg-[var(--chat-dropdown-hover)] transition-colors">
                        <Video className="h-5 w-5 text-[#7f66ff]" /> Vídeo
                      </button>
                      <button onClick={() => openFilePicker('audio')} className="flex items-center gap-3 w-full px-4 py-3 text-[var(--chat-text-primary)] text-sm hover:bg-[var(--chat-dropdown-hover)] transition-colors">
                        <Mic className="h-5 w-5 text-[#f5a623]" /> Áudio
                      </button>
                      <button onClick={() => openFilePicker('document')} className="flex items-center gap-3 w-full px-4 py-3 text-[var(--chat-text-primary)] text-sm hover:bg-[var(--chat-dropdown-hover)] transition-colors">
                        <FileText className="h-5 w-5 text-[var(--chat-tick-read)]" /> Documento
                      </button>
                    </div>
                  )}
                </div>

                {/* Interactive Message Button */}
                <button
                  className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors shrink-0 mb-0.5"
                  title="Mensagem interativa (Botões, Lista, Enquete, PIX)"
                  onClick={() => { setShowInteractiveComposer(true); setShowAttachMenu(false); setShowEmojiPicker(false) }}
                >
                  <MousePointerClick className="h-5 w-5 text-[var(--chat-text-secondary)]" />
                </button>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={fileAccept}
                  className="hidden"
                  onChange={handleFileSelect}
                />

                <div className="flex-1 relative">
                  {/* Canned Responses Autocomplete */}
                  {showCannedMenu && cannedResponses.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 py-1 rounded-lg bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar z-30">
                      {cannedResponses
                        .filter(r => !cannedSearch || r.shortCode.toLowerCase().includes(cannedSearch.toLowerCase()) || r.content.toLowerCase().includes(cannedSearch.toLowerCase()))
                        .map((r, i) => (
                          <button
                            key={r.id}
                            className={`w-full flex flex-col px-3 py-2 text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${i === cannedIndex ? 'bg-[var(--chat-dropdown-hover)]' : ''}`}
                            onMouseDown={e => {
                              e.preventDefault()
                              setMessageText(r.content)
                              setShowCannedMenu(false)
                              setCannedSearch('')
                              setCannedIndex(0)
                              inputRef.current?.focus()
                            }}
                          >
                            <span className="text-[var(--chat-accent)] text-xs font-medium">/{r.shortCode}</span>
                            <span className="text-[var(--chat-text-primary)] text-sm truncate">{r.content}</span>
                          </button>
                        ))}
                      {cannedResponses.filter(r => !cannedSearch || r.shortCode.toLowerCase().includes(cannedSearch.toLowerCase()) || r.content.toLowerCase().includes(cannedSearch.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-[var(--chat-text-secondary)]">Nenhuma resposta encontrada</p>
                      )}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    rows={1}
                    className={`w-full px-3 py-2 rounded-lg text-sm border-none outline-none resize-none max-h-[120px] leading-5 focus:ring-1 ${
                      isNoteMode
                        ? 'bg-amber-500/10 text-amber-200 placeholder-amber-400/50 focus:ring-amber-500/30'
                        : 'bg-[var(--chat-sidebar-active)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] focus:ring-[var(--chat-accent)]/20'
                    }`}
                    placeholder={isNoteMode ? 'Escrever nota privada... (visível apenas para atendentes)' : 'Digite uma mensagem (/ para respostas prontas)'}
                    value={messageText}
                    onChange={handleMessageChange}
                    onKeyDown={handleKeyDown}
                  />
                </div>

                {/* Send / Schedule / Mic buttons */}
                {messageText.trim() ? (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={handleSend}
                      disabled={sending || uploading}
                      className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors mb-0.5 disabled:opacity-40"
                      title="Enviar agora"
                    >
                      {sending ? (
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-text-secondary)]" />
                      ) : (
                        <Send className="h-6 w-6 text-[var(--chat-text-secondary)]" />
                      )}
                    </button>
                    {can('schedules:manage') && (
                      <button
                        onClick={handleOpenScheduleModal}
                        disabled={sending || uploading}
                        className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors mb-0.5 disabled:opacity-40 relative"
                        title="Agendar envio"
                      >
                        <Send className="h-5 w-5 text-[var(--chat-text-secondary)]" />
                        <Clock className="h-3 w-3 text-[var(--chat-accent)] absolute -bottom-0.5 -right-0.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={startRecording}
                    disabled={uploading}
                    className="p-2 rounded-full hover:bg-[var(--chat-dropdown-hover)] transition-colors shrink-0 mb-0.5 disabled:opacity-40"
                    title="Gravar áudio"
                  >
                    {uploading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-text-secondary)]" />
                    ) : (
                      <Mic className="h-6 w-6 text-[var(--chat-text-secondary)]" />
                    )}
                  </button>
                )}
              </div>
              </div>
            )}

            {/* Upload progress bar */}
            {uploading && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-[var(--chat-text-secondary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Enviando arquivo…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ INTERACTIVE COMPOSER MODAL ═══════ */}
      {showInteractiveComposer && selectedInstance && selectedChat && (
        <InteractiveComposer
          onSend={handleSendInteractive}
          onClose={() => setShowInteractiveComposer(false)}
          sending={sendingInteractive}
          channelType={instances?.find((i: Instance) => i.id === selectedInstance)?.channel}
        />
      )}

      {/* ═══════ SCHEDULE MESSAGE MODAL ═══════ */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowScheduleModal(false)}>
          <div
            className="bg-[#1e2a35] border border-[#2d3f4f] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2d3f4f]">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-teal-400" />
                Agendar Mensagem
              </h3>
              <button onClick={() => setShowScheduleModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Conteúdo editável - texto */}
              {scheduleFiles.length === 0 && !previewFile && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Mensagem</label>
                  <textarea
                    className="w-full px-3 py-2.5 rounded-lg bg-[#162029] text-gray-200 text-sm border border-[#2d3f4f] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 placeholder:text-gray-600 transition-colors resize-none"
                    rows={3}
                    value={scheduleForm.content}
                    onChange={e => setScheduleForm(f => ({ ...f, content: e.target.value }))}
                    placeholder="Digite a mensagem a ser enviada..."
                  />
                </div>
              )}

              {/* Arquivos anexados */}
              {(scheduleFiles.length > 0 || previewFile) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-gray-400">Arquivos ({scheduleFiles.length || 1})</label>
                    <label className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer flex items-center gap-1">
                      <Plus className="h-3 w-3" />
                      Adicionar
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
                        onChange={e => {
                          if (e.target.files?.length) {
                            setScheduleFiles(prev => [...prev, ...Array.from(e.target.files!)])
                          }
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {(scheduleFiles.length > 0 ? scheduleFiles : (previewFile ? [previewFile] : [])).map((file, idx) => {
                      const icon = file.type.startsWith('image/') ? <Image className="h-4 w-4 text-teal-400 shrink-0" /> : file.type.startsWith('video/') ? <Video className="h-4 w-4 text-teal-400 shrink-0" /> : file.type.startsWith('audio/') ? <Mic className="h-4 w-4 text-teal-400 shrink-0" /> : <FileText className="h-4 w-4 text-teal-400 shrink-0" />
                      return (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#162029] border border-[#2d3f4f] text-sm text-gray-200">
                          {icon}
                          <span className="truncate flex-1">{file.name}</span>
                          <span className="text-xs text-gray-500 shrink-0">{(file.size / 1024).toFixed(0)}KB</span>
                          {scheduleFiles.length > 1 && (
                            <button
                              onClick={() => setScheduleFiles(prev => prev.filter((_, i) => i !== idx))}
                              className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
                            >
                              <X className="h-3.5 w-3.5 text-gray-500 hover:text-red-400" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Caption para mídia */}
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Legenda (opcional)</label>
                    <textarea
                      className="w-full px-3 py-2.5 rounded-lg bg-[#162029] text-gray-200 text-sm border border-[#2d3f4f] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 placeholder:text-gray-600 transition-colors resize-none"
                      rows={2}
                      value={scheduleForm.caption}
                      onChange={e => setScheduleForm(f => ({ ...f, caption: e.target.value }))}
                      placeholder="Digite uma legenda para a mídia..."
                    />
                  </div>
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome do agendamento</label>
                <input
                  type="text"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#162029] text-gray-200 text-sm border border-[#2d3f4f] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 placeholder:text-gray-600 transition-colors"
                  value={scheduleForm.name}
                  onChange={e => setScheduleForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Lembrete de pagamento"
                />
              </div>

              {/* Data e hora */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Data e hora de envio</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#162029] text-gray-200 text-sm border border-[#2d3f4f] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 transition-colors [color-scheme:dark]"
                  value={scheduleForm.scheduledAt}
                  onChange={e => setScheduleForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>

              {/* Recorrência */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Recorrência</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg bg-[#162029] text-gray-200 text-sm border border-[#2d3f4f] focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 transition-colors"
                  value={scheduleForm.recurrence}
                  onChange={e => setScheduleForm(f => ({ ...f, recurrence: e.target.value as any }))}
                >
                  <option value="ONCE">Enviar uma vez</option>
                  <option value="DAILY">Diariamente</option>
                  <option value="WEEKLY">Semanalmente</option>
                  <option value="MONTHLY">Mensalmente</option>
                </select>
                {scheduleForm.recurrence !== 'ONCE' && (
                  <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" />
                    Para recorrências avançadas, use Agend. de Mensagens
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#2d3f4f] bg-[#162029]">
              <p className="text-xs text-gray-500">
                Para: {selectedChat?.replace('@s.whatsapp.net', '').replace('@g.us', ' (grupo)')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="px-3.5 py-2 text-sm rounded-lg text-gray-400 hover:bg-white/5 border border-[#2d3f4f] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    // Sync edited content back to main state before sending
                    if (scheduleFiles.length > 0 || previewFile) {
                      setCaptionText(scheduleForm.caption)
                    } else {
                      setMessageText(scheduleForm.content)
                    }
                    setShowScheduleModal(false)
                    setTimeout(() => {
                      if (scheduleFiles.length > 0 || previewFile) sendMediaWithCaption()
                      else handleSend()
                    }, 50)
                  }}
                  disabled={sending || uploading}
                  className="px-4 py-2 text-sm rounded-lg bg-[#2d3f4f] text-gray-200 font-medium hover:bg-[#384f5f] transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Enviar agora
                </button>
                <button
                  onClick={handleScheduleMessage}
                  disabled={scheduleSaving || !scheduleForm.scheduledAt}
                  className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-500 transition-colors disabled:opacity-40 disabled:hover:bg-teal-600 flex items-center gap-1.5"
                >
                  {scheduleSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                  Agendar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MEDIA LIGHTBOX MODAL ═══════ */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl('')}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-[var(--chat-sidebar-active)] hover:bg-[var(--chat-dropdown-hover)] transition-colors z-10"
            onClick={() => setLightboxUrl('')}
          >
            <X className="h-6 w-6 text-[var(--chat-text-primary)]" />
          </button>
          <button
            className="absolute top-4 left-4 p-2 rounded-full bg-[var(--chat-sidebar-active)] hover:bg-[var(--chat-dropdown-hover)] transition-colors z-10"
            onClick={(e) => {
              e.stopPropagation()
              const a = document.createElement('a')
              a.href = lightboxUrl
              a.download = ''
              a.click()
            }}
          >
            <Download className="h-5 w-5 text-[var(--chat-text-primary)]" />
          </button>
          <div className="max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {lightboxType === 'image' ? (
              <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain select-none" />
            ) : (
              <video src={lightboxUrl} controls autoPlay className="max-w-[90vw] max-h-[90vh] rounded-lg" />
            )}
          </div>
        </div>
      )}

      {/* ═══════ CONTACT INFO SIDE PANEL (Premium Redesign) ═══════ */}
      {showContactInfo && selectedChat && (
        <div className="w-[360px] min-w-[320px] flex flex-col border-l border-[var(--chat-border)] bg-[var(--chat-sidebar)] shrink-0">
          {/* Panel Header - Clean, minimal */}
          <div className="h-12 px-3 flex items-center justify-between bg-[var(--chat-header)] shrink-0 border-b border-[var(--chat-border)]">
            <div className="flex items-center gap-2">
              <button
                className="p-1 rounded-md hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                onClick={() => { setShowContactInfo(false); setEditingContactField(null) }}
              >
                <X className="h-4 w-4 text-[var(--chat-text-secondary)]" />
              </button>
              <span className="text-[var(--chat-text-primary)] text-[13px] font-medium tracking-tight">
                {contactInfoData?.type === 'group' ? 'Grupo' : contactInfoData?.type === 'newsletter' ? 'Canal' : 'Contato'}
              </span>
            </div>
            {contactInfoData?.type === 'contact' && (
              <button
                className="p-1 rounded-md hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                onClick={() => fetchContactInfo(true)}
                title="Atualizar dados do WhatsApp"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-[var(--chat-text-secondary)] ${loadingContactInfo ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loadingContactInfo && !contactInfoData ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--chat-accent)]" />
              </div>
            ) : contactInfoData?.error ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <AlertCircle className="h-10 w-10 text-[var(--chat-text-secondary)] mb-3 opacity-50" />
                <p className="text-[var(--chat-text-secondary)] text-xs">Não foi possível carregar</p>
                <button
                  className="mt-3 text-xs text-[var(--chat-accent)] hover:underline"
                  onClick={() => fetchContactInfo(true)}
                >
                  Tentar novamente
                </button>
              </div>
            ) : contactInfoData?.type === 'group' ? (
              /* ── Group Info ── */
              <div>
                <div className="flex flex-col items-center py-6 px-4">
                  <Avatar className="h-20 w-20 mb-3">
                    {avatarCache[selectedChat] ? (
                      <AvatarImage
                        src={getAvatarUrl(avatarCache[selectedChat])}
                        alt={chatDisplayName}
                        className="object-cover cursor-pointer"
                        onClick={() => {
                          const url = getAvatarUrl(avatarCache[selectedChat])
                          if (url) { setLightboxUrl(url); setLightboxType('image') }
                        }}
                      />
                    ) : null}
                    <AvatarFallback className="bg-[var(--chat-sidebar-active)] text-[var(--chat-text-secondary)]">
                      <Users className="h-8 w-8" />
                    </AvatarFallback>
                  </Avatar>
                  <h4 className="text-[var(--chat-text-primary)] text-base font-semibold text-center leading-tight">
                    {contactInfoData.Name || contactInfoData.GroupName?.Name || chatDisplayName}
                  </h4>
                  <p className="text-[var(--chat-text-secondary)] text-xs mt-0.5">
                    Grupo · {contactInfoData.ParticipantCount || contactInfoData.Participants?.length || '?'} participantes
                  </p>
                  {selectedChat && (
                    <p
                      className="text-[var(--chat-text-secondary)] text-[10px] font-mono mt-1.5 cursor-pointer hover:text-[var(--chat-accent)] transition-colors bg-[var(--chat-header)] px-2 py-1 rounded"
                      title="Clique para copiar o JID do grupo"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedChat)
                        const el = document.getElementById('group-jid-toast')
                        if (el) { el.textContent = 'Copiado!'; setTimeout(() => { el.textContent = '' }, 1500) }
                      }}
                    >
                      {selectedChat} <span id="group-jid-toast" className="text-green-400 ml-1"></span>
                    </p>
                  )}
                </div>

                {(contactInfoData.Topic || contactInfoData.GroupTopic?.Topic) && (
                  <div className="mx-4 mb-3 p-3 rounded-lg bg-[var(--chat-header)]">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider mb-1">Descrição</p>
                    <p className="text-[var(--chat-text-primary)] text-xs whitespace-pre-wrap leading-relaxed">
                      {contactInfoData.Topic || contactInfoData.GroupTopic?.Topic}
                    </p>
                  </div>
                )}

                {contactInfoData.Participants && contactInfoData.Participants.length > 0 && (
                  <div className="border-t border-[var(--chat-border)]">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider px-4 pt-3 pb-1.5">
                      {contactInfoData.Participants.length} participantes
                    </p>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {contactInfoData.Participants.map((p: any, i: number) => {
                        // WhatsApp usa LID (xxx@lid) como JID em grupos modernos.
                        // Priorizar PhoneNumber para identificar/exibir o contato real.
                        const pPhoneJid: string = p.PhoneNumber || p.JID || ''
                        const pJid: string = pPhoneJid // usado como chave de chat
                        const pPhone = pPhoneJid.replace('@s.whatsapp.net', '').replace('@lid', '')
                        const pName = senderNamesMap[pPhone] || formatPhone(pPhoneJid)
                        const isLid = !p.PhoneNumber && (p.JID || '').includes('@lid')
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-[var(--chat-header)] cursor-pointer transition-colors"
                            onClick={() => { if (!pJid.includes('@g.us')) { unreadCountOnOpenRef.current = 0; chatJustOpenedRef.current = true; setSelectedChat(pJid); setShowContactInfo(false) } }}
                          >
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarFallback className={`${avatarColor(pJid)} text-white text-[10px]`}>
                                {getInitials(pName !== formatPhone(pJid) ? pName : null, pJid)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-[var(--chat-text-primary)] text-xs truncate">{pName}</p>
                              {pName !== formatPhone(pPhoneJid) && (
                                <p className="text-[var(--chat-text-secondary)] text-[10px] truncate">{formatPhone(pPhoneJid)}</p>
                              )}
                              {isLid && (
                                <p className="text-[var(--chat-text-secondary)] text-[9px] truncate opacity-60">Telefone oculto pelo WhatsApp</p>
                              )}
                            </div>
                            {(p.IsAdmin || p.IsSuperAdmin) && (
                              <span className="text-[var(--chat-accent)] text-[9px] font-medium bg-[var(--chat-accent)]/10 px-1.5 py-0.5 rounded">
                                {p.IsSuperAdmin ? 'Criador' : 'Admin'}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : contactInfoData?.type === 'newsletter' ? (
              /* ── Newsletter/Channel Info ── */
              <div>
                <div className="flex flex-col items-center py-6 px-4">
                  <Avatar className="h-20 w-20 mb-3">
                    <AvatarFallback className="bg-[var(--chat-sidebar-active)] text-[var(--chat-text-secondary)]">
                      <Megaphone className="h-8 w-8" />
                    </AvatarFallback>
                  </Avatar>
                  <h4 className="text-[var(--chat-text-primary)] text-base font-semibold text-center leading-tight">
                    {contactInfoData.Name || chatDisplayName}
                  </h4>
                  <p className="text-[var(--chat-text-secondary)] text-xs mt-0.5">
                    Canal · {contactInfoData.SubscriberCount || '?'} inscritos
                  </p>
                  {selectedChat && (
                    <p
                      className="text-[var(--chat-text-secondary)] text-[10px] font-mono mt-1.5 cursor-pointer hover:text-[var(--chat-accent)] transition-colors bg-[var(--chat-header)] px-2 py-1 rounded"
                      title="Clique para copiar o JID do canal"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedChat)
                        const el = document.getElementById('channel-jid-toast')
                        if (el) { el.textContent = 'Copiado!'; setTimeout(() => { el.textContent = '' }, 1500) }
                      }}
                    >
                      {selectedChat} <span id="channel-jid-toast" className="text-green-400 ml-1"></span>
                    </p>
                  )}
                </div>
                {contactInfoData.Description && (
                  <div className="mx-4 mb-3 p-3 rounded-lg bg-[var(--chat-header)]">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider mb-1">Descrição</p>
                    <p className="text-[var(--chat-text-primary)] text-xs whitespace-pre-wrap leading-relaxed">
                      {contactInfoData.Description}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* ══════════════════════════════════════════
                 ═══ CONTACT INFO — Premium Redesign ═══
                 ══════════════════════════════════════════ */
              <div>
                {/* ── Profile Header ── */}
                <div className="flex flex-col items-center py-6 px-4">
                  <Avatar className="h-20 w-20 mb-3 ring-2 ring-[var(--chat-border)] ring-offset-2 ring-offset-[var(--chat-sidebar)]">
                    {avatarCache[selectedChat] ? (
                      <AvatarImage
                        src={getAvatarUrl(avatarCache[selectedChat])}
                        alt={chatDisplayName}
                        className="object-cover cursor-pointer"
                        onClick={() => {
                          const url = getAvatarUrl(avatarCache[selectedChat])
                          if (url) { setLightboxUrl(url); setLightboxType('image') }
                        }}
                      />
                    ) : null}
                    <AvatarFallback className={`${avatarColor(selectedChat)} text-white text-lg font-medium`}>
                      {getInitials(contactInfoData?.name || chatDisplayName, selectedChat)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Editable Name */}
                  {editingContactField === 'name' ? (
                    <div className="flex items-center gap-1.5 mt-1 w-full max-w-[240px]">
                      <input
                        type="text"
                        value={editingContactValue}
                        onChange={e => setEditingContactValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveContactField('name', editingContactValue)
                          if (e.key === 'Escape') setEditingContactField(null)
                        }}
                        autoFocus
                        className="flex-1 px-2 py-1 text-sm text-center rounded-md bg-[var(--chat-header)] text-[var(--chat-text-primary)] border border-[var(--chat-accent)]/30 outline-none focus:border-[var(--chat-accent)] transition-colors"
                      />
                      <button
                        onClick={() => saveContactField('name', editingContactValue)}
                        disabled={savingContactField}
                        className="p-1 rounded-md hover:bg-[var(--chat-dropdown-hover)] text-[var(--chat-accent)] transition-colors"
                      >
                        {savingContactField ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => setEditingContactField(null)}
                        className="p-1 rounded-md hover:bg-[var(--chat-dropdown-hover)] text-[var(--chat-text-secondary)] transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="group flex items-center gap-1.5 cursor-pointer mt-1"
                      onClick={() => { if (contactInfoData?.contactId) { setEditingContactField('name'); setEditingContactValue(contactInfoData.name || chatDisplayName) } }}
                    >
                      <h4 className="text-[var(--chat-text-primary)] text-base font-semibold text-center leading-tight">
                        {contactInfoData?.name || chatDisplayName}
                      </h4>
                      {contactInfoData?.contactId && (
                        <Pencil className="h-3 w-3 text-[var(--chat-text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  )}

                  {/* Phone (never editable) */}
                  <p className="text-[var(--chat-text-secondary)] text-xs mt-0.5 font-mono">
                    {formatPhone(selectedChat)}
                  </p>

                  {/* Verified badge */}
                  {contactInfoData?.verifiedName && (
                    <div className="flex items-center gap-1 mt-1.5 text-[var(--chat-accent)]">
                      <Shield className="h-3 w-3" />
                      <span className="text-[10px] font-medium">{contactInfoData.verifiedName}</span>
                    </div>
                  )}

                  {/* isBusiness badge */}
                  {contactInfoData?.isBusiness !== null && contactInfoData?.isBusiness !== undefined && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] font-medium" style={{ color: contactInfoData.isBusiness ? 'var(--chat-accent)' : 'var(--chat-text-secondary)' }}>
                      <Briefcase className="h-3 w-3" />
                      <span>{contactInfoData.isBusiness ? 'WhatsApp Business' : 'WhatsApp Pessoal'}</span>
                    </div>
                  )}

                  {/* ── CRM Type Badges (Lead / Cliente / Contato) ── */}
                  {contactInfoData?.contactId && !selectedChat?.endsWith?.('@g.us') && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5 justify-center">
                      {/* Type badge */}
                      {contactInfoData.customerAccount ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border" style={{ background: 'rgba(0, 168, 132, 0.12)', color: 'var(--chat-accent)', borderColor: 'rgba(0, 168, 132, 0.25)' }}>
                          <Building2 className="h-2.5 w-2.5" /> Cliente
                        </span>
                      ) : contactInfoData.leadProfile ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border" style={{ background: 'rgba(217, 119, 6, 0.12)', color: '#b45309', borderColor: 'rgba(217, 119, 6, 0.25)' }}>
                          <Target className="h-2.5 w-2.5" /> Lead
                          {contactInfoData.leadProfile.temperature === 'HOT' && <Flame className="h-2.5 w-2.5" style={{ color: '#dc2626' }} />}
                          {contactInfoData.leadProfile.temperature === 'COLD' && <Snowflake className="h-2.5 w-2.5" style={{ color: '#2563eb' }} />}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border" style={{ background: 'var(--chat-header)', color: 'var(--chat-text-secondary)', borderColor: 'var(--chat-border)' }}>
                          <User className="h-2.5 w-2.5" /> Contato
                        </span>
                      )}

                      {/* Lead status badge */}
                      {contactInfoData.leadProfile && !contactInfoData.leadProfile.convertedAt && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: 'var(--chat-header)', color: 'var(--chat-text-secondary)' }}>
                          {contactInfoData.leadProfile.status === 'NEW' ? 'Novo' :
                           contactInfoData.leadProfile.status === 'CONTACTED' ? 'Contactado' :
                           contactInfoData.leadProfile.status === 'QUALIFYING' ? 'Qualificando' :
                           contactInfoData.leadProfile.status === 'QUALIFIED' ? 'Qualificado' :
                           contactInfoData.leadProfile.status === 'UNQUALIFIED' ? 'Não Qualif.' :
                           contactInfoData.leadProfile.status === 'DISQUALIFIED' ? 'Desqualif.' : contactInfoData.leadProfile.status}
                          {contactInfoData.leadProfile.score != null && ` • ${contactInfoData.leadProfile.score}pts`}
                        </span>
                      )}

                      {/* Customer account name */}
                      {contactInfoData.customerAccount && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: 'var(--chat-header)', color: 'var(--chat-text-secondary)' }}>
                          {contactInfoData.customerAccount.billingName}
                        </span>
                      )}
                    </div>
                  )}

                  {/* ── Conversion buttons ── */}
                  {contactInfoData?.contactId && !selectedChat?.endsWith?.('@g.us') && !contactInfoData.customerAccount && (
                    <div className="flex items-center gap-1.5 mt-2 justify-center">
                      {!contactInfoData.leadProfile && (
                        <button
                          onClick={async () => {
                            try {
                              await leadService.create({ contactId: contactInfoData.contactId })
                              toast.success('Convertido em lead!')
                              fetchContactInfo(true)
                            } catch (err: any) {
                              toast.error(err.response?.data?.error || 'Erro ao converter')
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                          style={{ background: 'rgba(217, 119, 6, 0.1)', color: '#b45309', border: '1px solid rgba(217, 119, 6, 0.2)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(217, 119, 6, 0.2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(217, 119, 6, 0.1)')}
                        >
                          <Target className="h-3 w-3" /> Criar Lead
                        </button>
                      )}
                      {contactInfoData.leadProfile && !contactInfoData.leadProfile.convertedAt && (
                        <button
                          onClick={async () => {
                            try {
                              await leadService.convert(contactInfoData.leadProfile.id, {
                                billingName: contactInfoData.name || '',
                                billingEmail: contactInfoData.email || '',
                              })
                              toast.success('Lead convertido em cliente!')
                              fetchContactInfo(true)
                            } catch (err: any) {
                              toast.error(err.response?.data?.error || 'Erro ao converter')
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                          style={{ background: 'rgba(0, 168, 132, 0.1)', color: 'var(--chat-accent)', border: '1px solid rgba(0, 168, 132, 0.2)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0, 168, 132, 0.2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0, 168, 132, 0.1)')}
                        >
                          <ArrowRight className="h-3 w-3" /> Converter em Cliente
                        </button>
                      )}
                      {!contactInfoData.leadProfile && (
                        <button
                          onClick={async () => {
                            try {
                              await customerAccountService.create({
                                billingName: contactInfoData.name || '',
                                billingEmail: contactInfoData.email || '',
                                accountType: 'INDIVIDUAL',
                                contactIds: [contactInfoData.contactId],
                              })
                              toast.success('Convertido em cliente!')
                              fetchContactInfo(true)
                            } catch (err: any) {
                              toast.error(err.response?.data?.error || 'Erro ao converter')
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                          style={{ background: 'rgba(0, 168, 132, 0.1)', color: 'var(--chat-accent)', border: '1px solid rgba(0, 168, 132, 0.2)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0, 168, 132, 0.2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0, 168, 132, 0.1)')}
                        >
                          <Building2 className="h-3 w-3" /> Criar Cliente
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Contact Details Section ── */}
                <div className="mx-3 mb-3 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                  <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider px-3 pt-3 pb-1">
                    Informações
                  </p>

                  {/* WhatsApp Status/About */}
                  {contactInfoData?.status && (
                    <div className="px-3 py-2 flex items-start gap-2.5">
                      <MessageCircle className="h-3.5 w-3.5 text-[var(--chat-text-secondary)] mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-[var(--chat-text-secondary)]">Recado</p>
                        <p className="text-xs text-[var(--chat-text-primary)] leading-relaxed">{contactInfoData.status}</p>
                      </div>
                    </div>
                  )}

                  {/* Email - Editable */}
                  <div className="px-3 py-2 flex items-start gap-2.5">
                    <Mail className="h-3.5 w-3.5 text-[var(--chat-text-secondary)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-[var(--chat-text-secondary)]">E-mail</p>
                      {editingContactField === 'email' ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <input
                            type="email"
                            value={editingContactValue}
                            onChange={e => setEditingContactValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveContactField('email', editingContactValue || undefined)
                              if (e.key === 'Escape') setEditingContactField(null)
                            }}
                            autoFocus
                            placeholder="email@exemplo.com"
                            className="flex-1 px-1.5 py-0.5 text-xs rounded bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] border border-[var(--chat-accent)]/30 outline-none focus:border-[var(--chat-accent)] transition-colors"
                          />
                          <button onClick={() => saveContactField('email', editingContactValue || undefined)} disabled={savingContactField} className="p-0.5 text-[var(--chat-accent)]">
                            {savingContactField ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </button>
                          <button onClick={() => setEditingContactField(null)} className="p-0.5 text-[var(--chat-text-secondary)]">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <p
                          className={`text-xs leading-relaxed group flex items-center gap-1 ${contactInfoData?.contactId ? 'cursor-pointer hover:text-[var(--chat-accent)]' : ''} ${contactInfoData?.email ? 'text-[var(--chat-text-primary)]' : 'text-[var(--chat-text-secondary)] italic'} transition-colors`}
                          onClick={() => { if (contactInfoData?.contactId) { setEditingContactField('email'); setEditingContactValue(contactInfoData.email || '') } }}
                        >
                          {contactInfoData?.email || 'Adicionar e-mail'}
                          {contactInfoData?.contactId && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Phone - Read-only */}
                  <div className="px-3 py-2 flex items-start gap-2.5">
                    <Phone className="h-3.5 w-3.5 text-[var(--chat-text-secondary)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-[var(--chat-text-secondary)]">Telefone</p>
                      <p className="text-xs text-[var(--chat-text-primary)]">{formatPhone(selectedChat)}</p>
                    </div>
                  </div>


                </div>

                {/* ── Tags Section ── */}
                <div className="mx-3 mb-3 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider">Tags</p>
                    {contactInfoData?.contactId && editingContactField !== 'tags' && (
                      <button
                        onClick={() => { setEditingContactField('tags'); setEditingContactTags((contactInfoData?.tags || []).join(', ')) }}
                        className="p-0.5 rounded hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                      >
                        <Pencil className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                      </button>
                    )}
                  </div>
                  {editingContactField === 'tags' ? (
                    <div className="px-3 pb-3">
                      <input
                        type="text"
                        value={editingContactTags}
                        onChange={e => setEditingContactTags(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveContactField('tags', editingContactTags)
                          if (e.key === 'Escape') setEditingContactField(null)
                        }}
                        autoFocus
                        placeholder="tag1, tag2, tag3"
                        className="w-full px-2 py-1 text-xs rounded bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] border border-[var(--chat-accent)]/30 outline-none focus:border-[var(--chat-accent)] transition-colors"
                      />
                      <div className="flex gap-1 mt-1.5">
                        <button onClick={() => saveContactField('tags', editingContactTags)} disabled={savingContactField} className="text-[10px] text-[var(--chat-accent)] hover:underline">
                          {savingContactField ? 'Salvando...' : 'Salvar'}
                        </button>
                        <span className="text-[var(--chat-text-secondary)] text-[10px]">·</span>
                        <button onClick={() => setEditingContactField(null)} className="text-[10px] text-[var(--chat-text-secondary)] hover:underline">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 pb-3">
                      {contactInfoData?.tags && contactInfoData.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {contactInfoData.tags.map((tag: string, i: number) => (
                            <span key={i} className="bg-[var(--chat-sidebar-active)] text-[var(--chat-text-primary)] text-[10px] px-2 py-0.5 rounded-full font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[var(--chat-text-secondary)] text-[10px] italic">Nenhuma tag</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Custom Attributes Section ── */}
                {contactInfoData?.customAttributeDefinitions && contactInfoData.customAttributeDefinitions.length > 0 && (
                  <div className="mx-3 mb-3 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider px-3 pt-3 pb-1">
                      Campos Personalizados
                    </p>
                    {contactInfoData.customAttributeDefinitions.map((def: any) => {
                      const currentValue = (contactInfoData.metadata || {})[def.attributeKey]
                      const isEditing = showCustomAttrEditor === def.attributeKey
                      const IconMap: Record<string, any> = { TEXT: Type, NUMBER: Hash, LINK: Link2, DATE: Calendar, LIST: ChevronDown, CHECKBOX: CheckSquare }
                      const AttrIcon = IconMap[def.attributeDisplayType] || Type
                      return (
                        <div key={def.id} className="px-3 py-2 flex items-start gap-2.5">
                          <AttrIcon className="h-3.5 w-3.5 text-[var(--chat-text-secondary)] mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-[var(--chat-text-secondary)]">{def.attributeDisplayName}</p>
                            {isEditing ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                {def.attributeDisplayType === 'LIST' ? (
                                  <select
                                    value={customAttrEditValue}
                                    onChange={e => setCustomAttrEditValue(e.target.value)}
                                    autoFocus
                                    className="flex-1 px-1.5 py-0.5 text-xs rounded bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] border border-[var(--chat-accent)]/30 outline-none"
                                  >
                                    <option value="">Selecionar...</option>
                                    {(def.attributeValues || []).map((v: string) => (
                                      <option key={v} value={v}>{v}</option>
                                    ))}
                                  </select>
                                ) : def.attributeDisplayType === 'CHECKBOX' ? (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={!!customAttrEditValue}
                                      onChange={e => setCustomAttrEditValue(e.target.checked)}
                                      className="rounded border-[var(--chat-border)] text-[var(--chat-accent)]"
                                    />
                                    <span className="text-xs text-[var(--chat-text-primary)]">{customAttrEditValue ? 'Sim' : 'Não'}</span>
                                  </label>
                                ) : (
                                  <input
                                    type={def.attributeDisplayType === 'NUMBER' ? 'number' : def.attributeDisplayType === 'DATE' ? 'date' : 'text'}
                                    value={customAttrEditValue}
                                    onChange={e => setCustomAttrEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveCustomAttribute(def.attributeKey, customAttrEditValue)
                                      if (e.key === 'Escape') setShowCustomAttrEditor(null)
                                    }}
                                    autoFocus
                                    className="flex-1 px-1.5 py-0.5 text-xs rounded bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] border border-[var(--chat-accent)]/30 outline-none focus:border-[var(--chat-accent)] transition-colors"
                                  />
                                )}
                                <button onClick={() => saveCustomAttribute(def.attributeKey, customAttrEditValue)} disabled={savingContactField} className="p-0.5 text-[var(--chat-accent)]">
                                  {savingContactField ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </button>
                                <button onClick={() => setShowCustomAttrEditor(null)} className="p-0.5 text-[var(--chat-text-secondary)]">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <p
                                className={`text-xs group flex items-center gap-1 ${contactInfoData?.contactId ? 'cursor-pointer hover:text-[var(--chat-accent)]' : ''} ${currentValue != null && currentValue !== '' ? 'text-[var(--chat-text-primary)]' : 'text-[var(--chat-text-secondary)] italic'} transition-colors`}
                                onClick={() => {
                                  if (contactInfoData?.contactId) {
                                    setShowCustomAttrEditor(def.attributeKey)
                                    setCustomAttrEditValue(currentValue ?? (def.attributeDisplayType === 'CHECKBOX' ? false : ''))
                                  }
                                }}
                              >
                                {def.attributeDisplayType === 'CHECKBOX'
                                  ? (currentValue ? 'Sim' : currentValue === false ? 'Não' : 'Definir')
                                  : def.attributeDisplayType === 'LINK' && currentValue
                                    ? <a href={currentValue} target="_blank" rel="noopener noreferrer" className="text-[var(--chat-accent)] hover:underline truncate" onClick={e => e.stopPropagation()}>{currentValue}</a>
                                    : (currentValue != null && currentValue !== '' ? String(currentValue) : 'Definir')}
                                {contactInfoData?.contactId && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══ Notes History Panel ═══ */}
            {contactInfoData?.type === 'contact' && (
              <div className="border-t border-[var(--chat-border)]">
                <div className="mx-3 mt-3 mb-2 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      <StickyNote className="h-3 w-3" />
                      Notas Privadas
                    </p>
                    <button
                      onClick={() => { setShowNotesPanel(v => !v); if (!showNotesPanel) fetchContactNotes() }}
                      className="text-[10px] text-[var(--chat-accent)] hover:underline"
                    >
                      {showNotesPanel ? 'Fechar' : 'Ver todas'}
                    </button>
                  </div>
                  {showNotesPanel && (
                    <div className="px-3 pb-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                      {loadingNotes ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--chat-accent)]" />
                        </div>
                      ) : contactNotes.length === 0 ? (
                        <p className="text-[10px] text-[var(--chat-text-secondary)] italic py-2">Nenhuma nota encontrada</p>
                      ) : (
                        <div className="space-y-2 mt-1">
                          {contactNotes.map(note => (
                            <div key={note.id} className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Lock className="h-2.5 w-2.5 text-amber-400" />
                                {note.sentByAIAgent ? (
                                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                                    <Bot className="h-2.5 w-2.5" />
                                    {note.sentByAIAgent.name}
                                  </span>
                                ) : note.sentByUser ? (
                                  <span className="text-[10px] text-amber-400/80">{note.sentByUser.name}</span>
                                ) : note.metadata?.authorName ? (
                                  <span className="text-[10px] text-amber-400/80">{note.metadata.authorName}</span>
                                ) : note.metadata?.fromAI ? (
                                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">I.A.</span>
                                ) : null}
                                <span className="text-[9px] text-[var(--chat-text-secondary)] ml-auto">
                                  {format(new Date(note.createdAt), 'dd/MM HH:mm')}
                                </span>
                              </div>
                              <p className="text-[11px] text-amber-200/90 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ CRM: Conversation Management ═══ */}
            {selectedConv?.conversationId && (
              <div className="border-t border-[var(--chat-border)]">
                {/* Status */}
                <div className="mx-3 mt-3 mb-2 rounded-lg bg-[var(--chat-header)]">
                  <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider px-3 pt-3 pb-1">
                    Conversa
                  </p>

                  {/* Status */}
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-[var(--chat-text-secondary)] mb-1">Status</p>
                    <div className="relative" ref={statusDropdownRef}>
                      <button
                        onClick={() => canManage && setShowStatusDropdown(v => !v)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] text-xs hover:bg-[var(--chat-sidebar-active)] transition-colors ${!canManage ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!canManage ? 'Sem permissão para alterar status' : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${
                            selectedConv.status === 'OPEN' ? 'bg-emerald-400' :
                            selectedConv.status === 'RESOLVED' ? 'bg-gray-400' :
                            selectedConv.status === 'PENDING' ? 'bg-amber-400' :
                            selectedConv.status === 'SNOOZED' ? 'bg-blue-400' : 'bg-gray-400'
                          }`} />
                          {selectedConv.status === 'OPEN' ? 'Aberta' : selectedConv.status === 'RESOLVED' ? 'Resolvida' : selectedConv.status === 'PENDING' ? 'Pendente' : selectedConv.status === 'SNOOZED' ? 'Adiada' : selectedConv.status}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[var(--chat-text-secondary)]" />
                      </button>
                      {showStatusDropdown && (
                        <div className="absolute z-20 w-full mt-1 py-0.5 rounded-md bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg">
                          {[
                            { key: 'OPEN', label: 'Aberta', color: 'bg-emerald-400' },
                            { key: 'PENDING', label: 'Pendente', color: 'bg-amber-400' },
                            { key: 'SNOOZED', label: 'Adiada', color: 'bg-blue-400' },
                            { key: 'RESOLVED', label: 'Resolvida', color: 'bg-gray-400' },
                          ].map(s => (
                            <button
                              key={s.key}
                              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${selectedConv.status === s.key ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                              onClick={() => { updateConvStatus(selectedConv.conversationId, s.key); setShowStatusDropdown(false) }}
                            >
                              <span className={`h-2 w-2 rounded-full ${s.color}`} />
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Assignee */}
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-[var(--chat-text-secondary)] mb-1">Agente</p>
                    <div className="relative" ref={assignDropdownRef}>
                      <button
                        onClick={() => canAssign && setShowAssignDropdown(v => !v)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] text-xs hover:bg-[var(--chat-sidebar-active)] transition-colors ${!canAssign ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!canAssign ? 'Sem permissão para atribuir conversas' : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <UserPlus className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                          <span className="truncate">{selectedConv.assigneeName || 'Nenhum'}</span>
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[var(--chat-text-secondary)]" />
                      </button>
                      {showAssignDropdown && (
                        <div className="absolute z-20 w-full mt-1 py-0.5 rounded-md bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                          <button
                            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                            onClick={() => { updateConvAssignment(selectedConv.conversationId, null, selectedConv.teamId); setShowAssignDropdown(false) }}
                          >
                            <X className="h-3 w-3 text-[var(--chat-text-secondary)]" /> Remover
                          </button>
                          {allUsers.map(u => (
                            <button
                              key={u.id}
                              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${selectedConv.assigneeId === u.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                              onClick={() => { updateConvAssignment(selectedConv.conversationId, u.id, selectedConv.teamId); setShowAssignDropdown(false) }}
                            >
                              <UserPlus className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                              <span className="truncate">{u.name}</span>
                              <span className="text-[9px] text-[var(--chat-text-secondary)] ml-auto">{u.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Team */}
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-[var(--chat-text-secondary)] mb-1">Time</p>
                    <div className="relative" ref={teamDropdownRef}>
                      <button
                        onClick={() => canAssign && setShowTeamDropdown(v => !v)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] text-xs hover:bg-[var(--chat-sidebar-active)] transition-colors ${!canAssign ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!canAssign ? 'Sem permissão para atribuir conversas' : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                          <span className="truncate">{selectedConv.teamName || 'Nenhum'}</span>
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[var(--chat-text-secondary)]" />
                      </button>
                      {showTeamDropdown && (
                        <div className="absolute z-20 w-full mt-1 py-0.5 rounded-md bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                          <button
                            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                            onClick={() => { updateConvAssignment(selectedConv.conversationId, selectedConv.assigneeId, null); setShowTeamDropdown(false) }}
                          >
                            <X className="h-3 w-3 text-[var(--chat-text-secondary)]" /> Remover
                          </button>
                          {allTeams.map(t => (
                            <button
                              key={t.id}
                              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${selectedConv.teamId === t.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                              onClick={() => { updateConvAssignment(selectedConv.conversationId, selectedConv.assigneeId, t.id); setShowTeamDropdown(false) }}
                            >
                              <Users className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                              <span className="truncate">{t.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI Agent */}
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-[var(--chat-text-secondary)] mb-1">Agente I.A.</p>
                    <div className="relative" ref={aiAgentDropdownRef}>
                      <button
                        onClick={() => canAssign && setShowAiAgentDropdown(v => !v)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-primary)] text-xs hover:bg-[var(--chat-sidebar-active)] transition-colors ${!canAssign ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={!canAssign ? 'Sem permissão para atribuir conversas' : undefined}
                      >
                        <span className="flex items-center gap-1.5">
                          <Bot className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                          <span className="truncate">
                            {activeAiSession ? (
                              <span className="flex items-center gap-1">
                                {activeAiSession.agentName}
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${activeAiSession.status === 'OPENED' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                              </span>
                            ) : 'Nenhum'}
                          </span>
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[var(--chat-text-secondary)]" />
                      </button>
                      {showAiAgentDropdown && (
                        <div className="absolute z-20 w-full mt-1 py-0.5 rounded-md bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                          {activeAiSession && (
                            <button
                              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                              onClick={() => { removeAiAgent(selectedConv.conversationId); setShowAiAgentDropdown(false) }}
                            >
                              <X className="h-3 w-3" /> Remover I.A.
                            </button>
                          )}
                          {allAiAgents.map(a => (
                            <button
                              key={a.id}
                              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--chat-dropdown-hover)] transition-colors ${activeAiSession?.agentId === a.id ? 'text-[var(--chat-accent)]' : 'text-[var(--chat-text-primary)]'}`}
                              onClick={() => { assignAiAgent(selectedConv.conversationId, a.id); setShowAiAgentDropdown(false) }}
                            >
                              <Bot className="h-3 w-3 text-[var(--chat-text-secondary)]" />
                              <span className="truncate">{a.name}</span>
                              {activeAiSession?.agentId === a.id && <span className="ml-auto text-[9px] text-emerald-400">Ativo</span>}
                            </button>
                          ))}
                          {allAiAgents.length === 0 && (
                            <div className="px-2.5 py-2 text-xs text-[var(--chat-text-secondary)] text-center">
                              Nenhum agente de I.A. ativo
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {activeAiSession && (
                      <div className="mt-1.5 flex items-center justify-between text-[9px]">
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                          activeAiSession.status === 'OPENED' 
                            ? 'bg-emerald-500/20 text-emerald-400' 
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {activeAiSession.status === 'OPENED' ? 'Respondendo' : 'Pausado'}
                        </span>
                        <span className="text-[var(--chat-text-secondary)]">
                          {activeAiSession.messageCount} msgs · {activeAiSession.tokensUsed.toLocaleString()} tokens
                        </span>
                      </div>
                    )}
                    {/* Toggle manual de pausa da IA — funciona MESMO sem sessão criada */}
                    <button
                      onClick={() => toggleConversationAiPause(!conversationAiPaused, conversationAiPaused ? undefined : 'manual pelo painel')}
                      className={`mt-2 w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        conversationAiPaused
                          ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                      title={conversationAiPaused
                        ? 'A IA está pausada para este contato. Clique para reativar.'
                        : 'Pausar a IA para este contato (vale mesmo sem sessão criada).'}
                    >
                      {conversationAiPaused ? (
                        <>
                          <Bot className="h-3 w-3" /> Reativar IA neste contato
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3" /> Pausar IA neste contato
                        </>
                      )}
                    </button>
                    {conversationAiPaused && aiSessionData?.aiPausedReason && (
                      <p className="mt-1 text-[9px] text-[var(--chat-text-secondary)] text-center italic">
                        {aiSessionData.aiPausedReason}
                      </p>
                    )}
                  </div>
                </div>

                {/* Labels */}
                <div className="mx-3 mb-3 rounded-lg bg-[var(--chat-header)]">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider">Etiquetas</p>
                  </div>
                  <div className="px-3 pb-3">
                    <div className="flex flex-wrap gap-1 mb-2">
                      {selectedConv.labels?.map(lbl => (
                        <span
                          key={lbl.id}
                          className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full text-white cursor-pointer hover:opacity-80 transition-opacity font-medium"
                          style={{ backgroundColor: lbl.color || '#6b7280' }}
                          onClick={() => removeLabelFromConv(selectedConv.conversationId, lbl.id)}
                          title="Remover"
                        >
                          {lbl.title}
                          <X className="h-2.5 w-2.5" />
                        </span>
                      ))}
                    </div>
                    <div className="relative" ref={labelDropdownRef}>
                      <button
                        onClick={() => setShowLabelDropdown(v => !v)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-secondary)] text-[10px] hover:bg-[var(--chat-sidebar-active)] transition-colors"
                      >
                        <Tag className="h-3 w-3" /> Adicionar
                      </button>
                      {showLabelDropdown && (
                        <div className="absolute z-20 w-full mt-1 py-0.5 rounded-md bg-[var(--chat-dropdown-bg)] border border-[var(--chat-border-strong)] shadow-lg max-h-[200px] overflow-y-auto custom-scrollbar">
                          {allLabels
                            .filter(l => !selectedConv.labels?.some(cl => cl.id === l.id))
                            .map(l => (
                              <button
                                key={l.id}
                                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--chat-text-primary)] hover:bg-[var(--chat-dropdown-hover)] transition-colors"
                                onClick={() => { addLabelToConv(selectedConv.conversationId, l.id); setShowLabelDropdown(false) }}
                              >
                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color || '#6b7280' }} />
                                {l.title}
                              </button>
                            ))}
                          {allLabels.filter(l => !selectedConv.labels?.some(cl => cl.id === l.id)).length === 0 && (
                            <p className="px-2.5 py-1.5 text-[10px] text-[var(--chat-text-secondary)]">Todas aplicadas</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pipeline */}
                <div className="mx-3 mb-3 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider">Pipeline</p>
                  </div>
                  <div className="px-3 pb-3">
                    {conversationCards && conversationCards.length > 0 ? (
                      <div className="space-y-1.5">
                        {conversationCards.map((card: any) => (
                          <a
                            key={card.id}
                            href={`/pipeline?card=${card.id}`}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-[var(--chat-sidebar)] hover:bg-[var(--chat-sidebar-active)] transition-colors group"
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: card.stage?.color || '#6366f1' }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-[var(--chat-text-primary)] truncate">{card.title || 'Sem título'}</p>
                              <p className="text-[10px] text-[var(--chat-text-secondary)] truncate">
                                {card.pipeline?.name} → {card.stage?.name}
                              </p>
                            </div>
                            <ExternalLink className="h-3 w-3 text-[var(--chat-text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </a>
                        ))}
                        <button
                          onClick={() => setShowPipelineModal(true)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--chat-sidebar)] text-[var(--chat-text-secondary)] text-[10px] hover:bg-[var(--chat-sidebar-active)] transition-colors mt-1"
                        >
                          <Kanban className="h-3 w-3" /> Adicionar outro
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowPipelineModal(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-[var(--chat-accent)]/10 text-[var(--chat-accent)] text-xs font-medium hover:bg-[var(--chat-accent)]/20 transition-colors"
                      >
                        <Kanban className="h-3.5 w-3.5" /> Adicionar ao Pipeline
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ Scheduled Messages for this contact ═══ */}
            {can('schedules:read') && (
              <div className="border-t border-[var(--chat-border)]">
                <div className="mx-3 mt-3 mb-3 rounded-lg bg-[var(--chat-header)] overflow-hidden">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <p className="text-[10px] font-medium text-[var(--chat-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      <CalendarClock className="h-3 w-3" />
                      Agendamentos {contactSchedules?.length ? `(${contactSchedules.filter((s: any) => s.status === 'ACTIVE').length} ativos)` : ''}
                    </p>
                    {can('schedules:manage') && (
                      <button
                        onClick={handleOpenScheduleModal}
                        className="text-[10px] text-[var(--chat-accent)] hover:underline flex items-center gap-0.5"
                        title="Novo agendamento"
                      >
                        <Plus className="h-3 w-3" /> Novo
                      </button>
                    )}
                  </div>
                  {contactSchedules && contactSchedules.length > 0 ? (
                    <div className="px-3 pb-3 space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                      {contactSchedules
                        .sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
                        .map((sched: any) => {
                          const schedDate = new Date(sched.scheduledAt)
                          const statusColors: Record<string, string> = {
                            ACTIVE: 'bg-emerald-400',
                            PAUSED: 'bg-amber-400',
                            CANCELLED: 'bg-red-400',
                            COMPLETED: 'bg-gray-400',
                          }
                          const statusLabels: Record<string, string> = {
                            ACTIVE: 'Ativo',
                            PAUSED: 'Pausado',
                            CANCELLED: 'Cancelado',
                            COMPLETED: 'Concluído',
                          }
                          const typeIcons: Record<string, JSX.Element> = {
                            text: <MessageSquare className="h-3 w-3 text-[var(--chat-text-secondary)]" />,
                            image: <Image className="h-3 w-3 text-teal-400" />,
                            video: <Video className="h-3 w-3 text-teal-400" />,
                            audio: <Mic className="h-3 w-3 text-teal-400" />,
                            document: <FileText className="h-3 w-3 text-teal-400" />,
                          }
                          const canManageSchedule = can('schedules:manage')
                          const isActive = sched.status === 'ACTIVE'
                          const isPaused = sched.status === 'PAUSED'
                          const isEditable = isActive || isPaused

                          return (
                            <div
                              key={sched.id}
                              className="rounded-md bg-[var(--chat-sidebar)] hover:bg-[var(--chat-sidebar-active)] transition-colors overflow-hidden"
                            >
                              <div className="flex items-start gap-2 px-2.5 py-2">
                                <div className="mt-0.5 shrink-0">
                                  {typeIcons[sched.messageType] || <MessageSquare className="h-3 w-3 text-[var(--chat-text-secondary)]" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-[var(--chat-text-primary)] truncate">{sched.name}</p>
                                  {sched.content && (
                                    <p className="text-[10px] text-[var(--chat-text-secondary)] truncate mt-0.5">{sched.content}</p>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[9px] text-[var(--chat-text-secondary)] flex items-center gap-0.5">
                                      <Clock className="h-2.5 w-2.5" />
                                      {format(schedDate, 'dd/MM/yy HH:mm')}
                                    </span>
                                    {sched.recurrence !== 'ONCE' && (
                                      <span className="text-[9px] text-[var(--chat-accent)] flex items-center gap-0.5">
                                        <RefreshCw className="h-2.5 w-2.5" />
                                        {sched.recurrence === 'DAILY' ? 'Diário' : sched.recurrence === 'WEEKLY' ? 'Semanal' : sched.recurrence === 'MONTHLY' ? 'Mensal' : sched.recurrence}
                                      </span>
                                    )}
                                    <span className={`text-[9px] font-medium px-1.5 py-0 rounded-full ${
                                      isActive ? 'bg-emerald-500/20 text-emerald-400' :
                                      isPaused ? 'bg-amber-500/20 text-amber-400' :
                                      sched.status === 'CANCELLED' ? 'bg-red-500/20 text-red-400' :
                                      'bg-gray-500/20 text-gray-400'
                                    }`}>{statusLabels[sched.status] || sched.status}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Action buttons */}
                              {canManageSchedule && isEditable && (
                                <div className="flex items-center border-t border-[var(--chat-border)] divide-x divide-[var(--chat-border)]">
                                  {isActive ? (
                                    <button
                                      onClick={async () => {
                                        try {
                                          await api.put(`/schedules/${sched.id}`, { status: 'PAUSED' })
                                          queryClient.invalidateQueries({ queryKey: ['contact-schedules', selectedInstance, selectedChat] })
                                          toast.success('Agendamento pausado')
                                        } catch { toast.error('Erro ao pausar') }
                                      }}
                                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-amber-400 hover:bg-amber-500/10 transition-colors"
                                      title="Pausar"
                                    >
                                      <Pause className="h-3 w-3" /> Pausar
                                    </button>
                                  ) : (
                                    <button
                                      onClick={async () => {
                                        try {
                                          await api.put(`/schedules/${sched.id}`, { status: 'ACTIVE' })
                                          queryClient.invalidateQueries({ queryKey: ['contact-schedules', selectedInstance, selectedChat] })
                                          toast.success('Agendamento retomado')
                                        } catch { toast.error('Erro ao retomar') }
                                      }}
                                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                      title="Retomar"
                                    >
                                      <Play className="h-3 w-3" /> Retomar
                                    </button>
                                  )}
                                  <button
                                    onClick={async () => {
                                      try {
                                        await api.put(`/schedules/${sched.id}`, { status: 'CANCELLED' })
                                        queryClient.invalidateQueries({ queryKey: ['contact-schedules', selectedInstance, selectedChat] })
                                        toast.success('Agendamento cancelado')
                                      } catch { toast.error('Erro ao cancelar') }
                                    }}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Cancelar agendamento"
                                  >
                                    <X className="h-3 w-3" /> Cancelar
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await api.delete(`/schedules/${sched.id}`)
                                        queryClient.invalidateQueries({ queryKey: ['contact-schedules', selectedInstance, selectedChat] })
                                        toast.success('Agendamento excluído')
                                      } catch { toast.error('Erro ao excluir') }
                                    }}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                    title="Excluir agendamento"
                                  >
                                    <Trash2 className="h-3 w-3" /> Excluir
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  ) : (
                    <div className="px-3 pb-3">
                      <p className="text-[10px] text-[var(--chat-text-secondary)] italic">Nenhum agendamento</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pipeline Modal */}
      {showPipelineModal && selectedConv && (
        <AddToPipelineModal
          conversationId={selectedConv.conversationId}
          contactId={contactInfoData?.contactId}
          contactName={selectedConv.contactName || contactInfoData?.name}
          onClose={() => setShowPipelineModal(false)}
          onSuccess={() => {
            setShowPipelineModal(false)
            refetchConversationCards()
          }}
        />
      )}

      {/* New Conversation Dialog */}
      <NewConversationDialog
        open={showNewConversation}
        onOpenChange={setShowNewConversation}
        instanceId={selectedInstance}
        onConversationStarted={(remoteJid) => {
          setSelectedChat(remoteJid)
          queryClient.invalidateQueries({ queryKey: ['conversations', selectedInstance] })
        }}
      />

      {/* Create FAQ from AI message */}
      {faqModal && (
        <CreateFAQFromMessageModal
          initialQuestion={faqModal.question}
          initialAnswer={faqModal.answer}
          onClose={() => setFaqModal(null)}
        />
      )}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--chat-border-strong); border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4a5568; }
      `}</style>
    </div>
  )
}
