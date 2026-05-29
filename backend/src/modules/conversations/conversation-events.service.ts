import { prisma } from '../../config/database.js'
import { io } from '../../server.js'

interface LogEventParams {
  conversationId: string
  instanceId: string
  remoteJid: string
  eventType: string
  description: string
  actorType: 'ai' | 'user' | 'system'
  actorName?: string
  metadata?: Record<string, any>
}

export async function logConversationEvent(params: LogEventParams) {
  try {
    const event = await prisma.conversationEvent.create({
      data: {
        conversationId: params.conversationId,
        instanceId: params.instanceId,
        remoteJid: params.remoteJid,
        eventType: params.eventType,
        description: params.description,
        actorType: params.actorType,
        actorName: params.actorName || null,
        metadata: params.metadata || undefined,
      },
    })

    // Emitir em tempo real
    io?.to(`instance:${params.instanceId}`).emit('conversation-event', {
      ...event,
      instanceId: params.instanceId,
      remoteJid: params.remoteJid,
    })

    return event
  } catch (err) {
    console.error('[ConversationEvent] Failed to log event:', err)
    return null
  }
}

/**
 * Helper para buscar ou criar o conversationId a partir de instanceId + remoteJid
 */
export async function getConversationId(instanceId: string, remoteJid: string): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({
    where: { instanceId_remoteJid: { instanceId, remoteJid } },
    select: { id: true },
  })
  return conv?.id || null
}
