-- Migration: database locks for the Challenge record rules on web_quiz_challenge_runs.
-- requires: web_quiz_challenge_runs_v2.sql
-- requires: web_quiz_challenge_runs_sampling.sql
-- requires: web_quiz_challenge_registry.sql
--
-- The record ("one record per canonical child × stop × PKT period", per language for read and listen) is decided
-- by a read when the exercise is served and inserted afterwards; two concurrent serves could both insert
-- record = true. These locks make the database refuse the second one, whatever the code does later.
--
-- ADDITIVE and re-runnable. No column is added or changed, no row is rewritten. Every rule passes a row whose record
-- is not true, so rows written before the v2 serve are untouched.
--
--   one record per child, stop and period (partial UNIQUE indexes, WHERE record IS TRUE; the child is
--   coalesce(canonical_id, student_id), the key the serve reads):
--     web_quiz_challenge_runs_one_record_lang_uidx  read, listen: child × exercise × lang × period_id
--     web_quiz_challenge_runs_one_record_stop_uidx  every other stop (bigger, missing, numbers): child × exercise × period_id
--   A duplicate insert raises 23505.
--
--   CHECKs (23514), NULL-safe (six):
--     wqcr_anchor_block_stop_chk       an anchor block only on the stops that carry one (missing: A1/A2, numbers: G1A)
--     wqcr_serves_any_needs_block_chk  anchor_serves_any only with an anchor block
--     wqcr_class_round_arm_chk         a mode='class_round' turn is in the class_round sample arm
--     wqcr_class_round_admin_chk       the class_round arm is administered with the teacher present
--     wqcr_record_provenance_chk       a record row names its form and bank version
--     wqcr_record_key_not_null_chk     a record row carries its whole key: period_id, a child id, and lang for read/listen
--                                      (a NULL in the key would slip past the unique indexes, NULLs being distinct)
--   and wqcr_record_first_exposure_chk (web_quiz_challenge_runs_sampling.sql) is re-made without its
--   "exposure_no IS NULL" escape: a record row is a first exposure (exposure_no = 1) unless it is an anchor block.
--
--   one "on its way" draw log per child × stop × period × UTC hour (challenge_draws, partial UNIQUE index
--   challenge_draws_on_its_way_hour_uidx WHERE outcome = 'on_its_way'): a page retrying an empty pool logs the miss
--   once an hour, not once a tap. The hour is date_trunc('hour', drawn_at AT TIME ZONE 'UTC'): date_trunc on a
--   timestamptz depends on the session time zone (STABLE) and Postgres refuses it in an index. A second row raises
--   23505; served and lower_band draws are never limited.
--
-- If the table already holds two record rows for one key, the index build fails and the whole migration rolls back.
-- Apply after web_quiz_challenge_runs_v2.sql and web_quiz_challenge_runs_sampling.sql. Sandbox first; staging and
-- prod only on a go. Rollback: web_quiz_challenge_runs_record_locks_rollback.sql.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS web_quiz_challenge_runs_one_record_lang_uidx
  ON public.web_quiz_challenge_runs ((coalesce(canonical_id, student_id)), exercise, lang, period_id)
  WHERE record IS TRUE AND exercise IN ('read', 'listen');
CREATE UNIQUE INDEX IF NOT EXISTS web_quiz_challenge_runs_one_record_stop_uidx
  ON public.web_quiz_challenge_runs ((coalesce(canonical_id, student_id)), exercise, period_id)
  WHERE record IS TRUE AND exercise NOT IN ('read', 'listen');
CREATE UNIQUE INDEX IF NOT EXISTS challenge_draws_on_its_way_hour_uidx
  ON public.challenge_draws (canonical_id, stop, period_id, (date_trunc('hour', drawn_at AT TIME ZONE 'UTC')))
  WHERE outcome = 'on_its_way';

DO $$
DECLARE c record;
BEGIN
  -- the first-exposure rule without its NULL escape: dropped only while it still carries it, then added once below
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_record_first_exposure_chk'
               AND conrelid = 'public.web_quiz_challenge_runs'::regclass
               AND pg_get_constraintdef(oid) LIKE '%exposure_no IS NULL%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT wqcr_record_first_exposure_chk;
  END IF;
  FOR c IN SELECT * FROM (VALUES
    ('wqcr_anchor_block_stop_chk',      'anchor_block IS NULL OR exercise IN (''missing'',''numbers'')'),
    ('wqcr_serves_any_needs_block_chk', 'anchor_serves_any IS NULL OR anchor_block IS NOT NULL'),
    ('wqcr_class_round_arm_chk',        'mode IS DISTINCT FROM ''class_round'' OR sample_arm IS NOT DISTINCT FROM ''class_round'''),
    ('wqcr_class_round_admin_chk',      'sample_arm IS DISTINCT FROM ''class_round'' OR admin_mode IS NOT DISTINCT FROM ''teacher_present'''),
    ('wqcr_record_provenance_chk',      'record IS NOT TRUE OR (form IS NOT NULL AND bank_version IS NOT NULL)'),
    ('wqcr_record_key_not_null_chk',    'record IS NOT TRUE OR (period_id IS NOT NULL AND coalesce(canonical_id, student_id) IS NOT NULL AND (exercise NOT IN (''read'',''listen'') OR lang IS NOT NULL))'),
    ('wqcr_record_first_exposure_chk',  'record IS NOT TRUE OR anchor_block IS NOT NULL OR exposure_no IS NOT DISTINCT FROM 1')
  ) AS t(name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = 'public.web_quiz_challenge_runs'::regclass) THEN
      EXECUTE format('ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT %I CHECK (%s)', c.name, c.expr);
    END IF;
  END LOOP;
END $$;

COMMIT;
