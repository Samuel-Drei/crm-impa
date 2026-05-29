-- AIAgentSkill: procedural memory vetorizada (playbooks reutilizáveis)
CREATE TABLE IF NOT EXISTS "ai_agent_skills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT NOT NULL,
    "examples" TEXT,
    "relatedSkillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "embeddingProviderId" TEXT,
    "embeddingModel" TEXT,
    "qdrantPointId" TEXT,
    "embeddingHash" TEXT,
    "indexedAt" TIMESTAMP(3),
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_skills_pkey" PRIMARY KEY ("id")
);

-- Unique per company slug
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_skills_companyId_slug_key" ON "ai_agent_skills"("companyId", "slug");

-- Indexes
CREATE INDEX IF NOT EXISTS "ai_agent_skills_companyId_isActive_idx" ON "ai_agent_skills"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "ai_agent_skills_agentId_isActive_idx" ON "ai_agent_skills"("agentId", "isActive");
CREATE INDEX IF NOT EXISTS "ai_agent_skills_qdrantPointId_idx" ON "ai_agent_skills"("qdrantPointId");

-- FKs
ALTER TABLE "ai_agent_skills"
    ADD CONSTRAINT "ai_agent_skills_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_agent_skills"
    ADD CONSTRAINT "ai_agent_skills_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
