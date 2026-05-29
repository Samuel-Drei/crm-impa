import { FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'
import { AuthService } from './auth.service.js'
import { registerSchema, loginSchema } from './auth.schemas.js'
import { env } from '../../config/env.js'
import { redis } from '../../config/redis.js'
import { auditLog } from '../../core/audit.service.js'

const authService = new AuthService()

const ACCESS_TOKEN_EXPIRY = '8h'
const REFRESH_TOKEN_EXPIRY_SEC = 30 * 24 * 60 * 60 // 30 days

function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 28800, // 8 hours (matches access token)
  })
}

function setRefreshCookie(reply: FastifyReply, refreshToken: string) {
  reply.setCookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_EXPIRY_SEC,
  })
}

async function createRefreshToken(userId: string, companyId: string): Promise<string> {
  const token = randomUUID()
  const key = `refresh:${token}`
  await redis.set(key, JSON.stringify({ userId, companyId }), 'EX', REFRESH_TOKEN_EXPIRY_SEC)
  return token
}

async function revokeRefreshToken(token: string): Promise<void> {
  await redis.del(`refresh:${token}`)
}

export class AuthController {
  async register(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = registerSchema.parse(request.body)
      const result = await authService.register(data)

      const token = await reply.jwtSign(
        {
          sub: result.user.id,
          companyId: result.company.id,
          role: result.user.role,
          name: result.user.name,
          isSuperAdmin: result.user.isSuperAdmin,
          permissions: result.user.permissions,
          conversationScope: result.user.conversationScope,
          defaultScope: result.user.defaultScope,
          teamIds: result.user.teamIds,
        } as any,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      )

      const refreshToken = await createRefreshToken(result.user.id, result.company.id)
      setAuthCookie(reply, token)
      setRefreshCookie(reply, refreshToken)

      return reply.status(201).send({
        user: result.user,
        company: result.company,
        token,
      })
    } catch (error: any) {
      if (error.message === 'Public signup is disabled') {
        return reply.status(403).send({ error: 'Cadastro público desabilitado' })
      }
      if (error.message === 'Email already registered') {
        return reply.status(409).send({ error: 'Não foi possível criar a conta. Verifique os dados informados.' })
      }
      return reply.status(400).send({ error: 'Erro ao criar conta' })
    }
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = loginSchema.parse(request.body)
      const result = await authService.login(data)

      const token = await reply.jwtSign(
        {
          sub: result.user.id,
          companyId: result.company.id,
          role: result.user.role,
          name: result.user.name,
          isSuperAdmin: result.user.isSuperAdmin,
          permissions: result.user.permissions,
          conversationScope: result.user.conversationScope,
          defaultScope: result.user.defaultScope,
          teamIds: result.user.teamIds,
        } as any,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      )

      const refreshToken = await createRefreshToken(result.user.id, result.company.id)
      setAuthCookie(reply, token)
      setRefreshCookie(reply, refreshToken)

      auditLog(request, { action: 'LOGIN', entity: 'user', entityId: result.user.id })

      return reply.send({
        user: result.user,
        company: result.company,
        token,
        systemStatus: {
          operational: true,
          message: null,
        },
      })
    } catch (error: any) {
      auditLog(request, { action: 'LOGIN_FAILED', entity: 'user', newData: { email: (request.body as any)?.email } })
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
  }

  async profile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const profile = await authService.getProfile(request.user.id)

      // Gerar token atualizado com dados RBAC frescos do DB
      const newToken = await reply.jwtSign(
        {
          sub: profile.id,
          companyId: profile.company.id,
          role: profile.role,
          isSuperAdmin: profile.isSuperAdmin,
          permissions: profile.permissions,
          conversationScope: profile.conversationScope,
          defaultScope: profile.defaultScope,
          teamIds: profile.teamIds,
        } as any,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      )

      setAuthCookie(reply, newToken)

      return reply.send({ ...profile, token: newToken })
    } catch (error: any) {
      return reply.status(404).send({ error: 'Perfil não encontrado' })
    }
  }
}
