import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import axios from 'axios'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { baileysManager, io } from '../../server.js'
import { CloudAPIProvider } from '../../providers/cloud-api/cloud-api.provider.js'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'
import { getRateLimitInfo } from '../../middlewares/rate-limit.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { enforcePlanLimit } from '../../middlewares/plan-limit.middleware.js'
import { instanceRoom } from '../../config/socket-rooms.js'
import { encrypt, decryptSafe, type EncryptionContext } from '../../config/encryption.js'
import { runHistoryImport } from '../messages/import-history.helper.js'

// ── Encryption helpers for Instance secrets ──
function encryptInstanceField(value: string | undefined | null, companyId: string, field: string, recordId: string): string | undefined {
  if (!value) return undefined
  return encrypt(value, { companyId, model: 'Instance', field, recordId })
}
function decryptInstanceSecrets<T extends Record<string, any>>(instance: T): T {
  const copy = { ...instance } as any
  if (copy.accessToken) copy.accessToken = decryptSafe(copy.accessToken) as string
  if (copy.webhookSecret) copy.webhookSecret = decryptSafe(copy.webhookSecret) as string
  if (copy.evoApiKey) copy.evoApiKey = decryptSafe(copy.evoApiKey) as string
  return copy
}

const pendingStatusBasedHistoryImports = new Set<string>()

function queueStatusBasedHistoryImport(instance: {
  id: string
  companyId: string
  evoApiKey: string | null
  evoApiUrl: string | null
  evoInstanceId: string | null
  historySyncedAt?: Date | null
}) {
  if (pendingStatusBasedHistoryImports.has(instance.id)) {
    return
  }

  pendingStatusBasedHistoryImports.add(instance.id)

  setImmediate(async () => {
    try {
      const latestInstance = await prisma.instance.findUnique({
        where: { id: instance.id },
        select: { historySyncedAt: true },
      })

      if (latestInstance?.historySyncedAt) {
        const importedMessages = await prisma.message.count({
          where: { instanceId: instance.id, createdAt: { lte: latestInstance.historySyncedAt } },
        })
        if (importedMessages > 0) return
        console.log(`[Evo Go Status] Histórico estava marcado como sincronizado sem mensagens; tentando novamente para ${instance.id}`)
      }

      const result = await runHistoryImport(instance)
      if (result.total === 0) {
        console.log(`[Evo Go Status] Histórico ainda vazio para ${instance.id}; não marquei como sincronizado`)
      } else {
        console.log(`[Evo Go Status] Histórico importado para ${instance.id}: ${result.imported}/${result.total} msgs, ${result.conversations} conversas`)
      }
    } catch (err: any) {
      console.error(`[Evo Go Status] Erro ao importar histórico para ${instance.id}:`, err.message)
    } finally {
      pendingStatusBasedHistoryImports.delete(instance.id)
    }
  })
}

const createInstanceSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  channel: z.enum(['BAILEYS', 'WHATSMEOW', 'CLOUD_API', 'COEXISTENCE', 'EVO_GO']).default('EVO_GO'),
  webhookUrl: z.string().url().optional(),
  webhookEvents: z.array(z.string()).optional(),
  // Cloud API fields
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  // Evo Go fields
  evoApiUrl: z.string().optional(),
  evoInstanceId: z.string().optional(),
  evoApiKey: z.string().optional(),
})

const updateInstanceSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  webhookUrl: z.string().optional().nullable().transform(v => v === '' ? null : v),
  webhookEvents: z.array(z.string()).optional(),
  rejectCalls: z.boolean().optional(),
  ignoreGroups: z.boolean().optional(),
  ignoreBroadcasts: z.boolean().optional(),
  ignoreStatus: z.boolean().optional(),
  alwaysOnline: z.boolean().optional(),
  readMessages: z.boolean().optional(),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  // Evo Go fields
  evoApiUrl: z.string().optional(),
  evoInstanceId: z.string().optional(),
  evoApiKey: z.string().optional(),
})

const cloudApiConfigSchema = z.object({
  wabaId: z.string().optional(),
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  webhookSecret: z.string().optional(),
})

// Schema para Embedded Signup (Coexistence)
const embeddedSignupSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
})

// Schema para configuração Evo Go
const evoGoConfigSchema = z.object({
  evoApiUrl: z.string().min(1),
  evoInstanceId: z.string().min(1),
  evoApiKey: z.string().min(1),
})

