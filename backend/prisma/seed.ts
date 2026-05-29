import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create default company and admin user
  const hashedPassword = await bcrypt.hash('admin123', 10)

  // 1. Upsert company
  const company = await prisma.company.upsert({
    where: { email: 'admin@whatsapp.local' },
    update: {},
    create: {
      name: 'Admin Company',
      email: 'admin@whatsapp.local',
      plan: 'premium',
    },
  })

  // 2. Ensure RBAC permissions exist
  const permCount = await prisma.permission.count()
  if (permCount === 0) {
    console.log('Run seed-rbac.ts first to create permissions and roles')
    console.log('  npx tsx prisma/seed-rbac.ts')
  }

  // 3. Find or create admin role for this company
  let adminRole = await prisma.role.findUnique({
    where: { companyId_slug: { companyId: company.id, slug: 'admin' } },
  })

  if (!adminRole) {
    // Create minimal admin role (seed-rbac.ts should be run for full setup)
    const allPerms = await prisma.permission.findMany()
    adminRole = await prisma.role.create({
      data: {
        companyId: company.id,
        name: 'Administrador',
        slug: 'admin',
        type: 'SYSTEM',
        defaultScope: 'COMPANY',
        conversationScope: 'COMPANY',
        canReplyConversations: true,
        permissions: {
          create: allPerms.map(p => ({ permissionId: p.id })),
        },
      },
    })
  }

  // 4. Upsert admin user (Super Admin)
  await prisma.user.upsert({
    where: { email: 'admin@whatsapp.local' },
    update: { isSuperAdmin: true },
    create: {
      name: 'Administrador',
      email: 'admin@whatsapp.local',
      password: hashedPassword,
      companyId: company.id,
      roleId: adminRole.id,
      isSuperAdmin: true,
    },
  })

  console.log('Created company:', company.name)
  console.log('Created admin user: admin@whatsapp.local')
  console.log('Default password: admin123')
  console.log('')

  // 5. Seed AI Agent Templates
  const { AGENT_TEMPLATES } = await import('../src/modules/ai/template.service.js')
  let templatesCreated = 0
  for (const template of AGENT_TEMPLATES) {
    const existing = await prisma.aIAgentTemplate.findUnique({ where: { slug: template.slug } })
    if (!existing) {
      await prisma.aIAgentTemplate.create({ data: template })
      templatesCreated++
    }
  }
  if (templatesCreated > 0) {
    console.log(`Created ${templatesCreated} AI agent templates`)
  }

  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
