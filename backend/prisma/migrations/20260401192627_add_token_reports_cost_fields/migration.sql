-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "completionTokens" INTEGER,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "modelUsed" TEXT,
ADD COLUMN     "promptTokens" INTEGER;

-- AlterTable
ALTER TABLE "ai_sessions" ADD COLUMN     "completionTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "promptTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_token_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT,
    "instanceId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costBrl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usdBrlRate" DOUBLE PRECISION,
    "modelBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_token_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_token_reports_companyId_date_idx" ON "ai_token_reports"("companyId", "date");

-- CreateIndex
CREATE INDEX "ai_token_reports_agentId_date_idx" ON "ai_token_reports"("agentId", "date");

-- CreateIndex
CREATE INDEX "ai_token_reports_instanceId_date_idx" ON "ai_token_reports"("instanceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ai_token_reports_companyId_agentId_instanceId_date_key" ON "ai_token_reports"("companyId", "agentId", "instanceId", "date");

-- CreateIndex
CREATE INDEX "ai_messages_modelUsed_createdAt_idx" ON "ai_messages"("modelUsed", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_token_reports" ADD CONSTRAINT "ai_token_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
