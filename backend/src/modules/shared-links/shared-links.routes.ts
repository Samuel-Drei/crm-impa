import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { decryptSafe } from '../../config/encryption.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'

// ── Schemas ─────────────────────────────────────────────
const createLinkSchema = z.object({
  instanceId: z.string().uuid(),
  label: z.string().max(100).optional(),
  password: z.string().min(4).max(100).optional(),
  theme: z.enum(['dark', 'light']).default('dark'),
  expiresInHours: z.number().min(1).max(8760).optional(), // max 1 year
  maxUses: z.number().min(1).max(10000).optional(),
})

const updateLinkSchema = z.object({
  label: z.string().max(100).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  isActive: z.boolean().optional(),
})

// ── Gerar token seguro ──────────────────────────────────
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// ── Rate limiting em Redis ──────────────────────────────
async function checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  try {
    const { redis } = await import('../../config/redis.js')
    const redisKey = `ratelimit:shared:${key}`
    const current = await redis.incr(redisKey)
    if (current === 1) {
      await redis.expire(redisKey, windowSeconds)
    }
    return current <= maxRequests
  } catch {
    return false // SEC-12 fix: FAIL CLOSED - se Redis falhar, bloqueia
  }
}

// ══════════════════════════════════════════════════════════
// ROTAS AUTENTICADAS (CRUD de links)
// ══════════════════════════════════════════════════════════
export async function sharedLinksRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // ── Listar links da instância ──
  fastify.get('/:instanceId/shared-links', {
    preHandler: [requirePermission('instances:manage')],
  }, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string }
    const user = request.user as any

    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, companyId: user.companyId },
    })
    if (!instance) return reply.status(404).send({ error: 'Instância não encontrada' })

    const links = await prisma.sharedInstanceLink.findMany({
      where: { instanceId, companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        token: true,
        label: true,
        theme: true,
        passwordHash: false,
        expiresAt: true,
        maxUses: true,
        currentUses: true,
        isActive: true,
        lastAccessedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    })

    // Adicionar flag hasPassword sem expor hash
    const result = links.map(l => ({
      ...l,
      hasPassword: false, // será preenchido abaixo
    }))

    // Buscar separadamente para saber se tem senha
    const linksWithPw = await prisma.sharedInstanceLink.findMany({
      where: { instanceId, companyId: user.companyId },
      select: { id: true, passwordHash: true },
    })
    const pwMap = new Map(linksWithPw.map(l => [l.id, !!l.passwordHash]))
    result.forEach(l => { l.hasPassword = pwMap.get(l.id) || false })

    return reply.send(result)
  })

  // ── Criar link compartilhado ──
  fastify.post('/:instanceId/shared-links', {
    preHandler: [requirePermission('instances:manage')],
  }, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string }
    const user = request.user as any
    const body = createLinkSchema.parse(request.body)

    if (body.instanceId !== instanceId) {
      return reply.status(400).send({ error: 'instanceId não corresponde' })
    }

    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, companyId: user.companyId, isActive: true },
    })
    if (!instance) return reply.status(404).send({ error: 'Instância não encontrada' })

    const token = generateSecureToken()
    let passwordHash: string | undefined
    if (body.password) {
      passwordHash = await bcrypt.hash(body.password, 12)
    }

    const expiresAt = body.expiresInHours
      ? new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)
      : undefined

    const link = await prisma.sharedInstanceLink.create({
      data: {
        instanceId,
        companyId: user.companyId,
        createdById: user.id,
        token,
        label: body.label,
        passwordHash,
        theme: body.theme,
        expiresAt,
        maxUses: body.maxUses,
      },
    })

    return reply.status(201).send({
      id: link.id,
      token: link.token,
      theme: link.theme,
      label: link.label,
      hasPassword: !!passwordHash,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
    })
  })

  // ── Atualizar link ──
  fastify.patch('/:instanceId/shared-links/:linkId', {
    preHandler: [requirePermission('instances:manage')],
  }, async (request, reply) => {
    const { instanceId, linkId } = request.params as { instanceId: string; linkId: string }
    const user = request.user as any
    const body = updateLinkSchema.parse(request.body)

    const link = await prisma.sharedInstanceLink.findFirst({
      where: { id: linkId, instanceId, companyId: user.companyId },
    })
    if (!link) return reply.status(404).send({ error: 'Link não encontrado' })

    await prisma.sharedInstanceLink.updateMany({
      where: { id: linkId, companyId: user.companyId },
      data: body,
    })
    const updated = await prisma.sharedInstanceLink.findFirst({
      where: { id: linkId, companyId: user.companyId },
    })

    return reply.send(updated)
  })

  // ── Excluir link ──
  fastify.delete('/:instanceId/shared-links/:linkId', {
    preHandler: [requirePermission('instances:manage')],
  }, async (request, reply) => {
    const { instanceId, linkId } = request.params as { instanceId: string; linkId: string }
    const user = request.user as any

    const link = await prisma.sharedInstanceLink.findFirst({
      where: { id: linkId, instanceId, companyId: user.companyId },
    })
    if (!link) return reply.status(404).send({ error: 'Link não encontrado' })

    await prisma.sharedInstanceLink.deleteMany({ where: { id: linkId, companyId: user.companyId } })
    return reply.send({ success: true })
  })
}

