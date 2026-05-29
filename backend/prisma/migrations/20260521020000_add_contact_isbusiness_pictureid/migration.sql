-- AlterTable: add isBusiness and pictureId to contacts
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "isBusiness" BOOLEAN DEFAULT false;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "pictureId" TEXT;
