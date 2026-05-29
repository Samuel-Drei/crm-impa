-- AlterTable: add OAuth / auth fields to ai_providers
ALTER TABLE "ai_providers"
  ADD COLUMN IF NOT EXISTS "authType"       TEXT NOT NULL DEFAULT 'apikey',
  ADD COLUMN IF NOT EXISTS "refreshToken"   TEXT,
  ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "oauthData"      JSONB;
