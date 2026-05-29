-- Sub-agentes (Padrão A): expõe outros agentes como tools `call_subagent_<slug>`
ALTER TABLE "ai_agents" ADD COLUMN "isSubAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_agents" ADD COLUMN "subAgentDescription" TEXT;
ALTER TABLE "ai_agents" ADD COLUMN "subAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
