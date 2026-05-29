-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('TEXT', 'FILE', 'URL', 'WEBSITE', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'QUEUED');

-- CreateEnum
CREATE TYPE "IngestionJobType" AS ENUM ('INDEX_SOURCE', 'CRAWL_WEBSITE', 'REINDEX_SOURCE', 'DELETE_SOURCE');

-- AlterTable
ALTER TABLE "ai_knowledge_bases" ADD COLUMN     "chunkOverlap" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "chunkSize" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "embeddingDimension" INTEGER NOT NULL DEFAULT 1536,
ADD COLUMN     "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
ADD COLUMN     "indexingStatus" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN     "lastIndexedAt" TIMESTAMP(3),
ADD COLUMN     "retrievalMode" TEXT NOT NULL DEFAULT 'hybrid',
ADD COLUMN     "scoreThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "topK" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "totalChunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalDocuments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_knowledge_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "textContent" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSize" INTEGER,
    "sourceUrl" TEXT,
    "crawlConfig" JSONB,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "totalDocuments" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "lastCrawledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "sourceUrl" TEXT,
    "contentHash" TEXT,
    "rawContent" TEXT,
    "cleanContent" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "qdrantCollectionName" TEXT,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "indexedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "qdrantPointId" TEXT,
    "isIndexed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_ingestion_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" "IngestionJobType" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "errorMessage" TEXT,
    "documentsFound" INTEGER NOT NULL DEFAULT 0,
    "documentsProcessed" INTEGER NOT NULL DEFAULT 0,
    "chunksCreated" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_knowledge_sources_companyId_idx" ON "ai_knowledge_sources"("companyId");

-- CreateIndex
CREATE INDEX "ai_knowledge_sources_knowledgeBaseId_idx" ON "ai_knowledge_sources"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "ai_knowledge_sources_status_idx" ON "ai_knowledge_sources"("status");

-- CreateIndex
CREATE INDEX "ai_knowledge_documents_companyId_idx" ON "ai_knowledge_documents"("companyId");

-- CreateIndex
CREATE INDEX "ai_knowledge_documents_knowledgeBaseId_idx" ON "ai_knowledge_documents"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "ai_knowledge_documents_sourceId_idx" ON "ai_knowledge_documents"("sourceId");

-- CreateIndex
CREATE INDEX "ai_knowledge_documents_contentHash_idx" ON "ai_knowledge_documents"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_documents_knowledgeBaseId_sourceUrl_key" ON "ai_knowledge_documents"("knowledgeBaseId", "sourceUrl");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_documentId_idx" ON "ai_knowledge_chunks"("documentId");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_qdrantPointId_idx" ON "ai_knowledge_chunks"("qdrantPointId");

-- CreateIndex
CREATE INDEX "ai_ingestion_jobs_companyId_idx" ON "ai_ingestion_jobs"("companyId");

-- CreateIndex
CREATE INDEX "ai_ingestion_jobs_sourceId_idx" ON "ai_ingestion_jobs"("sourceId");

-- CreateIndex
CREATE INDEX "ai_ingestion_jobs_status_idx" ON "ai_ingestion_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_knowledge_bases_companyId_idx" ON "ai_knowledge_bases"("companyId");

-- AddForeignKey
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "ai_knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "ai_knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ai_knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ai_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_ingestion_jobs" ADD CONSTRAINT "ai_ingestion_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_ingestion_jobs" ADD CONSTRAINT "ai_ingestion_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ai_knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
