import { FastifyRequest, FastifyReply } from 'fastify'
import { checkPlanLimit } from '../modules/plans/plan.helpers.js'

/**
 * Middleware factory that enforces plan limits before resource creation.
 * 
 * Usage: { preHandler: [authMiddleware, requirePermission('x'), enforcePlanLimit('maxInstances')] }
 * 
 * Returns 403 if limit is reached or feature is blocked.
 */
export function enforcePlanLimit(featureKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = (request as any).user?.companyId
    if (!companyId) {
      return reply.status(401).send({ error: 'Não autenticado' })
    }

    const result = await checkPlanLimit(companyId, featureKey)

    if (!result.allowed) {
      if (result.limit === 0) {
        return reply.status(403).send({
          error: 'Recurso não disponível no seu plano',
          code: 'PLAN_FEATURE_BLOCKED',
          details: {
            feature: featureKey,
            plan: result.planName,
            limit: 0,
          },
        })
      }

      return reply.status(403).send({
        error: `Limite do plano atingido (${result.current}/${result.limit})`,
        code: 'PLAN_LIMIT_REACHED',
        details: {
          feature: featureKey,
          plan: result.planName,
          current: result.current,
          limit: result.limit,
        },
      })
    }
  }
}
