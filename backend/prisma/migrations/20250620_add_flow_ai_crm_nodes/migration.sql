-- AlterEnum: Add AI and CRM node types to FlowNodeType
-- Idempotente: só executa se o enum FlowNodeType já existir (criado em 20260116151048_init).
-- Em databases novos, o init já contém todos os valores, então este script vira no-op.

DO $$
DECLARE
  v text;
  vals text[] := ARRAY[
    'LLM','AI_AGENT','KNOWLEDGE_RETRIEVAL','CODE','TEMPLATE',
    'SEND_MESSAGE','UPDATE_CONTACT','ASSIGN_CONVERSATION','ADD_TAG',
    'MOVE_CARD','CREATE_TASK','SEND_NOTIFICATION'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FlowNodeType') THEN
    FOREACH v IN ARRAY vals LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'FlowNodeType' AND e.enumlabel = v
      ) THEN
        EXECUTE format('ALTER TYPE "FlowNodeType" ADD VALUE %L', v);
      END IF;
    END LOOP;
  END IF;
END$$;

