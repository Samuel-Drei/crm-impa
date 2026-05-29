import { FastifyRequest } from 'fastify'

/**
 * Retorna condições WHERE do Prisma baseadas no escopo do usuário.
 * Adiciona automaticamente filtro por companyId + escopo (OWN/TEAM/COMPANY).
 */
export function scopedWhere(
  request: FastifyRequest,
  module: string = 'default'
): Record<string, any> {
  const { companyId } = request.user
  const userId = (request.user as any).id || request.user.sub
  const teamIds: string[] = (request.user as any).teamIds || []

  // Determinar escopo efetivo
  const scope = module === 'conversations'
    ? (request.user as any).conversationScope || 'OWN'
    : (request.user as any).defaultScope || 'OWN'

  // Base: sempre filtrar por empresa
  const where: Record<string, any> = { companyId }

  switch (scope) {
    case 'OWN':
      if (module === 'conversations') {
        // Conversas atribuídas ao usuário OU não atribuídas (pool)
        where.OR = [
          { assigneeId: userId },
          { assigneeId: null },
        ]
      }
      break

    case 'OWN_ONLY':
      if (module === 'conversations') {
        // Apenas conversas atribuídas ao usuário (SEM pool de não-atribuídas)
        where.assigneeId = userId
      }
      break

    case 'TEAM':
      if (module === 'conversations') {
        // Conversas dos times do usuário + atribuídas a mim + pool (não atribuídas)
        where.OR = [
          ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
          { assigneeId: userId },
          { assigneeId: null },
        ]
      }
      break

    case 'COMPANY':
      // Sem filtro adicional — vê tudo da empresa
      break
  }

  return where
}
