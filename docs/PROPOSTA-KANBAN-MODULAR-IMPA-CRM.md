# PROPOSTA: Kanban/Pipeline Modular — IMPA CRM

> Baseada na análise do Perfex CRM (pipeline/leads/custom fields/hooks), Plane (kanban board/drag-drop/state management) e do estado atual do IMPA CRM.

---

## 1. PRINCÍPIO FUNDAMENTAL

### 1.1 Modelo Mental

```
┌─────────────────────────────────────────────────────────────┐
│                        IMPA CRM                             │
│              (um único sistema, um único código)             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  CORE UNIVERSAL                        │  │
│  │  Contacts, Conversations, Messages, Users,             │  │
│  │  Teams, Roles, Labels, Custom Attributes,              │  │
│  │  Automations, AI Agents, Templates                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              MOTOR KANBAN/PIPELINE                     │  │
│  │  Pipelines, Stages, Cards, Activities,                 │  │
│  │  Tasks, Notes, Attachments, Timeline,                  │  │
│  │  Custom Fields, Drag-and-drop, Automações              │  │
│  └───────────────────────────────────────────────────────┘  │
│                │              │              │               │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────────┐     │
│  │ Módulo      │  │ Módulo   │  │ Módulo             │     │
│  │ Advocacia   │  │ Clínica  │  │ Imobiliário, ...   │     │
│  │ (nativo)    │  │ (nativo) │  │ (nativo)           │     │
│  │             │  │          │  │                    │     │
│  │ +campos     │  │ +campos  │  │ +campos            │     │
│  │ +ações      │  │ +ações   │  │ +ações             │     │
│  │ +menus      │  │ +menus   │  │ +menus             │     │
│  │ +telas      │  │ +telas   │  │ +telas             │     │
│  │ +auto       │  │ +auto    │  │ +auto              │     │
│  └─────────────┘  └──────────┘  └────────────────────┘     │
│                                                             │
│  ⚠ Todos os módulos existem no código-fonte.                │
│  ⚠ O superadmin ativa/desativa por empresa.                 │
│  ⚠ NENHUM módulo é instalado, importado ou externo.         │
└─────────────────────────────────────────────────────────────┘
```

**O kanban pertence ao CORE. O módulo apenas o enriquece.**

### 1.2 Regras Obrigatórias

1. **Módulos NÃO são plugins** — são funcionalidades nativas do IMPA CRM, implementadas no código-fonte.
2. **Nenhum cliente instala módulo manualmente** — o código já está no sistema.
3. **Nenhum módulo é carregado de fonte externa** — tudo faz parte do build.
4. **O superadmin ativa/desativa módulos por empresa** — via painel admin.
5. **Uma empresa só vê menus, campos, ações, telas e automações de módulos ativos para ela.**
6. **O sistema verifica os módulos ativos da empresa logada** e renderiza apenas o que está liberado.
7. **Módulos estendem o CORE** — não duplicam, não substituem.

### 1.3 Regras Adicionais de Arquitetura

8. **O `MODULE_REGISTRY` é a fonte de verdade** — a tabela `crm_modules` é apenas o registro persistido para FK, painel admin e ativação por empresa.
9. **Não usar `stageName` para validações** — usar `stageSlug` em templates de pipeline e `stageId` em pipelines persistidos. Stages possuem slug único dentro do pipeline.
10. **O backend valida coerência** entre company, pipeline, stage e card em toda operação. Nenhuma operação aceita IDs de outra empresa/pipeline.
11. **Nem tudo é `customField`** — campos simples podem ser dinâmicos via JSON, mas módulos complexos podem ter rotas, telas, handlers e entidades próprias implementadas no código.
12. **O frontend usa um registry interno de componentes conhecidos** — sem aceitar componentes arbitrários vindos do backend. O card tab "processo" mapeia para `<ProcessoTab />`, não para um componente dinâmico.
13. **Permissões explícitas para ações do kanban** — `pipelines:read`, `pipelines:manage`, `cards:read`, `cards:write`, `cards:delete`, `cards:move`. Módulos podem definir permissões extras.
14. **O card é a porta de entrada do módulo, mas não carrega toda a complexidade do nicho em `customFields`** — módulos complexos estendem com entidades/telas próprias referenciando o card via FK.

---

## 2. ARQUITETURA DO BANCO DE DADOS

