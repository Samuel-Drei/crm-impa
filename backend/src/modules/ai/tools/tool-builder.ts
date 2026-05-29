/**
 * Tool Builder - Sistema de Tools para Function Calling
 * Inspirado no CustomToolBuilder do evo-ai
 * 
 * Suporta:
 * - HTTP Tools (chamadas a APIs externas)
 * - CRM Tools (ações nativas do CRM)
 */

import { AIToolDefinition } from '../providers/base.provider.js'

// ============================================
// TIPOS - Configuração de HTTP Tools (igual evo-ai)
// ============================================

export interface HTTPToolConfig {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  headers?: Record<string, string>
  parameters?: {
    path_params?: Record<string, string>
    query_params?: Record<string, string | string[]>
    body_params?: Record<string, {
      type: string
      required: boolean
      description: string
    }>
  }
  values?: Record<string, string>  // Valores padrão
  error_handling?: {
    timeout?: number
    retry_count?: number
    fallback_response?: Record<string, string>
  }
}

export interface AgentToolsConfig {
  http_tools?: HTTPToolConfig[]
  crm_tools?: string[]  // nomes das CRM tools habilitadas
  sub_agents?: string[]  // IDs de sub-agentes
}

// ============================================
// HTTP TOOL EXECUTOR - Executa chamadas HTTP
// ============================================

export async function executeHttpTool(
  config: HTTPToolConfig,
  args: Record<string, any>
): Promise<string> {
  const allValues = { ...config.values, ...args }
  const timeout = config.error_handling?.timeout || 30000

  try {
    // Processar URL com path params
    let url = config.endpoint
    if (config.parameters?.path_params) {
      for (const [param] of Object.entries(config.parameters.path_params)) {
        if (allValues[param] != null) {
          url = url.replace(`{${param}}`, encodeURIComponent(String(allValues[param])))
        }
      }
    }

    // Processar query params
    const queryParams = new URLSearchParams()
    if (config.parameters?.query_params) {
      for (const [param, defaultVal] of Object.entries(config.parameters.query_params)) {
        const val = allValues[param] ?? defaultVal
        if (val != null) {
          queryParams.set(param, Array.isArray(val) ? val.join(',') : String(val))
        }
      }
    }
    const queryString = queryParams.toString()
    if (queryString) url += `?${queryString}`

    // Processar headers com substituição de variáveis
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.headers) {
      for (const [k, v] of Object.entries(config.headers)) {
        let headerVal = v
        for (const [varName, varVal] of Object.entries(allValues)) {
          headerVal = headerVal.replace(`{${varName}}`, String(varVal))
        }
        headers[k] = headerVal
      }
    }

    // Processar body
    let body: string | undefined
    if (['POST', 'PUT', 'PATCH'].includes(config.method) && config.parameters?.body_params) {
      const bodyData: Record<string, any> = {}
      for (const [param] of Object.entries(config.parameters.body_params)) {
        if (allValues[param] != null) bodyData[param] = allValues[param]
      }
      // Adicionar valores padrão que não estão em query/path
      if (config.values) {
        for (const [param, val] of Object.entries(config.values)) {
          if (!(param in bodyData) && !config.parameters?.path_params?.[param] && !config.parameters?.query_params?.[param]) {
            bodyData[param] = val
          }
        }
      }
      body = JSON.stringify(bodyData)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: config.method,
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return JSON.stringify({
        error: `HTTP ${response.status}`,
        message: await response.text().catch(() => 'Failed to read response'),
      })
    }

    const text = await response.text()
    try {
      return JSON.stringify(JSON.parse(text))
    } catch {
      return JSON.stringify({ content: text })
    }
  } catch (err: any) {
    if (config.error_handling?.fallback_response) {
      return JSON.stringify(config.error_handling.fallback_response)
    }
    return JSON.stringify({ error: 'tool_execution_error', message: err.message })
  }
}

// ============================================
// HTTP TOOLS → AIToolDefinition converter
// ============================================

export function buildHttpToolDefinitions(httpTools: HTTPToolConfig[]): AIToolDefinition[] {
  return httpTools.map(tool => {
    const properties: Record<string, any> = {}
    const required: string[] = []

    // Path params
    if (tool.parameters?.path_params) {
      for (const [param, desc] of Object.entries(tool.parameters.path_params)) {
        properties[param] = { type: 'string', description: desc }
        required.push(param)
      }
    }

    // Query params
    if (tool.parameters?.query_params) {
      for (const [param, defaultVal] of Object.entries(tool.parameters.query_params)) {
        properties[param] = {
          type: 'string',
          description: `Query parameter: ${param} (default: ${Array.isArray(defaultVal) ? defaultVal.join(',') : defaultVal})`,
        }
      }
    }

    // Body params
    if (tool.parameters?.body_params) {
      for (const [param, config] of Object.entries(tool.parameters.body_params)) {
        properties[param] = { type: config.type, description: config.description }
        if (config.required) required.push(param)
      }
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
}
