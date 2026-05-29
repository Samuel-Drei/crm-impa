-- CreateEnum
CREATE TYPE "AITriggerOperator" AS ENUM ('CONTAINS', 'EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX');

-- AlterEnum
ALTER TYPE "AITriggerType" ADD VALUE 'NONE';

-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "ignoreJids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "triggerOperator" "AITriggerOperator" NOT NULL DEFAULT 'CONTAINS';
