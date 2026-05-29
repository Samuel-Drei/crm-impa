import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { timingSafeEqual } from 'crypto'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { isWebhookReplay } from '../../core/webhook-replay.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import { updateInvoicePaymentStatus } from '../invoices/invoice.routes.js'
import { encrypt, decryptSafe, decryptJSONSafe, type EncryptionContext } from '../../config/encryption.js'

// ── Zod Schemas ──────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() })

const listPaymentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  invoiceId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIAL_REFUND']).optional(),
  method: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'CASH', 'OTHER']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

const registerPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().min(0.01),
  method: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'CASH', 'OTHER']),
  date: z.string().optional(),
  note: z.string().optional(),
  transactionId: z.string().optional(),
})

const refundPaymentSchema = z.object({
  amount: z.number().min(0.01).optional(),
  reason: z.string().optional(),
})

// ── Gateway Config Schemas ───────────────────────────────

const createGatewayConfigSchema = z.object({
  gateway: z.string().min(1),
  displayName: z.string().min(1),
  active: z.boolean().default(true),
  sandbox: z.boolean().default(false),
  credentials: z.object({
    apiKey: z.string().min(1),
    walletId: z.string().optional(),
  }),
  enabledMethods: z.array(z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD'])).min(1),
  maxInstallments: z.number().int().min(1).max(24).optional(),
  interestRate: z.number().min(0).optional(),
  fineRate: z.number().min(0).optional(),
  discountDays: z.number().int().min(0).optional(),
  discountRate: z.number().min(0).optional(),
  webhookSecret: z.string().optional(),
  ipWhitelist: z.array(z.string()).optional(),
})

const updateGatewayConfigSchema = createGatewayConfigSchema.partial()

// ── Payment Routes ───────────────────────────────────────

export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar pagamentos
  fastify.get('/', { preHandler: [requirePermission('payments:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const query = listPaymentsQuery.parse(request.query)

      const where: any = { companyId }

      if (query.invoiceId) where.invoiceId = query.invoiceId
      if (query.status) where.status = query.status
      if (query.method) where.method = query.method
      if (query.dateFrom || query.dateTo) {
        where.date = {}
        if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
        if (query.dateTo) where.date.lte = new Date(query.dateTo)
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: {
            invoice: {
              select: { id: true, number: true, prefix: true, total: true, contact: { select: { id: true, name: true } } },
            },
          },
          orderBy: { date: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.payment.count({ where }),
      ])

      return reply.send({ payments, total, page: query.page, limit: query.limit })
    }
  )

  // Registrar pagamento manual
  fastify.post('/', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = registerPaymentSchema.parse(request.body)

      const invoice = await prisma.invoice.findFirst({ where: { id: body.invoiceId, companyId } })
      if (!invoice) return reply.status(404).send({ error: 'Fatura não encontrada' })

      if (['PAID', 'CANCELLED'].includes(invoice.status)) {
        return reply.status(400).send({ error: 'Fatura já paga ou cancelada' })
      }

      if (body.amount > invoice.amountDue.toNumber()) {
        return reply.status(400).send({ error: 'Valor do pagamento excede o saldo devedor' })
      }

      const payment = await prisma.payment.create({
        data: {
          companyId,
          invoiceId: body.invoiceId,
          amount: body.amount,
          method: body.method,
          date: body.date ? new Date(body.date) : new Date(),
          note: body.note,
          transactionId: body.transactionId,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          createdBy: userId,
        },
      })

      await updateInvoicePaymentStatus(body.invoiceId)

      return reply.status(201).send({ payment })
    }
  )

  // Estornar pagamento
  fastify.post('/:id/refund', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = refundPaymentSchema.parse(request.body)

      const payment = await prisma.payment.findFirst({ where: { id, companyId } })
      if (!payment) return reply.status(404).send({ error: 'Pagamento não encontrado' })

      if (payment.status !== 'CONFIRMED') {
        return reply.status(400).send({ error: 'Apenas pagamentos confirmados podem ser estornados' })
      }

      const refundAmount = body.amount || payment.amount.toNumber()
      const isFullRefund = refundAmount >= payment.amount.toNumber()

      const updated = await prisma.payment.update({
        where: { id },
        data: {
          status: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND',
          refundAmount: refundAmount,
          refundedAt: new Date(),
          refundReason: body.reason,
        },
      })

      await updateInvoicePaymentStatus(payment.invoiceId)

      return reply.send({ payment: updated })
    }
  )

  // Cancelar pagamento pendente
  fastify.post('/:id/cancel', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const payment = await prisma.payment.findFirst({ where: { id, companyId } })
      if (!payment) return reply.status(404).send({ error: 'Pagamento não encontrado' })

      if (payment.status !== 'PENDING') {
        return reply.status(400).send({ error: 'Apenas pagamentos pendentes podem ser cancelados' })
      }

      const updated = await prisma.payment.update({
        where: { id },
        data: { status: 'CANCELLED' },
      })

      return reply.send({ payment: updated })
    }
  )
}

