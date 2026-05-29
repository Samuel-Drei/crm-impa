-- CreateTable
CREATE TABLE "conversation_events" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_events_conversationId_createdAt_idx" ON "conversation_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_events_instanceId_remoteJid_createdAt_idx" ON "conversation_events"("instanceId", "remoteJid", "createdAt");

-- AddForeignKey
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;