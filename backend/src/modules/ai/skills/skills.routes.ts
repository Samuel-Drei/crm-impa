/**
 * AI Skills Routes — CRUD + reindexação para skills (procedural memory vetorizada)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authMiddleware } from '../../../middlewares/auth.middleware.js'
import { requirePermission } from '../../../middlewares/permission.middleware.js'
import * as skills from './skills.service.js'

const skillCreateSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  conditions: z.array(z.string().min(1).max(500)).default([]),
  instructions: z.string().min(1),
  examples: z.string().optional(),
  relatedSkillIds: z.array(z.string().uuid()).optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  tags: z.array(z.string().max(40)).optional(),
  isActive: z.boolean().optional(),
  agentId: z.string().uuid().nullable().optional(),
})

const skillUpdateSchema = skillCreateSchema.partial()

export async function aiSkillsRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.addHook('preHandler', authMiddleware)

    // GET /ai/skills?agentId=...&includeGlobal=true
    app.get(
      '/skills',
      { preHandler: [requirePermission('ai_agents:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as { agentId?: string; includeGlobal?: string }
        const list = await skills.listSkills(request.user.companyId, {
          agentId: q.agentId === 'global' ? null : q.agentId,
          includeGlobal: q.includeGlobal === 'true',
        })
        return reply.send(list)
      }
    )

    // GET /ai/skills/:id
    app.get(
      '/skills/:id',
      { preHandler: [requirePermission('ai_agents:read')] },
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const skill = await skills.getSkill(request.params.id, request.user.companyId)
        if (!skill) return reply.code(404).send({ error: 'Skill não encontrada' })
        return reply.send(skill)
      }
    )

    // POST /ai/skills
    app.post(
      '/skills',
      { preHandler: [requirePermission('ai_agents:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const parsed = skillCreateSchema.safeParse(request.body)
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Validação falhou', details: parsed.error.flatten() })
        }
        try {
          const created = await skills.createSkill(request.user.companyId, parsed.data)
          return reply.code(201).send(created)
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Erro ao criar skill' })
        }
      }
    )

    // PUT /ai/skills/:id
    app.put(
      '/skills/:id',
      { preHandler: [requirePermission('ai_agents:manage')] },
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const parsed = skillUpdateSchema.safeParse(request.body)
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Validação falhou', details: parsed.error.flatten() })
        }
        try {
          const updated = await skills.updateSkill(request.params.id, request.user.companyId, parsed.data)
          return reply.send(updated)
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Erro ao atualizar skill' })
        }
      }
    )

    // DELETE /ai/skills/:id
    app.delete(
      '/skills/:id',
      { preHandler: [requirePermission('ai_agents:manage')] },
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        try {
          await skills.deleteSkill(request.params.id, request.user.companyId)
          return reply.code(204).send()
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Erro ao deletar skill' })
        }
      }
    )

    // POST /ai/skills/:id/reindex — força reindexação Qdrant
    app.post(
      '/skills/:id/reindex',
      { preHandler: [requirePermission('ai_agents:manage')] },
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        try {
          const ok = await skills.indexSkill(request.params.id)
          return reply.send({ indexed: ok })
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Erro ao reindexar' })
        }
      }
    )

    // POST /ai/skills/reindex-all — reindexa TODAS as skills da empresa
    app.post(
      '/skills/reindex-all',
      { preHandler: [requirePermission('ai_agents:manage')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const stats = await skills.reindexAllSkills(request.user.companyId)
        return reply.send(stats)
      }
    )

    // POST /ai/skills/preview — testa quais skills seriam ativadas para uma mensagem
    app.post(
      '/skills/preview',
      { preHandler: [requirePermission('ai_agents:read')] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const schema = z.object({
          agentId: z.string().uuid(),
          message: z.string().min(1),
          topK: z.coerce.number().int().min(1).max(10).default(3),
          scoreThreshold: z.coerce.number().min(0).max(1).default(0.55),
        })
        const parsed = schema.safeParse(request.body)
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Validação falhou', details: parsed.error.flatten() })
        }
        try {
          const active = await skills.selectActiveSkills({
            companyId: request.user.companyId,
            agentId: parsed.data.agentId,
            userMessage: parsed.data.message,
            topK: parsed.data.topK,
            scoreThreshold: parsed.data.scoreThreshold,
          })
          return reply.send({
            count: active.length,
            skills: active.map((s) => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
              priority: s.priority,
              alwaysOn: s.alwaysOn,
              score: s.score ?? null,
              instructionsLength: s.instructions.length,
            })),
            promptPreview: skills.formatSkillsForPrompt(active),
          })
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Erro' })
        }
      }
    )
  })
}
