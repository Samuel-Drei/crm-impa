import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Wand2, History, RefreshCw, Check, AlertTriangle,
  Send, Sparkles, Copy, Undo2, RotateCw, ChevronDown,
  FileText, User, Wrench, Variable, Clock, Loader2,
  GripVertical, Bot, X, ChevronRight, Cpu, Sparkles as SparklesIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  type AIAgent,
  type AIAgentPromptField,
  type AIAgentPromptVersion,
  type AIProvider,
  type PromptDiffHunk,
  type PromptEditCandidate,
  type PromptEditorFlags,
  type PromptEditPreviewResponse,
  type PromptPatchPlan,
  getAIAgent,
  getAIProviders,
  updateAIAgent,
  previewAIAgentPromptEdit,
  applyAIAgentPromptEdit,
  listAIAgentPromptVersions,
  restoreAIAgentPromptVersion,
} from '@/services/ai.service'
import { PromptCoachPanel } from '@/components/ai/PromptCoachPanel'

// ─── Types ───────────────────────────────────────────────────
type LeftTab = 'prompt' | 'coach' | 'persona' | 'tools' | 'variables' | 'history'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  preview?: PromptEditPreviewResponse | null
  patch?: PromptPatchPlan | null
  applied?: boolean
}

const QUICK_SUGGESTIONS = [
  { label: 'Humanizar abertura', instruction: 'Deixe a abertura mais humanizada e acolhedora, sem mexer nas regras' },
  { label: 'Reforçar regras', instruction: 'Reforce as regras de atendimento para serem mais claras e firmes' },
  { label: 'Melhorar CTA', instruction: 'Melhore os calls-to-action para serem mais persuasivos' },
  { label: 'Preservar tools', instruction: 'Não mexa nas configurações de tools, apenas melhore o texto' },
  { label: 'Editar agendamento', instruction: 'Melhore apenas a seção de agendamento' },
  { label: 'Tom profissional', instruction: 'Ajuste o tom para ser mais profissional e corporativo' },
]

const VARIABLES = [
  { name: '{contact_name}', desc: 'Nome do contato' },
  { name: '{current_datetime}', desc: 'Data e hora atual' },
  { name: '{current_date}', desc: 'Data atual' },
  { name: '{current_time}', desc: 'Hora atual' },
  { name: '{current_day_of_week}', desc: 'Dia da semana' },
  { name: '{remote_jid}', desc: 'JID do contato' },
]

const DEFAULT_FLAGS: PromptEditorFlags = {
  preservePlaceholders: true,
  preserveTools: true,
  preserveStructure: true,
  partialOnly: true,
}

