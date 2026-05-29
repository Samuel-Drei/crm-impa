-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "allowJids" TEXT[] DEFAULT ARRAY[]::TEXT[];
