-- Onda 2.4: sub-operações (spawn_subagent)
-- Adiciona rastreamento de profundidade e hierarquia nas FleetOperations

ALTER TABLE "fleet_operations"
  ADD COLUMN "parentOperationId" TEXT,
  ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "fleet_operations"
  ADD CONSTRAINT "fleet_operations_parentOperationId_fkey"
  FOREIGN KEY ("parentOperationId") REFERENCES "fleet_operations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "fleet_operations_parentOperationId_idx" ON "fleet_operations"("parentOperationId");
