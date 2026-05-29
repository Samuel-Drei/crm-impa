-- Ensure FlowNodeType has all AI/CRM values (idempotent).
-- Em DBs novos, a migração 20250620_add_flow_ai_crm_nodes virou no-op (porque rodava
-- antes da criação do tipo em 20260330232731). Esta migração roda DEPOIS e garante
-- que todos os valores existam, em qualquer DB (novo ou antigo).

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
