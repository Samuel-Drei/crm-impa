-- ── instances.timezone ───────────────────────────────────────
ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
