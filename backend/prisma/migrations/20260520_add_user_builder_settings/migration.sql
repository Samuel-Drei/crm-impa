-- Persist per-user Flow Builder UX/UI preferences.
-- Idempotent to support existing databases and fresh developer databases.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "builderSettings" JSONB;
