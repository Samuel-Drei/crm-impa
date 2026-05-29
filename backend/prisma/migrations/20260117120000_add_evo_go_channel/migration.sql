-- AlterEnum
ALTER TYPE "InstanceChannel" ADD VALUE 'EVO_GO';

-- AlterTable
ALTER TABLE "instances" ADD COLUMN "evoApiUrl" TEXT,
ADD COLUMN "evoInstanceId" TEXT,
ADD COLUMN "evoApiKey" TEXT;
