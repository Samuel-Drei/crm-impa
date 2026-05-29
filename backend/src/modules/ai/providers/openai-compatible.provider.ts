/**
 * OpenAI-Compatible Provider
 * 
 * Muitos providers de IA utilizam o mesmo formato de API do OpenAI
 * (DeepSeek, Groq, OpenRouter, Perplexity, Mistral, Together, Fireworks, etc.)
 * 
 * Este provider genérico funciona com qualquer endpoint que siga o padrão
 * OpenAI /v1/chat/completions + /v1/models
 */

import { IAIProvider, AICompletionOptions, AICompletionResult, AIModelInfo } from './base.provider.js'
import { KNOWN_MODELS } from '../cost-calculator.js'

export interface OpenAICompatibleConfig {
  name: string
  apiKey: string
  baseUrl: string
  defaultModel: string
  /** Header de autenticação (padrão: Authorization: Bearer <key>) */
  authHeader?: string
  /** Headers customizados extras */
  extraHeaders?: Record<string, string>
  /** Filtro de modelos ao listar (retorna true para manter) */
  modelFilter?: (modelId: string) => boolean
  /** Chave no KNOWN_MODELS para fallback */
  knownModelsKey?: string
}

export class OpenAICompatibleProvider implements IAIProvider {
  name: string
  private apiKey: string
  private baseUrl: string
  private defaultModel: string
  private authHeader: string
  private extraHeaders: Record<string, string>
  private modelFilter?: (id: string) => boolean
  private knownModelsKey?: string

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/+$/, '') // remove trailing slash
    this.defaultModel = config.defaultModel
    this.authHeader = config.authHeader || `Bearer ${config.apiKey}`
    this.extraHeaders = config.extraHeaders || {}
    this.modelFilter = config.modelFilter
    this.knownModelsKey = config.knownModelsKey
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async chat(options: AICompletionOptions): Promise<AICompletionResult> {
    const startTime = Date.now()

    const sysPrompt = options.systemPrompt?.replace(/<!--cache_breakpoint-->\s*/g, '')
    const rawMessages = sysPrompt
      ? [{ role: 'system' as const, content: sysPrompt }, ...options.messages]
      : options.messages
    // Converter imageData em conteúdo multimodal (vision)
    const messages = rawMessages.map(m => {
      if (m.imageData && (m.role === 'user' || m.role === 'assistant')) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.imageData.mimeType};base64,${m.imageData.base64}` } },
          ],
        }
      }
      return m
    })

    const body: any = {
      model: options.model || this.defaultModel,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
    }
    if (typeof options.topP === 'number') body.top_p = options.topP
    if (typeof options.frequencyPenalty === 'number') body.frequency_penalty = options.frequencyPenalty
    if (typeof options.presencePenalty === 'number') body.presence_penalty = options.presencePenalty

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      const tc = options.toolChoice ?? 'auto'
      if (typeof tc === 'string') {
        body.tool_choice = tc
      } else if (tc && typeof tc === 'object' && tc.name) {
        body.tool_choice = { type: 'function', function: { name: tc.name } }
      } else {
        body.tool_choice = 'auto'
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const latencyMs = Date.now() - startTime
    const choice = data.choices?.[0]

    if (!choice) {
      throw new Error(`${this.name}: resposta vazia (sem choices)`)
    }

    const toolCalls = choice.message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }))

    return {
      content: choice.message?.content || '',
      tokensUsed: data.usage?.total_tokens || 0,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      model: data.model || options.model || this.defaultModel,
      latencyMs,
      toolCalls,
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    const fallback = this.knownModelsKey
      ? (KNOWN_MODELS as any)[this.knownModelsKey] || []
      : []

    try {
      // Headers específicos para /models — remove Openai-Intent (exclusivo de chat)
      const modelsHeaders: Record<string, string> = {
        Authorization: this.authHeader,
      }
      for (const [k, v] of Object.entries(this.extraHeaders)) {
        if (k.toLowerCase() === 'openai-intent') continue
        modelsHeaders[k] = v
      }

      const response = await fetch(`${this.baseUrl}/models`, { headers: modelsHeaders })

      if (!response.ok) {
        console.warn(`[${this.name}] listModels HTTP ${response.status} — usando fallback`)
        return fallback
      }

      const data = await response.json() as any
      let models = (data.data || data.models || []) as any[]

      // Aplicar filtro se configurado
      if (this.modelFilter) {
        models = models.filter((m: any) => this.modelFilter!(m.id || m.name))
      }

      const result = models
        .map((m: any) => {
          const capabilities = m.capabilities || {}
          const limits = capabilities.limits || {}
          const ctxTokens = limits.max_context_window_tokens || m.context_length
          return {
            id: m.id || m.name,
            name: m.name || m.id,
            owned_by: m.owned_by || m.vendor,
            context: ctxTokens ? `${Math.round(ctxTokens / 1000)}K` : undefined,
            // @ts-ignore — campos extras opcionais para UI
            capability: capabilities.type,
            preview: m.preview === true || undefined,
          }
        })
        .sort((a: any, b: any) => a.id.localeCompare(b.id))

      console.log(`[${this.name}] listModels retornou ${result.length} modelos da API`)
      return result.length > 0 ? result : fallback
    } catch (err: any) {
      console.warn(`[${this.name}] listModels falhou:`, err?.message)
      return fallback
    }
  }
}
