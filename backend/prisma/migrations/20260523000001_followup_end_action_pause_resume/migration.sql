-- AlterTable: ai_agents — follow-up end action + pause auto-resume
ALTER TABLE "ai_agents"
  ADD COLUMN IF NOT EXISTS "followUpEndAction"       TEXT    NOT NULL DEFAULT 'CLOSE',
  ADD COLUMN IF NOT EXISTS "followUpEndDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pauseAutoResumeEnabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pauseAutoResumeMinutes"  INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "pauseAutoResumeTrigger"  TEXT    NOT NULL DEFAULT 'PAUSED_AT';

-- Migrar followUpCloseOnMax → followUpEndAction (agentes que desabilitaram o close ficam como NONE)
UPDATE "ai_agents"
  SET "followUpEndAction" = 'NONE'
  WHERE "followUpCloseOnMax" = false AND "followUpEndAction" = 'CLOSE';

-- AlterTable: ai_sessions — campo pausedAt
ALTER TABLE "ai_sessions"
  ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