### 2.1 Novas Tabelas — Motor Kanban/Pipeline

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Pipeline   │──1:N─│    Stage     │      │     Card     │
│              │      │              │──1:N──│              │
│ id           │      │ id           │      │ id           │
│ companyId    │      │ pipelineId   │      │ stageId      │
│ name         │      │ name         │      │ pipelineId   │
│ description  │      │ color        │      │ companyId    │
│ type         │      │ position     │      │ contactId    │
│ isDefault    │      │ isWon        │      │ title        │
│ isActive     │      │ isLost       │      │ value        │
│ color        │      │ rottingDays  │      │ assigneeId   │
│ position     │      │ companyId    │      │ teamId       │
│ metadata     │      │              │      │ position     │
│              │      └──────────────┘      │ priority     │
└──────────────┘                            │ status       │
                                            │ expectedClose│
                                            │ wonAt/lostAt │
                                            │ lostReason   │
                                            │ customFields │
                                            │ source       │
                                            │ metadata     │
                                            └──────────────┘
                                                   │
                              ┌─────────────┬──────┴───────┬──────────────┐
                              │             │              │              │
                        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
                        │CardActivity│ │ CardTask  │ │ CardNote  │ │ CardFile  │
                        │           │ │           │ │           │ │           │
                        │ id        │ │ id        │ │ id        │ │ id        │
                        │ cardId    │ │ cardId    │ │ cardId    │ │ cardId    │
                        │ type      │ │ title     │ │ content   │ │ fileName  │
                        │ content   │ │ dueDate   │ │ createdBy │ │ fileUrl   │
                        │ actorId   │ │ assigneeId│ │ isPrivate │ │ uploadedBy│
                        │ actorType │ │ completed │ │           │ │           │
                        │ metadata  │ │ priority  │ └───────────┘ └───────────┘
                        └───────────┘ │ checklist │
                                      └───────────┘
```

### 2.2 Novas Tabelas — Sistema de Módulos (Nativos)

Como os módulos são **nativos do código-fonte** (não plugins), o banco precisa apenas de:\n- Um **registro** de quais módulos existem (`crm_modules`) — populado via seed, nunca via API.\n- Uma **tabela de ativação por empresa** (`company_modules`) — controlada pelo superadmin.

A definição de campos, menus, ações, validações, pipelines template, etc. de cada módulo fica **no código TypeScript** do módulo, NÃO no banco.

```
┌───────────────────┐\n│    CrmModule      │  ← Registro dos módulos (seed, read-only)\n│                   │\n│ id                │\n│ slug (unique)     │  ← \"advocacia\", \"clinica-estetica\"\n│ name              │  ← \"Advocacia\"\n│ description       │\n│ icon              │  ← nome do ícone lucide\n│ category          │  ← \"juridico\", \"saude\", \"vendas\"\n└───────────────────┘\n         │\n         │ 1:N\n         │\n┌────────┴──────────┐\n│ CompanyModule     │  ← Qual empresa ativou qual módulo\n│                   │\n│ id                │\n│ companyId         │\n│ moduleId          │\n│ isActive          │\n│ config (JSON)     │  ← Configurações específicas da empresa\n│ activatedAt       │\n│ activatedBy       │  ← superadmin que ativou\n└───────────────────┘\n```\n\n**NÃO existe tabela de extensões.** Cada módulo define suas extensões (campos, menus, ações, etc.) diretamente no código TypeScript:  `src/modules/crm-modules/<slug>/definition.ts`

### 2.3 Schema Prisma Detalhado

