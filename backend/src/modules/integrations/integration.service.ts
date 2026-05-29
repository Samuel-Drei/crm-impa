/**
 * Service da camada de Integrações.
 *
 * Toda credencial é armazenada encriptada (AES-256-GCM via envelope encryption).
 * Nunca retornamos credenciais cruas ao cliente HTTP.
 */

import { prisma } from '../../config/database.js'
import {
  encrypt,
  decryptJSON,
  decryptSafe,
  isEncrypted,
  type EncryptionContext,
} from '../../config/encryption.js'
import { getProvider, listCatalog } from './registry.js'
import type { CompanyIntegrationType, CompanyIntegration } from '@prisma/client'

const FIELD = 'credentials'
const MODEL = 'CompanyIntegration'

/**
 * Prefixo usado para integrações "virtuais" derivadas de outros recursos
 * já cadastrados na empresa (atualmente: AIProvider OPENAI, que é
 * reaproveitado como integração de TTS/STT sem precisar duplicar credencial).
 */
export const AI_PROVIDER_VIRTUAL_PREFIX = 'aiprovider:'

export function isVirtualIntegrationId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(AI_PROVIDER_VIRTUAL_PREFIX)
}

function virtualIdToProviderId(id: string): string {
  return id.slice(AI_PROVIDER_VIRTUAL_PREFIX.length)
}

function aad(companyId: string, recordId?: string): EncryptionContext {
  return { companyId, model: MODEL, field: FIELD, recordId }
}

/** Mascara credenciais antes de enviar para o cliente. */
function redactCredentials(creds: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(creds || {})) {
    if (typeof v !== 'string' || !v) {
      out[k] = v
      continue
    }
    if (k.toLowerCase().includes('url')) { out[k] = v; continue }
    if (v.length <= 6) out[k] = '••••'
    else out[k] = `${v.slice(0, 3)}••••${v.slice(-3)}`
  }
  return out
}

export interface PublicIntegration {
  id: string
  companyId: string
  type: CompanyIntegrationType
  name: string
  description: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR'
  config: any
  capabilities: any
  credentialsMasked: Record<string, any>
  lastTestedAt: Date | null
  lastError: string | null
  lastUsageAt: Date | null
  totalRequests: number
  failedRequests: number
  createdAt: Date
  updatedAt: Date
}

