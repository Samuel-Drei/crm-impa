-- Add OPENAI to CompanyIntegrationType enum (TTS + STT via OpenAI Audio API)
ALTER TYPE "CompanyIntegrationType" ADD VALUE IF NOT EXISTS 'OPENAI';
