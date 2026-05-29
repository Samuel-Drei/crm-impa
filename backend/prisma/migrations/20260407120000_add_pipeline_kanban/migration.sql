-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CardPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('STAGE_CHANGED', 'ASSIGNED', 'NOTE_ADDED', 'TASK_COMPLETED', 'FILE_UPLOADED', 'VALUE_CHANGED', 'FIELD_CHANGED', 'CONTACT_LINKED', 'STATUS_CHANGED', 'CARD_CREATED', 'CUSTOM');

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'sales',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "rottingDays" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_cards" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "assigneeId" TEXT,
    "teamId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "priority" "CardPriority" NOT NULL DEFAULT 'NONE',
    "status" "CardStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT,
    "expectedCloseDate" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "customFields" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card_activities" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "content" TEXT,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "actorName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_card_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card_tasks" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "CardPriority" NOT NULL DEFAULT 'NONE',
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_card_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card_notes" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_card_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card_files" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_card_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card_tags" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "pipeline_card_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipelines_companyId_isActive_idx" ON "pipelines"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipelineId_slug_key" ON "pipeline_stages"("pipelineId", "slug");
CREATE INDEX "pipeline_stages_pipelineId_position_idx" ON "pipeline_stages"("pipelineId", "position");

-- CreateIndex
CREATE INDEX "pipeline_cards_pipelineId_stageId_position_idx" ON "pipeline_cards"("pipelineId", "stageId", "position");
CREATE INDEX "pipeline_cards_companyId_status_idx" ON "pipeline_cards"("companyId", "status");
CREATE INDEX "pipeline_cards_contactId_idx" ON "pipeline_cards"("contactId");
CREATE INDEX "pipeline_cards_assigneeId_idx" ON "pipeline_cards"("assigneeId");

-- CreateIndex
CREATE INDEX "pipeline_card_activities_cardId_createdAt_idx" ON "pipeline_card_activities"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "pipeline_card_tasks_cardId_isCompleted_idx" ON "pipeline_card_tasks"("cardId", "isCompleted");

-- CreateIndex
CREATE INDEX "pipeline_card_notes_cardId_createdAt_idx" ON "pipeline_card_notes"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "pipeline_card_files_cardId_idx" ON "pipeline_card_files"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_card_tags_cardId_labelId_key" ON "pipeline_card_tags"("cardId", "labelId");

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card_activities" ADD CONSTRAINT "pipeline_card_activities_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card_tasks" ADD CONSTRAINT "pipeline_card_tasks_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_card_tasks" ADD CONSTRAINT "pipeline_card_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card_notes" ADD CONSTRAINT "pipeline_card_notes_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_card_notes" ADD CONSTRAINT "pipeline_card_notes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card_files" ADD CONSTRAINT "pipeline_card_files_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_card_files" ADD CONSTRAINT "pipeline_card_files_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card_tags" ADD CONSTRAINT "pipeline_card_tags_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_card_tags" ADD CONSTRAINT "pipeline_card_tags_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
