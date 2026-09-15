-- V1.4.8 — record_history watches users.teacher_level again.
--
-- log_row_changes() reads every watched column out of to_jsonb(OLD) and
-- to_jsonb(NEW) BY NAME. A renamed or dropped column is not an error there: it
-- is null on both sides and the trigger silently records nothing for it.
--
-- V1.4.5 renamed users.training_bands to users.teacher_level (and dropped levels
-- and grade); V1.4.4 dropped first_name and last_name. Neither re-created
-- users_history_trigger, which still named all five. Measured on production
-- 15 Sep 2026: in the week before V1.4.5 training_bands appeared ~1,540 times in
-- record_history; in the ten hours after, 446 users history rows were written and
-- none carried a level change, while 17 teachers' levels moved (5 coach edits).
-- Changes made in that gap cannot be reconstructed from here — coach edits are
-- still in leader_roster_audit; a teacher's own selection kept only
-- teacher_level_updated_at.
--
-- This file re-creates the trigger with the allowlist in
-- scripts/row-history-audit.js (WATCHED.users). The two must stay equal —
-- tests/database/record-history-users-trigger.test.js reads both.
--
-- SAFE TO RE-RUN. CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on users for
-- an instant; lock_timeout makes a busy table fail fast instead of queueing
-- writes behind this migration. Retry if it times out.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Refuse to install a trigger that is blind to any of its columns.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY[
      'id','phone_number','name','preferred_language',
      'language_locked','registration_state','registration_completed','role',
      'region','country','organization','school_id','school_name','teacher_uuid',
      'subject','grades_taught','subjects_taught','teacher_level',
      'is_test_user','portal_activated'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'users_history_trigger would watch missing column(s): %', missing;
  END IF;
END $$;

DROP TRIGGER IF EXISTS users_history_trigger ON public.users;
CREATE TRIGGER users_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'phone_number','name','preferred_language',
    'language_locked','registration_state','registration_completed','role',
    'region','country','organization','school_id','school_name','teacher_uuid',
    'subject','grades_taught','subjects_taught','teacher_level',
    'is_test_user','portal_activated');

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (read-only):
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'users_history_trigger';
--   -- after a teacher's level changes:
--   SELECT changed_at, changed_cols FROM record_history
--    WHERE table_name = 'users' AND changed_cols::text LIKE '%teacher_level%'
--    ORDER BY changed_at DESC LIMIT 5;
--
-- ROLLBACK: none worth running. The previous definition watched five columns
-- that no longer exist; restoring it restores the gap. To stop recording users
-- history entirely: DROP TRIGGER users_history_trigger ON public.users;
