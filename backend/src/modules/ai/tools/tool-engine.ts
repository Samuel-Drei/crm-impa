/**
 * Tool Engine — Motor de execução de ferramentas (inspirado no Dify ToolEngine)
 *
 * Princípios:
 * - Modular: cada tipo de tool é um módulo independente
 * - Logável: toda execução é registrada no AIToolLog
 * - Resiliente: retry, timeout, fallback, circuit breaker
 * - Extensível: novos módulos (cal.com, google, etc.) só registram no registry
 *
 * Architecture:
 * ┌──────────────────────────────────────────────┐
 * │               Tool Engine                     │
 * │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
 * │  │  HTTP   │ │   CRM    │ │     MCP      │  │
 * │  │ Module  │ │  Module  │ │   Module     │  │
 * │  └─────────┘ └──────────┘ └──────────────┘  │
 * │         ↓           ↓            ↓           │
 * │  ┌──────────────────────────────────────┐    │
 * │  │        Tool Log System               │    │
 * │  └──────────────────────────────────────┘    │
 * └──────────────────────────────────────────────┘
 */

import { prisma } from '../../../config/database.js'
import { redis } from '../../../config/redis.js'
import type { AIToolDefinition } from '../providers/base.provider.js'

// ============================================
// TIPOS BASE
// ============================================

export interface ToolExecutionContext {
  sessionId?: string
  agentId: string
  agentName?: string
  companyId: string
  instanceId: string
  remoteJid: string
  triggeredBy?: 'function_calling' | 'workflow' | 'manual'
  /** Configuração de sandbox do CRM (vinda do ai_agents.crmToolsConfig) */
  crmSandbox?: any
  /** Onda 2.4 — rastreamento de sub-operações de Fleet */
  operationId?: string
  operationDepth?: number
  /** Função para enviar mídia (imagem, vídeo, áudio, documento) via WhatsApp */
  sendMediaFn?: (to: string, mediaType: string, mediaUrl: string, caption?: string, fileName?: string) => Promise<void>
}

export interface ToolExecutionResult {
  success: boolean
  result: string          // JSON string para o LLM
  error?: string
  metadata?: {
    status?: number
    latencyMs?: number
    retryCount?: number
    url?: string
    method?: string
  }
}

export interface ToolModule {
  type: string
  name: string
  getTools(config: any): AIToolDefinition[]
  execute(toolName: string, args: Record<string, any>, config: any, ctx: ToolExecutionContext): Promise<ToolExecutionResult>
  /**
   * TTL de cache Redis por nome de tool. Chave = nome da tool, valor = segundos.
   * Ferramentas listadas aqui terão seu resultado cacheado automaticamente.
   * Se ausente ou vazio, não há cache.
   */
  toolCacheTtl?: Record<string, number>
}

// ============================================
// TOOL REGISTRY — Registro global de módulos
// ============================================

class ToolRegistry {
  private modules = new Map<string, ToolModule>()

  register(module: ToolModule): void {
    this.modules.set(module.type, module)
    console.log(`[ToolEngine] Module registered: ${module.type} (${module.name})`)
  }

  getModule(type: string): ToolModule | undefined {
    return this.modules.get(type)
  }

  getAllModules(): ToolModule[] {
    return Array.from(this.modules.values())
  }

  getModuleTypes(): string[] {
    return Array.from(this.modules.keys())
  }
}

export const toolRegistry = new ToolRegistry()

// ============================================
// TOOL LOG — Registra toda execução
// ============================================

export async function createToolLog(data: {
  sessionId?: string
  agentId: string
  companyId: string
  toolName: string
  toolType: string
  moduleId?: string
  requestMethod?: string
  requestUrl?: string
  requestHeaders?: any
  requestBody?: any
  requestParams?: any
  triggeredBy?: string
  metadata?: any
}): Promise<string> {
  const log = await prisma.aIToolLog.create({
    data: {
      ...data,
      status: 'pending',
      startedAt: new Date(),
    },
  })
  return log.id
}

export async function updateToolLog(logId: string, data: {
  responseStatus?: number
  responseHeaders?: any
  responseBody?: string
  responseTime?: number
  status: 'success' | 'error' | 'timeout' | 'retry'
  errorMessage?: string
  errorStack?: string
  retryCount?: number
  resultForLLM?: string
  completedAt?: Date
}): Promise<void> {
  await prisma.aIToolLog.update({
    where: { id: logId },
    data: {
      ...data,
      completedAt: data.completedAt || new Date(),
    },
  })
}

// ============================================
// TOOL ENGINE — Orquestrador principal
// ============================================

