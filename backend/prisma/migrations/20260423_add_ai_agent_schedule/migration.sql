-- AI Agent Schedule (modo de funcionamento por horário)
DO $$ BEGIN
  CREATE TYPE "AIScheduleMode" AS ENUM ('ALWAYS', 'BUSINESS_HOURS', 'OUT_OF_BUSINESS_HOURS', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "scheduleMode" "AIScheduleMode" NOT NULL DEFAULT 'ALWAYS';
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "scheduleTimezone" TEXT DEFAULT 'America/Sao_Paulo';
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "scheduleSlots" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "scheduleOffMessage" TEXT;
