-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "httpTools" JSONB,
ADD COLUMN     "mcpServerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
