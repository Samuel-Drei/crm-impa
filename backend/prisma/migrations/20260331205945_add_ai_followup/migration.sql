-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "followUpCloseMessage" TEXT,
ADD COLUMN     "followUpCloseOnMax" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followUpDelay" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpInterval" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "followUpMaxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "followUpMessages" JSONB,
ADD COLUMN     "followUpMode" TEXT NOT NULL DEFAULT 'AI_GENERATED',
ADD COLUMN     "followUpPrompt" TEXT;

-- AlterTable
ALTER TABLE "ai_sessions" ADD COLUMN     "followUpCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageRole" TEXT;