```prisma
// ══════════════════════════════════════════════
// ─── PIPELINE / KANBAN ───────────────────────
// ══════════════════════════════════════════════

enum CardStatus {
  OPEN
  WON
  LOST
  ARCHIVED
}

enum CardPriority {
  NONE
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum ActivityType {
  STAGE_CHANGED
  ASSIGNED
  NOTE_ADDED
  TASK_COMPLETED
  FILE_UPLOADED
  VALUE_CHANGED
  FIELD_CHANGED
  CONTACT_LINKED
  EMAIL_SENT
  CALL_LOGGED
  CUSTOM
}

model Pipeline {
  id          String   @id @default(uuid())
  companyId   String
  name        String
  description String?
  type        String   @default("sales")    // sales, support, onboarding, custom
  isDefault   Boolean  @default(false)
  isActive    Boolean  @default(true)
  color       String?
  position    Int      @default(0)
  metadata    Json?                          // extensível por módulos
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company  Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  stages   Stage[]
  cards    Card[]

  @@index([companyId, isActive])
  @@map("pipelines")
}

model Stage {
  id          String   @id @default(uuid())
  pipelineId  String
  companyId   String
  name        String
  slug        String                        // slug único dentro do pipeline (ex: "audiencia")
  color       String   @default("#6366f1")
  position    Int      @default(0)
  isWon       Boolean  @default(false)      // etapa de ganho
  isLost      Boolean  @default(false)      // etapa de perda
  rottingDays Int?                           // dias até card "apodrecer" (alerta)
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  pipeline Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  company  Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  cards    Card[]

  @@unique([pipelineId, slug])
  @@index([pipelineId, position])
  @@map("pipeline_stages")
}

model Card {
  id             String       @id @default(uuid())
  pipelineId     String
  stageId        String
  companyId      String
  contactId      String?                    // vínculo com contato do CRM
  conversationId String?                    // vínculo com conversa do CRM
  title          String
  description    String?
  value          Decimal?     @db.Decimal(15, 2)
  currency       String       @default("BRL")
  assigneeId     String?                    // responsável
  teamId         String?
  position       Int          @default(0)   // ordem no kanban
  priority       CardPriority @default(NONE)
  status         CardStatus   @default(OPEN)
  source         String?                    // de onde veio (web form, import, manual, whatsapp)
  expectedCloseDate DateTime?
  wonAt          DateTime?
  lostAt         DateTime?
  lostReason     String?
  customFields   Json?                      // campos flexíveis {key: value}
  metadata       Json?                      // dados extras de módulos
  createdBy      String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  pipeline    Pipeline      @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  stage       Stage         @relation(fields: [stageId], references: [id])
  company     Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)
  contact     Contact?      @relation(fields: [contactId], references: [id], onDelete: SetNull)
  conversation Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  assignee    User?         @relation("CardAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  team        Team?         @relation(fields: [teamId], references: [id], onDelete: SetNull)

  activities  CardActivity[]
  tasks       CardTask[]
  notes       CardNote[]
  files       CardFile[]
  tags        CardTag[]

  @@index([pipelineId, stageId, position])
  @@index([companyId, status])
  @@index([contactId])
  @@index([assigneeId])
  @@map("pipeline_cards")
}

model CardActivity {
  id        String       @id @default(uuid())
  cardId    String
  type      ActivityType
  content   String?                        // descrição legível
  actorId   String?                        // user ou system
  actorType String       @default("user")  // user, system, ai, automation
  actorName String?
  oldValue  String?                        // valor anterior (para diffs)
  newValue  String?                        // valor novo
  metadata  Json?
  createdAt DateTime     @default(now())

  card Card @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([cardId, createdAt])
  @@map("pipeline_card_activities")
}

model CardTask {
  id          String    @id @default(uuid())
  cardId      String
  title       String
  description String?
  assigneeId  String?
  dueDate     DateTime?
  priority    CardPriority @default(NONE)
  isCompleted Boolean   @default(false)
  completedAt DateTime?
  completedBy String?
  position    Int       @default(0)
  checklist   Json?                        // [{text, checked}]
  createdBy   String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  card     Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  assignee User? @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)

  @@index([cardId, isCompleted])
  @@map("pipeline_card_tasks")
}

model CardNote {
  id        String   @id @default(uuid())
  cardId    String
  content   String
  isPrivate Boolean  @default(false)       // só visível para o autor
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  card    Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  author  User? @relation("NoteAuthor", fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([cardId, createdAt])
  @@map("pipeline_card_notes")
}

model CardFile {
  id         String   @id @default(uuid())
  cardId     String
  fileName   String
  fileUrl    String
  fileSize   Int?
  mimeType   String?
  uploadedBy String?
  createdAt  DateTime @default(now())

  card    Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  uploader User? @relation("FileUploader", fields: [uploadedBy], references: [id], onDelete: SetNull)

  @@index([cardId])
  @@map("pipeline_card_files")
}

model CardTag {
  id     String @id @default(uuid())
  cardId String
  labelId String                            // reutiliza o Label existente do CRM

  card  Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  label Label @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@unique([cardId, labelId])
  @@map("pipeline_card_tags")
}

// ══════════════════════════════════════════════
// ─── SISTEMA DE MÓDULOS ──────────────────────
// ══════════════════════════════════════════════

model CrmModule {
  id          String   @id @default(uuid())
  slug        String   @unique              // "advocacia", "clinica-estetica", "imobiliario"
  name        String                        // "Advocacia", "Clínica Estética"
  description String?
  icon        String?                       // lucide icon name
  category    String?                       // "juridico", "saude", "vendas"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  companyModules  CompanyModule[]

  @@map("crm_modules")
}

// Ativação de módulo por empresa (controlada pelo superadmin)
model CompanyModule {
  id          String   @id @default(uuid())
  companyId   String
  moduleId    String
  isActive    Boolean  @default(true)
  config      Json?                         // configurações específicas da empresa
  activatedAt DateTime @default(now())
  activatedBy String?                       // superadmin que ativou

  company Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  module  CrmModule @relation(fields: [moduleId], references: [id], onDelete: Cascade)

  @@unique([companyId, moduleId])
  @@map("company_modules")
}
```

