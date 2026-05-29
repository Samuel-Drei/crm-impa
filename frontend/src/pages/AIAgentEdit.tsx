import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Brain, ArrowLeft, Wrench, Zap, Save, RotateCw, Globe, Server, Activity, Plus, Trash2, ChevronDown, ChevronRight, GripVertical, ExternalLink, Clock, BookOpen, Settings2, MessageSquare, Send, Wand2, Upload, Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import { Link } from 'react-router-dom'
import {
  getAIAgents, createAIAgent, updateAIAgent,
  getAIProviders, getAIMCPServers, getAIToolLogs,
  getAIKnowledgeBases, testAgentChat, importOpenAPISpec,
  type AIAgent, type AIProvider, type AIMCPServer, type AIToolLog, type AIKnowledgeBase
} from '@/services/ai.service'
import api from '@/services/api'

// ============================================
// HTTP Tool Types
// ============================================
interface HttpToolParam {
  name: string
  description: string
  in: 'path' | 'query' | 'body' | 'header'
  type: string
  required: boolean
  default?: string
}

interface HttpToolHeader {
  key: string
  value: string
}

interface HttpTool {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  authType: 'none' | 'bearer' | 'api_key_header' | 'api_key_query'
  authKey?: string
  authValue?: string
  headers: HttpToolHeader[]
  bodyType: 'none' | 'json' | 'form'
  bodyTemplate?: string
  parameters: HttpToolParam[]
  timeout: number
  retryCount: number
  retryDelay: number
  responseMapping?: string
}

const DEFAULT_HTTP_TOOL: HttpTool = {
  name: '',
  description: '',
  method: 'GET',
  endpoint: '',
  authType: 'none',
  headers: [],
  bodyType: 'none',
  bodyTemplate: '',
  parameters: [],
  timeout: 30000,
  retryCount: 0,
  retryDelay: 1000,
  responseMapping: '',
}

function toUiHttpTool(raw: any): HttpTool {
  const rawHeaders = raw?.headers
  const headers: HttpToolHeader[] = Array.isArray(rawHeaders)
    ? rawHeaders
    : rawHeaders && typeof rawHeaders === 'object'
      ? Object.entries(rawHeaders).map(([key, value]) => ({ key, value: String(value) }))
      : []

  const authType = (raw?.auth?.type || raw?.authType || 'none') as HttpTool['authType']
  const authKey = raw?.auth?.apiKeyName || raw?.auth?.headerName || raw?.authKey || ''
  const authValue = raw?.auth?.apiKey || raw?.auth?.token || raw?.auth?.headerValue || raw?.authValue || ''

  const params = Array.isArray(raw?.parameters)
    ? raw.parameters.map((p: any) => ({
      name: p.name || '',
      description: p.description || '',
      in: (p.in || 'query') as HttpToolParam['in'],
      type: p.type || 'string',
      required: !!p.required,
      default: p.default != null ? String(p.default) : '',
    }))
    : []

  return {
    ...DEFAULT_HTTP_TOOL,
    name: raw?.name || '',
    description: raw?.description || '',
    method: raw?.method || 'GET',
    endpoint: raw?.url || raw?.endpoint || '',
    authType,
    authKey,
    authValue,
    headers,
    bodyType: raw?.bodyType || 'none',
    bodyTemplate: raw?.bodyTemplate || '',
    parameters: params,
    timeout: Number(raw?.timeout ?? 30000),
    retryCount: Number(raw?.retryCount ?? 0),
    retryDelay: Number(raw?.retryDelay ?? 1000),
    responseMapping: raw?.response?.extractField || raw?.responseMapping || '',
  }
}

function toBackendHttpTool(tool: HttpTool) {
  const headers: Record<string, string> = {}
  for (const h of tool.headers) {
    if (h.key?.trim()) headers[h.key.trim()] = h.value || ''
  }

  const auth: any = { type: tool.authType }
  if (tool.authType === 'bearer' && tool.authValue) auth.token = tool.authValue
  if (tool.authType === 'api_key_header') {
    auth.apiKey = tool.authValue
    auth.apiKeyName = tool.authKey || 'Authorization'
  }
  if (tool.authType === 'api_key_query') {
    auth.apiKey = tool.authValue
    auth.apiKeyName = tool.authKey || 'key'
  }

  const cleanParams = tool.parameters
    .filter(p => p.name.trim())
    .map(p => ({
      name: p.name.trim(),
      description: p.description || p.name,
      in: p.in,
      type: p.type || 'string',
      required: !!p.required,
      default: p.default ? p.default : undefined,
    }))

  return {
    name: tool.name.trim(),
    description: tool.description.trim() || tool.name.trim(),
    method: tool.method,
    url: tool.endpoint.trim(),
    auth,
    headers,
    parameters: cleanParams,
    timeout: Math.max(1000, Number(tool.timeout || 30000)),
    retryCount: Math.max(0, Number(tool.retryCount || 0)),
    response: {
      type: 'auto',
      extractField: tool.responseMapping?.trim() || undefined,
      maxLength: 10000,
      includeStatusCode: true,
    },
  }
}

