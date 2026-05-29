/**
 * HTTP Fetch Module — Ferramenta HTTP genérica (URL livre) para o agente
 *
 * Diferença para http-request.module:
 * - http_request requer endpoints PRÉ-configurados (URL fixa, parâmetros declarados)
 * - http_fetch permite que o LLM forneça QUALQUER URL/método em runtime
 *
 * Por ser mais permissiva, é opt-in por membro (config: { enabled: true })
 * e tem SSRF protection rígida.
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { createToolLog, updateToolLog } from '../tool-engine.js'

// ============================================
// CONFIG
// ============================================

export interface HTTPFetchConfig {
  enabled: boolean
  /** Lista de domínios permitidos (whitelist). Se vazio, permite tudo (exceto bloqueio SSRF). */
  allowedDomains?: string[]
  /** Lista de domínios bloqueados (blacklist adicional). */
  blockedDomains?: string[]
  /** Timeout em ms (default 20000) */
  timeout?: number
  /** Tamanho máximo da resposta em bytes (default 1MB) */
  maxResponseSize?: number
}

// ============================================
// SSRF PROTECTION
// ============================================

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal',
  'metadata.azure.com',
])

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^fc00:/,
  /^fe80:/,
  /^127\./,
  /^0\./,
]

function isBlockedUrl(url: string, allowed?: string[], blocked?: string[]): { blocked: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { blocked: true, reason: 'invalid_url' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { blocked: true, reason: 'unsupported_protocol' }
  }

  const hostname = parsed.hostname.toLowerCase()

  if (BLOCKED_HOSTS.has(hostname)) return { blocked: true, reason: 'blocked_host' }
  if (PRIVATE_IP_RANGES.some(r => r.test(hostname))) return { blocked: true, reason: 'private_ip' }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return { blocked: true, reason: 'internal_tld' }

  if (blocked && blocked.length > 0) {
    if (blocked.some(d => hostname === d.toLowerCase() || hostname.endsWith('.' + d.toLowerCase()))) {
      return { blocked: true, reason: 'in_blocklist' }
    }
  }

  if (allowed && allowed.length > 0) {
    const ok = allowed.some(d => hostname === d.toLowerCase() || hostname.endsWith('.' + d.toLowerCase()))
    if (!ok) return { blocked: true, reason: 'not_in_allowlist' }
  }

  return { blocked: false }
}

// ============================================
// TOOL DEFINITION (LLM-facing)
// ============================================

const TOOL_NAME = 'http_fetch'

const TOOL_DEFINITION: AIToolDefinition = {
  name: TOOL_NAME,
  description: 'Faz uma requisição HTTP genérica para qualquer URL pública. Use para consultar APIs, webhooks ou páginas web. Bloqueia acesso a redes internas/privadas. Retorna o status code e o corpo da resposta (truncado se muito grande).',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL completa (http:// ou https://) a ser requisitada.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
        description: 'Método HTTP. Default: GET.',
      },
      headers: {
        type: 'object',
        description: 'Headers HTTP opcionais (ex: { "Authorization": "Bearer xxx", "Accept": "application/json" }).',
      },
      body: {
        type: 'string',
        description: 'Corpo da requisição (string JSON ou texto). Use apenas para POST/PUT/PATCH.',
      },
      query: {
        type: 'object',
        description: 'Query params opcionais (serão acrescentados à URL).',
      },
    },
    required: ['url'],
  },
}

// ============================================
// MODULE
// ============================================