---

## 3. DEFINIÇÃO DE MÓDULO NO CÓDIGO

Cada módulo é definido **no código TypeScript**, não no banco. A tabela `crm_modules` é apenas um registro para FK. A lógica real está em:

```
backend/src/modules/crm-modules/
  ├─ registry.ts                    ← registro central de todos os módulos
  ├─ types.ts                       ← interfaces TypeScript
  ├─ advocacia/
  │    ├─ definition.ts             ← campos, menus, ações, validações, templates
  │    ├─ routes.ts                 ← rotas específicas do módulo (opcional)
  │    └─ handlers.ts               ← handlers de ações (opcional)
  ├─ clinica-estetica/
  │    ├─ definition.ts
  │    └─ routes.ts
  └─ imobiliario/
       └─ definition.ts
```

### 3.1 Interface de Definição de Módulo

```typescript
// backend/src/modules/crm-modules/types.ts

interface ModuleDefinition {
  slug: string
  name: string
  description: string
  icon: string          // lucide icon name
  category: string

  // Campos extras que o módulo adiciona ao card e/ou contato
  customFields?: {
    target: 'card' | 'contact'
    key: string
    label: string
    type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'url' | 'currency'
    options?: string[]
    required?: boolean
    group?: string       // agrupamento visual
  }[]

  // Templates de pipeline prontos para o nicho
  pipelineTemplates?: {
    name: string
    type: string
    stages: { name: string; slug: string; color: string; position: number; isWon?: boolean; isLost?: boolean }[]
  }[]

  // Ações rápidas no card
  cardActions?: {
    key: string
    label: string
    icon: string
    confirmText?: string
  }[]

  // Validações ao mover card entre stages (usa stageSlug do template, resolvido para stageId em runtime)
  stageValidations?: {
    stageSlug: string
    rules: { field: string; operator: 'not_empty' | 'equals' | 'min' | 'max'; value?: any; message: string }[]
  }[]

  // Menus extras na sidebar
  sidebarMenus?: {
    label: string
    icon: string
    path: string
    position: number
    section: 'modules'
  }[]

  // Abas extras no detalhe do card
  cardTabs?: {
    key: string
    label: string
    icon: string
    position: number
  }[]

  // Widgets extras no dashboard
  dashboardWidgets?: {
    key: string
    label: string
    size: 'sm' | 'md' | 'lg'
    position: number
  }[]
}
```

### 3.2 Exemplo: Definição do Módulo Advocacia

