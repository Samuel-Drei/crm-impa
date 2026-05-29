import { IAIProvider, AICompletionOptions, AICompletionResult, AIModelInfo } from './base.provider.js'
import { KNOWN_MODELS } from '../cost-calculator.js'

export class GeminiProvider implements IAIProvider {
  name = 'Gemini'
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async chat(options: AICompletionOptions): Promise<AICompletionResult> {
    const startTime = Date.now()

    const model = options.model || 'gemini-2.0-flash'

    const cleanSystem = options.systemPrompt?.replace(/<!--cache_breakpoint-->\s*/g, '')
    const systemInstruction = cleanSystem
      ? { parts: [{ text: cleanSystem }] }
      : undefined

    const contents = options.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const parts: any[] = []
        if (m.imageData) {
          parts.push({ inlineData: { mimeType: m.imageData.mimeType, data: m.imageData.base64 } })
        }
        parts.push({ text: m.content })
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        }
      })

    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        ...(typeof options.topP === 'number' ? { topP: options.topP } : {}),
        ...(typeof options.frequencyPenalty === 'number' ? { frequencyPenalty: options.frequencyPenalty } : {}),
        ...(typeof options.presencePenalty === 'number' ? { presencePenalty: options.presencePenalty } : {}),
      },
    }

    if (systemInstruction) {
      body.system_instruction = systemInstruction
    }

    // Function calling para Gemini
    if (options.tools && options.tools.length > 0) {
      body.tools = [{
        function_declarations: options.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: 'OBJECT',
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map(([k, v]) => [k, {
                type: v.type.toUpperCase(),
                description: v.description,
                ...(v.enum ? { enum: v.enum } : {}),
              }])
            ),
            required: t.parameters.required || [],
          },
        })),
      }]

      const tc = options.toolChoice ?? 'auto'
      if (tc === 'required') {
        body.toolConfig = { functionCallingConfig: { mode: 'ANY' } }
      } else if (tc === 'none') {
        body.toolConfig = { functionCallingConfig: { mode: 'NONE' } }
      } else if (tc && typeof tc === 'object' && tc.name) {
        body.toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [tc.name],
          },
        }
      } else {
        body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
      }
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const latencyMs = Date.now() - startTime

    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts || []
    const text = parts.find((p: any) => p.text)?.text || ''
    const promptTokens = data.usageMetadata?.promptTokenCount || 0
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 0
    const tokensUsed = promptTokens + completionTokens

    // Extrair tool calls do Gemini
    const functionCalls = parts.filter((p: any) => p.functionCall)
    const toolCalls = functionCalls.length > 0
      ? functionCalls.map((p: any, i: number) => ({
          id: `gemini_call_${i}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        }))
      : undefined

    return {
      content: text,
      tokensUsed,
      promptTokens,
      completionTokens,
      model,
      latencyMs,
      toolCalls,
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
      )
      if (!response.ok) return KNOWN_MODELS.GOOGLE
      const data = await response.json() as any
      const chatModels = (data.models || [])
        .filter((m: any) => {
          const name = m.name as string
          return name.includes('gemini') &&
            !name.includes('embedding') &&
            !name.includes('aqa') &&
            (m.supportedGenerationMethods || []).includes('generateContent')
        })
        .map((m: any) => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name.replace('models/', ''),
          context: m.inputTokenLimit ? `${Math.round(m.inputTokenLimit / 1000)}K` : undefined,
        }))
        .sort((a: any, b: any) => b.id.localeCompare(a.id))
      return chatModels.length > 0 ? chatModels : KNOWN_MODELS.GOOGLE
    } catch {
      return KNOWN_MODELS.GOOGLE
    }
  }
}
