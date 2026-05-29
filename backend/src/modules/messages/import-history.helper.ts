import { prisma } from '../../config/database.js'
import { EvoGoProvider } from '../../providers/evo-go/evo-go.provider.js'
import { decryptSafe } from '../../config/encryption.js'

// 10 anos – busca todo o histórico que o Evo Go tiver armazenado
const IMPORT_DAYS_DEFAULT = 3650
const BATCH_SIZE = 500
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes max wait

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractHistoryMessages(r: any): any[] {
  return r?.data?.messages || r?.messages || []
}

function isEvoGoImporting(r: any): boolean {
  const s = r?.data || r || {}
  return s?.isImporting ?? s?.IsImporting ?? false
}

// Suporta tanto o formato antigo ("imageMessage") quanto o novo ("image image/jpeg")
function mapMessageType(t: string): string {
  if (!t) return 'text'
  const base = t.split(' ')[0].toLowerCase()
  if (['text', 'conversation', 'extendedtextmessage'].includes(base)) return 'text'
  if (['image', 'imagemessage'].includes(base)) return 'image'
  if (['video', 'videomessage'].includes(base)) return 'video'
  if (['audio', 'audiomessage', 'ptt', 'pttmessage'].includes(base)) return 'audio'
  if (['document', 'documentmessage'].includes(base)) return 'document'
  if (['sticker', 'stickermessage'].includes(base)) return 'sticker'
  if (['contact', 'contactmessage'].includes(base)) return 'contact'
  if (['location', 'locationmessage'].includes(base)) return 'location'
  if (['poll', 'pollcreationmessage'].includes(base)) return 'poll'
  return 'text'
}

// Placeholder visível na UI para mídias sem legenda
function mediaPlaceholder(type: string): string {
  switch (type) {
    case 'image':    return '[imagem]'
    case 'video':    return '[vídeo]'
    case 'audio':    return '[áudio]'
    case 'document': return '[documento]'
    case 'sticker':  return '[figurinha]'
    case 'contact':  return '[contato]'
    case 'location': return '[localização]'
    case 'poll':     return '[enquete]'
    default:         return ''
  }
}

// Retorna o número de telefone limpo de um JID
function jidPhone(jid: string): string {
  return jid
    .replace(/@s\.whatsapp\.net$/, '')
    .replace(/@g\.us$/, '')
    .replace(/@lid$/, '')
    .replace(/@c\.us$/, '')
    .replace(/@broadcast$/, '')
    .replace(/@newsletter$/, '')
}

// Rejeita JIDs lixo/sentinela (status@broadcast, 0@..., sem @, etc)
function isValidJid(jid: any): boolean {
  if (!jid || typeof jid !== 'string') return false
  if (!jid.includes('@')) return false
  if (jid === 'status@broadcast') return false
  const phone = jidPhone(jid)
  if (!phone || phone === '0') return false
  return true
}

// Detecta nomes "mascarados" do WhatsApp (privacidade), ex: "+55∙∙∙∙∙∙∙∙∙59"
function isMaskedName(s: string): boolean {
  return /[∙•·]/.test(s)
}

// Considera "vago" um nome puramente numérico/mascarado/vazio
function isWeakName(s: string | null | undefined): boolean {
  const v = (s || '').trim()
  if (!v) return true
  if (/^\+?\d+$/.test(v)) return true
  if (isMaskedName(v)) return true
  return false
}

// Address book entry vinda de GET /user/contacts (Evo Go)
type AddressBookEntry = {
  Jid: string
  Found?: boolean
  FirstName?: string
  FullName?: string
  PushName?: string
  BusinessName?: string
}

function bestNameFromBook(book?: AddressBookEntry): string | null {
  if (!book) return null
  const candidates = [book.FullName, book.FirstName, book.BusinessName, book.PushName]
  for (const c of candidates) {
    const v = (c || '').trim()
    if (v && !isWeakName(v)) return v
  }
  return null
}

// Melhor nome disponível: address book > pushName não-vago > número do JID
function bestName(jid: string, pushName?: string | null, book?: AddressBookEntry): string {
  const fromBook = bestNameFromBook(book)
  if (fromBook) return fromBook
  const name = (pushName || '').trim()
  if (name && !isWeakName(name)) return name
  return jidPhone(jid)
}

// Converte um payload Evo Go em Date confiável (timestamp Unix > 0, depois ISO strings)
function parseMessageTimestamp(m: any): Date {
  const ts = Number(m?.timestamp)
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000)
  const candidates = [m?.messageDate, m?.createdAt]
  for (const c of candidates) {
    if (typeof c === 'string') {
      const parsed = Date.parse(c)
      if (Number.isFinite(parsed) && parsed > 0) return new Date(parsed)
    }
  }
  return new Date()
}

