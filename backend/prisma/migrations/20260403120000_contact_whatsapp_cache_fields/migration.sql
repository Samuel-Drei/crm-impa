-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "whatsappStatus" TEXT,
ADD COLUMN     "verifiedName" TEXT,
ADD COLUMN     "whatsappSyncedAt" TIMESTAMP(3);
