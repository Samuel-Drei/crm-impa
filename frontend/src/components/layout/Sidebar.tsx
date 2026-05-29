import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  Users,
  UsersRound,
  Send,
  FileText,
  Bot,
  Webhook,
  Settings,
  LogOut,
  Code,
  Workflow,
  X,
  Crown,
  Globe,
  Zap,
  Timer,
  Tag,
  MessageCircle,
  SlidersHorizontal,
  Wand2,
  UserCog,
  Brain,
  Cpu,
  BookOpen,
  MessagesSquare,
  Activity,
  Server,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Briefcase,
  Wrench,
  Moon,
  Sun,
  Bell,
  User,
  Shield,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  GitBranch,
  Package,
  Hammer,
  RotateCcw,
  Lock,
  Kanban,
  CalendarDays,
  Receipt,
  ScrollText,
  FolderKanban,
  CheckSquare,
  Wallet,
  CreditCard,
  Building2,
  FileX2,
  PieChart,
  Target,
  Plug,
  Star,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissions } from '@/hooks/usePermissions'
import { useThemeStore } from '@/stores/theme.store'
import { useModuleStore } from '@/stores/module.store'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import api from '@/services/api'

// ── Update Steps Config ──
type UpdateStep = 'idle' | 'git' | 'backend' | 'build-backend' | 'frontend' | 'restart' | 'complete' | 'error'
interface StepInfo { label: string; icon: React.ReactNode }
const stepConfig: Record<UpdateStep, StepInfo> = {
  idle: { label: 'Preparando...', icon: <Loader2 className="h-5 w-5 animate-spin" /> },
  git: { label: 'Baixando atualizações (git pull)', icon: <GitBranch className="h-5 w-5" /> },
  backend: { label: 'Instalando dependências do backend', icon: <Package className="h-5 w-5" /> },
  'build-backend': { label: 'Compilando backend', icon: <Code className="h-5 w-5" /> },
  frontend: { label: 'Compilando frontend', icon: <Hammer className="h-5 w-5" /> },
  restart: { label: 'Reiniciando serviços', icon: <RotateCcw className="h-5 w-5" /> },
  complete: { label: 'Atualização concluída!', icon: <CheckCircle className="h-5 w-5 text-green-500" /> },
  error: { label: 'Erro na atualização', icon: <XCircle className="h-5 w-5 text-red-500" /> },
}
const stepOrder: UpdateStep[] = ['git', 'backend', 'build-backend', 'frontend', 'restart']

// ── CRM Menu Items ──
const crmMenuItems = [
  { path: '/pipelines', label: 'Pipeline', icon: Kanban, permission: 'pipelines:read' },
  { path: '/instances', label: 'Instâncias', icon: Smartphone, permission: 'instances:read' },
  { path: '/messages', label: 'Mensagens', icon: MessageSquare, permission: 'conversations:read' },
  { path: '/contacts', label: 'Contatos', icon: Users, permission: 'contacts:read' },
  { path: '/groups', label: 'Grupos', icon: UsersRound, permission: 'groups:read' },
  { path: '/teams', label: 'Times', icon: UserCog, permission: 'teams:read' },
  { path: '/users', label: 'Usuários', icon: Users, permission: 'users:read' },
  { path: '/roles', label: 'Funções', icon: Shield, permission: 'roles:manage' },
  { path: '/labels', label: 'Etiquetas', icon: Tag, permission: 'labels:read' },
  { path: '/canned-responses', label: 'Respostas Prontas', icon: MessageCircle, permission: 'canned_responses:read' },
  { path: '/custom-attributes', label: 'Campos Custom', icon: SlidersHorizontal, permission: 'custom_attributes:read' },
  { path: '/csat-report', label: 'Pesq. Satisfação', icon: Star, permission: 'instances:read' },
]

