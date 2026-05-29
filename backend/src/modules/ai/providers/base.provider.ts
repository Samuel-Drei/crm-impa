export interface AIMessageImageData {
  base64: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  /** Imagem opcional para visão (vision). Suportado por OpenAI, Claude, Gemini e compatíveis. */
  imageData?: AIMessageImageData
}

// Definição de Tool para Function Calling (padrão OpenAI/evo-ai)
export interface AIToolParameter {
  type: string
  description?: string
  required?: boolean | string[]
  enum?: string[]
  items?: AIToolParameter
  properties?: Record<string, AIToolParameter>
  minimum?: number
  maximum?: number
  [key: string]: unknown
}

export interface AIToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, AIToolParameter>
    required?: string[]
  }
}

export interface AIToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface AICompletionOptions {
  model: string
  messages: AIMessage[]
  maxTokens?: number
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  systemPrompt?: string
  tools?: AIToolDefinition[]
  // 'auto' (padrão), 'none', 'required' (forçar uso de alguma tool), ou {name: 'xxx'} (forçar tool específica)
  toolChoice?: 'auto' | 'none' | 'required' | { name: string }
}

export interface AICompletionResult {
  content: string
  tokensUsed: number
  promptTokens: number       // Tokens de input
  completionTokens: number   // Tokens de output
  model: string
  latencyMs: number
  toolCalls?: AIToolCall[]
}

export interface AIModelInfo {
  id: string
  name: string
  context?: string
  owned_by?: string
}

export interface IAIProvider {
  name: string
  chat(options: AICompletionOptions): Promise<AICompletionResult>
  /** Optional: stream tokens via async generator. Falls back to chat() if not implemented. */
  chatStream?(options: AICompletionOptions, onToken: (token: string) => void): Promise<AICompletionResult>
  isAvailable(): boolean
  listModels(): Promise<AIModelInfo[]>
}
