-- Migration legacy datada antes do init. Em DBs novos, as dependencias
-- (AIProviderType, AITriggerType, ai_providers, companies) ainda nao existem aqui.
-- Vira no-op; o conteudo real foi movido para 20260423_ensure_ai_templates_routing_memory.

DO $$ BEGIN
  RAISE NOTICE 'skipped legacy migration 20250620_add_templates_routing_memory';
END $$;
