-- CreateTable: system_settings
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AlterTable: Add message attribution columns
ALTER TABLE "messages" ADD COLUMN "sentByUserId" TEXT;
ALTER TABLE "messages" ADD COLUMN "sentByAIAgentId" TEXT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sentByAIAgentId_fkey" FOREIGN KEY ("sentByAIAgentId") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
