-- Rollback of web_quiz_challenge_runs_record_locks.sql: drops the two record indexes and the five CHECKs, and puts
-- wqcr_record_first_exposure_chk back as web_quiz_challenge_runs_sampling.sql made it. No row is touched.
BEGIN;

DROP INDEX IF EXISTS public.web_quiz_challenge_runs_one_record_lang_uidx;
DROP INDEX IF EXISTS public.web_quiz_challenge_runs_one_record_stop_uidx;

ALTER TABLE public.web_quiz_challenge_runs
  DROP CONSTRAINT IF EXISTS wqcr_anchor_block_stop_chk,
  DROP CONSTRAINT IF EXISTS wqcr_serves_any_needs_block_chk,
  DROP CONSTRAINT IF EXISTS wqcr_class_round_arm_chk,
  DROP CONSTRAINT IF EXISTS wqcr_class_round_admin_chk,
  DROP CONSTRAINT IF EXISTS wqcr_record_provenance_chk;

-- the sampling migration's definition, restored only where this migration replaced it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_record_first_exposure_chk'
               AND conrelid = 'public.web_quiz_challenge_runs'::regclass
               AND pg_get_constraintdef(oid) NOT LIKE '%exposure_no IS NULL%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT wqcr_record_first_exposure_chk;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT wqcr_record_first_exposure_chk
      CHECK (record IS NOT TRUE OR anchor_block IS NOT NULL OR exposure_no IS NULL OR exposure_no = 1);
  END IF;
END $$;

COMMIT;