// ─── Diff viewer ─────────────────────────────────────────────
function HunkView({ hunk }: { hunk: PromptDiffHunk }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] font-mono bg-muted/40 border-b text-muted-foreground">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      <pre className="text-[12px] leading-5 p-0 overflow-x-auto bg-background font-mono">
        {hunk.lines.map((line, i) => {
          const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'rm' : 'ctx'
          return (
            <div
              key={i}
              className={
                kind === 'add'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-px'
                  : kind === 'rm'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3 py-px'
                    : 'text-muted-foreground px-3 py-px'
              }
            >
              <span className="select-none inline-block w-5 text-right mr-2 opacity-40 text-[10px]">
                {kind === 'add' ? '+' : kind === 'rm' ? '-' : ' '}
              </span>
              {line.slice(1)}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

// ─── Confidence badge ────────────────────────────────────────
function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-rose-500'
  const bg = pct >= 80 ? 'bg-emerald-500/10' : pct >= 50 ? 'bg-amber-500/10' : 'bg-rose-500/10'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${bg} ${color}`}>
      {pct}% confiança
    </span>
  )
}

// ─── Main page ───────────────────────────────────────────────
export function AIPromptWorkspace() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const toast = useToast()

  // field from query string, default to SYSTEM_PROMPT
  const fieldParam = searchParams.get('field') as AIAgentPromptField | null
  const [field, setField] = useState<AIAgentPromptField>(fieldParam || 'SYSTEM_PROMPT')

  // Agent data
  const [agent, setAgent] = useState<AIAgent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Editor state
  const [promptText, setPromptText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [dirty, setDirty] = useState(false)

  // Left tabs
  const [leftTab, setLeftTab] = useState<LeftTab>('prompt')

  // Versions
  const [versions, setVersions] = useState<AIAgentPromptVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Right panel — IA
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [flags, setFlags] = useState<PromptEditorFlags>(DEFAULT_FLAGS)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<PromptEditCandidate | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  // Model override — permite usar um modelo/provider diferente do agente só no Prompt Studio
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [overrideProviderId, setOverrideProviderId] = useState<string | null>(null)
  const [overrideModel, setOverrideModel] = useState<string | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Resizer
  const [leftWidth, setLeftWidth] = useState(60) // percentage
  const resizing = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // ─── Load agent ──────────────────────────────────────────
  useEffect(() => {
    if (!id) { setLoading(false); return }
    loadAgent()
  }, [id])

  // ─── Load providers + preferência salva ──────────────────
  useEffect(() => {
    getAIProviders()
      .then(list => setProviders((list || []).filter(p => p.isActive)))
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    if (!id) return
    try {
      const saved = localStorage.getItem(`promptStudio:modelOverride:${id}`)
      if (saved) {
        const parsed = JSON.parse(saved) as { providerId: string | null; model: string | null }
        setOverrideProviderId(parsed.providerId || null)
        setOverrideModel(parsed.model || null)
      }
    } catch {
      // ignore
    }
  }, [id])

  // Persistir escolha
  useEffect(() => {
    if (!id) return
    try {
      if (overrideProviderId || overrideModel) {
        localStorage.setItem(
          `promptStudio:modelOverride:${id}`,
          JSON.stringify({ providerId: overrideProviderId, model: overrideModel }),
        )
      } else {
        localStorage.removeItem(`promptStudio:modelOverride:${id}`)
      }
    } catch {
      // ignore
    }
  }, [id, overrideProviderId, overrideModel])

  async function loadAgent() {
    setLoading(true)
    try {
      const data = await getAIAgent(id!)
      setAgent(data)
      const text = field === 'SYSTEM_PROMPT' ? data.systemPrompt : (data.followUpPrompt || '')
      setPromptText(text)
      setOriginalText(text)
      setDirty(false)
    } catch {
      toast.error('Falha ao carregar agente')
    } finally {
      setLoading(false)
    }
  }

  // Update prompt text when field changes
  useEffect(() => {
    if (!agent) return
    const text = field === 'SYSTEM_PROMPT' ? agent.systemPrompt : (agent.followUpPrompt || '')
    setPromptText(text)
    setOriginalText(text)
    setDirty(false)
  }, [field, agent])

  // Load versions
  useEffect(() => {
    if (id) loadVersions()
  }, [id, field])

  async function loadVersions() {
    if (!id) return
    setLoadingVersions(true)
    try {
      const data = await listAIAgentPromptVersions(id)
      setVersions(data.filter(v => v.field === field))
    } catch {
      // silent
    } finally {
      setLoadingVersions(false)
    }
  }

  // Track dirty
  useEffect(() => {
    setDirty(promptText !== originalText)
  }, [promptText, originalText])

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Helper: confirma navegação se houver alterações não salvas
  const confirmNavigation = useCallback((action: () => void) => {
    if (dirty) {
      if (window.confirm('Você tem alterações no prompt que ainda não foram salvas.\n\nDeseja sair mesmo assim?')) {
        action()
      }
    } else {
      action()
    }
  }, [dirty])

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ─── Resizer ─────────────────────────────────────────────
  const handleMouseDown = useCallback(() => {
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftWidth(Math.min(75, Math.max(35, pct)))
    }
    function onUp() {
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ─── Save prompt ─────────────────────────────────────────
  async function handleSave() {
    if (!id || !agent) return
    setSaving(true)
    try {
      const payload = field === 'SYSTEM_PROMPT'
        ? { systemPrompt: promptText }
        : { followUpPrompt: promptText }
      const updated = await updateAIAgent(id, payload)
      setAgent(updated)
      setOriginalText(promptText)
      setDirty(false)
      toast.success('Prompt salvo com sucesso')
    } catch {
      toast.error('Falha ao salvar prompt')
    } finally {
      setSaving(false)
    }
  }

  // ─── AI chat ─────────────────────────────────────────────
  function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    setChatMessages(prev => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }])
  }

  async function handleSendInstruction(instructionText?: string) {
    const text = (instructionText || chatInput).trim()
    if (!text || !id) return

    addMessage({ role: 'user', content: text })
    setChatInput('')
    setLoadingPreview(true)

    try {
      const data = await previewAIAgentPromptEdit(id, {
        field,
        instruction: text,
        flags,
        selectedCandidate,
        providerId: overrideProviderId,
        model: overrideModel,
      })

      if (data.needsConfirmation && data.candidates?.length) {
        addMessage({
          role: 'assistant',
          content: `Encontrei ${data.candidates.length} trecho(s) possível(is). Selecione qual deseja editar:`,
          preview: data,
        })
      } else if (data.resultText && data.patch) {
        const conf = data.patch.confidence
        addMessage({
          role: 'assistant',
          content: `${data.patch.reason || 'Sugestão gerada.'}\n\nOperação: **${data.patch.operation}**`,
          preview: data,
          patch: data.patch,
        })
      } else {
        addMessage({
          role: 'assistant',
          content: 'Não consegui gerar uma sugestão válida. Tente reformular a instrução.',
        })
      }
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: error?.response?.data?.error || 'Falha ao gerar sugestão. Tente novamente.',
      })
    } finally {
      setLoadingPreview(false)
      setSelectedCandidate(null)
    }
  }

  async function handleApplyPatch(msg: ChatMessage) {
    if (!id || !msg.preview?.patch) return
    setApplying(true)
    try {
      const data = await applyAIAgentPromptEdit(id, {
        field,
        instruction: [...chatMessages].reverse().find((m: ChatMessage) => m.role === 'user')?.content || '',
        flags,
        patch: msg.preview.patch,
      })

      const newValue = field === 'SYSTEM_PROMPT'
        ? data.agent.systemPrompt
        : (data.agent.followUpPrompt || '')

      setPromptText(newValue)
      setOriginalText(newValue)
      setAgent(data.agent)
      setDirty(false)

      // Mark as applied
      setChatMessages(prev => prev.map(m => m.id === msg.id ? { ...m, applied: true } : m))
      addMessage({ role: 'system', content: '✓ Patch aplicado com sucesso.' })
      await loadVersions()
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Falha ao aplicar patch')
    } finally {
      setApplying(false)
    }
  }

  async function handleRestore(versionId: string) {
    if (!id) return
    try {
      const data = await restoreAIAgentPromptVersion(id, versionId)
      const newValue = field === 'SYSTEM_PROMPT'
        ? data.agent.systemPrompt
        : (data.agent.followUpPrompt || '')
      setPromptText(newValue)
      setOriginalText(newValue)
      setAgent(data.agent)
      setDirty(false)
      toast.success('Versão restaurada')
      await loadVersions()
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Falha ao restaurar')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendInstruction()
    }
  }

  // ─── Modelo efetivo (override ou do agente) ───────────────
  const effectiveProvider = useMemo<AIProvider | null>(() => {
    if (overrideProviderId) {
      return providers.find(p => p.id === overrideProviderId) || null
    }
    if (agent?.providerId) {
      return providers.find(p => p.id === agent.providerId) || null
    }
    return null
  }, [providers, overrideProviderId, agent?.providerId])

  const effectiveModel = useMemo(() => {
    if (overrideModel) return overrideModel
    if (effectiveProvider) {
      // Se o override é do mesmo provider do agente, usar agent.provider.model; senão, o default do provider escolhido
      if (effectiveProvider.id === agent?.providerId && agent.provider?.model) {
        return agent.provider.model
      }
      return effectiveProvider.model
    }
    return agent?.provider?.model || '—'
  }, [overrideModel, effectiveProvider, agent])

  const isOverriding = Boolean(overrideProviderId || overrideModel)

  // ─── Prompt sections ──────────────────────────────────────
  const promptSections = useMemo(() => {
    const lines = promptText.split('\n')
    const sections: { title: string; startLine: number; lineCount: number }[] = []
    let current: typeof sections[0] | null = null

    lines.forEach((line, i) => {
      const heading = line.match(/^#{1,3}\s+(.+)/)
      if (heading) {
        if (current) { current.lineCount = i - current.startLine }
        current = { title: heading[1].trim(), startLine: i, lineCount: 0 }
        sections.push(current)
      }
    })
    if (current) (current as any).lineCount = lines.length - (current as any).startLine
    return sections
  }, [promptText])

  // ─── Extracted tools from prompt ──────────────────────────
  const extractedTools = useMemo(() => {
    const matches = promptText.match(/\b(search_contacts|get_contact_details|update_contact|create_contact|get_conversation_info|assign_conversation|add_note|list_teams|list_canned_responses|schedule_appointment|send_media|transfer_to_agent)\b/g)
    return [...new Set(matches || [])]
  }, [promptText])

  // ─── Placeholders used in prompt ──────────────────────────
  const usedPlaceholders = useMemo(() => {
    const matches = promptText.match(/\{[a-z_]+\}/g)
    return [...new Set(matches || [])]
  }, [promptText])

  // ─── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <p className="text-muted-foreground">Agente não encontrado</p>
        <Button variant="outline" onClick={() => navigate(-1)}>Voltar</Button>
      </div>
    )
  }

  const fieldLabel = field === 'SYSTEM_PROMPT' ? 'System Prompt' : 'Follow-up Prompt'

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ─── Header ──────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-12 border-b bg-card/80 backdrop-blur-sm shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => confirmNavigation(() => navigate(`/ai-agents/${id}`))}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Voltar</span>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{agent.name}</span>
            <span className="text-muted-foreground text-xs">— Prompt Studio</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Field selector */}
          <div className="flex items-center bg-muted rounded-lg p-0.5 text-xs">
            <button
              className={`px-3 py-1 rounded-md transition-colors ${field === 'SYSTEM_PROMPT' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setField('SYSTEM_PROMPT')}
            >
              System
            </button>
            <button
              className={`px-3 py-1 rounded-md transition-colors ${field === 'FOLLOW_UP_PROMPT' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setField('FOLLOW_UP_PROMPT')}
            >
              Follow-up
            </button>
          </div>

          <div className="h-5 w-px bg-border" />

          <Button variant="outline" size="sm" onClick={handleSave} disabled={!dirty || saving} className="gap-1.5 text-xs">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Salvar
          </Button>
        </div>
      </header>

      {/* ─── Main area ───────────────────────────────────── */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* ─── LEFT COLUMN ─────────────────────────────── */}
        <div style={{ width: `${leftWidth}%` }} className="flex flex-col border-r overflow-hidden">
          {/* Left tabs */}
          <div className="flex items-center gap-0.5 px-3 h-10 border-b bg-muted/30 shrink-0">
            {([
              { key: 'prompt' as LeftTab, label: 'Prompt', icon: FileText },
              { key: 'coach' as LeftTab, label: 'Assistente', icon: SparklesIcon },
              { key: 'persona' as LeftTab, label: 'Persona', icon: User },
              { key: 'tools' as LeftTab, label: 'Tools', icon: Wrench },
              { key: 'variables' as LeftTab, label: 'Variáveis', icon: Variable },
              { key: 'history' as LeftTab, label: 'Histórico', icon: Clock },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setLeftTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  leftTab === tab.key
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Left content */}
          <div className="flex-1 overflow-y-auto">
            {/* ── TAB: Prompt ──────────────────────────── */}
            {leftTab === 'prompt' && (
              <div className="flex flex-col h-full">
                {/* Section navigator */}
                {promptSections.length > 0 && (
                  <div className="px-3 py-2 border-b bg-muted/20 shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Seções:</span>
                      {promptSections.map((s, i) => (
                        <button
                          key={i}
                          className="text-[11px] px-2 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => {
                            const textarea = document.getElementById('prompt-editor') as HTMLTextAreaElement
                            if (!textarea) return
                            const lines = promptText.split('\n')
                            const pos = lines.slice(0, s.startLine).join('\n').length + 1
                            textarea.focus()
                            textarea.setSelectionRange(pos, pos)
                            textarea.scrollTop = (s.startLine / lines.length) * textarea.scrollHeight
                          }}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main editor */}
                <div className="flex-1 p-3">
                  <textarea
                    id="prompt-editor"
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    className="w-full h-full min-h-[400px] resize-none bg-transparent text-sm font-mono leading-relaxed outline-none placeholder:text-muted-foreground/50"
                    placeholder="Cole ou edite o prompt do sistema aqui..."
                    spellCheck={false}
                  />
                </div>

                {/* Status bar */}
                <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/20 text-[11px] text-muted-foreground shrink-0">
                  <div className="flex items-center gap-3">
                    <span>{promptText.length.toLocaleString()} chars</span>
                    <span>{promptText.split('\n').length} linhas</span>
                    <span>{usedPlaceholders.length} variáveis</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {dirty && <span className="text-amber-500 font-medium">● Não salvo</span>}
                    <span>{fieldLabel}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB: Assistente (Prompt Coach) ────────── */}
            {leftTab === 'coach' && id && (
              <PromptCoachPanel
                agentId={id}
                field={field}
                dirty={dirty}
                currentText={promptText}
                providerId={overrideProviderId}
                model={overrideModel}
                onApplySuggestion={(instruction) => {
                  setChatInput(instruction)
                  chatInputRef.current?.focus()
                  handleSendInstruction(instruction)
                }}
              />
            )}

            {/* ── TAB: Persona ─────────────────────────── */}
            {leftTab === 'persona' && (
              <div className="p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Configurações da Persona</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Informações contextuais extraídas da configuração do agente.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InfoCard label="Nome" value={agent.name} />
                  <InfoCard label="Tipo" value={agent.type} />
                  <InfoCard label="Provider" value={agent.provider?.name || agent.providerId} />
                  <InfoCard label="Modelo" value={agent.provider?.model || '—'} />
                  <InfoCard label="Sessão timeout" value={`${agent.sessionTimeout} min`} />
                  <InfoCard label="Max mensagem" value={`${agent.maxMessageLength} chars`} />
                  <InfoCard label="Contexto CRM" value={agent.useCrmContext ? 'Ativo' : 'Inativo'} />
                  <InfoCard label="Histórico msgs" value={`${agent.contextMessagesLimit} msgs`} />
                </div>

                {agent.settings?.role && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Role</div>
                    <p className="text-sm">{agent.settings.role}</p>
                  </div>
                )}
                {agent.settings?.goal && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Goal</div>
                    <p className="text-sm">{agent.settings.goal}</p>
                  </div>
                )}

                {agent.description && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Descrição</div>
                    <p className="text-sm">{agent.description}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB: Tools ──────────────────────────── */}
            {leftTab === 'tools' && (
              <div className="p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-1">Tools detectadas no prompt</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Referências a funções/ferramentas encontradas no texto do prompt.
                  </p>
                </div>

                {extractedTools.length > 0 ? (
                  <div className="space-y-1.5">
                    {extractedTools.map(tool => (
                      <div key={tool} className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/20">
                        <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
                        <code className="text-xs font-mono">{tool}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Nenhuma tool referenciada no prompt.</p>
                )}

                {agent.mcpServerIds && agent.mcpServerIds.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Servidores MCP vinculados</h4>
                    <div className="space-y-1.5">
                      {agent.mcpServerIds.map((sId: string) => (
                        <div key={sId} className="text-xs rounded-lg border px-3 py-2 bg-muted/20 font-mono truncate">{sId}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB: Variáveis ──────────────────────── */}
            {leftTab === 'variables' && (
              <div className="p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-1">Variáveis disponíveis</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Clique para inserir no prompt. Variáveis em uso estão destacadas.
                  </p>
                </div>

                <div className="space-y-1.5">
                  {VARIABLES.map(v => {
                    const isUsed = promptText.includes(v.name)
                    return (
                      <button
                        key={v.name}
                        onClick={() => {
                          const textarea = document.getElementById('prompt-editor') as HTMLTextAreaElement
                          if (!textarea) {
                            setLeftTab('prompt')
                            setTimeout(() => {
                              setPromptText(prev => prev + v.name)
                              // Scroll textarea até o fim após inserir variável
                              setTimeout(() => {
                                const ta = document.getElementById('prompt-editor') as HTMLTextAreaElement
                                if (ta) {
                                  ta.scrollTop = ta.scrollHeight
                                  const end = ta.value.length
                                  ta.focus()
                                  ta.setSelectionRange(end, end)
                                }
                              }, 50)
                            }, 100)
                            return
                          }
                          const start = textarea.selectionStart
                          const end = textarea.selectionEnd
                          setPromptText(prev => prev.slice(0, start) + v.name + prev.slice(end))
                          setTimeout(() => {
                            textarea.focus()
                            const newPos = start + v.name.length
                            textarea.setSelectionRange(newPos, newPos)
                            // Scroll para garantir que o cursor (e a variável inserida) fique visível
                            const lineHeight = 24
                            const linesAbove = textarea.value.slice(0, newPos).split('\n').length
                            const desiredScroll = (linesAbove * lineHeight) - (textarea.clientHeight / 2)
                            textarea.scrollTop = Math.max(0, desiredScroll)
                          }, 0)
                        }}
                        className={`flex items-center justify-between w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                          isUsed ? 'border-primary/30 bg-primary/5' : 'bg-muted/20'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Variable className="h-3.5 w-3.5 text-primary shrink-0" />
                          <code className="text-xs font-mono">{v.name}</code>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">{v.desc}</span>
                          {isUsed && <span className="text-[9px] text-primary font-semibold px-1.5 py-0.5 bg-primary/10 rounded">EM USO</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── TAB: Histórico ──────────────────────── */}
            {leftTab === 'history' && (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Histórico de versões</h3>
                  <Button variant="ghost" size="sm" onClick={loadVersions} disabled={loadingVersions}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingVersions ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                {versions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Clock className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-xs">Nenhuma versão registrada</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map(v => (
                      <div key={v.id} className="rounded-lg border p-3 space-y-2 bg-muted/10 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {new Date(v.createdAt).toLocaleString('pt-BR')}
                          </span>
                          {v.confidence != null && <ConfidenceBadge value={v.confidence} />}
                        </div>
                        <p className="text-xs font-medium line-clamp-2">{v.instruction}</p>
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-mono">{v.operation}</span>
                          {v.diffJson && (
                            <span className="ml-2">
                              <span className="text-emerald-500">+{v.diffJson.additions}</span>
                              {' / '}
                              <span className="text-rose-500">-{v.diffJson.removals}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => {
                            addMessage({
                              role: 'system',
                              content: `Diff da versão de ${new Date(v.createdAt).toLocaleString('pt-BR')}:\n\n💬 Instrução: "${v.instruction}"`,
                              preview: {
                                field: v.field,
                                instruction: v.instruction,
                                originalText: v.oldText,
                                resultText: v.resultText,
                                diff: v.diffJson || undefined,
                                validationIssues: v.warnings || [],
                                needsConfirmation: false,
                              } as PromptEditPreviewResponse,
                            })
                          }}>
                            Ver diff
                          </Button>
                          <Button size="sm" className="text-[11px] h-7" onClick={() => handleRestore(v.id)}>
                            <Undo2 className="h-3 w-3 mr-1" />
                            Restaurar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── RESIZER ────────────────────────────────── */}
        <div
          onMouseDown={handleMouseDown}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/50 active:bg-primary transition-colors shrink-0 relative group"
        >
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* ─── RIGHT COLUMN — IA Copilot ──────────────── */}
        <div style={{ width: `${100 - leftWidth}%` }} className="flex flex-col overflow-hidden bg-card/30">
          {/* Right header */}
          <div className="flex items-center justify-between px-4 h-10 border-b bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Copilot</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">PATCH</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={() => setChatMessages([])}
              >
                <X className="h-3 w-3 mr-1" />
                Limpar
              </Button>
            </div>
          </div>

          {/* Model picker */}
          <div className="relative px-4 py-2 border-b bg-muted/10 shrink-0">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider shrink-0">Modelo:</span>
              <button
                type="button"
                onClick={() => setModelPickerOpen(o => !o)}
                className="flex-1 flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] hover:bg-muted/50 transition-colors min-w-0"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium truncate">
                    {effectiveProvider?.name || agent.provider?.name || 'Padrão do agente'}
                  </span>
                  <span className="text-muted-foreground truncate">· {effectiveModel}</span>
                </div>
                <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOverriding && (
                <button
                  type="button"
                  onClick={() => {
                    setOverrideProviderId(null)
                    setOverrideModel(null)
                  }}
                  className="text-[10px] px-1.5 py-1 text-muted-foreground hover:text-foreground shrink-0"
                  title="Usar modelo padrão do agente"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </div>

            {modelPickerOpen && (
              <>
                {/* Backdrop para fechar ao clicar fora */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setModelPickerOpen(false)}
                />
                <div className="absolute left-4 right-4 top-full mt-1 z-30 rounded-lg border bg-popover shadow-lg max-h-[380px] overflow-y-auto">
                  {/* Opção: padrão do agente */}
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideProviderId(null)
                      setOverrideModel(null)
                      setModelPickerOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-[12px] border-b hover:bg-muted/50 transition-colors ${
                      !isOverriding ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">Padrão do agente</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {agent.provider?.name || '—'} · {agent.provider?.model || '—'}
                        </div>
                      </div>
                      {!isOverriding && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </div>
                  </button>

                  {providers.length === 0 && (
                    <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                      Nenhum provider ativo encontrado
                    </div>
                  )}

                  {providers.map(p => {
                    const models = (p.enabledModels?.length ? p.enabledModels : [p.model]).filter(Boolean)
                    return (
                      <div key={p.id} className="border-b last:border-b-0">
                        <div className="px-3 py-1.5 bg-muted/30 text-[10px] uppercase tracking-wider font-medium text-muted-foreground flex items-center justify-between">
                          <span>{p.name}</span>
                          <span className="text-[9px] normal-case tracking-normal">{p.type}</span>
                        </div>
                        {models.map(m => {
                          const active = overrideProviderId === p.id && overrideModel === m
                          return (
                            <button
                              key={`${p.id}-${m}`}
                              type="button"
                              onClick={() => {
                                setOverrideProviderId(p.id)
                                setOverrideModel(m)
                                setModelPickerOpen(false)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-muted/50 transition-colors flex items-center justify-between gap-2 ${
                                active ? 'bg-primary/5' : ''
                              }`}
                            >
                              <span className="font-mono truncate">{m}</span>
                              {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Flags bar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/10 shrink-0">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider shrink-0">Preservar:</span>
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { key: 'preservePlaceholders' as const, label: 'Vars' },
                { key: 'preserveTools' as const, label: 'Tools' },
                { key: 'preserveStructure' as const, label: 'Estrutura' },
                { key: 'partialOnly' as const, label: 'Parcial' },
              ]).map(f => (
                <label key={f.key} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flags[f.key]}
                    onChange={e => setFlags(prev => ({ ...prev, [f.key]: e.target.checked }))}
                    className="h-3 w-3 rounded border-border accent-primary"
                  />
                  <span className="text-[11px] text-muted-foreground">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Quick suggestions */}
          <div className="px-4 py-2 border-b bg-muted/10 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {QUICK_SUGGESTIONS.map(s => (
                <button
                  key={s.label}
                  onClick={() => handleSendInstruction(s.instruction)}
                  disabled={loadingPreview}
                  className="text-[11px] px-2.5 py-1 rounded-full border bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Sparkles className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium mb-1">Prompt Copilot</p>
                <p className="text-xs text-center max-w-[240px]">
                  Descreva a alteração desejada em linguagem natural. A IA vai sugerir edições parciais.
                </p>
              </div>
            )}

            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'system'
                      ? 'bg-muted/50 text-muted-foreground text-xs italic'
                      : 'bg-muted/60 text-foreground'
                }`}>
                  {/* Message text */}
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{msg.content}</div>

                  {/* Candidate selection */}
                  {msg.preview?.needsConfirmation && msg.preview?.candidates && (
                    <div className="mt-3 space-y-1.5">
                      {msg.preview.candidates.map((c, i) => (
                        <label key={i} className="flex items-start gap-2 rounded-lg border bg-background/50 p-2 cursor-pointer hover:bg-background/80">
                          <input
                            type="radio"
                            name="candidate-select"
                            className="mt-0.5"
                            onChange={() => setSelectedCandidate(c)}
                            checked={selectedCandidate?.label === c.label && selectedCandidate?.excerpt === c.excerpt}
                          />
                          <div>
                            <div className="text-xs font-medium">{c.label}</div>
                            <div className="text-[11px] text-muted-foreground line-clamp-2">{c.excerpt}</div>
                          </div>
                        </label>
                      ))}
                      <Button
                        size="sm"
                        className="text-[11px] h-7 mt-1"
                        onClick={() => handleSendInstruction([...chatMessages].reverse().find((m: ChatMessage) => m.role === 'user')?.content)}
                        disabled={!selectedCandidate || loadingPreview}
                      >
                        Confirmar e gerar
                      </Button>
                    </div>
                  )}

                  {/* Confidence + Diff preview */}
                  {msg.patch && msg.preview?.diff && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <ConfidenceBadge value={msg.patch.confidence} />
                        <span className="text-[11px] text-muted-foreground">
                          <span className="text-emerald-500">+{msg.preview.diff.additions}</span>
                          {' / '}
                          <span className="text-rose-500">-{msg.preview.diff.removals}</span>
                        </span>
                      </div>

                      {/* Diff */}
                      <div className="max-h-[200px] overflow-y-auto rounded-lg">
                        {msg.preview.diff.hunks.map((hunk, i) => (
                          <HunkView key={i} hunk={hunk} />
                        ))}
                      </div>

                      {/* Validation issues */}
                      {msg.preview.validationIssues?.length > 0 && (
                        <div className="space-y-1">
                          {msg.preview.validationIssues.map((issue, i) => (
                            <div key={i} className={`text-[11px] rounded px-2 py-1 ${
                              issue.severity === 'error'
                                ? 'bg-rose-500/10 text-rose-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}>
                              {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      {!msg.applied && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            className="text-[11px] h-7 gap-1"
                            onClick={() => handleApplyPatch(msg)}
                            disabled={applying || msg.preview.validationIssues?.some(i => i.severity === 'error')}
                          >
                            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Aplicar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[11px] h-7 gap-1"
                            onClick={() => handleSendInstruction([...chatMessages].reverse().find((m: ChatMessage) => m.role === 'user')?.content)}
                            disabled={loadingPreview}
                          >
                            <RotateCw className="h-3 w-3" />
                            Regenerar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[11px] h-7 gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(msg.patch, null, 2))
                              toast.success('Patch copiado')
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {msg.applied && (
                        <div className="text-[11px] text-emerald-500 font-medium flex items-center gap-1 pt-1">
                          <Check className="h-3 w-3" /> Aplicado
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview diff without patch (from history) */}
                  {!msg.patch && msg.preview?.diff && msg.preview.diff.hunks.length > 0 && (
                    <div className="mt-3 max-h-[200px] overflow-y-auto rounded-lg">
                      {msg.preview.diff.hunks.map((hunk, i) => (
                        <HunkView key={i} hunk={hunk} />
                      ))}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div className="text-[10px] opacity-50 mt-1.5 text-right">
                    {msg.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loadingPreview && (
              <div className="flex justify-start">
                <div className="bg-muted/60 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Analisando prompt...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="p-3 border-t bg-card/50 shrink-0">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Descreva a alteração desejada..."
                  rows={1}
                  className="w-full resize-none bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors placeholder:text-muted-foreground/50"
                  style={{ minHeight: '42px', maxHeight: '120px' }}
                  onInput={e => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = 'auto'
                    target.style.height = Math.min(target.scrollHeight, 120) + 'px'
                  }}
                />
              </div>
              <Button
                size="sm"
                className="h-[42px] w-[42px] rounded-xl shrink-0"
                onClick={() => handleSendInstruction()}
                disabled={!chatInput.trim() || loadingPreview || !id}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helper components ───────────────────────────────────────
function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/10 px-3 py-2">
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
    </div>
  )
}
