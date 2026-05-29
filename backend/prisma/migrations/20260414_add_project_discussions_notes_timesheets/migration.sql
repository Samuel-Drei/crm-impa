-- CreateTable
CREATE TABLE "project_discussions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_discussions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_discussion_comments" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_discussion_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_notes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_timesheets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "note" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_discussions_projectId_idx" ON "project_discussions"("projectId");

-- CreateIndex
CREATE INDEX "project_discussion_comments_discussionId_createdAt_idx" ON "project_discussion_comments"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "project_notes_projectId_createdBy_idx" ON "project_notes"("projectId", "createdBy");

-- CreateIndex
CREATE INDEX "project_timesheets_projectId_userId_idx" ON "project_timesheets"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "project_discussions" ADD CONSTRAINT "project_discussions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_discussion_comments" ADD CONSTRAINT "project_discussion_comments_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "project_discussions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_discussion_comments" ADD CONSTRAINT "project_discussion_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "project_discussion_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timesheets" ADD CONSTRAINT "project_timesheets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

