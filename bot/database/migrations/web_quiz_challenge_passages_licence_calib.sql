-- requires: web_quiz_challenge_passages_provenance.sql
-- Migration: the licence, attribution, adaptation, calibration and review columns of the Challenge passage registry.
--
-- NON-DESTRUCTIVE and re-runnable (a second apply changes nothing). Five new columns on challenge_passages (four
-- nullable, one boolean with a default) and the licence CHECK widened by two values. No existing row can fail either
-- the new CHECK or the NOT NULL. Apply BEFORE the registry seed that writes these columns, on every tier. Rollback:
-- web_quiz_challenge_passages_licence_calib_rollback.sql.
--
--   licence          gains partner_instrument (an instrument commissioned and held by the programme's partners, not
--                    publicly released) and public_domain (government works and the like)
--   attribution      the credits line, where the licence asks for one
--   adapted          true when any token differs from the source text (default false)
--   adaptation_note  what changed and why; required when adapted
--   calib            the published difficulty data for this text (published_calibrated rows)
--   review           the pedagogy reviewer's levelling record (reviewer_levelled rows); signed_by / signed_at stay
--                    the signature
--
-- The provenance CHECK (web_quiz_challenge_passages_provenance.sql) is not touched.

BEGIN;

ALTER TABLE public.challenge_passages
  ADD COLUMN IF NOT EXISTS attribution text,
  ADD COLUMN IF NOT EXISTS adapted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adaptation_note text,
  ADD COLUMN IF NOT EXISTS calib jsonb,
  ADD COLUMN IF NOT EXISTS review jsonb;

ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_licence_check,
  ADD CONSTRAINT challenge_passages_licence_check
    CHECK (licence IN ('textbook', 'cc_by', 'cc_by_sa', 'generated', 'published_instrument', 'partner_instrument', 'public_domain'));

COMMENT ON COLUMN public.challenge_passages.attribution IS
  'The credits line the licence asks for (cc_by, cc_by_sa, published_instrument where its terms ask). NULL otherwise.';
COMMENT ON COLUMN public.challenge_passages.adapted IS
  'true when any token differs from the source text (names, places, a word). Default false.';
COMMENT ON COLUMN public.challenge_passages.adaptation_note IS
  'What changed from the source text and why. Required when adapted.';
COMMENT ON COLUMN public.challenge_passages.calib IS
  'Internal. The published difficulty data for this text: {instrument, text_verbatim, grades_targeted, level_label, band_rule, retrieved_at, stats: [{grade, n, mean_wcpm, sd, median, zero_share, firstline_stop_share, comp_mean, comp_n}]}. Required for published_calibrated.';
COMMENT ON COLUMN public.challenge_passages.review IS
  'Internal. The pedagogy reviewer''s levelling record (rubric scores and the approval sentence). Required for reviewer_levelled.';

COMMIT;
