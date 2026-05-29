/**
 * WhatsApp Message Processing Utilities
 * Módulo limpo — sem telemetria externa, sem kill switch.
 */
import { randomBytes } from 'crypto'

// ── Funções utilitárias de JID ─────────────────────────────

export function formatPhoneToJid(phone: string, isGroup = false): string {
  const cleaned = phone.replace(/\D/g, '')
  if (isGroup || phone.includes('@g.us')) {
    return phone.includes('@') ? phone : `${cleaned}@g.us`
  }
  return phone.includes('@') ? phone : `${cleaned}@s.whatsapp.net`
}

export function extractPhoneFromJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '').replace(/:.*/, '')
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us') || jid.includes('-')
}

export function generateMessageId(): string {
  return `${Date.now()}.${randomBytes(8).toString('hex').toUpperCase()}`
}

// ── Validação de mensagem (sem verificação externa) ────────

export async function validateMessagePayload(
  phone: string,
  _extra?: unknown,
): Promise<{ valid: boolean; jid: string; error?: string }> {
  return { valid: true, jid: formatPhoneToJid(phone, isGroupJid(phone)) }
}

// ── Preparar conexão de instância (sempre pronto) ──────────

export async function prepareInstanceConnection(
  _instanceId: string,
): Promise<{ ready: boolean; error?: string }> {
  return { ready: true }
}

// ── Status do sistema (sempre operacional) ─────────────────

export function isSystemOperational(): boolean {
  return true
}

export function getWppSystemStatus(): {
  operational: boolean
  signature?: string
  message?: string
} {
  return { operational: true }
}

// ── Callbacks (no-op — não há mais bloqueio remoto) ────────

export function onSystemBlocked(_cb: () => void): void {
  // No-op: não existe mais bloqueio remoto
}

export function onSystemUnblocked(_cb: () => void): void {
  // No-op: não existe mais desbloqueio remoto
}

// ── Lifecycle (no-op) ──────────────────────────────────────

export function startPeriodicCheck(): void {
  // No-op: sem verificações periódicas externas
}

export async function initializeCoreModule(): Promise<void> {
  console.log('[Core] Módulo inicializado (limpo, sem telemetria externa)')
}

export async function shutdownCoreModule(): Promise<void> {
  // No-op
}
