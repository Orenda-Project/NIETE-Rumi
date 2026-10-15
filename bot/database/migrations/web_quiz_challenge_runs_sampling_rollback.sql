-- Rollback of web_quiz_challenge_runs_sampling.sql: drops the three columns and their CHECKs.
BEGIN;
ALTER TABLE public.web_quiz_challenge_runs
  DROP CONSTRAINT IF EXISTS wqcr_sample_arm_chk,
  DROP CONSTRAINT IF EXISTS wqcr_admin_mode_chk,
  DROP CONSTRAINT IF EXISTS wqcr_arm_needs_admin_chk,
  DROP CONSTRAINT IF EXISTS wqcr_serves_any_chk,
  DROP COLUMN IF EXISTS sample_arm,
  DROP COLUMN IF EXISTS admin_mode,
  DROP COLUMN IF EXISTS anchor_serves_any;
COMMIT;
