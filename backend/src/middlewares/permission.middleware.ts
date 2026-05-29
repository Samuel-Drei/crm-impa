import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Middleware factory: verifica se o usuário possui TODAS as permissões necessárias.
 * Uso: { preHandler: [authMiddleware, requirePermission('contacts:write')] }
 */
export function requirePermission(...requiredPermissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userPerms: string[] = (request.user as any).permissions || []
    const role = (request.user.role || '').toLowerCase()

    // Admin bypass — admin tem todas as permissões
    if (role === 'admin') return

    const hasAll = requiredPermissions.every(p => userPerms.includes(p))
    if (!hasAll) {
      return reply.status(403).send({
        error: 'Forbidden',
        required: requiredPermissions,
        message: 'Você não tem permissão para esta ação',
      })
    }
  }
}

/**
 * Verifica se tem PELO MENOS UMA das permissões.
 * Uso: { preHandler: [authMiddleware, requireAnyPermission('labels:read', 'labels:manage')] }
 */
export function requireAnyPermission(...requiredPermissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userPerms: string[] = (request.user as any).permissions || []
    const role = (request.user.role || '').toLowerCase()

    if (role === 'admin') return

    const hasAny = requiredPermissions.some(p => userPerms.includes(p))
    if (!hasAny) {
      return reply.status(403).send({
        error: 'Forbidden',
        required: requiredPermissions,
        message: 'Você não tem permissão para esta ação',
      })
    }
  }
}
