-- Adiciona companyId em audit_logs (faltou na init e em add_fleet)
-- Idempotente — pode rodar em DBs já migrados parcialmente

-- 1) Cria coluna como nullable primeiro pra permitir backfill
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- 2) Backfill: tenta inferir companyId via userId (User.companyId)
UPDATE "audit_logs" al
SET "companyId" = u."companyId"
FROM "users" u
WHERE al."userId" = u."id" AND al."companyId" IS NULL;

-- 3) Para os que sobraram (sem userId), usa a primeira company existente como fallback
UPDATE "audit_logs"
SET "companyId" = (SELECT "id" FROM "companies" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "companyId" IS NULL;

-- 4) Apaga linhas remanescentes sem companyId (só se ainda não houver nenhuma company)
DELETE FROM "audit_logs" WHERE "companyId" IS NULL;

-- 5) Torna NOT NULL
ALTER TABLE "audit_logs" ALTER COLUMN "companyId" SET NOT NULL;

-- 6) FK para companies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_companyId_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- 7) Índices alinhados com o schema.prisma
CREATE INDEX IF NOT EXISTS "audit_logs_companyId_createdAt_idx"
  ON "audit_logs" ("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "audit_logs_companyId_entity_action_idx"
  ON "audit_logs" ("companyId", "entity", "action");

CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx"
  ON "audit_logs" ("userId");