```typescript
// backend/src/modules/crm-modules/advocacia/definition.ts
import { ModuleDefinition } from '../types'

export const advocaciaModule: ModuleDefinition = {
  slug: 'advocacia',
  name: 'Advocacia',
  description: 'Módulo para escritórios de advocacia e departamentos jurídicos',
  icon: 'Scale',
  category: 'juridico',

  customFields: [
    { target: 'card', key: 'numero_processo', label: 'Nº do Processo', type: 'text', group: 'Jurídico' },
    { target: 'card', key: 'tipo_acao', label: 'Tipo de Ação', type: 'select', options: ['Cível', 'Trabalhista', 'Criminal', 'Família', 'Tributário', 'Previdenciário'], group: 'Jurídico' },
    { target: 'card', key: 'vara_tribunal', label: 'Vara/Tribunal', type: 'text', group: 'Jurídico' },
    { target: 'card', key: 'data_audiencia', label: 'Data da Audiência', type: 'date', group: 'Jurídico' },
    { target: 'card', key: 'fase_processual', label: 'Fase Processual', type: 'select', options: ['Conhecimento', 'Execução', 'Recurso', 'Cumprimento de Sentença'], group: 'Jurídico' },
    { target: 'card', key: 'honorarios', label: 'Honorários', type: 'currency', group: 'Financeiro' },
    { target: 'contact', key: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'text' },
    { target: 'contact', key: 'oab', label: 'OAB', type: 'text' },
  ],

  pipelineTemplates: [{
    name: 'Processo Jurídico',
    type: 'legal',
    stages: [
      { name: 'Consulta Inicial', slug: 'consulta-inicial', color: '#6366f1', position: 0 },
      { name: 'Análise Documental', slug: 'analise-documental', color: '#8b5cf6', position: 1 },
      { name: 'Petição Inicial', slug: 'peticao-inicial', color: '#a855f7', position: 2 },
      { name: 'Citação/Intimação', slug: 'citacao-intimacao', color: '#d946ef', position: 3 },
      { name: 'Audiência', slug: 'audiencia', color: '#f59e0b', position: 4 },
      { name: 'Sentença', slug: 'sentenca', color: '#22c55e', position: 5, isWon: true },
      { name: 'Arquivado/Perdido', slug: 'arquivado-perdido', color: '#ef4444', position: 6, isLost: true },
    ]
  }],

  stageValidations: [{
    stageSlug: 'audiencia',
    rules: [
      { field: 'numero_processo', operator: 'not_empty', message: 'Informe o nº do processo antes de mover para Audiência' },
      { field: 'data_audiencia', operator: 'not_empty', message: 'Defina a data da audiência' },
    ]
  }],

  cardActions: [
    { key: 'log_hearing', label: 'Registrar Audiência', icon: 'Calendar' },
    { key: 'generate_petition', label: 'Gerar Petição', icon: 'FileText' },
  ],

  sidebarMenus: [
    { label: 'Processos', icon: 'Scale', path: '/processos', position: 50, section: 'modules' },
    { label: 'Audiências', icon: 'Calendar', path: '/audiencias', position: 51, section: 'modules' },
  ],

  cardTabs: [
    { key: 'processo', label: 'Processo', icon: 'Scale', position: 10 },
    { key: 'audiencias', label: 'Audiências', icon: 'Calendar', position: 11 },
  ],
}
```

### 3.3 Registro Central de Módulos

```typescript
// backend/src/modules/crm-modules/registry.ts
import { advocaciaModule } from './advocacia/definition'
// import { clinicaEsteticaModule } from './clinica-estetica/definition'
// import { imobiliarioModule } from './imobiliario/definition'

import { ModuleDefinition } from './types'

// Todos os módulos nativos do IMPA CRM
// Para adicionar um módulo novo: implementar definition.ts e registrar aqui
export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  'advocacia': advocaciaModule,
  // 'clinica-estetica': clinicaEsteticaModule,
  // 'imobiliario': imobiliarioModule,
}

export function getModuleDefinition(slug: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[slug]
}

export function getAllModuleDefinitions(): ModuleDefinition[] {
  return Object.values(MODULE_REGISTRY)
}
```

### 3.4 O que cada módulo pode adicionar

| Recurso | Onde é definido | O que faz |
|---------|-----------------|-----------|
| `customFields` | `definition.ts` | Campos extras no card/contato (renderizados dinamicamente) |
| `pipelineTemplates` | `definition.ts` | Templates de pipeline prontos para criar com 1 clique |
| `cardActions` | `definition.ts` | Botões de ação rápida no card |
| `stageValidations` | `definition.ts` | Regras ao mover card de etapa (ex: campo obrigatório) |
| `sidebarMenus` | `definition.ts` | Menus extras na sidebar |
| `cardTabs` | `definition.ts` | Abas extras no detalhe do card |
| `dashboardWidgets` | `definition.ts` | Widgets extras no dashboard |
| `routes.ts` (opcional) | Arquivo separado | Rotas REST específicas do módulo (ex: /api/advocacia/audiencias) |
| `handlers.ts` (opcional) | Arquivo separado | Handlers para card_actions (ex: log_hearing) |

---

## 4. COMO O SISTEMA VERIFICA MÓDULOS ATIVOS

### 4.1 Fluxo Backend

```
1. Request chega → authMiddleware identifica companyId
2. GET /api/modules/active → busca company_modules WHERE companyId AND isActive
3. Para cada módulo ativo, busca a definição no MODULE_REGISTRY (código)
4. Retorna slug + definição completa (campos, menus, ações, etc.)
```

```typescript
// Endpoint: GET /api/modules/active
async function getActiveModules(companyId: string) {
  // 1. Busca quais módulos estão ativos para esta empresa
  const companyModules = await prisma.companyModule.findMany({
    where: { companyId, isActive: true },
    include: { module: true }
  })

  // 2. Para cada módulo ativo, pega a definição do código
  return companyModules.map(cm => {
    const definition = getModuleDefinition(cm.module.slug)
    return {
      slug: cm.module.slug,
      name: cm.module.name,
      icon: cm.module.icon,
      config: cm.config,
      ...definition  // campos, menus, ações, validações, etc.
    }
  }).filter(Boolean)
}
```

