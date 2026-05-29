-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "followUpSteps" JSONB;

-- AlterTable
ALTER TABLE "ai_sessions" ADD COLUMN     "followUpStartedAt" TIMESTAMP(3);