// ── Commercial Menu Items (reorganized into logical groups) ──
const commercialMenuItems = [
  // Vendas
  { path: '/leads', label: 'Leads', icon: Target, permission: 'contacts:read' },
  { path: '/customers', label: 'Clientes', icon: Building2, permission: 'customers:read' },
  { path: '/catalog', label: 'Catálogo', icon: Package, permission: 'catalog:read' },
  { path: '/proposals', label: 'Propostas', icon: FileText, permission: 'proposals:read' },
  { path: '/contracts', label: 'Contratos', icon: ScrollText, permission: 'contracts:read' },
  // Financeiro
  { path: '/invoices', label: 'Faturas', icon: Receipt, permission: 'invoices:read' },
  { path: '/payments', label: 'Pagamentos', icon: CreditCard, permission: 'payments:read' },
  { path: '/credit-notes', label: 'Notas de Crédito', icon: FileX2, permission: 'invoices:read' },
  { path: '/expenses', label: 'Despesas', icon: Wallet, permission: 'expenses:read' },
  // Gestão
  { path: '/projects', label: 'Projetos', icon: FolderKanban, permission: 'projects:read' },
  { path: '/tasks', label: 'Tarefas', icon: CheckSquare, permission: 'tasks:read' },
  { path: '/reports', label: 'Relatórios', icon: PieChart, permission: 'proposals:read' },
]

// ── Automation Menu Items ──
const automationMenuItems = [
  { path: '/flows', label: 'Fluxos', icon: Workflow, permission: 'flows:read' },
  { path: '/flows/awaiting-input', label: 'Aguardando Input', icon: Workflow, permission: 'flows:read' },
  { path: '/conversation-automations', label: 'Autom. Conversas', icon: Bot, permission: 'automations:read' },
  { path: '/macros', label: 'Macros', icon: Wand2, permission: 'macros:read' },
  { path: '/automations', label: 'Automações', icon: Zap, permission: 'automations:read' },
  { path: '/campaigns', label: 'Campanhas', icon: Send, permission: 'campaigns:read' },
  { path: '/schedules', label: 'Agend. Mensagens', icon: CalendarDays, permission: 'schedules:read' },
  { path: '/templates', label: 'Templates Meta', icon: FileText, permission: 'templates:read' },
  { path: '/webhook-events', label: 'Webhook Entrada', icon: Globe, permission: 'automations:read' },
]

// ── AI Menu Items ──
type MenuItem = { path: string; label: string; icon: React.ElementType; permission?: string; type?: never }
type SectionItem = { type: 'section'; label: string; path?: never; icon?: never; permission?: never }
type AnyMenuItem = MenuItem | SectionItem

const aiMenuItems: AnyMenuItem[] = [
  { type: 'section', label: 'Agentes de IA' },
  { path: '/ai-agents', label: 'Agentes', icon: Brain, permission: 'ai_agents:read' },
  { path: '/ai-templates', label: 'Templates', icon: Sparkles, permission: 'ai_agents:read' },
  { path: '/ai-knowledge', label: 'Base Conhecimento', icon: BookOpen, permission: 'ai_knowledge:read' },
  { path: '/ai-sessions', label: 'Sessões', icon: MessagesSquare, permission: 'ai_sessions:read' },
  { path: '/integrations', label: 'Integrações', icon: Plug, permission: 'integrations:read' },
  { path: '/ai-mcp-servers', label: 'Servidores MCP', icon: Server, permission: 'ai_tools:read' },
  { type: 'section', label: 'Fleet' },
  { path: '/fleet', label: 'Fleet', icon: Sparkles, permission: 'fleet:read' },
  { path: '/fleet/critic-reviews', label: 'Revisões Raven', icon: Sparkles, permission: 'fleet:read' },
  { path: '/ai-learnings', label: 'Aprendizados', icon: Brain, permission: 'ai_agents:read' },
  { path: '/ai-artifacts', label: 'Artefatos', icon: Brain, permission: 'ai_agents:read' },
  { path: '/ai-skills', label: 'Skills', icon: Sparkles, permission: 'ai_agents:read' },
  { path: '/ai-daily-brain', label: 'Cérebro Diário', icon: Brain, permission: 'ai_brain:read' },
  { path: '/ai-providers', label: 'Providers', icon: Cpu, permission: 'ai_providers:read' },
  { path: '/ai-tool-logs', label: 'Tool Logs', icon: Activity, permission: 'ai_tools:read' },
  { path: '/ai-token-reports', label: 'Relatório Tokens', icon: BarChart3, permission: 'ai_reports:read' },
]

