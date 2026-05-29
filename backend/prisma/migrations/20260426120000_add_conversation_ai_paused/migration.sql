-- Add per-conversation AI pause flags (independent of AISession existence)
ALTER TABLE "conversations"
  ADD COLUMN "aiPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiPausedAt" TIMESTAMP(3),
  ADD COLUMN "aiPausedReason" VARCHAR(120),
  ADD COLUMN "aiPausedByUserId" TEXT;

CREATE INDEX "conversations_aiPaused_idx" ON "conversations"("aiPaused") WHERE "aiPaused" = true;
