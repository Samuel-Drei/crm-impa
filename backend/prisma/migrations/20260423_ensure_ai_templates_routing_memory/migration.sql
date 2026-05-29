-- Ensure AI Agent Templates / Provider Metrics / Memories tables exist (idempotent).
-- Conteúdo originalmente em 20250620_add_templates_routing_memory, que tinha data anterior
-- ao init e quebrava em DBs novos. Este script roda no final, depois de todas as deps
-- (AIProviderType, AITriggerType, ai_providers, companies) já estarem criadas.

-- AI Agent Templates ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_agent_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "welcomeMessage" TEXT,
    "model" TEXT,
    "providerType" "AIProviderType",
    "triggerType" "AITriggerType" NOT NULL DEFAULT 'ALL',
    "keywordFinish" TEXT DEFAULT '#sair',
    "sessionTimeout" INTEGER NOT NULL DEFAULT 30,
    "splitMessages" BOOLEAN NOT NULL DEFAULT false,
    "maxMessageLength" INTEGER NOT NULL DEFAULT 4000,
    "delayMessage" INTEGER NOT NULL DEFAULT 1000,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "followUpSteps" JSONB,
    "followUpPrompt" TEXT,
    "suggestedTools" JSONB,
    "suggestedSettings" JSONB,
    "useCrmContext" BOOLEAN NOT NULL DEFAULT true,
    "useContactInfo" BOOLEAN NOT NULL DEFAULT true,
    "useConversationHistory" BOOLEAN NOT NULL DEFAULT true,
    "contextMessagesLimit" INTEGER NOT NULL DEFAULT 10,
    "sessionMessagesLimit" INTEGER NOT NULL DEFAULT 50,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agent_templates_pkey" PRIMARY KEY ("id")
);

-- AI Provider Metrics --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_provider_metrics" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "successCalls" INTEGER NOT NULL DEFAULT 0,
    "errorCalls" INTEGER NOT NULL DEFAULT 0,
    "timeoutCalls" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "p95LatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCostPerCall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTokensPerCall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_provider_metrics_pkey" PRIMARY KEY ("id")
);

-- AI Memory ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_memories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "facts" JSONB,
    "preferences" JSONB,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "lastSessionId" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- Indexes (idempotentes) -----------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_templates_slug_key" ON "ai_agent_templates"("slug");
CREATE INDEX IF NOT EXISTS "ai_agent_templates_category_idx" ON "ai_agent_templates"("category");
CREATE INDEX IF NOT EXISTS "ai_agent_templates_isActive_sortOrder_idx" ON "ai_agent_templates"("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "ai_provider_metrics_companyId_model_idx" ON "ai_provider_metrics"("companyId", "model");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_metrics_companyId_providerId_model_windowStart_key" ON "ai_provider_metrics"("companyId", "providerId", "model", "windowStart");
CREATE INDEX IF NOT EXISTS "ai_memories_agentId_remoteJid_idx" ON "ai_memories"("agentId", "remoteJid");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_memories_companyId_agentId_remoteJid_key" ON "ai_memories"("companyId", "agentId", "remoteJid");

-- Foreign Keys (condicionais) ------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_metrics_companyId_fkey') THEN
    ALTER TABLE "ai_provider_metrics" ADD CONSTRAINT "ai_provider_metrics_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_metrics_providerId_fkey') THEN
    ALTER TABLE "ai_provider_metrics" ADD CONSTRAINT "ai_provider_metrics_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_memories_companyId_fkey') THEN
    ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
