-- Add new FlowNodeType enum values (safe for PG 9.6+)
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['ITERATION','HUMAN_INPUT','APPROVAL'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'FlowNodeType' AND e.enumlabel = v
    ) THEN
      EXECUTE format('ALTER TYPE "FlowNodeType" ADD VALUE %L', v);
    END IF;
  END LOOP;
END$$;

-- AIAgentLearning: 3rd memory layer (procedural)
CREATE TABLE IF NOT EXISTS "ai_agent_learnings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "positiveCount" INTEGER NOT NULL DEFAULT 0,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'agent_self_reflection',
    "sourceRefId" TEXT,
    "createdBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agent_learnings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_learnings_companyId_agentId_active_idx" ON "ai_agent_learnings"("companyId", "agentId", "active");
CREATE INDEX IF NOT EXISTS "ai_agent_learnings_agentId_confidence_idx" ON "ai_agent_learnings"("agentId", "confidence");

ALTER TABLE "ai_agent_learnings" ADD CONSTRAINT "ai_agent_learnings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_learnings" ADD CONSTRAINT "ai_agent_learnings_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AIArtifact: versioned outputs from agents
CREATE TABLE IF NOT EXISTS "ai_artifacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT,
    "sessionId" TEXT,
    "remoteJid" TEXT,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "mimeType" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentArtifactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_artifacts_companyId_agentId_createdAt_idx" ON "ai_artifacts"("companyId", "agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_artifacts_companyId_remoteJid_idx" ON "ai_artifacts"("companyId", "remoteJid");
CREATE INDEX IF NOT EXISTS "ai_artifacts_sessionId_idx" ON "ai_artifacts"("sessionId");
CREATE INDEX IF NOT EXISTS "ai_artifacts_type_status_idx" ON "ai_artifacts"("type", "status");

ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_parentArtifactId_fkey" FOREIGN KEY ("parentArtifactId") REFERENCES "ai_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FleetCriticReview: pre-mortem reviews
CREATE TABLE IF NOT EXISTS "fleet_critic_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "perspectives" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "bypassedBy" TEXT,
    "bypassedAt" TIMESTAMP(3),
    "bypassReason" TEXT,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fleet_critic_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fleet_critic_reviews_operationId_key" ON "fleet_critic_reviews"("operationId");
CREATE INDEX IF NOT EXISTS "fleet_critic_reviews_companyId_riskLevel_createdAt_idx" ON "fleet_critic_reviews"("companyId", "riskLevel", "createdAt");

ALTER TABLE "fleet_critic_reviews" ADD CONSTRAINT "fleet_critic_reviews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleet_critic_reviews" ADD CONSTRAINT "fleet_critic_reviews_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "fleet_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