### 4.2 Fluxo Frontend

```
1. App carrega → GET /api/modules/active
2. Store global recebe módulos ativos com suas definições completas
3. Sidebar renderiza menus base + menus dos módulos ativos
4. Pipeline/Kanban renderiza campos base + campos dos módulos ativos
5. Card detail renderiza abas base + abas dos módulos ativos
6. Automações listam triggers/ações base + dos módulos ativos
7. Dashboard mostra widgets base + widgets dos módulos ativos
```

### 4.3 Componente Registry (Frontend)

```typescript
// stores/modules.store.ts
interface ModuleStore {
  activeModules: ModuleDefinition[]
  
  // Helpers
  getCustomFields(target: 'card' | 'contact'): CustomFieldDef[]
  getCardActions(): CardAction[]
  getStageValidations(stageName: string): StageValidation[]
  getSidebarMenus(): SidebarMenu[]
  getCardTabs(): CardTab[]
  getDashboardWidgets(): DashboardWidget[]
  getPipelineTemplates(): PipelineTemplate[]
  isModuleActive(slug: string): boolean
}
```

### 4.4 Painel Admin (Superadmin)

O superadmin terá uma tela `Módulos` no painel admin onde pode:
- Ver todos os módulos disponíveis no sistema (vindos do `MODULE_REGISTRY`)
- Ativar/desativar módulo por empresa
- Configurar parâmetros específicos por empresa (JSON `config`)

```
GET    /api/admin/modules                   Lista todos os módulos do registry
POST   /api/admin/modules/:slug/activate    Ativa módulo para uma empresa (body: {companyId})
POST   /api/admin/modules/:slug/deactivate  Desativa módulo para uma empresa (body: {companyId})
GET    /api/admin/companies/:id/modules     Lista módulos ativos de uma empresa
```

---

## 5. BACKEND — HOOKS E EVENTOS

Inspirado no Perfex CRM, o motor de kanban emite eventos em que módulos podem reagir:

```typescript
// events/pipeline.events.ts
interface PipelineEvents {
  'card.created':        { card, pipeline, stage, user }
  'card.updated':        { card, changes, user }
  'card.stage_changed':  { card, oldStage, newStage, user }
  'card.assigned':       { card, oldAssignee, newAssignee, user }
  'card.won':            { card, pipeline, user }
  'card.lost':           { card, pipeline, reason, user }
  'card.value_changed':  { card, oldValue, newValue, user }
  'card.deleted':        { card, user }
  'card.note_added':     { card, note, user }
  'card.task_completed': { card, task, user }
  'card.file_uploaded':  { card, file, user }
  'stage.card_entering': { card, stage } // pode ser barrado por validação
  'pipeline.created':    { pipeline, user }
  'pipeline.deleted':    { pipeline, user }
}
```

O sistema de `ConversationAutomation` existente pode ser expandido para suportar esses eventos.

---

## 6. EXPERIÊNCIA DO USUÁRIO (Advocacia ativo)

> Exemplo completo da definição está na seção 3.2.

1. **Sidebar** mostra seção "Módulos" com "Processos" e "Audiências"
2. **Pipeline** tem template "Processo Jurídico" disponível para criar
3. **Card** no kanban mostra campos extras: Nº Processo, Tipo de Ação, Vara/Tribunal, Data Audiência, Fase Processual, Honorários
4. **Drag-and-drop** para etapa "Audiência" valida se o nº do processo e data foram preenchidos
5. **Menu de ações** no card mostra "Registrar Audiência" e "Gerar Petição"
6. **Contato** mostra campos CPF/CNPJ e OAB
7. **Card detail** tem abas extras "Processo" e "Audiências"

---

## 7. SEPARAÇÃO CLARA

### CORE (sempre presente)
- Contacts (já existe)
- Conversations (já existe)
- Messages (já existe)
- Users + RBAC (já existe)
- Teams (já existe)
- Labels (já existe)
- AI Agents (já existe)
- Templates (já existe)
- Custom Attributes (já existe)
- Automations (já existe)

### KANBAN/PIPELINE (novo, sempre presente)
- Pipelines (CRUD, templates)
- Stages (CRUD, posicionamento, cores)
- Cards (CRUD, drag-and-drop, filtros)
- Card Activities (timeline automática)
- Card Tasks (checklist, atribuição)
- Card Notes (observações)
- Card Files (anexos)
- Card Tags (usando Labels existentes)
- Métricas (tempo por etapa, taxa de conversão, valor total)

