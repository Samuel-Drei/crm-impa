-- Add crmToolsConfig to ai_agents
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "crmToolsConfig" JSONB;
