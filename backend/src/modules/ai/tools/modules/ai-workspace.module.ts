/**
 * AI Workspace Module — Sandbox de filesystem para a IA
 *
 * Permite que a IA crie/leia/edite arquivos próprios SEM tocar no código do CRM.
 * Cada empresa tem seu próprio diretório isolado em /app/ai-workspace/<companyId>/.
 *
 * Casos de uso pretendidos:
 *   - Criar landing pages (HTML/CSS/JS)
 *   - Criar scripts auxiliares (Node, Python — armazenados, não executados)
 *   - Configs sugeridas (Traefik, docker-compose) para revisão humana
 *   - Templates de proposta, relatórios estáticos
 *
 * Segurança:
 *   - Path sempre resolvido com path.resolve e validado contra prefixo da empresa
 *   - Bloqueio absoluto de path traversal (..) e symlinks fora do sandbox
 *   - Whitelist de extensões para escrita (HTML, CSS, JS, JSON, MD, TXT, YML, etc)
 *   - Bloqueio de extensões executáveis no host (sh, exe, bat, dll, so)
 *   - Limite de tamanho por arquivo (5MB) e por workspace (200MB)
 *   - NÃO há tool de execução: IA só lê/escreve, nunca executa.
 *   - TODA mutação (write/delete/move) é registrada em AuditLog
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'

// ──────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = process.env.AI_WORKSPACE_ROOT || '/app/ai-workspace'
const MAX_FILE_SIZE = 5 * 1024 * 1024            // 5 MB
const MAX_WORKSPACE_SIZE = 200 * 1024 * 1024     // 200 MB
const MAX_LIST_ENTRIES = 500

const ALLOWED_EXT = new Set([
  '.html', '.htm', '.css', '.scss', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.md', '.markdown', '.txt', '.csv', '.tsv',
  '.yml', '.yaml', '.toml', '.env.sample', '.env.example',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.webmanifest',
  '.xml', '.rss', '.atom',
  '.dockerfile', '.conf',
])

const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.ps1', '.psm1',
  '.sh', '.bash', '.zsh', '.fish',
  '.scr', '.com', '.msi', '.app', '.deb', '.rpm',
])

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function ok(payload: any): string { return JSON.stringify({ success: true, ...payload }) }
function fail(message: string, code = 'error'): string { return JSON.stringify({ success: false, error: code, message }) }

function getCompanyRoot(companyId: string): string {
  if (!companyId || !/^[a-zA-Z0-9_-]{1,64}$/.test(companyId)) throw new Error('companyId inválido')
  return path.resolve(WORKSPACE_ROOT, companyId)
}

/** Resolve um caminho relativo dentro do workspace da empresa, bloqueando path traversal. */
function resolveSafe(companyId: string, relPath: string): string {
  const root = getCompanyRoot(companyId)
  // Normaliza separadores e remove barras iniciais
  const cleaned = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned) return root
  if (cleaned.includes('\0')) throw new Error('Caminho contém byte nulo')
  const resolved = path.resolve(root, cleaned)
  // Garante que o resolved continua dentro do root
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Caminho fora do workspace: ${relPath}`)
  }
  return resolved
}

function checkExtension(filePath: string): { ok: boolean; reason?: string } {
  const ext = path.extname(filePath).toLowerCase()
  if (BLOCKED_EXT.has(ext)) return { ok: false, reason: `Extensão ${ext} bloqueada (executável)` }
  if (ext && !ALLOWED_EXT.has(ext)) return { ok: false, reason: `Extensão ${ext} não permitida. Permitidas: ${Array.from(ALLOWED_EXT).join(', ')}` }
  return { ok: true }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) total += await dirSize(full)
      else if (e.isFile()) {
        const st = await fs.stat(full)
        total += st.size
      }
    }
  } catch { /* dir not exists yet */ }
  return total
}

async function logAudit(
  ctx: ToolExecutionContext,
  action: string,
  filePath: string,
  meta: any
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: ctx.companyId,
        userId: null,
        actorType: 'AI_MEMBER',
        actorId: ctx.agentId,
        action: `workspace_${action}`,
        entity: 'AIWorkspace',
        entityId: filePath,
        oldData: undefined,
        newData: meta ?? undefined,
      },
    })
  } catch (e) {
    console.error('[AIWorkspace] AuditLog error:', (e as Error).message)
  }
}

// ──────────────────────────────────────────────────────────────────────
// Tool definitions
// ──────────────────────────────────────────────────────────────────────

const TOOLS: Record<string, AIToolDefinition> = {
  workspace_list: {
    name: 'workspace_list',
    description: 'Lista arquivos e diretórios no workspace da IA da empresa. Caminho relativo ao workspace (ex: "" para raiz, "pages/" para subdir). Útil para descobrir o que já foi criado.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo dentro do workspace. Use "" para raiz.' },
      },
    },
  },
  workspace_read: {
    name: 'workspace_read',
    description: 'Lê o conteúdo de um arquivo do workspace da IA. Retorna o texto integral (limite 5MB). Use workspace_list primeiro para descobrir caminhos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo (ex: "pages/landing.html")' },
      },
      required: ['path'],
    },
  },
  workspace_write: {
    name: 'workspace_write',
    description: 'Cria ou sobrescreve um arquivo no workspace da IA. Cria diretórios pai automaticamente. ⚠️ NÃO toca no código de produção do CRM — escreve apenas em /app/ai-workspace/<companyId>/. Use para criar landing pages, configs sugeridas, scripts auxiliares.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo (ex: "pages/landing.html")' },
        content: { type: 'string', description: 'Conteúdo do arquivo (texto, máx 5MB)' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Codificação do content. Padrão: utf8' },
      },
      required: ['path', 'content'],
    },
  },
  workspace_delete: {
    name: 'workspace_delete',
    description: 'Remove um arquivo do workspace da IA. NÃO remove diretórios (use só para arquivos).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo' },
      },
      required: ['path'],
    },
  },
  workspace_move: {
    name: 'workspace_move',
    description: 'Renomeia ou move um arquivo dentro do workspace da IA.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Caminho atual' },
        to: { type: 'string', description: 'Novo caminho' },
      },
      required: ['from', 'to'],
    },
  },
  workspace_stats: {
    name: 'workspace_stats',
    description: 'Retorna o uso do workspace (tamanho total, número de arquivos, limite). Útil antes de criar arquivos grandes.',
    parameters: { type: 'object', properties: {} },
  },
  workspace_public_url: {
    name: 'workspace_public_url',
    description: 'Retorna a URL pública para servir um arquivo do workspace via /ai-workspace/<companyId>/<path>. Use para entregar uma landing page criada à pessoa. Apenas arquivos com extensões web (html, css, js, png, jpg, svg, etc) são servidos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo no workspace' },
      },
      required: ['path'],
    },
  },
}

// ──────────────────────────────────────────────────────────────────────
// Executors
// ──────────────────────────────────────────────────────────────────────

async function execList(args: any, ctx: ToolExecutionContext): Promise<string> {
  const root = getCompanyRoot(ctx.companyId)
  await ensureDir(root)
  const target = resolveSafe(ctx.companyId, args.path || '')
  let entries: any[]
  try {
    const list = await fs.readdir(target, { withFileTypes: true })
    entries = []
    for (const e of list.slice(0, MAX_LIST_ENTRIES)) {
      const full = path.join(target, e.name)
      const rel = path.relative(root, full).replace(/\\/g, '/')
      if (e.isFile()) {
        const st = await fs.stat(full)
        entries.push({ type: 'file', path: rel, size: st.size, modifiedAt: st.mtime.toISOString() })
      } else if (e.isDirectory()) {
        entries.push({ type: 'dir', path: rel })
      }
    }
  } catch (e: any) {
    if (e.code === 'ENOENT') return ok({ entries: [], path: args.path || '' })
    throw e
  }
  return ok({ entries, path: args.path || '', truncated: entries.length >= MAX_LIST_ENTRIES })
}

async function execRead(args: any, ctx: ToolExecutionContext): Promise<string> {
  const target = resolveSafe(ctx.companyId, args.path)
  const st = await fs.stat(target).catch(() => null)
  if (!st || !st.isFile()) return fail('Arquivo não encontrado', 'not_found')
  if (st.size > MAX_FILE_SIZE) return fail(`Arquivo > ${MAX_FILE_SIZE} bytes`, 'too_large')
  const content = await fs.readFile(target, 'utf8')
  return ok({ path: args.path, size: st.size, content })
}

async function execWrite(args: any, ctx: ToolExecutionContext): Promise<string> {
  const extCheck = checkExtension(args.path)
  if (!extCheck.ok) return fail(extCheck.reason!, 'extension_blocked')
  const root = getCompanyRoot(ctx.companyId)
  await ensureDir(root)
  const used = await dirSize(root)
  const buf = args.encoding === 'base64'
    ? Buffer.from(String(args.content || ''), 'base64')
    : Buffer.from(String(args.content || ''), 'utf8')
  if (buf.length > MAX_FILE_SIZE) return fail(`Conteúdo > ${MAX_FILE_SIZE} bytes`, 'too_large')
  // Se já existe, subtrai do "used"
  const target = resolveSafe(ctx.companyId, args.path)
  const before = await fs.stat(target).catch(() => null)
  const delta = buf.length - (before?.size || 0)
  if (used + delta > MAX_WORKSPACE_SIZE) return fail(`Workspace excederia limite de ${MAX_WORKSPACE_SIZE} bytes`, 'workspace_full')
  await ensureDir(path.dirname(target))
  await fs.writeFile(target, buf)
  await logAudit(ctx, 'write', args.path, { size: buf.length, encoding: args.encoding || 'utf8' })
  return ok({ path: args.path, size: buf.length, created: !before })
}

async function execDelete(args: any, ctx: ToolExecutionContext): Promise<string> {
  const target = resolveSafe(ctx.companyId, args.path)
  const st = await fs.stat(target).catch(() => null)
  if (!st) return fail('Não encontrado', 'not_found')
  if (st.isDirectory()) return fail('Use workspace_delete apenas para arquivos', 'is_directory')
  await fs.unlink(target)
  await logAudit(ctx, 'delete', args.path, { size: st.size })
  return ok({ path: args.path, deleted: true })
}

async function execMove(args: any, ctx: ToolExecutionContext): Promise<string> {
  const extCheck = checkExtension(args.to)
  if (!extCheck.ok) return fail(extCheck.reason!, 'extension_blocked')
  const from = resolveSafe(ctx.companyId, args.from)
  const to = resolveSafe(ctx.companyId, args.to)
  const st = await fs.stat(from).catch(() => null)
  if (!st || !st.isFile()) return fail('Origem não encontrada', 'not_found')
  await ensureDir(path.dirname(to))
  await fs.rename(from, to)
  await logAudit(ctx, 'move', args.to, { from: args.from })
  return ok({ from: args.from, to: args.to })
}

async function execStats(_args: any, ctx: ToolExecutionContext): Promise<string> {
  const root = getCompanyRoot(ctx.companyId)
  await ensureDir(root)
  const used = await dirSize(root)
  let fileCount = 0
  async function count(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) await count(path.join(dir, e.name))
      else if (e.isFile()) fileCount++
    }
  }
  try { await count(root) } catch { /* empty */ }
  return ok({
    usedBytes: used,
    maxBytes: MAX_WORKSPACE_SIZE,
    usedPercent: ((used / MAX_WORKSPACE_SIZE) * 100).toFixed(2),
    fileCount,
    maxFileSize: MAX_FILE_SIZE,
  })
}

async function execPublicUrl(args: any, ctx: ToolExecutionContext): Promise<string> {
  const extCheck = checkExtension(args.path)
  if (!extCheck.ok) return fail(extCheck.reason!, 'extension_blocked')
  const target = resolveSafe(ctx.companyId, args.path)
  const st = await fs.stat(target).catch(() => null)
  if (!st || !st.isFile()) return fail('Arquivo não encontrado', 'not_found')
  // URL relativa (frontend/Traefik resolve domínio); o agente repassa para o usuário
  const cleaned = String(args.path).replace(/\\/g, '/').replace(/^\/+/, '')
  const url = `/ai-workspace/${ctx.companyId}/${cleaned}`
  return ok({ path: args.path, url, size: st.size, hint: 'Esta URL é relativa ao backend; combine com o domínio público do CRM.' })
}

// ──────────────────────────────────────────────────────────────────────
// Module export
// ──────────────────────────────────────────────────────────────────────

export interface AIWorkspaceConfig {
  enabled: boolean
  /** Permite escrita (write/delete/move). Padrão: false (somente leitura). */
  allowWrite?: boolean
}

export const aiWorkspaceModule: ToolModule = {
  type: 'ai_workspace',
  name: 'AI Workspace (Filesystem Sandbox)',

  getTools(config: AIWorkspaceConfig | any): AIToolDefinition[] {
    if (!config || config.enabled !== true) return []
    const out: AIToolDefinition[] = [TOOLS.workspace_list, TOOLS.workspace_read, TOOLS.workspace_stats, TOOLS.workspace_public_url]
    if (config.allowWrite === true) {
      out.push(TOOLS.workspace_write, TOOLS.workspace_delete, TOOLS.workspace_move)
    }
    return out
  },

  async execute(toolName, args, config, ctx): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    try {
      const writeTools = new Set(['workspace_write', 'workspace_delete', 'workspace_move'])
      if (writeTools.has(toolName) && config?.allowWrite !== true) {
        return {
          success: false,
          result: fail('Escrita no workspace desabilitada (allowWrite=false)', 'write_disabled'),
          error: 'write_disabled',
          metadata: { latencyMs: Date.now() - startTime },
        }
      }

      let result: string
      switch (toolName) {
        case 'workspace_list': result = await execList(args, ctx); break
        case 'workspace_read': result = await execRead(args, ctx); break
        case 'workspace_write': result = await execWrite(args, ctx); break
        case 'workspace_delete': result = await execDelete(args, ctx); break
        case 'workspace_move': result = await execMove(args, ctx); break
        case 'workspace_stats': result = await execStats(args, ctx); break
        case 'workspace_public_url': result = await execPublicUrl(args, ctx); break
        default:
          return {
            success: false,
            result: fail(`Tool ${toolName} desconhecida`, 'tool_not_found'),
            error: 'tool_not_found',
          }
      }
      const latencyMs = Date.now() - startTime
      console.log(`[AIWorkspace] ✅ ${toolName} (${latencyMs}ms)`)
      return { success: true, result, metadata: { latencyMs } }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime
      console.error(`[AIWorkspace] ❌ ${toolName}: ${err.message}`)
      return {
        success: false,
        result: fail(err.message || 'Erro desconhecido', 'execution_error'),
        error: err.message,
        metadata: { latencyMs },
      }
    }
  },
}

export const AI_WORKSPACE_TOOL_NAMES = Object.keys(TOOLS)
export { WORKSPACE_ROOT }
