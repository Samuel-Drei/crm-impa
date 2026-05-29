/**
 * Script para migrar mensagens existentes para o modelo de Conversation.
 * 
 * O que faz:
 * 1. Agrupa messages por (instanceId, remoteJid) que ainda não têm conversationId
 * 2. Cria objetos Conversation para cada grupo
 * 3. Vincula as messages às conversations criadas
 * 4. Tenta associar o contactId baseado no phoneNumber
 * 
 * Uso: npx tsx migrate-conversations.ts
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('=== Migração: Messages → Conversations ===\n')

  // 1. Buscar todas as instâncias ativas
  const instances = await prisma.instance.findMany({
    select: { id: true, companyId: true, name: true },
  })

  console.log(`Encontradas ${instances.length} instâncias.\n`)

  let totalConversations = 0
  let totalMessagesLinked = 0

  for (const instance of instances) {
    console.log(`\n--- Instância: ${instance.name} (${instance.id}) ---`)

    // 2. Agrupar mensagens sem conversationId
    const groups = await prisma.message.groupBy({
      by: ['remoteJid'],
      where: {
        instanceId: instance.id,
        conversationId: null,
      },
      _count: { id: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    })

    if (!groups.length) {
      console.log('  Sem mensagens órfãs.')
      continue
    }

    console.log(`  ${groups.length} remoteJids sem conversa vinculada.`)

    // 3. Buscar conversas existentes para essa instância
    const existingConversations = await prisma.conversation.findMany({
      where: { instanceId: instance.id },
      select: { id: true, remoteJid: true },
    })
    const existingMap = new Map(existingConversations.map(c => [c.remoteJid, c.id]))

    // 4. Buscar contatos da empresa
    const allRemoteJids = groups.map(g => g.remoteJid)
    const directJids = allRemoteJids.filter(jid => !jid.includes('@g.us') && !jid.includes('@newsletter') && !jid.includes('@broadcast'))
    
    const contacts = directJids.length
      ? await prisma.contact.findMany({
          where: {
            companyId: instance.companyId,
            phoneNumber: { in: directJids },
          },
          select: { id: true, phoneNumber: true },
        })
      : []
    const contactMap = new Map(contacts.map(c => [c.phoneNumber, c.id]))

    // 5. Criar conversas que não existem
    const toCreate = groups.filter(g => !existingMap.has(g.remoteJid))
    
    if (toCreate.length > 0) {
      const newConversations = toCreate.map(group => ({
        id: randomUUID(),
        companyId: instance.companyId,
        instanceId: instance.id,
        remoteJid: group.remoteJid,
        contactId: contactMap.get(group.remoteJid) || null,
        lastActivityAt: group._max.createdAt || new Date(),
      }))

      await prisma.conversation.createMany({
        data: newConversations,
        skipDuplicates: true,
      })

      // Adicionar ao mapa
      for (const conv of newConversations) {
        existingMap.set(conv.remoteJid, conv.id)
      }

      console.log(`  Criadas ${toCreate.length} novas conversas.`)
      totalConversations += toCreate.length
    }

    // 6. Vincular mensagens às conversas (batch)
    for (const group of groups) {
      const conversationId = existingMap.get(group.remoteJid)
      if (!conversationId) continue

      const result = await prisma.message.updateMany({
        where: {
          instanceId: instance.id,
          remoteJid: group.remoteJid,
          conversationId: null,
        },
        data: { conversationId },
      })

      totalMessagesLinked += result.count
    }

    console.log(`  ${groups.reduce((sum, g) => sum + g._count.id, 0)} mensagens vinculadas.`)
  }

  console.log(`\n=== Migração concluída ===`)
  console.log(`  Conversas criadas: ${totalConversations}`)
  console.log(`  Mensagens vinculadas: ${totalMessagesLinked}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