export async function runHistoryImport(
  instance: { id: string; companyId: string; evoApiKey: string | null; evoApiUrl: string | null; evoInstanceId: string | null },
  days = IMPORT_DAYS_DEFAULT
): Promise<{ imported: number; total: number; conversations: number; contacts: number }> {
  const evoGo = new EvoGoProvider({ ...instance, evoApiKey: decryptSafe(instance.evoApiKey) as string } as any)

  // ── Aguarda até o Evo Go terminar de persistir o histórico do WhatsApp ──
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let rawMessages: any[] = []
  let attempts = 0

  while (Date.now() < deadline) {
    attempts += 1

    try {
      const statusRes = await evoGo.getImportHistoryStatus()
      if (isEvoGoImporting(statusRes)) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
    } catch {
      // endpoint ainda não disponível – tenta buscar as mensagens mesmo assim
    }

    try {
      const historyResult = await evoGo.getChatMessages(days)
      rawMessages = extractHistoryMessages(historyResult)
      if (rawMessages.length > 0) break
    } catch (err: any) {
      if (Date.now() >= deadline) throw err
    }

    console.log(`[import-history] Histórico ainda vazio para ${instance.id}; aguardando Evo Go... tentativa ${attempts}`)
    await sleep(POLL_INTERVAL_MS)
  }

  if (rawMessages.length === 0) {
    await prisma.instance.update({ where: { id: instance.id }, data: { historySyncedAt: null } })
    return { imported: 0, total: 0, conversations: 0, contacts: 0 }
  }

  // ── Filtra JIDs lixo (status@broadcast, 0@..., sem @) ──
  const validMessages = rawMessages.filter((m: any) => isValidJid(m?.remoteJid))
  if (validMessages.length === 0) {
    await prisma.instance.update({ where: { id: instance.id }, data: { historySyncedAt: new Date() } })
    return { imported: 0, total: 0, conversations: 0, contacts: 0 }
  }

  // ── Busca address book do aparelho (nomes reais) ──
  const addressBookList = await evoGo.getContacts()
  const addressBook = new Map<string, AddressBookEntry>()
  for (const c of addressBookList) {
    if (c?.Jid) addressBook.set(c.Jid, c)
  }
  console.log(`[import-history] Address book Evo Go: ${addressBook.size} contatos para ${instance.id}`)

  // ── Monta mapa de JIDs → melhor nome disponível ──
  // Inclui: todos os remoteJids + senderJids dos remetentes em grupos
  const contactNameMap = new Map<string, string>()

  const tryUpgradeName = (jid: string, candidate: string) => {
    const current = contactNameMap.get(jid)
    if (!current) {
      contactNameMap.set(jid, candidate)
      return
    }
    // Upgrade só se atual é "vago" e novo é um nome de verdade
    if (isWeakName(current) && !isWeakName(candidate)) {
      contactNameMap.set(jid, candidate)
    }
  }

  for (const m of validMessages) {
    const remoteJid: string = m.remoteJid
    const isGroup = remoteJid.endsWith('@g.us')

    // Contato/grupo de destino da conversa
    if (isGroup) {
      tryUpgradeName(remoteJid, `Grupo ${jidPhone(remoteJid)}`)
    } else {
      const candidate = bestName(remoteJid, !m.fromMe ? m.pushName : null, addressBook.get(remoteJid))
      tryUpgradeName(remoteJid, candidate)
    }

    // Remetente individual em mensagens de grupo
    if (isGroup && m.senderJid && !m.fromMe && isValidJid(m.senderJid)) {
      const candidate = bestName(m.senderJid, m.pushName, addressBook.get(m.senderJid))
      tryUpgradeName(m.senderJid, candidate)
    }
  }

  const allJids = Array.from(contactNameMap.keys())

  // ── Upsert de contatos em lotes de 100 ──
  // Atualiza nome apenas quando o atual é "vago" (numérico/mascarado/vazio).
  for (let i = 0; i < allJids.length; i += 100) {
    await Promise.all(
      allJids.slice(i, i + 100).map(async (jid) => {
        const desiredName = contactNameMap.get(jid)!
        const existing = await prisma.contact.findUnique({
          where: { companyId_phoneNumber: { companyId: instance.companyId, phoneNumber: jid } },
          select: { id: true, name: true },
        })
        if (!existing) {
          await prisma.contact.create({
            data: { companyId: instance.companyId, phoneNumber: jid, name: desiredName },
          })
          return
        }
        if (isWeakName(existing.name) && !isWeakName(desiredName)) {
          await prisma.contact.update({ where: { id: existing.id }, data: { name: desiredName } })
        }
      })
    )
  }

  const dbContacts = await prisma.contact.findMany({
    where: { companyId: instance.companyId, phoneNumber: { in: allJids } },
    select: { id: true, phoneNumber: true },
  })
  const contactMap = new Map(dbContacts.map((c) => [c.phoneNumber, c.id]))

  // ── Agrupa mensagens por conversa (só remoteJids com mensagens válidas) ──
  const messagesByConv = new Map<string, any[]>()
  for (const m of validMessages) {
    if (!messagesByConv.has(m.remoteJid)) messagesByConv.set(m.remoteJid, [])
    messagesByConv.get(m.remoteJid)!.push(m)
  }
  const convJids = Array.from(messagesByConv.keys())

  // ── Upsert de conversas (uma por remoteJid, lastActivityAt = max ts real) ──
  for (let i = 0; i < convJids.length; i += 50) {
    await Promise.all(
      convJids.slice(i, i + 50).map(async (jid) => {
        const contactId = contactMap.get(jid)
        if (!contactId) {
          console.warn(`[import-history] Conversa pulada — contato não encontrado para ${jid}`)
          return
        }
        const msgs = messagesByConv.get(jid)!
        if (msgs.length === 0) return
        const lastActivityAt = msgs
          .map(parseMessageTimestamp)
          .reduce((a, b) => (a.getTime() > b.getTime() ? a : b), new Date(0))
        await prisma.conversation.upsert({
          where: { instanceId_remoteJid: { instanceId: instance.id, remoteJid: jid } },
          update: { lastActivityAt },
          create: {
            companyId: instance.companyId,
            instanceId: instance.id,
            contactId,
            remoteJid: jid,
            status: 'OPEN',
            lastActivityAt,
          },
        })
      })
    )
  }

  const dbConvs = await prisma.conversation.findMany({
    where: { instanceId: instance.id, remoteJid: { in: convJids } },
    select: { id: true, remoteJid: true },
  })
  const convMap = new Map(dbConvs.map((c) => [c.remoteJid, c.id]))

  // ── Monta linhas de mensagem com atribuição de remetente em grupos ──
  const rows = validMessages
    .filter((m: any) => m.messageId)
    .map((m: any) => {
      const isGroup = (m.remoteJid as string).endsWith('@g.us')

      // Em grupos, o contactId aponta pro remetente real (senderJid); em DMs aponta pro remoteJid
      const msgContactId = isGroup && !m.fromMe && m.senderJid
        ? (contactMap.get(m.senderJid) ?? contactMap.get(m.remoteJid) ?? null)
        : (contactMap.get(m.remoteJid) ?? null)

      // metadata guarda quem mandou em grupos (usado pela UI para exibir o remetente)
      const senderName = isGroup && m.senderJid
        ? bestName(m.senderJid, m.pushName, addressBook.get(m.senderJid))
        : undefined
      const metadata: Record<string, string> | undefined = isGroup && m.senderJid
        ? { senderJid: m.senderJid, senderName: senderName || jidPhone(m.senderJid) }
        : undefined

      const type = mapMessageType(m.messageType || '')
      const rawContent = (m.content || '').toString()
      const content = rawContent || (type !== 'text' ? mediaPlaceholder(type) : '')

      const at = parseMessageTimestamp(m)

      return {
        instanceId: instance.id,
        contactId: msgContactId,
        conversationId: convMap.get(m.remoteJid) ?? null,
        remoteJid: m.remoteJid,
        messageId: m.messageId as string,
        direction: m.fromMe ? ('OUTBOUND' as const) : ('INBOUND' as const),
        status: 'READ' as const,
        type,
        content,
        metadata: metadata as any,
        createdAt: at,
        updatedAt: at,
      }
    })

  let imported = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const result = await prisma.message.createMany({
      data: rows.slice(i, i + BATCH_SIZE),
      skipDuplicates: true,
    })
    imported += result.count
  }

  // ── Pós-processamento: recalcula lastActivityAt direto do MAX(messages.createdAt) ──
  // Cobre casos em que conversas pré-existentes ficaram com lastActivityAt errado/null.
  await prisma.$executeRawUnsafe(`
    UPDATE "conversations" c
    SET "lastActivityAt" = sub.max_at
    FROM (
      SELECT "conversationId" AS conv_id, MAX("createdAt") AS max_at
      FROM "messages"
      WHERE "instanceId" = $1 AND "conversationId" IS NOT NULL
      GROUP BY "conversationId"
    ) sub
    WHERE c.id = sub.conv_id
      AND c."instanceId" = $1
      AND (c."lastActivityAt" IS NULL OR c."lastActivityAt" < sub.max_at)
  `, instance.id)

  // ── Limpeza: remove conversas sem nenhuma mensagem vinculada (órfãs) ──
  const cleanupCount = await prisma.$executeRawUnsafe(`
    DELETE FROM "conversations"
    WHERE "instanceId" = $1
      AND id NOT IN (
        SELECT DISTINCT "conversationId"
        FROM "messages"
        WHERE "instanceId" = $1 AND "conversationId" IS NOT NULL
      )
  `, instance.id)
  if (cleanupCount > 0) {
    console.log(`[import-history] Removidas ${cleanupCount} conversas órfãs (sem mensagens) para ${instance.id}`)
  }

  await prisma.instance.update({ where: { id: instance.id }, data: { historySyncedAt: new Date() } })

  console.log(`[import-history] Concluído para ${instance.id}: ${imported}/${rows.length} msgs, ${convMap.size} convs, ${contactMap.size} contatos`)
  return { imported, total: rows.length, conversations: convMap.size, contacts: contactMap.size }
}
