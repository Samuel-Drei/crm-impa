-- CreateEnum
CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'GEMINI', 'CLAUDE');

-- CreateEnum
CREATE TYPE "AIAgentType" AS ENUM ('LLM', 'SEQUENTIAL', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "AIAgentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "AISessionStatus" AS ENUM ('OPENED', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AITriggerType" AS ENUM ('KEYWORD', 'ALL', 'ADVANCED');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AIProviderType" NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AIAgentType" NOT NULL DEFAULT 'LLM',
    "status" "AIAgentStatus" NOT NULL DEFAULT 'DRAFT',
    "systemPrompt" TEXT NOT NULL,
    "welcomeMessage" TEXT,
    "triggerType" "AITriggerType" NOT NULL DEFAULT 'ALL',
    "triggerValue" TEXT,
    "keywordFinish" TEXT DEFAULT '#sair',
    "unknownMessage" TEXT,
    "delayMessage" INTEGER NOT NULL DEFAULT 1000,
    "splitMessages" BOOLEAN NOT NULL DEFAULT false,
    "maxMessageLength" INTEGER NOT NULL DEFAULT 4000,
    "sessionTimeout" INTEGER NOT NULL DEFAULT 30,
    "keepOpen" BOOLEAN NOT NULL DEFAULT false,
    "listeningFromMe" BOOLEAN NOT NULL DEFAULT false,
    "stopBotFromMe" BOOLEAN NOT NULL DEFAULT true,
    "debounceTime" INTEGER NOT NULL DEFAULT 3,
    "useCrmContext" BOOLEAN NOT NULL DEFAULT true,
    "useContactInfo" BOOLEAN NOT NULL DEFAULT true,
    "useConversationHistory" BOOLEAN NOT NULL DEFAULT true,
    "instanceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "status" "AISessionStatus" NOT NULL DEFAULT 'OPENED',
    "context" JSONB,
    "variables" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "latencyMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_bases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT,
    "fileUrl" TEXT,
    "sourceUrl" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_knowledge" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_companyId_name_key" ON "ai_providers"("companyId", "name");

-- CreateIndex
CREATE INDEX "ai_agents_companyId_status_idx" ON "ai_agents"("companyId", "status");

-- CreateIndex
CREATE INDEX "ai_sessions_instanceId_remoteJid_status_idx" ON "ai_sessions"("instanceId", "remoteJid", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_sessions_agentId_instanceId_remoteJid_key" ON "ai_sessions"("agentId", "instanceId", "remoteJid");

-- CreateIndex
CREATE INDEX "ai_messages_sessionId_createdAt_idx" ON "ai_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_messages_agentId_createdAt_idx" ON "ai_messages"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_knowledge_agentId_knowledgeBaseId_key" ON "ai_agent_knowledge"("agentId", "knowledgeBaseId");

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_bases" ADD CONSTRAINT "ai_knowledge_bases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "ai_knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
