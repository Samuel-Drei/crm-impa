import { IAIProvider, AICompletionOptions, AICompletionResult, AIModelInfo } from './base.provider.js'
import { KNOWN_MODELS } from '../cost-calculator.js'

export class OpenAIProvider implements IAIProvider {
  name = 'OpenAI'
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || 'https://api.openai.com/v1'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async chat(options: AICompletionOptions): Promise<AICompletionResult> {
    const startTime = Date.now()

    // Remove cache breakpoint marker (OpenAI tem prompt cache automático — não precisa marker)
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
      model: options.model || 'gpt-4o-mini',
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
    }
    if (typeof options.topP === 'number') body.top_p = options.topP
    if (typeof options.frequencyPenalty === 'number') body.frequency_penalty = options.frequencyPenalty
    if (typeof options.presencePenalty === 'number') body.presence_penalty = options.presencePenalty

    // Adicionar tools para function calling (padrão evo-ai)
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      // tool_choice: 'auto' (default), 'none', 'required' ou {type:'function', function:{name}}
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
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const latencyMs = Date.now() - startTime

    const choice = data.choices[0]

    // Extrair tool calls se existirem
    const toolCalls = choice.message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }))

    return {
      content: choice.message.content || '',
      tokensUsed: data.usage?.total_tokens || 0,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      model: data.model,
      latencyMs,
      toolCalls,
    }
  }

  async chatStream(options: AICompletionOptions, onToken: (token: string) => void): Promise<AICompletionResult> {
    const startTime = Date.now()
    const sysPrompt = options.systemPrompt?.replace(/<!--cache_breakpoint-->\s*/g, '')
    const rawMessages = sysPrompt
      ? [{ role: 'system' as const, content: sysPrompt }, ...options.messages]
      : options.messages
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
      model: options.model || 'gpt-4o-mini',
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (typeof options.topP === 'number') body.top_p = options.topP
    if (typeof options.frequencyPenalty === 'number') body.frequency_penalty = options.frequencyPenalty
    if (typeof options.presencePenalty === 'number') body.presence_penalty = options.presencePenalty

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let content = ''
    let modelName = options.model || 'gpt-4o-mini'
    let promptTokens = 0
    let completionTokens = 0
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue
          try {
            const chunk = JSON.parse(trimmed.slice(6)) as any
            if (chunk.model) modelName = chunk.model
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0
              completionTokens = chunk.usage.completion_tokens || 0
            }
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) {
              content += delta
              onToken(delta)
            }
          } catch {
            // Ignore malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const latencyMs = Date.now() - startTime
    return {
      content,
      tokensUsed: promptTokens + completionTokens,
      promptTokens,
      completionTokens,
      model: modelName,
      latencyMs,
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!response.ok) return KNOWN_MODELS.OPENAI
      const data = await response.json() as any
      // Incluir modelos de chat E embeddings; excluir áudio/visão/imagem
      const filtered = (data.data || [])
        .filter((m: any) => {
          const id = m.id as string
          const isChat = (
            id.startsWith('gpt-') ||
            id.startsWith('o1') ||
            id.startsWith('o3') ||
            id.startsWith('o4')
          ) && !id.includes('instruct') && !id.includes('vision') &&
            !id.includes('audio') && !id.includes('realtime') &&
            !id.includes('embedding') && !id.includes('whisper') &&
            !id.includes('tts') && !id.includes('dall-e') &&
            !id.includes('image') && !id.includes('search') &&
            !id.includes('transcribe')
          const isEmbedding = id.startsWith('text-embedding-')
          return isChat || isEmbedding
        })
        .map((m: any) => {
          const id = m.id as string
          const type = id.startsWith('text-embedding-') ? 'embedding' : 'chat'
          return { id, name: id, owned_by: m.owned_by, type }
        })
        .sort((a: any, b: any) => b.id.localeCompare(a.id))
      return filtered.length > 0 ? filtered : KNOWN_MODELS.OPENAI
    } catch {
      return KNOWN_MODELS.OPENAI
    }
  }
}
