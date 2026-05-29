-- Add historySyncedAt to instances table
-- Tracks when the EVO_GO history import was last completed (null = never imported)
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "historySyncedAt" TIMESTAMP(3);
