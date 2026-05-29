/**
 * ══════════════════════════════════════════════════════════════════════
 * Field-Level Encryption Service — AES-256-GCM com Envelope Encryption
 * ══════════════════════════════════════════════════════════════════════
 *
 * Arquitetura:
 *   KEK (Key Encryption Key) → variável de ambiente ENCRYPTION_KEK
 *   DEK (Data Encryption Key) → aleatória por operação de encrypt
 *
 * Formato do ciphertext armazenado (base64 JSON):
 *   { v: 1, dek: wrappedDEK, n: nonce, d: ciphertext, t: tag, a: aad }
 *
 * - v:   versão do formato (para rotação futura)
 * - dek: DEK encriptada com a KEK (AES-256-GCM wrap)
 * - n:   nonce/IV do dado (12 bytes, hex)
 * - d:   ciphertext do dado (hex)
 * - t:   auth tag (hex)
 * - a:   AAD usado (plaintext, para validação)
 *
 * AAD vincula o ciphertext ao contexto: "companyId:model:fieldName:recordId"
 * Isso impede que um ciphertext válido de um registro seja copiado para outro.
 *
 * Algoritmo: AES-256-GCM (OWASP/NIST recomendado, AEAD nativo do Node.js)
 * ══════════════════════════════════════════════════════════════════════
 */

import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm' as const
const IV_LENGTH = 12   // 96 bits (recomendado para GCM)
const TAG_LENGTH = 16  // 128 bits
const DEK_LENGTH = 32  // 256 bits
const KEY_VERSION = 1

// ── KEK Management ──

let _kek: Buffer | null = null

function getKEK(): Buffer {
  if (_kek) return _kek

  const kekHex = process.env.ENCRYPTION_KEK
  if (!kekHex) {
    throw new Error(
      '[Encryption] ENCRYPTION_KEK não configurada. ' +
      'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }

  // Aceita hex (64 chars) ou base64 (44 chars)
  if (kekHex.length === 64 && /^[0-9a-fA-F]+$/.test(kekHex)) {
    _kek = Buffer.from(kekHex, 'hex')
  } else {
    _kek = Buffer.from(kekHex, 'base64')
  }

  if (_kek.length !== 32) {
    throw new Error(`[Encryption] KEK deve ter 256 bits (32 bytes). Recebido: ${_kek.length} bytes`)
  }

  return _kek
}

/**
 * Verifica se a KEK está configurada (sem lançar erro)
 */
export function isEncryptionConfigured(): boolean {
  try {
    getKEK()
    return true
  } catch {
    return false
  }
}

// ── Envelope Encryption: KEK wraps/unwraps DEK ──

function wrapDEK(dek: Buffer): { wrappedDEK: string; dekNonce: string; dekTag: string } {
  const kek = getKEK()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv, { authTagLength: TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    wrappedDEK: encrypted.toString('hex'),
    dekNonce: iv.toString('hex'),
    dekTag: tag.toString('hex'),
  }
}

function unwrapDEK(wrappedDEK: string, dekNonce: string, dekTag: string): Buffer {
  const kek = getKEK()
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    kek,
    Buffer.from(dekNonce, 'hex'),
    { authTagLength: TAG_LENGTH }
  )
  decipher.setAuthTag(Buffer.from(dekTag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(wrappedDEK, 'hex')),
    decipher.final(),
  ])
}

// ── Tipos ──

export interface EncryptedEnvelope {
  /** Versão do formato */
  v: number
  /** Wrapped DEK (hex) */
  dek: string
  /** DEK nonce (hex) */
  dn: string
  /** DEK auth tag (hex) */
  dt: string
  /** Data nonce/IV (hex) */
  n: string
  /** Ciphertext (hex) */
  d: string
  /** Auth tag do dado (hex) */
  t: string
  /** AAD usado */
  a: string
}

export interface EncryptionContext {
  companyId: string
  model: string
  field: string
  recordId?: string
}

// ── API pública ──

/**
 * Encripta um valor (string ou objeto) usando envelope encryption AES-256-GCM.
 *
 * @param plaintext - Valor a encriptar (string ou objeto que será JSON.stringified)
 * @param context   - Contexto para AAD (vincula o ciphertext ao registro)
 * @returns         - String base64 do envelope encriptado
 */
