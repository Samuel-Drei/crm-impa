-- Daily Brain: hora configurável + override de embedding (provider/model)
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "dailyBrainHour" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "dailyBrainEmbeddingProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "dailyBrainEmbeddingModel" TEXT;
