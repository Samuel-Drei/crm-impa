/**
 * RBAC Seed: Popula permissions, cria roles SYSTEM por empresa, e migra users existentes.
 * Executar: npx tsx prisma/seed-rbac.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ══════════════════════════════════════════
// 38 Permissões Atômicas em 16 Módulos
// ══════════════════════════════════════════
const PERMISSIONS = [
  // Conversas
  { module: 'conversations', action: 'read',    slug: 'conversations:read',    description: 'Ver conversas' },
  { module: 'conversations', action: 'reply',   slug: 'conversations:reply',   description: 'Responder conversas' },
  { module: 'conversations', action: 'assign',  slug: 'conversations:assign',  description: 'Atribuir conversas' },
  { module: 'conversations', action: 'manage',  slug: 'conversations:manage',  description: 'Gerenciar status/prioridade de conversas' },
  // Contatos
  { module: 'contacts', action: 'read',       slug: 'contacts:read',       description: 'Ver contatos' },
  { module: 'contacts', action: 'write',      slug: 'contacts:write',      description: 'Editar contatos' },
  { module: 'contacts', action: 'delete',     slug: 'contacts:delete',     description: 'Deletar contatos' },
  { module: 'contacts', action: 'import',     slug: 'contacts:import',     description: 'Importar contatos' },
  { module: 'contacts', action: 'view_phone', slug: 'contacts:view_phone', description: 'Ver números de telefone dos contatos' },
  // Grupos
  { module: 'groups', action: 'read',   slug: 'groups:read',   description: 'Ver grupos WhatsApp' },
  { module: 'groups', action: 'manage', slug: 'groups:manage', description: 'Enviar mensagens e gerenciar grupos' },
  // Times
  { module: 'teams', action: 'read',   slug: 'teams:read',   description: 'Ver times' },
  { module: 'teams', action: 'manage', slug: 'teams:manage', description: 'Criar/editar/deletar times' },
  // Usuários
  { module: 'users', action: 'read',   slug: 'users:read',   description: 'Ver usuários' },
  { module: 'users', action: 'manage', slug: 'users:manage', description: 'Criar/editar/desativar usuários' },
  // Etiquetas
  { module: 'labels', action: 'read',   slug: 'labels:read',   description: 'Ver etiquetas' },
  { module: 'labels', action: 'manage', slug: 'labels:manage', description: 'Gerenciar etiquetas' },
  // Respostas Prontas
  { module: 'canned_responses', action: 'read',   slug: 'canned_responses:read',   description: 'Ver respostas prontas' },
  { module: 'canned_responses', action: 'manage', slug: 'canned_responses:manage', description: 'Gerenciar respostas prontas' },
  // Campos Custom
  { module: 'custom_attributes', action: 'read',   slug: 'custom_attributes:read',   description: 'Ver campos personalizados' },
  { module: 'custom_attributes', action: 'manage', slug: 'custom_attributes:manage', description: 'Gerenciar campos personalizados' },
  // Instâncias
  { module: 'instances', action: 'read',   slug: 'instances:read',   description: 'Ver instâncias' },
  { module: 'instances', action: 'manage', slug: 'instances:manage', description: 'Criar/editar/conectar instâncias' },
  // Campanhas
  { module: 'campaigns', action: 'read',   slug: 'campaigns:read',   description: 'Ver campanhas' },
  { module: 'campaigns', action: 'manage', slug: 'campaigns:manage', description: 'Criar/executar campanhas' },
  // Templates
  { module: 'templates', action: 'read',   slug: 'templates:read',   description: 'Ver templates' },
  { module: 'templates', action: 'manage', slug: 'templates:manage', description: 'Gerenciar templates' },
  // Automações
  { module: 'automations', action: 'read',   slug: 'automations:read',   description: 'Ver automações' },
  { module: 'automations', action: 'manage', slug: 'automations:manage', description: 'Gerenciar automações' },
  // Fluxos
  { module: 'flows', action: 'read',   slug: 'flows:read',   description: 'Ver fluxos' },
  { module: 'flows', action: 'manage', slug: 'flows:manage', description: 'Gerenciar fluxos' },
  // Workflows
  { module: 'workflows', action: 'read',   slug: 'workflows:read',   description: 'Ver workflows' },
  { module: 'workflows', action: 'manage', slug: 'workflows:manage', description: 'Gerenciar workflows' },
  // Macros
  { module: 'macros', action: 'read',   slug: 'macros:read',   description: 'Ver macros' },
  { module: 'macros', action: 'manage', slug: 'macros:manage', description: 'Gerenciar macros' },
  // IA — Granular
  { module: 'ai_agents',    action: 'read',   slug: 'ai_agents:read',    description: 'Ver agentes de IA' },
  { module: 'ai_agents',    action: 'manage', slug: 'ai_agents:manage',  description: 'Criar/editar/deletar agentes de IA' },
  { module: 'ai_providers', action: 'read',   slug: 'ai_providers:read',   description: 'Ver providers de IA' },
  { module: 'ai_providers', action: 'manage', slug: 'ai_providers:manage', description: 'Criar/editar/deletar providers de IA' },
  { module: 'ai_knowledge', action: 'read',   slug: 'ai_knowledge:read',   description: 'Ver bases de conhecimento' },
  { module: 'ai_knowledge', action: 'manage', slug: 'ai_knowledge:manage', description: 'Criar/editar/deletar bases de conhecimento' },
  { module: 'ai_sessions',  action: 'read',   slug: 'ai_sessions:read',    description: 'Ver sessões de IA' },
  { module: 'ai_sessions',  action: 'manage', slug: 'ai_sessions:manage',  description: 'Fechar/reabrir/deletar sessões de IA' },
  { module: 'ai_tools',     action: 'read',   slug: 'ai_tools:read',     description: 'Ver tool logs e servidores MCP' },
  { module: 'ai_tools',     action: 'manage', slug: 'ai_tools:manage',   description: 'Gerenciar servidores MCP' },
  { module: 'ai_reports',   action: 'read',   slug: 'ai_reports:read',   description: 'Ver relatórios de tokens e custos de IA' },
  { module: 'ai_brain',     action: 'read',   slug: 'ai_brain:read',     description: 'Ver Cérebro IA (perfil 360°, fatos, grafo)' },
  { module: 'ai_brain',     action: 'manage', slug: 'ai_brain:manage',   description: 'Gerenciar fatos/nodes/edges do Cérebro IA' },
  { module: 'integrations', action: 'read',   slug: 'integrations:read', description: 'Ver integrações externas (FishAudio, Cal.com etc)' },
  { module: 'integrations', action: 'manage', slug: 'integrations:manage', description: 'Criar/editar/deletar/testar integrações externas' },
  // Webhooks
  { module: 'webhooks', action: 'read',   slug: 'webhooks:read',   description: 'Ver webhooks' },
  { module: 'webhooks', action: 'manage', slug: 'webhooks:manage', description: 'Gerenciar webhooks' },
  // Configurações
  { module: 'settings', action: 'read',   slug: 'settings:read',   description: 'Ver configurações' },
  { module: 'settings', action: 'manage', slug: 'settings:manage', description: 'Alterar configurações da empresa' },
  // Relatórios
  { module: 'reports', action: 'read', slug: 'reports:read', description: 'Ver dashboard e relatórios' },
  // Roles
  { module: 'roles', action: 'manage', slug: 'roles:manage', description: 'Gerenciar funções e permissões' },
  // Pipelines
  { module: 'pipelines', action: 'read',   slug: 'pipelines:read',   description: 'Ver pipelines e stages' },
  { module: 'pipelines', action: 'manage', slug: 'pipelines:manage', description: 'Criar/editar/deletar pipelines e stages' },
  // Cards
  { module: 'cards', action: 'read',   slug: 'cards:read',   description: 'Ver cards do pipeline' },
  { module: 'cards', action: 'write',  slug: 'cards:write',  description: 'Criar/editar cards' },
  { module: 'cards', action: 'delete', slug: 'cards:delete', description: 'Deletar cards' },
  { module: 'cards', action: 'move',   slug: 'cards:move',   description: 'Mover cards entre stages (drag-and-drop)' },
  // Módulos CRM
  { module: 'crm_modules', action: 'read',   slug: 'crm_modules:read',   description: 'Ver módulos ativos e definições' },
  { module: 'crm_modules', action: 'manage', slug: 'crm_modules:manage', description: 'Ativar/desativar módulos por empresa' },
  // Agendamentos
  { module: 'schedules', action: 'read',   slug: 'schedules:read',   description: 'Ver agendamentos de mensagens' },
  { module: 'schedules', action: 'manage', slug: 'schedules:manage', description: 'Criar/editar/deletar agendamentos' },
  // Tickets Internos
  { module: 'tickets', action: 'read',   slug: 'tickets:read',   description: 'Ver tickets internos' },
  { module: 'tickets', action: 'create', slug: 'tickets:create', description: 'Criar tickets' },
  { module: 'tickets', action: 'update', slug: 'tickets:update', description: 'Atualizar tickets' },
  { module: 'tickets', action: 'delete', slug: 'tickets:delete', description: 'Deletar tickets' },
  // Goals (OKR)
  { module: 'goals', action: 'read',   slug: 'goals:read',   description: 'Ver objetivos e resultados-chave' },
  { module: 'goals', action: 'create', slug: 'goals:create', description: 'Criar objetivos' },
  { module: 'goals', action: 'update', slug: 'goals:update', description: 'Atualizar objetivos e check-ins' },
  { module: 'goals', action: 'delete', slug: 'goals:delete', description: 'Deletar objetivos' },
]

// ══════════════════════════════════════════
// Definição dos 3 Roles SYSTEM
// ══════════════════════════════════════════
const ALL_SLUGS = PERMISSIONS.map(p => p.slug)

const ADMIN_PERMISSIONS = ALL_SLUGS // Tudo

const MANAGER_PERMISSIONS = [
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
  'workflows:read', 'workflows:manage',
  'macros:read', 'macros:manage',
  'ai_agents:read', 'ai_agents:manage',
  'ai_providers:read',
  'ai_knowledge:read', 'ai_knowledge:manage',
  'ai_sessions:read', 'ai_sessions:manage',
  'ai_tools:read',
  'ai_reports:read',
  'ai_brain:read', 'ai_brain:manage',
  'integrations:read', 'integrations:manage',
  'reports:read',
  'settings:read',
  'pipelines:read', 'pipelines:manage',
  'cards:read', 'cards:write', 'cards:move',
  'crm_modules:read',
  'schedules:read', 'schedules:manage',
  'tickets:read', 'tickets:create', 'tickets:update',
  'goals:read', 'goals:create', 'goals:update',
]

const AGENT_PERMISSIONS = [
  'conversations:read', 'conversations:reply',
  'contacts:read', 'contacts:view_phone',
  'groups:read',
  'labels:read',
  'canned_responses:read',
  'custom_attributes:read',
  'macros:read',
  'reports:read',
  'pipelines:read',
  'cards:read', 'cards:write', 'cards:move',
  'crm_modules:read',
  'tickets:read', 'tickets:create', 'tickets:update',
  'goals:read',
]

interface RoleDef {
  name: string
  slug: string
  description: string
  defaultScope: 'OWN' | 'OWN_ONLY' | 'TEAM' | 'COMPANY'
  conversationScope: 'OWN' | 'OWN_ONLY' | 'TEAM' | 'COMPANY'
  canReplyConversations: boolean
  isDefault: boolean
  permissions: string[]
}

const SYSTEM_ROLES: RoleDef[] = [
  {
    name: 'Administrador',
    slug: 'admin',
    description: 'Acesso total à empresa',
    defaultScope: 'COMPANY',
    conversationScope: 'COMPANY',
    canReplyConversations: true,
    isDefault: false,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    name: 'Gerente',
    slug: 'manager',
    description: 'Gestão de times e operação',
    defaultScope: 'TEAM',
    conversationScope: 'TEAM',
    canReplyConversations: true,
    isDefault: false,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    name: 'Atendente',
    slug: 'agent',
    description: 'Atendimento e conversas',
    defaultScope: 'OWN',
    conversationScope: 'OWN',
    canReplyConversations: true,
    isDefault: true,
    permissions: AGENT_PERMISSIONS,
  },
]

// Mapeamento de UserRole antigo → slug do novo Role
const LEGACY_ROLE_MAP: Record<string, string> = {
  SUPER_ADMIN: 'admin',
  ADMIN: 'admin',
  OPERATOR: 'agent',
}

async function main() {
  console.log('🔐 RBAC Seed: Iniciando...\n')

  // ── 1. Seed de Permissions (globais, sem companyId) ──
  console.log('📋 Criando permissões...')
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { slug: p.slug },
      update: { module: p.module, action: p.action, description: p.description },
      create: p,
    })
  }
  console.log(`   ✅ ${PERMISSIONS.length} permissões criadas/atualizadas\n`)

  // Buscar todos os IDs de permission por slug
  const allPerms = await prisma.permission.findMany()
  const permBySlug = new Map(allPerms.map(p => [p.slug, p.id]))

  // ── 2. Criar SYSTEM roles por empresa ──
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  console.log(`🏢 ${companies.length} empresa(s) encontrada(s)\n`)

  for (const company of companies) {
    console.log(`   Empresa: ${company.name} (${company.id})`)

    for (const roleDef of SYSTEM_ROLES) {
      // Upsert do role
      const role = await prisma.role.upsert({
        where: { companyId_slug: { companyId: company.id, slug: roleDef.slug } },
        update: {
          name: roleDef.name,
          description: roleDef.description,
          defaultScope: roleDef.defaultScope,
          conversationScope: roleDef.conversationScope,
          canReplyConversations: roleDef.canReplyConversations,
          isDefault: roleDef.isDefault,
        },
        create: {
          companyId: company.id,
          name: roleDef.name,
          slug: roleDef.slug,
          description: roleDef.description,
          type: 'SYSTEM',
          defaultScope: roleDef.defaultScope,
          conversationScope: roleDef.conversationScope,
          canReplyConversations: roleDef.canReplyConversations,
          isDefault: roleDef.isDefault,
        },
      })

      // Upsert das role_permissions
      for (const permSlug of roleDef.permissions) {
        const permId = permBySlug.get(permSlug)
        if (!permId) {
          console.warn(`      ⚠️ Permissão ${permSlug} não encontrada, pulando`)
          continue
        }
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permId } },
          update: {},
          create: { roleId: role.id, permissionId: permId },
        })
      }

      console.log(`      ✅ ${roleDef.name}: ${roleDef.permissions.length} permissões`)
    }
  }

  // ── 3. Migração de users legados (já concluída — campo role removido) ──
  console.log('\n👥 Migração legada já concluída (roleId obrigatório no schema)')

  console.log('\n🎉 RBAC Seed concluído com sucesso!')
}

main()
  .catch((e) => {
    console.error('❌ Erro no RBAC Seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