function toPublic(row: CompanyIntegration): PublicIntegration {
  let creds: Record<string, any> = {}
  try {
    if (row.credentials) {
      creds = isEncrypted(row.credentials) ? decryptJSON(row.credentials) : JSON.parse(row.credentials)
    }
  } catch {
    creds = {}
  }
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    name: row.name,
    description: row.description,
    status: row.status as any,
    config: row.config,
    capabilities: row.capabilities,
    credentialsMasked: redactCredentials(creds),
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
    lastUsageAt: row.lastUsageAt,
    totalRequests: row.totalRequests,
    failedRequests: row.failedRequests,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Decrypt credentials para uso interno (NUNCA expor via HTTP). */
export function getDecryptedCredentials(row: CompanyIntegration): Record<string, any> {
  if (!row.credentials) return {}
  if (isEncrypted(row.credentials)) return decryptJSON(row.credentials)
  return JSON.parse(row.credentials)
}

// ───────────────────────── Integrações virtuais (AIProvider OPENAI) ─────────────────────────

/**
 * Lista AIProviders OPENAI ativos da empresa, mapeados como `PublicIntegration`.
 * Permite reaproveitar a credencial já cadastrada para chat como integração de TTS/STT.
 */
async function listVirtualOpenAIIntegrations(companyId: string): Promise<PublicIntegration[]> {
  const rows = await prisma.aIProvider.findMany({
    where: { companyId, isActive: true, type: 'OPENAI' },
    select: { id: true, name: true, baseUrl: true, model: true, createdAt: true, updatedAt: true },
  })
  return rows.map((p) => ({
    id: `${AI_PROVIDER_VIRTUAL_PREFIX}${p.id}`,
    companyId,
    type: 'OPENAI' as CompanyIntegrationType,
    name: `${p.name} · provedor IA`,
    description: 'Reaproveita a credencial OpenAI já cadastrada em Provedores IA. Suporta TTS e STT sem nova configuração.',
    status: 'ACTIVE' as const,
    config: { virtual: true, source: 'ai_provider', baseUrl: p.baseUrl || null },
    capabilities: ['tts', 'stt'] as any,
    credentialsMasked: { apiKey: '••••••', baseUrl: p.baseUrl || null },
    lastTestedAt: null,
    lastError: null,
    lastUsageAt: null,
    totalRequests: 0,
    failedRequests: 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))
}

/**
 * Carrega uma integração para uso em runtime (TTS/STT/calendar tools).
 * Aceita tanto IDs de CompanyIntegration reais quanto IDs virtuais
 * (formato `aiprovider:<id>`) que mapeiam para AIProvider OPENAI.
 *
 * Retorna um shape unificado que se comporta como CompanyIntegration para
 * efeitos do registry de providers.
 */
export async function resolveIntegrationForRuntime(
  companyId: string,
  integrationId: string,
): Promise<{
  id: string
  type: CompanyIntegrationType
  name: string
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR'
  config: any
  credentials: Record<string, any>
  isVirtual: boolean
} | null> {
  if (isVirtualIntegrationId(integrationId)) {
    const providerId = virtualIdToProviderId(integrationId)
    const p = await prisma.aIProvider.findFirst({
      where: { id: providerId, companyId, type: 'OPENAI' },
    })
    if (!p) return null
    if (!p.isActive) {
      return {
        id: integrationId, type: 'OPENAI', name: p.name, status: 'INACTIVE',
        config: { virtual: true, baseUrl: p.baseUrl || null }, credentials: {},
        isVirtual: true,
      }
    }
    const apiKey = decryptSafe(p.apiKey) as string
    return {
      id: integrationId,
      type: 'OPENAI',
      name: `${p.name} · provedor IA`,
      status: 'ACTIVE',
      config: { virtual: true, baseUrl: p.baseUrl || null },
      credentials: { apiKey, baseUrl: p.baseUrl || undefined },
      isVirtual: true,
    }
  }

  const row = await prisma.companyIntegration.findFirst({
    where: { id: integrationId, companyId },
  })
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status as any,
    config: row.config,
    credentials: getDecryptedCredentials(row),
    isVirtual: false,
  }
}

export async function getCompanyIntegrationDecrypted(companyId: string, integrationId: string) {
  if (isVirtualIntegrationId(integrationId)) {
    const resolved = await resolveIntegrationForRuntime(companyId, integrationId)
    if (!resolved) return null
    // Constrói um row "fake" com tipos compatíveis para o caller.
    const fakeRow: CompanyIntegration = {
      id: resolved.id,
      companyId,
      type: resolved.type,
      name: resolved.name,
      description: null,
      status: resolved.status as any,
      credentials: '',
      config: resolved.config,
      capabilities: ['tts', 'stt'] as any,
      lastTestedAt: null,
      lastError: null,
      lastUsageAt: null,
      totalRequests: 0,
      failedRequests: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    return { row: fakeRow, credentials: resolved.credentials }
  }
  const row = await prisma.companyIntegration.findFirst({
    where: { id: integrationId, companyId },
  })
  if (!row) return null
  return { row, credentials: getDecryptedCredentials(row) }
}

export function getIntegrationCatalog() {
  return listCatalog()
}

export async function listIntegrations(companyId: string, filter?: { type?: CompanyIntegrationType }) {
  const rows = await prisma.companyIntegration.findMany({
    where: { companyId, ...(filter?.type ? { type: filter.type } : {}) },
    orderBy: { createdAt: 'desc' },
  })
  const real = rows.map(toPublic)
  // Anexa integrações virtuais (AIProvider OPENAI já cadastrados) — evita
  // forçar o usuário a duplicar credenciais quando OpenAI já é provedor de chat.
  if (!filter?.type || filter.type === 'OPENAI') {
    const virtuals = await listVirtualOpenAIIntegrations(companyId)
    return [...virtuals, ...real]
  }
  return real
}

export async function getIntegration(companyId: string, id: string) {
  if (isVirtualIntegrationId(id)) {
    const all = await listVirtualOpenAIIntegrations(companyId)
    return all.find((i) => i.id === id) || null
  }
  const row = await prisma.companyIntegration.findFirst({ where: { id, companyId } })
  return row ? toPublic(row) : null
}

export interface CreateIntegrationInput {
  type: CompanyIntegrationType
  name: string
  description?: string
  credentials: Record<string, any>
  config?: any
}

export async function createIntegration(companyId: string, input: CreateIntegrationInput) {
  const provider = getProvider(input.type)
  // Valida campos obrigatórios
  for (const f of provider.catalog.credentialFields) {
    if (f.required && !input.credentials?.[f.key]) {
      throw new Error(`Credencial obrigatória ausente: ${f.label} (${f.key})`)
    }
  }

  // Encripta após criação para ter recordId no AAD — usamos transação
  const created = await prisma.companyIntegration.create({
    data: {
      companyId,
      type: input.type,
      name: input.name,
      description: input.description,
      credentials: '__pending__',
      config: input.config ?? {},
      capabilities: provider.catalog.capabilities as any,
      status: 'ACTIVE',
    },
  })
  const ciphertext = encrypt(input.credentials, aad(companyId, created.id))
  const updated = await prisma.companyIntegration.update({
    where: { id: created.id },
    data: { credentials: ciphertext },
  })
  return toPublic(updated)
}

export interface UpdateIntegrationInput {
  name?: string
  description?: string
  credentials?: Record<string, any>
  config?: any
  status?: 'ACTIVE' | 'INACTIVE' | 'ERROR'
}

export async function updateIntegration(companyId: string, id: string, patch: UpdateIntegrationInput) {
  if (isVirtualIntegrationId(id)) {
    throw new Error('Esta integração é virtual (vinculada ao Provedor IA). Edite em Provedores IA → OpenAI.')
  }
  const existing = await prisma.companyIntegration.findFirst({ where: { id, companyId } })
  if (!existing) throw new Error('Integração não encontrada')

  const data: any = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.description !== undefined) data.description = patch.description
  if (patch.config !== undefined) data.config = patch.config
  if (patch.status !== undefined) data.status = patch.status
  if (patch.credentials !== undefined) {
    // Mescla com credenciais atuais (campos não enviados ficam preservados)
    const current = getDecryptedCredentials(existing)
    const merged = { ...current, ...patch.credentials }
    data.credentials = encrypt(merged, aad(companyId, id))
  }

  const updated = await prisma.companyIntegration.update({ where: { id }, data })
  return toPublic(updated)
}

export async function deleteIntegration(companyId: string, id: string) {
  if (isVirtualIntegrationId(id)) {
    throw new Error('Esta integração é virtual e não pode ser removida aqui. Remova o Provedor IA correspondente.')
  }
  const existing = await prisma.companyIntegration.findFirst({ where: { id, companyId } })
  if (!existing) throw new Error('Integração não encontrada')
  await prisma.companyIntegration.delete({ where: { id } })
}

export async function testIntegration(companyId: string, id: string) {
  const data = await getCompanyIntegrationDecrypted(companyId, id)
  if (!data) throw new Error('Integração não encontrada')
  const provider = getProvider(data.row.type)
  const result = await provider.test(data.credentials)
  if (isVirtualIntegrationId(id)) {
    return result // virtual: não persiste status (vive no AIProvider)
  }
  await prisma.companyIntegration.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastError: result.ok ? null : result.message,
      status: result.ok ? 'ACTIVE' : 'ERROR',
    },
  })
  return result
}

/** Registra estatística de uso (chame após operações relevantes). */
export async function trackUsage(integrationId: string, success: boolean) {
  if (isVirtualIntegrationId(integrationId)) return // virtual: sem stats próprias
  try {
    await prisma.companyIntegration.update({
      where: { id: integrationId },
      data: {
        lastUsageAt: new Date(),
        totalRequests: { increment: 1 },
        ...(success ? {} : { failedRequests: { increment: 1 } }),
      },
    })
  } catch {
    // não bloquear fluxo principal
  }
}
