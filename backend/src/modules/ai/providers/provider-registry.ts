/**
 * Provider Registry — Configurações de todos os providers suportados
 * 
 * Cada entry define: nome, baseUrl padrão, modelo padrão, capabilities,
 * ícone e categoria para a UI. Novos providers OpenAI-compatible podem
 * ser adicionados aqui sem criar arquivos novos.
 */

export type ProviderCategory = 'api_key' | 'openai_compatible'

export interface ProviderCapability {
  id: string
  label: string
  icon: string
}

export interface ProviderRegistryEntry {
  /** ID que corresponde ao AIProviderType enum */
  type: string
  /** Nome de exibição */
  name: string
  /** Categoria para agrupamento na UI */
  category: ProviderCategory
  /** URL base padrão da API */
  defaultBaseUrl: string
  /** Modelo recomendado padrão */
  defaultModel: string
  /** Cor do avatar/badge (hex) */
  color: string
  /** Ícone/emoji para a UI */
  icon: string
  /** Headers extras necessários */
  extraHeaders?: Record<string, string>
  /** Capabilities do provider */
  capabilities: string[]
  /** Descrição curta */
  description: string
  /** Website */
  website?: string
}

export const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry> = {
  // ═══ Providers nativos (API própria) ═══
  OPENAI: {
    type: 'OPENAI',
    name: 'OpenAI',
    category: 'api_key',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    color: '#10a37f',
    icon: '🟢',
    capabilities: ['chat', 'vision', 'embedding', 'audio_transcription', 'audio_tts', 'image_generation', 'function_calling', 'code'],
    description: 'GPT-4o, o3, DALL-E, Whisper, TTS',
    website: 'https://platform.openai.com',
  },
  GEMINI: {
    type: 'GEMINI',
    name: 'Google Gemini',
    category: 'api_key',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    color: '#4285f4',
    icon: '🔵',
    capabilities: ['chat', 'vision', 'embedding', 'audio', 'video', 'function_calling', 'code', 'long_context'],
    description: 'Gemini 2.5 Pro/Flash, contexto 1-2M tokens',
    website: 'https://aistudio.google.com',
  },
  CLAUDE: {
    type: 'CLAUDE',
    name: 'Anthropic Claude',
    category: 'api_key',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    color: '#d97706',
    icon: '🟠',
    capabilities: ['chat', 'vision', 'function_calling', 'code', 'long_context'],
    description: 'Claude 3.5 Sonnet/Haiku/Opus',
    website: 'https://console.anthropic.com',
  },

  // ═══ Providers OpenAI-compatible ═══
  DEEPSEEK: {
    type: 'DEEPSEEK',
    name: 'DeepSeek',
    category: 'api_key',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    color: '#0066ff',
    icon: '🔷',
    capabilities: ['chat', 'code', 'function_calling', 'long_context'],
    description: 'DeepSeek V3, R1 Reasoning — ultra baixo custo',
    website: 'https://platform.deepseek.com',
  },
  GROQ: {
    type: 'GROQ',
    name: 'Groq',
    category: 'api_key',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    color: '#f55036',
    icon: '⚡',
    capabilities: ['chat', 'vision', 'function_calling', 'code'],
    description: 'Inferência ultra-rápida — Llama 3, Mixtral, Gemma',
    website: 'https://console.groq.com',
  },
  OPENROUTER: {
    type: 'OPENROUTER',
    name: 'OpenRouter',
    category: 'api_key',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    color: '#6366f1',
    icon: '🌐',
    capabilities: ['chat', 'vision', 'function_calling', 'code', 'long_context'],
    description: 'Roteador universal — acesso a 200+ modelos',
    website: 'https://openrouter.ai',
  },
  PERPLEXITY: {
    type: 'PERPLEXITY',
    name: 'Perplexity',
    category: 'api_key',
    defaultBaseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    color: '#20b2aa',
    icon: '🔍',
    capabilities: ['chat', 'search', 'function_calling'],
    description: 'Busca em tempo real + IA — Sonar Pro/Reasoning',
    website: 'https://docs.perplexity.ai',
  },
  MISTRAL: {
    type: 'MISTRAL',
    name: 'Mistral AI',
    category: 'api_key',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    color: '#ff7000',
    icon: '🌪️',
    capabilities: ['chat', 'vision', 'embedding', 'function_calling', 'code'],
    description: 'Mistral Large, Codestral, Pixtral',
    website: 'https://console.mistral.ai',
  },
  COHERE: {
    type: 'COHERE',
    name: 'Cohere',
    category: 'api_key',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    defaultModel: 'command-r-plus',
    color: '#39594d',
    icon: '🧬',
    capabilities: ['chat', 'embedding', 'function_calling', 'search'],
    description: 'Command R+, embeddings multilíngue, RAG',
    website: 'https://dashboard.cohere.com',
  },
  XAI: {
    type: 'XAI',
    name: 'xAI (Grok)',
    category: 'api_key',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2',
    color: '#1da1f2',
    icon: '🤖',
    capabilities: ['chat', 'vision', 'function_calling', 'code'],
    description: 'Grok 2 — modelo da xAI/Twitter',
    website: 'https://console.x.ai',
  },
  TOGETHER: {
    type: 'TOGETHER',
    name: 'Together AI',
    category: 'api_key',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    color: '#0ea5e9',
    icon: '🤝',
    capabilities: ['chat', 'vision', 'embedding', 'function_calling', 'code', 'image_generation'],
    description: 'Llama, Mixtral, SDXL — open source cloud',
    website: 'https://api.together.xyz',
  },
  FIREWORKS: {
    type: 'FIREWORKS',
    name: 'Fireworks AI',
    category: 'api_key',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    color: '#ef4444',
    icon: '🎆',
    capabilities: ['chat', 'vision', 'embedding', 'function_calling', 'code'],
    description: 'Inferência rápida — Llama, Mixtral, FireFunction',
    website: 'https://fireworks.ai',
  },
  CEREBRAS: {
    type: 'CEREBRAS',
    name: 'Cerebras',
    category: 'api_key',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama3.1-70b',
    color: '#8b5cf6',
    icon: '🧠',
    capabilities: ['chat', 'code', 'function_calling'],
    description: 'Inferência mais rápida do mundo — Llama 3.1',
    website: 'https://cloud.cerebras.ai',
  },
  GITHUB_MODELS: {
    type: 'GITHUB_MODELS',
    name: 'GitHub Models',
    category: 'api_key',
    defaultBaseUrl: 'https://models.inference.ai.azure.com',
    defaultModel: 'gpt-4o-mini',
    color: '#24292e',
    icon: '🐙',
    capabilities: ['chat', 'vision', 'function_calling', 'code', 'embedding'],
    description: 'GPT-4o, Llama, Mistral, Phi via GitHub — grátis para devs',
    website: 'https://github.com/marketplace/models',
  },
  GITHUB_COPILOT: {
    type: 'GITHUB_COPILOT',
    name: 'GitHub Copilot',
    category: 'api_key',
    defaultBaseUrl: 'https://api.githubcopilot.com',
    defaultModel: 'gpt-4o',
    color: '#24292e',
    icon: '🤖',
    capabilities: ['chat', 'vision', 'code', 'function_calling'],
    description: 'GitHub Copilot — OAuth Device Code ou token importado',
    website: 'https://github.com/features/copilot',
  },
  ANTIGRAVITY: {
    type: 'ANTIGRAVITY',
    name: 'Antigravity',
    category: 'api_key',
    defaultBaseUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
    defaultModel: 'gemini-2.5-flash',
    color: '#a855f7',
    icon: '🚀',
    capabilities: ['chat', 'vision', 'code', 'function_calling', 'long_context'],
    description: 'Google Antigravity — OAuth Google ou token importado',
    website: 'https://idx.google.com',
  },
  OPENAI_COMPATIBLE: {
    type: 'OPENAI_COMPATIBLE',
    name: 'OpenAI Compatible',
    category: 'openai_compatible',
    defaultBaseUrl: '',
    defaultModel: '',
    color: '#6b7280',
    icon: '🔌',
    capabilities: ['chat', 'function_calling'],
    description: 'Qualquer endpoint compatível com OpenAI (Ollama, LM Studio, vLLM, LiteLLM)',
    website: '',
  },
}

/** Retorna todas as entries do registry como array */
export function getAllProviders(): ProviderRegistryEntry[] {
  return Object.values(PROVIDER_REGISTRY)
}

/** Retorna uma entry do registry pelo tipo */
export function getProviderInfo(type: string): ProviderRegistryEntry | undefined {
  return PROVIDER_REGISTRY[type]
}
