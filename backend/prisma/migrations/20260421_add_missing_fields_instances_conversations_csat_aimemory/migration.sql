-- ============================================================
-- Migration: campos faltantes em instances,
--            + tabelas csat_survey_responses e ai_memories
-- ============================================================

-- ── instances: campos de token, working hours e CSAT ────────
ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "apiTokenExpiresAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "workingHoursEnabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "outOfOfficeMessage"   TEXT,
  ADD COLUMN IF NOT EXISTS "csatEnabled"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "csatMessage"          TEXT;

-- ── csat_survey_responses ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "csat_survey_responses" (
  "id"              TEXT NOT NULL,
  "instanceId"      TEXT NOT NULL,
  "conversationId"  TEXT NOT NULL,
  "contactId"       TEXT NOT NULL,
  "assignedAgentId" TEXT,
  "rating"          INTEGER NOT NULL,
  "feedbackMessage" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "csat_survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "csat_survey_responses_conversationId_key"
  ON "csat_survey_responses"("conversationId");

CREATE INDEX IF NOT EXISTS "csat_survey_responses_instanceId_idx"
  ON "csat_survey_responses"("instanceId");

CREATE INDEX IF NOT EXISTS "csat_survey_responses_assignedAgentId_idx"
  ON "csat_survey_responses"("assignedAgentId");

DO $$ BEGIN
  ALTER TABLE "csat_survey_responses"
    ADD CONSTRAINT "csat_survey_responses_instanceId_fkey"
      FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "csat_survey_responses"
    ADD CONSTRAINT "csat_survey_responses_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "csat_survey_responses"
    ADD CONSTRAINT "csat_survey_responses_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "csat_survey_responses"
    ADD CONSTRAINT "csat_survey_responses_assignedAgentId_fkey"
      FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ai_memories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_memories" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "remoteJid"      TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "facts"          JSONB,
  "preferences"    JSONB,
  "sessionCount"   INTEGER NOT NULL DEFAULT 0,
  "lastSessionId"  TEXT,
  "tokensUsed"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_memories_companyId_agentId_remoteJid_key"
  ON "ai_memories"("companyId", "agentId", "remoteJid");

CREATE INDEX IF NOT EXISTS "ai_memories_agentId_remoteJid_idx"
  ON "ai_memories"("agentId", "remoteJid");

DO $$ BEGIN
  ALTER TABLE "ai_memories"
    ADD CONSTRAINT "ai_memories_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
