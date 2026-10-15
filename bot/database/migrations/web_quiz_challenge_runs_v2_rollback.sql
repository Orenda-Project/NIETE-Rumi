-- Rollback of web_quiz_challenge_runs_v2.sql. Refuses while any 'served' or 'abandoned' row exists (the original
-- status CHECK could not be restored over them, and they are never rewritten): switch web_quiz_challenge_v2 off and
-- decide what to do with those rows first. Drops the provenance columns, their CHECKs and indexes, and the two tables.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.web_quiz_challenge_runs WHERE status IN ('served', 'abandoned')) THEN
    RAISE EXCEPTION 'web_quiz_challenge_runs has served/abandoned rows; not rolling back';
  END IF;
END $$;

DROP INDEX IF EXISTS public.web_quiz_challenge_runs_record_idx;
DROP INDEX IF EXISTS public.web_quiz_challenge_runs_sweep_idx;

ALTER TABLE public.web_quiz_challenge_runs
  DROP CONSTRAINT IF EXISTS wqcr_form_chk,
  DROP CONSTRAINT IF EXISTS wqcr_mode_chk,
  DROP CONSTRAINT IF EXISTS wqcr_period_chk,
  DROP CONSTRAINT IF EXISTS wqcr_exposure_chk,
  DROP CONSTRAINT IF EXISTS wqcr_band_chk,
  DROP CONSTRAINT IF EXISTS wqcr_anchor_exp_chk,
  DROP CONSTRAINT IF EXISTS wqcr_anchor_block_chk,
  DROP CONSTRAINT IF EXISTS wqcr_id_conf_chk,
  DROP CONSTRAINT IF EXISTS wqcr_helped_chk,
  DROP CONSTRAINT IF EXISTS wqcr_audio_consent_chk,
  DROP CONSTRAINT IF EXISTS wqcr_audio_by_chk,
  DROP CONSTRAINT IF EXISTS wqcr_keep_needs_ok_chk,
  DROP CONSTRAINT IF EXISTS wqcr_status_v2_chk,
  DROP CONSTRAINT IF EXISTS web_quiz_challenge_runs_status_check;

ALTER TABLE public.web_quiz_challenge_runs
  ADD CONSTRAINT web_quiz_challenge_runs_status_check CHECK (status IN ('scoring', 'scored', 'failed'));

ALTER TABLE public.web_quiz_challenge_runs
  DROP COLUMN IF EXISTS bank_version,
  DROP COLUMN IF EXISTS "set",
  DROP COLUMN IF EXISTS form,
  DROP COLUMN IF EXISTS passage_id,
  DROP COLUMN IF EXISTS item_set_id,
  DROP COLUMN IF EXISTS mode,
  DROP COLUMN IF EXISTS period_id,
  DROP COLUMN IF EXISTS exposure_no,
  DROP COLUMN IF EXISTS band,
  DROP COLUMN IF EXISTS anchor_exposure_no,
  DROP COLUMN IF EXISTS anchor_block,
  DROP COLUMN IF EXISTS homonym_in_list,
  DROP COLUMN IF EXISTS draw_seed,
  DROP COLUMN IF EXISTS canonical_id,
  DROP COLUMN IF EXISTS id_src,
  DROP COLUMN IF EXISTS id_confidence,
  DROP COLUMN IF EXISTS via,
  DROP COLUMN IF EXISTS share_code_id,
  DROP COLUMN IF EXISTS class_id,
  DROP COLUMN IF EXISTS helped,
  DROP COLUMN IF EXISTS record,
  DROP COLUMN IF EXISTS scorer_v,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS audio_consent,
  DROP COLUMN IF EXISTS audio_consent_at,
  DROP COLUMN IF EXISTS audio_consent_by,
  DROP COLUMN IF EXISTS audio_keep_until;

DROP TABLE IF EXISTS public.web_quiz_strip_weekly;
DROP TABLE IF EXISTS public.child_rungs;

COMMIT;