export class ToolEngine {
  /**
   * Constrói tools vindas do config do agente + módulos registrados
   */
  static buildTools(settings: Record<string, any>): {
    tools: AIToolDefinition[]
    toolTypeMap: Map<string, { type: string; config: any }>
  } {
    const allTools: AIToolDefinition[] = []
    const toolTypeMap = new Map<string, { type: string; config: any }>()

    for (const module of toolRegistry.getAllModules()) {
      const moduleConfig = settings[module.type] || settings[`${module.type}_tools`]
      if (!moduleConfig) continue

      try {
        const defs = module.getTools(moduleConfig)
        for (const def of defs) {
          allTools.push(def)
          toolTypeMap.set(def.name, { type: module.type, config: moduleConfig })
        }
      } catch (err: any) {
        console.error(`[ToolEngine] Error building tools for module ${module.type}:`, err.message)
      }
    }

    return { tools: allTools, toolTypeMap }
  }

  /**
   * Executa uma tool com logging completo
   */
  static async execute(
    toolName: string,
    args: Record<string, any>,
    toolTypeMap: Map<string, { type: string; config: any }>,
    ctx: ToolExecutionContext,
    maxRetries: number = 2
  ): Promise<string> {
    const mapping = toolTypeMap.get(toolName)
    if (!mapping) {
      const errorMsg = `Tool not found: ${toolName}`
      console.error(`[ToolEngine] ${errorMsg}`)
      return JSON.stringify({ error: 'tool_not_found', message: errorMsg })
    }

    const module = toolRegistry.getModule(mapping.type)
    if (!module) {
      return JSON.stringify({ error: 'module_not_found', message: `Module ${mapping.type} not registered` })
    }

    // ── REDIS TOOL CACHE ──────────────────────────────────────────────────
    // Se o módulo declara TTL para esta tool, tenta servir do cache primeiro.
    const cacheTtl = module.toolCacheTtl?.[toolName]
    if (cacheTtl && cacheTtl > 0) {
      try {
        const cacheKey = `tool_cache:${ctx.companyId}:${toolName}:${Buffer.from(JSON.stringify(args)).toString('base64').slice(0, 64)}`
        const cached = await redis.get(cacheKey)
        if (cached) {
          console.log(`[ToolEngine] 🔵 CACHE HIT ${toolName} (TTL=${cacheTtl}s)`)
          return cached
        }
        // Executa normalmente e salva no cache (passando cacheKey para uso abaixo)
        ;(ctx as any)._toolCacheKey = cacheKey
        ;(ctx as any)._toolCacheTtl = cacheTtl
      } catch (err: any) {
        console.warn(`[ToolEngine] Redis cache check failed for ${toolName}:`, err.message)
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Criar log
    let logId: string | null = null
    try {
      logId = await createToolLog({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        companyId: ctx.companyId,
        toolName,
        toolType: mapping.type,
        triggeredBy: ctx.triggeredBy || 'function_calling',
        metadata: { args },
      })
    } catch (err: any) {
      console.error(`[ToolEngine] Failed to create log:`, err.message)
    }

    // Executar com retry
    let lastError: string | undefined
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now()
      try {
        if (attempt > 0) {
          console.log(`[ToolEngine] Retry ${attempt}/${maxRetries} for ${toolName}`)
          // Backoff exponencial
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 10000)))
        }

        const result = await module.execute(toolName, args, mapping.config, ctx)
        const latencyMs = Date.now() - startTime

        // Log sucesso
        if (logId) {
          await updateToolLog(logId, {
            responseStatus: result.metadata?.status,
            responseTime: latencyMs,
            status: result.success ? 'success' : 'error',
            errorMessage: result.error,
            resultForLLM: result.result.substring(0, 10000),
            retryCount: attempt,
          }).catch(err => console.error(`[ToolEngine] Log update failed:`, err.message))
        }

        console.log(`[ToolEngine] ✅ ${toolName} (${mapping.type}) executed in ${latencyMs}ms — ${result.success ? 'SUCCESS' : 'ERROR'} ${attempt > 0 ? `(retry ${attempt})` : ''}`)

        if (result.success || attempt >= maxRetries) {
          // Salvar no cache Redis se houver TTL configurado
          if (result.success && (ctx as any)._toolCacheKey && (ctx as any)._toolCacheTtl) {
            try {
              await redis.set((ctx as any)._toolCacheKey, result.result, 'EX', (ctx as any)._toolCacheTtl)
            } catch (cacheErr: any) {
              console.warn(`[ToolEngine] Redis cache write failed for ${toolName}:`, cacheErr.message)
            }
          }
          return result.result
        }

        lastError = result.error

      } catch (err: any) {
        const latencyMs = Date.now() - startTime
        lastError = err.message || String(err)

        console.error(`[ToolEngine] ❌ ${toolName} failed (attempt ${attempt + 1}):`, lastError)

        // Log erro
        if (logId) {
          await updateToolLog(logId, {
            responseTime: latencyMs,
            status: attempt >= maxRetries ? 'error' : 'retry',
            errorMessage: lastError,
            errorStack: err.stack?.substring(0, 5000),
            retryCount: attempt,
          }).catch(() => { })
        }

        if (attempt >= maxRetries) {
          return JSON.stringify({
            error: 'tool_execution_error',
            message: lastError,
            retries: attempt
          })
        }
      }
    }

    return JSON.stringify({ error: 'tool_execution_error', message: lastError || 'Unknown error' })
  }
}
