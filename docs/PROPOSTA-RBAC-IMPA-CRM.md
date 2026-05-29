# 🏗️ PROPOSTA TÉCNICA: RBAC para IMPA CRM

## Arquitetura de Times, Usuários e Controle de Acesso

---

## 📊 DIAGNÓSTICO DO ESTADO ATUAL

### O que existe hoje
| Componente | Estado | Problema |
|---|---|---|
| `UserRole enum` | `SUPER_ADMIN`, `ADMIN`, `OPERATOR` | 3 roles fixos, sem granularidade |
| Auth Middleware | `authMiddleware`, `adminMiddleware` | Binário: é admin ou não |
| JWT Token | `{ sub, companyId, role }` | Sem permissões no payload |
| Team/TeamMember | Tabelas existem | Sem roles de time, sem escopo de dados |
| Frontend Sidebar | 34 itens de menu | **Todos visíveis para todos** |
| Admin Check | `email === 'admin@whatsapp'` | **Hardcoded**, inseguro |
| Backend Protection | `adminMiddleware` em 4 endpoints | 21+ endpoints sem proteção de role |

### Vulnerabilidades Críticas
1. OPERATOR pode criar/deletar times (sem `adminMiddleware` no team.routes)
2. OPERATOR pode listar todos os usuários da empresa
3. Sidebar mostra tudo → usuário tenta acessar → 403 (UX ruim)
4. Nenhum filtro de dados por escopo (OPERATOR vê todas as conversas)
5. Token JWT sem permissões → frontend não sabe o que esconder

---

## 🏛️ ARQUITETURA PROPOSTA

### Princípios Fundamentais

```
┌──────────────────────────────────────────────────────────────┐
│                     CAMADAS DO RBAC                          │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ PERMISSION  │   │   ROLE       │   │  ACCESS POLICY   │  │
│  │ (Atômica)   │──>│ (Agrupamento)│──>│  (Escopo/Dados)  │  │
│  └─────────────┘   └──────────────┘   └──────────────────┘  │
│                                                              │
│  "pode ver"        "é Gerente"        "vê dados do time"    │
│  "pode editar"     "é Atendente"      "vê dados próprios"   │
│  "pode deletar"    "é Admin"          "vê tudo da empresa"  │
└──────────────────────────────────────────────────────────────┘
```

**Permission** = capacidade atômica (ex: `conversations:read`, `contacts:write`)
**Role** = conjunto de permissions + escopo padrão (ex: MANAGER = 15 permissions + escopo TEAM)
**Access Policy** = regra de visibilidade de DADOS (OWN / TEAM / COMPANY)

---

## 📐 MODELAGEM DE DADOS

### Enums

```prisma
// ── Escopos de acesso a dados ──
enum DataScope {
  OWN       // Apenas registros atribuídos ao próprio usuário
  TEAM      // Registros dos times do usuário
  COMPANY   // Todos os registros da empresa
}

// ── Tipo de role (built-in vs custom) ──
enum RoleType {
  SYSTEM    // Criado pelo seed, não pode ser deletado
  CUSTOM    // Criado pelo admin da empresa
}
```

### Tabela `roles`

```prisma
model Role {
  id          String    @id @default(uuid())
  companyId   String?   // null = role global (SUPER_ADMIN)
  name        String    // "Administrador", "Gerente", "Atendente"
  slug        String    // "admin", "manager", "agent"
  description String?
  type        RoleType  @default(CUSTOM)
  
  // ── Escopo padrão para este role ──
  defaultScope  DataScope @default(OWN)
  
  // ── Configurações de conversa ──
  conversationScope  DataScope @default(OWN)
  // OWN    = só conversas atribuídas a si
  // TEAM   = conversas atribuídas ao time + não atribuídas
  // COMPANY = todas as conversas
  
  canReplyConversations  Boolean @default(true)
  // false = read-only em conversas (apenas visualizar)
  
  isDefault   Boolean   @default(false) // Role padrão para novos usuários
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  company     Company?  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  users       User[]
  permissions RolePermission[]
  
  @@unique([companyId, slug])
  @@map("roles")
}
```

### Tabela `permissions`

```prisma
model Permission {
  id          String   @id @default(uuid())
  module      String   // "conversations", "contacts", "teams", "ai", etc.
  action      String   // "read", "write", "delete", "manage"
  slug        String   @unique // "conversations:read", "contacts:write"
  description String?  // "Ver conversas", "Editar contatos"
  
  @@unique([module, action])
  @@map("permissions")
}
```

### Tabela `role_permissions` (Join)

```prisma
model RolePermission {
  id           String     @id @default(uuid())
  roleId       String
  permissionId String
  
  // ── Override de escopo por permissão (opcional) ──
  // Se null, usa o defaultScope do Role
  scopeOverride DataScope?
  
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  
  @@unique([roleId, permissionId])
  @@map("role_permissions")
}
```

### Alterações no `User`

```prisma
model User {
  id        String   @id @default(uuid())
  companyId String
  name      String
  email     String   @unique
  password  String
  
  // ── SUBSTITUIR campo role enum por FK ──
  roleId    String        // FK para Role
  // REMOVER: role UserRole @default(OPERATOR)
  
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  company  Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  role     Role    @relation(fields: [roleId], references: [id])
  
  // ... demais relações existentes mantidas
  teamMemberships          TeamMember[]
  assignedConversations    Conversation[] @relation("ConversationAssignee")
  // etc.
  
  @@map("users")
}
```

