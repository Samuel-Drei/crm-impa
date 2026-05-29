-- AlterTable: Campos de parsing no documento (Docling/local)
ALTER TABLE "ai_knowledge_documents" ADD COLUMN "pageCount" INTEGER;
ALTER TABLE "ai_knowledge_documents" ADD COLUMN "parsingMethod" TEXT;
ALTER TABLE "ai_knowledge_documents" ADD COLUMN "fileSize" INTEGER;

-- AlterTable: Campos de estrutura no chunk (heading-aware chunking)
ALTER TABLE "ai_knowledge_chunks" ADD COLUMN "sectionTitle" TEXT;
ALTER TABLE "ai_knowledge_chunks" ADD COLUMN "pageNumber" INTEGER;
ALTER TABLE "ai_knowledge_chunks" ADD COLUMN "elementType" TEXT;
