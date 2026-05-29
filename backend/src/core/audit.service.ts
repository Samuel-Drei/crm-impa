import { FastifyRequest } from 'fastify'
import { prisma } from '../config/database.js'

interface AuditOptions {
  action: string
  entity: string
  entityId?: string
  oldData?: Record<string, any> | null
  newData?: Record<string, any> | null
}

/**
 * Log an auditable action. Call from any route handler.
 * Automatically extracts userId, companyId, IP, and User-Agent from the request.
 */
export async function auditLog(request: FastifyRequest, opts: AuditOptions): Promise<void> {
  try {
    const user = request.user as any
    await prisma.auditLog.create({
      data: {
        companyId: user?.companyId,
        userId: user?.id || user?.sub,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        oldData: opts.oldData ?? undefined,
        newData: opts.newData ?? undefined,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']?.substring(0, 500),
      },
    })
  } catch {
    // Never let audit failures break the main flow
  }
}
