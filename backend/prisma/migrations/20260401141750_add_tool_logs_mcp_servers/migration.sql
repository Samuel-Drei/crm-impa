-- CreateTable
CREATE TABLE "ai_tool_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "agentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolType" TEXT NOT NULL,
    "moduleId" TEXT,
    "requestMethod" TEXT,
    "requestUrl" TEXT,
    "requestHeaders" JSONB,
    "requestBody" JSONB,
    "requestParams" JSONB,
    "responseStatus" INTEGER,
    "responseHeaders" JSONB,
    "responseBody" TEXT,
    "responseTime" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryOf" TEXT,
    "resultForLLM" TEXT,
    "triggeredBy" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_mcp_servers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serverUrl" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'sse',
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authKey" TEXT,
    "authValue" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 30000,
    "sseReadTimeout" INTEGER NOT NULL DEFAULT 60000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discoveredTools" JSONB,
    "lastDiscoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_tool_logs_sessionId_createdAt_idx" ON "ai_tool_logs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_tool_logs_agentId_createdAt_idx" ON "ai_tool_logs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_tool_logs_companyId_createdAt_idx" ON "ai_tool_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_tool_logs_toolType_status_idx" ON "ai_tool_logs"("toolType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_mcp_servers_companyId_name_key" ON "ai_mcp_servers"("companyId", "name");

-- AddForeignKey
ALTER TABLE "ai_mcp_servers" ADD CONSTRAINT "ai_mcp_servers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
