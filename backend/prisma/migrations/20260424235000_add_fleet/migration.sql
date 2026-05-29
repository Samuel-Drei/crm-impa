-- IMPA FLEET — Time de funcionários AI internos
-- Migration: 20260424235000_add_fleet

-- ── Enums ──
CREATE TYPE "FleetMemberStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "FleetMissionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "FleetMissionExecutionMode" AS ENUM ('AUTONOMOUS', 'REQUIRE_APPROVAL');
CREATE TYPE "FleetOperationStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "FleetOperationTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'CHAT');
CREATE TYPE "FleetMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- ── AuditLog: actorType + actorId ──
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorType" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorId" TEXT;

-- ── fleet_departments ──
CREATE TABLE "fleet_departments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "color" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_departments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_departments_companyId_order_idx" ON "fleet_departments"("companyId", "order");
ALTER TABLE "fleet_departments" ADD CONSTRAINT "fleet_departments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── fleet_members ──
-- Cérebro 100% próprio (provider/model/prompt/tools) — NÃO depende de AIAgent
CREATE TABLE "fleet_members" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "displayRole" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "emoji" TEXT,
  "colorTag" TEXT,
  "providerId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "maxTokens" INTEGER NOT NULL DEFAULT 2000,
  "topP" DOUBLE PRECISION,
  "toolsConfig" JSONB NOT NULL DEFAULT '{}',
  "assignedRoleId" TEXT,
  "status" "FleetMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "allowAutonomousActions" BOOLEAN NOT NULL DEFAULT true,
  "notificationUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "totalChats" INTEGER NOT NULL DEFAULT 0,
  "totalMissions" INTEGER NOT NULL DEFAULT 0,
  "totalOperations" INTEGER NOT NULL DEFAULT 0,
  "totalTokensUsed" BIGINT NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_members_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_members_companyId_status_idx" ON "fleet_members"("companyId", "status");
CREATE INDEX "fleet_members_departmentId_idx" ON "fleet_members"("departmentId");
CREATE INDEX "fleet_members_providerId_idx" ON "fleet_members"("providerId");
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "fleet_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_assignedRoleId_fkey"
  FOREIGN KEY ("assignedRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── fleet_missions ──
CREATE TABLE "fleet_missions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "instruction" TEXT NOT NULL,
  "cronExpr" TEXT,
  "cronTimezone" TEXT DEFAULT 'America/Sao_Paulo',
  "cronNlOriginal" TEXT,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "runOnceAt" TIMESTAMP(3),
  "status" "FleetMissionStatus" NOT NULL DEFAULT 'ACTIVE',
  "executionMode" "FleetMissionExecutionMode" NOT NULL DEFAULT 'AUTONOMOUS',
  "maxRuns" INTEGER,
  "totalRuns" INTEGER NOT NULL DEFAULT 0,
  "successRuns" INTEGER NOT NULL DEFAULT 0,
  "failedRuns" INTEGER NOT NULL DEFAULT 0,
  "notifyOnSuccess" BOOLEAN NOT NULL DEFAULT false,
  "notifyOnFailure" BOOLEAN NOT NULL DEFAULT true,
  "notifyUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_missions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_missions_companyId_status_idx" ON "fleet_missions"("companyId", "status");
CREATE INDEX "fleet_missions_nextRunAt_status_idx" ON "fleet_missions"("nextRunAt", "status");
ALTER TABLE "fleet_missions" ADD CONSTRAINT "fleet_missions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_missions" ADD CONSTRAINT "fleet_missions_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "fleet_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_missions" ADD CONSTRAINT "fleet_missions_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── fleet_chats ──
CREATE TABLE "fleet_chats" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "totalMessages" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" BIGINT NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_chats_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_chats_companyId_userId_updatedAt_idx" ON "fleet_chats"("companyId", "userId", "updatedAt");
CREATE INDEX "fleet_chats_memberId_idx" ON "fleet_chats"("memberId");
ALTER TABLE "fleet_chats" ADD CONSTRAINT "fleet_chats_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_chats" ADD CONSTRAINT "fleet_chats_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "fleet_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_chats" ADD CONSTRAINT "fleet_chats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── fleet_messages ──
CREATE TABLE "fleet_messages" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "role" "FleetMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "toolName" TEXT,
  "toolInput" JSONB,
  "toolOutput" JSONB,
  "toolSuccess" BOOLEAN,
  "tokensInput" INTEGER NOT NULL DEFAULT 0,
  "tokensOutput" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fleet_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_messages_chatId_createdAt_idx" ON "fleet_messages"("chatId", "createdAt");
ALTER TABLE "fleet_messages" ADD CONSTRAINT "fleet_messages_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "fleet_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── fleet_operations ──
CREATE TABLE "fleet_operations" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "missionId" TEXT,
  "chatId" TEXT,
  "trigger" "FleetOperationTrigger" NOT NULL,
  "status" "FleetOperationStatus" NOT NULL DEFAULT 'PENDING',
  "instruction" TEXT NOT NULL,
  "output" TEXT,
  "toolsCalled" JSONB,
  "proposedActions" JSONB,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "tokensInput" INTEGER NOT NULL DEFAULT 0,
  "tokensOutput" INTEGER NOT NULL DEFAULT 0,
  "tokensCached" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fleet_operations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_operations_companyId_status_createdAt_idx" ON "fleet_operations"("companyId", "status", "createdAt");
CREATE INDEX "fleet_operations_memberId_createdAt_idx" ON "fleet_operations"("memberId", "createdAt");
CREATE INDEX "fleet_operations_missionId_idx" ON "fleet_operations"("missionId");
ALTER TABLE "fleet_operations" ADD CONSTRAINT "fleet_operations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_operations" ADD CONSTRAINT "fleet_operations_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "fleet_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_operations" ADD CONSTRAINT "fleet_operations_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "fleet_missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fleet_operations" ADD CONSTRAINT "fleet_operations_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "fleet_chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissões RBAC para o módulo Fleet
INSERT INTO "permissions" ("id", "module", "action", "slug", "description") VALUES
  (gen_random_uuid()::text, 'fleet', 'read',   'fleet:read',   'Ver Fleet (membros, missões, chats)'),
  (gen_random_uuid()::text, 'fleet', 'write',  'fleet:write',  'Criar/editar membros, missões e chats'),
  (gen_random_uuid()::text, 'fleet', 'delete', 'fleet:delete', 'Remover membros, missões e chats'),
  (gen_random_uuid()::text, 'fleet', 'manage', 'fleet:manage', 'Aprovar operações, configurar setores e templates')
ON CONFLICT ("slug") DO NOTHING;
