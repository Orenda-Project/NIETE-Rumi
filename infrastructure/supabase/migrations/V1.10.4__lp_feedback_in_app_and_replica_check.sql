-- V1.10.4 — the lesson-plan survey answered in the teacher app, and a replica check for scheduled counting jobs.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY (a). The "Was this useful?" survey moves from WhatsApp into the teacher app, behind a switch that starts off.
-- Its answers land in the SAME lp_feedback table (no new table, no new column), so every existing reader counts them;
-- trigger_mode tells where it was asked. The list keeps both existing values and gains 'in_app'.
-- WHY (b). A scheduled job counts teachers' activity on the read replica only, never on the primary. supabase-js has no
-- way to ask which server it reached, so db_is_replica() returns pg_is_in_recovery(): true on a replica, false on the
-- primary. The job calls it first and refuses to run on false. SECURITY INVOKER: it reads nothing and needs no rights.
-- DATA CLASSIFICATION (D6): unchanged; trigger_mode is '[Internal]' (where the survey was asked). The function returns
-- no data. OWNER (D7): NIETE-Rumi platform.
-- DATA. Existing rows keep their value (all are in the old two-value list). LOAD. Re-adding the CHECK scans lp_feedback
-- once (small table). SECURITY. EXECUTE on the function for service_role only; RLS on lp_feedback unchanged.
-- IDEMPOTENT. DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE. Rollback:
-- ROLLBACK_V1.10.4__lp_feedback_in_app_and_replica_check.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE lp_feedback DROP CONSTRAINT IF EXISTS lp_feedback_trigger_mode_check;
ALTER TABLE lp_feedback ADD CONSTRAINT lp_feedback_trigger_mode_check
  CHECK (trigger_mode IN ('after_voice_note', 'after_pdf_only', 'in_app'));
COMMENT ON COLUMN lp_feedback.trigger_mode IS
  '[Internal] where the survey was asked: after_voice_note / after_pdf_only (WhatsApp) or in_app (the teacher app)';

CREATE OR REPLACE FUNCTION public.db_is_replica() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER
  AS $$ SELECT pg_is_in_recovery() $$;
COMMENT ON FUNCTION public.db_is_replica() IS
  'true on a read replica (in recovery), false on the primary. Called first by jobs that must only read a replica.';
REVOKE ALL ON FUNCTION public.db_is_replica() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_is_replica() TO service_role;

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lp_feedback_trigger_mode_check';
-- post-flight: SELECT public.db_is_replica();  -- false on the primary, true on the replica
