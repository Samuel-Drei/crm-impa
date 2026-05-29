/**
 * ══════════════════════════════════════════════════════════════════════
 * Migration Script — Encriptar credenciais existentes em plaintext
 * ══════════════════════════════════════════════════════════════════════
 *
 * Uso:
 *   npx tsx migrate-encrypt-credentials.ts
 *
 * Ou dentro do container:
 *   docker exec -it crm_impa_backend npx tsx migrate-encrypt-credentials.ts
 *
 * O script:
 *   1. Busca todos os AIProvider com apiKey/refreshToken/oauthData
 *   2. Busca todos os AIKnowledgeBase com embeddingApiKey
 *   3. Busca todos os Instance com accessToken/webhookSecret/evoApiKey
 *   4. Busca todos os PaymentGatewayConfig com credentials/webhookSecret
 *   5. Busca todos os AIMCPServer com authValue
 *   6. Para cada campo: se NÃO está encriptado ($enc$ prefix), encripta
 *   7. Faz UPDATE no banco
 *
 * É idempotent — pode rodar múltiplas vezes sem problema.
 * ══════════════════════════════════════════════════════════════════════
 */

import { PrismaClient } from '@prisma/client'
import { encrypt, isEncrypted, type EncryptionContext } from './src/config/encryption.js'

const prisma = new PrismaClient()

async function migrateAIProviders() {
  // Bypass tenant scoping — use $queryRawUnsafe or direct prisma
  const providers = await prisma.$queryRawUnsafe<Array<{
    id: string
    companyId: string
    apiKey: string | null
    refreshToken: string | null
    oauthData: string | null
  }>>(
    `SELECT id, "companyId", "apiKey", "refreshToken", "oauthData" FROM ai_providers`
  )

  console.log(`[Migration] Encontrados ${providers.length} AIProvider(s)`)

  let encrypted = 0
  let skipped = 0

  for (const provider of providers) {
    const updates: Record<string, string> = {}

    // apiKey
    if (provider.apiKey && !isEncrypted(provider.apiKey)) {
      const ctx: EncryptionContext = {
        companyId: provider.companyId,
        model: 'AIProvider',
        field: 'apiKey',
        recordId: provider.id,
      }
      updates.apiKey = encrypt(provider.apiKey, ctx)
    }

    // refreshToken
    if (provider.refreshToken && !isEncrypted(provider.refreshToken)) {
      const ctx: EncryptionContext = {
        companyId: provider.companyId,
        model: 'AIProvider',
        field: 'refreshToken',
        recordId: provider.id,
      }
      updates.refreshToken = encrypt(provider.refreshToken, ctx)
    }

    // oauthData
    if (provider.oauthData && !isEncrypted(provider.oauthData)) {
      const ctx: EncryptionContext = {
        companyId: provider.companyId,
        model: 'AIProvider',
        field: 'oauthData',
        recordId: provider.id,
      }
      updates.oauthData = encrypt(provider.oauthData, ctx)
    }

    if (Object.keys(updates).length > 0) {
      // Build SET clause dynamically
      const setClauses = Object.entries(updates)
        .map(([field], i) => `"${field}" = $${i + 2}`)
        .join(', ')
      const values = [provider.id, ...Object.values(updates)]

      await prisma.$executeRawUnsafe(
        `UPDATE ai_providers SET ${setClauses} WHERE id = $1`,
        ...values
      )
      encrypted++
      console.log(`  ✓ AIProvider ${provider.id} — ${Object.keys(updates).join(', ')} encriptado(s)`)
    } else {
      skipped++
    }
  }

  console.log(`[Migration] AIProvider: ${encrypted} encriptado(s), ${skipped} já encriptado(s)/vazio(s)`)
}

async function migrateKnowledgeBases() {
  const kbs = await prisma.$queryRawUnsafe<Array<{
    id: string
    companyId: string
    embeddingApiKey: string | null
  }>>(
    `SELECT id, "companyId", "embeddingApiKey" FROM ai_knowledge_bases`
  )

  console.log(`[Migration] Encontrados ${kbs.length} AIKnowledgeBase(s)`)

  let encrypted = 0
  let skipped = 0

  for (const kb of kbs) {
    if (kb.embeddingApiKey && !isEncrypted(kb.embeddingApiKey)) {
      const ctx: EncryptionContext = {
        companyId: kb.companyId,
        model: 'AIKnowledgeBase',
        field: 'embeddingApiKey',
        recordId: kb.id,
      }
      const encryptedValue = encrypt(kb.embeddingApiKey, ctx)

      await prisma.$executeRawUnsafe(
        `UPDATE ai_knowledge_bases SET "embeddingApiKey" = $2 WHERE id = $1`,
        kb.id,
        encryptedValue
      )
      encrypted++
      console.log(`  ✓ AIKnowledgeBase ${kb.id} — embeddingApiKey encriptado`)
    } else {
      skipped++
    }
  }

  console.log(`[Migration] AIKnowledgeBase: ${encrypted} encriptado(s), ${skipped} já encriptado(s)/vazio(s)`)
}

