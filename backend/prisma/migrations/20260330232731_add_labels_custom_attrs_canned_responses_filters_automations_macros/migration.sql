/*
  Warnings:

  - A unique constraint covering the columns `[webhookToken]` on the table `companies` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'PENDING', 'SNOOZED');

-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FlowTriggerType" AS ENUM ('KEYWORD', 'ALL', 'BUTTON_REPLY', 'LIST_REPLY', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "FlowNodeType" AS ENUM ('START', 'MESSAGE', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'MENU', 'BUTTONS', 'LIST', 'CONDITION', 'DELAY', 'SET_VARIABLE', 'HTTP_REQUEST', 'TRANSFER', 'GO_TO_FLOW', 'END');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AutomationLogStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CustomAttributeModel" AS ENUM ('CONVERSATION', 'CONTACT');

-- CreateEnum
CREATE TYPE "CustomAttributeType" AS ENUM ('TEXT', 'NUMBER', 'LINK', 'DATE', 'LIST', 'CHECKBOX');

-- CreateEnum
CREATE TYPE "MacroVisibility" AS ENUM ('PERSONAL', 'GLOBAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InstanceChannel" ADD VALUE 'WHATSMEOW';
ALTER TYPE "InstanceChannel" ADD VALUE 'COEXISTENCE';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "webhookToken" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "profilePicture" TEXT;

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "appId" TEXT,
ADD COLUMN     "ignoreBroadcasts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ignoreGroups" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ignoreStatus" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "webhookSecret" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "conversationId" TEXT;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowAutoAssign" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "contactId" TEXT,
    "remoteJid" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ConversationPriority",
    "assigneeId" TEXT,
    "teamId" TEXT,
    "customAttributes" JSONB,
    "additionalAttributes" JSONB,
    "cachedLabelList" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstReplyAt" TIMESTAMP(3),
    "waitingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "FlowTriggerType" NOT NULL DEFAULT 'KEYWORD',
    "triggerValue" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "variables" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_nodes" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "type" "FlowNodeType" NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_edges" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "targetHandle" TEXT,
    "label" TEXT,
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_sessions" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "variables" JSONB,
    "context" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "waitingInput" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_variables" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'INACTIVE',
    "delayBetweenMessages" INTEGER NOT NULL DEFAULT 3000,
    "metaTemplateName" TEXT,
    "metaTemplateLanguage" TEXT DEFAULT 'pt_BR',
    "useWindowFallback" BOOLEAN NOT NULL DEFAULT false,
    "fallbackTemplateName" TEXT,
    "templateCode" TEXT,
    "templateType" TEXT,
    "messageBody" JSONB,
    "variableMapping" JSONB,
    "phoneField" TEXT NOT NULL DEFAULT 'telefone',
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "window_subscribers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "notifyTime" TEXT NOT NULL DEFAULT '17:30',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastNotified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "window_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "messageContent" TEXT,
    "payload" JSONB,
    "status" "AutomationLogStatus" NOT NULL DEFAULT 'QUEUED',
    "apiMessageId" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#1f93ff',
    "showOnSidebar" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_labels" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_attribute_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "attributeDisplayName" TEXT NOT NULL,
    "attributeDisplayType" "CustomAttributeType" NOT NULL DEFAULT 'TEXT',
    "attributeModel" "CustomAttributeModel" NOT NULL DEFAULT 'CONVERSATION',
    "attributeValues" JSONB,
    "regexPattern" TEXT,
    "regexCue" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_filters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filterType" TEXT NOT NULL DEFAULT 'conversation',
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_automations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventName" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "MacroVisibility" NOT NULL DEFAULT 'PERSONAL',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_companyId_name_key" ON "teams"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE INDEX "conversations_companyId_status_assigneeId_idx" ON "conversations"("companyId", "status", "assigneeId");

-- CreateIndex
CREATE INDEX "conversations_companyId_status_teamId_idx" ON "conversations"("companyId", "status", "teamId");

-- CreateIndex
CREATE INDEX "conversations_instanceId_lastActivityAt_idx" ON "conversations"("instanceId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_instanceId_remoteJid_key" ON "conversations"("instanceId", "remoteJid");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "flows_companyId_status_idx" ON "flows"("companyId", "status");

-- CreateIndex
CREATE INDEX "flows_triggerType_triggerValue_idx" ON "flows"("triggerType", "triggerValue");

-- CreateIndex
CREATE INDEX "flow_nodes_flowId_idx" ON "flow_nodes"("flowId");

-- CreateIndex
CREATE INDEX "flow_edges_flowId_idx" ON "flow_edges"("flowId");

-- CreateIndex
CREATE INDEX "flow_sessions_instanceId_remoteJid_isActive_idx" ON "flow_sessions"("instanceId", "remoteJid", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "flow_sessions_flowId_instanceId_remoteJid_key" ON "flow_sessions"("flowId", "instanceId", "remoteJid");

-- CreateIndex
CREATE INDEX "webhook_events_companyId_createdAt_idx" ON "webhook_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_variables_webhookEventId_idx" ON "webhook_variables"("webhookEventId");

-- CreateIndex
CREATE UNIQUE INDEX "automations_token_key" ON "automations"("token");

-- CreateIndex
CREATE INDEX "automations_companyId_idx" ON "automations"("companyId");

-- CreateIndex
CREATE INDEX "automations_token_idx" ON "automations"("token");

-- CreateIndex
CREATE INDEX "window_subscribers_isActive_notifyTime_idx" ON "window_subscribers"("isActive", "notifyTime");

-- CreateIndex
CREATE UNIQUE INDEX "window_subscribers_companyId_phoneNumber_key" ON "window_subscribers"("companyId", "phoneNumber");

-- CreateIndex
CREATE INDEX "automation_logs_automationId_createdAt_idx" ON "automation_logs"("automationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "labels_companyId_title_key" ON "labels"("companyId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_labels_conversationId_labelId_key" ON "conversation_labels"("conversationId", "labelId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_attribute_definitions_companyId_attributeKey_attribu_key" ON "custom_attribute_definitions"("companyId", "attributeKey", "attributeModel");

-- CreateIndex
CREATE UNIQUE INDEX "canned_responses_companyId_shortCode_key" ON "canned_responses"("companyId", "shortCode");

-- CreateIndex
CREATE INDEX "conversation_automations_companyId_eventName_isActive_idx" ON "conversation_automations"("companyId", "eventName", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "companies_webhookToken_key" ON "companies"("webhookToken");

-- CreateIndex
CREATE INDEX "contacts_companyId_lastInboundAt_idx" ON "contacts"("companyId", "lastInboundAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_instanceId_direction_status_idx" ON "messages"("instanceId", "direction", "status");

-- CreateIndex
CREATE INDEX "messages_instanceId_createdAt_idx" ON "messages"("instanceId", "createdAt");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_nodes" ADD CONSTRAINT "flow_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "flow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_edges" ADD CONSTRAINT "flow_edges_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "flow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_sessions" ADD CONSTRAINT "flow_sessions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_variables" ADD CONSTRAINT "webhook_variables_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "window_subscribers" ADD CONSTRAINT "window_subscribers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "window_subscribers" ADD CONSTRAINT "window_subscribers_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_labels" ADD CONSTRAINT "conversation_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_attribute_definitions" ADD CONSTRAINT "custom_attribute_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_filters" ADD CONSTRAINT "custom_filters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_filters" ADD CONSTRAINT "custom_filters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_automations" ADD CONSTRAINT "conversation_automations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
