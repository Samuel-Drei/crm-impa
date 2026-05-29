-- CreateTable: FleetMemoryEntry (memória de longo prazo do FleetMember)
CREATE TABLE "fleet_memory_entries" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'member',
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "fleet_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fleet_memory_entries_memberId_scope_key_key" ON "fleet_memory_entries"("memberId", "scope", "key");
CREATE INDEX "fleet_memory_entries_memberId_scope_idx" ON "fleet_memory_entries"("memberId", "scope");
CREATE INDEX "fleet_memory_entries_expiresAt_idx" ON "fleet_memory_entries"("expiresAt");

-- AddForeignKey
ALTER TABLE "fleet_memory_entries" ADD CONSTRAINT "fleet_memory_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "fleet_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
