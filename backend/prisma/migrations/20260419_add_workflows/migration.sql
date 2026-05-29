-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('MANUAL', 'CONVERSATION_OPENED', 'CONVERSATION_RESOLVED', 'MESSAGE_RECEIVED', 'CONTACT_CREATED', 'CONTACT_UPDATED', 'CARD_MOVED', 'LEAD_CREATED', 'SCHEDULE', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "WorkflowNodeType" AS ENUM ('START', 'END', 'LLM', 'AI_AGENT', 'KNOWLEDGE_RETRIEVAL', 'IF_ELSE', 'SWITCH', 'LOOP', 'WAIT', 'SET_VARIABLE', 'CODE', 'TEMPLATE', 'HTTP_REQUEST', 'SEND_MESSAGE', 'UPDATE_CONTACT', 'ASSIGN_CONVERSATION', 'ADD_TAG', 'MOVE_CARD', 'CREATE_TASK', 'SEND_NOTIFICATION');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "WorkflowNodeExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "WorkflowTriggerType" NOT NULL DEFAULT 'MANUAL',
    "triggerConfig" JSONB,
    "variables" JSONB,
    "settings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_nodes" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" "WorkflowNodeType" NOT NULL,
    "label" TEXT,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_edges" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "targetHandle" TEXT,
    "label" TEXT,
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "triggerData" JSONB,
    "variables" JSONB,
    "outputs" JSONB,
    "error" TEXT,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_node_executions" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" "WorkflowNodeType" NOT NULL,
    "status" "WorkflowNodeExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "inputs" JSONB,
    "outputs" JSONB,
    "error" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_node_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflows_companyId_status_idx" ON "workflows"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflows_triggerType_idx" ON "workflows"("triggerType");

-- CreateIndex
CREATE INDEX "workflow_nodes_workflowId_idx" ON "workflow_nodes"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_edges_workflowId_idx" ON "workflow_edges"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_runs_workflowId_idx" ON "workflow_runs"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_runs_companyId_status_idx" ON "workflow_runs"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_node_executions_runId_idx" ON "workflow_node_executions"("runId");

-- CreateIndex
CREATE INDEX "workflow_node_executions_nodeId_idx" ON "workflow_node_executions"("nodeId");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
