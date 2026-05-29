import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthController } from './auth.controller.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { prisma } from '../../config/database.js'
import { redis } from '../../config/redis.js'
import { checkPlanLimit, FEATURE_KEY_MODEL_MAP } from '../plans/plan.helpers.js'
import { loadUserWithRbac } from './auth.service.js'

const controller = new AuthController()

// SEC-25 fix: IP-based rate limiting for auth endpoints
async function authRateLimit(maxAttempts: number, windowSec: number) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const key = `rate_limit:auth:${request.url}:${ip}`
    try {
      const current = await redis.incr(key)
      if (current === 1) {
        await redis.expire(key, windowSec)
      }
      if (current > maxAttempts) {
        const ttl = await redis.ttl(key)
        reply.header('Retry-After', String(ttl > 0 ? ttl : windowSec))
        return reply.status(429).send({ error: 'Muitas tentativas. Tente novamente mais tarde.' })
      }
    } catch {
      // FAIL CLOSED — block on Redis error
      return reply.status(503).send({ error: 'Serviço temporariamente indisponível' })
    }
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', { preHandler: [await authRateLimit(3, 60)] }, controller.register.bind(controller))
  fastify.post('/login', { preHandler: [await authRateLimit(5, 60)] }, controller.login.bind(controller))
  fastify.get('/profile', { preHandler: [authMiddleware] }, controller.profile.bind(controller))

  // POST /logout - Clear httpOnly auth cookies and revoke refresh token
  fastify.post('/logout', async (request, reply) => {
    const refreshToken = (request.cookies as any)?.refreshToken
    if (refreshToken) {
      await redis.del(`refresh:${refreshToken}`).catch(() => {})
    }
    reply.clearCookie('token', { path: '/' })
    reply.clearCookie('refreshToken', { path: '/api/auth' })
    return reply.send({ success: true })
  })

  // POST /refresh - Rotate refresh token and issue new access token
  fastify.post('/refresh', { preHandler: [await authRateLimit(10, 60)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const oldRefreshToken = (request.cookies as any)?.refreshToken
    if (!oldRefreshToken) {
      return reply.status(401).send({ error: 'Refresh token required' })
    }

    const key = `refresh:${oldRefreshToken}`
    const stored = await redis.get(key)
    if (!stored) {
      // Token already used or expired — possible replay attack, clear cookies
      reply.clearCookie('token', { path: '/' })
      reply.clearCookie('refreshToken', { path: '/api/auth' })
      return reply.status(401).send({ error: 'Invalid refresh token' })
    }

    // Revoke old refresh token immediately (rotation)
    await redis.del(key)

    const { userId } = JSON.parse(stored)
    const fullUser = await loadUserWithRbac(userId)
    if (!fullUser || !fullUser.isActive) {
      return reply.status(401).send({ error: 'User not found or inactive' })
    }

    // Issue new access token
    const newAccessToken = await reply.jwtSign(
      {
        sub: fullUser.id,
        companyId: fullUser.companyId,
        role: fullUser.role,
        name: fullUser.name,
        isSuperAdmin: fullUser.isSuperAdmin,
        permissions: fullUser.permissions,
        conversationScope: fullUser.conversationScope,
        defaultScope: fullUser.defaultScope,
        teamIds: fullUser.teamIds,
      } as any,
      { expiresIn: '8h' }
    )

    // Issue new refresh token (rotation)
    const { randomUUID } = await import('crypto')
    const newRefreshToken = randomUUID()
    await redis.set(`refresh:${newRefreshToken}`, JSON.stringify({ userId, companyId: fullUser.companyId }), 'EX', 30 * 24 * 60 * 60)

    // Set cookies
    const { env } = await import('../../config/env.js')
    reply.setCookie('token', newAccessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 28800,
    })
    reply.setCookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    })

    return reply.send({ token: newAccessToken })
  })

  // GET /plan-limits - Returns current user's plan limits with usage
  fastify.get('/plan-limits', { preHandler: [authMiddleware] }, async (request, reply) => {
    const companyId = (request as any).user?.companyId
    if (!companyId) return reply.status(401).send({ error: 'Não autenticado' })

    try {
      // Fetch company with plan info
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: {
          plan: true,
          planRef: {
            select: {
              id: true,
              name: true,
              slug: true,
              limits: true,
            },
          },
        },
      })

      if (!company?.planRef) {
        return reply.send({ plan: null, limits: {} })
      }

      // Build limits with current usage
      const limits: Record<string, { limit: number; current: number; allowed: boolean }> = {}

      for (const planLimit of company.planRef.limits) {
        try {
          const result = await checkPlanLimit(companyId, planLimit.featureKey)
          limits[planLimit.featureKey] = {
            limit: planLimit.limitValue,
            current: result.current,
            allowed: result.allowed,
          }
        } catch {
          limits[planLimit.featureKey] = { limit: planLimit.limitValue, current: 0, allowed: true }
        }
      }

      return reply.send({
        plan: {
          id: company.planRef.id,
          name: company.planRef.name,
          slug: company.planRef.slug,
        },
        limits,
      })
    } catch (err) {
      request.log.warn({ err }, 'plan-limits: DB error, returning empty plan')
      return reply.send({ plan: null, limits: {} })
    }
  })
}