### Diagrama de Relações

```
Company (1) ──── (*) Role
                      │
                      ├── (1) ──── (*) RolePermission ──── (*) Permission
                      │
                      └── (1) ──── (*) User ──── (*) TeamMember ──── (*) Team
                                                         
Permission (global, sem companyId)
  │
  └── Seeded na instalação (imutáveis)

Role (por empresa)
  │
  ├── SYSTEM roles: admin, manager, agent (seeded, não deletáveis)
  └── CUSTOM roles: criados pelo admin da empresa
```

---

## 🔑 PERMISSÕES ATÔMICAS (Seed Completo)

### Catálogo de Permissões

```typescript
// permissions.seed.ts
const PERMISSIONS = [
  // ── Conversas ──
  { module: 'conversations', action: 'read',    slug: 'conversations:read',    description: 'Ver conversas' },
  { module: 'conversations', action: 'reply',   slug: 'conversations:reply',   description: 'Responder conversas' },
  { module: 'conversations', action: 'assign',  slug: 'conversations:assign',  description: 'Atribuir conversas' },
  { module: 'conversations', action: 'manage',  slug: 'conversations:manage',  description: 'Gerenciar status/prioridade de conversas' },
  
  // ── Contatos ──
  { module: 'contacts', action: 'read',    slug: 'contacts:read',    description: 'Ver contatos' },
  { module: 'contacts', action: 'write',   slug: 'contacts:write',   description: 'Editar contatos' },
  { module: 'contacts', action: 'delete',  slug: 'contacts:delete',  description: 'Deletar contatos' },
  { module: 'contacts', action: 'import',  slug: 'contacts:import',  description: 'Importar contatos' },
  
  // ── Times ──
  { module: 'teams', action: 'read',   slug: 'teams:read',   description: 'Ver times' },
  { module: 'teams', action: 'manage', slug: 'teams:manage', description: 'Criar/editar/deletar times' },
  
  // ── Usuários ──
  { module: 'users', action: 'read',   slug: 'users:read',   description: 'Ver usuários' },
  { module: 'users', action: 'manage', slug: 'users:manage', description: 'Criar/editar/desativar usuários' },
  
  // ── Etiquetas ──
  { module: 'labels', action: 'read',   slug: 'labels:read',   description: 'Ver etiquetas' },
  { module: 'labels', action: 'manage', slug: 'labels:manage', description: 'Gerenciar etiquetas' },
  
  // ── Respostas Prontas ──
  { module: 'canned_responses', action: 'read',   slug: 'canned_responses:read',   description: 'Ver respostas prontas' },
  { module: 'canned_responses', action: 'manage', slug: 'canned_responses:manage', description: 'Gerenciar respostas prontas' },
  
  // ── Campos Custom ──
  { module: 'custom_attributes', action: 'read',   slug: 'custom_attributes:read',   description: 'Ver campos personalizados' },
  { module: 'custom_attributes', action: 'manage', slug: 'custom_attributes:manage', description: 'Gerenciar campos personalizados' },
  
  // ── Instâncias (WhatsApp) ──
  { module: 'instances', action: 'read',   slug: 'instances:read',   description: 'Ver instâncias' },
  { module: 'instances', action: 'manage', slug: 'instances:manage', description: 'Criar/editar/conectar instâncias' },
  
  // ── Campanhas ──
  { module: 'campaigns', action: 'read',   slug: 'campaigns:read',   description: 'Ver campanhas' },
  { module: 'campaigns', action: 'manage', slug: 'campaigns:manage', description: 'Criar/executar campanhas' },
  
  // ── Templates (Meta) ──
  { module: 'templates', action: 'read',   slug: 'templates:read',   description: 'Ver templates' },
  { module: 'templates', action: 'manage', slug: 'templates:manage', description: 'Gerenciar templates' },
  
  // ── Automações ──
  { module: 'automations', action: 'read',   slug: 'automations:read',   description: 'Ver automações' },
  { module: 'automations', action: 'manage', slug: 'automations:manage', description: 'Gerenciar automações' },
  
  // ── Fluxos (Chatbot) ──
  { module: 'flows', action: 'read',   slug: 'flows:read',   description: 'Ver fluxos' },
  { module: 'flows', action: 'manage', slug: 'flows:manage', description: 'Gerenciar fluxos' },
  
  // ── Macros ──
  { module: 'macros', action: 'read',   slug: 'macros:read',   description: 'Ver macros' },
  { module: 'macros', action: 'manage', slug: 'macros:manage', description: 'Gerenciar macros' },
  
  // ── IA (Agentes, Providers, KB, MCP) ──
  { module: 'ai', action: 'read',   slug: 'ai:read',   description: 'Ver configurações de IA' },
  { module: 'ai', action: 'manage', slug: 'ai:manage', description: 'Gerenciar agentes/providers/KB de IA' },
  
  // ── Webhooks ──
  { module: 'webhooks', action: 'read',   slug: 'webhooks:read',   description: 'Ver webhooks' },
  { module: 'webhooks', action: 'manage', slug: 'webhooks:manage', description: 'Gerenciar webhooks' },
  
  // ── Configurações da Empresa ──
  { module: 'settings', action: 'read',   slug: 'settings:read',   description: 'Ver configurações' },
  { module: 'settings', action: 'manage', slug: 'settings:manage', description: 'Alterar configurações da empresa' },
  
  // ── Relatórios / Dashboard ──
  { module: 'reports', action: 'read',   slug: 'reports:read',   description: 'Ver dashboard e relatórios' },
  
  // ── Roles & Permissões (meta-permissão) ──
  { module: 'roles', action: 'manage', slug: 'roles:manage', description: 'Gerenciar funções e permissões' },
]
```

