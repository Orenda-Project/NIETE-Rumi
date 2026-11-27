-- Rollback for V1.10.13. Drops ab_ledger_switch, then the three switch columns on ab_card_lock, and nothing else.
-- Deploy the code without the switch step first (or accept that the cron logs "not installed"). A switch already
-- flipped stays in app_settings: to undo one, set that key back by hand (turning a flag off is always allowed).
DROP FUNCTION IF EXISTS public.ab_ledger_switch();
ALTER TABLE IF EXISTS public.ab_card_lock
  DROP COLUMN IF EXISTS switch_state,
  DROP COLUMN IF EXISTS switch_sql,
  DROP COLUMN IF EXISTS switched_at;
NOTIFY pgrst, 'reload schema';
