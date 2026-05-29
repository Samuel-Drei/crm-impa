-- Adiciona parâmetros de sampling avançados (paridade com Dify)
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "topP" DOUBLE PRECISION;
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "frequencyPenalty" DOUBLE PRECISION;
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "presencePenalty" DOUBLE PRECISION;