**Total: 38 permissões atômicas em 16 módulos**

---

## 👤 ROLES PADRÃO (Seed)

### ADMIN (Administrador)

```
Escopo padrão: COMPANY (vê tudo da empresa)
Escopo de conversas: COMPANY
Pode responder conversas: true

Permissões: TODAS as 38 permissões
```

O Admin tem acesso irrestrito dentro da sua empresa. É o primeiro role atribuído ao usuário que registra a conta.

### MANAGER (Gerente)

```
Escopo padrão: TEAM (vê dados dos seus times)
Escopo de conversas: TEAM
Pode responder conversas: true

Permissões incluídas:
  ✅ conversations:read, reply, assign, manage
  ✅ contacts:read, write
  ✅ teams:read
  ✅ users:read
  ✅ labels:read, manage
  ✅ canned_responses:read, manage
  ✅ custom_attributes:read
  ✅ instances:read
  ✅ campaigns:read, manage
  ✅ templates:read
  ✅ automations:read
  ✅ flows:read
  ✅ macros:read, manage
  ✅ ai:read
  ✅ reports:read
  ✅ settings:read

Permissões NÃO incluídas:
  ❌ contacts:delete, import
  ❌ teams:manage
  ❌ users:manage
  ❌ custom_attributes:manage
  ❌ instances:manage
  ❌ automations:manage, flows:manage
  ❌ ai:manage
  ❌ webhooks:*, settings:manage, roles:manage
```

### AGENT (Atendente)

```
Escopo padrão: OWN (vê apenas dados próprios)
Escopo de conversas: OWN (apenas conversas atribuídas a si + não atribuídas)
Pode responder conversas: true

Permissões incluídas:
  ✅ conversations:read, reply
  ✅ contacts:read, write
  ✅ labels:read
  ✅ canned_responses:read
  ✅ custom_attributes:read
  ✅ macros:read
  ✅ reports:read (apenas próprio dashboard)

Permissões NÃO incluídas:
  ❌ conversations:assign, manage
  ❌ contacts:delete, import
  ❌ teams:*, users:*
  ❌ instances:*, campaigns:*, templates:*
  ❌ automations:*, flows:*, ai:*, webhooks:*
  ❌ settings:*, roles:*
```

### SUPER_ADMIN (Global — sem companyId)

```
Escopo: GLOBAL (cross-empresa)
Role especial, companyId = null
Não é configurável por empresa
Usado apenas pela rota /admin
```

---

## 🔒 BACKEND: Middlewares, Policies e Guards

### 1. Novo JWT Payload

```typescript
// O token JWT passa a incluir permissões e escopo
interface JWTPayload {
  sub: string           // userId
  companyId: string
  roleId: string
  roleSlug: string      // "admin" | "manager" | "agent" | "custom-xxx"
  permissions: string[] // ["conversations:read", "contacts:write", ...]
  conversationScope: DataScope
  defaultScope: DataScope
  teamIds: string[]     // IDs dos times do usuário
}
```

**Nota:** O array `permissions` no JWT permite ao frontend saber instantaneamente o que mostrar/esconder, sem chamada extra ao servidor. O tamanho do token é controlado (38 slugs curtos ≈ 800 bytes).

### 2. Middleware: `requirePermission`

```typescript
// backend/src/middlewares/permission.middleware.ts

/**
 * Middleware factory que verifica se o usuário possui a permissão atômica necessária.
 * Uso: { preHandler: [authMiddleware, requirePermission('contacts:write')] }
 */
export function requirePermission(...requiredPermissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userPerms = request.user.permissions || []
    
    // SUPER_ADMIN bypass
    if (request.user.roleSlug === 'super_admin') return
    
    const hasAll = requiredPermissions.every(p => userPerms.includes(p))
    if (!hasAll) {
      return reply.status(403).send({
        error: 'Forbidden',
        required: requiredPermissions,
        message: 'Você não tem permissão para esta ação',
      })
    }
  }
}
```

### 3. Service: `ScopeFilter` (Filtro de Dados por Escopo)

```typescript
// backend/src/middlewares/scope.middleware.ts

/**
 * Retorna condições WHERE do Prisma baseadas no escopo do usuário.
 * Usado em TODAS as queries que listam dados.
 */
export function scopedWhere(
  request: FastifyRequest,
  module: string = 'default'
): Record<string, any> {
  const { companyId, id: userId, teamIds } = request.user
  
  // Determinar escopo efetivo
  const scope = module === 'conversations'
    ? request.user.conversationScope
    : request.user.defaultScope
  
  // Base: sempre filtrar por empresa
  const where: Record<string, any> = { companyId }
  
  switch (scope) {
    case 'OWN':
      if (module === 'conversations') {
        // Conversas atribuídas a mim OU não atribuídas (pool)
        where.OR = [
          { assigneeId: userId },
          { assigneeId: null },
        ]
      }
      break
      
    case 'TEAM':
      if (module === 'conversations') {
        // Conversas dos meus times + não atribuídas + atribuídas a mim
        where.OR = [
          { teamId: { in: teamIds } },
          { assigneeId: userId },
          { assigneeId: null },
        ]
      }
      break
      
    case 'COMPANY':
      // Sem filtro adicional (vê tudo da empresa)
      break
  }
  
  return where
}
```

