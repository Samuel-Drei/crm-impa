-- AlterEnum: add CAROUSEL node type to FlowNodeType.
-- Idempotent so existing databases and fresh databases can run it safely.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FlowNodeType') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'FlowNodeType' AND e.enumlabel = 'CAROUSEL'
    ) THEN
      ALTER TYPE "FlowNodeType" ADD VALUE 'CAROUSEL' AFTER 'BUTTONS';
    END IF;
  END IF;
END$$;
