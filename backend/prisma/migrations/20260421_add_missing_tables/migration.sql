-- ============================================================
-- Migration: tabelas que existiam no schema mas sem migration
-- tickets, ticket_comments, goals, goal_checkins,
-- working_hours, instance_members, customer_activity_logs,
-- contract_templates, ai_agent_prompt_versions
-- ============================================================

-- ── Enums: Ticket ───────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TicketStatus" AS ENUM ('NOVO','EM_ANDAMENTO','AGUARDANDO','RESOLVIDO','FECHADO','CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TicketPriority" AS ENUM ('BAIXA','MEDIA','ALTA','URGENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TicketCategory" AS ENUM ('BUG','MELHORIA','SUPORTE','INFRAESTRUTURA','FINANCEIRO','COMERCIAL','OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enums: Goal (OKR) ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "GoalStatus" AS ENUM ('NAO_INICIADO','EM_PROGRESSO','CONCLUIDO','CANCELADO','ATRASADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GoalType" AS ENUM ('OBJETIVO','RESULTADO_CHAVE','INICIATIVA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GoalMetricType" AS ENUM ('PERCENTUAL','NUMERICO','MONETARIO','BINARIO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enums: AIAgentPrompt ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "AIAgentPromptField" AS ENUM ('SYSTEM_PROMPT','FOLLOW_UP_PROMPT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIPromptPatchOperation" AS ENUM ('REPLACE','INSERT_BEFORE','INSERT_AFTER','APPEND','REMOVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── instance_members ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "instance_members" (
  "id"         TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instance_members_instanceId_userId_key" UNIQUE ("instanceId", "userId")
);
CREATE INDEX IF NOT EXISTS "instance_members_instanceId_idx" ON "instance_members"("instanceId");
DO $$ BEGIN
  ALTER TABLE "instance_members" ADD CONSTRAINT "instance_members_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "instance_members" ADD CONSTRAINT "instance_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── working_hours ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "working_hours" (
  "id"           TEXT NOT NULL,
  "instanceId"   TEXT NOT NULL,
  "dayOfWeek"    INTEGER NOT NULL,
  "openHour"     INTEGER NOT NULL DEFAULT 9,
  "openMinutes"  INTEGER NOT NULL DEFAULT 0,
  "closeHour"    INTEGER NOT NULL DEFAULT 18,
  "closeMinutes" INTEGER NOT NULL DEFAULT 0,
  "closedAllDay" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "working_hours_instanceId_dayOfWeek_key" UNIQUE ("instanceId", "dayOfWeek")
);
CREATE INDEX IF NOT EXISTS "working_hours_instanceId_idx" ON "working_hours"("instanceId");
DO $$ BEGIN
  ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── tickets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tickets" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "status"         "TicketStatus" NOT NULL DEFAULT 'NOVO',
  "priority"       "TicketPriority" NOT NULL DEFAULT 'MEDIA',
  "category"       "TicketCategory" NOT NULL DEFAULT 'OUTRO',
  "createdById"    TEXT NOT NULL,
  "assigneeId"     TEXT,
  "teamId"         TEXT,
  "conversationId" TEXT,
  "contactId"      TEXT,
  "cardId"         TEXT,
  "dueDate"        TIMESTAMP(3),
  "resolvedAt"     TIMESTAMP(3),
  "closedAt"       TIMESTAMP(3),
  "tags"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tickets_companyId_status_idx" ON "tickets"("companyId", "status");
CREATE INDEX IF NOT EXISTS "tickets_assigneeId_idx" ON "tickets"("assigneeId");
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ticket_comments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ticket_comments" (
  "id"         TEXT NOT NULL,
  "ticketId"   TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_comments_ticketId_idx" ON "ticket_comments"("ticketId");
DO $$ BEGIN ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── goals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "goals" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "parentId"     TEXT,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "type"         "GoalType" NOT NULL DEFAULT 'OBJETIVO',
  "status"       "GoalStatus" NOT NULL DEFAULT 'NAO_INICIADO',
  "ownerId"      TEXT NOT NULL,
  "metricType"   "GoalMetricType" NOT NULL DEFAULT 'PERCENTUAL',
  "targetValue"  DECIMAL(15,2) NOT NULL DEFAULT 100,
  "currentValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "startValue"   DECIMAL(15,2) NOT NULL DEFAULT 0,
  "startDate"    TIMESTAMP(3),
  "endDate"      TIMESTAMP(3),
  "weight"       DECIMAL(5,2) NOT NULL DEFAULT 1,
  "tags"         TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "goals_companyId_status_idx" ON "goals"("companyId", "status");
CREATE INDEX IF NOT EXISTS "goals_companyId_ownerId_idx" ON "goals"("companyId", "ownerId");
CREATE INDEX IF NOT EXISTS "goals_parentId_idx" ON "goals"("parentId");
DO $$ BEGIN ALTER TABLE "goals" ADD CONSTRAINT "goals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "goals" ADD CONSTRAINT "goals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "goals" ADD CONSTRAINT "goals_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── goal_checkins ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "goal_checkins" (
  "id"        TEXT NOT NULL,
  "goalId"    TEXT NOT NULL,
  "value"     DECIMAL(15,2) NOT NULL,
  "note"      TEXT,
  "authorId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goal_checkins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "goal_checkins_goalId_idx" ON "goal_checkins"("goalId");
DO $$ BEGIN ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── customer_activity_logs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_activity_logs" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "customerAccountId" TEXT NOT NULL,
  "contactId"         TEXT,
  "userId"            TEXT,
  "action"            TEXT NOT NULL,
  "entity"            TEXT,
  "entityId"          TEXT,
  "description"       TEXT NOT NULL,
  "oldValue"          TEXT,
  "newValue"          TEXT,
  "metadata"          JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "customer_activity_logs_customerAccountId_createdAt_idx"
  ON "customer_activity_logs"("customerAccountId", "createdAt");
CREATE INDEX IF NOT EXISTS "customer_activity_logs_companyId_createdAt_idx"
  ON "customer_activity_logs"("companyId", "createdAt");
DO $$ BEGIN ALTER TABLE "customer_activity_logs" ADD CONSTRAINT "customer_activity_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "customer_activity_logs" ADD CONSTRAINT "customer_activity_logs_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── contract_templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "description" TEXT,
  "icon"        TEXT DEFAULT '📄',
  "content"     TEXT NOT NULL,
  "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  "createdBy"   TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contract_templates_companyId_idx" ON "contract_templates"("companyId");
DO $$ BEGIN ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ai_agent_prompt_versions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_agent_prompt_versions" (
  "id"                   TEXT NOT NULL,
  "companyId"            TEXT NOT NULL,
  "agentId"              TEXT NOT NULL,
  "field"                "AIAgentPromptField" NOT NULL,
  "instruction"          TEXT NOT NULL,
  "operation"            "AIPromptPatchOperation" NOT NULL,
  "targetStrategy"       TEXT NOT NULL,
  "targetMeta"           JSONB,
  "oldText"              TEXT NOT NULL,
  "newText"              TEXT NOT NULL,
  "resultText"           TEXT NOT NULL,
  "diffJson"             JSONB,
  "confidence"           DOUBLE PRECISION,
  "needsConfirmation"    BOOLEAN NOT NULL DEFAULT false,
  "warnings"             JSONB,
  "restoredFromVersionId" TEXT,
  "createdById"          TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_prompt_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_agent_prompt_versions_companyId_agentId_field_createdAt_idx"
  ON "ai_agent_prompt_versions"("companyId", "agentId", "field", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_agent_prompt_versions_agentId_createdAt_idx"
  ON "ai_agent_prompt_versions"("agentId", "createdAt");
DO $$ BEGIN ALTER TABLE "ai_agent_prompt_versions" ADD CONSTRAINT "ai_agent_prompt_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ai_agent_prompt_versions" ADD CONSTRAINT "ai_agent_prompt_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
