-- AlterTable: add health/heartbeat fields to ai_providers
ALTER TABLE "ai_providers"
  ADD COLUMN IF NOT EXISTS "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHealthError" TEXT,
  ADD COLUMN IF NOT EXISTS "healthLatencyMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "consecutiveErrors" INTEGER NOT NULL DEFAULT 0;
