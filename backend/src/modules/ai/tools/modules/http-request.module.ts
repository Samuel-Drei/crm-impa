/**
 * HTTP Request Module — Módulo de requisições HTTP para ferramentas de IA
 * 
 * Inspirado em:
 * - Dify: ApiTool com assembling_request, auth types, response parsing
 * - N8N: HttpRequestV3 com pagination, auth, response optimization
 * - Evo AI: CustomToolBuilder com path/query/body params, error_handling
 *
 * Features:
 * - 6 tipos de autenticação (None, Bearer, API Key Header, API Key Query, Basic, Custom Header)
 * - Path, Query, Body, Header parameters
 * - Retry com backoff exponencial
 * - Timeout configurável
 * - SSRF protection (bloqueia localhost, IPs privados)
 * - Response optimization (JSON extract, HTML to text, truncate)
 * - Logging completo de request/response
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { createToolLog, updateToolLog } from '../tool-engine.js'

// ============================================
// TIPOS
// ============================================

export interface HTTPToolAuth {
  type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header'
  token?: string           // Para bearer
  apiKey?: string          // Para api_key_*
  apiKeyName?: string      // Nome do header/query param (default: Authorization/key)
  apiKeyPrefix?: string    // Prefixo (Bearer, Basic, custom)
  username?: string        // Para basic auth
  password?: string        // Para basic auth
  headerName?: string      // Para custom_header
  headerValue?: string     // Para custom_header
}

export interface HTTPToolParameter {
  name: string
  in: 'path' | 'query' | 'body' | 'header'
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required: boolean
  default?: any
  enum?: string[]    // Valores possíveis
}

export interface HTTPToolResponseConfig {
  type: 'auto' | 'json' | 'text' | 'html_to_text'
  extractField?: string        // ex: "data.results" — extrai campo específico do JSON
  maxLength?: number           // Truncar resposta (default: 10000 chars)
  includeStatusCode?: boolean  // Incluir status code no resultado
  includeHeaders?: boolean     // Incluir headers no resultado
}

export interface HTTPToolConfig {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  url: string

  // Autenticação
  auth?: HTTPToolAuth

  // Parâmetros que o LLM pode preencher
  parameters?: HTTPToolParameter[]

  // Headers fixos (não preenchidos pelo LLM)
  headers?: Record<string, string>

  // Valores padrão para parâmetros
  defaults?: Record<string, any>

  // Configuração de resposta
  response?: HTTPToolResponseConfig

  // Resiliência
  timeout?: number       // ms (default: 30000)
  retryCount?: number    // retries extras (default: 0, o engine gerencia retries)
  retryOn?: number[]     // Status codes para retry (default: [429, 500, 502, 503, 504])

  // Fallback
  fallbackResponse?: any // Resposta quando falha completamente
}

// ============================================
// SSRF PROTECTION
// ============================================

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal',
]

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^fc00:/,
  /^fe80:/,
]

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    if (BLOCKED_HOSTS.includes(hostname)) return true
    if (PRIVATE_IP_RANGES.some(r => r.test(hostname))) return true
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true

    return false
  } catch {
    return true // URL inválida = bloqueada
  }
}

// ============================================
// AUTH BUILDER
// ============================================

function buildAuthHeaders(auth: HTTPToolAuth): { headers: Record<string, string>; queryParams: Record<string, string> } {
  const headers: Record<string, string> = {}
  const queryParams: Record<string, string> = {}

  switch (auth.type) {
    case 'bearer':
      if (auth.token) {
        headers['Authorization'] = `Bearer ${auth.token}`
      }
      break

    case 'api_key_header':
      if (auth.apiKey) {
        const headerName = auth.apiKeyName || 'Authorization'
        const prefix = auth.apiKeyPrefix ? `${auth.apiKeyPrefix} ` : ''
        headers[headerName] = `${prefix}${auth.apiKey}`
      }
      break

    case 'api_key_query':
      if (auth.apiKey) {
        const paramName = auth.apiKeyName || 'key'
        queryParams[paramName] = auth.apiKey
      }
      break

    case 'basic':
      if (auth.username) {
        const encoded = Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')
        headers['Authorization'] = `Basic ${encoded}`
      }
      break

    case 'custom_header':
      if (auth.headerName && auth.headerValue) {
        headers[auth.headerName] = auth.headerValue
      }
      break
  }

  return { headers, queryParams }
}

// ============================================
// REQUEST BUILDER
// ============================================

function buildRequest(config: HTTPToolConfig, args: Record<string, any>): {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  logData: { requestUrl: string; requestMethod: string; requestHeaders: any; requestBody: any; requestParams: any }
} {
  const allValues = { ...config.defaults, ...args }

  // URL com path params
  let url = config.url
  const parameters = config.parameters || []

  for (const param of parameters.filter(p => p.in === 'path')) {
    const val = allValues[param.name]
    if (val != null) {
      url = url.replace(`{${param.name}}`, encodeURIComponent(String(val)))
    }
  }

  // Headers base
  const headers: Record<string, string> = {}

  // Auth
  const authQueryParams: Record<string, string> = {}
  if (config.auth && config.auth.type !== 'none') {
    const auth = buildAuthHeaders(config.auth)
    Object.assign(headers, auth.headers)
    Object.assign(authQueryParams, auth.queryParams)
  }

  // Headers fixos (template com variáveis)
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      let val = v
      for (const [varName, varVal] of Object.entries(allValues)) {
        if (typeof val === 'string') {
          val = val.replace(`{${varName}}`, String(varVal))
        }
      }
      headers[k] = val
    }
  }

  // Header params do LLM
  for (const param of parameters.filter(p => p.in === 'header')) {
    const val = allValues[param.name]
    if (val != null) {
      headers[param.name] = String(val)
    }
  }

  // Query params
  const queryParams = new URLSearchParams()
  // Auth query params primeiro
  for (const [k, v] of Object.entries(authQueryParams)) {
    queryParams.set(k, v)
  }
  // LLM query params
  for (const param of parameters.filter(p => p.in === 'query')) {
    const val = allValues[param.name] ?? param.default
    if (val != null) {
      queryParams.set(param.name, String(val))
    }
  }
  const qs = queryParams.toString()
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  // Body
  let body: string | undefined
  if (['POST', 'PUT', 'PATCH'].includes(config.method)) {
    const bodyParams = parameters.filter(p => p.in === 'body')
    if (bodyParams.length > 0) {
      const bodyData: Record<string, any> = {}
      for (const param of bodyParams) {
        const val = allValues[param.name]
        if (val !== undefined) {
          bodyData[param.name] = convertType(val, param.type)
        } else if (param.default !== undefined) {
          bodyData[param.name] = param.default
        }
      }
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
      body = JSON.stringify(bodyData)
    }
  }

  // Sanitize headers for logging (mask auth)
  const safeHeaders = { ...headers }
  if (safeHeaders['Authorization']) {
    const val = safeHeaders['Authorization']
    safeHeaders['Authorization'] = val.substring(0, 15) + '...' + val.substring(val.length - 4)
  }

  return {
    url,
    method: config.method,
    headers,
    body,
    logData: {
      requestUrl: url,
      requestMethod: config.method,
      requestHeaders: safeHeaders,
      requestBody: body ? JSON.parse(body) : null,
      requestParams: Object.fromEntries(queryParams),
    },
  }
}

// ============================================
// RESPONSE PARSER
// ============================================

function parseResponse(
  responseText: string,
  statusCode: number,
  responseHeaders: Record<string, string>,
  config: HTTPToolResponseConfig | undefined
): string {
  const maxLen = config?.maxLength || 10000
  const responseType = config?.type || 'auto'

  let result: any = {}

  // Incluir metadata se pedido
  if (config?.includeStatusCode) {
    result._statusCode = statusCode
  }
  if (config?.includeHeaders) {
    result._headers = responseHeaders
  }

  // Parse conteúdo
  if (responseType === 'text' || responseType === 'html_to_text') {
    // Limpar HTML se for html_to_text
    let text = responseText
    if (responseType === 'html_to_text') {
      text = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    result.content = text.substring(0, maxLen)
  } else {
    // auto ou json — tenta JSON primeiro
    try {
      let parsed = JSON.parse(responseText)

      // Extrair campo específico
      if (config?.extractField) {
        const fields = config.extractField.split('.')
        for (const field of fields) {
          if (parsed && typeof parsed === 'object') {
            parsed = parsed[field]
          }
        }
      }

      if (typeof parsed === 'object') {
        result = { ...result, ...parsed }
      } else {
        result.content = String(parsed)
      }
    } catch {
      // Não é JSON, tratar como texto
      result.content = responseText.substring(0, maxLen)
    }
  }

  const jsonStr = JSON.stringify(result)
  return jsonStr.length > maxLen ? jsonStr.substring(0, maxLen) : jsonStr
}

// ============================================
// TYPE CONVERTER
// ============================================

function convertType(value: any, type: string): any {
  switch (type) {
    case 'number': return Number(value)
    case 'boolean': return value === true || value === 'true' || value === '1'
    case 'object':
    case 'array':
      if (typeof value === 'string') {
        try { return JSON.parse(value) } catch { return value }
      }
      return value
    default: return String(value)
  }
}

// ============================================
// HTTP REQUEST MODULE
// ============================================

export const httpRequestModule: ToolModule = {
  type: 'http_request',
  name: 'HTTP Request',

  getTools(config: HTTPToolConfig | HTTPToolConfig[]): AIToolDefinition[] {
    const tools = Array.isArray(config) ? config : [config]

    return tools.map(tool => {
      const properties: Record<string, any> = {}
      const required: string[] = []

      for (const param of (tool.parameters || [])) {
        const prop: any = {
          type: param.type === 'object' ? 'object' : param.type === 'array' ? 'array' : param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string',
          description: param.description,
        }
        if (param.enum) {
          prop.enum = param.enum
        }
        if (param.default !== undefined) {
          prop.default = param.default
        }
        properties[param.name] = prop
        if (param.required) required.push(param.name)
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties,
          required: required.length > 0 ? required : undefined,
        },
      }
    })
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: HTTPToolConfig | HTTPToolConfig[],
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tools = Array.isArray(config) ? config : [config]
    const toolConfig = tools.find(t => t.name === toolName)

    if (!toolConfig) {
      return { success: false, result: JSON.stringify({ error: 'tool_not_found' }), error: `HTTP tool ${toolName} not found` }
    }

    // SSRF protection
    if (isBlockedUrl(toolConfig.url)) {
      return {
        success: false,
        result: JSON.stringify({ error: 'blocked_url', message: 'URL not allowed for security reasons' }),
        error: 'SSRF protection: URL blocked'
      }
    }

    const timeout = toolConfig.timeout || 30000
    const retryOn = toolConfig.retryOn || [429, 500, 502, 503, 504]
    const maxRetries = toolConfig.retryCount || 0

    // Build request
    const { url, method, headers, body, logData } = buildRequest(toolConfig, args)

    // Create detailed log
    let logId: string | null = null
    try {
      logId = await createToolLog({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        toolName,
        toolType: 'http_request',
        requestMethod: method,
        requestUrl: url,
        requestHeaders: logData.requestHeaders,
        requestBody: logData.requestBody,
        requestParams: logData.requestParams,
        triggeredBy: ctx.triggeredBy || 'function_calling',
      })
    } catch (err: any) {
      console.error(`[HTTP Module] Failed to create log:`, err.message)
    }

    // Execute with retry
    let lastError = ''
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now()

      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          console.log(`[HTTP Module] Retry ${attempt}/${maxRetries} for ${toolName} after ${delay}ms`)
          await new Promise(r => setTimeout(r, delay))
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        const latencyMs = Date.now() - startTime

        // Get response
        const responseText = await response.text()
        const responseHeaders: Record<string, string> = {}
        response.headers.forEach((v, k) => { responseHeaders[k] = v })

        // Check if should retry
        if (!response.ok && retryOn.includes(response.status) && attempt < maxRetries) {
          lastError = `HTTP ${response.status}: ${responseText.substring(0, 200)}`
          console.log(`[HTTP Module] ${toolName} returned ${response.status}, will retry`)

          if (logId) {
            await updateToolLog(logId, {
              responseStatus: response.status,
              responseBody: responseText.substring(0, 5000),
              responseTime: latencyMs,
              status: 'retry',
              errorMessage: lastError,
              retryCount: attempt,
            }).catch(() => { })
          }
          continue
        }

        // Parse response
        const parsedResult = parseResponse(responseText, response.status, responseHeaders, toolConfig.response)

        // Log success/error
        if (logId) {
          await updateToolLog(logId, {
            responseStatus: response.status,
            responseHeaders,
            responseBody: responseText.substring(0, 10000),
            responseTime: latencyMs,
            status: response.ok ? 'success' : 'error',
            errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
            resultForLLM: parsedResult.substring(0, 10000),
            retryCount: attempt,
          }).catch(() => { })
        }

        console.log(`[HTTP Module] ${response.ok ? '✅' : '⚠️'} ${toolName} ${method} ${url.substring(0, 80)} → ${response.status} (${latencyMs}ms)`)

        return {
          success: response.ok,
          result: parsedResult,
          error: response.ok ? undefined : `HTTP ${response.status}`,
          metadata: {
            status: response.status,
            latencyMs,
            retryCount: attempt,
            url,
            method,
          },
        }

      } catch (err: any) {
        const latencyMs = Date.now() - startTime
        const isTimeout = err.name === 'AbortError'
        lastError = isTimeout ? `Timeout after ${timeout}ms` : (err.message || String(err))

        console.error(`[HTTP Module] ❌ ${toolName} ${method} ${url.substring(0, 80)} → ${lastError} (${latencyMs}ms)`)

        if (logId) {
          await updateToolLog(logId, {
            responseTime: latencyMs,
            status: isTimeout ? 'timeout' : (attempt < maxRetries ? 'retry' : 'error'),
            errorMessage: lastError,
            errorStack: err.stack?.substring(0, 5000),
            retryCount: attempt,
          }).catch(() => { })
        }

        if (attempt >= maxRetries) {
          // Use fallback if configured
          if (toolConfig.fallbackResponse) {
            return {
              success: true,
              result: JSON.stringify(toolConfig.fallbackResponse),
              metadata: { latencyMs, retryCount: attempt },
            }
          }

          return {
            success: false,
            result: JSON.stringify({ error: isTimeout ? 'timeout' : 'request_failed', message: lastError }),
            error: lastError,
            metadata: { latencyMs, retryCount: attempt, url, method },
          }
        }
      }
    }

    return {
      success: false,
      result: JSON.stringify({ error: 'max_retries_exceeded', message: lastError }),
      error: lastError,
    }
  },
}