// ── Utilities / Bottom ──
const utilityMenuItems = [
  { path: '/window-subscribers', label: 'Janela 24h', icon: Timer, permission: 'conversations:read' },
  { path: '/typebot', label: 'Typebot', icon: Bot, permission: 'automations:read' },
  { path: '/webhooks', label: 'Webhooks', icon: Webhook, permission: 'instances:manage' },
  { path: '/api-docs', label: 'API Docs', icon: Code },
  { path: '/settings', label: 'Configurações', icon: Settings, permission: 'settings:read' },
]

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

// ── Tooltip for collapsed mode ──
function SidebarTooltip({ children, label, show }: { children: React.ReactNode, label: string, show: boolean }) {
  const [hovered, setHovered] = useState(false)
  if (!show) return <>{children}</>
  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-[100] px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs font-medium shadow-lg border border-border/50 whitespace-nowrap pointer-events-none animate-fade-in">
          {label}
        </div>
      )}
    </div>
  )
}

// ── Flyout menu for collapsed group hover ──
function CollapsedGroupFlyout({
  label,
  icon: GroupIcon,
  items,
  accentColor = 'primary',
  location,
  onLinkClick,
  blockedPaths,
}: {
  label: string
  icon: React.ElementType
  items: AnyMenuItem[]
  accentColor?: 'primary' | 'purple' | 'amber' | 'emerald'
  location: ReturnType<typeof useLocation>
  onLinkClick: () => void
  blockedPaths?: Set<string>
}) {
  const [hovered, setHovered] = useState(false)

  if (items.length === 0) return null
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const isGroupActive = items.some(
    item => item.type !== 'section' && (location.pathname === item.path || location.pathname.startsWith((item.path ?? '') + '/'))
  )

  const accentMap = {
    primary: { icon: 'text-primary', activeBg: 'bg-primary/10 text-primary', hoverBg: 'hover:bg-primary/5' },
    purple: { icon: 'text-purple-400', activeBg: 'bg-purple-500/10 text-purple-400', hoverBg: 'hover:bg-purple-500/5' },
    amber: { icon: 'text-amber-500 dark:text-amber-400', activeBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', hoverBg: 'hover:bg-amber-500/5' },
    emerald: { icon: 'text-emerald-500 dark:text-emerald-400', activeBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', hoverBg: 'hover:bg-emerald-500/5' },
  }
  const accent = accentMap[accentColor]

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current)
    setHovered(true)
  }
  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setHovered(false), 150)
  }

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div
        className={cn(
          'flex h-9 w-9 mx-auto items-center justify-center rounded-lg transition-all duration-200 cursor-pointer',
          isGroupActive
            ? accent.activeBg
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        <GroupIcon className="h-4 w-4 flex-shrink-0" />
      </div>

      {hovered && (
        <div
          className="absolute left-full top-0 ml-2 z-[100] min-w-[180px] rounded-lg bg-popover border border-border/60 shadow-xl p-1.5 animate-fade-in"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <p className={cn('px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider', accent.icon)}>
            {label}
          </p>
          <div className="space-y-0.5 mt-1">
            {items.map((item, idx) => {
              if (item.type === 'section') {
                return (
                  <p key={`section-${idx}`} className={cn('px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider border-t border-border/40 first:border-0 first:pt-1', accent.icon)}>
                    {item.label}
                  </p>
                )
              }
              const Icon = item.icon!
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
              const isBlocked = blockedPaths?.has(item.path)
              if (isBlocked) {
                return (
                  <div
                    key={item.path}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[12px] text-muted-foreground/50 cursor-not-allowed"
                    title={`Recurso bloqueado no seu plano`}
                  >
                    <Lock className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="line-through">{item.label}</span>
                  </div>
                )
              }
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onLinkClick}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[12px] transition-all duration-150',
                    isActive
                      ? accent.activeBg + ' font-medium'
                      : 'text-muted-foreground ' + accent.hoverBg + ' hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Expandable Group Component (expanded sidebar) ──
function SidebarGroup({
  label,
  icon: GroupIcon,
  items,
  expanded,
  onToggle,
  accentColor = 'primary',
  location,
  onLinkClick,
  blockedPaths,
}: {
  label: string
  icon: React.ElementType
  items: AnyMenuItem[]
  expanded: boolean
  onToggle: () => void
  accentColor?: 'primary' | 'purple' | 'amber' | 'emerald'
  location: ReturnType<typeof useLocation>
  onLinkClick: () => void
  blockedPaths?: Set<string>
}) {
  const isGroupActive = items.some(
    item => item.type !== 'section' && (location.pathname === item.path || location.pathname.startsWith((item.path ?? '') + '/'))
  )

  const accentStyles = {
    primary: {
      header: 'text-primary',
      active: 'bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary',
      indicator: 'bg-primary/12',
    },
    purple: {
      header: 'text-purple-400',
      active: 'bg-purple-500/10 text-purple-400 font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-purple-400',
      indicator: 'bg-purple-500/12',
    },
    amber: {
      header: 'text-amber-500 dark:text-amber-400',
      active: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-amber-500',
      indicator: 'bg-amber-500/12',
    },
    emerald: {
      header: 'text-emerald-500 dark:text-emerald-400',
      active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-emerald-500',
      indicator: 'bg-emerald-500/12',
    },
  }

  const styles = accentStyles[accentColor]

  if (items.length === 0) return null

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'group w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200',
          isGroupActive
            ? styles.header
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        <GroupIcon className="h-4 w-4 flex-shrink-0 opacity-80" />
        <span className="flex-1 text-left font-medium">{label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 opacity-40 transition-transform duration-200',
            !expanded && '-rotate-90'
          )}
        />
      </button>

      {expanded && (
        <div className="ml-[18px] border-l border-border/50 pl-2.5 space-y-0.5 animate-slide-down">
          {items.map((item, idx) => {
            if (item.type === 'section') {
              return (
                <p key={`section-${idx}`} className={cn(
                  'px-2 pt-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 border-t border-border/30 first:border-0 first:pt-1'
                )}>
                  {item.label}
                </p>
              )
            }
            const Icon = item.icon!
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
            const isBlocked = blockedPaths?.has(item.path)
            if (isBlocked) {
              return (
                <div
                  key={item.path}
                  className="relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] text-muted-foreground/40 cursor-not-allowed"
                  title="Recurso bloqueado no seu plano"
                >
                  <Lock className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
              )
            }
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onLinkClick}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] transition-all duration-200',
                  isActive
                    ? styles.active
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ isOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { company, user, logout } = useAuthStore()
  const { can } = usePermissions()
  const { theme, setTheme } = useThemeStore()
  const { getBlockedPaths } = usePlanLimits()
  const { getSidebarMenus } = useModuleStore()

  const blockedPaths = getBlockedPaths()
  const moduleMenus = getSidebarMenus()

  // Filtrar itens por permissão (preserva section headers)
  const filterItems = <T extends { permission?: string; type?: string }>(items: T[]): T[] =>
    items.filter((item) => item.type === 'section' || !item.permission || can(item.permission))

  const filteredCrmItems = filterItems(crmMenuItems)
  const filteredCommercialItems = filterItems(commercialMenuItems)
  const filteredAutoItems = filterItems(automationMenuItems)
  const filteredAiItems = filterItems(aiMenuItems)
  const filteredUtilityItems = filterItems(utilityMenuItems)

  const isCrmPath = crmMenuItems.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
  const isCommercialPath = commercialMenuItems.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
  const isAutoPath = automationMenuItems.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
  const isAiPath = location.pathname.startsWith('/ai-')

  const [crmExpanded, setCrmExpanded] = useState<boolean>(true)
  const [commercialExpanded, setCommercialExpanded] = useState(isCommercialPath)
  const [autoExpanded, setAutoExpanded] = useState(isAutoPath)
  const [aiExpanded, setAiExpanded] = useState(isAiPath)

  // ── Update system state ──
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [currentStep, setCurrentStep] = useState<UpdateStep>('idle')
  const [completedSteps, setCompletedSteps] = useState<Set<UpdateStep>>(new Set())
  const [errorMessage, setErrorMessage] = useState('')
  const [stepDetails, setStepDetails] = useState<string>('')
  const [isUpdating, setIsUpdating] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const isSuperAdmin = user?.isSuperAdmin === true

  const { data: updateInfo } = useQuery({
    queryKey: ['check-update-header'],
    queryFn: async () => {
      const response = await api.get('/admin/check-update')
      return response.data
    },
    enabled: isSuperAdmin,
    refetchInterval: 86400000,
    staleTime: 3600000,
    retry: false,
  })

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const handleUpdate = () => {
    setShowUpdateModal(true)
    setCurrentStep('idle')
    setCompletedSteps(new Set())
    setErrorMessage('')
    setStepDetails('')
    setIsUpdating(true)

    const baseUrl = api.defaults.baseURL || ''

    if (eventSourceRef.current) eventSourceRef.current.close()

    const eventSource = new EventSource(`${baseUrl}/admin/execute-update-stream`, { withCredentials: true })
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const { step, status, message, details } = data
        if (status === 'running') { setCurrentStep(step as UpdateStep); setStepDetails(message) }
        else if (status === 'done') {
          if (step === 'complete') { setCurrentStep('complete'); setIsUpdating(false); eventSource.close(); setTimeout(() => window.location.reload(), 2000) }
          else { setCompletedSteps(prev => new Set([...prev, step as UpdateStep])); if (details) setStepDetails(details) }
        } else if (status === 'error') { setCurrentStep('error'); setErrorMessage(details || message); setIsUpdating(false); eventSource.close() }
      } catch (e) { console.error('Error parsing SSE data:', e) }
    }
    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) return
      setCurrentStep('error'); setErrorMessage('Conexão perdida com o servidor.'); setIsUpdating(false); eventSource.close()
    }
  }

  const handleCloseModal = () => {
    if (eventSourceRef.current) eventSourceRef.current.close()
    setShowUpdateModal(false); setIsUpdating(false)
  }

  const getProgressPercentage = () => {
    if (currentStep === 'complete') return 100
    if (currentStep === 'error') return 0
    const completedCount = completedSteps.size
    const currentIndex = stepOrder.indexOf(currentStep)
    const totalSteps = stepOrder.length
    if (currentIndex >= 0) return Math.round(((completedCount + 0.5) / totalSteps) * 100)
    return Math.round((completedCount / totalSteps) * 100)
  }

  const handleLogout = () => {
    logout()
    onClose?.()
  }

  const handleLinkClick = () => {
    onClose?.()
  }

  // ═══════════════════════════════════════════════
  // ── COLLAPSED MODE (icon-only sidebar) ──
  // ═══════════════════════════════════════════════
  if (collapsed) {
    return (
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-[60px] border-r border-border/60 bg-card/80 backdrop-blur-xl transition-all duration-300',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex h-full flex-col items-center">
          {/* ── Logo (click to expand) ── */}
          <div className="flex h-[60px] w-full items-center justify-center border-b border-border/40">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground shadow-sm hover:bg-primary transition-colors duration-200"
              title="Expandir menu"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>

          {/* ── Navigation (icons only) ── */}
          <nav className="flex-1 overflow-y-auto py-3 space-y-1 w-full px-2.5">
            {/* Dashboard */}
            <SidebarTooltip label="Dashboard" show>
              <Link
                to="/"
                onClick={handleLinkClick}
                className={cn(
                  'flex h-9 w-9 mx-auto items-center justify-center rounded-lg transition-all duration-200',
                  location.pathname === '/'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <LayoutDashboard className="h-4 w-4" />
              </Link>
            </SidebarTooltip>

            {/* Divider */}
            <div className="h-px bg-border/40 mx-1 !my-2" />

            {/* CRM Group flyout */}
            <CollapsedGroupFlyout
              label="Gestão CRM"
              icon={Briefcase}
              items={filteredCrmItems}
              accentColor="primary"
              location={location}
              onLinkClick={handleLinkClick}
              blockedPaths={blockedPaths}
            />

            {/* Commercial Group flyout */}
            <CollapsedGroupFlyout
              label="Comercial"
              icon={Receipt}
              items={filteredCommercialItems}
              accentColor="emerald"
              location={location}
              onLinkClick={handleLinkClick}
              blockedPaths={blockedPaths}
            />

            {/* Automations Group flyout */}
            <CollapsedGroupFlyout
              label="Automações"
              icon={Wrench}
              items={filteredAutoItems}
              accentColor="amber"
              location={location}
              onLinkClick={handleLinkClick}
              blockedPaths={blockedPaths}
            />

            {/* AI Group flyout */}
            <CollapsedGroupFlyout
              label="Integrações e IA"
              icon={Sparkles}
              items={filteredAiItems}
              accentColor="purple"
              location={location}
              onLinkClick={handleLinkClick}
              blockedPaths={blockedPaths}
            />

            {/* Divider */}
            <div className="h-px bg-border/40 mx-1 !my-2" />

            {/* Utilities */}
            {filteredUtilityItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path
              return (
                <SidebarTooltip key={item.path} label={item.label} show>
                  <Link
                    to={item.path}
                    onClick={handleLinkClick}
                    className={cn(
                      'flex h-9 w-9 mx-auto items-center justify-center rounded-lg transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Link>
                </SidebarTooltip>
              )
            })}

            {/* Admin */}
            {isSuperAdmin && (
              <>
                <div className="h-px bg-border/40 mx-1 !my-2" />
                <SidebarTooltip label="Administração" show>
                  <Link
                    to="/admin"
                    onClick={handleLinkClick}
                    className={cn(
                      'flex h-9 w-9 mx-auto items-center justify-center rounded-lg transition-all duration-200',
                      location.pathname === '/admin'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'text-amber-600/70 dark:text-amber-400/70 hover:bg-amber-500/5 hover:text-amber-600 dark:hover:text-amber-400'
                    )}
                  >
                    <Crown className="h-4 w-4" />
                  </Link>
                </SidebarTooltip>
              </>
            )}
          </nav>

          {/* ── Logout ── */}
          <div className="border-t border-border/40 p-2 w-full space-y-1">
            {/* Theme toggle */}
            <SidebarTooltip label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} show>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-9 w-9 mx-auto items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-200"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </SidebarTooltip>

            {/* Update available */}
            {isSuperAdmin && updateInfo?.hasUpdate && (
              <SidebarTooltip label={`Atualizar para v${updateInfo.latestVersion}`} show>
                <button
                  type="button"
                  onClick={handleUpdate}
                  disabled={isUpdating}
                  className="relative flex h-9 w-9 mx-auto items-center justify-center rounded-lg text-green-500 hover:bg-green-500/10 transition-all duration-200"
                >
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {!isUpdating && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500" />}
                </button>
              </SidebarTooltip>
            )}

            {/* Notifications */}
            <SidebarTooltip label="Notificações" show>
              <button
                type="button"
                className="flex h-9 w-9 mx-auto items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-200"
              >
                <Bell className="h-4 w-4" />
              </button>
            </SidebarTooltip>

            {/* User profile / Logout */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 mx-auto items-center justify-center rounded-lg hover:bg-accent/60 transition-all duration-200"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[11px] bg-primary/20 text-primary font-medium">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isSuperAdmin && updateInfo && !updateInfo.hasUpdate && (
                  <>
                    <DropdownMenuItem disabled>
                      <Badge variant="outline" className="text-[10px]">v{updateInfo.currentVersion}</Badge>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <User className="mr-2 h-4 w-4" />
                  Perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>
    )
  }

  // ═══════════════════════════════════════════════
  // ── EXPANDED MODE (full sidebar) ──
  // ═══════════════════════════════════════════════
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 h-screen w-64 border-r border-border/60 bg-card/80 backdrop-blur-xl transition-all duration-300',
        'lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <div className="flex h-full flex-col">
        {/* ── Logo ── */}
        <div className="flex h-[60px] items-center justify-between px-5 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground shadow-sm hover:bg-primary transition-colors duration-200"
              title="Recolher menu"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <span className="font-semibold text-[15px] tracking-tight">IMPA CRM</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-8 w-8 p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Company ── */}
        <div className="px-5 py-3 border-b border-border/30">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Empresa</p>
          <p className="font-medium text-sm truncate mt-0.5">{company?.name || 'Carregando...'}</p>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* Dashboard — sempre visível, top-level */}
          <div>
            <Link
              to="/"
              onClick={handleLinkClick}
              className={cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200',
                location.pathname === '/'
                  ? 'bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
              Dashboard
            </Link>
          </div>

          {/* ── Divider ── */}
          <div className="h-px bg-border/40" />

          {/* ── CRM Group ── */}
          <SidebarGroup
            label="Gestão CRM"
            icon={Briefcase}
            items={filteredCrmItems}
            expanded={crmExpanded}
            onToggle={() => setCrmExpanded((v: boolean) => !v)}
            accentColor="primary"
            location={location}
            onLinkClick={handleLinkClick}
            blockedPaths={blockedPaths}
          />

          {/* ── Commercial Group ── */}
          <SidebarGroup
            label="Comercial"
            icon={Receipt}
            items={filteredCommercialItems}
            expanded={commercialExpanded}
            onToggle={() => setCommercialExpanded(v => !v)}
            accentColor="emerald"
            location={location}
            onLinkClick={handleLinkClick}
            blockedPaths={blockedPaths}
          />

          {/* ── Automations Group ── */}
          <SidebarGroup
            label="Automações"
            icon={Wrench}
            items={filteredAutoItems}
            expanded={autoExpanded}
            onToggle={() => setAutoExpanded(v => !v)}
            accentColor="amber"
            location={location}
            onLinkClick={handleLinkClick}
            blockedPaths={blockedPaths}
          />

          {/* ── AI Group ── */}
          <SidebarGroup
            label="Integrações e IA"
            icon={Sparkles}
            items={filteredAiItems}
            expanded={aiExpanded}
            onToggle={() => setAiExpanded(v => !v)}
            accentColor="purple"
            location={location}
            onLinkClick={handleLinkClick}
            blockedPaths={blockedPaths}
          />

          {/* ── Divider ── */}
          <div className="h-px bg-border/40" />

          {/* ── Utilities ── */}
          <div className="space-y-0.5">
            <p className="px-3 mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Ferramentas
            </p>
            {filteredUtilityItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={handleLinkClick}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] transition-all duration-200',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* ── Module Menus ── */}
          {moduleMenus.length > 0 && (
            <>
              <div className="h-px bg-border/40" />
              <div className="space-y-0.5">
                <p className="px-3 mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Módulos
                </p>
                {moduleMenus.map((item: { path: string; label: string; icon: string }) => {
                  const isActive = location.pathname === item.path
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={handleLinkClick}
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] transition-all duration-200',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      )}
                    >
                      <span className="text-sm">{item.icon}</span>
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Admin ── */}
          {isSuperAdmin && (
            <>
              <div className="h-px bg-border/40" />
              <Link
                to="/admin"
                onClick={handleLinkClick}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200',
                  location.pathname === '/admin'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-amber-500'
                    : 'text-amber-600/70 dark:text-amber-400/70 hover:bg-amber-500/5 hover:text-amber-600 dark:hover:text-amber-400'
                )}
              >
                <Crown className="h-4 w-4 flex-shrink-0" />
                Administração
              </Link>
            </>
          )}
        </nav>

        {/* ── Bottom Controls (theme, notifications, profile) ── */}
        <div className="border-t border-border/40 px-3 py-2.5 space-y-1">
          {/* Controls Row */}
          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-200"
              title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Notifications */}
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all duration-200"
              title="Notificações"
            >
              <Bell className="h-4 w-4" />
            </button>

            {/* Update Available */}
            {isSuperAdmin && updateInfo?.hasUpdate && (
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-green-500 hover:bg-green-500/10 transition-all duration-200"
                title={`Atualizar para v${updateInfo.latestVersion}`}
              >
                {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {!isUpdating && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-green-500" />}
              </button>
            )}

            {/* Version badge */}
            {isSuperAdmin && updateInfo && !updateInfo.hasUpdate && (
              <Badge variant="outline" className="text-[10px] ml-auto">v{updateInfo.currentVersion}</Badge>
            )}

            <div className="flex-1" />

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent/60 transition-all duration-200"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[11px] bg-primary/20 text-primary font-medium">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <User className="mr-2 h-4 w-4" />
                  Perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* ── Update Modal ── */}
      <Dialog open={showUpdateModal} onOpenChange={handleCloseModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Atualizando Sistema
            </DialogTitle>
            <DialogDescription>
              {updateInfo?.hasUpdate && `Atualizando de v${updateInfo.currentVersion} para v${updateInfo.latestVersion}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {currentStep !== 'idle' && currentStep !== 'error' && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progresso</span>
                  <span className="font-medium">{getProgressPercentage()}%</span>
                </div>
                <Progress value={getProgressPercentage()} className="h-2" />
              </div>
            )}
            <div className="space-y-2">
              {stepOrder.map((step) => {
                const config = stepConfig[step]
                const isActive = currentStep === step
                const isCompleted = completedSteps.has(step)
                const currentIndex = stepOrder.indexOf(currentStep)
                const stepIndex = stepOrder.indexOf(step)
                const isErrored = currentStep === 'error' && stepIndex >= currentIndex
                return (
                  <div key={step} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                    isActive ? 'bg-primary/10 border border-primary' :
                    isCompleted ? 'bg-green-500/10 border border-green-500/50' :
                    isErrored ? 'bg-red-500/10 border border-red-500/50' :
                    'bg-muted/30 border border-transparent'
                  }`}>
                    <div className="flex-shrink-0">
                      {isActive && !isCompleted ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> :
                       isCompleted ? <CheckCircle className="h-5 w-5 text-green-500" /> :
                       isErrored ? <XCircle className="h-5 w-5 text-red-500" /> :
                       <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                    </div>
                    <div className="flex-grow min-w-0">
                      <span className={`text-sm ${isActive ? 'font-medium text-primary' : isCompleted ? 'text-green-600' : ''}`}>{config.label}</span>
                      {isActive && stepDetails && <p className="text-xs text-muted-foreground truncate mt-0.5">{stepDetails}</p>}
                    </div>
                    <div className="flex-shrink-0 text-muted-foreground">{config.icon}</div>
                  </div>
                )
              })}
            </div>
            {currentStep === 'complete' && (
              <div className="p-4 bg-green-500/10 border border-green-500 rounded-lg text-center animate-in fade-in duration-300">
                <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
                <p className="font-medium text-green-600">Atualização concluída com sucesso!</p>
                <p className="text-sm text-muted-foreground mt-1">Recarregando página em instantes...</p>
              </div>
            )}
            {currentStep === 'error' && (
              <div className="p-4 bg-red-500/10 border border-red-500 rounded-lg animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-red-500 mb-2">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Erro na atualização</span>
                </div>
                <p className="text-sm text-muted-foreground break-words">{errorMessage}</p>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={handleCloseModal}>Fechar</Button>
                  <Button variant="default" size="sm" onClick={handleUpdate}>Tentar novamente</Button>
                </div>
              </div>
            )}
            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2 text-center">Se a atualização automática falhar, execute na VPS:</p>
              <code className="text-xs bg-muted px-3 py-2 rounded block font-mono break-all">
                cd /root/crm-impa && git pull && cd backend && npm i && npm run build && pm2 restart all
              </code>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