export async function instanceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // SEC-04 fix: safe select that excludes sensitive credentials
  const safeInstanceSelect = {
    id: true,
    name: true,
    description: true,
    channel: true,
    status: true,
    phoneNumber: true,
    profileName: true,
    profilePicture: true,
    messagesSent: true,
    messagesReceived: true,
    createdAt: true,
    apiToken: true,  // Instance's own API token (admin manages it)
    // Cloud API - only non-secret fields
    wabaId: true,
    phoneNumberId: true,
    // Evo Go - only non-secret fields
    evoApiUrl: true,
    evoInstanceId: true,
    // Webhook config (URL is not secret)
    webhookUrl: true,
    webhookEvents: true,
    // Behavior settings
    rejectCalls: true,
    ignoreGroups: true,
    ignoreBroadcasts: true,
    ignoreStatus: true,
    alwaysOnline: true,
    readMessages: true,
    qrCode: true,
    isActive: true,
    // NOTE: accessToken, evoApiKey, webhookSecret are EXCLUDED
  } as const

  // Get system status
  fastify.get('/system-status', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      operational: true,
      message: null,
      evoGoConfigured: !!(env.EVO_GO_API_URL && env.EVO_GO_GLOBAL_API_KEY),
    })
  })

  // List instances
  fastify.get('/', { preHandler: [requirePermission('instances:read')] }, async (request: FastifyRequest, reply: FastifyReply) => {

    const instances = await prisma.instance.findMany({
      where: {
        companyId: request.user.companyId,
        isActive: true,
      },
      select: {
        ...safeInstanceSelect,
        // Include has* indicators so frontend knows if configured
        typebotIntegration: true,
        n8nIntegration: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send(instances)
  })

  // Get instance by ID
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('instances:read')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: {
        id,
        companyId: request.user.companyId,
        isActive: true,
      },
      select: {
        ...safeInstanceSelect,
        typebotIntegration: true,
        n8nIntegration: true,
      },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    return reply.send(instance)
  })

  // Create instance
  fastify.post('/', { preHandler: [requirePermission('instances:manage'), enforcePlanLimit('maxInstances')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = createInstanceSchema.parse(request.body)

    // Canais em manutenção - bloquear criação
    const maintenanceChannels = ['BAILEYS', 'WHATSMEOW']
    if (maintenanceChannels.includes(data.channel)) {
      return reply.status(400).send({
        error: `O canal ${data.channel} está em manutenção. Por favor, utilize Cloud API, Coexistence ou Evo Go.`
      })
    }

    // Se canal é EVO_GO e temos config global, criar instância automaticamente na Evo Go
    let evoData: { evoApiUrl?: string; evoInstanceId?: string; evoApiKey?: string } = {}
    if (data.channel === 'EVO_GO') {
      const evoApiUrl = data.evoApiUrl || env.EVO_GO_API_URL
      const globalApiKey = env.EVO_GO_GLOBAL_API_KEY

      if (evoApiUrl && globalApiKey && !data.evoInstanceId) {
        // Criar instância automaticamente na Evo Go
        try {
          const evoResult = await EvoGoProvider.createInstance(evoApiUrl, globalApiKey, data.name)
          console.log('[Evo Go] Instância criada automaticamente:', evoResult)

          evoData = {
            evoApiUrl: evoApiUrl,
            evoInstanceId: evoResult.instanceId,
            evoApiKey: evoResult.instanceToken,
          }
        } catch (error: any) {
          console.error('[Evo Go] Erro ao criar instância:', error.message)
          return reply.status(500).send({ error: 'Erro ao criar instância. Verifique as configurações da Evo Go.' })
        }
      } else if (data.evoApiUrl && data.evoInstanceId && data.evoApiKey) {
        // Config manual passada durante criação
        evoData = {
          evoApiUrl: data.evoApiUrl,
          evoInstanceId: data.evoInstanceId,
          evoApiKey: data.evoApiKey,
        }
      } else if (!evoApiUrl || !globalApiKey) {
        return reply.status(400).send({
          error: 'Para criar instância Evo Go é necessário configurar EVO_GO_API_URL e EVO_GO_GLOBAL_API_KEY no ambiente, ou informar as credenciais manualmente.'
        })
      }
    }

    const instanceId = uuid()
    const companyId = request.user.companyId

    // Encrypt evoData secrets if present
    if (evoData?.evoApiKey) {
      evoData.evoApiKey = encryptInstanceField(evoData.evoApiKey, companyId, 'evoApiKey', instanceId)!
    }

    const instance = await prisma.instance.create({
      data: {
        id: instanceId,
        name: data.name,
        description: data.description,
        channel: data.channel,
        companyId,
        apiToken: uuid(),
        webhookEvents: data.webhookEvents || ['message.received', 'message.sent'],
        webhookUrl: data.webhookUrl,
        // Cloud API fields
        wabaId: data.wabaId,
        phoneNumberId: data.phoneNumberId,
        accessToken: encryptInstanceField(data.accessToken, companyId, 'accessToken', instanceId),
        // Evo Go fields (auto ou manual)
        ...evoData,
      },
      select: safeInstanceSelect,
    })

    return reply.status(201).send(instance)
  })

  // Update instance
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params
    const data = updateInstanceSchema.parse(request.body)

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    // Encrypt sensitive fields before update
    const encData: any = { ...data }
    if (encData.accessToken) encData.accessToken = encryptInstanceField(encData.accessToken, request.user.companyId, 'accessToken', id)
    if (encData.evoApiKey) encData.evoApiKey = encryptInstanceField(encData.evoApiKey, request.user.companyId, 'evoApiKey', id)

    const updated = await prisma.instance.update({
      where: { id },
      data: encData,
      select: {
        ...safeInstanceSelect,
        // Need these for Evo Go settings sync below
        evoApiKey: true,
      },
    })

    // Sync behavior settings with Evo Go API if applicable
    if (instance.channel === 'EVO_GO' && instance.evoApiUrl && instance.evoApiKey && instance.evoInstanceId) {
      const hasSettingsChange = data.rejectCalls !== undefined || data.ignoreGroups !== undefined ||
        data.ignoreStatus !== undefined || data.alwaysOnline !== undefined || data.readMessages !== undefined
      if (hasSettingsChange) {
        try {
          const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
          await evoGo.updateAdvancedSettings({
            rejectCall: updated.rejectCalls,
            ignoreGroups: updated.ignoreGroups,
            ignoreStatus: updated.ignoreStatus,
            alwaysOnline: updated.alwaysOnline,
            readMessages: updated.readMessages,
          })
        } catch (err: any) {
          console.error('[EvoGo] Erro ao sincronizar settings:', err.message)
        }
      }
    }

    // Strip evoApiKey before returning to client
    const { evoApiKey: _evoKey, ...safeUpdated } = updated
    return reply.send(safeUpdated)
  })

  // Get Evo Go advanced settings
  fastify.get<{ Params: { id: string } }>('/:id/evo-settings', { preHandler: [requirePermission('instances:read')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel !== 'EVO_GO' || !instance.evoApiUrl || !instance.evoApiKey || !instance.evoInstanceId) {
      return reply.status(400).send({ error: 'Instância não é EVO_GO ou não tem credenciais configuradas' })
    }

    try {
      const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
      const settings = await evoGo.getAdvancedSettings()
      return reply.send({
        rejectCalls: settings.rejectCall ?? false,
        ignoreGroups: settings.ignoreGroups ?? false,
        ignoreStatus: settings.ignoreStatus ?? false,
        alwaysOnline: settings.alwaysOnline ?? false,
        readMessages: settings.readMessages ?? false,
      })
    } catch (err: any) {
      console.error('[EvoGo] Erro ao buscar settings:', err.message)
      return reply.send({
        rejectCalls: instance.rejectCalls,
        ignoreGroups: instance.ignoreGroups,
        ignoreStatus: instance.ignoreStatus,
        alwaysOnline: instance.alwaysOnline,
        readMessages: instance.readMessages,
      })
    }
  })

  // Update Cloud API configuration
  fastify.put<{ Params: { id: string } }>('/:id/cloud-api-config', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params
    const data = cloudApiConfigSchema.parse(request.body)

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel !== 'CLOUD_API' && instance.channel !== 'COEXISTENCE') {
      return reply.status(400).send({ error: 'This configuration is only for Cloud API or Coexistence instances' })
    }

    // Try to fetch phone number info from Meta
    let phoneNumber: string | null = null
    let profileName: string | null = null

    try {
      const cloudApi = new CloudAPIProvider({
        phoneNumberId: data.phoneNumberId,
        accessToken: data.accessToken,
      })
      const phoneInfo = await cloudApi.getPhoneNumberInfo()
      phoneNumber = phoneInfo.display_phone_number?.replace(/\D/g, '') || null
      profileName = phoneInfo.verified_name || null
    } catch (error: any) {
      console.error('Error fetching phone info from Meta:', error.message)
    }

    const updated = await prisma.instance.update({
      where: { id },
      data: {
        wabaId: data.wabaId,
        phoneNumberId: data.phoneNumberId,
        accessToken: encryptInstanceField(data.accessToken, request.user.companyId, 'accessToken', id),
        webhookSecret: encryptInstanceField(data.webhookSecret, request.user.companyId, 'webhookSecret', id),
        phoneNumber,
        profileName,
        status: 'CONNECTED',
      },
      select: safeInstanceSelect,
    })

    return reply.send(updated)
  })

  // Configurar Evo Go
  fastify.put<{ Params: { id: string } }>('/:id/evo-go-config', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params
    const data = evoGoConfigSchema.parse(request.body)

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instância não encontrada' })
    }

    if (instance.channel !== 'EVO_GO') {
      return reply.status(400).send({ error: 'Esta configuração é apenas para instâncias Evo Go' })
    }

    // Testar conexão com a Evo Go e configurar webhook
    let phoneNumber: string | null = null
    let profileName: string | null = null

    try {
      const evoGo = new EvoGoProvider({
        evoApiUrl: data.evoApiUrl,
        evoInstanceId: data.evoInstanceId,
        evoApiKey: data.evoApiKey,
      })

      // Conectar com webhook automático (usar BACKEND_INTERNAL_URL para Docker-to-Docker)
      const backendUrl = process.env.BACKEND_INTERNAL_URL || env.BACKEND_URL || `http://localhost:${env.PORT}`
      const webhookUrl = `${backendUrl}/api/webhook/evo-go/${id}`
      try {
        await evoGo.connectInstance(webhookUrl, ['ALL'])
        console.log(`[Evo Go Config] Webhook configurado: ${webhookUrl}`)
      } catch (error: any) {
        console.log('[Evo Go Config] Aviso ao configurar webhook (instância pode já estar conectada):', error.message)
      }

      const statusResult = await evoGo.getConnectionStatus()
      const statusData = statusResult?.data || statusResult
      console.log('[Evo Go Config] Status da instância:', JSON.stringify(statusData))

      // Extrair número e nome do perfil
      // GET /instance/status retorna PascalCase: { Connected, LoggedIn, Name }
      if (statusData?.Name || statusData?.name) {
        profileName = statusData.Name || statusData.name
      }
      // O endpoint /status não retorna JID, buscar do /instance/all
      if (env.EVO_GO_GLOBAL_API_KEY && data.evoApiUrl && data.evoInstanceId) {
        try {
          const allInstances = await EvoGoProvider.listInstances(data.evoApiUrl, env.EVO_GO_GLOBAL_API_KEY)
          const evoInstance = allInstances.find((i: any) => i.id === data.evoInstanceId)
          if (evoInstance?.jid) {
            phoneNumber = evoInstance.jid.replace('@s.whatsapp.net', '').replace(/:.*/, '').replace(/\D/g, '')
          }
        } catch (e: any) {
          console.log('[Evo Go Config] Erro ao buscar /instance/all:', e.message)
        }
      }
    } catch (error: any) {
      console.error('[Evo Go Config] Erro ao verificar conexão:', error.message)
      // Não bloquear - salvar mesmo assim, pode estar desconectada
    }

    const updated = await prisma.instance.update({
      where: { id },
      data: {
        evoApiUrl: data.evoApiUrl,
        evoInstanceId: data.evoInstanceId,
        evoApiKey: encryptInstanceField(data.evoApiKey, request.user.companyId, 'evoApiKey', id),
        ...(phoneNumber && { phoneNumber }),
        ...(profileName && { profileName }),
        status: phoneNumber ? 'CONNECTED' : instance.status,
      },
      select: safeInstanceSelect,
    })

    return reply.send(updated)
  })

  // Sync templates from Meta
  fastify.post<{ Params: { id: string } }>('/:id/sync-templates', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel !== 'CLOUD_API' && instance.channel !== 'COEXISTENCE') {
      return reply.status(400).send({ error: 'Templates sync is only for Cloud API or Coexistence instances' })
    }

    if (!instance.wabaId || !instance.accessToken) {
      return reply.status(400).send({ error: 'Cloud API credentials not configured' })
    }

    try {
      const cloudApi = new CloudAPIProvider({
        phoneNumberId: instance.phoneNumberId,
        accessToken: instance.accessToken,
      })

      const metaTemplates = await cloudApi.getTemplates(instance.wabaId)

      // Get list of template names from Meta
      const metaTemplateNames = metaTemplates.map((t: any) => t.name)

      // Sync templates to database
      let synced = 0
      for (const template of metaTemplates) {
        const status = template.status === 'APPROVED' ? 'APPROVED'
          : template.status === 'REJECTED' ? 'REJECTED'
          : 'PENDING'

        // Extract components
        const components = template.components || []
        const header = components.find((c: any) => c.type === 'HEADER')
        const body = components.find((c: any) => c.type === 'BODY')
        const footer = components.find((c: any) => c.type === 'FOOTER')
        const buttons = components.find((c: any) => c.type === 'BUTTONS')

        await prisma.template.upsert({
          where: {
            companyId_name: {
              companyId: instance.companyId,
              name: template.name,
            },
          },
          update: {
            status,
            category: template.category || 'MARKETING',
            language: template.language || 'pt_BR',
            headerType: header?.format || null,
            headerContent: header?.text || header?.example?.header_handle?.[0] || null,
            bodyText: body?.text || '',
            footerText: footer?.text || null,
            buttons: buttons?.buttons || null,
            metaId: template.id,
          },
          create: {
            companyId: instance.companyId,
            name: template.name,
            status,
            category: template.category || 'MARKETING',
            language: template.language || 'pt_BR',
            headerType: header?.format || null,
            headerContent: header?.text || header?.example?.header_handle?.[0] || null,
            bodyText: body?.text || '',
            footerText: footer?.text || null,
            buttons: buttons?.buttons || null,
            metaId: template.id,
          },
        })
        synced++
      }

      // Delete templates that no longer exist in Meta
      const deleted = await prisma.template.deleteMany({
        where: {
          companyId: instance.companyId,
          name: { notIn: metaTemplateNames },
        },
      })

      return reply.send({
        success: true,
        message: `${synced} templates sincronizados, ${deleted.count} removidos`,
        total: metaTemplates.length,
        removed: deleted.count
      })
    } catch (error: any) {
      console.error('Error syncing templates:', error)
      return reply.status(500).send({ error: 'Erro ao sincronizar templates' })
    }
  })

  // Delete instance
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel === 'BAILEYS') {
      try {
        await baileysManager.logoutInstance(id)
      } catch (error) {
        console.error('Erro ao fazer logout:', error)
      }
    } else if (instance.channel === 'EVO_GO') {
      // Tentar logout + deletar na Evo Go
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        await evoGo.logoutInstance()
      } catch (error) {
        console.error('[Evo Go] Erro ao fazer logout na exclusão:', error)
      }
      // Tentar deletar via admin API se temos global key
      if (env.EVO_GO_GLOBAL_API_KEY && instance.evoApiUrl && instance.evoInstanceId) {
        try {
          await EvoGoProvider.deleteInstance(instance.evoApiUrl, env.EVO_GO_GLOBAL_API_KEY, instance.evoInstanceId)
          console.log(`[Evo Go] Instância ${instance.evoInstanceId} deletada na Evo Go`)
        } catch (error: any) {
          console.error('[Evo Go] Erro ao deletar instância na Evo Go:', error.message)
        }
      }
    }

    await prisma.instance.update({
      where: { id },
      data: { isActive: false },
    })

    return reply.status(204).send()
  })

  // Connect instance (Baileys - generates QR code)
  fastify.post<{ Params: { id: string } }>('/:id/connect', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId, isActive: true },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel === 'BAILEYS') {
      try {
        await baileysManager.initInstance(id)
        return reply.send({ message: 'Conexão iniciada. Aguardando QR Code.' })
      } catch (error: any) {
        console.error('[Baileys] Erro ao iniciar conexão:', error.message)
        return reply.status(500).send({ error: 'Erro ao iniciar conexão da instância' })
      }
    } else if (instance.channel === 'EVO_GO') {
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        // Montar webhook URL acessível pelo container Evo Go (usar BACKEND_INTERNAL_URL para Docker-to-Docker)
        const backendUrl = process.env.BACKEND_INTERNAL_URL || env.BACKEND_URL || `http://localhost:${env.PORT}`
        const webhookUrl = `${backendUrl}/api/webhook/evo-go/${instance.id}`
        const result = await evoGo.connectInstance(webhookUrl, ['ALL'])
        console.log(`[Evo Go] Conectado com webhook: ${webhookUrl}`)

        // Atualizar status para CONNECTING imediatamente
        await prisma.instance.update({
          where: { id },
          data: { status: 'CONNECTING' },
        })

        // Buscar QR code diretamente da API (tentar algumas vezes)
        let qrObtained = false
        for (let attempt = 0; attempt < 3 && !qrObtained; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          try {
            const qrResult = await evoGo.getQRCode()
            const qrData = qrResult?.data || qrResult
            let qrCode = qrData?.qrcode || qrData?.Qrcode || qrData?.base64
            if (qrCode) {
              // Evo Go armazena QR no formato "base64|code" - extrair apenas o base64
              if (qrCode.includes('|')) {
                qrCode = qrCode.split('|')[0]
              }
              await prisma.instance.update({
                where: { id },
                data: { qrCode, status: 'CONNECTING' },
              })
              io.to(instanceRoom(request.user.companyId, id)).emit('qr-code', { instanceId: id, qrCode })
              console.log(`[Evo Go] QR Code obtido (tentativa ${attempt + 1}) e emitido via socket`)
              qrObtained = true
            } else {
              console.log(`[Evo Go] QR code vazio na tentativa ${attempt + 1}:`, JSON.stringify(qrResult).substring(0, 200))
            }
          } catch (qrError: any) {
            console.log(`[Evo Go] QR code não disponível na tentativa ${attempt + 1}: ${qrError.message}`)
          }
        }

        if (!qrObtained) {
          console.log(`[Evo Go] QR code será recebido via webhook`)
        }

        return reply.send({ message: 'Conexão Evo Go iniciada. Webhook configurado automaticamente.', data: result })
      } catch (error: any) {
        console.error('[Evo Go] Erro na conexão:', error.message)
        return reply.status(500).send({ error: 'Erro ao conectar instância Evo Go' })
      }
    } else {
      return reply.status(400).send({ error: 'Este canal não suporta conexão via QR code' })
    }
  })

  // Restart instance (disconnect and reconnect - generates new QR code)
  fastify.post<{ Params: { id: string } }>('/:id/restart', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId, isActive: true },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel === 'BAILEYS') {
      try {
        await baileysManager.disconnectInstance(id)
        await new Promise(resolve => setTimeout(resolve, 1000))
        await baileysManager.initInstance(id)
        return reply.send({ message: 'Instância reiniciada. Aguardando QR Code.' })
      } catch (error: any) {
        console.error('[Baileys] Erro ao reiniciar:', error.message)
        return reply.status(500).send({ error: 'Erro ao reiniciar instância' })
      }
    } else if (instance.channel === 'EVO_GO') {
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        await evoGo.disconnectInstance()
        await new Promise(resolve => setTimeout(resolve, 1000))
        const result = await evoGo.reconnectInstance()
        return reply.send({ message: 'Instância Evo Go reiniciada.', data: result })
      } catch (error: any) {
        console.error('[Evo Go] Erro ao reiniciar:', error.message)
        return reply.status(500).send({ error: 'Erro ao reiniciar instância' })
      }
    } else {
      return reply.status(400).send({ error: 'Este canal não suporta reinício' })
    }
  })

  // Disconnect instance
  fastify.post<{ Params: { id: string } }>('/:id/disconnect', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel === 'BAILEYS') {
      await baileysManager.disconnectInstance(id)
    } else if (instance.channel === 'EVO_GO') {
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        try {
          await evoGo.disconnectInstance()
        } catch (disconnectError: any) {
          console.log('[Evo Go] disconnect falhou, tentando logout:', disconnectError.message)
          try {
            await evoGo.logoutInstance()
          } catch (logoutError: any) {
            console.error('[Evo Go] Erro ao desconectar/logout:', logoutError.message)
          }
        }
      } catch (error: any) {
        console.error('[Evo Go] Erro ao criar provider:', error.message)
      }
    }

    await prisma.instance.update({
      where: { id },
      data: { status: 'DISCONNECTED', qrCode: null },
    })

    return reply.send({ message: 'Instância desconectada' })
  })

  // Logout instance (removes session)
  fastify.post<{ Params: { id: string } }>('/:id/logout', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel === 'BAILEYS') {
      await baileysManager.logoutInstance(id)
    } else if (instance.channel === 'EVO_GO') {
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        await evoGo.logoutInstance()
      } catch (error: any) {
        console.error('[Evo Go] Erro ao fazer logout:', error.message)
      }
    }

    await prisma.instance.update({
      where: { id },
      data: { status: 'DISCONNECTED', qrCode: null },
    })

    return reply.send({ message: 'Logout realizado' })
  })

  // Get QR code
  fastify.get<{ Params: { id: string } }>('/:id/qrcode', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    // Para Evo Go: buscar QR direto da API (igual o Manager faz)
    if (instance.channel === 'EVO_GO') {
      try {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))

        // Primeiro verificar se já conectou
        // GET /instance/status retorna: { message, data: { Connected, LoggedIn, Name } } (PascalCase!)
        try {
          const statusResult = await evoGo.getConnectionStatus()
          const statusData = statusResult?.data || statusResult
          console.log('[Evo Go] Status check:', JSON.stringify(statusData))
          const isConnected = statusData?.Connected === true || statusData?.connected === true
          const isLoggedIn = statusData?.LoggedIn === true || statusData?.loggedIn === true
          if (isConnected && isLoggedIn) {
            // Já conectou! Buscar phone/name do /instance/all (status não tem myJid)
            let phoneNumber: string | null = null
            let profileName: string | null = statusData?.Name || statusData?.name || null
            if (env.EVO_GO_GLOBAL_API_KEY && instance.evoApiUrl && instance.evoInstanceId) {
              try {
                const allInstances = await EvoGoProvider.listInstances(instance.evoApiUrl, env.EVO_GO_GLOBAL_API_KEY)
                const evoInstance = allInstances.find((i: any) => i.id === instance.evoInstanceId)
                if (evoInstance?.jid) {
                  phoneNumber = evoInstance.jid.replace('@s.whatsapp.net', '').replace(/:.*/, '').replace(/\D/g, '')
                }
                if (evoInstance?.name && !profileName) {
                  profileName = evoInstance.name
                }
              } catch (e: any) {
                console.log('[Evo Go] Não conseguiu buscar detalhes via /instance/all:', e.message)
              }
            }
            await prisma.instance.update({
              where: { id },
              data: {
                status: 'CONNECTED',
                qrCode: null,
                ...(phoneNumber && { phoneNumber }),
                ...(profileName && { profileName }),
              },
            })
            // Emitir status-update via socket para atualizar a UI imediatamente
            io.to(instanceRoom(request.user.companyId, id)).emit('status-update', {
              instanceId: id,
              status: 'CONNECTED',
              phoneNumber,
              profileName,
            })
            queueStatusBasedHistoryImport(instance)
            return reply.send({ qrCode: null, status: 'CONNECTED', phoneNumber, profileName })
          }
        } catch (statusErr: any) {
          console.log('[Evo Go] Erro ao verificar status via /instance/status:', statusErr.message)
          // Fallback: usar admin endpoint /instance/all (como o Manager faz)
          if (env.EVO_GO_GLOBAL_API_KEY && instance.evoApiUrl && instance.evoInstanceId) {
            try {
              const allInstances = await EvoGoProvider.listInstances(instance.evoApiUrl, env.EVO_GO_GLOBAL_API_KEY)
              const evoInstance = allInstances.find((i: any) => i.id === instance.evoInstanceId || i.name === instance.name)
              if (evoInstance?.connected === true) {
                const phoneNumber = evoInstance.jid?.replace('@s.whatsapp.net', '')?.replace(/:.*/, '')?.replace(/\D/g, '') || null
                const profileName = evoInstance.name || null
                await prisma.instance.update({
                  where: { id },
                  data: {
                    status: 'CONNECTED',
                    qrCode: null,
                    ...(phoneNumber && { phoneNumber }),
                    ...(profileName && { profileName }),
                  },
                })
                io.to(instanceRoom(request.user.companyId, id)).emit('status-update', {
                  instanceId: id,
                  status: 'CONNECTED',
                  phoneNumber,
                  profileName,
                })
                queueStatusBasedHistoryImport(instance)
                return reply.send({ qrCode: null, status: 'CONNECTED', phoneNumber, profileName })
              }
            } catch (allErr: any) {
              console.log('[Evo Go] Fallback /instance/all também falhou:', allErr.message)
            }
          }
        }

        // Buscar QR code da API
        const qrResult = await evoGo.getQRCode()
        const qrData = qrResult?.data || qrResult
        let qrCode = qrData?.qrcode || qrData?.Qrcode || qrData?.base64
        if (qrCode) {
          // Evo Go armazena QR no formato "base64|code" - extrair apenas base64
          if (qrCode.includes('|')) {
            qrCode = qrCode.split('|')[0]
          }
          // Salvar no DB para cache
          await prisma.instance.update({
            where: { id },
            data: { qrCode, status: 'CONNECTING' },
          })
          return reply.send({ qrCode, status: 'CONNECTING' })
        }
        return reply.status(404).send({ error: 'QR code não disponível' })
      } catch (error: any) {
        console.log('[Evo Go] Erro ao buscar QR:', error.message)
        // Fallback: tentar do banco
        if (instance.qrCode) {
          return reply.send({ qrCode: instance.qrCode })
        }
        return reply.status(404).send({ error: 'QR code não disponível' })
      }
    }

    // Para Baileys: buscar do manager ou do banco
    const qrCode = baileysManager.getQRCode(id) || instance.qrCode

    if (!qrCode) {
      return reply.status(404).send({ error: 'QR code not available' })
    }

    return reply.send({ qrCode })
  })

  // Regenerate API token
  fastify.post<{ Params: { id: string } }>('/:id/regenerate-token', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    const updated = await prisma.instance.update({
      where: { id },
      data: { apiToken: uuid() },
      select: { apiToken: true },
    })

    return reply.send({ apiToken: updated.apiToken })
  })

  // Get groups
  fastify.get<{ Params: { id: string } }>('/:id/groups', { preHandler: [requirePermission('groups:read')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId, isActive: true },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.status !== 'CONNECTED') {
      return reply.status(400).send({ error: 'Instance is not connected' })
    }

    if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') {
      return reply.status(400).send({ error: 'Grupos só disponíveis para Baileys e Evo Go' })
    }

    try {
      if (instance.channel === 'EVO_GO') {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        const groups = await evoGo.listGroups()
        return reply.send(groups)
      }
      const groups = await baileysManager.getGroups(id)
      return reply.send(groups)
    } catch (error: any) {
      console.error('[Instance] Erro ao listar grupos:', error.message)
      return reply.status(500).send({ error: 'Erro ao listar grupos' })
    }
  })

  // Get group info
  fastify.get<{ Params: { id: string; groupId: string } }>('/:id/groups/:groupId', { preHandler: [requirePermission('groups:read')] }, async (request, reply) => {
    const { id, groupId } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId, isActive: true },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.status !== 'CONNECTED') {
      return reply.status(400).send({ error: 'Instance is not connected' })
    }

    if (instance.channel !== 'BAILEYS' && instance.channel !== 'EVO_GO') {
      return reply.status(400).send({ error: 'Grupos só disponíveis para Baileys e Evo Go' })
    }

    try {
      if (instance.channel === 'EVO_GO') {
        const evoGo = new EvoGoProvider(decryptInstanceSecrets(instance))
        const group = await evoGo.getGroupInfo(groupId)
        return reply.send(group)
      }
      const group = await baileysManager.getGroupInfo(id, groupId)
      return reply.send(group)
    } catch (error: any) {
      console.error('[Instance] Erro ao buscar grupo:', error.message)
      return reply.status(500).send({ error: 'Erro ao buscar informações do grupo' })
    }
  })

  // Get rate limit info (useful for Coexistence instances)
  fastify.get<{ Params: { id: string } }>('/:id/rate-limit-info', { preHandler: [requirePermission('instances:read')] }, async (request, reply) => {
    const { id } = request.params

    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    try {
      const rateLimitInfo = await getRateLimitInfo(id)
      return reply.send(rateLimitInfo)
    } catch (error: any) {
      console.error('[Instance] Erro ao buscar rate limit:', error.message)
      return reply.status(500).send({ error: 'Erro ao buscar informações de rate limit' })
    }
  })

  // Embedded Signup for Coexistence (receives OAuth code and exchanges for access_token)
  fastify.post<{ Params: { id: string } }>('/:id/embedded-signup', { preHandler: [requirePermission('instances:manage')] }, async (request, reply) => {
    const { id } = request.params
    const data = embeddedSignupSchema.parse(request.body)

    // 1. Validate instance belongs to user and is COEXISTENCE type
    const instance = await prisma.instance.findFirst({
      where: { id, companyId: request.user.companyId },
    })

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' })
    }

    if (instance.channel !== 'COEXISTENCE') {
      return reply.status(400).send({ error: 'This endpoint is only for Coexistence instances' })
    }

    // 2. Validate Meta credentials are configured
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      return reply.status(500).send({ error: 'Meta App credentials not configured on server' })
    }

    try {
      // 3. Exchange code for access_token
      console.log('[Embedded Signup] Exchanging code for access_token...')
      const tokenResponse = await axios.get(
        `https://graph.facebook.com/${env.META_API_VERSION}/oauth/access_token`,
        {
          params: {
            client_id: env.META_APP_ID,
            client_secret: env.META_APP_SECRET,
            code: data.code,
          },
        }
      )

      const accessToken = tokenResponse.data.access_token
      if (!accessToken) {
        console.error('[Embedded Signup] No access_token in response:', tokenResponse.data)
        return reply.status(400).send({ error: 'Failed to get access token from Meta' })
      }

      console.log('[Embedded Signup] Access token obtained successfully')

      // 4. Get phone number info from Meta (if phoneNumberId provided)
      let phoneNumber: string | null = null
      let profileName: string | null = null
      let wabaId = data.wabaId || null
      let phoneNumberId = data.phoneNumberId || null

      if (phoneNumberId) {
        try {
          const cloudApi = new CloudAPIProvider({
            phoneNumberId,
            accessToken,
          })
          const phoneInfo = await cloudApi.getPhoneNumberInfo()
          phoneNumber = phoneInfo.display_phone_number?.replace(/\D/g, '') || null
          profileName = phoneInfo.verified_name || null
          console.log('[Embedded Signup] Phone info:', { phoneNumber, profileName })
        } catch (phoneError: any) {
          console.error('[Embedded Signup] Error fetching phone info:', phoneError.message)
          // Continue anyway - we have the token
        }
      }

      // 5. Update instance with credentials
      const updated = await prisma.instance.update({
        where: { id },
        data: {
          wabaId,
          phoneNumberId,
          accessToken,
          phoneNumber,
          profileName,
          status: 'CONNECTED',
        },
      })

      console.log('[Embedded Signup] Instance updated successfully:', updated.id)

      return reply.send({
        success: true,
        message: 'Coexistence connected successfully',
        instance: {
          id: updated.id,
          name: updated.name,
          status: updated.status,
          phoneNumber: updated.phoneNumber,
          profileName: updated.profileName,
        },
      })
    } catch (error: any) {
      console.error('[Embedded Signup] Error:', error.response?.data || error.message)
      const errorMessage = error.response?.data?.error?.message || error.message || 'Failed to complete embedded signup'
      return reply.status(500).send({ error: errorMessage })
    }
  })
}
