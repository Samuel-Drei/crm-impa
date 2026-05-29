-- AlterEnum: Adiciona LOOP, PARALLEL, QUESTION_CLASSIFIER ao FlowNodeType (safe for PG 9.6+)
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['LOOP','PARALLEL','QUESTION_CLASSIFIER'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'FlowNodeType' AND e.enumlabel = v
    ) THEN
      EXECUTE format('ALTER TYPE "FlowNodeType" ADD VALUE %L', v);
    END IF;
  END LOOP;
END$$;
