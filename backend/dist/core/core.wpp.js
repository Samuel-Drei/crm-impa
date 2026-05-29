/**
 * WhatsApp Message Processing Utilities
 * Módulo limpo — sem telemetria externa, sem kill switch.
 */
import { randomBytes } from 'crypto';
// ── Funções utilitárias de JID ─────────────────────────────
export function formatPhoneToJid(phone, isGroup = false) {
    const cleaned = phone.replace(/\D/g, '');
    if (isGroup || phone.includes('@g.us')) {
        return phone.includes('@') ? phone : `${cleaned}@g.us`;
    }
    return phone.includes('@') ? phone : `${cleaned}@s.whatsapp.net`;
}
export function extractPhoneFromJid(jid) {
    return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '').replace(/:.*/, '');
}
export function isGroupJid(jid) {
    return jid.endsWith('@g.us') || jid.includes('-');
}
export function generateMessageId() {
    return `${Date.now()}.${randomBytes(8).toString('hex').toUpperCase()}`;
}
// ── Validação de mensagem (sem verificação externa) ────────
export async function validateMessagePayload(phone, _extra) {
    return { valid: true, jid: formatPhoneToJid(phone, isGroupJid(phone)) };
}
// ── Preparar conexão de instância (sempre pronto) ──────────
export async function prepareInstanceConnection(_instanceId) {
    return { ready: true };
}
// ── Status do sistema (sempre operacional) ─────────────────
export function isSystemOperational() {
    return true;
}
export function getWppSystemStatus() {
    return { operational: true };
}
// ── Callbacks (no-op — não há mais bloqueio remoto) ────────
export function onSystemBlocked(_cb) {
    // No-op: não existe mais bloqueio remoto
}
export function onSystemUnblocked(_cb) {
    // No-op: não existe mais desbloqueio remoto
}
// ── Lifecycle (no-op) ──────────────────────────────────────
export function startPeriodicCheck() {
    // No-op: sem verificações periódicas externas
}
export async function initializeCoreModule() {
    console.log('[Core] Módulo inicializado (limpo, sem telemetria externa)');
}
export async function shutdownCoreModule() {
    // No-op
}
//# sourceMappingURL=core.wpp.js.map