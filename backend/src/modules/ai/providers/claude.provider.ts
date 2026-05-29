import { IAIProvider, AICompletionOptions, AICompletionResult, AIModelInfo } from './base.provider.js'
import { KNOWN_MODELS } from '../cost-calculator.js'
import { getCacheBreakpointMarker } from '../prompt-layers.js'

export class ClaudeProvider implements IAIProvider {
  name = 'Claude'
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || 'https://api.anthropic.com/v1'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async chat(options: AICompletionOptions): Promise<AICompletionResult> {
    const startTime = Date.now()

    const messages = options.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
          }
        }
        if (m.imageData && m.role === 'user') {
          return {
            role: 'user' as const,
            content: [
              { type: 'image', source: { type: 'base64', media_type: m.imageData.mimeType, data: m.imageData.base64 } },
              { type: 'text', text: m.content },
            ],
          }
        }
        return { role: m.role as 'user' | 'assistant', content: m.content }
      })

    const body: any = {
      model: options.model || 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      messages,
    }
    // Claude suporta top_p (não suporta frequency/presence penalty)
    if (typeof options.topP === 'number') body.top_p = options.topP

    if (options.systemPrompt) {
      // PROMPT CACHE (Anthropic): se houver marker <!--cache_breakpoint--> no system prompt,
      // divide em [estável | dinâmico] e marca o estável com cache_control:
      // {type: 'ephemeral'}. Isso reduz tokens de input em até 90% nas chamadas
      // subsequentes (cache TTL = 5 min, refresh automático).
      const marker = getCacheBreakpointMarker()
      const idx = options.systemPrompt.indexOf(marker)
      if (idx > 0) {
        const cached = options.systemPrompt.slice(0, idx).trim()
        const fresh = options.systemPrompt.slice(idx + marker.length).trim()
        const blocks: any[] = [
          { type: 'text', text: cached, cache_control: { type: 'ephemeral' } },
        ]
        if (fresh) blocks.push({ type: 'text', text: fresh })
        body.system = blocks
      } else {
        body.system = options.systemPrompt
      }
    }

    const shouldDisableTools = options.toolChoice === 'none'

    // Function calling para Claude
    if (!shouldDisableTools && options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))

      const tc = options.toolChoice ?? 'auto'
      if (tc === 'required') {
        body.tool_choice = { type: 'any' }
      } else if (tc && typeof tc === 'object' && tc.name) {
        body.tool_choice = { type: 'tool', name: tc.name }
      } else {
        body.tool_choice = { type: 'auto' }
      }
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // Header obrigatório para usar prompt caching (caso o body contenha cache_control)
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const latencyMs = Date.now() - startTime

    // Extrair texto e tool_use blocks
    const textBlock = data.content?.find((b: any) => b.type === 'text')
    const text = textBlock?.text || ''
    const promptTokens = data.usage?.input_tokens || 0
    const completionTokens = data.usage?.output_tokens || 0
    const tokensUsed = promptTokens + completionTokens

    // Extrair tool calls do Claude
    const toolUseBlocks = data.content?.filter((b: any) => b.type === 'tool_use') || []
    const toolCalls = toolUseBlocks.length > 0
      ? toolUseBlocks.map((b: any) => ({
          id: b.id,
          name: b.name,
          arguments: b.input || {},
        }))
      : undefined

    return {
      content: text,
      tokensUsed,
      promptTokens,
      completionTokens,
      model: data.model,
      latencyMs,
      toolCalls,
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!response.ok) return KNOWN_MODELS.ANTHROPIC
      const data = await response.json() as any
      const chatModels = (data.data || [])
        .filter((m: any) => !m.id.includes('embed'))
        .map((m: any) => ({ id: m.id, name: m.display_name || m.id }))
        .sort((a: any, b: any) => b.id.localeCompare(a.id))
      return chatModels.length > 0 ? chatModels : KNOWN_MODELS.ANTHROPIC
    } catch {
      return KNOWN_MODELS.ANTHROPIC
    }
  }
}
