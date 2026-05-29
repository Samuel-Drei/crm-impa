import { randomUUID } from 'crypto'
import { prisma } from '../../config/database.js'

type EnsureConversationInput = {
  companyId: string
  instanceId: string
  remoteJid: string
  contactName?: string
  lastActivityAt?: Date
  firstReplyAt?: Date
}

function isDirectConversation(remoteJid: string) {
  return !remoteJid.includes('@g.us') && !remoteJid.includes('@newsletter') && !remoteJid.includes('@broadcast')
}

function phoneFromJid(remoteJid: string) {
  if (isDirectConversation(remoteJid)) {
    return remoteJid.replace('@s.whatsapp.net', '').replace(/@.*/, '').replace(/\D/g, '')
  }
  return remoteJid
}

function defaultContactName(remoteJid: string, phoneNumber: string) {
  if (remoteJid.includes('@g.us')) return `Grupo ${remoteJid}`
  if (remoteJid.includes('@newsletter')) return `Canal ${remoteJid.replace('@newsletter', '')}`
  return phoneNumber
}

// Garante que o contato existe e retorna o contactId — nunca retorna null
async function ensureContact(companyId: string, remoteJid: string, contactName?: string): Promise<string> {
  const phoneNumber = phoneFromJid(remoteJid)

  const contact = await prisma.contact.upsert({
    where: { companyId_phoneNumber: { companyId, phoneNumber } },
    update: {},
    create: {
      companyId,
      phoneNumber,
      name: contactName || defaultContactName(remoteJid, phoneNumber),
    },
    select: { id: true },
  })

  return contact.id
}

export async function ensureConversationForMessage(input: EnsureConversationInput) {
  const { companyId, instanceId, remoteJid, contactName, lastActivityAt = new Date(), firstReplyAt } = input

  const contactId = await ensureContact(companyId, remoteJid, contactName)

  // Check if conversation already exists
  const existing = await prisma.conversation.findUnique({
    where: { instanceId_remoteJid: { instanceId, remoteJid } },
    select: { id: true, deletedAt: true, status: true },
  })

  if (existing) {
    const updateData: any = {
      lastActivityAt,
      contactId,
      ...(firstReplyAt ? { firstReplyAt } : {}),
    }

    // Se a conversa estava deletada, reviver como ABERTA (igual Chatwoot com "resolve" → nova msg → reabrir)
    if (existing.deletedAt) {
      updateData.deletedAt = null
      updateData.status = 'OPEN'
      console.log(`[Conversation] Conversa revivida: ${remoteJid} (era deletada → agora OPEN)`)
    }

    const conversation = await prisma.conversation.update({
      where: { id: existing.id },
      data: updateData,
    })

    // _isNew = true se estava deletada (para disparar automações como se fosse nova)
    return { ...conversation, _isNew: !!existing.deletedAt }
  }

  // Criar nova conversa
  const conversation = await prisma.conversation.create({
    data: {
      id: randomUUID(),
      companyId,
      instanceId,
      remoteJid,
      lastActivityAt,
      contactId,
      ...(firstReplyAt ? { firstReplyAt } : {}),
    },
  })

  return { ...conversation, _isNew: true }
}

export async function backfillConversationsForInstance(instanceId: string, companyId: string) {
  const groupedMessages = await prisma.message.groupBy({
    by: ['remoteJid'],
    where: { instanceId },
    _max: { createdAt: true },
  })

  if (!groupedMessages.length) return 0

  const existingConversations = await prisma.conversation.findMany({
    where: { instanceId },
    select: { remoteJid: true },
  })

  const existingRemoteJids = new Set(existingConversations.map(conversation => conversation.remoteJid))
  const missingGroups = groupedMessages.filter(group => !existingRemoteJids.has(group.remoteJid))

  if (!missingGroups.length) return 0

  // Garantir que todos os contatos existem antes de criar conversas
  const allPhoneNumbers = missingGroups.map(group => phoneFromJid(group.remoteJid))

  const existingContacts = await prisma.contact.findMany({
    where: { companyId, phoneNumber: { in: allPhoneNumbers } },
    select: { id: true, phoneNumber: true },
  })
  const contactsByPhone = new Map(existingContacts.map(c => [c.phoneNumber, c.id]))

  // Criar contatos que não existem
  const missingPhones = allPhoneNumbers.filter(p => !contactsByPhone.has(p))
  if (missingPhones.length) {
    const phoneToJid = new Map(missingGroups.map(g => [phoneFromJid(g.remoteJid), g.remoteJid]))
    for (const phone of missingPhones) {
      const jid = phoneToJid.get(phone) || phone
      const created = await prisma.contact.create({
        data: { companyId, phoneNumber: phone, name: defaultContactName(jid, phone) },
        select: { id: true },
      })
      contactsByPhone.set(phone, created.id)
    }
  }

  await prisma.conversation.createMany({
    data: missingGroups.map(group => {
      const phoneNumber = phoneFromJid(group.remoteJid)
      return {
        id: randomUUID(),
        companyId,
        instanceId,
        remoteJid: group.remoteJid,
        contactId: contactsByPhone.get(phoneNumber)!,
        lastActivityAt: group._max.createdAt ?? new Date(),
      }
    }),
    skipDuplicates: true,
  })

  return missingGroups.length
}

// Vincular contactId em conversas que ainda não têm vínculo — cria contato se necessário
export async function linkOrphanedConversations(instanceId: string, companyId: string) {
  const orphaned = await prisma.conversation.findMany({
    where: { instanceId, contactId: undefined },
    select: { id: true, remoteJid: true },
  })

  if (!orphaned.length) return 0

  const phoneNumbers = orphaned.map(conv => phoneFromJid(conv.remoteJid))

  const contacts = await prisma.contact.findMany({
    where: { companyId, phoneNumber: { in: phoneNumbers } },
    select: { id: true, phoneNumber: true },
  })

  const contactsByPhone = new Map(contacts.map(c => [c.phoneNumber, c.id]))

  let linked = 0
  for (const conv of orphaned) {
    const phone = phoneFromJid(conv.remoteJid)
    let contactId = contactsByPhone.get(phone)

    // Criar contato se não existir
    if (!contactId) {
      const created = await prisma.contact.create({
        data: { companyId, phoneNumber: phone, name: defaultContactName(conv.remoteJid, phone) },
        select: { id: true },
      })
      contactId = created.id
      contactsByPhone.set(phone, contactId)
    }

    await prisma.conversation.update({ where: { id: conv.id }, data: { contactId } })
    linked++
  }

  if (linked > 0) console.log(`[backfill] Vinculadas ${linked} conversas órfãs a contatos`)
  return linked
}