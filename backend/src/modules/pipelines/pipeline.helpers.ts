import { prisma } from '../../config/database.js'

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface LogActivityParams {
  cardId: string
  type: string
  content: string
  actorId?: string | null
  actorType?: string
  actorName?: string | null
  oldValue?: string | null
  newValue?: string | null
  metadata?: any
}

export async function logCardActivity(params: LogActivityParams) {
  try {
    await prisma.cardActivity.create({
      data: {
        cardId: params.cardId,
        type: params.type as any,
        content: params.content,
        actorId: params.actorId,
        actorType: params.actorType || 'user',
        actorName: params.actorName,
        oldValue: params.oldValue,
        newValue: params.newValue,
        metadata: params.metadata,
      },
    })
  } catch (err) {
    console.error('[Pipeline] Failed to log activity:', err)
  }
}

/**
 * Validates that a stage belongs to a pipeline and both belong to the company.
 */
export async function validateStageOwnership(stageId: string, pipelineId: string, companyId: string) {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, pipelineId, companyId },
  })
  return stage
}

/**
 * Validates that a card belongs to a pipeline and company.
 */
export async function validateCardOwnership(cardId: string, companyId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, companyId },
    include: { stage: true, pipeline: true },
  })
  return card
}

export { slugify }
