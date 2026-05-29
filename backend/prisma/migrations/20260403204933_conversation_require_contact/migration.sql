/*
  Warnings:

  - Made the column `contactId` on table `conversations` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_contactId_fkey";

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "contactId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