export function AIAgentEdit() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const isEditing = !!id

  const [providers, setProviders] = useState<AIProvider[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [mcpServers, setMcpServers] = useState<AIMCPServer[]>([])
  const [toolLogs, setToolLogs] = useState<AIToolLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'trigger' | 'session' | 'schedule' | 'followup' | 'tools' | 'knowledge' | 'context' | 'state' | 'test' | 'memory'>('basic')
  const [toolSubTab, setToolSubTab] = useState<'overview' | 'crm' | 'http' | 'mcp' | 'subagents' | 'logs'>('overview')

  // Knowledge bases
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<AIKnowledgeBase[]>([])
  const [linkedKbIds, setLinkedKbIds] = useState<Set<string>>(new Set())

  // Test chat state
  const [testMessages, setTestMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; model?: string; providerName?: string; tokensUsed?: number; costUsd?: number; latencyMs?: number }>>([])
  const [testInput, setTestInput] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testProviderId, setTestProviderId] = useState('')
  const [testModel, setTestModel] = useState('')
  const [kbSearch, setKbSearch] = useState('')
  const [savingKb, setSavingKb] = useState(false)

  // HTTP Tools visual editor state
  const [httpTools, setHttpTools] = useState<HttpTool[]>([])
  const [expandedHttpTool, setExpandedHttpTool] = useState<number | null>(null)
  const [showOpenAPIModal, setShowOpenAPIModal] = useState(false)
  const [openAPISpec, setOpenAPISpec] = useState('')
  const [openAPILoading, setOpenAPILoading] = useState(false)

  // MCP servers selected for this agent
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([])

  // CRM Sandbox config
  const [crmSandbox, setCrmSandbox] = useState({
    sandboxMode: 'CURRENT_ONLY' as 'CURRENT_ONLY' | 'COMPANY',
    read: {
      contact_name: true, contact_email: true, contact_phone: true, contact_tags: true,
      custom_fields: true,
      conversation_status: true, conversation_assignee: true, conversation_team: true,
      conversation_labels: true, conversation_priority: true, conversation_history: true,
      contact_notes: true,
      teams: true, canned_responses: true,
    },
    write: {
      contact_name: true, contact_email: true, contact_tags: true,
      custom_fields: true,
      conversation_assign: true, conversation_notes: true,
      contact_create: false,
      send_media: true,
    },
    notesLimit: 10,
  })

  // State Tracker (Camada 2 — Parameter Extractor)
  type StateVarType = 'string' | 'number' | 'boolean' | 'enum'
  type StateVar = { name: string; type: StateVarType; description?: string; values?: string[]; example?: string }
  const [stateSchema, setStateSchema] = useState<{
    enabled: boolean
    extractorModel?: string
    extractorProviderId?: string
    recentMessages?: number
    variables: StateVar[]
  }>({
    enabled: false,
    extractorModel: 'gpt-4o-mini',
    extractorProviderId: undefined,
    recentMessages: 8,
    variables: [],
  })

  const [form, setForm] = useState({
    providerId: '',
    model: '',
    instanceIds: [] as string[],
    name: '',
    description: '',
    type: 'LLM' as 'LLM' | 'SEQUENTIAL' | 'WORKFLOW',
    systemPrompt: '',
    welcomeMessage: '',
    triggerType: 'ALL' as 'KEYWORD' | 'ALL' | 'ADVANCED' | 'NONE',
    triggerOperator: 'CONTAINS' as 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX',
    triggerValue: '',
    keywordFinish: '#sair',
    unknownMessage: '',
    delayMessage: 1000,
    splitMessages: false,
    timePerChar: 0,
    maxMessageLength: 4000,
    sessionTimeout: 30,
    keepOpen: false,
    listeningFromMe: false,
    stopBotFromMe: true,
    debounceTime: 3,
    ignoreGroups: true,
    ignoreJids: '',
    allowJids: '',
    isDefault: false,
    useCrmContext: true,
    useContactInfo: true,
    useConversationHistory: true,
    contextMessagesLimit: 10,
    sessionMessagesLimit: 50,
    settingsRole: '',
    settingsGoal: '',
    responseMode: 'balanced' as 'precise' | 'balanced' | 'creative',
    toolForcingEnabled: false,
    toolForcingKeywords: '',
    crmToolsEnabled: true,
    crmToolsList: 'search_contacts,get_contact_details,update_contact,create_contact,get_conversation_info,assign_conversation,add_note,list_teams,list_canned_responses',
    httpToolsJson: '[]',
    subAgentIds: '',
    isSubAgent: false,
    subAgentDescription: '',
    followUpEnabled: false,
    followUpSteps: [] as Array<{ delayMinutes: number; type: string; message: string }>,
    followUpPrompt: '',
    followUpCloseOnMax: true,
    followUpCloseMessage: '',
    followUpEndAction: 'CLOSE' as 'CLOSE' | 'PAUSE' | 'NONE',
    followUpEndDelayMinutes: 0,
    pauseAutoResumeEnabled: false,
    pauseAutoResumeMinutes: 60,
    pauseAutoResumeTrigger: 'PAUSED_AT' as 'PAUSED_AT' | 'LAST_CONTACT_MSG' | 'LAST_ATTENDANT_MSG',
    // Legacy fields (kept for compat)
    followUpDelay: 5,
    followUpMaxAttempts: 3,
    followUpInterval: 10,
    followUpMode: 'AI_GENERATED' as 'AI_GENERATED' | 'FIXED_MESSAGES',
    followUpMessages: '[]',
    useSmartRouting: false,
    routingStrategy: 'BEST_PERFORMANCE' as 'BEST_PERFORMANCE' | 'ROUND_ROBIN' | 'COST_OPTIMIZED',
    routingProviderIds: [] as string[],
    // Agendamento (quando o agente pode responder)
    scheduleMode: 'ALWAYS' as 'ALWAYS' | 'BUSINESS_HOURS' | 'OUT_OF_BUSINESS_HOURS' | 'CUSTOM',
    scheduleTimezone: 'America/Sao_Paulo',
    scheduleSlots: [] as Array<{ dayOfWeek: number; openHour: number; openMinutes: number; closeHour: number; closeMinutes: number }>,
    scheduleOffMessage: '',
    // Memória LP / Aprendizado / Artefatos (Camada 4: Identidade Persistente)
    memoryEnabled: true,
    learningEnabled: false,
    learningAllowSelfLearning: true,
    artifactsEnabled: false,
    artifactsMaxPerConv: 20,
  })

  useEffect(() => { loadData() }, [id])

  useEffect(() => {
    if (toolSubTab === 'logs' && isEditing && id) {
      refreshToolLogs()
    }
  }, [toolSubTab, isEditing, id])

  async function loadData() {
    setLoading(true)
    try {
      const [providersData, instancesRes, agentsData, mcpData, kbsData] = await Promise.all([
        getAIProviders(),
        api.get('/instances'),
        getAIAgents(),
        getAIMCPServers().catch(() => []),
        getAIKnowledgeBases().catch(() => []),
      ])
      setProviders(providersData)
      setInstances(instancesRes.data || [])
      setAgents(agentsData)
      setMcpServers(mcpData)
      setAllKnowledgeBases(kbsData)

      if (isEditing) {
        // Buscar agente com detalhes (knowledgeBases) via endpoint individual
        let agent = agentsData.find((a: AIAgent) => a.id === id)
        try {
          const detailed = await api.get(`/ai/agents/${id}`)
          if (detailed.data) agent = detailed.data
        } catch {}
        if (agent) {
          // Carregar KBs vinculadas
          const kbIds = new Set<string>(
            (agent.knowledgeBases || []).map((ak: any) => ak.knowledgeBase?.id || ak.knowledgeBaseId).filter(Boolean)
          )
          setLinkedKbIds(kbIds)
          const s = (agent as any).settings || {}
          setForm({
            providerId: agent.providerId,
            model: (agent as any).model || '',
            instanceIds: (agent as any).instanceIds || [],
            name: agent.name,
            description: agent.description || '',
            type: agent.type,
            systemPrompt: agent.systemPrompt,
            welcomeMessage: agent.welcomeMessage || '',
            triggerType: agent.triggerType,
            triggerOperator: (agent as any).triggerOperator || 'CONTAINS',
            triggerValue: agent.triggerValue || '',
            keywordFinish: agent.keywordFinish || '#sair',
            unknownMessage: agent.unknownMessage || '',
            delayMessage: agent.delayMessage,
            splitMessages: agent.splitMessages,
            timePerChar: (agent as any).timePerChar || 0,
            maxMessageLength: agent.maxMessageLength,
            sessionTimeout: agent.sessionTimeout,
            keepOpen: agent.keepOpen,
            listeningFromMe: agent.listeningFromMe,
            stopBotFromMe: agent.stopBotFromMe,
            debounceTime: agent.debounceTime,
            ignoreGroups: (agent as any).ignoreGroups !== false,
            ignoreJids: ((agent as any).ignoreJids || []).filter((j: string) => j !== '@g.us').join(', '),
            allowJids: ((agent as any).allowJids || []).join(', '),
            isDefault: (agent as any).isDefault || false,
            useCrmContext: agent.useCrmContext,
            useContactInfo: agent.useContactInfo,
            useConversationHistory: agent.useConversationHistory,
            contextMessagesLimit: agent.contextMessagesLimit ?? 10,
            sessionMessagesLimit: agent.sessionMessagesLimit ?? 50,
            settingsRole: s.role || '',
            settingsGoal: s.goal || '',
            responseMode: (s.responseMode || 'balanced') as 'precise' | 'balanced' | 'creative',
            toolForcingEnabled: !!(s.toolForcing && s.toolForcing.enabled),
            toolForcingKeywords: (s.toolForcing && Array.isArray(s.toolForcing.keywords)) ? s.toolForcing.keywords.join(', ') : '',
            crmToolsEnabled: !!s.crm_tools,
            crmToolsList: (s.crm_tools || []).join(', ') || 'search_contacts,get_contact_details,update_contact,create_contact,get_conversation_info,assign_conversation,add_note,list_teams,list_canned_responses',
            httpToolsJson: s.http_tools ? JSON.stringify(s.http_tools, null, 2) : '[]',
            subAgentIds: (((agent as any).subAgentIds || []) as string[]).join(', ') || (s.sub_agents || []).join(', '),
            isSubAgent: (agent as any).isSubAgent || false,
            subAgentDescription: (agent as any).subAgentDescription || '',
            followUpEnabled: (agent as any).followUpEnabled || false,
            followUpSteps: (agent as any).followUpSteps || [],
            followUpPrompt: (agent as any).followUpPrompt || '',
            followUpCloseOnMax: (agent as any).followUpCloseOnMax !== false,
            followUpCloseMessage: (agent as any).followUpCloseMessage || '',
            followUpEndAction: (agent as any).followUpEndAction || ((agent as any).followUpCloseOnMax !== false ? 'CLOSE' : 'NONE'),
            followUpEndDelayMinutes: (agent as any).followUpEndDelayMinutes ?? 0,
            pauseAutoResumeEnabled: (agent as any).pauseAutoResumeEnabled ?? false,
            pauseAutoResumeMinutes: (agent as any).pauseAutoResumeMinutes ?? 60,
            pauseAutoResumeTrigger: (agent as any).pauseAutoResumeTrigger || 'PAUSED_AT',
            followUpDelay: (agent as any).followUpDelay || 5,
            followUpMaxAttempts: (agent as any).followUpMaxAttempts || 3,
            followUpInterval: (agent as any).followUpInterval || 10,
            followUpMode: (agent as any).followUpMode || 'AI_GENERATED',
            followUpMessages: (agent as any).followUpMessages ? JSON.stringify((agent as any).followUpMessages, null, 2) : '[]',
            useSmartRouting: (agent as any).useSmartRouting || false,
            routingStrategy: (agent as any).routingStrategy || 'BEST_PERFORMANCE',
            routingProviderIds: (agent as any).routingProviderIds || [],
            scheduleMode: (agent as any).scheduleMode || 'ALWAYS',
            scheduleTimezone: (agent as any).scheduleTimezone || 'America/Sao_Paulo',
            scheduleSlots: Array.isArray((agent as any).scheduleSlots) ? (agent as any).scheduleSlots : [],
            scheduleOffMessage: (agent as any).scheduleOffMessage || '',
            memoryEnabled: s.memory?.enabled !== false,
            learningEnabled: s.learning?.enabled === true,
            learningAllowSelfLearning: s.learning?.allowSelfLearning !== false,
            artifactsEnabled: s.artifacts?.enabled === true,
            artifactsMaxPerConv: typeof s.artifacts?.maxArtifactsPerConversation === 'number' ? s.artifacts.maxArtifactsPerConversation : 20,
          })
          // Load HTTP tools from DB field
          const dbHttpTools = (agent as any).httpTools
          if (Array.isArray(dbHttpTools) && dbHttpTools.length > 0) {
            setHttpTools(dbHttpTools.map((t: any) => toUiHttpTool(t)))
          } else if (Array.isArray(s.http_tools) && s.http_tools.length > 0) {
            // Legacy: from settings.http_tools
            setHttpTools(s.http_tools.map((t: any) => toUiHttpTool(t)))
          } else {
            setHttpTools([])
          }
          // Load MCP server IDs
          setSelectedMcpIds((agent as any).mcpServerIds || [])
          // Load CRM sandbox config
          if ((agent as any).crmToolsConfig && typeof (agent as any).crmToolsConfig === 'object') {
            const raw = (agent as any).crmToolsConfig
            setCrmSandbox(prev => ({
              sandboxMode: raw.sandboxMode || prev.sandboxMode,
              read: { ...prev.read, ...(raw.read || {}) },
              write: { ...prev.write, ...(raw.write || {}) },
              notesLimit: typeof raw.notesLimit === 'number' ? raw.notesLimit : prev.notesLimit,
            }))
          }
          // Load State Schema
          const ss = (agent as any).stateSchema
          if (ss && typeof ss === 'object') {
            setStateSchema({
              enabled: !!ss.enabled,
              extractorModel: ss.extractorModel || 'gpt-4o-mini',
              extractorProviderId: ss.extractorProviderId,
              recentMessages: typeof ss.recentMessages === 'number' ? ss.recentMessages : 8,
              variables: Array.isArray(ss.variables) ? ss.variables : [],
            })
          }
          // Load tool logs for this agent
          if (id) {
            getAIToolLogs({ agentId: id, limit: 50 }).then(r => setToolLogs(r.logs || [])).catch(() => {})
          }
        }
      } else {
        setForm(f => ({ ...f, providerId: providersData[0]?.id || '', model: '' }))
        setSelectedMcpIds([])
        setHttpTools([])
        setToolLogs([])
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const settings: any = {}
      if (form.settingsRole) settings.role = form.settingsRole
      if (form.settingsGoal) settings.goal = form.settingsGoal
      // Camada 1: response mode (precise/balanced/creative)
      settings.responseMode = form.responseMode
      // Camada 1: tool forcing por keyword
      if (form.toolForcingEnabled) {
        settings.toolForcing = {
          enabled: true,
          keywords: form.toolForcingKeywords.split(',').map(k => k.trim()).filter(Boolean),
        }
      } else {
        settings.toolForcing = { enabled: false, keywords: [] }
      }
      if (form.crmToolsEnabled) {
        settings.crm_tools = form.crmToolsList.split(',').map(t => t.trim()).filter(Boolean)
      }
      const parsedHttpTools = httpTools
        .filter(t => t.name.trim() && t.endpoint.trim())
        .map(toBackendHttpTool)
      if (parsedHttpTools.length > 0) {
        settings.http_tools = parsedHttpTools
      }
      if (form.subAgentIds) {
        // legado: mantemos em settings.sub_agents também, mas o backend usa coluna subAgentIds
        settings.sub_agents = form.subAgentIds.split(',').map(id => id.trim()).filter(Boolean)
      }
      // Memória LP
      settings.memory = { enabled: !!form.memoryEnabled }
      // Aprendizado procedural
      settings.learning = form.learningEnabled
        ? { enabled: true, allowSelfLearning: !!form.learningAllowSelfLearning }
        : { enabled: false }
      // Artefatos
      settings.artifacts = form.artifactsEnabled
        ? { enabled: true, maxArtifactsPerConversation: Math.max(1, Math.min(500, Number(form.artifactsMaxPerConv) || 20)) }
        : { enabled: false }

      const payload = {
        ...form,
        ignoreJids: form.ignoreJids
          ? form.ignoreJids.split(',').map(j => j.trim()).filter(Boolean)
          : [],
        allowJids: form.allowJids
          ? form.allowJids.split(',').map(j => j.trim()).filter(Boolean)
          : [],
        settings,
        httpTools: parsedHttpTools.length > 0 ? parsedHttpTools : null,
        mcpServerIds: selectedMcpIds,
        crmToolsConfig: form.crmToolsEnabled ? {
          ...crmSandbox,
          enabledTools: form.crmToolsList.split(',').map(t => t.trim()).filter(Boolean),
        } : null,
        stateSchema: stateSchema.enabled || stateSchema.variables.length > 0 ? {
          enabled: stateSchema.enabled,
          extractorModel: stateSchema.extractorModel || 'gpt-4o-mini',
          extractorProviderId: stateSchema.extractorProviderId || undefined,
          recentMessages: stateSchema.recentMessages ?? 8,
          variables: stateSchema.variables
            .filter(v => v.name && v.name.trim())
            .map(v => ({
              name: v.name.trim(),
              type: v.type,
              description: v.description?.trim() || undefined,
              values: v.type === 'enum' ? (v.values || []).map(x => String(x).trim()).filter(Boolean) : undefined,
              example: v.example?.trim() || undefined,
            })),
        } : null,
        // Sub-agentes (Padrão A) — coluna no DB
        isSubAgent: form.isSubAgent,
        subAgentDescription: form.subAgentDescription || null,
        subAgentIds: form.subAgentIds.split(',').map(s => s.trim()).filter(Boolean),
        followUpMessages: (() => {
          try {
            const msgs = JSON.parse(form.followUpMessages)
            return Array.isArray(msgs) ? msgs : []
          } catch { return [] }
        })(),
      }
      delete (payload as any).settingsRole
      delete (payload as any).settingsGoal
      delete (payload as any).responseMode
      delete (payload as any).toolForcingEnabled
      delete (payload as any).toolForcingKeywords
      delete (payload as any).crmToolsEnabled
      delete (payload as any).crmToolsList
      delete (payload as any).httpToolsJson
      // subAgentIds NÃO é deletado — vai como array para a coluna do DB

      if (isEditing) {
        await updateAIAgent(id!, payload)
        toast.success('Agente salvo com sucesso!')
      } else {
        const created = await createAIAgent(payload)
        navigate(`/ai-agents/${created.id}`, { replace: true })
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao salvar agente')
    }
    setSaving(false)
  }

  async function refreshToolLogs() {
    if (!id) return
    try {
      const res = await getAIToolLogs({ agentId: id, limit: 50 })
      setToolLogs(res.logs || [])
    } catch {
      toast.error('Falha ao carregar logs de tools')
    }
  }

  function addHttpTool() {
    setHttpTools(prev => [...prev, { ...DEFAULT_HTTP_TOOL }])
    setExpandedHttpTool(httpTools.length)
  }

  function updateHttpTool(index: number, partial: Partial<HttpTool>) {
    setHttpTools(prev => prev.map((tool, i) => (i === index ? { ...tool, ...partial } : tool)))
  }

  function removeHttpTool(index: number) {
    setHttpTools(prev => prev.filter((_, i) => i !== index))
    if (expandedHttpTool === index) setExpandedHttpTool(null)
  }

  function duplicateHttpTool(index: number) {
    setHttpTools(prev => {
      const source = prev[index]
      if (!source) return prev
      const clone: HttpTool = { ...source, name: `${source.name}_copy` }
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)]
    })
  }

  function toggleMcpSelection(serverId: string) {
    setSelectedMcpIds(prev => prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId])
  }

  function addHttpHeader(index: number) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      return { ...tool, headers: [...tool.headers, { key: '', value: '' }] }
    }))
  }

  function updateHttpHeader(index: number, headerIndex: number, key: 'key' | 'value', value: string) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      const headers = tool.headers.map((h, hi) => hi === headerIndex ? { ...h, [key]: value } : h)
      return { ...tool, headers }
    }))
  }

  function removeHttpHeader(index: number, headerIndex: number) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      return { ...tool, headers: tool.headers.filter((_, hi) => hi !== headerIndex) }
    }))
  }

  function addHttpParam(index: number) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      return {
        ...tool,
        parameters: [
          ...tool.parameters,
          { name: '', description: '', in: 'query', type: 'string', required: false, default: '' },
        ],
      }
    }))
  }

  function updateHttpParam(index: number, paramIndex: number, field: keyof HttpToolParam, value: any) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      const parameters = tool.parameters.map((p, pi) => pi === paramIndex ? { ...p, [field]: value } : p)
      return { ...tool, parameters }
    }))
  }

  function removeHttpParam(index: number, paramIndex: number) {
    setHttpTools(prev => prev.map((tool, i) => {
      if (i !== index) return tool
      return { ...tool, parameters: tool.parameters.filter((_, pi) => pi !== paramIndex) }
    }))
  }

  const tabs = [
    { id: 'basic' as const, label: 'Básico', icon: Brain, desc: 'Identidade e prompt' },
    { id: 'trigger' as const, label: 'Trigger', icon: Zap, desc: 'Quando ativar o agente' },
    { id: 'session' as const, label: 'Sessão', icon: Clock, desc: 'Comportamento da sessão' },
    { id: 'schedule' as const, label: 'Horário', icon: Clock, desc: 'Quando a IA pode responder' },
    { id: 'followup' as const, label: 'Follow-Up', icon: RotateCw, desc: 'Reengajar clientes' },
    { id: 'tools' as const, label: 'Tools & MCP', icon: Wrench, desc: 'Ferramentas do agente' },
    { id: 'knowledge' as const, label: 'Conhecimento', icon: BookOpen, desc: 'Bases de conhecimento' },
    { id: 'context' as const, label: 'Contexto', icon: Settings2, desc: 'Dados do CRM' },
    { id: 'state' as const, label: 'Estado', icon: Variable, desc: 'Variáveis rastreadas' },
    { id: 'memory' as const, label: 'Memória & Aprendizado', icon: Brain, desc: 'Identidade persistente, lições, artefatos' },
    ...(isEditing ? [{ id: 'test' as const, label: 'Testar', icon: MessageSquare, desc: 'Conversar com o agente' }] : []),
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex -m-4 lg:-m-6" style={{ minHeight: 'calc(100vh - 64px)' }}>

      {/* ── SIDEBAR ESQUERDA ── */}
      <aside className="w-64 flex-shrink-0 border-r bg-card/60 flex flex-col">
        {/* Identidade do agente */}
        <div className="p-5 border-b">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
              <Brain className="h-5 w-5 text-purple-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm leading-tight truncate">
                {isEditing ? (form.name || 'Agente') : 'Novo Agente'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isEditing ? 'Editando configurações' : 'Criar agente de IA'}
              </p>
            </div>
          </div>
          {isEditing && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-xs text-muted-foreground truncate">
                {form.model || providers.find(p => p.id === form.providerId)?.model || 'sem provider'}
              </span>
            </div>
          )}
        </div>

        {/* Navegação */}
        <nav className="p-3 space-y-0.5 flex-1">
          {tabs.map(tab => {
            const Icon = tab.icon
            const toolsCount = tab.id === 'tools' ? httpTools.length + selectedMcpIds.length : 0
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="leading-tight">{tab.label}</div>
                  {!isActive && <div className="text-xs opacity-60 truncate">{tab.desc}</div>}
                </div>
                {tab.id === 'followup' && form.followUpEnabled && (
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-purple-200' : 'bg-purple-400'}`} />
                )}
                {toolsCount > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md shrink-0 font-medium ${
                    isActive ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                  }`}>{toolsCount}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Info bottom */}
        <div className="p-4 border-t">
          <p className="text-xs text-muted-foreground">Use as abas para configurar o agente completo antes de salvar.</p>
        </div>
      </aside>

      {/* ── ÁREA PRINCIPAL ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-8 py-4 border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/ai-agents')}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Voltar
            </Button>
            <div className="h-5 w-px bg-border" />
            <div>
              <span className="text-sm font-medium">
                {tabs.find(t => t.id === activeTab)?.label}
              </span>
              <span className="text-xs text-muted-foreground ml-2">
                {tabs.find(t => t.id === activeTab)?.desc}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/ai-agents')}>Cancelar</Button>
            <Button type="submit" disabled={saving} className="min-w-[150px]">
              {saving
                ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                : <><Save className="h-4 w-4 mr-2" />{isEditing ? 'Salvar Alterações' : 'Criar Agente'}</>
              }
            </Button>
          </div>
        </div>

        {/* Conteúdo das abas */}
        <div className="flex-1 overflow-y-auto py-8 px-8">
          <div className="space-y-8">
          {activeTab === 'basic' && (
            <>
              {/* Card 1: Identidade */}
              <div className="bg-card border rounded-2xl p-7 space-y-6">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2 mb-1">
                    <Brain className="h-4 w-4 text-purple-500" /> Identidade do Agente
                  </h3>
                  <p className="text-sm text-muted-foreground">Nome, provider de IA e instância WhatsApp que este agente vai atender.</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Nome *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Ex: Assistente de Vendas" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Provider *</label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.providerId}
                    onChange={e => setForm(f => ({ ...f, providerId: e.target.value, model: '' }))}
                    required
                  >
                    <option value="">Selecione...</option>
                    {providers.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type})
                      </option>
                    ))}
                  </select>
                </div>
                {form.providerId && (() => {
                  const selectedProvider = providers.find(p => p.id === form.providerId)
                  const enabledModels = selectedProvider?.enabledModels || []
                  return enabledModels.length > 0 ? (
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Modelo *</label>
                      <select
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={form.model || ''}
                        onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                      >
                        <option value="">Usar padr\u00e3o do provedor ({selectedProvider?.model})</option>
                        {enabledModels.map((m: string) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">Modelos habilitados no provedor. Configure em Provedores de IA.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-500">Nenhum modelo habilitado neste provedor. Configure em Provedores de IA.</p>
                  )
                })()}

                {/* Smart Routing */}
                <div className="p-3 border rounded-md bg-accent/30 space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="useSmartRouting"
                      checked={form.useSmartRouting}
                      onChange={e => setForm(f => ({ ...f, useSmartRouting: e.target.checked }))}
                      className="rounded"
                    />
                    <div>
                      <label htmlFor="useSmartRouting" className="text-sm font-medium cursor-pointer flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-blue-500" />
                        Smart Routing
                      </label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Roteia entre múltiplos provedores automaticamente.
                        {form.useSmartRouting && ' O provedor principal acima será usado como fallback.'}
                      </p>
                    </div>
                  </div>

                  {form.useSmartRouting && (
                    <>
                      {/* Estratégia */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Estratégia de Seleção</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: 'BEST_PERFORMANCE', label: 'Melhor Performance', desc: 'Latência + erro + custo' },
                            { value: 'ROUND_ROBIN', label: 'Distribuir (Round-Robin)', desc: 'Aleatório, evita rate limit' },
                            { value: 'COST_OPTIMIZED', label: 'Menor Custo', desc: 'Prioriza economia' },
                          ] as const).map(opt => (
                            <button key={opt.value} type="button"
                              onClick={() => setForm(f => ({ ...f, routingStrategy: opt.value }))}
                              className={`text-left p-2 rounded-md border text-xs transition-colors ${form.routingStrategy === opt.value ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                              <div className="font-medium">{opt.label}</div>
                              <div className="text-muted-foreground mt-0.5">{opt.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Providers participantes */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                          Provedores Participantes
                          <span className="font-normal ml-1">(vazio = todos os ativos)</span>
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                          {providers.filter(p => p.isActive).map(p => (
                            <label key={p.id} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer transition-colors ${form.routingProviderIds.includes(p.id) ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}>
                              <input type="checkbox"
                                checked={form.routingProviderIds.includes(p.id)}
                                onChange={e => {
                                  setForm(f => ({
                                    ...f,
                                    routingProviderIds: e.target.checked
                                      ? [...f.routingProviderIds, p.id]
                                      : f.routingProviderIds.filter(id => id !== p.id),
                                  }))
                                }}
                                className="rounded"
                              />
                              <span className="truncate">{p.name}</span>
                              <span className="text-muted-foreground ml-auto">{p.model}</span>
                            </label>
                          ))}
                        </div>
                        {form.routingProviderIds.length > 0 && (
                          <button type="button" onClick={() => setForm(f => ({ ...f, routingProviderIds: [] }))} className="text-xs text-muted-foreground hover:text-foreground mt-1">
                            Limpar seleção (usar todos)
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Instância(s) WhatsApp</label>
                <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                  {instances.length === 0 ? (
                    <p className="text-sm text-muted-foreground col-span-2">Nenhuma instância encontrada</p>
                  ) : (
                    instances.map((inst: any) => (
                      <label key={inst.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 p-2 rounded">
                        <input
                          type="checkbox"
                          checked={form.instanceIds.includes(inst.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setForm(f => ({ ...f, instanceIds: [...f.instanceIds, inst.id] }))
                            } else {
                              setForm(f => ({ ...f, instanceIds: f.instanceIds.filter(id => id !== inst.id) }))
                            }
                          }}
                          className="rounded"
                        />
                        <span className={`w-2 h-2 rounded-full ${inst.status === 'CONNECTED' ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <span>{inst.name}</span>
                        <span className="text-muted-foreground">({inst.phone || 'sem número'})</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Se nenhuma for selecionada, o agente atua em todas as instâncias.</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Descrição</label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Breve descrição do agente" />
              </div>

              {/* Card 2: Prompt */}
              <div className="bg-card border rounded-2xl p-7 space-y-6">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2 mb-1">
                    <Settings2 className="h-4 w-4 text-blue-500" /> Prompt e Mensagens
                  </h3>
                  <p className="text-sm text-muted-foreground">Defina a personalidade, o prompt do sistema e as mensagens padrão.</p>
                </div>

              <div>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <label className="text-sm font-medium block">Prompt do Sistema *</label>
                  {id && (
                    <Link to={`/ai-agents/${id}/prompt-studio?field=SYSTEM_PROMPT`}>
                      <Button type="button" variant="outline" className="gap-2">
                        <Wand2 className="h-4 w-4" />
                        Prompt Studio
                      </Button>
                    </Link>
                  )}
                </div>
                <Textarea
                  value={form.systemPrompt}
                  onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                  required
                  rows={8}
                  placeholder="Você é um assistente virtual da empresa X. Responda de forma educada e profissional..."
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Variáveis disponíveis: {'{contact_name}'}, {'{current_datetime}'}, {'{current_date}'}, {'{current_time}'}, {'{current_day_of_week}'}, {'{remote_jid}'}
                </p>
                <div className="mt-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">💡 Envio de mídia automático</p>
                  <p className="text-xs text-muted-foreground">
                    A IA pode enviar imagens, vídeos, áudios e documentos automaticamente usando markdown:
                    <code className="mx-1 px-1 py-0.5 rounded bg-muted text-foreground">![legenda](URL)</code>
                    — basta a IA escrever nesse formato e o sistema envia a mídia. Não é necessário configurar nada extra.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Mensagem de Boas-vindas</label>
                  <Textarea
                    value={form.welcomeMessage}
                    onChange={e => setForm(f => ({ ...f, welcomeMessage: e.target.value }))}
                    rows={3}
                    placeholder="Olá! Sou o assistente virtual. Como posso ajudar?"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Enviada ao abrir nova sessão</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Mensagem Desconhecida</label>
                  <Textarea
                    value={form.unknownMessage}
                    onChange={e => setForm(f => ({ ...f, unknownMessage: e.target.value }))}
                    rows={3}
                    placeholder="Desculpe, não entendi. Pode repetir?"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Quando a IA não consegue responder</p>
                </div>
              </div>
              </div>
            </>
          )}

          {activeTab === 'trigger' && (
            <>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Tipo de Trigger</label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.triggerType}
                    onChange={e => setForm(f => ({ ...f, triggerType: e.target.value as any }))}
                  >
                    <option value="ALL">Todas as mensagens</option>
                    <option value="KEYWORD">Palavra-chave</option>
                    <option value="ADVANCED">Regex avançado</option>
                    <option value="NONE">Desabilitado</option>
                  </select>
                </div>
                {form.triggerType === 'KEYWORD' && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Operador</label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={form.triggerOperator}
                      onChange={e => setForm(f => ({ ...f, triggerOperator: e.target.value as any }))}
                    >
                      <option value="CONTAINS">Contém</option>
                      <option value="EQUALS">Igual</option>
                      <option value="STARTS_WITH">Começa com</option>
                      <option value="ENDS_WITH">Termina com</option>
                      <option value="REGEX">Regex</option>
                    </select>
                  </div>
                )}
              </div>

              {(form.triggerType === 'KEYWORD' || form.triggerType === 'ADVANCED') && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    {form.triggerType === 'KEYWORD' ? 'Palavras-chave (separadas por vírgula)' : 'Padrão Regex'}
                  </label>
                  <Input
                    value={form.triggerValue}
                    onChange={e => setForm(f => ({ ...f, triggerValue: e.target.value }))}
                    placeholder={form.triggerType === 'KEYWORD' ? 'oi, olá, bom dia' : '^(oi|olá|bom dia)'}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Palavra de Encerramento</label>
                  <Input value={form.keywordFinish} onChange={e => setForm(f => ({ ...f, keywordFinish: e.target.value }))} />
                  <p className="text-xs text-muted-foreground mt-1">Encerra sessão quando digitado pelo cliente</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Ignorar JIDs específicos</label>
                  <Input
                    value={form.ignoreJids}
                    onChange={e => setForm(f => ({ ...f, ignoreJids: e.target.value }))}
                    placeholder="5511999999999@s.whatsapp.net"
                  />
                  <p className="text-xs text-muted-foreground mt-1">JIDs individuais separados por vírgula</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Permitir somente (allowlist)</label>
                <Input
                  value={form.allowJids}
                  onChange={e => setForm(f => ({ ...f, allowJids: e.target.value }))}
                  placeholder="5511999999999, 120363012345678901@g.us"
                />
                <p className="text-xs text-muted-foreground mt-1">Se preenchido, o agente só responde para esses JIDs/números. Todos os outros são ignorados. Use o JID do grupo que aparece nos dados da conversa.</p>
              </div>

              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtros de conversa</p>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="ignoreGroups" checked={form.ignoreGroups} onChange={e => setForm(f => ({ ...f, ignoreGroups: e.target.checked }))} />
                  <label htmlFor="ignoreGroups" className="text-sm">Ignorar grupos — não responder em conversas de grupo (@g.us)</label>
                </div>
                <p className="text-xs text-muted-foreground ml-6">Canais e status são sempre ignorados automaticamente. Se "Permitir somente" estiver preenchido, ele tem prioridade sobre este filtro.</p>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Delay resposta (ms)</label>
                  <Input type="number" value={form.delayMessage} onChange={e => setForm(f => ({ ...f, delayMessage: Number(e.target.value) }))} />
                  <p className="text-xs text-muted-foreground mt-1">Atraso antes de responder</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Debounce (seg)</label>
                  <Input type="number" value={form.debounceTime} onChange={e => setForm(f => ({ ...f, debounceTime: Number(e.target.value) }))} />
                  <p className="text-xs text-muted-foreground mt-1">Agrupa msgs rápidas</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Delay/char (ms)</label>
                  <Input type="number" value={form.timePerChar} onChange={e => setForm(f => ({ ...f, timePerChar: Number(e.target.value) }))} />
                  <p className="text-xs text-muted-foreground mt-1">0 = desabilitado</p>
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="splitMsgs" checked={form.splitMessages} onChange={e => setForm(f => ({ ...f, splitMessages: e.target.checked }))} />
                  <label htmlFor="splitMsgs" className="text-sm">Dividir em parágrafos (\n\n) como mensagens separadas</label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                  <label htmlFor="isDefault" className="text-sm">Bot padrão (ativado quando nenhum outro trigger corresponder)</label>
                </div>
              </div>

              {form.splitMessages && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Tamanho máximo por parte</label>
                  <Input type="number" value={form.maxMessageLength} onChange={e => setForm(f => ({ ...f, maxMessageLength: Number(e.target.value) }))} />
                </div>
              )}
            </>
          )}

          {activeTab === 'session' && (
            <>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Timeout da Sessão (minutos)</label>
                <Input type="number" value={form.sessionTimeout} onChange={e => setForm(f => ({ ...f, sessionTimeout: Number(e.target.value) }))} />
                <p className="text-xs text-muted-foreground mt-1">Após este tempo sem atividade, a sessão expira automaticamente</p>
              </div>
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="keepOpen" checked={form.keepOpen} onChange={e => setForm(f => ({ ...f, keepOpen: e.target.checked }))} />
                  <div>
                    <label htmlFor="keepOpen" className="text-sm font-medium">Manter sessão sempre aberta</label>
                    <p className="text-xs text-muted-foreground">A sessão nunca expira por timeout</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="listenMe" checked={form.listeningFromMe} onChange={e => setForm(f => ({ ...f, listeningFromMe: e.target.checked }))} />
                  <div>
                    <label htmlFor="listenMe" className="text-sm font-medium">Escutar mensagens enviadas por mim</label>
                    <p className="text-xs text-muted-foreground">A IA também processa mensagens que você envia</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="stopMe" checked={form.stopBotFromMe} onChange={e => setForm(f => ({ ...f, stopBotFromMe: e.target.checked }))} />
                  <div>
                    <label htmlFor="stopMe" className="text-sm font-medium">Pausar bot quando atendente responder</label>
                    <p className="text-xs text-muted-foreground">Ao enviar mensagem pelo CRM, a sessão é pausada automaticamente</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'schedule' && (
            <>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  <strong><Clock className="h-4 w-4 inline mr-1" />Quando a IA pode responder</strong> — Defina o modo de funcionamento. Use o horário comercial da instância (configurado em Canais → Horário) ou crie slots customizados.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Modo de funcionamento</label>
                <select
                  className="w-full bg-background border rounded-lg px-3 py-2 text-sm"
                  value={form.scheduleMode}
                  onChange={e => setForm(f => ({ ...f, scheduleMode: e.target.value as any }))}
                >
                  <option value="ALWAYS">Sempre (24/7)</option>
                  <option value="BUSINESS_HOURS">Apenas em horário comercial (da instância)</option>
                  <option value="OUT_OF_BUSINESS_HOURS">Apenas fora do horário comercial</option>
                  <option value="CUSTOM">Horários específicos (slots customizados)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Os modos "horário comercial" usam a configuração de cada instância vinculada (Canais → Horário de Atendimento).
                </p>
              </div>

              {form.scheduleMode === 'CUSTOM' && (
                <div className="space-y-3 border rounded-lg p-4 bg-card/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">Slots de funcionamento</label>
                      <p className="text-xs text-muted-foreground">Adicione um ou mais intervalos por dia da semana</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        scheduleSlots: [...f.scheduleSlots, { dayOfWeek: 1, openHour: 9, openMinutes: 0, closeHour: 18, closeMinutes: 0 }],
                      }))}
                      className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                    >
                      + Adicionar slot
                    </button>
                  </div>

                  {form.scheduleSlots.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">Nenhum slot definido — a IA ficará desativada em CUSTOM sem slots.</p>
                  )}

                  {form.scheduleSlots.map((slot, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <select
                        className="bg-background border rounded px-2 py-1.5"
                        value={slot.dayOfWeek}
                        onChange={e => setForm(f => ({
                          ...f,
                          scheduleSlots: f.scheduleSlots.map((s, i) => i === idx ? { ...s, dayOfWeek: Number(e.target.value) } : s),
                        }))}
                      >
                        <option value={0}>Domingo</option>
                        <option value={1}>Segunda</option>
                        <option value={2}>Terça</option>
                        <option value={3}>Quarta</option>
                        <option value={4}>Quinta</option>
                        <option value={5}>Sexta</option>
                        <option value={6}>Sábado</option>
                      </select>
                      <span className="text-xs text-muted-foreground">de</span>
                      <input
                        type="time"
                        className="bg-background border rounded px-2 py-1.5"
                        value={`${String(slot.openHour).padStart(2, '0')}:${String(slot.openMinutes).padStart(2, '0')}`}
                        onChange={e => {
                          const [h, m] = e.target.value.split(':').map(Number)
                          setForm(f => ({
                            ...f,
                            scheduleSlots: f.scheduleSlots.map((s, i) => i === idx ? { ...s, openHour: h || 0, openMinutes: m || 0 } : s),
                          }))
                        }}
                      />
                      <span className="text-xs text-muted-foreground">até</span>
                      <input
                        type="time"
                        className="bg-background border rounded px-2 py-1.5"
                        value={`${String(slot.closeHour).padStart(2, '0')}:${String(slot.closeMinutes).padStart(2, '0')}`}
                        onChange={e => {
                          const [h, m] = e.target.value.split(':').map(Number)
                          setForm(f => ({
                            ...f,
                            scheduleSlots: f.scheduleSlots.map((s, i) => i === idx ? { ...s, closeHour: h || 0, closeMinutes: m || 0 } : s),
                          }))
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, scheduleSlots: f.scheduleSlots.filter((_, i) => i !== idx) }))}
                        className="text-xs text-red-500 hover:text-red-600 px-2"
                      >
                        Remover
                      </button>
                    </div>
                  ))}

                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-xs font-medium">Fuso horário</label>
                    <input
                      type="text"
                      className="w-full bg-background border rounded px-3 py-2 text-sm"
                      value={form.scheduleTimezone}
                      onChange={e => setForm(f => ({ ...f, scheduleTimezone: e.target.value }))}
                      placeholder="America/Sao_Paulo"
                    />
                    <p className="text-xs text-muted-foreground">
                      Ex.: <code>America/Sao_Paulo</code>, <code>America/Manaus</code>, <code>Europe/Lisbon</code>
                    </p>
                  </div>
                </div>
              )}

              {form.scheduleMode !== 'ALWAYS' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mensagem fora do horário (opcional)</label>
                  <textarea
                    className="w-full bg-background border rounded-lg px-3 py-2 text-sm min-h-[80px]"
                    placeholder="Ex.: Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve."
                    value={form.scheduleOffMessage}
                    onChange={e => setForm(f => ({ ...f, scheduleOffMessage: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enviada uma vez a cada 30 min para o mesmo contato. Deixe em branco para ficar em silêncio total.
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === 'followup' && (
            <>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <p className="text-sm text-purple-600 dark:text-purple-400">
                  <strong><RotateCw className="h-4 w-4 inline mr-1" />Follow-Up Automático</strong> — Configure steps personalizados para reengajar clientes que pararam de responder. Cada step tem seu próprio delay (contado sempre a partir da última mensagem da IA).
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="followUpEnabled"
                  checked={form.followUpEnabled}
                  onChange={e => setForm(f => ({ ...f, followUpEnabled: e.target.checked }))}
                />
                <div>
                  <label htmlFor="followUpEnabled" className="text-sm font-medium">Ativar Follow-Up</label>
                  <p className="text-xs text-muted-foreground">Reengaja clientes que pararam de responder</p>
                </div>
              </div>

              {form.followUpEnabled && (
                <>
                  {/* Steps editor */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Steps de Follow-Up</label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const steps = [...(form as any).followUpSteps || []]
                          const lastDelay = steps.length > 0 ? steps[steps.length - 1].delayMinutes : 0
                          steps.push({ delayMinutes: lastDelay + 120, type: 'AI_GENERATED', message: '' })
                          setForm(f => ({ ...f, followUpSteps: steps } as any))
                        }}
                      >
                        + Adicionar Step
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Cada step define quando e como enviar um follow-up. O delay é <strong>sempre a partir da última mensagem real da IA</strong> (não do follow-up anterior).
                    </p>

                    {((form as any).followUpSteps || []).length === 0 && (
                      <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground text-sm">
                        Nenhum step configurado. Clique em "+ Adicionar Step" para criar.
                      </div>
                    )}

                    {((form as any).followUpSteps || []).map((step: any, index: number) => {
                      const hours = Math.floor(step.delayMinutes / 60)
                      const mins = step.delayMinutes % 60
                      const delayLabel = hours > 0 ? `${hours}h${mins > 0 ? mins + 'min' : ''}` : `${mins}min`

                      return (
                        <div key={index} className="border rounded-lg p-4 space-y-3 bg-accent/20">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                              Step {index + 1} — após {delayLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const steps = [...(form as any).followUpSteps || []]
                                steps.splice(index, 1)
                                setForm(f => ({ ...f, followUpSteps: steps } as any))
                              }}
                              className="text-red-600 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300 text-xs"
                            >
                              ✕ Remover
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Delay (minutos)</label>
                              <Input
                                type="number"
                                min={1}
                                value={step.delayMinutes}
                                onChange={e => {
                                  const steps = [...(form as any).followUpSteps || []]
                                  steps[index] = { ...steps[index], delayMinutes: Number(e.target.value) }
                                  setForm(f => ({ ...f, followUpSteps: steps } as any))
                                }}
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                {step.delayMinutes >= 60 ? `= ${Math.floor(step.delayMinutes / 60)}h ${step.delayMinutes % 60}min` : `= ${step.delayMinutes} minutos`}
                              </p>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
                              <select
                                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                value={step.type}
                                onChange={e => {
                                  const steps = [...(form as any).followUpSteps || []]
                                  steps[index] = { ...steps[index], type: e.target.value }
                                  setForm(f => ({ ...f, followUpSteps: steps } as any))
                                }}
                              >
                                <option value="AI_GENERATED">🤖 IA Gera</option>
                                <option value="FIXED">📝 Mensagem Fixa</option>
                              </select>
                            </div>
                            <div className="flex items-end gap-2">
                              {index > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const steps = [...(form as any).followUpSteps || []]
                                    ;[steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]
                                    setForm(f => ({ ...f, followUpSteps: steps } as any))
                                  }}
                                >
                                  ↑
                                </Button>
                              )}
                              {index < ((form as any).followUpSteps || []).length - 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const steps = [...(form as any).followUpSteps || []]
                                    ;[steps[index], steps[index + 1]] = [steps[index + 1], steps[index]]
                                    setForm(f => ({ ...f, followUpSteps: steps } as any))
                                  }}
                                >
                                  ↓
                                </Button>
                              )}
                            </div>
                          </div>

                          {step.type === 'FIXED' && (
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Mensagem</label>
                              <Textarea
                                value={step.message || ''}
                                onChange={e => {
                                  const steps = [...(form as any).followUpSteps || []]
                                  steps[index] = { ...steps[index], message: e.target.value }
                                  setForm(f => ({ ...f, followUpSteps: steps } as any))
                                }}
                                rows={2}
                                placeholder="Oi! Ainda posso te ajudar?"
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Quick presets */}
                    {((form as any).followUpSteps || []).length === 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Templates prontos:</p>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setForm(f => ({ ...f, followUpSteps: [
                              { delayMinutes: 120, type: 'AI_GENERATED', message: '' },
                              { delayMinutes: 240, type: 'AI_GENERATED', message: '' },
                              { delayMinutes: 960, type: 'FIXED', message: 'Olá! Tudo bem? Estou por aqui se precisar 😊' },
                              { delayMinutes: 1380, type: 'FIXED', message: 'Caso precise de algo, é só me chamar!' },
                            ]} as any))}
                          >
                            📅 Comercial (2h, 4h, 16h, 23h)
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setForm(f => ({ ...f, followUpSteps: [
                              { delayMinutes: 30, type: 'AI_GENERATED', message: '' },
                              { delayMinutes: 120, type: 'AI_GENERATED', message: '' },
                              { delayMinutes: 480, type: 'FIXED', message: 'Olá! Percebi que ainda não respondeu. Posso ajudar?' },
                            ]} as any))}
                          >
                            ⚡ Rápido (30min, 2h, 8h)
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setForm(f => ({ ...f, followUpSteps: [
                              { delayMinutes: 5, type: 'AI_GENERATED', message: '' },
                              { delayMinutes: 15, type: 'FIXED', message: 'Oi, ainda está aí? 😊' },
                            ]} as any))}
                          >
                            🧪 Teste (5min, 15min)
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prompt para steps AI_GENERATED */}
                  {((form as any).followUpSteps || []).some((s: any) => s.type === 'AI_GENERATED') && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <label className="text-sm font-medium block">Prompt para Follow-Ups gerados pela IA (opcional)</label>
                        {id && (
                          <Link to={`/ai-agents/${id}/prompt-studio?field=FOLLOW_UP_PROMPT`}>
                            <Button type="button" variant="outline" className="gap-2">
                              <Wand2 className="h-4 w-4" />
                              Prompt Studio
                            </Button>
                          </Link>
                        )}
                      </div>
                      <Textarea
                        value={form.followUpPrompt}
                        onChange={e => setForm(f => ({ ...f, followUpPrompt: e.target.value }))}
                        rows={4}
                        placeholder="Gere uma mensagem curta e amigável para reengajar o cliente. Tentativa {attempt} de {max_attempts}. Histórico: {history}"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Variáveis: {'{history}'}, {'{attempt}'}, {'{max_attempts}'}, {'{contact_name}'}. Se vazio, usa prompt padrão.
                      </p>
                    </div>
                  )}

                  {/* Ação após último step */}
                  <div className="border-t pt-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium block mb-2">Ação após o último step</label>
                      <p className="text-xs text-muted-foreground mb-3">O que acontece quando todos os follow-ups foram enviados e o cliente não respondeu.</p>
                      <div className="space-y-2">
                        {([
                          { value: 'CLOSE', label: 'Encerrar sessão', desc: 'Sessão fechada. Se o cliente mandar msg que bata com o gatilho, a IA é ativada novamente.' },
                          { value: 'PAUSE', label: 'Pausar sessão', desc: 'IA para de responder até ser retomada manualmente ou pelo auto-retomar. Se o cliente enviar msg, ela é ignorada.' },
                          { value: 'NONE', label: 'Manter sessão ativa', desc: 'IA continua disponível e responde normalmente, apenas sem enviar mais follow-ups.' },
                        ] as const).map(opt => (
                          <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${form.followUpEndAction === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/30'}`}>
                            <input
                              type="radio"
                              name="followUpEndAction"
                              value={opt.value}
                              checked={form.followUpEndAction === opt.value}
                              onChange={() => setForm(f => ({ ...f, followUpEndAction: opt.value }))}
                              className="mt-0.5"
                            />
                            <div>
                              <span className="text-sm font-medium">{opt.label}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Delay antes de aplicar a ação */}
                    {form.followUpEndAction !== 'NONE' && (
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Aguardar antes de aplicar a ação</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            className="w-24 border rounded-md px-3 py-1.5 text-sm bg-background"
                            value={form.followUpEndDelayMinutes}
                            onChange={e => setForm(f => ({ ...f, followUpEndDelayMinutes: Math.max(0, Number(e.target.value)) }))}
                          />
                          <span className="text-sm text-muted-foreground">minutos após o último follow-up (0 = imediato)</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Útil para dar uma janela de resposta antes de encerrar/pausar. Ex: 60 = aguarda 1h após o último step.
                        </p>
                      </div>
                    )}

                    {/* Mensagem de encerramento/pausamento */}
                    {form.followUpEndAction !== 'NONE' && (
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">
                          Mensagem ao {form.followUpEndAction === 'PAUSE' ? 'pausar' : 'encerrar'} (opcional)
                        </label>
                        <Input
                          value={form.followUpCloseMessage}
                          onChange={e => setForm(f => ({ ...f, followUpCloseMessage: e.target.value }))}
                          placeholder={form.followUpEndAction === 'PAUSE' ? 'Vou pausar nosso contato por ora. Qualquer dúvida, pode me chamar!' : 'Estarei aqui se precisar! Até mais 😊'}
                        />
                        <p className="text-xs text-muted-foreground mt-1">Deixe vazio para {form.followUpEndAction === 'PAUSE' ? 'pausar' : 'encerrar'} silenciosamente.</p>
                      </div>
                    )}

                    {/* Auto-liberar sessão pausada */}
                    {form.followUpEndAction === 'PAUSE' && (
                      <div className="border rounded-lg p-4 space-y-4 bg-amber-500/5 border-amber-500/20">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="pauseAutoResumeEnabled"
                            checked={form.pauseAutoResumeEnabled}
                            onChange={e => setForm(f => ({ ...f, pauseAutoResumeEnabled: e.target.checked }))}
                          />
                          <div>
                            <label htmlFor="pauseAutoResumeEnabled" className="text-sm font-medium cursor-pointer">Auto-liberar sessão pausada</label>
                            <p className="text-xs text-muted-foreground">A sessão é <strong>encerrada</strong> automaticamente após o tempo configurado, liberando o contato para iniciar uma nova sessão se mandar uma mensagem que bata com um gatilho.</p>
                          </div>
                        </div>

                        {form.pauseAutoResumeEnabled && (
                          <div className="ml-6 space-y-3">
                            <div>
                              <label className="text-sm font-medium mb-1.5 block">Encerrar após</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={1}
                                  className="w-24 border rounded-md px-3 py-1.5 text-sm bg-background"
                                  value={form.pauseAutoResumeMinutes}
                                  onChange={e => setForm(f => ({ ...f, pauseAutoResumeMinutes: Math.max(1, Number(e.target.value)) }))}
                                />
                                <span className="text-sm text-muted-foreground">minutos desde:</span>
                              </div>
                            </div>
                            <div>
                              <label className="text-sm font-medium mb-1.5 block">Contado a partir de</label>
                              <select
                                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                                value={form.pauseAutoResumeTrigger}
                                onChange={e => setForm(f => ({ ...f, pauseAutoResumeTrigger: e.target.value as any }))}
                              >
                                <option value="PAUSED_AT">A sessão ser pausada</option>
                                <option value="LAST_CONTACT_MSG">Última mensagem do contato</option>
                                <option value="LAST_ATTENDANT_MSG">Última interação do atendente humano</option>
                              </select>
                              <p className="text-xs text-muted-foreground mt-1">
                                {form.pauseAutoResumeTrigger === 'PAUSED_AT' && 'Ex: 120 min → encerra a sessão 2h depois de ser pausada.'}
                                {form.pauseAutoResumeTrigger === 'LAST_CONTACT_MSG' && 'Ex: 240 min → encerra se o contato não enviou msg há 4h.'}
                                {form.pauseAutoResumeTrigger === 'LAST_ATTENDANT_MSG' && 'Ex: 480 min → encerra se o atendente não interagiu há 8h.'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Timeline preview */}
                  {((form as any).followUpSteps || []).length > 0 && (
                    <div className="bg-accent/30 border rounded-lg p-4 space-y-3">
                      <p className="text-sm font-medium">📋 Timeline do Follow-Up:</p>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-xs">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span className="text-muted-foreground w-20">T = 0</span>
                          <span>IA responde ao cliente → <strong>começa a contar</strong></span>
                        </div>
                        {((form as any).followUpSteps || []).map((step: any, i: number) => {
                          const h = Math.floor(step.delayMinutes / 60)
                          const m = step.delayMinutes % 60
                          const label = h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`
                          return (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <div className={`w-2 h-2 rounded-full ${step.type === 'AI_GENERATED' ? 'bg-purple-500' : 'bg-blue-500'}`} />
                              <span className="text-muted-foreground w-20">T + {label}</span>
                              <span>
                                Step {i + 1}: {step.type === 'AI_GENERATED' ? '🤖 IA gera mensagem' : `📝 "${(step.message || '').substring(0, 50)}${(step.message || '').length > 50 ? '...' : ''}"`}
                              </span>
                            </div>
                          )
                        })}
                        {form.followUpEndAction !== 'NONE' && (
                          <div className="flex items-center gap-3 text-xs">
                            <div className={`w-2 h-2 rounded-full ${form.followUpEndAction === 'PAUSE' ? 'bg-amber-500' : 'bg-red-500'}`} />
                            <span className="text-muted-foreground w-20">
                              {form.followUpEndDelayMinutes > 0 ? `+${form.followUpEndDelayMinutes}min` : 'Fim'}
                            </span>
                            <span>
                              {form.followUpEndAction === 'PAUSE' ? '⏸ Sessão pausada' : '🔴 Sessão encerrada'}
                              {form.followUpCloseMessage ? ' com mensagem de despedida' : ''}
                              {form.followUpEndDelayMinutes > 0 ? ` (${form.followUpEndDelayMinutes}min após último step)` : ''}
                            </span>
                          </div>
                        )}
                        {form.followUpEndAction === 'PAUSE' && form.pauseAutoResumeEnabled && (
                          <div className="flex items-center gap-3 text-xs">
                            <div className="w-2 h-2 rounded-full bg-red-400" />
                            <span className="text-muted-foreground w-20">Auto</span>
                            <span>🔓 Sessão encerrada após {form.pauseAutoResumeMinutes}min ({
                              form.pauseAutoResumeTrigger === 'PAUSED_AT' ? 'desde a pausa' :
                              form.pauseAutoResumeTrigger === 'LAST_CONTACT_MSG' ? 'desde última msg do contato' :
                              'desde última interação do atendente'
                            }) — contato liberado para novo gatilho</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                        💡 Se o cliente responder a qualquer momento, os follow-ups são resetados.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'tools' && (
            <>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  <strong>⚡ Function Calling</strong> — Configuração por agente, com módulos separados como Dify/N8N: CRM, HTTP Request, MCP e Logs.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 border-b pb-3">
                {[
                  { id: 'overview', label: 'Visão Geral', icon: Brain },
                  { id: 'crm', label: 'CRM Tools', icon: Wrench },
                  { id: 'http', label: 'HTTP Request', icon: Globe },
                  { id: 'mcp', label: 'MCP', icon: Server },
                  { id: 'subagents', label: 'Sub-Agentes', icon: Brain },
                  { id: 'logs', label: 'Logs', icon: Activity },
                ].map(tab => {
                  const Icon = tab.icon
                  return (
                    <Button
                      key={tab.id}
                      type="button"
                      variant={toolSubTab === tab.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setToolSubTab(tab.id as any)}
                    >
                      <Icon className="h-3.5 w-3.5 mr-1.5" />
                      {tab.label}
                    </Button>
                  )
                })}
              </div>

              {toolSubTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Role do Agente</label>
                      <Input
                        value={form.settingsRole}
                        onChange={e => setForm(f => ({ ...f, settingsRole: e.target.value }))}
                        placeholder="Assistente de vendas especializado"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Goal / Objetivo</label>
                      <Input
                        value={form.settingsGoal}
                        onChange={e => setForm(f => ({ ...f, settingsGoal: e.target.value }))}
                        placeholder="Converter leads em clientes"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Tipo de Agente</label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={form.type}
                      onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                    >
                      <option value="LLM">LLM (agente único)</option>
                      <option value="SEQUENTIAL">Sequential (sub-agentes)</option>
                    </select>
                  </div>

                  {form.type === 'SEQUENTIAL' && (
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Sub-agentes (ordem de execução)</label>
                      <div className="space-y-2 border rounded-md p-3">
                        {agents.filter(a => a.id !== id).map(a => {
                          const selectedIds = form.subAgentIds.split(',').map(s => s.trim()).filter(Boolean)
                          const isSelected = selectedIds.includes(a.id)
                          return (
                            <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const newIds = isSelected
                                    ? selectedIds.filter(sid => sid !== a.id)
                                    : [...selectedIds, a.id]
                                  setForm(f => ({ ...f, subAgentIds: newIds.join(', ') }))
                                }}
                                className="rounded"
                              />
                              <Brain className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                              {a.name} <span className="text-muted-foreground">({a.type})</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="border rounded-xl p-5 hover:border-purple-500/50 transition-colors cursor-pointer" onClick={() => setToolSubTab('crm')}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                          <Wrench className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                          <p className="text-3xl font-bold">{form.crmToolsEnabled ? form.crmToolsList.split(',').filter(Boolean).length : 0}</p>
                          <p className="text-sm text-muted-foreground font-medium">CRM Tools Ativas</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Ferramentas nativas para buscar contatos, conversar, atribuir times e muito mais.</p>
                    </div>
                    <div className="border rounded-xl p-5 hover:border-cyan-500/50 transition-colors cursor-pointer" onClick={() => setToolSubTab('http')}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-11 h-11 rounded-xl bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                          <Globe className="h-5 w-5 text-cyan-500" />
                        </div>
                        <div>
                          <p className="text-3xl font-bold">{httpTools.length}</p>
                          <p className="text-sm text-muted-foreground font-medium">HTTP Tools</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Integre com qualquer API externa: agendamentos, CRMs, ERPs, notificações e mais.</p>
                    </div>
                    <div className="border rounded-xl p-5 hover:border-emerald-500/50 transition-colors cursor-pointer" onClick={() => setToolSubTab('mcp')}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                          <Server className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                          <p className="text-3xl font-bold">{selectedMcpIds.length}</p>
                          <p className="text-sm text-muted-foreground font-medium">MCP Servers</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Model Context Protocol: conecte ferramentas externas como Cal.com, Google Agenda, Notion.</p>
                    </div>
                    <div className="border rounded-xl p-5 hover:border-orange-500/50 transition-colors cursor-pointer" onClick={() => setToolSubTab('logs')}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-11 h-11 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                          <Activity className="h-5 w-5 text-orange-500" />
                        </div>
                        <div>
                          <p className="text-3xl font-bold">{toolLogs.length}</p>
                          <p className="text-sm text-muted-foreground font-medium">Logs Recentes</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Debug completo de execuções: input, output, erros, tempo de resposta e retries.</p>
                    </div>
                  </div>
                </div>
              )}

              {toolSubTab === 'crm' && (
                <div className="border rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      <span className="font-medium">CRM Tools Nativas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="crmToolsEnabled"
                        checked={form.crmToolsEnabled}
                        onChange={e => setForm(f => ({ ...f, crmToolsEnabled: e.target.checked }))}
                      />
                      <label htmlFor="crmToolsEnabled" className="text-sm">Habilitadas</label>
                    </div>
                  </div>
                  {form.crmToolsEnabled && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { name: 'search_contacts', label: 'Buscar contatos', desc: 'Pesquisar contatos pelo nome ou telefone' },
                          { name: 'get_contact_details', label: 'Detalhes contato', desc: 'Ver dados completos de um contato' },
                          { name: 'update_contact', label: 'Atualizar contato', desc: 'Alterar nome, email, tags' },
                          { name: 'create_contact', label: 'Criar contato', desc: 'Cadastrar novo contato' },
                          { name: 'get_conversation_info', label: 'Info conversa', desc: 'Dados da conversa atual' },
                          { name: 'assign_conversation', label: 'Atribuir conversa', desc: 'Transferir para atendente/time' },
                          { name: 'add_note', label: 'Adicionar nota', desc: 'Registrar observação interna' },
                          { name: 'list_teams', label: 'Listar times', desc: 'Ver times disponíveis' },
                          { name: 'list_canned_responses', label: 'Respostas prontas', desc: 'Respostas pré-configuradas' },
                        ].map(tool => {
                          const checked = form.crmToolsList.includes(tool.name)
                          return (
                            <label key={tool.name} className="flex items-start gap-2 text-sm py-2 px-2 rounded hover:bg-accent/50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                className="mt-0.5"
                                onChange={() => {
                                  const tools = form.crmToolsList.split(',').map(t => t.trim()).filter(Boolean)
                                  const newTools = checked
                                    ? tools.filter(t => t !== tool.name)
                                    : [...tools, tool.name]
                                  setForm(f => ({ ...f, crmToolsList: newTools.join(',') }))
                                }}
                              />
                              <div>
                                <div className="font-medium">{tool.label}</div>
                                <div className="text-xs text-muted-foreground">{tool.desc}</div>
                              </div>
                            </label>
                          )
                        })}
                      </div>

                      {/* Sandbox / Restrições CRM */}
                      <div className="border rounded-lg p-4 mt-4 space-y-4 bg-red-500/5 border-red-500/20">
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                          <Settings2 className="h-4 w-4" />
                          <span className="font-medium text-sm">Restrições de Segurança (Sandbox CRM)</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Controla quais dados do CRM o agente de I.A. pode acessar e modificar. No modo <strong>Apenas Contato Atual</strong>, 
                          o agente só consegue ver e alterar dados do contato da conversa ativa — impossível acessar dados de outros contatos.
                        </p>

                        {/* Modo Sandbox */}
                        <div>
                          <label className="text-xs font-medium block mb-1.5">Modo de Acesso</label>
                          <select
                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={crmSandbox.sandboxMode}
                            onChange={e => setCrmSandbox(prev => ({ ...prev, sandboxMode: e.target.value as any }))}
                          >
                            <option value="CURRENT_ONLY">Apenas Contato Atual (recomendado)</option>
                            <option value="COMPANY">Todos os Contatos da Empresa (sem restrição)</option>
                          </select>
                          {crmSandbox.sandboxMode === 'COMPANY' && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                              Atenção: o agente poderá acessar dados de QUALQUER contato da empresa.
                            </p>
                          )}
                        </div>

                        {/* Permissões de Leitura */}
                        <div>
                          <label className="text-xs font-semibold block mb-2 text-blue-600 dark:text-blue-400">Permissões de Leitura</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { key: 'contact_name', label: 'Nome do contato' },
                              { key: 'contact_email', label: 'Email do contato' },
                              { key: 'contact_phone', label: 'Telefone do contato' },
                              { key: 'contact_tags', label: 'Tags do contato' },
                              { key: 'custom_fields', label: 'Campos personalizados' },
                              { key: 'conversation_status', label: 'Status da conversa' },
                              { key: 'conversation_assignee', label: 'Atendente atribuído' },
                              { key: 'conversation_team', label: 'Time atribuído' },
                              { key: 'conversation_labels', label: 'Etiquetas da conversa' },
                              { key: 'conversation_priority', label: 'Prioridade da conversa' },
                              { key: 'conversation_history', label: 'Histórico de mensagens' },
                              { key: 'teams', label: 'Lista de times' },
                              { key: 'canned_responses', label: 'Respostas prontas' },
                            ].map(item => (
                              <label key={item.key} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-accent/50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={(crmSandbox.read as any)[item.key]}
                                  onChange={e => setCrmSandbox(prev => ({
                                    ...prev,
                                    read: { ...prev.read, [item.key]: e.target.checked },
                                  }))}
                                />
                                {item.label}
                              </label>
                            ))}
                          </div>
                          {/* Notas privadas — checkbox + limite inline */}
                          <div className="flex items-center gap-3 mt-1 px-2">
                            <label className="flex items-center gap-2 text-xs py-1 rounded hover:bg-accent/50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={crmSandbox.read.contact_notes}
                                onChange={e => setCrmSandbox(prev => ({
                                  ...prev,
                                  read: { ...prev.read, contact_notes: e.target.checked },
                                }))}
                              />
                              Notas privadas do contato
                            </label>
                            {crmSandbox.read.contact_notes && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Qtd:</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={50}
                                  value={crmSandbox.notesLimit}
                                  onChange={e => setCrmSandbox(prev => ({ ...prev, notesLimit: Math.max(1, Math.min(50, Number(e.target.value) || 1)) }))}
                                  className="w-14 px-1.5 py-0.5 rounded border border-border bg-background text-xs"
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Permissões de Escrita */}
                        <div>
                          <label className="text-xs font-semibold block mb-2 text-orange-600 dark:text-orange-400">Permissões de Escrita</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { key: 'contact_name', label: 'Alterar nome do contato' },
                              { key: 'contact_email', label: 'Alterar email do contato' },
                              { key: 'contact_tags', label: 'Alterar tags do contato' },
                              { key: 'custom_fields', label: 'Alterar campos personalizados' },
                              { key: 'conversation_assign', label: 'Atribuir conversa' },
                              { key: 'conversation_notes', label: 'Adicionar notas' },
                              { key: 'contact_create', label: 'Criar novos contatos' },
                            ].map(item => (
                              <label key={item.key} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-accent/50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={(crmSandbox.write as any)[item.key]}
                                  onChange={e => setCrmSandbox(prev => ({
                                    ...prev,
                                    write: { ...prev.write, [item.key]: e.target.checked },
                                  }))}
                                />
                                {item.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {toolSubTab === 'http' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium flex items-center gap-2"><Globe className="h-4 w-4 text-cyan-400" /> HTTP Request Tools</h3>
                      <p className="text-xs text-muted-foreground mt-1">Builder visual com método, auth, headers, parâmetros e timeout.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setShowOpenAPIModal(true)}>
                        <Upload className="h-4 w-4 mr-1.5" />
                        Importar OpenAPI
                      </Button>
                      <Button type="button" onClick={addHttpTool}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Adicionar Tool
                      </Button>
                    </div>
                  </div>

                  {/* Modal OpenAPI Import */}
                  {showOpenAPIModal && (
                    <div className="border rounded-lg p-4 bg-accent/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          <Upload className="w-4 h-4" />
                          Importar especificação OpenAPI
                        </h4>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setShowOpenAPIModal(false); setOpenAPISpec('') }}>✕</Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Cole a especificação OpenAPI 3.x (JSON). As operações serão convertidas em HTTP Tools automaticamente.</p>
                      <Textarea
                        value={openAPISpec}
                        onChange={e => setOpenAPISpec(e.target.value)}
                        placeholder='{"openapi": "3.0.0", "info": {...}, "paths": {...}}'
                        className="min-h-[120px] font-mono text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => { setShowOpenAPIModal(false); setOpenAPISpec('') }}>Cancelar</Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!openAPISpec.trim() || openAPILoading}
                          onClick={async () => {
                            setOpenAPILoading(true)
                            try {
                              const result = await importOpenAPISpec(openAPISpec)
                              if (result.tools.length === 0) {
                                toast.error('Nenhuma operação encontrada na especificação')
                                return
                              }
                              // Converter tools importadas para formato do editor
                              const imported: HttpTool[] = result.tools.map(t => ({
                                ...DEFAULT_HTTP_TOOL,
                                name: t.name,
                                description: t.description,
                                method: t.method as HttpTool['method'],
                                endpoint: t.url,
                                authType: t.auth?.type === 'bearer' ? 'bearer' : t.auth?.type === 'api_key_header' ? 'api_key_header' : t.auth?.type === 'api_key_query' ? 'api_key_query' : 'none',
                                authKey: t.auth?.apiKeyName || '',
                                authValue: t.auth?.token || t.auth?.apiKey || '',
                                parameters: (t.parameters || []).map((p: any) => ({
                                  name: p.name,
                                  description: p.description,
                                  in: p.in as HttpToolParam['in'],
                                  type: p.type,
                                  required: p.required,
                                  default: p.default ? String(p.default) : undefined,
                                })),
                                timeout: t.timeout || 30000,
                              }))
                              setHttpTools(prev => [...prev, ...imported])
                              toast.success(`${imported.length} tools importadas de "${result.info.title}" v${result.info.version}`)
                              if (result.errors.length > 0) {
                                toast.error(`${result.errors.length} operações falharam: ${result.errors[0]}`)
                              }
                              setShowOpenAPIModal(false)
                              setOpenAPISpec('')
                            } catch (e: any) {
                              toast.error(e.response?.data?.error || 'Erro ao importar especificação')
                            }
                            setOpenAPILoading(false)
                          }}
                        >
                          {openAPILoading ? 'Importando...' : 'Importar'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {httpTools.length === 0 && (
                    <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                      Nenhuma HTTP tool criada ainda.
                    </div>
                  )}

                  {httpTools.map((tool, idx) => {
                    const isExpanded = expandedHttpTool === idx
                    return (
                      <div key={idx} className="border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/40"
                          onClick={() => setExpandedHttpTool(isExpanded ? null : idx)}
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{tool.name || `tool_${idx + 1}`}</span>
                            <span className="text-xs px-2 py-0.5 rounded border">{tool.method}</span>
                            <span className="text-xs text-muted-foreground">{tool.endpoint || 'sem URL'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                duplicateHttpTool(idx)
                              }}
                            >Duplicar</Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeHttpTool(idx)
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                            </Button>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-4 border-t space-y-4 bg-accent/10">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs font-medium block mb-1">Nome da Tool</label>
                                <Input value={tool.name} onChange={e => updateHttpTool(idx, { name: e.target.value })} placeholder="cal_create_booking" />
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1">Método</label>
                                <select
                                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                  value={tool.method}
                                  onChange={e => updateHttpTool(idx, { method: e.target.value as HttpTool['method'] })}
                                >
                                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="text-xs font-medium block mb-1">Descrição</label>
                              <Input value={tool.description} onChange={e => updateHttpTool(idx, { description: e.target.value })} placeholder="Cria evento no calendário" />
                            </div>

                            <div>
                              <label className="text-xs font-medium block mb-1">Endpoint</label>
                              <Input value={tool.endpoint} onChange={e => updateHttpTool(idx, { endpoint: e.target.value })} placeholder="https://api.exemplo.com/v1/events" />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <label className="text-xs font-medium block mb-1">Auth</label>
                                <select
                                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                  value={tool.authType}
                                  onChange={e => updateHttpTool(idx, { authType: e.target.value as HttpTool['authType'] })}
                                >
                                  <option value="none">Nenhuma</option>
                                  <option value="bearer">Bearer Token</option>
                                  <option value="api_key_header">API Key (Header)</option>
                                  <option value="api_key_query">API Key (Query)</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1">Auth Key (opcional)</label>
                                <Input value={tool.authKey || ''} onChange={e => updateHttpTool(idx, { authKey: e.target.value })} placeholder="Authorization / x-api-key" />
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1">Auth Value</label>
                                <Input value={tool.authValue || ''} onChange={e => updateHttpTool(idx, { authValue: e.target.value })} placeholder="token/chave" />
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <label className="text-xs font-medium block mb-1">Timeout (ms)</label>
                                <Input type="number" value={tool.timeout} onChange={e => updateHttpTool(idx, { timeout: Number(e.target.value) })} />
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1">Retries</label>
                                <Input type="number" value={tool.retryCount} onChange={e => updateHttpTool(idx, { retryCount: Number(e.target.value) })} />
                              </div>
                              <div>
                                <label className="text-xs font-medium block mb-1">Extract Field (opcional)</label>
                                <Input value={tool.responseMapping || ''} onChange={e => updateHttpTool(idx, { responseMapping: e.target.value })} placeholder="data.items" />
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium">Headers</label>
                                <Button type="button" variant="outline" size="sm" onClick={() => addHttpHeader(idx)}>+ Header</Button>
                              </div>
                              {tool.headers.length === 0 && (
                                <p className="text-xs text-muted-foreground">Nenhum header customizado.</p>
                              )}
                              {tool.headers.map((h, hi) => (
                                <div key={hi} className="grid grid-cols-12 gap-2 items-center">
                                  <div className="col-span-5">
                                    <Input value={h.key} onChange={e => updateHttpHeader(idx, hi, 'key', e.target.value)} placeholder="x-api-key" />
                                  </div>
                                  <div className="col-span-6">
                                    <Input value={h.value} onChange={e => updateHttpHeader(idx, hi, 'value', e.target.value)} placeholder="valor" />
                                  </div>
                                  <div className="col-span-1">
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeHttpHeader(idx, hi)}>
                                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium">Parâmetros</label>
                                <Button type="button" variant="outline" size="sm" onClick={() => addHttpParam(idx)}>+ Parâmetro</Button>
                              </div>
                              {tool.parameters.length === 0 && (
                                <p className="text-xs text-muted-foreground">Nenhum parâmetro configurado.</p>
                              )}
                              {tool.parameters.map((p, pi) => (
                                <div key={pi} className="border rounded-md p-3 space-y-2">
                                  <div className="grid grid-cols-12 gap-2 items-center">
                                    <div className="col-span-3">
                                      <Input value={p.name} onChange={e => updateHttpParam(idx, pi, 'name', e.target.value)} placeholder="nome" />
                                    </div>
                                    <div className="col-span-3">
                                      <select
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                        value={p.in}
                                        onChange={e => updateHttpParam(idx, pi, 'in', e.target.value as HttpToolParam['in'])}
                                      >
                                        <option value="query">query</option>
                                        <option value="path">path</option>
                                        <option value="body">body</option>
                                        <option value="header">header</option>
                                      </select>
                                    </div>
                                    <div className="col-span-2">
                                      <select
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                        value={p.type}
                                        onChange={e => updateHttpParam(idx, pi, 'type', e.target.value)}
                                      >
                                        <option value="string">string</option>
                                        <option value="number">number</option>
                                        <option value="boolean">boolean</option>
                                        <option value="object">object</option>
                                        <option value="array">array</option>
                                      </select>
                                    </div>
                                    <div className="col-span-2 flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={p.required}
                                        onChange={e => updateHttpParam(idx, pi, 'required', e.target.checked)}
                                      />
                                      <span className="text-xs">Obrig.</span>
                                    </div>
                                    <div className="col-span-2 text-right">
                                      <Button type="button" variant="ghost" size="sm" onClick={() => removeHttpParam(idx, pi)}>
                                        <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                                      </Button>
                                    </div>
                                  </div>
                                  <Input value={p.description} onChange={e => updateHttpParam(idx, pi, 'description', e.target.value)} placeholder="Descrição para o LLM" />
                                  <Input value={p.default || ''} onChange={e => updateHttpParam(idx, pi, 'default', e.target.value)} placeholder="Valor padrão (opcional)" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {toolSubTab === 'mcp' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium flex items-center gap-2"><Server className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Servidores MCP para este agente</h3>
                      <p className="text-xs text-muted-foreground mt-1">Selecione quais servidores este agente pode usar. Se nenhum for selecionado, todos ativos são usados.</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => navigate('/ai-mcp-servers')}>
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      Gerenciar servidores
                    </Button>
                  </div>

                  {mcpServers.length === 0 && (
                    <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                      Nenhum servidor MCP cadastrado.
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {mcpServers.map(server => {
                      const selected = selectedMcpIds.includes(server.id)
                      const discoveredCount = Array.isArray(server.discoveredTools) ? server.discoveredTools.length : 0
                      return (
                        <label key={server.id} className={`border rounded-lg p-4 cursor-pointer ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleMcpSelection(server.id)}
                                className="mt-1"
                              />
                              <div>
                                <div className="font-medium text-sm">{server.name}</div>
                                <div className="text-xs text-muted-foreground mt-1">{server.serverUrl}</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {server.transport.toUpperCase()} • {server.isActive ? 'Ativo' : 'Inativo'} • {discoveredCount} tools descobertas
                                </div>
                              </div>
                            </div>
                            <div className="text-xs px-2 py-1 rounded border">{selected ? 'Selecionado' : 'Não selecionado'}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {toolSubTab === 'subagents' && (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <Brain className="h-5 w-5 text-purple-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">Sub-agentes (Padrão A)</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Outros agentes que ESTE agente pode chamar via tool <code>call_subagent_&lt;slug&gt;</code>.
                          Cada sub-agente tem sua própria sessão isolada — útil pra delegar especialidades (calculadora de frete, agendador, RAG técnico, etc.).
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4 space-y-4">
                    <div>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.isSubAgent}
                          onChange={e => setForm(f => ({ ...f, isSubAgent: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <span className="font-medium">Marcar este agente como Sub-agente</span>
                      </label>
                      <p className="text-xs text-muted-foreground mt-1 pl-6">
                        Apenas para organização visual — qualquer agente pode ser usado como sub-agente.
                      </p>
                    </div>

                    {form.isSubAgent && (
                      <div>
                        <label className="text-sm font-medium">Descrição para o agente pai</label>
                        <p className="text-xs text-muted-foreground mb-1">
                          Texto curto explicando QUANDO o agente pai deve chamar este sub-agente. Vira a <code>description</code> da tool.
                        </p>
                        <textarea
                          value={form.subAgentDescription}
                          onChange={e => setForm(f => ({ ...f, subAgentDescription: e.target.value }))}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                          placeholder="Use quando o cliente pedir cotação de frete. Recebe origem, destino, peso e tipo de carga."
                        />
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border bg-card">
                    <div className="p-4 border-b">
                      <h4 className="font-semibold text-sm">Sub-agentes que este agente pode chamar</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Selecione abaixo. Eles aparecem como <code>call_subagent_&lt;slug&gt;</code> nas tools do agente principal.
                      </p>
                    </div>
                    <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
                      {agents.filter(a => a.id !== id).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Nenhum outro agente disponível. Crie outros agentes primeiro.
                        </p>
                      ) : (
                        agents.filter(a => a.id !== id).map(a => {
                          const selectedIds = form.subAgentIds.split(',').map(s => s.trim()).filter(Boolean)
                          const isSelected = selectedIds.includes(a.id)
                          return (
                            <label key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                              isSelected ? 'border-purple-500 bg-purple-500/5' : 'border-border hover:border-purple-500/40'
                            }`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const newIds = isSelected
                                    ? selectedIds.filter(sid => sid !== a.id)
                                    : [...selectedIds, a.id]
                                  setForm(f => ({ ...f, subAgentIds: newIds.join(', ') }))
                                }}
                                className="h-4 w-4 mt-0.5 flex-shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <Brain className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                                  <span className="font-medium text-sm">{a.name}</span>
                                  {(a as any).isSubAgent && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium">SUB-AGENT</span>
                                  )}
                                  <span className="text-xs text-muted-foreground">({a.type})</span>
                                </div>
                                {((a as any).subAgentDescription || a.description) && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {(a as any).subAgentDescription || a.description}
                                  </p>
                                )}
                              </div>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 text-xs space-y-1">
                    <p className="font-semibold text-amber-700 dark:text-amber-400">Proteções automáticas</p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      <li>Profundidade máxima: <strong>2 níveis</strong> (pai → filho → neto). Além disso, sub-agentes deixam de ser expostos.</li>
                      <li>Limite de <strong>3 sub-chamadas por turno</strong> do agente pai (anti-loop).</li>
                      <li>Timeout de <strong>30s</strong> por chamada de sub-agente.</li>
                      <li>Cada sub-agente tem <strong>sessão isolada</strong> — não vê o histórico do pai.</li>
                    </ul>
                  </div>
                </div>
              )}

              {toolSubTab === 'logs' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium flex items-center gap-2"><Activity className="h-4 w-4 text-orange-600 dark:text-orange-400" /> Logs de Tools deste Agente</h3>
                      <p className="text-xs text-muted-foreground mt-1">Sucessos, falhas, retry e payload de execução.</p>
                    </div>
                    <div className="flex gap-2">
                      {isEditing && (
                        <Button type="button" variant="outline" size="sm" onClick={refreshToolLogs}>Atualizar</Button>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={() => navigate('/ai-tool-logs')}>
                        <ExternalLink className="h-4 w-4 mr-1.5" />
                        Ver painel completo
                      </Button>
                    </div>
                  </div>

                  {!isEditing && (
                    <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                      Salve o agente para começar a registrar logs.
                    </div>
                  )}

                  {isEditing && toolLogs.length === 0 && (
                    <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                      Nenhum log registrado para este agente.
                    </div>
                  )}

                  {isEditing && toolLogs.length > 0 && (
                    <div className="space-y-2">
                      {toolLogs.map(log => (
                        <details key={log.id} className="border rounded-lg p-3">
                          <summary className="cursor-pointer list-none flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm">
                              <span className={`w-2 h-2 rounded-full ${log.status === 'success' ? 'bg-green-500' : log.status === 'retry' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                              <span className="font-medium">{log.toolName}</span>
                              <span className="text-xs text-muted-foreground">{log.toolType}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(log.createdAt).toLocaleString('pt-BR')} • {log.responseTime || log.durationMs || 0}ms • retry {log.retryCount || 0}
                            </div>
                          </summary>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="font-medium mb-1">Input</p>
                              <pre className="bg-gray-100 dark:bg-black/30 p-2 rounded overflow-auto max-h-40">{JSON.stringify(log.requestBody || log.requestParams || log.input || {}, null, 2)}</pre>
                            </div>
                            <div>
                              <p className="font-medium mb-1">Output / Erro</p>
                              <pre className="bg-gray-100 dark:bg-black/30 p-2 rounded overflow-auto max-h-40">{log.errorMessage || log.responseBody || JSON.stringify(log.output || {}, null, 2)}</pre>
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'knowledge' && (
            <>
              <p className="text-muted-foreground">
                Selecione quais bases de conhecimento este agente pode acessar. O agente <strong>só terá acesso</strong> às bases marcadas aqui.
              </p>

              {!isEditing ? (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm text-yellow-700 dark:text-yellow-400">
                  ⚠️ Salve o agente primeiro para poder vincular bases de conhecimento.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{linkedKbIds.size} base(s) vinculada(s)</span>
                      {linkedKbIds.size === 0 && (
                        <span className="text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                          Nenhuma base — agente sem conhecimento RAG
                        </span>
                      )}
                    </div>
                    {savingKb && <span className="text-xs text-muted-foreground animate-pulse">Salvando...</span>}
                  </div>

                  {/* Busca */}
                  {allKnowledgeBases.length > 5 && (
                    <input
                      type="text"
                      placeholder="Buscar base de conhecimento..."
                      value={kbSearch}
                      onChange={e => setKbSearch(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                    />
                  )}

                  {/* Lista de bases */}
                  <div className="space-y-2">
                    {allKnowledgeBases.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <BookOpen className="mx-auto mb-2 opacity-50" size={32} />
                        <p className="text-sm">Nenhuma base de conhecimento criada.</p>
                        <p className="text-xs mt-1">Crie uma base em "Base Conhecimento" no menu lateral.</p>
                      </div>
                    ) : (
                      allKnowledgeBases
                        .filter(kb => !kbSearch || kb.name.toLowerCase().includes(kbSearch.toLowerCase()) || (kb.description || '').toLowerCase().includes(kbSearch.toLowerCase()))
                        .map(kb => {
                          const isLinked = linkedKbIds.has(kb.id)
                          return (
                            <div
                              key={kb.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                                isLinked
                                  ? 'border-emerald-500/50 bg-emerald-500/5'
                                  : 'border-border hover:border-border/80 bg-card/50 hover:bg-card/80'
                              }`}
                              onClick={async () => {
                                if (!id) return
                                setSavingKb(true)
                                try {
                                  if (isLinked) {
                                    await api.delete(`/ai/agents/${id}/knowledge/${kb.id}`)
                                    setLinkedKbIds(prev => {
                                      const next = new Set(prev)
                                      next.delete(kb.id)
                                      return next
                                    })
                                    toast.success(`"${kb.name}" desvinculada`)
                                  } else {
                                    await api.post(`/ai/agents/${id}/knowledge/${kb.id}`)
                                    setLinkedKbIds(prev => new Set(prev).add(kb.id))
                                    toast.success(`"${kb.name}" vinculada`)
                                  }
                                } catch (e: any) {
                                  toast.error(e.response?.data?.error || 'Erro ao atualizar vínculo')
                                }
                                setSavingKb(false)
                              }}
                            >
                              {/* Toggle visual */}
                              <div className={`w-10 h-6 rounded-full flex items-center transition-all flex-shrink-0 ${
                                isLinked ? 'bg-emerald-500 justify-end' : 'bg-zinc-600 justify-start'
                              }`}>
                                <div className="w-4 h-4 rounded-full bg-white mx-1 transition-all" />
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-medium ${isLinked ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{kb.name}</span>
                                  {!kb.isActive && (
                                    <span className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">Inativa</span>
                                  )}
                                </div>
                                {kb.description && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">{kb.description}</p>
                                )}
                              </div>

                              {/* Stats */}
                              <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                                <div>{(kb as any).totalChunks || (kb as any)._count?.sources || 0} chunks</div>
                                <div>{(kb as any).embeddingModel || 'text-embedding-3-small'}</div>
                              </div>
                            </div>
                          )
                        })
                    )}
                  </div>

                  {/* Explicação */}
                  <div className="bg-card/50 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                    <p><strong>Como funciona:</strong></p>
                    <p>• O agente só consulta as bases <strong>vinculadas e ativas</strong> ao responder perguntas</p>
                    <p>• Bases <strong>inativas</strong> (vermelhas) não são consultadas mesmo se vinculadas</p>
                    <p>• Se nenhuma base for vinculada, o agente responde apenas com o prompt e contexto do CRM</p>
                    <p>• Múltiplos agentes podem compartilhar a mesma base de conhecimento</p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'context' && (
            <>
              <p className="text-muted-foreground">Configure quais informações do CRM o agente pode acessar como contexto para suas respostas.</p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="crmCtx" checked={form.useCrmContext} onChange={e => setForm(f => ({ ...f, useCrmContext: e.target.checked }))} />
                  <div>
                    <label htmlFor="crmCtx" className="text-sm font-medium">Usar dados do CRM como contexto</label>
                    <p className="text-xs text-muted-foreground">Informações do contato e conversa são incluídas no prompt</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-6">
                  <input type="checkbox" id="contactCtx" checked={form.useContactInfo} onChange={e => setForm(f => ({ ...f, useContactInfo: e.target.checked }))} disabled={!form.useCrmContext} />
                  <div>
                    <label htmlFor="contactCtx" className="text-sm font-medium">Incluir informações do contato</label>
                    <p className="text-xs text-muted-foreground">Nome, telefone, email, tags do contato</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-6">
                  <input type="checkbox" id="historyCtx" checked={form.useConversationHistory} onChange={e => setForm(f => ({ ...f, useConversationHistory: e.target.checked }))} disabled={!form.useCrmContext} />
                  <div>
                    <label htmlFor="historyCtx" className="text-sm font-medium">Incluir histórico da conversa</label>
                    <p className="text-xs text-muted-foreground">Mensagens anteriores ao início da sessão de IA</p>
                  </div>
                </div>
                {form.useConversationHistory && form.useCrmContext && (
                  <div className="ml-12 flex gap-6">
                    <div>
                      <label className="text-sm font-medium">Mensagens pré-sessão</label>
                      <p className="text-xs text-muted-foreground mb-1">Quantas mensagens antes da sessão abrir a IA pode ver</p>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={(form as any).contextMessagesLimit ?? 10}
                        onChange={e => setForm(f => ({ ...f, contextMessagesLimit: parseInt(e.target.value) || 0 }))}
                        className="w-24 px-3 py-2 rounded-lg bg-background border border-border text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Mensagens da sessão</label>
                      <p className="text-xs text-muted-foreground mb-1">Máximo de mensagens da sessão enviadas ao LLM</p>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={(form as any).sessionMessagesLimit ?? 50}
                        onChange={e => setForm(f => ({ ...f, sessionMessagesLimit: parseInt(e.target.value) || 50 }))}
                        className="w-24 px-3 py-2 rounded-lg bg-background border border-border text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── ABA ESTADO (State Tracker / Parameter Extractor) ── */}
          {activeTab === 'state' && (
            <>
              <div className="space-y-4">
                {/* ── Camada 1: Modo de Resposta ── */}
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-base font-semibold">Modo de Resposta</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Sobrescreve <code>temperature</code> e <code>top_p</code> para deixar o agente mais previsível em fluxos de qualificação.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {([
                      { value: 'precise', label: 'Preciso (Modo Fluxo)', desc: 'temp 0.2 / top_p 0.5 — ideal pra qualificação, segue scripts' },
                      { value: 'balanced', label: 'Equilibrado', desc: 'usa as configs do provider — bom default geral' },
                      { value: 'creative', label: 'Criativo', desc: 'temp 0.9 / top_p 1 — copywriting, ideias' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, responseMode: opt.value }))}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          form.responseMode === opt.value
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-border hover:border-purple-500/40'
                        }`}
                      >
                        <div className="font-semibold text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Camada 1: Tool Forcing ── */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold">Forçar uso de Tools por palavra-chave</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Se a mensagem do cliente contém alguma palavra abaixo, o agente é <strong>obrigado</strong> a chamar uma tool no primeiro turno (anti-alucinação).
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={form.toolForcingEnabled}
                        onChange={e => setForm(f => ({ ...f, toolForcingEnabled: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      <span>Ativar</span>
                    </label>
                  </div>
                  {form.toolForcingEnabled && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Palavras-chave (separadas por vírgula)</label>
                      <Input
                        value={form.toolForcingKeywords}
                        onChange={e => setForm(f => ({ ...f, toolForcingKeywords: e.target.value }))}
                        placeholder="cotação, frete, valor, preço, orçamento"
                      />
                    </div>
                  )}
                </div>

                {/* ── State Tracker ── */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold flex items-center gap-2">
                        <Variable className="h-4 w-4 text-purple-500" />
                        Estado da Conversa
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Um modelo barato (extrator) lê cada mensagem e atualiza variáveis declaradas (ex.: <code>peso_carga</code>, <code>tipo_atividade</code>, <code>cidade_origem</code>).
                        O agente principal recebe essas variáveis no prompt como <code>&lt;conversation_state&gt;</code> e para de "esquecer" o que o cliente já disse.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={stateSchema.enabled}
                        onChange={e => setStateSchema(s => ({ ...s, enabled: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      <span>Ativar</span>
                    </label>
                  </div>
                </div>

                {stateSchema.enabled && (
                  <>
                    <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium">Provider do extrator</label>
                        <p className="text-xs text-muted-foreground mb-1">Use um provider barato (ex.: gpt-4o-mini)</p>
                        <select
                          value={stateSchema.extractorProviderId || ''}
                          onChange={e => setStateSchema(s => ({ ...s, extractorProviderId: e.target.value || undefined }))}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                        >
                          <option value="">— Mesmo do agente —</option>
                          {providers.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Modelo do extrator</label>
                        <p className="text-xs text-muted-foreground mb-1">Ex.: gpt-4o-mini, gpt-4.1-mini</p>
                        <Input
                          value={stateSchema.extractorModel || ''}
                          onChange={e => setStateSchema(s => ({ ...s, extractorModel: e.target.value }))}
                          placeholder="gpt-4o-mini"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Mensagens recentes</label>
                        <p className="text-xs text-muted-foreground mb-1">Quantas msgs analisar por turno</p>
                        <input
                          type="number"
                          min={2}
                          max={30}
                          value={stateSchema.recentMessages ?? 8}
                          onChange={e => setStateSchema(s => ({ ...s, recentMessages: parseInt(e.target.value) || 8 }))}
                          className="w-24 px-3 py-2 rounded-lg bg-background border border-border text-sm"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border bg-card">
                      <div className="flex items-center justify-between p-4 border-b">
                        <div>
                          <h4 className="font-semibold text-sm">Variáveis rastreadas</h4>
                          <p className="text-xs text-muted-foreground">Defina o que o extrator deve identificar e persistir.</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setStateSchema(s => ({
                            ...s,
                            variables: [...s.variables, { name: '', type: 'string', description: '' }],
                          }))}
                        >
                          <Plus className="h-4 w-4 mr-1" /> Adicionar variável
                        </Button>
                      </div>

                      {stateSchema.variables.length === 0 ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">
                          Nenhuma variável definida. Clique em <strong>Adicionar variável</strong> para começar.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {stateSchema.variables.map((v, idx) => (
                            <div key={idx} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                              <div className="md:col-span-3">
                                <label className="text-xs font-medium text-muted-foreground">Nome (snake_case)</label>
                                <Input
                                  value={v.name}
                                  onChange={e => setStateSchema(s => ({
                                    ...s,
                                    variables: s.variables.map((x, i) => i === idx ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() } : x),
                                  }))}
                                  placeholder="peso_carga"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                                <select
                                  value={v.type}
                                  onChange={e => setStateSchema(s => ({
                                    ...s,
                                    variables: s.variables.map((x, i) => i === idx ? { ...x, type: e.target.value as StateVarType } : x),
                                  }))}
                                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                                >
                                  <option value="string">string</option>
                                  <option value="number">number</option>
                                  <option value="boolean">boolean</option>
                                  <option value="enum">enum</option>
                                </select>
                              </div>
                              <div className="md:col-span-4">
                                <label className="text-xs font-medium text-muted-foreground">Descrição (instrui o extrator)</label>
                                <Input
                                  value={v.description || ''}
                                  onChange={e => setStateSchema(s => ({
                                    ...s,
                                    variables: s.variables.map((x, i) => i === idx ? { ...x, description: e.target.value } : x),
                                  }))}
                                  placeholder="Ex.: Peso da carga em toneladas"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-xs font-medium text-muted-foreground">Exemplo</label>
                                <Input
                                  value={v.example || ''}
                                  onChange={e => setStateSchema(s => ({
                                    ...s,
                                    variables: s.variables.map((x, i) => i === idx ? { ...x, example: e.target.value } : x),
                                  }))}
                                  placeholder={v.type === 'number' ? '12.5' : v.type === 'boolean' ? 'true' : 'guincho'}
                                />
                              </div>
                              <div className="md:col-span-1 flex md:justify-end pt-5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setStateSchema(s => ({
                                    ...s,
                                    variables: s.variables.filter((_, i) => i !== idx),
                                  }))}
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                              {v.type === 'enum' && (
                                <div className="md:col-span-12">
                                  <label className="text-xs font-medium text-muted-foreground">Valores permitidos (separados por vírgula)</label>
                                  <Input
                                    value={(v.values || []).join(', ')}
                                    onChange={e => setStateSchema(s => ({
                                      ...s,
                                      variables: s.variables.map((x, i) => i === idx ? { ...x, values: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } : x),
                                    }))}
                                    placeholder="guincho, prancha, munck, cegonha"
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 text-xs space-y-1">
                      <p className="font-semibold text-amber-700 dark:text-amber-400">Como funciona</p>
                      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                        <li>A cada mensagem do usuário, o extrator é chamado <strong>antes</strong> do agente principal.</li>
                        <li>Ele lê as últimas N mensagens e devolve apenas as variáveis que <strong>mudaram</strong> nesta mensagem.</li>
                        <li>O agente principal recebe o estado completo no system prompt e responde sem precisar reler todo o histórico.</li>
                        <li>O estado fica salvo em <code>AISession.variables</code> e persiste durante toda a sessão.</li>
                      </ul>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── ABA MEMÓRIA & APRENDIZADO ── */}
          {activeTab === 'memory' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Brain className="h-5 w-5 text-purple-500" />
                  Memória & Aprendizado
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Identidade persistente do agente: o que ele lembra entre conversas, lições aprendidas e artefatos produzidos.
                </p>
              </div>

              {/* Memória Persistente */}
              <div className="border rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">Memória de longo prazo</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Habilita as ferramentas <code>save_memory</code>, <code>list_memories</code>, <code>delete_memory</code> e <code>recall_memory</code>.
                      O agente lembra fatos relevantes do contato entre sessões.
                    </p>
                  </div>
                  <label className="inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={form.memoryEnabled}
                      onChange={e => setForm({ ...form, memoryEnabled: e.target.checked })} />
                    <div className="w-11 h-6 bg-gray-300 dark:bg-gray-700 rounded-full peer peer-checked:bg-purple-500 transition relative">
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition ${form.memoryEnabled ? 'left-5' : 'left-0.5'}`} />
                    </div>
                  </label>
                </div>
              </div>

              {/* Aprendizado Procedural */}
              <div className="border rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">Aprendizado procedural (lições)</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      O agente registra lições do tipo <em>"quando X, faça Y"</em> e elas são injetadas automaticamente no system prompt.
                      Ferramentas: <code>record_learning</code>, <code>list_learnings</code>, <code>forget_learning</code>.
                    </p>
                  </div>
                  <label className="inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={form.learningEnabled}
                      onChange={e => setForm({ ...form, learningEnabled: e.target.checked })} />
                    <div className="w-11 h-6 bg-gray-300 dark:bg-gray-700 rounded-full peer peer-checked:bg-purple-500 transition relative">
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition ${form.learningEnabled ? 'left-5' : 'left-0.5'}`} />
                    </div>
                  </label>
                </div>
                {form.learningEnabled && (
                  <div className="pt-3 border-t space-y-3">
                    <label className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium">Auto-aprendizado</div>
                        <div className="text-xs text-muted-foreground">Permite o agente registrar lições durante a conversa sem aprovação humana.</div>
                      </div>
                      <input type="checkbox" className="h-4 w-4" checked={form.learningAllowSelfLearning}
                        onChange={e => setForm({ ...form, learningAllowSelfLearning: e.target.checked })} />
                    </label>
                    {isEditing && (
                      <a href="/ai-learnings" target="_blank" rel="noopener" className="text-xs text-purple-500 hover:underline inline-flex items-center gap-1">
                        Ver lições deste agente →
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Artefatos */}
              <div className="border rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">Artefatos versionados</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Permite o agente salvar saídas estruturadas (markdown, código, JSON, tabelas) com versionamento.
                      Ferramentas: <code>save_artifact</code>, <code>update_artifact</code>, <code>list_artifacts</code>, <code>get_artifact</code>.
                    </p>
                  </div>
                  <label className="inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={form.artifactsEnabled}
                      onChange={e => setForm({ ...form, artifactsEnabled: e.target.checked })} />
                    <div className="w-11 h-6 bg-gray-300 dark:bg-gray-700 rounded-full peer peer-checked:bg-purple-500 transition relative">
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition ${form.artifactsEnabled ? 'left-5' : 'left-0.5'}`} />
                    </div>
                  </label>
                </div>
                {form.artifactsEnabled && (
                  <div className="pt-3 border-t space-y-3">
                    <label className="block">
                      <div className="text-sm font-medium mb-1">Máximo de artefatos por conversa</div>
                      <Input type="number" min={1} max={500} value={form.artifactsMaxPerConv}
                        onChange={e => setForm({ ...form, artifactsMaxPerConv: Number(e.target.value) || 20 })}
                        className="max-w-[150px]" />
                    </label>
                    {isEditing && (
                      <a href="/ai-artifacts" target="_blank" rel="noopener" className="text-xs text-purple-500 hover:underline inline-flex items-center gap-1">
                        Ver artefatos deste agente →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ABA TESTAR ── */}
          {activeTab === 'test' && isEditing && (
            <div className="flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
              {/* Header com seletores */}
              <div className="pb-4 border-b mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-purple-500" />
                      Testar Agente
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Converse diretamente com o agente para testar prompt, tools e base de conhecimento.
                    </p>
                  </div>
                  {testMessages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTestMessages([])}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Limpar chat
                    </button>
                  )}
                </div>
                {/* Seletores de Provider/Modelo */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Provedor:</span>
                    <select
                      value={testProviderId}
                      onChange={e => { setTestProviderId(e.target.value); setTestModel('') }}
                      className="text-sm px-2 py-1 rounded-md bg-background border border-border"
                    >
                      <option value="">Padrão do agente</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Modelo:</span>
                    <select
                      value={testModel}
                      onChange={e => setTestModel(e.target.value)}
                      className="text-sm px-2 py-1 rounded-md bg-background border border-border"
                    >
                      <option value="">Padrão do agente</option>
                      {(() => {
                        const p = testProviderId ? providers.find(p => p.id === testProviderId) : providers.find(p => p.id === form.providerId)
                        return (p?.enabledModels || []).map((m: string) => (
                          <option key={m} value={m}>{m}</option>
                        ))
                      })()}
                    </select>
                  </div>
                  {linkedKbIds.size > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400">
                      📚 {linkedKbIds.size} base(s)
                    </span>
                  )}
                </div>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto space-y-4 pb-4">
                {testMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mb-3 opacity-30" />
                    <p className="font-medium">Testar {form.name || 'Agente'}</p>
                    <p className="text-sm mt-1 max-w-md text-center">
                      Envie uma mensagem para testar o agente com todas as suas configurações:
                      prompt, tools, bases de conhecimento e contexto.
                    </p>
                    {linkedKbIds.size > 0 && (
                      <p className="text-xs mt-3 px-3 py-1.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400">
                        📚 {linkedKbIds.size} base(s) de conhecimento vinculada(s)
                      </p>
                    )}
                  </div>
                )}

                {testMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-1' : ''}`}>
                      <div className={`rounded-2xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-muted rounded-bl-md'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.role === 'assistant' && msg.model && (
                        <div className="flex items-center gap-3 mt-1.5 px-1">
                          <span className="text-[10px] text-muted-foreground">
                            {msg.model} via {msg.providerName}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {msg.tokensUsed} tokens
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            $ {msg.costUsd?.toFixed(4)}
                          </span>
                          {msg.latencyMs && (
                            <span className="text-[10px] text-muted-foreground">
                              {(msg.latencyMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {testLoading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="pt-4 border-t">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && !e.shiftKey && testInput.trim() && !testLoading) {
                        e.preventDefault()
                        const msg = testInput.trim()
                        setTestInput('')
                        setTestMessages(prev => [...prev, { role: 'user', content: msg }])
                        setTestLoading(true)
                        try {
                          const history = testMessages.map(m => ({ role: m.role, content: m.content }))
                          const result = await testAgentChat(id!, { message: msg, history, providerId: testProviderId || undefined, model: testModel || undefined })
                          setTestMessages(prev => [...prev, {
                            role: 'assistant',
                            content: result.reply,
                            model: result.model,
                            providerName: result.providerName,
                            tokensUsed: result.tokensUsed,
                            costUsd: result.costUsd,
                            latencyMs: result.latencyMs,
                          }])
                        } catch (err: any) {
                          setTestMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `❌ Erro: ${err?.response?.data?.error || err.message || 'Falha ao processar'}`,
                          }])
                        } finally {
                          setTestLoading(false)
                        }
                      }
                    }}
                    placeholder="Digite uma mensagem para testar o agente..."
                    className="flex-1 px-4 py-3 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    disabled={testLoading}
                  />
                  <button
                    type="button"
                    disabled={!testInput.trim() || testLoading}
                    onClick={async () => {
                      if (!testInput.trim() || testLoading) return
                      const msg = testInput.trim()
                      setTestInput('')
                      setTestMessages(prev => [...prev, { role: 'user', content: msg }])
                      setTestLoading(true)
                      try {
                        const history = testMessages.map(m => ({ role: m.role, content: m.content }))
                        const result = await testAgentChat(id!, { message: msg, history, providerId: testProviderId || undefined, model: testModel || undefined })
                        setTestMessages(prev => [...prev, {
                          role: 'assistant',
                          content: result.reply,
                          model: result.model,
                          providerName: result.providerName,
                          tokensUsed: result.tokensUsed,
                          costUsd: result.costUsd,
                          latencyMs: result.latencyMs,
                        }])
                      } catch (err: any) {
                        setTestMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `❌ Erro: ${err?.response?.data?.error || err.message || 'Falha ao processar'}`,
                        }])
                      } finally {
                        setTestLoading(false)
                      }
                    }}
                    className="px-4 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        </div>
      </div>
    </form>
  )
}
