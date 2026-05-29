-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ScheduleRecurrence" AS ENUM ('ONCE', 'DAILY', 'EVERY_X_DAYS', 'WEEKLY', 'SPECIFIC_DAYS', 'MONTHLY');

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "contactId" TEXT,
    "remoteJid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT,
    "mediaUrl" TEXT,
    "mediaFileName" TEXT,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "recurrence" "ScheduleRecurrence" NOT NULL DEFAULT 'ONCE',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "recurrenceRule" JSONB,
    "nextExecutionAt" TIMESTAMP(3),
    "lastExecutedAt" TIMESTAMP(3),
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProviderId" TEXT,
    "aiModel" TEXT,
    "aiPrompt" TEXT,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "maxOccurrences" INTEGER,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_message_logs" (
    "id" TEXT NOT NULL,
    "scheduledMessageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "content" TEXT,
    "messageId" TEXT,
    "error" TEXT,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_messages_companyId_status_idx" ON "scheduled_messages"("companyId", "status");

-- CreateIndex
CREATE INDEX "scheduled_messages_nextExecutionAt_status_idx" ON "scheduled_messages"("nextExecutionAt", "status");

-- CreateIndex
CREATE INDEX "scheduled_messages_instanceId_idx" ON "scheduled_messages"("instanceId");

-- CreateIndex
CREATE INDEX "scheduled_message_logs_scheduledMessageId_idx" ON "scheduled_message_logs"("scheduledMessageId");

-- CreateIndex
CREATE INDEX "scheduled_message_logs_executedAt_idx" ON "scheduled_message_logs"("executedAt");

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_message_logs" ADD CONSTRAINT "scheduled_message_logs_scheduledMessageId_fkey" FOREIGN KEY ("scheduledMessageId") REFERENCES "scheduled_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
