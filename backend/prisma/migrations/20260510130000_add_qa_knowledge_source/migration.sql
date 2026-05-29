-- Add QA value to KnowledgeSourceType enum
ALTER TYPE "KnowledgeSourceType" ADD VALUE IF NOT EXISTS 'QA';

-- Add qaItems JSON column to AIKnowledgeSource
ALTER TABLE "ai_knowledge_sources" ADD COLUMN IF NOT EXISTS "qaItems" JSONB;
