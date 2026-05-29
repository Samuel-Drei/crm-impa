-- Onboarding conversacional do FleetMember (estilo Hermes/OpenClaw)
ALTER TABLE "fleet_members"
  ADD COLUMN IF NOT EXISTS "onboarded" BOOLEAN NOT NULL DEFAULT false;

-- Membros já criados antes desta migration são considerados onboardados
-- (evita que membros existentes entrem em loop de configuração)
UPDATE "fleet_members" SET "onboarded" = true WHERE "createdAt" < NOW();
