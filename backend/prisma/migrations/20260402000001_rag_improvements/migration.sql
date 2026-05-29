-- AlterTable
ALTER TABLE "ai_knowledge_sources" ADD COLUMN     "crawlVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastCrawlHash" TEXT,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "pagesDiscovered" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ai_knowledge_documents" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "crawlVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ai_knowledge_chunks" ADD COLUMN     "wordCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;
