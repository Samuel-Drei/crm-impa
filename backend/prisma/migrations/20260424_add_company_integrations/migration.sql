-- ════════════════════════════════════════════════════════════════════
-- Migration: add_company_integrations
-- Adiciona sistema modular de integrações externas (FishAudio, Cal.com, etc)
-- + colunas voiceConfig/sttConfig/calendarConfig em ai_agents
-- + sttConfig em instances
-- ════════════════════════════════════════════════════════════════════

-- ── Enums ─────────────────────────────────────────────────────────────
CREATE TYPE "CompanyIntegrationType" AS ENUM ('FISHAUDIO', 'ELEVENLABS', 'CALCOM', 'GOOGLE_CALENDAR', 'CUSTOM');
CREATE TYPE "CompanyIntegrationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- ── Tabela ────────────────────────────────────────────────────────────
CREATE TABLE "company_integrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CompanyIntegrationType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CompanyIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentials" TEXT NOT NULL,
    "config" JSONB,
    "capabilities" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastUsageAt" TIMESTAMP(3),
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "failedRequests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_integrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_integrations_companyId_type_status_idx" ON "company_integrations"("companyId", "type", "status");

ALTER TABLE "company_integrations"
    ADD CONSTRAINT "company_integrations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Novas colunas em ai_agents ────────────────────────────────────────
ALTER TABLE "ai_agents"
    ADD COLUMN "voiceConfig" JSONB,
    ADD COLUMN "sttConfig" JSONB,
    ADD COLUMN "calendarConfig" JSONB;

-- ── Nova coluna em instances ──────────────────────────────────────────
ALTER TABLE "instances"
    ADD COLUMN "sttConfig" JSONB;