// ── Gateway Config Routes ────────────────────────────────

export async function gatewayConfigRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Listar configurações de gateway
  fastify.get('/', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId

      const configs = await prisma.paymentGatewayConfig.findMany({
        where: { companyId },
        select: {
          id: true,
          gateway: true,
          displayName: true,
          active: true,
          sandbox: true,
          enabledMethods: true,
          maxInstallments: true,
          webhookUrl: true,
          createdAt: true,
          updatedAt: true,
          // NÃO retornar credentials por segurança
        },
      })

      return reply.send({ configs })
    }
  )

  // Obter configuração por ID
  fastify.get('/:id', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const config = await prisma.paymentGatewayConfig.findFirst({
        where: { id, companyId },
      })

      if (!config) return reply.status(404).send({ error: 'Configuração não encontrada' })

      // Mascarar credenciais
      const credentials = (typeof config.credentials === 'string' ? decryptJSONSafe(config.credentials) : config.credentials) as any
      const maskedCredentials = {
        apiKey: credentials?.apiKey ? `****${credentials.apiKey.slice(-4)}` : undefined,
        walletId: credentials?.walletId,
      }

      return reply.send({ config: { ...config, credentials: maskedCredentials } })
    }
  )

  // Criar configuração de gateway
  fastify.post('/', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const body = createGatewayConfigSchema.parse(request.body)

      const existing = await prisma.paymentGatewayConfig.findUnique({
        where: { companyId_gateway_sandbox: { companyId, gateway: body.gateway, sandbox: body.sandbox } },
      })
      if (existing) return reply.status(409).send({ error: 'Gateway já configurado' })

      const webhookUrl = `${process.env.API_URL || ''}/api/payments/webhook/${body.gateway}`

      const config = await prisma.paymentGatewayConfig.create({
        data: {
          companyId,
          gateway: body.gateway,
          displayName: body.displayName,
          active: body.active,
          sandbox: body.sandbox,
          credentials: encrypt(JSON.stringify(body.credentials), { companyId, model: 'PaymentGatewayConfig', field: 'credentials', recordId: 'new' }),
          enabledMethods: body.enabledMethods,
          maxInstallments: body.maxInstallments,
          interestRate: body.interestRate,
          fineRate: body.fineRate,
          discountDays: body.discountDays,
          discountRate: body.discountRate,
          webhookUrl,
          webhookSecret: body.webhookSecret ? encrypt(body.webhookSecret, { companyId, model: 'PaymentGatewayConfig', field: 'webhookSecret', recordId: 'new' }) : undefined,
          ipWhitelist: body.ipWhitelist || [],
        },
      })

      return reply.status(201).send({
        config: { ...config, credentials: { apiKey: '****' } },
      })
    }
  )

  // Atualizar configuração
  fastify.put('/:id', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId
      const body = updateGatewayConfigSchema.parse(request.body)

      const existing = await prisma.paymentGatewayConfig.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Configuração não encontrada' })

      // Encrypt sensitive fields if provided
      const encBody: any = { ...body }
      if (encBody.credentials) {
        encBody.credentials = encrypt(JSON.stringify(encBody.credentials), { companyId, model: 'PaymentGatewayConfig', field: 'credentials', recordId: id })
      }
      if (encBody.webhookSecret) {
        encBody.webhookSecret = encrypt(encBody.webhookSecret, { companyId, model: 'PaymentGatewayConfig', field: 'webhookSecret', recordId: id })
      }

      const config = await prisma.paymentGatewayConfig.update({
        where: { id },
        data: encBody,
      })

      return reply.send({ config: { ...config, credentials: { apiKey: '****' } } })
    }
  )

  // Deletar configuração
  fastify.delete('/:id', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParam.parse(request.params)
      const companyId = request.user.companyId

      const existing = await prisma.paymentGatewayConfig.findFirst({ where: { id, companyId } })
      if (!existing) return reply.status(404).send({ error: 'Configuração não encontrada' })

      await prisma.paymentGatewayConfig.deleteMany({ where: { id, companyId } })
      return reply.status(204).send()
    }
  )
}

