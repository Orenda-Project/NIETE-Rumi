-- Rollback of web_quiz_challenge_runs_notice_shown.sql: wqcr_audio_consent_chk back to the three values and
-- wqcr_audio_by_chk back to the one value web_quiz_challenge_runs_v2.sql made them with. No row is touched: the
-- restored CHECKs are NOT VALID, so a run row written meanwhile with 'notice_shown' / 'notice_tap' stays as it is, and
-- only new writes are held to the earlier values.
-- Run BEFORE web_quiz_challenge_runs_v2_rollback.sql.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_audio_consent_chk'
               AND conrelid = 'public.web_quiz_challenge_runs'::regclass
               AND pg_get_constraintdef(oid) LIKE '%notice_shown%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT wqcr_audio_consent_chk;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT wqcr_audio_consent_chk
      CHECK (audio_consent IN ('kept_ok', 'kept_no', 'not_asked')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_audio_by_chk'
               AND conrelid = 'public.web_quiz_challenge_runs'::regclass
               AND pg_get_constraintdef(oid) LIKE '%notice_tap%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT wqcr_audio_by_chk;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT wqcr_audio_by_chk
      CHECK (audio_consent_by IN ('grownup_tap')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.web_quiz_challenge_runs.audio_consent IS NULL;
COMMENT ON COLUMN public.web_quiz_challenge_runs.audio_consent_by IS NULL;

COMMIT;
