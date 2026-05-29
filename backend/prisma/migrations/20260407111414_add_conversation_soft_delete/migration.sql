-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_companyId_deletedAt_idx" ON "conversations"("companyId", "deletedAt");