### 4. Exemplo de Aplicação em Rotas

```typescript
// ANTES (sem RBAC):
app.get('/conversations/:instanceId', async (request, reply) => {
  const conversations = await prisma.$queryRaw`
    SELECT * FROM conversations WHERE "instanceId" = ${instanceId}
  `
})

// DEPOIS (com RBAC):
app.get('/conversations/:instanceId', {
  preHandler: [authMiddleware, requirePermission('conversations:read')]
}, async (request, reply) => {
  const scopeFilter = scopedWhere(request, 'conversations')
  const conversations = await prisma.$queryRaw`
    SELECT * FROM conversations 
    WHERE "instanceId" = ${instanceId}
    AND "companyId" = ${request.user.companyId}
    ${scopeFilter.OR ? Prisma.sql`AND (
      "assigneeId" = ${request.user.id}
      OR "assigneeId" IS NULL
      ${scopeFilter.OR.some(o => o.teamId) 
        ? Prisma.sql`OR "teamId" = ANY(${request.user.teamIds})` 
        : Prisma.empty}
    )` : Prisma.empty}
  `
})
```

### 5. Tabela de Middlewares por Rota

| Módulo Backend | Rota | Middleware Atual | Middleware Proposto |
|---|---|---|---|
| `/api/users` GET | Listar | `authMiddleware` | `+ requirePermission('users:read')` |
| `/api/users` POST | Criar | `adminMiddleware` | `requirePermission('users:manage')` |
| `/api/teams` POST | Criar | *(nenhum extra)* | `+ requirePermission('teams:manage')` |
| `/api/teams` GET | Listar | *(nenhum extra)* | `+ requirePermission('teams:read')` |
| `/api/contacts` GET | Listar | `authMiddleware` | `+ requirePermission('contacts:read')` |
| `/api/contacts` PUT | Editar | `authMiddleware` | `+ requirePermission('contacts:write')` |
| `/api/contacts` DELETE | Deletar | `authMiddleware` | `+ requirePermission('contacts:delete')` |
| `/api/instances` POST | Criar | `authMiddleware` | `+ requirePermission('instances:manage')` |
| `/api/campaigns` POST | Criar | `authMiddleware` | `+ requirePermission('campaigns:manage')` |
| `/api/ai` POST | Criar agente | `authMiddleware` | `+ requirePermission('ai:manage')` |
| `/api/flows` POST | Criar fluxo | `authMiddleware` | `+ requirePermission('flows:manage')` |
| `/api/settings` PUT | Alterar | `adminMiddleware` | `requirePermission('settings:manage')` |
| `/api/roles` * | CRUD roles | *(não existe)* | `requirePermission('roles:manage')` |
| `/api/messages/mark-read` | Ler msgs | `authMiddleware` | `+ requirePermission('conversations:read')` |
| `/api/messages/send-*` | Enviar | `authMiddleware` | `+ requirePermission('conversations:reply')` |

---

## 🎨 FRONTEND: Hooks, Guards e Sidebar Dinâmica

### 1. Hook: `usePermissions`

```typescript
// frontend/src/hooks/usePermissions.ts

import { useAuthStore } from '@/stores/auth.store'

export function usePermissions() {
  const { user } = useAuthStore()
  const permissions = user?.permissions || []
  const roleSlug = user?.roleSlug || ''
  
  /** Verifica se tem TODAS as permissões listadas */
  const can = (...perms: string[]): boolean => {
    if (roleSlug === 'super_admin') return true
    return perms.every(p => permissions.includes(p))
  }
  
  /** Verifica se tem PELO MENOS UMA das permissões */
  const canAny = (...perms: string[]): boolean => {
    if (roleSlug === 'super_admin') return true
    return perms.some(p => permissions.includes(p))
  }
  
  const isAdmin = roleSlug === 'admin'
  const isManager = roleSlug === 'manager'
  const isAgent = roleSlug === 'agent'
  const isSuperAdmin = roleSlug === 'super_admin'
  
  return { can, canAny, isAdmin, isManager, isAgent, isSuperAdmin, permissions }
}
```

### 2. Componente Guard: `<Authorized>`

```tsx
// frontend/src/components/Authorized.tsx

interface AuthorizedProps {
  permission: string | string[]
  fallback?: React.ReactNode  // O que mostrar se não autorizado
  children: React.ReactNode
}

export function Authorized({ permission, fallback = null, children }: AuthorizedProps) {
  const { can, canAny } = usePermissions()
  
  const perms = Array.isArray(permission) ? permission : [permission]
  const authorized = canAny(...perms)
  
  return authorized ? <>{children}</> : <>{fallback}</>
}

// Uso:
// <Authorized permission="contacts:write">
//   <button>Editar Contato</button>
// </Authorized>
```

