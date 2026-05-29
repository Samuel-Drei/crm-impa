/**
 * Rotas HTTP do módulo de Integrações.
 * Prefixo: /api/integrations
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { CompanyIntegrationType } from '@prisma/client'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { requirePermission } from '../../middlewares/permission.middleware.js'
import * as svc from './integration.service.js'
import { getProvider } from './registry.js'

const createSchema = z.object({
  type: z.nativeEnum(CompanyIntegrationType),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  credentials: z.record(z.any()),
  config: z.any().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  credentials: z.record(z.any()).optional(),
  config: z.any().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ERROR']).optional(),
})

const listQuerySchema = z.object({
  type: z.nativeEnum(CompanyIntegrationType).optional(),
})

export async function integrationsRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // Catálogo público (sem credenciais) — qualquer usuário autenticado pode ver
    app.get('/catalog', async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ items: svc.getIntegrationCatalog() })
    })

    // Listar integrações da empresa
    app.get(
      '/',
      { preHandler: [requirePermission('integrations:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const q = listQuerySchema.parse(request.query)
        const items = await svc.listIntegrations(request.user.companyId, q)
        return reply.send({ items })
      },
    )

    app.get(
      '/:id',
      { preHandler: [requirePermission('integrations:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const item = await svc.getIntegration(request.user.companyId, id)
        if (!item) return reply.status(404).send({ error: 'Não encontrada' })
        return reply.send(item)
      },
    )

    app.post(
      '/',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = createSchema.parse(request.body)
        try {
          const created = await svc.createIntegration(request.user.companyId, body)
          return reply.status(201).send(created)
        } catch (err: any) {
          return reply.status(400).send({ error: err?.message || 'Falha ao criar integração' })
        }
      },
    )

    app.put(
      '/:id',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const body = updateSchema.parse(request.body)
        try {
          const updated = await svc.updateIntegration(request.user.companyId, id, body)
          return reply.send(updated)
        } catch (err: any) {
          return reply.status(400).send({ error: err?.message || 'Falha ao atualizar' })
        }
      },
    )

    app.delete(
      '/:id',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try {
          await svc.deleteIntegration(request.user.companyId, id)
          return reply.status(204).send()
        } catch (err: any) {
          return reply.status(400).send({ error: err?.message || 'Falha ao deletar' })
        }
      },
    )

    app.post(
      '/:id/test',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try {
          const result = await svc.testIntegration(request.user.companyId, id)
          return reply.send(result)
        } catch (err: any) {
          return reply.status(400).send({ ok: false, message: err?.message || 'Falha ao testar' })
        }
      },
    )

    // ── FishAudio: Voice Models ────────────────────────────────────
    app.get(
      '/:id/voice-models',
      { preHandler: [requirePermission('integrations:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const data = await svc.getCompanyIntegrationDecrypted(request.user.companyId, id)
        if (!data) return reply.status(404).send({ error: 'Integração não encontrada' })
        const provider = getProvider(data.row.type)
        if (!provider.listVoiceModels) return reply.status(400).send({ error: 'Provider não suporta voice models' })
        try {
          const items = await provider.listVoiceModels(data.credentials, request.query as any)
          await svc.trackUsage(id, true)
          return reply.send({ items })
        } catch (err: any) {
          await svc.trackUsage(id, false)
          return reply.status(502).send({ error: err?.message || 'Falha ao listar modelos' })
        }
      },
    )

    app.post(
      '/:id/voice-models',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const data = await svc.getCompanyIntegrationDecrypted(request.user.companyId, id)
        if (!data) return reply.status(404).send({ error: 'Integração não encontrada' })
        const provider = getProvider(data.row.type)
        if (!provider.createVoiceModel) return reply.status(400).send({ error: 'Provider não suporta criar voice models' })

        // Espera multipart: arquivos 'voices' + campos 'name', 'description', 'visibility', 'tags', 'transcripts[]'
        if (!(request as any).isMultipart || !(request as any).isMultipart()) {
          return reply.status(400).send({ error: 'Envio deve ser multipart/form-data' })
        }

        const fields: Record<string, any> = {}
        const voices: Array<{ audio: Buffer; contentType: string; filename?: string; transcript?: string }> = []
        const parts = (request as any).parts()
        for await (const part of parts) {
          if (part.type === 'file') {
            const buf = await part.toBuffer()
            voices.push({ audio: buf, contentType: part.mimetype, filename: part.filename })
          } else {
            fields[part.fieldname] = part.value
          }
        }

        if (!fields.name) return reply.status(400).send({ error: 'Campo "name" obrigatório' })
        if (!voices.length) return reply.status(400).send({ error: 'Envie ao menos um arquivo de áudio' })

        try {
          const tags = fields.tags ? (typeof fields.tags === 'string' ? JSON.parse(fields.tags) : fields.tags) : undefined
          const created = await provider.createVoiceModel(data.credentials, {
            name: fields.name,
            description: fields.description,
            visibility: fields.visibility || 'private',
            voices,
            tags,
          })
          await svc.trackUsage(id, true)
          return reply.status(201).send(created)
        } catch (err: any) {
          await svc.trackUsage(id, false)
          return reply.status(502).send({ error: err?.message || 'Falha ao criar voice model' })
        }
      },
    )

    app.delete(
      '/:id/voice-models/:voiceId',
      { preHandler: [requirePermission('integrations:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, voiceId } = request.params as { id: string; voiceId: string }
        const data = await svc.getCompanyIntegrationDecrypted(request.user.companyId, id)
        if (!data) return reply.status(404).send({ error: 'Integração não encontrada' })
        const provider = getProvider(data.row.type)
        if (!provider.deleteVoiceModel) return reply.status(400).send({ error: 'Provider não suporta deletar voice models' })
        try {
          await provider.deleteVoiceModel(data.credentials, voiceId)
          await svc.trackUsage(id, true)
          return reply.status(204).send()
        } catch (err: any) {
          await svc.trackUsage(id, false)
          return reply.status(502).send({ error: err?.message || 'Falha ao deletar voice model' })
        }
      },
    )

    // ── Cal.com: Event Types & Slots ───────────────────────────────
    app.get(
      '/:id/event-types',
      { preHandler: [requirePermission('integrations:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const data = await svc.getCompanyIntegrationDecrypted(request.user.companyId, id)
        if (!data) return reply.status(404).send({ error: 'Integração não encontrada' })
        const provider = getProvider(data.row.type)
        if (!provider.listEventTypes) return reply.status(400).send({ error: 'Provider não suporta event types' })
        try {
          const items = await provider.listEventTypes(data.credentials)
          await svc.trackUsage(id, true)
          return reply.send({ items })
        } catch (err: any) {
          await svc.trackUsage(id, false)
          return reply.status(502).send({ error: err?.message || 'Falha ao listar event types' })
        }
      },
    )
  })
}
