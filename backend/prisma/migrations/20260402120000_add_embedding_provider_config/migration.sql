-- AlterTable: Adiciona configuração de provider de embedding por knowledge base
-- Permite que cada base escolha seu próprio provider/modelo/apiKey (inspirado no Dify)
ALTER TABLE "ai_knowledge_bases" ADD COLUMN     "embeddingProvider" TEXT NOT NULL DEFAULT 'openai',
ADD COLUMN     "embeddingApiKey" TEXT,
ADD COLUMN     "embeddingBaseUrl" TEXT;
