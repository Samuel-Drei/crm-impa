import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Key, Plus, Trash2, Edit2, X, CheckCircle, XCircle, TestTube2, Star, Loader2, RefreshCw, Check, Eye, ChevronDown, Search, Zap, Brain, ImageIcon, Code, Sparkles, Filter, Globe, Mic, ExternalLink, Settings2, Power, PowerOff, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/Toast'
import {
  getAIProviders, createAIProvider, updateAIProvider, deleteAIProvider, testAIProvider,
  type AIProvider, type AIProviderType
} from '@/services/ai.service'
import api from '@/services/api'
import { ProviderLogo } from '@/components/ProviderLogo'

// ══════════════════════════════════════════
// Provider Registry (espelha o backend)
// ══════════════════════════════════════════

interface ProviderInfo {
  type: AIProviderType
  name: string
  icon: string
  color: string
  bgColor: string
  borderColor: string
  description: string
  capabilities: string[]
  defaultBaseUrl: string
  website?: string
  isOAuth?: boolean
}

const PROVIDER_REGISTRY: Record<string, ProviderInfo> = {
  OPENAI: {
    type: 'OPENAI', name: 'OpenAI', icon: '🟢', color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30',
    description: 'GPT-4o, o3, DALL-E, Whisper, TTS',
    capabilities: ['💬', '👁️', '🧠', '🎙️', '🔊', '🎨', '🔧', '💻'],
    defaultBaseUrl: 'https://api.openai.com/v1', website: 'https://platform.openai.com',
  },
  GEMINI: {
    type: 'GEMINI', name: 'Google Gemini', icon: '🔵', color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30',
    description: 'Gemini 2.5 Pro/Flash, contexto até 2M tokens',
    capabilities: ['💬', '👁️', '🧠', '🎧', '🎬', '🔧', '💻', '📚'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', website: 'https://aistudio.google.com',
  },
  CLAUDE: {
    type: 'CLAUDE', name: 'Anthropic Claude', icon: '🟠', color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30',
    description: 'Claude 4.5 Sonnet/Haiku/Opus',
    capabilities: ['💬', '👁️', '🔧', '💻', '📚'],
    defaultBaseUrl: 'https://api.anthropic.com/v1', website: 'https://console.anthropic.com',
  },
  DEEPSEEK: {
    type: 'DEEPSEEK', name: 'DeepSeek', icon: '🔷', color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-600/10', borderColor: 'border-blue-600/30',
    description: 'DeepSeek V3, R1 Reasoning — ultra baixo custo',
    capabilities: ['💬', '💻', '🔧', '📚'],
    defaultBaseUrl: 'https://api.deepseek.com/v1', website: 'https://platform.deepseek.com',
  },
  GROQ: {
    type: 'GROQ', name: 'Groq', icon: '⚡', color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30',
    description: 'Inferência ultra-rápida — Llama 3, Mixtral, Gemma',
    capabilities: ['💬', '👁️', '🔧', '💻'],
    defaultBaseUrl: 'https://api.groq.com/openai/v1', website: 'https://console.groq.com',
  },
  OPENROUTER: {
    type: 'OPENROUTER', name: 'OpenRouter', icon: '🌐', color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/30',
    description: 'Roteador universal — 200+ modelos',
    capabilities: ['💬', '👁️', '🔧', '💻', '📚'],
    defaultBaseUrl: 'https://openrouter.ai/api/v1', website: 'https://openrouter.ai',
  },
  PERPLEXITY: {
    type: 'PERPLEXITY', name: 'Perplexity', icon: '🔍', color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-500/10', borderColor: 'border-teal-500/30',
    description: 'Busca em tempo real + IA — Sonar Pro',
    capabilities: ['💬', '🔍', '🔧'],
    defaultBaseUrl: 'https://api.perplexity.ai', website: 'https://docs.perplexity.ai',
  },
  MISTRAL: {
    type: 'MISTRAL', name: 'Mistral AI', icon: '🌪️', color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-600/10', borderColor: 'border-orange-600/30',
    description: 'Mistral Large, Codestral, Pixtral',
    capabilities: ['💬', '👁️', '🧠', '🔧', '💻'],
    defaultBaseUrl: 'https://api.mistral.ai/v1', website: 'https://console.mistral.ai',
  },
  COHERE: {
    type: 'COHERE', name: 'Cohere', icon: '🧬', color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-600/10', borderColor: 'border-emerald-600/30',
    description: 'Command R+, embeddings multilíngue, RAG',
    capabilities: ['💬', '🧠', '🔧', '🔍'],
    defaultBaseUrl: 'https://api.cohere.com/v2', website: 'https://dashboard.cohere.com',
  },
  XAI: {
    type: 'XAI', name: 'xAI (Grok)', icon: '🤖', color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-500/10', borderColor: 'border-sky-500/30',
    description: 'Grok 2 — modelo da xAI',
    capabilities: ['💬', '👁️', '🔧', '💻'],
    defaultBaseUrl: 'https://api.x.ai/v1', website: 'https://console.x.ai',
  },
  TOGETHER: {
    type: 'TOGETHER', name: 'Together AI', icon: '🤝', color: 'text-cyan-600 dark:text-cyan-400',
    bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/30',
    description: 'Llama, Mixtral, SDXL — open source cloud',
    capabilities: ['💬', '👁️', '🧠', '🔧', '💻', '🎨'],
    defaultBaseUrl: 'https://api.together.xyz/v1', website: 'https://api.together.xyz',
  },
  FIREWORKS: {
    type: 'FIREWORKS', name: 'Fireworks AI', icon: '🎆', color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-600/10', borderColor: 'border-red-600/30',
    description: 'Inferência rápida — Llama, Mixtral, FireFunction',
    capabilities: ['💬', '👁️', '🧠', '🔧', '💻'],
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', website: 'https://fireworks.ai',
  },
  CEREBRAS: {
    type: 'CEREBRAS', name: 'Cerebras', icon: '🧠', color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-500/10', borderColor: 'border-violet-500/30',
    description: 'Inferência mais rápida do mundo — Llama 3.1',
    capabilities: ['💬', '💻', '🔧'],
    defaultBaseUrl: 'https://api.cerebras.ai/v1', website: 'https://cloud.cerebras.ai',
  },
  OPENAI_COMPATIBLE: {
    type: 'OPENAI_COMPATIBLE', name: 'OpenAI Compatible', icon: '🔌', color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/30',
    description: 'Qualquer endpoint OpenAI-compatible (Ollama, LM Studio, vLLM)',
    capabilities: ['💬', '🔧'],
    defaultBaseUrl: '', website: '',
  },
  GITHUB_MODELS: {
    type: 'GITHUB_MODELS', name: 'GitHub Models', icon: '🐙', color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-600/10', borderColor: 'border-gray-600/30',
    description: 'GPT-4o, Llama, Mistral, Phi via GitHub — grátis para devs',
    capabilities: ['💬', '👁️', '🔧', '💻', '🧠'],
    defaultBaseUrl: 'https://models.inference.ai.azure.com', website: 'https://github.com/marketplace/models',
  },
  GITHUB_COPILOT: {
    type: 'GITHUB_COPILOT', name: 'GitHub Copilot', icon: '🤖', color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-700/10', borderColor: 'border-gray-700/30',
    description: 'GPT-4o, Claude, Gemini via Copilot — OAuth ou token importado',
    capabilities: ['💬', '👁️', '💻', '🔧', '🧠'],
    defaultBaseUrl: 'https://api.githubcopilot.com', website: 'https://github.com/features/copilot',
    isOAuth: true,
  },
  ANTIGRAVITY: {
    type: 'ANTIGRAVITY', name: 'Antigravity', icon: '🚀', color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30',
    description: 'Google Antigravity — OAuth Google ou token importado',
    capabilities: ['💬', '👁️', '💻', '🧠', '📚'],
    defaultBaseUrl: 'https://cloudcode-pa.googleapis.com/v1internal', website: 'https://idx.google.com',
    isOAuth: true,
  },
}

const ALL_PROVIDER_TYPES = Object.keys(PROVIDER_REGISTRY) as AIProviderType[]

function getProviderInfo(type: string): ProviderInfo {
  return PROVIDER_REGISTRY[type] || PROVIDER_REGISTRY.OPENAI_COMPATIBLE
}

// ── Modelos padrão por tipo (fallback quando API não retorna) ──
const defaultModels: Record<string, Array<{id: string, name: string}>> = {
  OPENAI:   [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }, { id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' }, { id: 'gpt-4.1', name: 'GPT-4.1' }, { id: 'o3-mini', name: 'o3 Mini' }],
  GEMINI:   [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }, { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }, { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }, { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
  CLAUDE:   [{ id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' }, { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' }, { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' }],
  DEEPSEEK: [{ id: 'deepseek-chat', name: 'DeepSeek V3' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1' }, { id: 'deepseek-coder', name: 'DeepSeek Coder' }],
  GROQ:     [{ id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' }, { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B' }, { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' }],
  OPENROUTER: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }, { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' }, { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (free)' }],
  PERPLEXITY: [{ id: 'sonar-pro', name: 'Sonar Pro' }, { id: 'sonar', name: 'Sonar' }, { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' }],
  MISTRAL:  [{ id: 'mistral-large-latest', name: 'Mistral Large' }, { id: 'mistral-small-latest', name: 'Mistral Small' }, { id: 'codestral-latest', name: 'Codestral' }],
  COHERE:   [{ id: 'command-r-plus', name: 'Command R+' }, { id: 'command-r', name: 'Command R' }],
  XAI:      [{ id: 'grok-2', name: 'Grok 2' }, { id: 'grok-2-mini', name: 'Grok 2 Mini' }],
  TOGETHER: [{ id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', name: 'Llama 3.1 70B Turbo' }, { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo' }],
  FIREWORKS: [{ id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', name: 'Llama 3.1 70B' }],
  CEREBRAS: [{ id: 'llama3.1-70b', name: 'Llama 3.1 70B' }, { id: 'llama3.1-8b', name: 'Llama 3.1 8B' }],
  GITHUB_MODELS: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }, { id: 'gpt-4o', name: 'GPT-4o' }, { id: 'Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B' }, { id: 'Mistral-large-2407', name: 'Mistral Large' }, { id: 'Phi-3.5-mini-instruct', name: 'Phi 3.5 Mini' }],
  GITHUB_COPILOT: [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }, { id: 'gpt-4.1', name: 'GPT-4.1' }, { id: 'o4-mini', name: 'o4 Mini' }, { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }, { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
  ANTIGRAVITY: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }, { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }, { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }],
  OPENAI_COMPATIBLE: [],
}

// ══════════════════════════════════════════
// Componente Principal
// ══════════════════════════════════════════

export function AIProviders() {
  const toast = useToast()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [loading, setLoading] = useState(true)

  // Form de criar/editar provedor (inline, sem modal para create)
  const [showForm, setShowForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null)

  // Teste de conexão
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latency?: number }>>({})

  // Gerenciador de modelos (panel lateral/modal)
  const [managingModels, setManagingModels] = useState<string | null>(null)
  const [apiModels, setApiModels] = useState<Array<{id: string, name: string, enabled: boolean}>>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingModels, setSavingModels] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false)
  const [modelCategoryFilter, setModelCategoryFilter] = useState<string>('all')

  // Form state
  const [form, setForm] = useState({
    name: '', type: 'OPENAI' as AIProviderType, apiKey: '', baseUrl: '',
    maxTokens: 4096, temperature: 0.7,
    topP: '' as string | number,
    frequencyPenalty: '' as string | number,
    presencePenalty: '' as string | number,
    isDefault: false,
  })

  // OAuth state (GitHub Copilot Device Code + Antigravity Google OAuth)
  const [oauthTab, setOauthTab] = useState<'oauth' | 'token'>('oauth')
  const [importToken, setImportToken] = useState('')
  // GitHub Copilot Device Code flow
  const [deviceCode, setDeviceCode] = useState<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number } | null>(null)
  const [copilotPolling, setCopilotPolling] = useState(false)
  const [copilotResult, setCopilotResult] = useState<{ accessToken: string; copilotToken: string; copilotEndpoint: string; copilotExpiresAt: string; user: { login: string; name: string } } | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAbortRef = useRef<boolean>(false)
  // Antigravity Google OAuth
  const [antigravityResult, setAntigravityResult] = useState<{ accessToken: string; refreshToken: string; expiresIn: number; user: { email: string; name: string }; projectId: string } | null>(null)

  const isOAuthType = useCallback((type: string) => !!PROVIDER_REGISTRY[type]?.isOAuth, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollAbortRef.current = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // ── GitHub Copilot: start Device Code flow ──
  async function startCopilotDeviceCode() {
    try {
      const res = await api.post('/ai/oauth/github-copilot/device-code')
      setDeviceCode(res.data)
      setCopilotPolling(true)
      setCopilotResult(null)
      pollAbortRef.current = false
      // Backend faz long-poll de ~25s. Encadeia chamadas em sequência.
      const tick = async () => {
        if (pollAbortRef.current) return
        try {
          const pollRes = await api.post('/ai/oauth/github-copilot/poll', { device_code: res.data.device_code })
          if (pollAbortRef.current) return
          if (pollRes.data.status === 'success') {
            pollAbortRef.current = true
            setCopilotPolling(false)
            setCopilotResult(pollRes.data)
            return
          }
          if (pollRes.data.status === 'expired' || pollRes.data.status === 'error') {
            pollAbortRef.current = true
            setCopilotPolling(false)
            toast.error(pollRes.data.error || 'Autenticação expirou ou falhou. Tente novamente.')
            return
          }
          // pending → repete imediatamente (long-poll já segurou no servidor)
          pollTimerRef.current = setTimeout(tick, 500)
        } catch (err: any) {
          if (pollAbortRef.current) return
          const status = err?.response?.status
          const transient = !status || status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || status >= 500
          if (transient) {
            // erro temporário: tenta de novo em 3s
            pollTimerRef.current = setTimeout(tick, 3000)
          } else {
            pollAbortRef.current = true
            setCopilotPolling(false)
            toast.error(err?.response?.data?.error || 'Falha no polling de autenticação')
          }
        }
      }
      tick()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao iniciar autenticação GitHub')
    }
  }

  // ── Antigravity: start Google OAuth redirect ──
  async function startAntigravityOAuth() {
    try {
      const redirectUri = `${window.location.origin}/ai/oauth/antigravity/callback`
      const res = await api.post('/ai/oauth/antigravity/authorize', { redirectUri })
      // Salva state para enviar no callback
      sessionStorage.setItem('antigravity_oauth_state', res.data.state)
      window.open(res.data.authorizeUrl, '_blank', 'width=600,height=700')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao iniciar autenticação Google')
    }
  }

  // Listen for Antigravity OAuth callback message from popup
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return // Same-origin check
      if (event.data?.type === 'antigravity_oauth_callback' && event.data.code) {
        const state = sessionStorage.getItem('antigravity_oauth_state') || ''
        sessionStorage.removeItem('antigravity_oauth_state')
        api.post('/ai/oauth/antigravity/callback', { code: event.data.code, state })
          .then(res => { setAntigravityResult(res.data); toast.success('Autenticação Google concluída!') })
          .catch(e => toast.error(e.response?.data?.error || 'Falha na autenticação'))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  function resetOAuthState() {
    setOauthTab('oauth')
    setImportToken('')
    setDeviceCode(null)
    setCopilotPolling(false)
    setCopilotResult(null)
    setAntigravityResult(null)
    pollAbortRef.current = true
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
  }

  useEffect(() => { loadProviders() }, [])

  async function loadProviders() {
    setLoading(true)
    try { setProviders(await getAIProviders()) } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const info = getProviderInfo(form.type)
      const data: any = { ...form, baseUrl: form.baseUrl || info.defaultBaseUrl || undefined }
      // Coerce sampling params to number|null (string vazia = remover)
      const coerce = (v: any) => v === '' || v === null || v === undefined ? null : Number(v)
      data.topP = coerce(form.topP)
      data.frequencyPenalty = coerce(form.frequencyPenalty)
      data.presencePenalty = coerce(form.presencePenalty)

      // Handle OAuth providers — permite reconexão (oauth/import) também em edição
      if (info.isOAuth) {
        if (oauthTab === 'token' && importToken) {
          // Import token mode
          data.apiKey = importToken
          data.authType = 'token_import'
        } else if (form.type === 'GITHUB_COPILOT' && copilotResult) {
          // OAuth Device Code completed (criação ou reconexão)
          data.apiKey = copilotResult.copilotToken
          data.authType = 'oauth'
          data.oauthData = {
            githubAccessToken: copilotResult.accessToken,
            copilotToken: copilotResult.copilotToken,
            copilotEndpoint: copilotResult.copilotEndpoint,
            user: copilotResult.user,
          }
          data.tokenExpiresAt = copilotResult.copilotExpiresAt
        } else if (form.type === 'ANTIGRAVITY' && antigravityResult) {
          // Google OAuth completed
          data.apiKey = antigravityResult.accessToken
          data.authType = 'oauth'
          data.refreshToken = antigravityResult.refreshToken
          data.oauthData = {
            googleAccessToken: antigravityResult.accessToken,
            user: antigravityResult.user,
            projectId: antigravityResult.projectId,
          }
          data.tokenExpiresAt = new Date(Date.now() + antigravityResult.expiresIn * 1000).toISOString()
        } else if (!editingProvider) {
          toast.error('Complete a autenticação OAuth ou importe um token')
          return
        }
        // editing sem novo OAuth/token → ok, atualiza só metadados (name/model/etc.)
      }

      if (editingProvider) {
        if (!data.apiKey) delete data.apiKey
        await updateAIProvider(editingProvider.id, data)
      } else {
        const defaults = defaultModels[form.type] || []
        data.model = defaults[0]?.id || 'default'
        data.enabledModels = defaults.slice(0, 3).map(m => m.id)
        await createAIProvider(data)
      }
      closeForm()
      const updated = await getAIProviders()
      setProviders(updated)
      if (!editingProvider && updated.length > 0) {
        const newest = updated[updated.length - 1]
        openModelManager(newest)
      }
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao salvar') }
  }

  async function handleDelete(id: string) {
    if (!await toast.confirm({ title: 'Excluir provedor', message: 'Tem certeza que deseja excluir este provedor?', danger: true, confirmText: 'Excluir' })) return
    try { await deleteAIProvider(id); loadProviders(); toast.success('Provedor excluído') }
    catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao excluir') }
  }

  async function handleTest(id: string) {
    setTesting(id)
    try {
      const result = await testAIProvider(id)
      setTestResults(prev => ({ ...prev, [id]: { success: result.success, latency: result.latencyMs } }))
    } catch {
      setTestResults(prev => ({ ...prev, [id]: { success: false } }))
    }
    setTesting(null)
  }

  function startEdit(provider: AIProvider) {
    setEditingProvider(provider)
    setForm({
      name: provider.name, type: provider.type, apiKey: '',
      baseUrl: provider.baseUrl || '', maxTokens: provider.maxTokens,
      temperature: provider.temperature,
      topP: provider.topP ?? '',
      frequencyPenalty: provider.frequencyPenalty ?? '',
      presencePenalty: provider.presencePenalty ?? '',
      isDefault: provider.isDefault,
    })
    setShowForm(true)
  }

  function startCreate(type: AIProviderType) {
    const info = getProviderInfo(type)
    setEditingProvider(null)
    setForm({
      name: info.name, type, apiKey: '', baseUrl: '',
      maxTokens: 4096, temperature: 0.7,
      topP: '', frequencyPenalty: '', presencePenalty: '',
      isDefault: false,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false); setEditingProvider(null)
    setForm({
      name: '', type: 'OPENAI', apiKey: '', baseUrl: '',
      maxTokens: 4096, temperature: 0.7,
      topP: '', frequencyPenalty: '', presencePenalty: '',
      isDefault: false,
    })
    resetOAuthState()
  }

  async function openModelManager(provider: AIProvider) {
    setManagingModels(provider.id)
    setLoadingModels(true)
    setModelSearch(''); setModelCategoryFilter('all'); setShowOnlyEnabled(false)
    try {
      const res = await api.get(`/ai/providers/${provider.id}/models`)
      const models = res.data.models || (defaultModels[provider.type] || []).map((m: any) => ({ ...m, enabled: false }))
      const enabledSet = new Set(res.data.enabledModels || provider.enabledModels || [])
      setApiModels(models.map((m: any) => ({ id: m.id, name: m.name || m.id, enabled: enabledSet.has(m.id) })))
    } catch {
      const enabledSet = new Set(provider.enabledModels || [])
      setApiModels((defaultModels[provider.type] || []).map(m => ({ ...m, enabled: enabledSet.has(m.id) })))
    }
    setLoadingModels(false)
  }

  function toggleModel(modelId: string) {
    setApiModels(prev => prev.map(m => m.id === modelId ? { ...m, enabled: !m.enabled } : m))
  }

  function categorizeModel(id: string): string {
    const lower = id.toLowerCase()
    if (lower.includes('embed')) return 'Embeddings'
    if (lower.includes('tts') || lower.includes('audio') || lower.includes('whisper') || lower.includes('speech')) return 'Áudio'
    if (lower.includes('dall-e') || lower.includes('image') || lower.includes('vision') || lower.includes('imagen')) return 'Imagem'
    if (lower.includes('code') || lower.includes('codex') || lower.includes('codestral')) return 'Código'
    if (lower.includes('moderation')) return 'Moderação'
    if (/^(o[1-4])/.test(lower)) return 'Raciocínio'
    if (lower.includes('sonar')) return 'Busca'
    if (lower.includes('reason')) return 'Raciocínio'
    return 'Chat'
  }

  const categoryIcons: Record<string, any> = {
    'Chat': Zap, 'Raciocínio': Brain, 'Busca': Globe, 'Embeddings': Code,
    'Áudio': Mic, 'Imagem': ImageIcon, 'Código': Code, 'Moderação': Eye, 'Outros': Filter,
  }

  const filteredModels = useMemo(() => {
    let models = apiModels
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase()
      models = models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    }
    if (showOnlyEnabled) models = models.filter(m => m.enabled)
    if (modelCategoryFilter !== 'all') models = models.filter(m => categorizeModel(m.id) === modelCategoryFilter)
    return models
  }, [apiModels, modelSearch, modelCategoryFilter, showOnlyEnabled])

  const modelCategories = useMemo(() => {
    const cats: Record<string, number> = {}
    apiModels.forEach(m => { const cat = categorizeModel(m.id); cats[cat] = (cats[cat] || 0) + 1 })
    return Object.entries(cats).sort((a, b) => b[1] - a[1])
  }, [apiModels])

  async function saveEnabledModels() {
    if (!managingModels) return
    setSavingModels(true)
    try {
      const enabledModels = apiModels.filter(m => m.enabled).map(m => m.id)
      if (enabledModels.length === 0) { toast.warning('Selecione pelo menos 1 modelo'); setSavingModels(false); return }
      await api.put(`/ai/providers/${managingModels}/enabled-models`, { enabledModels })
      setManagingModels(null)
      loadProviders()
      toast.success(`${enabledModels.length} modelo(s) salvos`)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao salvar modelos') }
    setSavingModels(false)
  }

  // Agrupamento de providers configurados (para exibição)
  const configuredProviderTypes = new Set(providers.map(p => p.type))
  const unconfiguredProviders = ALL_PROVIDER_TYPES // Mostra todos sempre (permite múltiplas instâncias)

  if (loading) return <div className="flex items-center justify-center h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            Provedores de IA
          </h1>
          <p className="text-muted-foreground mt-1">
            {providers.length} provedor{providers.length !== 1 ? 'es' : ''} configurado{providers.length !== 1 ? 's' : ''} •{' '}
            {providers.reduce((acc, p) => acc + (p.enabledModels?.length || 0), 0)} modelos habilitados
          </p>
        </div>
        <Button onClick={() => { setEditingProvider(null); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-2" /> Novo Provedor
        </Button>
      </div>

      {/* ══ Providers Configurados ══ */}
      {providers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Provedores Ativos
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map(provider => {
              const info = getProviderInfo(provider.type)
              const enabledCount = (provider.enabledModels || []).length
              const testRes = testResults[provider.id]
              return (
                <div
                  key={provider.id}
                  className={`group relative bg-card border rounded-xl overflow-hidden transition-all hover:shadow-md hover:border-primary/30 ${info.borderColor}`}
                >
                  {/* Status dot */}
                  <div className={`absolute top-3 right-3 h-2.5 w-2.5 rounded-full ${
                    testRes?.success ? 'bg-green-500 shadow-green-500/50 shadow-sm' :
                    testRes?.success === false ? 'bg-red-500 shadow-red-500/50 shadow-sm' :
                    provider.isActive ? 'bg-green-500/50' : 'bg-gray-400'
                  }`} />

                  {/* Card body */}
                  <div className="p-4">
                    {/* Provider header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${info.bgColor}`}>
                        <ProviderLogo type={provider.type} size={28} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{provider.name}</h3>
                          {provider.isDefault && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
                        </div>
                        <p className={`text-xs ${info.color} font-medium`}>{info.name}</p>
                      </div>
                    </div>

                    {/* Capabilities */}
                    <div className="flex items-center gap-1 mb-3">
                      {info.capabilities.map((cap, i) => (
                        <span key={i} className="text-sm">{cap}</span>
                      ))}
                    </div>

                    {/* Models info */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${info.bgColor} ${info.color} font-medium`}>
                        {enabledCount} modelo{enabledCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Temp: {provider.temperature}
                      </span>
                      {testRes?.latency && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          {testRes.latency}ms
                        </span>
                      )}
                    </div>

                    {/* Enabled models chips (max 4) */}
                    {enabledCount > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {provider.enabledModels.slice(0, 4).map(m => (
                          <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[140px]">
                            {m}
                          </span>
                        ))}
                        {enabledCount > 4 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            +{enabledCount - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card actions footer */}
                  <div className="flex items-center border-t bg-muted/20 px-3 py-2 gap-1">
                    <Button variant="ghost" size="sm" className="h-8 text-xs flex-1" onClick={() => openModelManager(provider)}>
                      <Settings2 className="h-3.5 w-3.5 mr-1" /> Modelos
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handleTest(provider.id)} disabled={testing === provider.id}>
                      {testing === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => startEdit(provider)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-red-500 hover:text-red-600" onClick={() => handleDelete(provider.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ══ Providers Disponíveis ══ */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Adicionar Provedor
        </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {unconfiguredProviders.map(type => {
              const info = getProviderInfo(type)
              const isConfigured = configuredProviderTypes.has(type)
              return (
                <button
                  key={type}
                  onClick={() => startCreate(type)}
                  className={`flex items-center gap-3 p-3 rounded-xl border border-dashed hover:border-solid transition-all hover:shadow-sm text-left group ${info.borderColor} hover:${info.bgColor} relative`}
                >
                  {isConfigured && (
                    <span className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 font-medium">
                      ativo
                    </span>
                  )}
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${info.bgColor} group-hover:scale-110 transition-transform`}>
                    <ProviderLogo type={type} size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{info.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{info.description}</p>
                  </div>
                  <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </button>
              )
            })}
          </div>
        </section>

      {/* Empty state */}
      {providers.length === 0 && unconfiguredProviders.length === 0 && (
        <div className="text-center py-12 bg-card border rounded-lg">
          <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Nenhum provedor configurado</h3>
          <p className="text-muted-foreground mt-1">Adicione uma chave de API para começar</p>
        </div>
      )}

      {/* ══ Form Modal — criar/editar provedor ══ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="bg-card border rounded-xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${getProviderInfo(form.type).bgColor}`}>
                  <ProviderLogo type={form.type} size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{editingProvider ? 'Editar' : 'Novo'} Provedor</h2>
                  <p className="text-xs text-muted-foreground">{getProviderInfo(form.type).description}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={closeForm}><X className="h-4 w-4" /></Button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Nome *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="ex: Meu OpenAI" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Tipo *</label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.type}
                    onChange={e => {
                      const t = e.target.value as AIProviderType
                      const info = getProviderInfo(t)
                      setForm(f => ({ ...f, type: t, name: f.name || info.name }))
                      resetOAuthState()
                    }}>
                    {ALL_PROVIDER_TYPES.map(t => (
                      <option key={t} value={t}>{PROVIDER_REGISTRY[t]?.icon} {PROVIDER_REGISTRY[t]?.name || t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── OAuth providers: GitHub Copilot / Antigravity (criação e reconexão) ── */}
              {isOAuthType(form.type) ? (
                <div className="space-y-3">
                  {editingProvider && (
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                      🔄 <strong>Reconexão</strong>: refaça o OAuth ou importe um token novo para substituir as credenciais expiradas. Deixe em branco para manter as atuais.
                    </div>
                  )}
                  {/* Tabs: OAuth | Importar Token */}
                  <div className="flex border-b">
                    <button type="button" onClick={() => setOauthTab('oauth')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        oauthTab === 'oauth' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}>
                      {form.type === 'GITHUB_COPILOT' ? '🔑 OAuth (GitHub)' : '🔑 OAuth (Google)'}
                    </button>
                    <button type="button" onClick={() => setOauthTab('token')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        oauthTab === 'token' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}>
                      📋 Importar Token
                    </button>
                  </div>

                  {oauthTab === 'oauth' ? (
                    <div className="space-y-3">
                      {/* ── GitHub Copilot Device Code Flow ── */}
                      {form.type === 'GITHUB_COPILOT' && (
                        <>
                          {!deviceCode && !copilotResult && (
                            <div className="text-center py-4">
                              <p className="text-sm text-muted-foreground mb-3">
                                Conecte sua conta GitHub com assinatura Copilot ativa
                              </p>
                              <Button type="button" onClick={startCopilotDeviceCode} className="gap-2">
                                <ProviderLogo type="GITHUB_COPILOT" size={18} />
                                Conectar com GitHub
                              </Button>
                            </div>
                          )}

                          {deviceCode && copilotPolling && (
                            <div className="text-center py-4 space-y-3">
                              <p className="text-sm text-muted-foreground">
                                Abra <a href={deviceCode.verification_uri} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">{deviceCode.verification_uri}</a> e digite o código:
                              </p>
                              <div className="flex items-center justify-center gap-2">
                                <code className="text-2xl font-mono font-bold tracking-[0.3em] bg-muted px-4 py-2 rounded-lg select-all">
                                  {deviceCode.user_code}
                                </code>
                                <Button type="button" variant="ghost" size="sm"
                                  onClick={() => { navigator.clipboard.writeText(deviceCode.user_code); toast.success('Código copiado!') }}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Aguardando autorização...
                              </div>
                            </div>
                          )}

                          {copilotResult && (
                            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-1">
                              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm">
                                <CheckCircle className="h-4 w-4" />
                                Conectado como {copilotResult.user?.name || copilotResult.user?.login}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Endpoint: {copilotResult.copilotEndpoint}
                              </p>
                            </div>
                          )}
                        </>
                      )}

                      {/* ── Antigravity Google OAuth ── */}
                      {form.type === 'ANTIGRAVITY' && (
                        <>
                          {!antigravityResult && (
                            <div className="text-center py-4">
                              <p className="text-sm text-muted-foreground mb-3">
                                Conecte sua conta Google para usar o Antigravity (Google AI)
                              </p>
                              <Button type="button" onClick={startAntigravityOAuth} className="gap-2">
                                <ProviderLogo type="ANTIGRAVITY" size={18} />
                                Conectar com Google
                              </Button>
                              <p className="text-xs text-muted-foreground mt-2">
                                Uma janela popup será aberta para autenticação
                              </p>
                            </div>
                          )}

                          {antigravityResult && (
                            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-1">
                              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm">
                                <CheckCircle className="h-4 w-4" />
                                Conectado como {antigravityResult.user?.name || antigravityResult.user?.email}
                              </div>
                              {antigravityResult.projectId && (
                                <p className="text-xs text-muted-foreground">
                                  Project: {antigravityResult.projectId}
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    /* ── Import Token tab ── */
                    <div className="space-y-2">
                      <label className="text-sm font-medium mb-1 block">
                        {form.type === 'GITHUB_COPILOT' ? 'Copilot Token' : 'Google Access Token'} *
                      </label>
                      <Input type="password" value={importToken} onChange={e => setImportToken(e.target.value)}
                        placeholder={form.type === 'GITHUB_COPILOT' ? 'tid=...' : 'ya29...'} />
                      <p className="text-xs text-muted-foreground">
                        {form.type === 'GITHUB_COPILOT'
                          ? 'Cole o copilotToken obtido via browser ou extensão. Expira a cada ~30min.'
                          : 'Cole o access_token do Google OAuth. Expira a cada ~1h.'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* ── API Key (providers normais) ── */
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Chave de API {editingProvider ? '(deixe vazio para manter)' : '*'}
                  </label>
                  <Input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                    required={!editingProvider && !isOAuthType(form.type)} placeholder={editingProvider ? '••••••••' : 'sk-...'} />
                </div>
              )}
              {(form.type === 'OPENAI_COMPATIBLE' || form.baseUrl) && (
                <div>
                  <label className="text-sm font-medium mb-1 block">URL Base {form.type === 'OPENAI_COMPATIBLE' ? '*' : '(opcional)'}</label>
                  <Input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                    required={form.type === 'OPENAI_COMPATIBLE'}
                    placeholder={getProviderInfo(form.type).defaultBaseUrl || 'https://api.example.com/v1'} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Max Tokens</label>
                  <Input type="number" value={form.maxTokens} onChange={e => setForm(f => ({ ...f, maxTokens: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Temperatura</label>
                  <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: Number(e.target.value) }))} />
                </div>
              </div>

              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium select-none">
                  Parâmetros avançados de sampling (opcional)
                </summary>
                <p className="text-[11px] text-muted-foreground mt-2 mb-3">
                  Deixe em branco para usar o padrão do provider. Suportado por OpenAI/compatíveis e Gemini. Claude suporta apenas Top P.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Top P (0–1)</label>
                    <Input
                      type="number" step="0.05" min="0" max="1"
                      placeholder="ex: 0.9"
                      value={form.topP as any}
                      onChange={e => setForm(f => ({ ...f, topP: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Frequency Penalty (-2 a 2)</label>
                    <Input
                      type="number" step="0.1" min="-2" max="2"
                      placeholder="ex: 0.3"
                      value={form.frequencyPenalty as any}
                      onChange={e => setForm(f => ({ ...f, frequencyPenalty: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Presence Penalty (-2 a 2)</label>
                    <Input
                      type="number" step="0.1" min="-2" max="2"
                      placeholder="ex: 0.3"
                      value={form.presencePenalty as any}
                      onChange={e => setForm(f => ({ ...f, presencePenalty: e.target.value }))}
                    />
                  </div>
                </div>
              </details>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                <label htmlFor="isDefault" className="text-sm">Provedor padrão</label>
              </div>
              {getProviderInfo(form.type).website && !isOAuthType(form.type) && (
                <a href={getProviderInfo(form.type).website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                  <ExternalLink className="h-3 w-3" /> Obter API Key em {getProviderInfo(form.type).website}
                </a>
              )}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={closeForm}>Cancelar</Button>
                <Button type="submit" disabled={
                  isOAuthType(form.type) && !editingProvider && oauthTab === 'oauth'
                    ? (form.type === 'GITHUB_COPILOT' ? !copilotResult : !antigravityResult)
                    : false
                }>
                  {editingProvider ? 'Salvar' : 'Criar Provedor'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Model Manager Panel ══ */}
      {managingModels && (() => {
        const managedProvider = providers.find(p => p.id === managingModels)
        const managedInfo = managedProvider ? getProviderInfo(managedProvider.type) : null
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && setManagingModels(null)}>
            <div className="bg-card border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
              {/* Header */}
              <div className="p-5 border-b">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${managedInfo?.bgColor || ''}`}>
                      {managedProvider ? <ProviderLogo type={managedProvider.type} size={22} /> : '⚙️'}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold">Gerenciar Modelos</h2>
                      <p className="text-sm text-muted-foreground">
                        {managedProvider?.name} — {managedInfo?.name}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setManagingModels(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {!loadingModels && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input type="text" value={modelSearch} onChange={e => setModelSearch(e.target.value)}
                        placeholder="Buscar modelos..."
                        className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        autoFocus />
                      {modelSearch && (
                        <button onClick={() => setModelSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setModelCategoryFilter('all')}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          modelCategoryFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'
                        }`}>
                        Todos ({apiModels.length})
                      </button>
                      {modelCategories.map(([cat, count]) => {
                        const IconComp = categoryIcons[cat] || Filter
                        return (
                          <button key={cat}
                            onClick={() => setModelCategoryFilter(modelCategoryFilter === cat ? 'all' : cat)}
                            className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                              modelCategoryFilter === cat ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'
                            }`}>
                            <IconComp className="h-3 w-3" />
                            {cat} ({count})
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">
                          <span className="text-primary">{apiModels.filter(m => m.enabled).length}</span>
                          <span className="text-muted-foreground"> de {apiModels.length}</span>
                        </span>
                        <button onClick={() => setShowOnlyEnabled(!showOnlyEnabled)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            showOnlyEnabled ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}>
                          <Eye className="h-3 w-3 inline mr-1" />{showOnlyEnabled ? 'Mostrando ativos' : 'Mostrar só ativos'}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => {
                            const f = modelCategoryFilter !== 'all'
                              ? apiModels.filter(m => categorizeModel(m.id) === modelCategoryFilter).map(m => m.id)
                              : null
                            setApiModels(prev => prev.map(m => f ? (f.includes(m.id) ? { ...m, enabled: true } : m) : { ...m, enabled: true }))
                          }} className="text-xs text-primary hover:underline">
                          Habilitar {modelCategoryFilter !== 'all' ? 'categoria' : 'todos'}
                        </button>
                        <span className="text-xs text-muted-foreground">|</span>
                        <button type="button" onClick={() => {
                            const f = modelCategoryFilter !== 'all'
                              ? apiModels.filter(m => categorizeModel(m.id) === modelCategoryFilter).map(m => m.id)
                              : null
                            setApiModels(prev => prev.map(m => f ? (f.includes(m.id) ? { ...m, enabled: false } : m) : { ...m, enabled: false }))
                          }} className="text-xs text-muted-foreground hover:underline">
                          Desabilitar {modelCategoryFilter !== 'all' ? 'categoria' : 'todos'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Lista de modelos */}
              <div className="flex-1 overflow-y-auto">
                {loadingModels ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                    <p className="text-sm text-muted-foreground">Buscando modelos disponíveis na API...</p>
                  </div>
                ) : filteredModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Search className="h-8 w-8 text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground">Nenhum modelo encontrado</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredModels.map(model => {
                      const cat = categorizeModel(model.id)
                      const IconComp = categoryIcons[cat] || Filter
                      return (
                        <div key={model.id} onClick={() => toggleModel(model.id)}
                          className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-all hover:bg-muted/30 ${model.enabled ? 'bg-primary/[0.03]' : ''}`}>
                          <div className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${model.enabled ? 'bg-primary' : 'bg-muted-foreground/20'}`}>
                            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${model.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </div>
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${model.enabled ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
                            <IconComp className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-medium truncate ${model.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{model.id}</p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">{cat}</span>
                            </div>
                            {model.name !== model.id && <p className="text-xs text-muted-foreground/70 truncate">{model.name}</p>}
                          </div>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                            model.enabled ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-muted text-muted-foreground/50'
                          }`}>
                            {model.enabled ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-4 border-t bg-muted/20">
                <Button variant="outline" size="sm" onClick={() => {
                  const pid = managingModels
                  setManagingModels(null)
                  if (pid) { setLoadingModels(true); openModelManager(providers.find(p => p.id === pid)!) }
                }}>
                  <RefreshCw className="h-4 w-4 mr-1.5" /> Recarregar
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setManagingModels(null)}>Cancelar</Button>
                  <Button onClick={saveEnabledModels} disabled={savingModels}>
                    {savingModels ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
                    Salvar ({apiModels.filter(m => m.enabled).length})
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
