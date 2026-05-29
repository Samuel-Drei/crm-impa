-- ============================================
-- Daily Brain Digest
-- Tabela de auditoria/idempotência + flags na Company
-- ============================================

-- Enum status do digest
DO $$ BEGIN
  CREATE TYPE "AIDailyDigestStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Colunas em companies
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "dailyBrainEnabled"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "dailyBrainTimezone" TEXT    NOT NULL DEFAULT 'America/Sao_Paulo';

-- Tabela ai_daily_digests
CREATE TABLE IF NOT EXISTS "ai_daily_digests" (
  "id"                   TEXT PRIMARY KEY,
  "companyId"            TEXT NOT NULL,
  "date"                 TEXT NOT NULL,
  "status"               "AIDailyDigestStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt"            TIMESTAMP(3),
  "finishedAt"           TIMESTAMP(3),
  "contactsProcessed"    INTEGER NOT NULL DEFAULT 0,
  "messagesProcessed"    INTEGER NOT NULL DEFAULT 0,
  "conversationsTouched" INTEGER NOT NULL DEFAULT 0,
  "cardsTouched"         INTEGER NOT NULL DEFAULT 0,
  "tasksTouched"         INTEGER NOT NULL DEFAULT 0,
  "ticketsTouched"       INTEGER NOT NULL DEFAULT 0,
  "factsCreated"         INTEGER NOT NULL DEFAULT 0,
  "embeddingsGenerated"  INTEGER NOT NULL DEFAULT 0,
  "tokensUsed"           INTEGER NOT NULL DEFAULT 0,
  "summary"              TEXT,
  "errorMessage"         TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_daily_digests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique + indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ai_daily_digests_companyId_date_key"
  ON "ai_daily_digests"("companyId", "date");

CREATE INDEX IF NOT EXISTS "ai_daily_digests_companyId_status_idx"
  ON "ai_daily_digests"("companyId", "status");

CREATE INDEX IF NOT EXISTS "ai_daily_digests_date_idx"
  ON "ai_daily_digests"("date");
