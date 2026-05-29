/**
 * Centralized WebSocket room naming with tenant namespace.
 * All room names include companyId for tenant isolation (SEC-02).
 */

export function instanceRoom(companyId: string, instanceId: string): string {
  return `company:${companyId}:instance:${instanceId}`
}

export function pipelineRoom(companyId: string, pipelineId: string): string {
  return `company:${companyId}:pipeline:${pipelineId}`
}

export function companyRoom(companyId: string): string {
  return `company:${companyId}`
}
