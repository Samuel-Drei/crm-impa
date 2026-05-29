import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Find bare 120363 contacts (newsletters without @newsletter suffix)
  const contacts = await p.contact.findMany({
    where: {
      phoneNumber: { startsWith: '120363', not: { contains: '@' } }
    }
  })
  console.log('Found', contacts.length, 'newsletter contacts to migrate')

  for (const c of contacts) {
    const newPhone = c.phoneNumber + '@newsletter'
    const newName = 'Canal ' + c.phoneNumber

    // Check if target already exists
    const existing = await p.contact.findFirst({
      where: { companyId: c.companyId, phoneNumber: newPhone }
    })

    if (existing) {
      console.log('Target already exists for', c.phoneNumber, ', deleting old and updating messages')
      await p.contact.delete({ where: { id: c.id } })
    } else {
      await p.contact.update({
        where: { id: c.id },
        data: { phoneNumber: newPhone, name: newName }
      })
      console.log('Contact updated:', c.phoneNumber, '->', newPhone)
    }

    // Update messages remoteJid
    const result = await p.$executeRawUnsafe(
      `UPDATE messages SET "remoteJid" = $1 WHERE "remoteJid" = $2`,
      newPhone,
      c.phoneNumber
    )
    console.log('Messages updated for', c.phoneNumber, ':', result, 'rows')
  }

  console.log('Migration complete!')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())