async function migrateInstances() {
  const instances = await prisma.$queryRawUnsafe<Array<{
    id: string
    companyId: string
    accessToken: string | null
    webhookSecret: string | null
    evoApiKey: string | null
  }>>(
    `SELECT id, "companyId", "accessToken", "webhookSecret", "evoApiKey" FROM instances`
  )

  console.log(`[Migration] Encontrados ${instances.length} Instance(s)`)

  let encrypted = 0
  let skipped = 0

  for (const inst of instances) {
    const updates: Record<string, string> = {}
    const fields = ['accessToken', 'webhookSecret', 'evoApiKey'] as const

    for (const field of fields) {
      const value = inst[field]
      if (value && !isEncrypted(value)) {
        const ctx: EncryptionContext = {
          companyId: inst.companyId,
          model: 'Instance',
          field,
          recordId: inst.id,
        }
        updates[field] = encrypt(value, ctx)
      }
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.entries(updates)
        .map(([field], i) => `"${field}" = $${i + 2}`)
        .join(', ')
      const values = [inst.id, ...Object.values(updates)]

      await prisma.$executeRawUnsafe(
        `UPDATE instances SET ${setClauses} WHERE id = $1`,
        ...values
      )
      encrypted++
      console.log(`  ✓ Instance ${inst.id} — ${Object.keys(updates).join(', ')} encriptado(s)`)
    } else {
      skipped++
    }
  }

  console.log(`[Migration] Instance: ${encrypted} encriptado(s), ${skipped} já encriptado(s)/vazio(s)`)
}

async function migratePaymentGatewayConfigs() {
  const configs = await prisma.$queryRawUnsafe<Array<{
    id: string
    companyId: string
    credentials: string | null
    webhookSecret: string | null
  }>>(
    `SELECT id, "companyId", credentials::text, "webhookSecret" FROM payment_gateway_configs`
  )

  console.log(`[Migration] Encontrados ${configs.length} PaymentGatewayConfig(s)`)

  let encrypted = 0
  let skipped = 0

  for (const config of configs) {
    const updates: Record<string, string> = {}

    // credentials — stored as JSON, encrypt the whole JSON string
    if (config.credentials && !isEncrypted(config.credentials)) {
      const ctx: EncryptionContext = {
        companyId: config.companyId,
        model: 'PaymentGatewayConfig',
        field: 'credentials',
        recordId: config.id,
      }
      updates.credentials = encrypt(config.credentials, ctx)
    }

    // webhookSecret
    if (config.webhookSecret && !isEncrypted(config.webhookSecret)) {
      const ctx: EncryptionContext = {
        companyId: config.companyId,
        model: 'PaymentGatewayConfig',
        field: 'webhookSecret',
        recordId: config.id,
      }
      updates.webhookSecret = encrypt(config.webhookSecret, ctx)
    }

    if (Object.keys(updates).length > 0) {
      const setClauses: string[] = []
      const values: any[] = [config.id]
      let paramIdx = 2

      if (updates.credentials) {
        // credentials is a Json column — cast to jsonb
        setClauses.push(`credentials = $${paramIdx}::jsonb`)
        // Wrap encrypted string as JSON string literal
        values.push(JSON.stringify(updates.credentials))
        paramIdx++
      }
      if (updates.webhookSecret) {
        setClauses.push(`"webhookSecret" = $${paramIdx}`)
        values.push(updates.webhookSecret)
        paramIdx++
      }

      await prisma.$executeRawUnsafe(
        `UPDATE payment_gateway_configs SET ${setClauses.join(', ')} WHERE id = $1`,
        ...values
      )
      encrypted++
      console.log(`  ✓ PaymentGatewayConfig ${config.id} — ${Object.keys(updates).join(', ')} encriptado(s)`)
    } else {
      skipped++
    }
  }

  console.log(`[Migration] PaymentGatewayConfig: ${encrypted} encriptado(s), ${skipped} já encriptado(s)/vazio(s)`)
}

async function migrateMCPServers() {
  const servers = await prisma.$queryRawUnsafe<Array<{
    id: string
    companyId: string
    authValue: string | null
  }>>(
    `SELECT id, "companyId", "authValue" FROM ai_mcp_servers`
  )

  console.log(`[Migration] Encontrados ${servers.length} AIMCPServer(s)`)

  let encrypted = 0
  let skipped = 0

  for (const server of servers) {
    if (server.authValue && !isEncrypted(server.authValue)) {
      const ctx: EncryptionContext = {
        companyId: server.companyId,
        model: 'AIMCPServer',
        field: 'authValue',
        recordId: server.id,
      }
      const encryptedValue = encrypt(server.authValue, ctx)

      await prisma.$executeRawUnsafe(
        `UPDATE ai_mcp_servers SET "authValue" = $2 WHERE id = $1`,
        server.id,
        encryptedValue
      )
      encrypted++
      console.log(`  ✓ AIMCPServer ${server.id} — authValue encriptado`)
    } else {
      skipped++
    }
  }

  console.log(`[Migration] AIMCPServer: ${encrypted} encriptado(s), ${skipped} já encriptado(s)/vazio(s)`)
}

async function main() {
  console.log('══════════════════════════════════════════════════════════')
  console.log(' Migração: Encriptação de credenciais em plaintext')
  console.log('══════════════════════════════════════════════════════════')
  console.log()

  try {
    await migrateAIProviders()
    console.log()
    await migrateKnowledgeBases()
    console.log()
    await migrateInstances()
    console.log()
    await migratePaymentGatewayConfigs()
    console.log()
    await migrateMCPServers()
    console.log()
    console.log('══════════════════════════════════════════════════════════')
    console.log(' Migração concluída com sucesso!')
    console.log('══════════════════════════════════════════════════════════')
  } catch (error) {
    console.error('[Migration] ERRO (non-fatal):', error)
    // Não faz process.exit(1) — permite o server subir mesmo se a migração falhar
  } finally {
    await prisma.$disconnect()
  }
}

main()
