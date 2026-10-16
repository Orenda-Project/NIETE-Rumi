-- requires: web_quiz_challenge_runs_v2.sql (adds audio_consent and its CHECK wqcr_audio_consent_chk; it needs web_quiz_challenge.sql)
-- Migration: the run row's audio_consent admits 'notice_shown' and audio_consent_by admits 'notice_tap' (the mic
-- NOTICE replaces the keep question).
--
-- ADDITIVE and re-runnable. No column is added or changed, no row is rewritten. Two CHECKs are dropped and made
-- again, each with one more value:
--   wqcr_audio_consent_chk  audio_consent IN ('kept_ok', 'kept_no', 'not_asked', 'notice_shown')
--   wqcr_audio_by_chk       audio_consent_by IN ('grownup_tap', 'notice_tap')
-- notice_shown: the run on which the page showed the one-time mic notice (once per child per phone, again only when
-- its wording version changes). Every value the CHECK allowed before is still allowed, so every existing row passes.
-- notice_tap: the child tapped the notice's one control ("Got it"); no grown-up answered anything, so a notice row
-- never says grownup_tap.
-- kept_ok / kept_no stay valid for rows written by the earlier keep question (and a legacy kept_no from an old page).
-- wqcr_keep_needs_ok_chk (a keep date only with kept_ok) is not touched. Written only by code behind
-- web_quiz_challenge_audio_consent (parent web_quiz_challenge_v2).
-- One env = one DB. Apply after web_quiz_challenge_runs_v2.sql; sandbox first, staging and prod only on a go.
-- Rollback: web_quiz_challenge_runs_notice_shown_rollback.sql (runs BEFORE web_quiz_challenge_runs_v2_rollback.sql).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_audio_consent_chk'
                   AND conrelid = 'public.web_quiz_challenge_runs'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%notice_shown%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT IF EXISTS wqcr_audio_consent_chk;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT wqcr_audio_consent_chk
      CHECK (audio_consent IN ('kept_ok', 'kept_no', 'not_asked', 'notice_shown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wqcr_audio_by_chk'
                   AND conrelid = 'public.web_quiz_challenge_runs'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%notice_tap%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT IF EXISTS wqcr_audio_by_chk;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT wqcr_audio_by_chk
      CHECK (audio_consent_by IN ('grownup_tap', 'notice_tap'));
  END IF;
END $$;

COMMENT ON COLUMN public.web_quiz_challenge_runs.audio_consent IS
  'Internal. notice_shown (the mic notice was shown on this run) | not_asked | kept_ok | kept_no (the earlier keep question; kept_no is never kept). NULL with web_quiz_challenge_audio_consent off.';

COMMENT ON COLUMN public.web_quiz_challenge_runs.audio_consent_by IS
  'Internal. notice_tap (the child tapped the mic notice''s one control) | grownup_tap (the earlier keep question).';

COMMIT;
