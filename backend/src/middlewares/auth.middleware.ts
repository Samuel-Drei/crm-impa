import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../config/database.js'
import { setTenantCompanyId, setTenantBypass } from '../core/tenant-context.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      companyId: string
      role: string
      name: string
      isSuperAdmin: boolean
      permissions: string[]
      conversationScope: string
      defaultScope: string
      teamIds: string[]
    }
    user: {
      id: string
      sub: string
      companyId: string
      role: string
      name: string
      isSuperAdmin: boolean
      permissions: string[]
      conversationScope: string
      defaultScope: string
      teamIds: string[]
    }
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  let authenticated = false

  // 1. Try standard JWT verification (Authorization header or cookie)
  try {
    await request.jwtVerify()
    ;(request.user as any).id = request.user.sub
    if (!request.user.name) {
      const dbUser = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } })
      ;(request.user as any).name = dbUser?.name || 'Usuário'
    }
    authenticated = true
  } catch {
    // 2. Fallback: try token from query parameter (for SSE connections)
    const queryToken = (request.query as any)?.token
    if (queryToken) {
      try {
        const decoded = request.server.jwt.verify(queryToken) as any
        let userName = decoded.name
        if (!userName) {
          const dbUser = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { name: true } })
          userName = dbUser?.name || 'Usuário'
        }
        request.user = {
          id: decoded.sub,
          companyId: decoded.companyId,
          role: decoded.role,
          name: userName,
          isSuperAdmin: decoded.isSuperAdmin || false,
          permissions: decoded.permissions || [],
          conversationScope: decoded.conversationScope || 'OWN',
          defaultScope: decoded.defaultScope || 'OWN',
          teamIds: decoded.teamIds || [],
          sub: decoded.sub,
        } as any
        authenticated = true
      } catch {
        // Token verification failed
      }
    }
  }

  if (!authenticated) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  // Set tenant context for Prisma auto-scope
  if (request.user?.companyId) {
    setTenantCompanyId(request.user.companyId)
  }

  // SEC-BLOCO3: Verify user is still active (covers deactivated users with valid JWT)
  const dbCheck = await prisma.user.findUnique({
    where: { id: request.user.sub || (request.user as any).id },
    select: { isActive: true },
  })
  if (!dbCheck || !dbCheck.isActive) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if ((request.user.role || '').toLowerCase() !== 'admin') {
    reply.status(403).send({ error: 'Forbidden - Admin access required' })
  }
}

export async function superAdminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user.isSuperAdmin) {
    reply.status(403).send({ error: 'Forbidden - Super Admin access required' })
  }
  // Super admin bypasses tenant auto-scope (cross-tenant queries)
  setTenantBypass()
}

export async function apiTokenMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const apiToken = request.headers['x-api-token'] as string

  if (!apiToken) {
    reply.status(401).send({ error: 'API token required' })
    return
  }

  const instance = await prisma.instance.findUnique({
    where: { apiToken },
    include: { company: true }
  })

  if (!instance || !instance.isActive) {
    reply.status(401).send({ error: 'Invalid API token' })
    return
  }

  // Check token expiration
  if (instance.apiTokenExpiresAt && new Date() > instance.apiTokenExpiresAt) {
    reply.status(401).send({ error: 'API token expired' })
    return
  }

  // Set tenant context for Prisma auto-scope
  setTenantCompanyId(instance.companyId)

  request.instance = instance
}

declare module 'fastify' {
  interface FastifyRequest {
    instance?: {
      id: string
      companyId: string
      name: string
      channel: string
      status: string
      company: {
        id: string
        name: string
      }
    }
  }
}