// ── Asaas Gateway Service ────────────────────────────────

interface AsaasConfig {
  apiKey: string
  sandbox: boolean
}

function getAsaasBaseUrl(sandbox: boolean): string {
  return sandbox
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'
}

async function asaasFetch(config: AsaasConfig, path: string, options: RequestInit = {}) {
  const baseUrl = getAsaasBaseUrl(config.sandbox)
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': config.apiKey,
      ...options.headers,
    },
  })

  const data = await response.json() as any

  if (!response.ok) {
    throw new Error(data.errors?.[0]?.description || `Asaas API error: ${response.status}`)
  }

  return data
}

// ── Asaas Integration Routes ─────────────────────────────

export async function asaasRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware)

  // Helper: obter config Asaas da empresa
  async function getAsaasConfig(companyId: string): Promise<{ config: any; asaas: AsaasConfig } | null> {
    const config = await prisma.paymentGatewayConfig.findFirst({
      where: { companyId, gateway: 'asaas', active: true },
    })
    if (!config) return null

    const creds = (typeof config.credentials === 'string' ? decryptJSONSafe(config.credentials) : config.credentials) as any
    return {
      config,
      asaas: { apiKey: creds.apiKey, sandbox: config.sandbox },
    }
  }

  // Criar cobrança Asaas para uma fatura
  fastify.post('/charge', { preHandler: [requirePermission('payments:manage')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const companyId = request.user.companyId
      const userId = request.user.sub
      const body = z.object({
        invoiceId: z.string().uuid(),
        method: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
        dueDate: z.string(),
        installmentCount: z.number().int().min(1).max(24).optional(),
        discountValue: z.number().min(0).optional(),
        discountDueDateLimitDays: z.number().int().min(0).optional(),
        interest: z.number().min(0).optional(),
        fine: z.number().min(0).optional(),
      }).parse(request.body)

      const gateway = await getAsaasConfig(companyId)
      if (!gateway) return reply.status(400).send({ error: 'Gateway Asaas não configurado' })

      const invoice = await prisma.invoice.findFirst({
        where: { id: body.invoiceId, companyId },
        include: { contact: true },
      })
      if (!invoice) return reply.status(404).send({ error: 'Fatura não encontrada' })

      // Garantir que o contato tenha um customer no Asaas
      let gatewayCustomer = await prisma.gatewayCustomer.findFirst({
        where: { gatewayConfigId: gateway.config.id, contactId: invoice.contactId },
      })

      if (!gatewayCustomer) {
        // Criar customer no Asaas
        const customerData = await asaasFetch(gateway.asaas, '/customers', {
          method: 'POST',
          body: JSON.stringify({
            name: invoice.contact.name,
            email: invoice.contact.email,
            phone: invoice.contact.phoneNumber,
            cpfCnpj: (invoice.contact as any).document || undefined,
          }),
        })

        gatewayCustomer = await prisma.gatewayCustomer.create({
          data: {
            companyId,
            gatewayConfigId: gateway.config.id,
            contactId: invoice.contactId,
            externalId: (customerData as any).id,
            externalData: customerData as any,
          },
        })
      }

      // Mapear método de pagamento para Asaas
      const billingTypeMap: Record<string, string> = {
        'PIX': 'PIX',
        'BOLETO': 'BOLETO',
        'CREDIT_CARD': 'CREDIT_CARD',
      }

      const asaasPayment: any = await asaasFetch(gateway.asaas, '/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: gatewayCustomer.externalId,
          billingType: billingTypeMap[body.method],
          dueDate: body.dueDate,
          value: invoice.amountDue.toNumber(),
          description: `Fatura ${invoice.prefix}${invoice.number}`,
          externalReference: invoice.id,
          installmentCount: body.installmentCount,
          discount: body.discountValue ? {
            value: body.discountValue,
            dueDateLimitDays: body.discountDueDateLimitDays || 0,
          } : undefined,
          interest: body.interest ? { value: body.interest } : undefined,
          fine: body.fine ? { value: body.fine } : undefined,
        }),
      })

      // Registrar pagamento pendente no CRM
      const payment = await prisma.payment.create({
        data: {
          companyId,
          invoiceId: body.invoiceId,
          amount: invoice.amountDue,
          method: body.method,
          date: new Date(body.dueDate),
          gateway: 'asaas',
          transactionId: asaasPayment.id,
          externalStatus: asaasPayment.status,
          webhookPayload: asaasPayment,
          status: 'PENDING',
          createdBy: userId,
        },
      })

      return reply.status(201).send({
        payment,
        asaas: {
          id: asaasPayment.id,
          status: asaasPayment.status,
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          pixQrCode: asaasPayment.pixQrCodeUrl || asaasPayment.encodedImage,
          pixCopyPaste: asaasPayment.payload,
        },
      })
    }
  )

  // Consultar status de pagamento no Asaas
  fastify.get('/status/:paymentId', { preHandler: [requirePermission('payments:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { paymentId } = z.object({ paymentId: z.string() }).parse(request.params)
      const companyId = request.user.companyId

      const gateway = await getAsaasConfig(companyId)
      if (!gateway) return reply.status(400).send({ error: 'Gateway Asaas não configurado' })

      const asaasPayment = await asaasFetch(gateway.asaas, `/payments/${paymentId}`)

      return reply.send({ asaasPayment })
    }
  )

  // Obter QR Code PIX
  fastify.get('/pix-qrcode/:paymentId', { preHandler: [requirePermission('payments:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { paymentId } = z.object({ paymentId: z.string() }).parse(request.params)
      const companyId = request.user.companyId

      const gateway = await getAsaasConfig(companyId)
      if (!gateway) return reply.status(400).send({ error: 'Gateway Asaas não configurado' })

      const qrCode = await asaasFetch(gateway.asaas, `/payments/${paymentId}/pixQrCode`)

      return reply.send({ qrCode })
    }
  )
}

// ── Webhook Routes (sem auth, público) ───────────────────

export async function paymentWebhookRoutes(fastify: FastifyInstance) {

  // Webhook Asaas
  fastify.post('/asaas', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any

    if (!body?.event || !body?.payment) {
      return reply.status(400).send({ error: 'Payload inválido' })
    }

    // SEC-26 fix: validate webhook authentication via asaas-access-token header
    const webhookToken = request.headers['asaas-access-token'] as string
    const gatewayConfigForAuth = await prisma.paymentGatewayConfig.findFirst({
      where: { gateway: 'asaas', active: true },
      select: { webhookSecret: true },
    })
    const decryptedWebhookSecret = decryptSafe(gatewayConfigForAuth?.webhookSecret) as string | null
    if (decryptedWebhookSecret) {
      if (!webhookToken) {
        return reply.status(401).send({ error: 'Missing webhook authentication' })
      }
      try {
        const a = Buffer.from(webhookToken)
        const b = Buffer.from(decryptedWebhookSecret)
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return reply.status(401).send({ error: 'Invalid webhook authentication' })
        }
      } catch {
        return reply.status(401).send({ error: 'Invalid webhook authentication' })
      }
    }

    const externalPaymentId = body.payment.id
    const eventType = body.event

    // Replay protection: deduplicate by payment ID + event type
    if (await isWebhookReplay('asaas', `${externalPaymentId}:${eventType}`)) {
      return reply.send({ received: true, deduplicated: true })
    }

    // Encontrar pagamento pelo transactionId
    const crmPayment = await prisma.payment.findFirst({
      where: { transactionId: externalPaymentId, gateway: 'asaas' },
      include: { company: true },
    })

    if (!crmPayment) {
      // Registrar evento mesmo sem pagamento no CRM (pode ser de outra origem)
      const config = await prisma.paymentGatewayConfig.findFirst({
        where: { gateway: 'asaas', active: true },
      })

      if (config) {
        await prisma.paymentWebhookEvent.create({
          data: {
            companyId: config.companyId,
            gatewayConfigId: config.id,
            gateway: 'asaas',
            gatewayEventId: `${externalPaymentId}_${eventType}_${Date.now()}`,
            eventType,
            payload: body,
            status: 'IGNORED',
          },
        })
      }

      return reply.send({ received: true })
    }

    // Registrar webhook event
    const gatewayConfig = await prisma.paymentGatewayConfig.findFirst({
      where: { companyId: crmPayment.companyId, gateway: 'asaas', active: true },
    })

    if (gatewayConfig) {
      await prisma.paymentWebhookEvent.create({
        data: {
          companyId: crmPayment.companyId,
          gatewayConfigId: gatewayConfig.id,
          gateway: 'asaas',
          gatewayEventId: `${externalPaymentId}_${eventType}_${Date.now()}`,
          eventType,
          payload: body,
          status: 'PROCESSING',
        },
      })
    }

    // Processar evento
    const statusMap: Record<string, { status: string; extraData?: any }> = {
      'PAYMENT_CONFIRMED': { status: 'CONFIRMED', extraData: { confirmedAt: new Date() } },
      'PAYMENT_RECEIVED': { status: 'CONFIRMED', extraData: { confirmedAt: new Date() } },
      'PAYMENT_OVERDUE': { status: 'PENDING' },
      'PAYMENT_DELETED': { status: 'CANCELLED' },
      'PAYMENT_REFUNDED': { status: 'REFUNDED', extraData: { refundedAt: new Date() } },
      'PAYMENT_UPDATED': { status: crmPayment.status },
    }

    const mapping = statusMap[eventType]
    if (mapping && mapping.status !== crmPayment.status) {
      await prisma.payment.update({
        where: { id: crmPayment.id },
        data: {
          status: mapping.status as any,
          externalStatus: body.payment.status,
          webhookPayload: body,
          ...mapping.extraData,
        },
      })

      await updateInvoicePaymentStatus(crmPayment.invoiceId)
    }

    // Atualizar webhook event status
    if (gatewayConfig) {
      await prisma.paymentWebhookEvent.updateMany({
        where: {
          gatewayConfigId: gatewayConfig.id,
          gatewayEventId: `${externalPaymentId}_${eventType}_${Date.now()}`,
        },
        data: { status: 'PROCESSED', processedAt: new Date() },
      })
    }

    return reply.send({ received: true })
  })
}