### MÓDULOS (ativados por empresa)
- Campos extras
- Pipelines pré-configurados
- Validações de etapa
- Ações rápidas
- Menus extras
- Widgets de dashboard
- Automações específicas
- Relatórios específicos

---

## 8. COMPONENTES FRONTEND (Kanban Board)

### Inspiração do Plane:

```
PipelineView (página)
  ├─ PipelineHeader (nome, filtros, agrupamento)
  ├─ PipelineToolbar (busca, filtros rápidos, ordenação)
  └─ KanbanBoard
       ├─ KanbanColumn (por stage)
       │    ├─ ColumnHeader (nome, cor, count, total valor)
       │    └─ CardList (scroll virtual)
       │         └─ CardBlock (draggable)
       │              ├─ CardTitle
       │              ├─ CardContact (nome, avatar)
       │              ├─ CardValue ($)
       │              ├─ CardAssignee (avatar)
       │              ├─ CardPriority (badge)
       │              ├─ CardTags (labels)
       │              ├─ CardDueDate
       │              ├─ CardModuleFields (campos dinâmicos dos módulos)
       │              └─ CardQuickActions (botões dos módulos)
       └─ LostColumn (zona de "perdido", drop target)

CardDetailPanel (slide-over lateral)
  ├─ CardHeader (título, status, pipeline)
  ├─ CardSidebar (assignee, team, prioridade, valor, datas)
  ├─ CardTabs
  │    ├─ Timeline (atividades automáticas)
  │    ├─ Tasks (tarefas + checklist)
  │    ├─ Notes (observações)
  │    ├─ Files (anexos)
  │    ├─ Conversation (link para conversa WhatsApp)
  │    ├─ Contact (dados do contato)
  │    └─ [Abas dos Módulos Ativos]  ← dinâmico
  └─ CardCustomFields
       ├─ Campos base (value, source, expectedClose)
       └─ [Campos dos Módulos Ativos]  ← dinâmico
```

### Drag-and-Drop:
- Usar `@dnd-kit/core` (React, mais mantido que pragmatic-dnd)
- Sortable dentro da mesma coluna
- Movável entre colunas
- Validação antes do drop (stage_validation do módulo)
- Animação suave com transition

---

## 9. ENDPOINTS DA API

### Pipeline
```
GET    /api/pipelines                    Lista pipelines da empresa
POST   /api/pipelines                    Cria pipeline
GET    /api/pipelines/:id                Detalhe com stages
PUT    /api/pipelines/:id                Atualiza pipeline
DELETE /api/pipelines/:id                Deleta pipeline
POST   /api/pipelines/from-template      Cria pipeline a partir de template

PUT    /api/pipelines/:id/stages/reorder  Reordena stages
POST   /api/pipelines/:id/stages          Cria stage
PUT    /api/pipelines/:id/stages/:sid     Atualiza stage
DELETE /api/pipelines/:id/stages/:sid     Deleta stage
```

### Cards
```
GET    /api/pipelines/:id/cards           Lista cards (com filtros, paginação)
POST   /api/pipelines/:id/cards           Cria card
GET    /api/cards/:id                     Detalhe completo do card
PUT    /api/cards/:id                     Atualiza card
DELETE /api/cards/:id                     Deleta card
PUT    /api/cards/:id/move                Move card (stage + position) ← drag-and-drop
PUT    /api/cards/:id/won                 Marca como ganho
PUT    /api/cards/:id/lost                Marca como perdido

GET    /api/cards/:id/activities          Timeline do card
POST   /api/cards/:id/notes              Adiciona nota
POST   /api/cards/:id/tasks              Adiciona tarefa
PUT    /api/cards/:id/tasks/:tid          Atualiza tarefa
POST   /api/cards/:id/files              Upload de arquivo
POST   /api/cards/:id/tags               Adiciona tag
DELETE /api/cards/:id/tags/:labelId       Remove tag
```

### Módulos (para usuário logado)
```
GET    /api/modules/active                Módulos ativos da empresa (com definições completas do registry)
GET    /api/modules/:slug/templates       Templates de pipeline do módulo
```

### Módulos Admin (superadmin)
```
GET    /api/admin/modules                   Lista todos do MODULE_REGISTRY
POST   /api/admin/modules/:slug/activate    Ativa para empresa (body: {companyId})
POST   /api/admin/modules/:slug/deactivate  Desativa para empresa (body: {companyId})
GET    /api/admin/companies/:id/modules     Módulos ativos de uma empresa
PUT    /api/admin/companies/:id/modules/:slug/config  Configura módulo por empresa
```

