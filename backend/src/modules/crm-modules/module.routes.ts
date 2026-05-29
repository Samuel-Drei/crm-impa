import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/database.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { getModuleDefinition, getAllModuleDefinitions } from '../crm-modules/registry.js'

export async function moduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authMiddleware)

  // GET /api/modules/active — Módulos ativos da empresa com definições completas
  fastify.get('/active', async (request, reply) => {
    const { companyId } = request.user

    const companyModules = await prisma.companyModule.findMany({
      where: { companyId, isActive: true },
      include: { module: true },
    })

    const activeModules = companyModules
      .map(cm => {
        const definition = getModuleDefinition(cm.module.slug)
        if (!definition) return null
        return {
          config: cm.config,
          activatedAt: cm.activatedAt,
          ...definition,
        }
      })
      .filter(Boolean)

    return reply.send({ modules: activeModules })
  })

  // GET /api/modules/registry — Todos os módulos disponíveis (para info)
  fastify.get('/registry', async (_request, reply) => {
    const modules = getAllModuleDefinitions().map(m => ({
      slug: m.slug,
      name: m.name,
      description: m.description,
      icon: m.icon,
      category: m.category,
      fieldsCount: m.customFields?.length || 0,
      templatesCount: m.pipelineTemplates?.length || 0,
      tabsCount: m.cardTabs?.length || 0,
    }))

    return reply.send({ modules })
  })

  // GET /api/modules/:slug — Definição completa de um módulo
  fastify.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const definition = getModuleDefinition(slug)

    if (!definition) {
      return reply.status(404).send({ error: 'Módulo não encontrado' })
    }

    return reply.send({ module: definition })
  })

  // GET /api/modules/:slug/templates — Templates de pipeline do módulo
  fastify.get('/:slug/templates', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const definition = getModuleDefinition(slug)

    if (!definition) {
      return reply.status(404).send({ error: 'Módulo não encontrado' })
    }

    return reply.send({ templates: definition.pipelineTemplates || [] })
  })

  // POST /api/modules/:slug/validate-stage — Valida dados do card contra regras do stage
  fastify.post('/:slug/validate-stage', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const { stageSlug, customFields, cardData } = request.body as {
      stageSlug: string
      customFields?: Record<string, any>
      cardData?: Record<string, any>
    }

    const definition = getModuleDefinition(slug)
    if (!definition) {
      return reply.status(404).send({ error: 'Módulo não encontrado' })
    }

    const validations = definition.stageValidations?.filter(v => v.stageSlug === stageSlug) || []
    const errors: string[] = []
    const allData = { ...cardData, ...customFields }

    for (const validation of validations) {
      for (const rule of validation.rules) {
        const fieldValue = allData?.[rule.field]

        switch (rule.operator) {
          case 'not_empty':
            if (!fieldValue && fieldValue !== 0 && fieldValue !== false) {
              errors.push(rule.message)
            }
            break
          case 'equals':
            if (fieldValue !== rule.value) {
              errors.push(rule.message)
            }
            break
          case 'min':
            if (typeof fieldValue === 'number' && fieldValue < (rule.value as number)) {
              errors.push(rule.message)
            }
            break
          case 'max':
            if (typeof fieldValue === 'number' && fieldValue > (rule.value as number)) {
              errors.push(rule.message)
            }
            break
        }
      }
    }

    return reply.send({ valid: errors.length === 0, errors })
  })
}