### 3. Route Guard: `<PermissionRoute>`

```tsx
// frontend/src/components/PermissionRoute.tsx

export function PermissionRoute({ permission, children }: { permission: string | string[], children: React.ReactNode }) {
  const { canAny } = usePermissions()
  const perms = Array.isArray(permission) ? permission : [permission]
  
  if (!canAny(...perms)) {
    return <Navigate to="/messages" replace />
    // Redireciona para mensagens (tela padrão de agente)
  }
  
  return <>{children}</>
}
```

### 4. Sidebar Dinâmica

```typescript
// A sidebar filtra items baseado nas permissões reais do JWT

const crmMenuItems = [
  { path: '/instances',         label: 'Instâncias',        icon: Smartphone,     permission: 'instances:read' },
  { path: '/messages',          label: 'Mensagens',         icon: MessageSquare,  permission: 'conversations:read' },
  { path: '/contacts',          label: 'Contatos',          icon: Users,          permission: 'contacts:read' },
  { path: '/groups',            label: 'Grupos',            icon: Users2,         permission: 'contacts:read' },
  { path: '/teams',             label: 'Times',             icon: Shield,         permission: 'teams:read' },
  { path: '/labels',            label: 'Etiquetas',         icon: Tag,            permission: 'labels:read' },
  { path: '/canned-responses',  label: 'Respostas Prontas', icon: MessageCircle,  permission: 'canned_responses:read' },
  { path: '/custom-attributes', label: 'Campos Custom',     icon: Settings2,      permission: 'custom_attributes:read' },
]

// Na renderização:
const visibleItems = crmMenuItems.filter(item => can(item.permission))
```

**Regra:** Se `visibleItems` de um grupo for vazio, o grupo inteiro é ocultado.

### 5. Atualização do Auth Store

```typescript
// frontend/src/stores/auth.store.ts (adições)
interface AuthState {
  user: User | null           // inclui: permissions[], roleSlug, roleId, teamIds[]
  // ...
}

// Tipo User expandido:
interface User {
  id: string
  name: string
  email: string
  companyId: string
  roleId: string
  roleSlug: string            // "admin" | "manager" | "agent" | "custom-xxx"
  permissions: string[]       // ["conversations:read", "contacts:write", ...]
  conversationScope: string   // "OWN" | "TEAM" | "COMPANY"
  defaultScope: string
  teamIds: string[]           // IDs dos times
}
```

---

## 🖥️ TELAS DE GESTÃO

### Página: Usuários (`/users` — nova ou substituir `/settings`)

```
┌─────────────────────────────────────────────────────────────┐
│  👥 Usuários                                    [+ Novo]   │
│  Gerencie os membros da sua empresa                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔍 Buscar por nome ou email...     [Filtro ▾]      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────┬───────────────────┬────────────┬──────────┐  │
│  │ Usuário  │ E-mail            │ Função     │ Status   │  │
│  ├──────────┼───────────────────┼────────────┼──────────┤  │
│  │ 🟢 Impa  │ admin@whatsapp    │ Admin      │ Ativo    │  │
│  │ ⚪ João  │ joao@exemplo.com  │ Gerente    │ Ativo    │  │
│  │ ⚪ Maria │ maria@exemplo.com │ Atendente  │ Inativo  │  │
│  └──────────┴───────────────────┴────────────┴──────────┘  │
│                                                             │
│  Mostrando 3 de 3 usuários                                 │
└─────────────────────────────────────────────────────────────┘
```

**Modal/Drawer de Criar/Editar Usuário:**
```
┌──────────────────────────────────────┐
│  Novo Usuário                    ✕   │
│                                      │
│  Nome *          [________________]  │
│  E-mail *        [________________]  │
│  Senha *         [________________]  │
│                                      │
│  Função *        [Atendente     ▾]   │
│  ┌────────────────────────────────┐  │
│  │ Administrador                  │  │
│  │ Gerente                        │  │
│  │ ● Atendente (recomendado)      │  │
│  │ Suporte N1 (custom)            │  │
│  └────────────────────────────────┘  │
│                                      │
│  Times            [+ Adicionar]      │
│  ┌────────────────────────────────┐  │
│  │ 🏷 Vendas            ✕        │  │
│  │ 🏷 Suporte           ✕        │  │
│  └────────────────────────────────┘  │
│                                      │
│  ☑ Ativo                             │
│                                      │
│  [Cancelar]              [Salvar]    │
└──────────────────────────────────────┘
```

### Página: Funções (`/roles` — nova)