export function encrypt(plaintext: string | object, context: EncryptionContext): string {
  const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)
  const aad = buildAAD(context)
  const aadBuffer = Buffer.from(aad, 'utf8')

  // 1. Gera DEK aleatória
  const dek = crypto.randomBytes(DEK_LENGTH)

  // 2. Encripta o dado com a DEK
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH })
  cipher.setAAD(aadBuffer)
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // 3. Wrapa a DEK com a KEK
  const { wrappedDEK, dekNonce, dekTag } = wrapDEK(dek)

  // 4. Zera a DEK da memória
  dek.fill(0)

  // 5. Monta o envelope
  const envelope: EncryptedEnvelope = {
    v: KEY_VERSION,
    dek: wrappedDEK,
    dn: dekNonce,
    dt: dekTag,
    n: iv.toString('hex'),
    d: ciphertext.toString('hex'),
    t: tag.toString('hex'),
    a: aad,
  }

  return `$enc$${Buffer.from(JSON.stringify(envelope)).toString('base64')}`
}

/**
 * Decripta um valor encriptado com envelope encryption.
 *
 * @param encryptedValue - String com prefixo $enc$ + base64 do envelope
 * @returns              - Valor original (string)
 */
export function decrypt(encryptedValue: string): string {
  if (!isEncrypted(encryptedValue)) {
    // Valor não encriptado (plaintext legado) — retorna como está
    return encryptedValue
  }

  const envelopeJson = Buffer.from(encryptedValue.slice(5), 'base64').toString('utf8')
  const envelope: EncryptedEnvelope = JSON.parse(envelopeJson)

  if (envelope.v !== KEY_VERSION) {
    throw new Error(`[Encryption] Versão ${envelope.v} não suportada. Esperado: ${KEY_VERSION}`)
  }

  // 1. Unwrapa a DEK
  const dek = unwrapDEK(envelope.dek, envelope.dn, envelope.dt)

  // 2. Decripta o dado com a DEK
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    dek,
    Buffer.from(envelope.n, 'hex'),
    { authTagLength: TAG_LENGTH }
  )
  decipher.setAAD(Buffer.from(envelope.a, 'utf8'))
  decipher.setAuthTag(Buffer.from(envelope.t, 'hex'))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.d, 'hex')),
    decipher.final(),
  ]).toString('utf8')

  // 3. Zera a DEK da memória
  dek.fill(0)

  return plaintext
}

/**
 * Decripta e faz JSON.parse (para campos como oauthData)
 */
export function decryptJSON<T = any>(encryptedValue: string): T {
  const text = decrypt(encryptedValue)
  return JSON.parse(text)
}

/**
 * Verifica se um valor está encriptado (tem o prefixo $enc$)
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith('$enc$')
}

// ── Helpers ──

function buildAAD(ctx: EncryptionContext): string {
  const parts = [ctx.companyId, ctx.model, ctx.field]
  if (ctx.recordId) parts.push(ctx.recordId)
  return parts.join(':')
}

/**
 * Encripta um campo apenas se ainda não estiver encriptado.
 * Retorna o valor encriptado ou o original se já estiver.
 */
export function encryptIfNeeded(value: string | null | undefined, context: EncryptionContext): string | null | undefined {
  if (!value || isEncrypted(value)) return value
  return encrypt(value, context)
}

/**
 * Decripta um campo, tolerando valores plaintext (legado).
 * Se o valor não tiver o prefixo $enc$, retorna como está.
 */
export function decryptSafe(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  if (!isEncrypted(value)) return value // plaintext legado
  try {
    return decrypt(value)
  } catch (err) {
    console.error('[Encryption] Falha ao decriptar campo:', err)
    return value // fallback para não quebrar o sistema
  }
}

/**
 * Decripta JSON de forma segura, tolerando plaintext legado.
 */
export function decryptJSONSafe<T = any>(value: any): T {
  if (!value) return value
  if (typeof value === 'object' && !isEncrypted(JSON.stringify(value))) return value // já é objeto, dados legados
  if (typeof value === 'string' && isEncrypted(value)) {
    try { return decryptJSON<T>(value) } catch { return value as T }
  }
  return value
}
