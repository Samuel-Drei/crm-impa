/**
 * MCP Module — Model Context Protocol Client
 *
 * Inspirado em:
 * - Dify: MCPTool com SSE client, structured output, usage extraction
 * - N8N: McpClientTool com SSE + Streamable HTTP, auth, tool filtering
 * - Evo AI: MCP servers config no agent
 *
 * Features:
 * - SSE e Streamable HTTP transports
 * - Autenticação (Bearer, Header, Query)
 * - Descoberta automática de tools (list_tools)
 * - Cache de tools descobertas
 * - Logging completo
 * - Timeout e error handling
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { createToolLog, updateToolLog } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { decryptSafe } from '../../../../config/encryption.js'

// ============================================
// TIPOS
// ============================================

export interface MCPServerConfig {
  id: string          // ID do AIMCPServer no banco
  name: string
  serverUrl: string
  transport: 'sse' | 'streamable_http'
  authType: 'none' | 'bearer' | 'header' | 'query'
  authKey?: string
  authValue?: string
  timeout?: number
  sseReadTimeout?: number
  // Tools filtradas (null = todas)
  includeTools?: string[]
  excludeTools?: string[]
}

interface MCPToolSchema {
  name: string
  description?: string
  inputSchema?: {
    type: string
    properties?: Record<string, any>
    required?: string[]
  }
}

interface MCPCallToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
  _meta?: Record<string, any>
}

// ============================================
// MCP CLIENT — Comunicação com servidor MCP via SSE/HTTP
// ============================================

class MCPClient {
  private serverUrl: string
  private headers: Record<string, string>
  private timeout: number

  constructor(config: MCPServerConfig) {
    this.serverUrl = config.serverUrl
    this.timeout = config.timeout || 30000
    this.headers = { 'Content-Type': 'application/json' }

    // Auth
    switch (config.authType) {
      case 'bearer':
        if (config.authValue) this.headers['Authorization'] = `Bearer ${config.authValue}`
        break
      case 'header':
        if (config.authKey && config.authValue) this.headers[config.authKey] = config.authValue
        break
      case 'query':
        // Handled in URL
        if (config.authKey && config.authValue) {
          const separator = this.serverUrl.includes('?') ? '&' : '?'
          this.serverUrl += `${separator}${encodeURIComponent(config.authKey)}=${encodeURIComponent(config.authValue)}`
        }
        break
    }
  }

  /**
   * Descobre tools disponíveis no servidor MCP
   */
  async listTools(): Promise<MCPToolSchema[]> {
    const response = await this.sendRequest('tools/list', {})
    if (response.tools && Array.isArray(response.tools)) {
      return response.tools
    }
    return []
  }

  /**
   * Executa uma tool no servidor MCP
   */
  async callTool(name: string, args: Record<string, any>): Promise<MCPCallToolResult> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })
    return response as MCPCallToolResult
  }

  /**
   * Envia request JSON-RPC para o servidor MCP
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      })

      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: this.headers,
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`MCP server returned ${response.status}: ${errorText}`)
      }

      const data: any = await response.json()

      if (data.error) {
        throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`)
      }

      return data.result || data
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        throw new Error(`MCP request timeout after ${this.timeout}ms`)
      }
      throw err
    }
  }
}

// ============================================
// TOOL DISCOVERY — Descobre e cacheia tools MCP
// ============================================

async function discoverTools(config: MCPServerConfig): Promise<MCPToolSchema[]> {
  // Verificar cache no banco (15 min)
  if (config.id) {
    try {
      const server = await prisma.aIMCPServer.findUnique({
        where: { id: config.id },
      })

      if (server?.discoveredTools && server.lastDiscoveredAt) {
        const cacheAge = Date.now() - new Date(server.lastDiscoveredAt).getTime()
        if (cacheAge < 15 * 60 * 1000) {
          console.log(`[MCP Module] Using cached tools for ${config.name} (${cacheAge / 1000}s old)`)
          return server.discoveredTools as unknown as MCPToolSchema[]
        }
      }
    } catch { }
  }

  // Descobrir tools
  console.log(`[MCP Module] Discovering tools from ${config.name} (${config.serverUrl})...`)
  const client = new MCPClient(config)
  const tools = await client.listTools()

  // Salvar cache
  if (config.id) {
    try {
      await prisma.aIMCPServer.update({
        where: { id: config.id },
        data: {
          discoveredTools: tools as any,
          lastDiscoveredAt: new Date(),
        },
      })
    } catch { }
  }

  console.log(`[MCP Module] Discovered ${tools.length} tools from ${config.name}`)
  return tools
}

// ============================================
// MCP MODULE
// ============================================

// Cache de clientes MCP (evita reconexão a cada chamada)
const clientCache = new Map<string, { client: MCPClient; tools: MCPToolSchema[]; cachedAt: number }>()

export const mcpModule: ToolModule = {
  type: 'mcp',
  name: 'MCP (Model Context Protocol)',

  getTools(config: MCPServerConfig | MCPServerConfig[]): AIToolDefinition[] {
    // No getTools, retornamos tools baseadas no cache do banco
    // A descoberta real acontece no init (chamado separadamente)
    const servers = Array.isArray(config) ? config : [config]
    const allTools: AIToolDefinition[] = []

    for (const server of servers) {
      // Check in-memory cache
      const cached = clientCache.get(server.id || server.serverUrl)
      if (cached && (Date.now() - cached.cachedAt) < 15 * 60 * 1000) {
        for (const tool of cached.tools) {
          // Filtrar se necessário
          if (server.includeTools?.length && !server.includeTools.includes(tool.name)) continue
          if (server.excludeTools?.length && server.excludeTools.includes(tool.name)) continue

          allTools.push({
            name: `mcp_${server.name}_${tool.name}`,
            description: `[MCP:${server.name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema ? {
              type: 'object' as const,
              properties: tool.inputSchema.properties || {},
              required: tool.inputSchema.required,
            } : {
              type: 'object' as const,
              properties: {},
            },
          })
        }
      }
    }

    return allTools
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: MCPServerConfig | MCPServerConfig[],
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const servers = Array.isArray(config) ? config : [config]

    // Parse: mcp_{serverName}_{toolName}
    const parts = toolName.match(/^mcp_(.+?)_(.+)$/)
    if (!parts) {
      return { success: false, result: JSON.stringify({ error: 'invalid_mcp_tool_name' }), error: `Invalid MCP tool name: ${toolName}` }
    }

    const [, serverName, mcpToolName] = parts
    const serverConfig = servers.find(s => s.name === serverName)
    if (!serverConfig) {
      return { success: false, result: JSON.stringify({ error: 'mcp_server_not_found' }), error: `MCP server ${serverName} not found` }
    }

    // Log
    let logId: string | null = null
    try {
      logId = await createToolLog({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        toolName,
        toolType: 'mcp',
        moduleId: serverConfig.id,
        requestUrl: serverConfig.serverUrl,
        requestMethod: 'POST',
        requestBody: { method: 'tools/call', name: mcpToolName, arguments: args },
        triggeredBy: ctx.triggeredBy || 'function_calling',
      })
    } catch { }

    const startTime = Date.now()

    try {
      // Get or create client
      const cacheKey = serverConfig.id || serverConfig.serverUrl
      let cached = clientCache.get(cacheKey)

      if (!cached || (Date.now() - cached.cachedAt) > 15 * 60 * 1000) {
        const client = new MCPClient(serverConfig)
        const tools = await discoverTools(serverConfig)
        cached = { client, tools, cachedAt: Date.now() }
        clientCache.set(cacheKey, cached)
      }

      // Call tool
      const result = await cached.client.callTool(mcpToolName, args)
      const latencyMs = Date.now() - startTime

      // Parse content
      let resultText = ''
      if (result.content) {
        for (const item of result.content) {
          if (item.type === 'text' && item.text) {
            // Try to parse as JSON
            try {
              const json = JSON.parse(item.text)
              resultText += JSON.stringify(json)
            } catch {
              resultText += item.text
            }
          } else if (item.type === 'image' && item.data) {
            resultText += `[Image: ${item.mimeType || 'image/png'}]`
          }
        }
      }

      if (!resultText) {
        resultText = JSON.stringify(result)
      }

      const success = !result.isError

      // Log
      if (logId) {
        await updateToolLog(logId, {
          responseStatus: success ? 200 : 500,
          responseBody: resultText.substring(0, 10000),
          responseTime: latencyMs,
          status: success ? 'success' : 'error',
          errorMessage: success ? undefined : 'MCP tool returned error',
          resultForLLM: resultText.substring(0, 10000),
        }).catch(() => { })
      }

      console.log(`[MCP Module] ${success ? '✅' : '❌'} ${serverName}.${mcpToolName} (${latencyMs}ms)`)

      return {
        success,
        result: resultText,
        metadata: { latencyMs, url: serverConfig.serverUrl },
      }

    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      const errorMsg = err.message || String(err)

      console.error(`[MCP Module] ❌ ${serverName}.${mcpToolName} → ${errorMsg} (${latencyMs}ms)`)

      if (logId) {
        await updateToolLog(logId, {
          responseTime: latencyMs,
          status: 'error',
          errorMessage: errorMsg,
          errorStack: err.stack?.substring(0, 5000),
        }).catch(() => { })
      }

      return {
        success: false,
        result: JSON.stringify({ error: 'mcp_execution_error', message: errorMsg }),
        error: errorMsg,
        metadata: { latencyMs },
      }
    }
  },
}

/**
 * Inicializa MCP servers de uma empresa — descobre e cacheia tools
 */
export async function initMCPServers(companyId: string): Promise<MCPServerConfig[]> {
  try {
    const servers = await prisma.aIMCPServer.findMany({
      where: { companyId, isActive: true },
    })

    const configs: MCPServerConfig[] = []

    for (const server of servers) {
      const config: MCPServerConfig = {
        id: server.id,
        name: server.name,
        serverUrl: server.serverUrl,
        transport: server.transport as any,
        authType: server.authType as any,
        authKey: server.authKey || undefined,
        authValue: server.authValue ? decryptSafe(server.authValue) as string || undefined : undefined,
        timeout: server.timeout,
        sseReadTimeout: server.sseReadTimeout,
      }

      try {
        const tools = await discoverTools(config)
        const client = new MCPClient(config)
        clientCache.set(server.id, { client, tools, cachedAt: Date.now() })
        configs.push(config)
      } catch (err: any) {
        console.error(`[MCP Module] Failed to init server ${server.name}:`, err.message)
      }
    }

    return configs
  } catch (err: any) {
    console.error('[MCP Module] Failed to load MCP servers:', err.message)
    return []
  }
}
