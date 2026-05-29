import { redis } from '../config/redis.js';
import { createHash } from 'crypto';
const WEBHOOK_NONCE_TTL = 300; // 5 minutes
/**
 * Webhook replay protection via Redis nonce deduplication.
 * Returns true if the event was already processed (duplicate/replay).
 * Returns false if this is a new event (sets the nonce in Redis with TTL).
 */
export async function isWebhookReplay(namespace, uniqueId) {
    const key = `wh:nonce:${namespace}:${createHash('sha256').update(uniqueId).digest('hex').slice(0, 32)}`;
    // SET NX returns 'OK' if key was set (new event), null if already exists (replay)
    const result = await redis.set(key, '1', 'EX', WEBHOOK_NONCE_TTL, 'NX');
    return result === null; // null = key existed = replay
}
//# sourceMappingURL=webhook-replay.js.map