export const httpFetchModule: ToolModule = {
  type: 'http_fetch',
  name: 'HTTP Fetch (genérico)',

  getTools(config: HTTPFetchConfig | boolean | undefined): AIToolDefinition[] {
    const enabled = config === true || (typeof config === 'object' && config?.enabled === true)
    if (!enabled) return []
    return [TOOL_DEFINITION]
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: HTTPFetchConfig | boolean,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (toolName !== TOOL_NAME) {
      return { success: false, result: JSON.stringify({ error: 'tool_not_found' }), error: `Unknown tool ${toolName}` }
    }

    const cfg: HTTPFetchConfig = typeof config === 'object' && config !== null
      ? config
      : { enabled: true }

    const url = String(args.url || '').trim()
    const method = String(args.method || 'GET').toUpperCase()
    const headers = (args.headers && typeof args.headers === 'object') ? args.headers as Record<string, string> : {}
    const body = args.body
    const query = (args.query && typeof args.query === 'object') ? args.query as Record<string, any> : null

    if (!url) {
      return { success: false, result: JSON.stringify({ error: 'missing_url' }), error: 'url is required' }
    }

    // Build URL with query params
    let finalUrl = url
    if (query) {
      try {
        const u = new URL(url)
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
        }
        finalUrl = u.toString()
      } catch {
        return { success: false, result: JSON.stringify({ error: 'invalid_url' }), error: 'invalid url' }
      }
    }

    // SSRF check
    const block = isBlockedUrl(finalUrl, cfg.allowedDomains, cfg.blockedDomains)
    if (block.blocked) {
      return {
        success: false,
        result: JSON.stringify({ error: 'blocked_url', reason: block.reason, message: 'URL não permitida por política de segurança.' }),
        error: `SSRF protection: ${block.reason}`,
      }
    }

    const timeout = cfg.timeout ?? 20000
    const maxSize = cfg.maxResponseSize ?? 1_000_000

    // Log
    let logId: string | null = null
    try {
      logId = await createToolLog({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        toolName: TOOL_NAME,
        toolType: 'http_fetch',
        requestMethod: method,
        requestUrl: finalUrl,
        requestHeaders: headers,
        requestBody: body,
        triggeredBy: ctx.triggeredBy || 'function_calling',
      })
    } catch { /* non-fatal */ }

    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const init: RequestInit = {
        method,
        headers: { 'User-Agent': 'IMPA-CRM-Fleet/1.0', ...headers },
        signal: controller.signal,
      }

      if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
        if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
          (init.headers as Record<string, string>)['Content-Type'] =
            typeof body === 'string' ? 'text/plain' : 'application/json'
        }
      }

      const response = await fetch(finalUrl, init)
      const status = response.status
      const respHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => { respHeaders[k] = v })

      // Read with size cap
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      let truncated = false
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            received += value.byteLength
            if (received > maxSize) { truncated = true; break }
            chunks.push(value)
          }
        }
        try { await reader.cancel() } catch { /* ok */ }
      }
      const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)))
      const contentType = (respHeaders['content-type'] || '').toLowerCase()

      let parsedBody: any
      const text = buffer.toString('utf-8')
      if (contentType.includes('application/json')) {
        try { parsedBody = JSON.parse(text) } catch { parsedBody = text }
      } else {
        parsedBody = text
      }

      const durationMs = Date.now() - start
      const result = JSON.stringify({
        status,
        ok: response.ok,
        headers: respHeaders,
        body: parsedBody,
        truncated,
        durationMs,
      })

      if (logId) {
        try {
          await updateToolLog(logId, {
            status: response.ok ? 'success' : 'error',
            responseStatus: status,
            responseBody: typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody),
            responseTime: durationMs,
            resultForLLM: result,
          })
        } catch { /* ok */ }
      }

      return { success: response.ok, result, error: response.ok ? undefined : `HTTP ${status}` }
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
      const errorMsg = isAbort ? `Timeout após ${timeout}ms` : (err?.message || String(err))
      const result = JSON.stringify({ error: 'request_failed', message: errorMsg })

      if (logId) {
        try {
          await updateToolLog(logId, {
            status: isAbort ? 'timeout' : 'error',
            errorMessage: errorMsg,
            responseTime: Date.now() - start,
            resultForLLM: result,
          })
        } catch { /* ok */ }
      }

      return { success: false, result, error: errorMsg }
    } finally {
      clearTimeout(timer)
    }
  },
}