```
┌─────────────────────────────────────────────────────────────┐
│  🛡️ Funções                               [+ Nova Função]  │
│  Configure permissões e escopos de acesso                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Administrador              SISTEMA    3 usuários    │  │
│  │  Acesso total à empresa                              │  │
│  │  Escopo: Empresa · 38 permissões                     │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Gerente                    SISTEMA    0 usuários    │  │
│  │  Gestão de times e operação                          │  │
│  │  Escopo: Time · 25 permissões                        │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Atendente                  SISTEMA    0 usuários    │  │
│  │  Atendimento e conversas                    ⭐ Padrão│  │
│  │  Escopo: Próprio · 7 permissões                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Editor de Função (Matriz de Permissões)

```
┌─────────────────────────────────────────────────────────────┐
│  🛡️ Editar Função: Gerente                                 │
│                                                             │
│  Nome *          [Gerente______________]                    │
│  Descrição       [Gestão de times e operação____]           │
│                                                             │
│  ── ESCOPO DE DADOS ────────────────────────────────────    │
│                                                             │
│  Escopo Padrão:                                             │
│  ○ Próprio   ● Time   ○ Empresa                            │
│                                                             │
│  Escopo de Conversas:                                       │
│  ○ Próprio   ● Time   ○ Empresa                            │
│                                                             │
│  ☑ Pode responder conversas                                 │
│                                                             │
│  ── PERMISSÕES ─────────────────────────────────────────    │
│                                                             │
│  ▼ Conversas                                                │
│    ☑ Ver conversas         ☑ Responder                      │
│    ☑ Atribuir              ☑ Gerenciar status               │
│                                                             │
│  ▼ Contatos                                                 │
│    ☑ Ver contatos          ☑ Editar                         │
│    ☐ Deletar               ☐ Importar                       │
│                                                             │
│  ▼ Times                                                    │
│    ☑ Ver times             ☐ Gerenciar times                │
│                                                             │
│  ▼ Usuários                                                 │
│    ☑ Ver usuários          ☐ Gerenciar usuários             │
│                                                             │
│  ▶ Etiquetas                  [☑ Ver] [☑ Gerenciar]        │
│  ▶ Respostas Prontas          [☑ Ver] [☑ Gerenciar]        │
│  ▶ Campos Custom              [☑ Ver] [☐ Gerenciar]        │
│  ▶ Instâncias                 [☑ Ver] [☐ Gerenciar]        │
│  ▶ Campanhas                  [☑ Ver] [☑ Gerenciar]        │
│  ▶ Templates                  [☑ Ver] [☐ Gerenciar]        │
│  ▶ Automações                 [☑ Ver] [☐ Gerenciar]        │
│  ▶ Fluxos                     [☑ Ver] [☐ Gerenciar]        │
│  ▶ Macros                     [☑ Ver] [☑ Gerenciar]        │
│  ▶ IA                         [☑ Ver] [☐ Gerenciar]        │
│  ▶ Webhooks                   [☐ Ver] [☐ Gerenciar]        │
│  ▶ Configurações              [☑ Ver] [☐ Alterar]          │
│  ▶ Relatórios                 [☑ Ver]                       │
│  ▶ Funções                    [☐ Gerenciar]                 │
│                                                             │
│  [Cancelar]                              [Salvar Função]    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 PLANO DE IMPLEMENTAÇÃO POR FASES

### FASE 1 — Modelagem de Dados e Migração
**Estimativa: Impacto médio**

1. Criar migração Prisma:
   - Tabela `permissions` (seed global)
   - Tabela `roles` (com `companyId`, `slug`, `type`, `defaultScope`, `conversationScope`)
   - Tabela `role_permissions` (join com `scopeOverride`)
   - Adicionar `roleId` em `User` (nullable inicialmente para migração)
   - Manter campo `role` (enum) temporariamente para retrocompatibilidade

2. Criar seed:
   - Inserir 38 permissões
   - Inserir 3 roles SYSTEM (admin, manager, agent) **por empresa existente**
   - Migrar users existentes: `ADMIN → role admin`, `OPERATOR → role agent`
   - Tornar `roleId` NOT NULL
   - Remover enum `UserRole` e campo `role`

3. Atualizar Prisma schema final

**Arquivos criados/alterados:**
```
backend/prisma/schema.prisma          (novos models)
backend/prisma/migrations/xxx/        (migration)
backend/prisma/seed.ts                (seeds de permissions + roles)
```

### FASE 2 — Backend: Auth e Autorização
**Estimativa: Impacto alto**

1. **Atualizar JWT** — incluir permissions[], roleSlug, teamIds[] no token
2. **Criar `permission.middleware.ts`** — `requirePermission('slug')`
3. **Criar `scope.middleware.ts`** — `scopedWhere(request, module)`
4. **Criar `role.routes.ts`** — CRUD de roles customizados
5. **Atualizar `auth.service.ts`** — login/register retornam permissions expandidas
6. **Atualizar TODAS as rotas** — adicionar `requirePermission` como preHandler

**Arquivos criados/alterados:**
```
backend/src/middlewares/permission.middleware.ts   (NOVO)
backend/src/middlewares/scope.middleware.ts        (NOVO)
backend/src/modules/roles/role.routes.ts          (NOVO)
backend/src/modules/roles/role.service.ts         (NOVO)
backend/src/middlewares/auth.middleware.ts         (ATUALIZAR)
backend/src/modules/auth/auth.service.ts          (ATUALIZAR)
backend/src/modules/auth/auth.controller.ts       (ATUALIZAR)
backend/src/modules/users/user.routes.ts          (ATUALIZAR)
backend/src/modules/teams/team.routes.ts          (ATUALIZAR)
backend/src/modules/messages/message.routes.ts    (ATUALIZAR)
backend/src/modules/contacts/contact.routes.ts    (ATUALIZAR)
backend/src/modules/conversations/conversation.routes.ts (ATUALIZAR)
// ... + demais routes que precisam de requirePermission
backend/src/server.ts                             (registrar role.routes)
```

