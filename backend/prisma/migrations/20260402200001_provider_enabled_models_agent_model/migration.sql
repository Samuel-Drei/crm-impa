-- AlterTable: Add enabledModels to ai_providers
ALTER TABLE "ai_providers" ADD COLUMN "enabledModels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: Add model to ai_agents (specific model override)
ALTER TABLE "ai_agents" ADD COLUMN "model" TEXT;

-- Backfill: Set enabledModels with the current model for existing providers
UPDATE "ai_providers" SET "enabledModels" = ARRAY["model"] WHERE array_length("enabledModels", 1) IS NULL OR array_length("enabledModels", 1) = 0;
