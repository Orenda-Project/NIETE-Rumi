-- requires: web_quiz_challenge.sql, web_quiz_challenge_runs_v2.sql
-- Migration: which sample a Challenge run belongs to, how it was administered, and how many times the child had met
-- the anchor items before it in any mode.
--
-- NON-DESTRUCTIVE and re-runnable. Three nullable columns on web_quiz_challenge_runs, no default, no existing row
-- rewritten. Written only at serve time by code behind the content engine's switch.
--
--   sample_arm         NULL = the child chose to play (no sample); class_round | class_week | coach | ping = the run
--                      belongs to that drawn sample. Set by the server from the draw, never by the page.
--   admin_mode         self_run | teacher_present | coach_present. A sampled run must say how it was administered.
--   anchor_serves_any  every serve of the anchor items to this child in ANY mode (check, practice, class round),
--                      counting this one; a home "first time" line requires 1.
--
-- A run's sample and its administration are never inferred later. Apply to sandbox first; staging and prod only on a go.
--
-- Two record rules as CHECKs on the runs v2 columns (apply web_quiz_challenge_runs_v2.sql first). NULL record passes,
-- so every row written before the v2 serve is untouched:
--   wqcr_record_is_check_chk        a record row is a check row (never practice, a class round or a row with no mode)
--   wqcr_record_first_exposure_chk  a record row is the child's first exposure of its passage or item set; the anchor
--                                   block is exempt (its retest is counted apart)

BEGIN;

ALTER TABLE public.web_quiz_challenge_runs
  ADD COLUMN IF NOT EXISTS sample_arm        text,
  ADD COLUMN IF NOT EXISTS admin_mode        text,
  ADD COLUMN IF NOT EXISTS anchor_serves_any smallint;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('wqcr_sample_arm_chk',      'sample_arm IN (''class_round'',''class_week'',''coach'',''ping'')'),
    ('wqcr_admin_mode_chk',      'admin_mode IN (''self_run'',''teacher_present'',''coach_present'')'),
    ('wqcr_arm_needs_admin_chk', 'sample_arm IS NULL OR admin_mode IS NOT NULL'),
    ('wqcr_serves_any_chk',      'anchor_serves_any >= 1'),
    ('wqcr_record_is_check_chk', 'record IS NOT TRUE OR mode IS NOT DISTINCT FROM ''check'''),
    ('wqcr_record_first_exposure_chk', 'record IS NOT TRUE OR anchor_block IS NOT NULL OR exposure_no IS NULL OR exposure_no = 1')
  ) AS t(name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = 'public.web_quiz_challenge_runs'::regclass) THEN
      EXECUTE format('ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT %I CHECK (%s)', c.name, c.expr);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.web_quiz_challenge_runs.sample_arm IS
  'Internal. NULL = self-chosen play; else the drawn sample the run belongs to. Arms are separate lines, never pooled.';
COMMENT ON COLUMN public.web_quiz_challenge_runs.anchor_serves_any IS
  'Internal. Serves of the anchor items to this child in any mode, this one included; a home first-time line requires 1.';

COMMIT;