### Métricas
```
GET    /api/pipelines/:id/metrics          Métricas do pipeline
  → total de cards, valor total, taxa de conversão, tempo médio por stage
```

---

## 10. ORDEM DE DESENVOLVIMENTO

### Fase 1 — Motor Kanban Base (prioridade máxima)
1. **Schema Prisma**: Pipeline, Stage, Card, CardActivity, CardTask, CardNote, CardFile, CardTag
2. **Migração + seeds** (pipeline padrão "Comercial" com stages: Novo Lead → Qualificação → Proposta → Negociação → Fechamento → Ganho/Perdido)
3. **Backend CRUD**: rotas Pipeline, Stage, Card (com move, won, lost)
4. **Backend Activities**: log automático em toda ação no card
5. **Frontend KanbanBoard**: drag-and-drop funcional com colunas e cards
6. **Frontend CardDetail**: painel lateral com timeline, tarefas, notas, arquivos
7. **Frontend PipelineManager**: tela para gerenciar pipelines e stages

### Fase 2 — Integração com CRM Existente
1. **Link Card ↔ Contact**: vincular card a contato existente
2. **Link Card ↔ Conversation**: vincular card a conversa WhatsApp
3. **Criação automática de card**: quando contato entra (via automação)
4. **Sidebar menu**: Pipeline no menu lateral
5. **Dashboard widgets**: métricas de pipeline no dashboard

### Fase 3 — Sistema de Módulos Nativos
1. **Schema Prisma**: CrmModule, CompanyModule (apenas 2 tabelas)
2. **Seed**: popular `crm_modules` com todos os módulos do `MODULE_REGISTRY`
3. **Backend**: estrutura `src/modules/crm-modules/` com `types.ts`, `registry.ts`
4. **Backend**: API `/api/modules/active` (retorna definições do código para módulos ativados)
5. **Backend Admin**: endpoints de ativação/desativação por empresa
6. **Frontend Store**: `ModuleStore` com helpers (`getCustomFields`, `getSidebarMenus`, etc.)
7. **Frontend Renderer**: componentes dinâmicos que leem definições e renderizam campos/menus/ações
8. **Definição do módulo "Comercial"** (built-in base com campos: valor, fonte, expectativa de fechamento)

### Fase 4 — Primeiro Módulo de Nicho (Advocacia)
1. **Definição em código**: `src/modules/crm-modules/advocacia/definition.ts`
2. **Registrar no `MODULE_REGISTRY`** e adicionar seed em `crm_modules`
3. **Tela de ativação** no painel admin (superadmin)
4. **Campos dinâmicos** renderizando no card
5. **Validações** funcionando no drag-and-drop (bloqueia movimentação sem dados obrigatórios)
6. **Menu lateral** mostrando itens do módulo (Processos, Audiências)
7. **Abas extras** no card detail (Processo, Audiências)

### Fase 5 — Módulos Adicionais
1. Clínica de Estética
2. Imobiliário
3. Educação
4. Financeiro / Cobrança
5. E-commerce

---

## 11. DECISÕES TÉCNICAS

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| **Custom fields no card** | JSON (`customFields`) | Flexibilidade máxima sem alterar schema por módulo (padrão Perfex) |
| **Definição de módulos** | TypeScript no código (`definition.ts`) | Type-safe, autocompletar no editor, sem overhead de runtime |
| **Ativação de módulos** | Tabela `company_modules` controlada por superadmin | Simples, auditável, sem conceito de "plugins" |
| **Pipeline templates** | Definidos no `definition.ts` de cada módulo | Versionado com o código, sem tabela extra |
| **Drag-and-drop** | `@dnd-kit/core` | React-native, bem mantido, suporte a virtualização |
| **Timeline** | `CardActivity` automático | Toda ação gera log (padrão Perfex `tbllead_activity_log`) |
| **Tags em cards** | Reutiliza `Label` do CRM | Não duplica entidade, consistência de cores/nomes |
| **Virtualização** | `RenderIfVisible` (padrão Plane) | Essencial para boards com 100+ cards |
| **Métricas do pipeline** | Calculadas on-demand | Evita materialized views, pipeline tem volume controlado |
| **Registro central** | `MODULE_REGISTRY` (objeto TypeScript) | Sem reflection, sem dynamic imports, fácil de debugar |
