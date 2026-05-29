import { AIProviderType } from '@prisma/client'
import { IAIProvider } from './base.provider.js'
import { OpenAIProvider } from './openai.provider.js'
import { GeminiProvider } from './gemini.provider.js'
import { ClaudeProvider } from './claude.provider.js'
import { OpenAICompatibleProvider } from './openai-compatible.provider.js'
import { PROVIDER_REGISTRY } from './provider-registry.js'

export function createProvider(
  type: AIProviderType,
  apiKey: string,
  baseUrl?: string | null,
  oauthData?: any
): IAIProvider {
  switch (type) {
    // ── Providers nativos (API própria) ──
    case 'OPENAI':
      return new OpenAIProvider(apiKey, baseUrl || undefined)
    case 'GEMINI':
      return new GeminiProvider(apiKey, baseUrl || undefined)
    case 'CLAUDE':
      return new ClaudeProvider(apiKey, baseUrl || undefined)

    // ── OAuth Providers ──
    case 'GITHUB_COPILOT': {
      // Copilot usa o copilotToken (não o GitHub access token)
      const copilotToken = oauthData?.copilotToken || apiKey
      const copilotEndpoint = oauthData?.copilotEndpoint || 'https://api.githubcopilot.com'
      return new OpenAICompatibleProvider({
        name: 'GitHub Copilot',
        apiKey: copilotToken,
        baseUrl: copilotEndpoint,
        defaultModel: 'gpt-4o',
        knownModelsKey: 'GITHUB_COPILOT',
        extraHeaders: {
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Version': 'vscode/1.104.0',
          'Editor-Plugin-Version': 'copilot-chat/0.29.0',
          'Openai-Intent': 'conversation-panel',
        },
      })
    }
    case 'ANTIGRAVITY': {
      // Antigravity usa Google OAuth token com endpoint cloudcode-pa
      const accessToken = oauthData?.googleAccessToken || apiKey
      return new OpenAICompatibleProvider({
        name: 'Antigravity',
        apiKey: accessToken,
        baseUrl: baseUrl || 'https://cloudcode-pa.googleapis.com/v1internal',
        defaultModel: 'gemini-2.5-flash',
        knownModelsKey: 'ANTIGRAVITY',
      })
    }

    // ── Providers OpenAI-compatible ──
    case 'DEEPSEEK':
    case 'GROQ':
    case 'OPENROUTER':
    case 'PERPLEXITY':
    case 'MISTRAL':
    case 'COHERE':
    case 'XAI':
    case 'TOGETHER':
    case 'FIREWORKS':
    case 'CEREBRAS':
    case 'GITHUB_MODELS':
    case 'OPENAI_COMPATIBLE': {
      const registry = PROVIDER_REGISTRY[type]
      if (!registry) throw new Error(`Provider ${type} não encontrado no registry`)
      return new OpenAICompatibleProvider({
        name: registry.name,
        apiKey,
        baseUrl: baseUrl || registry.defaultBaseUrl,
        defaultModel: registry.defaultModel,
        knownModelsKey: type,
      })
    }

    default:
      throw new Error(`Tipo de provider não suportado: ${type}`)
  }
}

export type { IAIProvider, AICompletionOptions, AICompletionResult, AIMessage } from './base.provider.js'
export { OpenAIProvider } from './openai.provider.js'
export { GeminiProvider } from './gemini.provider.js'
export { ClaudeProvider } from './claude.provider.js'
export { OpenAICompatibleProvider } from './openai-compatible.provider.js'
export { PROVIDER_REGISTRY, type ProviderRegistryEntry } from './provider-registry.js'