### FASE 3 — Frontend: Telas de Gestão
**Estimativa: Impacto médio-alto**

1. **Criar `usePermissions` hook** — `can()`, `canAny()`
2. **Criar componente `<Authorized>`** — gate declarativo
3. **Criar `<PermissionRoute>`** — guard de rota
4. **Atualizar `auth.store.ts`** — incluir permissions, roleSlug, teamIds
5. **Atualizar `Sidebar.tsx`** — filtrar items por permission
6. **Criar página `Roles.tsx`** — CRUD de funções com matriz de permissões
7. **Atualizar página `Users.tsx`** (se existir) ou `Settings.tsx` — atribuir roleId
8. **Atualizar página `Teams.tsx`** — proteger ações por permission

**Arquivos criados/alterados:**
```
frontend/src/hooks/usePermissions.ts               (NOVO)
frontend/src/components/Authorized.tsx             (NOVO)
frontend/src/components/PermissionRoute.tsx        (NOVO)
frontend/src/pages/Roles.tsx                       (NOVO)
frontend/src/pages/Users.tsx                       (NOVO ou ATUALIZAR)
frontend/src/stores/auth.store.ts                  (ATUALIZAR)
frontend/src/types/index.ts                        (ATUALIZAR)
frontend/src/components/layout/Sidebar.tsx         (ATUALIZAR)
frontend/src/App.tsx                               (ATUALIZAR routes)
frontend/src/pages/Teams.tsx                       (ATUALIZAR)
```

### FASE 4 — Integração com Atendimento e CRM
**Estimativa: Impacto alto**

1. **Filtro de conversas por escopo** — OWN/TEAM/COMPANY no endpoint de lista
2. **Controle de reply** — desabilitar input se `canReplyConversations = false`
3. **Controle de assign** — esconder botão se não tem `conversations:assign`
4. **Filtro de contatos por escopo** — AGENT vê apenas contatos das suas conversas
5. **Dashboard adaptativo** — métricas filtradas pelo escopo do usuário
6. **Auto-assign com respeito a times** — round-robin dentro do time

**Arquivos alterados:**
```
backend/src/modules/messages/message.routes.ts     (filtro de conversas)
frontend/src/pages/Messages.tsx                    (reply gate, assign gate)
frontend/src/pages/Dashboard.tsx                   (métricas scope-aware)
frontend/src/pages/Contacts.tsx                    (filtro scope-aware)
```

### FASE 5 — Refinamento de UX e Políticas Avançadas
**Estimativa: Impacto baixo-médio**

1. **Feedback visual** — tooltips "Sem permissão" em items desabilitados
2. **Audit Log** — registrar mudanças de role e permissão
3. **Convite por e-mail** — enviar link de ativação ao criar usuário
4. **Session invalidation** — revogar token quando role muda
5. **Capacity policy** — limitar conversas simultâneas por agente
6. **Horário de atendimento** — disponibilidade por time

---

## 🔄 FLUXO DE PERMISSÕES END-TO-END

```
1. LOGIN
   ├── Backend: auth.service.login()
   │   ├── Busca User + Role + RolePermissions + Permissions + TeamMemberships
   │   ├── Monta payload: { sub, companyId, roleId, roleSlug, permissions[], 
   │   │                     conversationScope, defaultScope, teamIds[] }
   │   └── Assina JWT (7d)
   │
   └── Frontend: auth.store.setAuth(user)
       ├── Persiste user com permissions[] no localStorage
       └── Sidebar re-renderiza (filtra items autorizados)

2. NAVEGAÇÃO (Frontend)
   ├── <PermissionRoute permission="contacts:read">
   │   └── Se NÃO tem → redirect para /messages
   │
   ├── <Authorized permission="contacts:write">
   │   └── Se NÃO tem → esconde botão "Editar"
   │
   └── Sidebar.tsx
       └── visibleItems = items.filter(i => can(i.permission))

3. REQUEST API (Backend)
   ├── authMiddleware → verifica JWT, popula request.user
   │
   ├── requirePermission('contacts:write')
   │   └── Se NÃO tem → 403 Forbidden
   │
   ├── scopedWhere(request, 'contacts')
   │   ├── OWN → WHERE assigneeId = userId
   │   ├── TEAM → WHERE teamId IN (teamIds)
   │   └── COMPANY → WHERE companyId = companyId
   │
   └── Query executa com filtro → retorna dados autorizados

4. MUDANÇA DE ROLE (Admin edita role de usuário)
   ├── Backend: PUT /api/users/:id (roleId novo)
   ├── Token anterior continua válido (7d TTL)
   ├── Frontend: ao receber 403, faz refresh de profile
   │   └── GET /api/auth/profile → retorna permissions atualizadas
   └── Alternativa: relogin forçado (invalida sessão)
```

---

## 📁 ESTRUTURA FINAL DE ARQUIVOS (Novos e Alterados)

