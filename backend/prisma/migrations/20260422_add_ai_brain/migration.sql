-- ============================================
-- AI Brain: nodes / edges / facts (Perfil 360° + grafo vetorizado)
-- Idempotente: usa IF NOT EXISTS e DO $$ blocks
-- ============================================

-- ───── Enums ─────
DO $$ BEGIN
  CREATE TYPE "AIBrainNodeType" AS ENUM (
    'CONTACT','COMPANY','TOPIC','FACT','PREFERENCE','OBJECTION','EVENT','DOCUMENT_CHUNK','SESSION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIBrainEdgeType" AS ENUM (
    'MENTIONS','PREFERS','OBJECTS_TO','RELATED_TO','WORKS_AT','DEAL_OF',
    'LEARNED_FROM','SUPERSEDES','PARTICIPATED_IN','DERIVED_FROM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIBrainFactCategory" AS ENUM (
    'DEMOGRAPHIC','PREFERENCE','OBJECTION','INTENT','PAIN_POINT','COMMITMENT','EVENT','CUSTOM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───── ai_brain_nodes ─────
CREATE TABLE IF NOT EXISTS "ai_brain_nodes" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "agentId"     TEXT,
  "type"        "AIBrainNodeType" NOT NULL,
  "subjectType" TEXT,
  "subjectId"   TEXT,
  "label"       TEXT NOT NULL,
  "summary"     TEXT,
  "metadata"    JSONB,
  "embeddingId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_brain_nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_brain_nodes_companyId_type_idx"
  ON "ai_brain_nodes"("companyId","type");
CREATE INDEX IF NOT EXISTS "ai_brain_nodes_companyId_subjectType_subjectId_idx"
  ON "ai_brain_nodes"("companyId","subjectType","subjectId");
CREATE INDEX IF NOT EXISTS "ai_brain_nodes_companyId_lastSeenAt_idx"
  ON "ai_brain_nodes"("companyId","lastSeenAt");

DO $$ BEGIN
  ALTER TABLE "ai_brain_nodes"
    ADD CONSTRAINT "ai_brain_nodes_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───── ai_brain_edges ─────
CREATE TABLE IF NOT EXISTS "ai_brain_edges" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "fromId"           TEXT NOT NULL,
  "toId"             TEXT NOT NULL,
  "type"             "AIBrainEdgeType" NOT NULL,
  "weight"           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "validFrom"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"          TIMESTAMP(3),
  "sourceSessionId"  TEXT,
  "sourceMessageId"  TEXT,
  "sourceDocumentId" TEXT,
  "metadata"         JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_brain_edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_brain_edges_companyId_fromId_type_idx"
  ON "ai_brain_edges"("companyId","fromId","type");
CREATE INDEX IF NOT EXISTS "ai_brain_edges_companyId_toId_type_idx"
  ON "ai_brain_edges"("companyId","toId","type");
CREATE INDEX IF NOT EXISTS "ai_brain_edges_companyId_validTo_idx"
  ON "ai_brain_edges"("companyId","validTo");

DO $$ BEGIN
  ALTER TABLE "ai_brain_edges"
    ADD CONSTRAINT "ai_brain_edges_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_brain_edges"
    ADD CONSTRAINT "ai_brain_edges_fromId_fkey"
    FOREIGN KEY ("fromId") REFERENCES "ai_brain_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_brain_edges"
    ADD CONSTRAINT "ai_brain_edges_toId_fkey"
    FOREIGN KEY ("toId") REFERENCES "ai_brain_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───── ai_brain_facts ─────
CREATE TABLE IF NOT EXISTS "ai_brain_facts" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "contactId"         TEXT,
  "customerAccountId" TEXT,
  "agentId"           TEXT,
  "nodeId"            TEXT,
  "category"          "AIBrainFactCategory" NOT NULL,
  "subject"           TEXT NOT NULL,
  "predicate"         TEXT NOT NULL,
  "value"             TEXT NOT NULL,
  "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "sourceType"        TEXT NOT NULL,
  "sourceRefType"     TEXT,
  "sourceRefId"       TEXT,
  "validFrom"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"           TIMESTAMP(3),
  "supersededById"    TEXT,
  "metadata"          JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_brain_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_brain_facts_supersededById_key"
  ON "ai_brain_facts"("supersededById");
CREATE INDEX IF NOT EXISTS "ai_brain_facts_companyId_contactId_category_idx"
  ON "ai_brain_facts"("companyId","contactId","category");
CREATE INDEX IF NOT EXISTS "ai_brain_facts_companyId_customerAccountId_category_idx"
  ON "ai_brain_facts"("companyId","customerAccountId","category");
CREATE INDEX IF NOT EXISTS "ai_brain_facts_companyId_validTo_idx"
  ON "ai_brain_facts"("companyId","validTo");
CREATE INDEX IF NOT EXISTS "ai_brain_facts_nodeId_idx"
  ON "ai_brain_facts"("nodeId");

DO $$ BEGIN
  ALTER TABLE "ai_brain_facts"
    ADD CONSTRAINT "ai_brain_facts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_brain_facts"
    ADD CONSTRAINT "ai_brain_facts_nodeId_fkey"
    FOREIGN KEY ("nodeId") REFERENCES "ai_brain_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_brain_facts"
    ADD CONSTRAINT "ai_brain_facts_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "ai_brain_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
