-- AddColumn pinnedAt to conversations
ALTER TABLE "conversations" ADD COLUMN "pinnedAt" TIMESTAMP(3);

-- Index for efficient pinned-first ordering
CREATE INDEX "conversations_pinnedAt_idx" ON "conversations"("pinnedAt" DESC NULLS LAST);
