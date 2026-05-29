/**
 * RBAC Helpers: Funções utilitárias para o sistema de RBAC.
 * Garante que toda empresa tenha os 3 roles SYSTEM criados.
 */
import { prisma } from '../../config/database.js'

// Definições dos 3 roles SYSTEM (espelho do seed-rbac.ts)
const SYSTEM_ROLES = [
  {
    name: 'Administrador',
    slug: 'admin',
    description: 'Acesso total à empresa',
    defaultScope: 'COMPANY' as const,
    conversationScope: 'COMPANY' as const,
    canReplyConversations: true,
    isDefault: false,
    permissions: null, // ALL permissions
  },
  {
    name: 'Gerente',
    slug: 'manager',
    description: 'Gestão de times e operação',
    defaultScope: 'TEAM' as const,
    conversationScope: 'TEAM' as const,
    canReplyConversations: true,
    isDefault: false,
    permissions: [
      'conversations:read', 'conversations:reply', 'conversations:assign', 'conversations:manage',
      'contacts:read', 'contacts:write', 'contacts:view_phone',
      'groups:read', 'groups:manage',
      'teams:read',
      'users:read',
      'labels:read', 'labels:manage',
      'canned_responses:read', 'canned_responses:manage',
      'custom_attributes:read',
      'instances:read',
      'campaigns:read', 'campaigns:manage',
      'templates:read',
      'automations:read',
      'flows:read',
      'macros:read', 'macros:manage',
      'ai_agents:read', 'ai_agents:manage',
      'ai_providers:read',
      'ai_knowledge:read', 'ai_knowledge:manage',
      'ai_sessions:read', 'ai_sessions:manage',
      'ai_tools:read',
      'ai_reports:read',
      'reports:read',
      'settings:read',
    ],
  },
  {
    name: 'Atendente',
    slug: 'agent',
    description: 'Atendimento e conversas',
    defaultScope: 'OWN' as const,
    conversationScope: 'OWN' as const,
    canReplyConversations: true,
    isDefault: true,
    permissions: [
      'conversations:read', 'conversations:reply',
      'contacts:read', 'contacts:view_phone',
      'groups:read',
      'labels:read',
      'canned_responses:read',
      'custom_attributes:read',
      'macros:read',
      'reports:read',
    ],
  },
]

/**
 * Garante que os 3 roles SYSTEM existam para uma empresa.
 * Cria-os caso não existam. Idempotente.
 */
export async function ensureCompanyRoles(companyId: string) {
  for (const roleDef of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({
      where: { companyId_slug: { companyId, slug: roleDef.slug } },
    })
    if (existing) continue

    // Buscar permissões
    const allPermissions = await prisma.permission.findMany()
    const permSlugs = roleDef.permissions ?? allPermissions.map(p => p.slug)
    const permIds = allPermissions
      .filter(p => permSlugs.includes(p.slug))
      .map(p => p.id)

    await prisma.role.create({
      data: {
        companyId,
        name: roleDef.name,
        slug: roleDef.slug,
        description: roleDef.description,
        type: 'SYSTEM',
        defaultScope: roleDef.defaultScope,
        conversationScope: roleDef.conversationScope,
        canReplyConversations: roleDef.canReplyConversations,
        isDefault: roleDef.isDefault,
        permissions: {
          create: permIds.map(permissionId => ({ permissionId })),
        },
      },
    })
  }
}

/**
 * Retorna o roleId para um dado slug dentro de uma empresa.
 * Cria os roles se necessário.
 */
export async function getRoleId(companyId: string, slug: string): Promise<string> {
  let role = await prisma.role.findUnique({
    where: { companyId_slug: { companyId, slug } },
  })

  if (!role) {
    await ensureCompanyRoles(companyId)
    role = await prisma.role.findUnique({
      where: { companyId_slug: { companyId, slug } },
    })
  }

  if (!role) {
    throw new Error(`Role '${slug}' not found for company ${companyId}`)
  }

  return role.id
}

/**
 * Retorna o roleId padrão (isDefault=true) para uma empresa.
 */
export async function getDefaultRoleId(companyId: string): Promise<string> {
  let role = await prisma.role.findFirst({
    where: { companyId, isDefault: true },
  })

  if (!role) {
    await ensureCompanyRoles(companyId)
    role = await prisma.role.findFirst({
      where: { companyId, isDefault: true },
    })
  }

  if (!role) {
    throw new Error(`No default role found for company ${companyId}`)
  }

  return role.id
}
