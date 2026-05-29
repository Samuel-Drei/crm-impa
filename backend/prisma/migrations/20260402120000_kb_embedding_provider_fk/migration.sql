-- AlterTable: Add embeddingProviderId FK to ai_knowledge_bases
ALTER TABLE "ai_knowledge_bases" ADD COLUMN "embeddingProviderId" TEXT;

-- AddForeignKey
ALTER TABLE "ai_knowledge_bases" ADD CONSTRAINT "ai_knowledge_bases_embeddingProviderId_fkey" FOREIGN KEY ("embeddingProviderId") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
