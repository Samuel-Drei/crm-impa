import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/database.js'
import { ensureCompanyRoles, getRoleId } from '../rbac/rbac.helpers.js'
import { env } from '../../config/env.js'

const setupSchema = z.object({
  companyName: z.string().min(2),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
})

export async function installationRoutes(fastify: FastifyInstance) {
  // Check if setup is needed (no users exist)
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const userCount = await prisma.user.count()
    return reply.send({
      setupRequired: userCount === 0,
    })
  })

  // Public config - returns safe-to-expose system settings (NO AUTH)
  fastify.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Only expose specific keys that are safe for the public
    const PUBLIC_KEYS = ['ENABLE_PUBLIC_SIGNUP']
    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
    })
    const map: Record<string, string> = {}
    for (const s of settings) map[s.key] = s.value
    // Defaults: signup disabled if setting doesn't exist
    return reply.send({
      signupEnabled: map['ENABLE_PUBLIC_SIGNUP'] === 'true',
    })
  })

  // Create super admin (only works if no users exist)
  fastify.post('/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      return reply.status(403).send({ error: 'Setup already completed. Users already exist.' })
    }

    const data = setupSchema.parse(request.body)
    const hashedPassword = await bcrypt.hash(data.password, 12)

    // 1. Criar empresa
    const company = await prisma.company.create({
      data: {
        name: data.companyName,
        email: data.email,
      },
    })

    // 2. Criar roles SYSTEM
    await ensureCompanyRoles(company.id)
    const adminRoleId = await getRoleId(company.id, 'admin')

    // 3. Criar usuário super admin
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        companyId: company.id,
        roleId: adminRoleId,
        isSuperAdmin: true,
      },
      include: { rbacRole: true },
    })

    const token = await fastify.jwt.sign(
      {
        sub: user.id,
        companyId: company.id,
        role: user.rbacRole.slug,
        name: user.name,
      } as any,
      { expiresIn: '7d' }
    )

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return reply.status(201).send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.rbacRole.slug,
      },
      company: {
        id: company.id,
        name: company.name,
      },
      token,
    })
  })
}
