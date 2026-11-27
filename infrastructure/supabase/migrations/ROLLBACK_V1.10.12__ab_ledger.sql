-- Rollback for V1.10.12. Drops the four ledger functions, then the fourteen ledger columns and their index on
-- ab_card_lock, and nothing else: V1.10.7's tables, columns and rows stay. Deploy the code without the ledger step
-- first (or accept that the cron logs "not installed"). The ledger's statuses, calls and winners are lost; the cards
-- in the workspace still hold them.
DROP FUNCTION IF EXISTS public.ab_ledger_past_tests(text, text);
DROP FUNCTION IF EXISTS public.ab_ledger_advance();
DROP FUNCTION IF EXISTS public.ab_ledger_call(text, text, text);
DROP FUNCTION IF EXISTS public.ab_ledger_upsert(jsonb);
DROP INDEX IF EXISTS public.idx_ab_card_lock_status;
ALTER TABLE IF EXISTS public.ab_card_lock
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS winner,
  DROP COLUMN IF EXISTS default_arm,
  DROP COLUMN IF EXISTS switch_key,
  DROP COLUMN IF EXISTS owner,
  DROP COLUMN IF EXISTS feature,
  DROP COLUMN IF EXISTS arm_a,
  DROP COLUMN IF EXISTS arm_b,
  DROP COLUMN IF EXISTS launch_date,
  DROP COLUMN IF EXISTS planned_n,
  DROP COLUMN IF EXISTS current_n,
  DROP COLUMN IF EXISTS call,
  DROP COLUMN IF EXISTS called_at;
COMMENT ON TABLE public.ab_card_lock IS '[Internal] A/B tracker: one row per launched test (frozen card hash, unit kind, measures, dates).';
NOTIFY pgrst, 'reload schema';