```
backend/
  prisma/
    schema.prisma                          [ALTERAR] - Novos models
    seed.ts                                [ALTERAR] - Seed permissions + roles
    migrations/
      xxx_rbac_roles_permissions/          [NOVO]
  src/
    middlewares/
      auth.middleware.ts                   [ALTERAR] - JWT expandido
      permission.middleware.ts             [NOVO]    - requirePermission()
      scope.middleware.ts                  [NOVO]    - scopedWhere()
    modules/
      auth/
        auth.service.ts                    [ALTERAR] - Login com permissions
        auth.controller.ts                 [ALTERAR] - JWT payload expandido
      roles/
        role.routes.ts                     [NOVO]    - CRUD roles
        role.service.ts                    [NOVO]    - Lógica de roles
      users/
        user.routes.ts                     [ALTERAR] - requirePermission + roleId
      teams/
        team.routes.ts                     [ALTERAR] - requirePermission
      messages/
        message.routes.ts                  [ALTERAR] - scope filter conversas
      contacts/
        contact.routes.ts                  [ALTERAR] - requirePermission
      conversations/
        conversation.routes.ts             [ALTERAR] - scope filter
    server.ts                              [ALTERAR] - Registrar role.routes

frontend/
  src/
    hooks/
      usePermissions.ts                    [NOVO]    - can(), canAny()
    components/
      Authorized.tsx                       [NOVO]    - Gate declarativo
      PermissionRoute.tsx                  [NOVO]    - Route guard
      layout/
        Sidebar.tsx                        [ALTERAR] - Items filtrados
    pages/
      Roles.tsx                            [NOVO]    - Gestão de funções
      Users.tsx                            [NOVO]    - Gestão de usuários (nova)
    stores/
      auth.store.ts                        [ALTERAR] - permissions no state
    types/
      index.ts                             [ALTERAR] - User type expandido
    App.tsx                                [ALTERAR] - Novas rotas + guards
```

---

## ⚠️ DECISÕES ARQUITETURAIS IMPORTANTES

### 1. Permissions no JWT vs. Buscar do Banco
**Decisão:** Permissions vão NO JWT.

*Motivo:* Com 38 permissões (slugs curtos), o payload adiciona ~800 bytes ao token. Isso elimina uma round-trip ao banco em cada request. O tradeoff é que mudanças de role demoram até o próximo login pra refletir — aceitável com `GET /auth/profile` como refresh.

### 2. Role por Empresa (não global)
**Decisão:** Cada empresa tem suas próprias instâncias dos 3 roles SYSTEM + roles CUSTOM.

*Motivo:* Permite que empresa A customize o role "Gerente" diferente de empresa B. Os 3 SYSTEM roles são criados no seed com permissões padrão, mas o admin pode ajustá-los.

### 3. Escopo de Conversa separado do Escopo Padrão
**Decisão:** `conversationScope` é um campo separado de `defaultScope`.

*Motivo:* Um Gerente pode ter escopo TEAM para conversas (vê conversas do time) mas escopo COMPANY para contatos (precisa ver todos os contatos para transferir).

### 4. `canReplyConversations` como flag booleana
**Decisão:** Flag separada no Role, não é uma permission.

*Motivo:* "Ver conversa" e "responder conversa" são permissions distintas, mas a flag `canReplyConversations` controla o comportamento do chat em tempo real (habilita/desabilita input). É mais ergonômico ter uma flag booleana no role do que verificar permission toda vez que renderiza o input.

### 5. Manter `adminMiddleware` durante migração
**Decisão:** `adminMiddleware` continua funcionando durante a transição.

*Motivo:* Não quebrar nada. Na Fase 2, `adminMiddleware` é gradualmente substituído por `requirePermission()`. Ao final, pode ser removido.

### 6. SUPER_ADMIN permanece hardcoded
**Decisão:** SUPER_ADMIN é um role sem companyId, bypass total.

*Motivo:* É o operador do sistema (multi-tenant admin), não um usuário de empresa. Não precisa de permissões granulares — tem acesso a tudo por definição.

---

## 🗺️ MAPA DE PERMISSÃO → PÁGINA → SIDEBAR

| Permissão | Página Frontend | Grupo Sidebar | Rota Backend |
|---|---|---|---|
| `conversations:read` | Messages | Gestão CRM | `/api/messages` |
| `contacts:read` | Contacts, Groups | Gestão CRM | `/api/contacts` |
| `teams:read` | Teams | Gestão CRM | `/api/teams` |
| `labels:read` | Labels | Gestão CRM | `/api/labels` |
| `canned_responses:read` | CannedResponses | Gestão CRM | `/api/canned-responses` |
| `custom_attributes:read` | CustomAttributes | Gestão CRM | `/api/custom-attributes` |
| `instances:read` | Instances | Gestão CRM | `/api/instances` |
| `flows:read` | Flows | Automações | `/api/flows` |
| `automations:read` | Automations, ConvAutomations | Automações | `/api/automations` |
| `macros:read` | Macros | Automações | `/api/macros` |
| `campaigns:read` | Campaigns | Automações | `/api/campaigns` |
| `templates:read` | Templates | Automações | `/api/templates` |
| `webhooks:read` | WebhookEvents, Webhooks | Automações | `/api/webhook` |
| `ai:read` | AIAgents, AIProviders, etc. | IA | `/api/ai` |
| `reports:read` | Dashboard | *(root)* | `/api/*` |
| `users:read` | Users | Gestão CRM | `/api/users` |
| `roles:manage` | Roles | Gestão CRM | `/api/roles` |
| `settings:read` | Settings | *(rodapé)* | `/api/companies` |
