-- ============================================================
-- Migration: RoutingStrategy + valores novos em AIProviderType
--            + colunas routing em ai_agents
-- ============================================================

-- ── Enum RoutingStrategy ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "RoutingStrategy" AS ENUM ('BEST_PERFORMANCE','ROUND_ROBIN','COST_OPTIMIZED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enum AIProviderType: adicionar novos valores ───────────
-- (DB antigo: OPENAI, GEMINI, CLAUDE; schema atual tem 18 valores)
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'DEEPSEEK';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'GROQ';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'OPENROUTER';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'PERPLEXITY';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'MISTRAL';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'COHERE';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'XAI';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'TOGETHER';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'FIREWORKS';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'CEREBRAS';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'GITHUB_MODELS';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'GITHUB_COPILOT';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'ANTIGRAVITY';
ALTER TYPE "AIProviderType" ADD VALUE IF NOT EXISTS 'OPENAI_COMPATIBLE';

-- ── ai_agents: smart routing ───────────────────────────────
ALTER TABLE "ai_agents"
  ADD COLUMN IF NOT EXISTS "useSmartRouting"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "routingStrategy"    "RoutingStrategy" NOT NULL DEFAULT 'BEST_PERFORMANCE',
  ADD COLUMN IF NOT EXISTS "routingProviderIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