// ══════════════════════════════════════════════════════════
// ROTAS PÚBLICAS (sem auth — acesso via token)
// ══════════════════════════════════════════════════════════
export async function sharedLinksPublicRoutes(fastify: FastifyInstance) {

  // ── Buscar info do link (GET público) ──
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string }

    // Validação básica do token
    if (!token || token.length < 20 || !/^[a-f0-9]+$/.test(token)) {
      return reply.status(400).send({ error: 'Token inválido' })
    }

    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip
    const allowed = await checkRateLimit(`access:${ip}`, 60, 60)
    if (!allowed) return reply.status(429).send({ error: 'Muitas requisições. Tente novamente em breve.' })

    const link = await prisma.sharedInstanceLink.findUnique({
      where: { token },
      include: {
        instance: {
          select: {
            id: true,
            name: true,
            status: true,
            channel: true,
            profileName: true,
            profilePicture: true,
          },
        },
      },
    })

    if (!link || !link.isActive) {
      return reply.status(404).send({ error: 'Link não encontrado ou desativado' })
    }

    // Verificar expiração
    if (link.expiresAt && new Date() > link.expiresAt) {
      await prisma.sharedInstanceLink.update({
        where: { id: link.id },
        data: { isActive: false },
      })
      return reply.status(410).send({ error: 'Este link expirou' })
    }

    // Verificar limite de usos
    if (link.maxUses && link.currentUses >= link.maxUses) {
      return reply.status(410).send({ error: 'Este link atingiu o limite de acessos' })
    }

    // Atualizar contadores
    await prisma.sharedInstanceLink.update({
      where: { id: link.id },
      data: {
        currentUses: { increment: 1 },
        lastAccessedAt: new Date(),
        lastAccessedIp: ip,
      },
    })

    // Headers de segurança
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('X-XSS-Protection', '1; mode=block')
    reply.header('Referrer-Policy', 'no-referrer')

    return reply.send({
      instanceName: link.instance.name,
      instanceStatus: link.instance.status,
      profileName: link.instance.profileName,
      profilePicture: link.instance.profilePicture,
      theme: link.theme,
      requiresPassword: !!link.passwordHash,
      label: link.label,
    })
  })

  // ── Verificar senha (POST) ──
  fastify.post('/:token/verify', async (request, reply) => {
    const { token } = request.params as { token: string }
    const { password } = (request.body as any) || {}

    if (!token || token.length < 20 || !/^[a-f0-9]+$/.test(token)) {
      return reply.status(400).send({ error: 'Token inválido' })
    }

    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip
    const allowed = await checkRateLimit(`verify:${ip}:${token}`, 5, 300) // 5 per 5min
    if (!allowed) return reply.status(429).send({ error: 'Muitas tentativas. Aguarde 5 minutos.' })

    const link = await prisma.sharedInstanceLink.findUnique({ where: { token } })

    if (!link || !link.isActive) {
      return reply.status(404).send({ error: 'Link não encontrado' })
    }

    if (!link.passwordHash) {
      return reply.send({ verified: true })
    }

    if (!password) {
      return reply.status(401).send({ error: 'Senha obrigatória' })
    }

    const valid = await bcrypt.compare(password, link.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Senha incorreta' })
    }

    return reply.send({ verified: true })
  })

  // ── Gerar QR Code (POST) ──
  fastify.post('/:token/qr', async (request, reply) => {
    const { token } = request.params as { token: string }
    const { password } = (request.body as any) || {}

    if (!token || token.length < 20 || !/^[a-f0-9]+$/.test(token)) {
      return reply.status(400).send({ error: 'Token inválido' })
    }

    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip
    const allowed = await checkRateLimit(`qr:${ip}:${token}`, 30, 120) // 30 per 2min
    if (!allowed) return reply.status(429).send({ error: 'Muitas requisições de QR. Aguarde.' })

    const link = await prisma.sharedInstanceLink.findUnique({
      where: { token },
      include: {
        instance: true,
      },
    })

    if (!link || !link.isActive) {
      return reply.status(404).send({ error: 'Link não encontrado' })
    }

    // Verificar expiração
    if (link.expiresAt && new Date() > link.expiresAt) {
      return reply.status(410).send({ error: 'Link expirado' })
    }

    // Verificar senha se necessário
    if (link.passwordHash) {
      if (!password) return reply.status(401).send({ error: 'Senha obrigatória' })
      const valid = await bcrypt.compare(password, link.passwordHash)
      if (!valid) return reply.status(401).send({ error: 'Senha incorreta' })
    }

    const instance = link.instance

    try {
      if (instance.channel === 'EVO_GO') {
        const { EvoGoProvider } = await import('../../providers/evo-go/evo-go.provider.js')
        const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string })

        // Verificar se já está conectado (PascalCase do Evo Go)
        try {
          const statusResult = await evoGo.getConnectionStatus()
          const statusData = statusResult?.data || statusResult
          const isConnected = statusData?.Connected === true || statusData?.connected === true
          const isLoggedIn = statusData?.LoggedIn === true || statusData?.loggedIn === true
          const state = statusData?.state || statusData?.instance?.state
          if ((isConnected && isLoggedIn) || state === 'open' || state === 'connected') {
            return reply.send({ qrCode: null, status: 'CONNECTED' })
          }
        } catch {}

        const qrResult = await evoGo.getQRCode()
        const qrData = qrResult?.data || qrResult
        let qrCode = qrData?.qrcode || qrData?.Qrcode || qrData?.base64 || null

        if (qrCode && qrCode.includes('|')) {
          qrCode = qrCode.split('|')[0]
        }
        if (qrCode && !qrCode.startsWith('data:')) {
          qrCode = `data:image/png;base64,${qrCode}`
        }

        // Salvar QR no DB para cache
        if (qrCode) {
          await prisma.instance.update({
            where: { id: instance.id },
            data: { qrCode, status: 'CONNECTING' },
          }).catch(() => {})
        }

        return reply.send({ qrCode, status: qrCode ? 'CONNECTING' : 'WAITING' })

      } else if (instance.channel === 'BAILEYS') {
        const { baileysManager } = await import('../../server.js')
        let qrCode = baileysManager.getQRCode(instance.id)

        if (!qrCode) {
          // Buscar do DB
          const fresh = await prisma.instance.findUnique({
            where: { id: instance.id },
            select: { qrCode: true, status: true },
          })
          if (fresh?.status === 'CONNECTED') {
            return reply.send({ qrCode: null, status: 'CONNECTED' })
          }
          qrCode = fresh?.qrCode || undefined
        }

        return reply.send({ qrCode, status: qrCode ? 'CONNECTING' : 'WAITING' })

      } else {
        return reply.status(400).send({ error: 'Canal não suporta QR Code' })
      }
    } catch (err: any) {
      return reply.status(500).send({ error: 'Erro ao gerar QR Code' })
    }
  })

  // ── Status da instância (GET) ──
  fastify.get('/:token/status', async (request, reply) => {
    const { token } = request.params as { token: string }

    if (!token || token.length < 20 || !/^[a-f0-9]+$/.test(token)) {
      return reply.status(400).send({ error: 'Token inválido' })
    }

    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip
    const allowed = await checkRateLimit(`status:${ip}`, 120, 60)
    if (!allowed) return reply.status(429).send({ error: 'Muitas requisições' })

    const link = await prisma.sharedInstanceLink.findUnique({
      where: { token },
      include: {
        instance: {
          select: { id: true, status: true, profileName: true, profilePicture: true, phoneNumber: true },
        },
      },
    })

    if (!link || !link.isActive) {
      return reply.status(404).send({ error: 'Link não encontrado' })
    }

    return reply.send({
      status: link.instance.status,
      profileName: link.instance.profileName,
      phoneNumber: link.instance.phoneNumber,
    })
  })
}
