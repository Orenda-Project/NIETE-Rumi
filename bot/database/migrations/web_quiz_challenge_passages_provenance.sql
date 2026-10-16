-- requires: web_quiz_challenge_registry.sql
-- Migration: where each Challenge passage comes from, and the counted pool it admits.
--
-- NON-DESTRUCTIVE and re-runnable (a second apply changes nothing). One new column on challenge_passages with a
-- default, one named CHECK on it, and the licence CHECK widened by one value. No existing row can fail either CHECK.
-- Apply BEFORE the deploy that reads the column, on every tier. Rollback:
-- web_quiz_challenge_passages_provenance_rollback.sql.
--
--   provenance  published_calibrated  a cited published, already-calibrated instrument with its difficulty data
--                                     (source and licence in source_ref / licence)
--               reviewer_levelled     the pedagogy reviewer's level and approval (signed_by / signed_at)
--               generated             everything else (the default): practice and Story Time only
--
-- A passage is drawn for a counted serve (mode 'check') only with provenance published_calibrated or reviewer_levelled,
-- under web_quiz_challenge_sourced_only (parent web_quiz_challenge_pool). Every row already in the table becomes
-- 'generated' through the default. source_ref and licence already exist (web_quiz_challenge_registry.sql); the licence
-- CHECK gains 'published_instrument'.

BEGIN;

ALTER TABLE public.challenge_passages
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'generated';

ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_provenance_check,
  ADD CONSTRAINT challenge_passages_provenance_check
    CHECK (provenance IN ('published_calibrated', 'reviewer_levelled', 'generated'));

ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_licence_check,
  ADD CONSTRAINT challenge_passages_licence_check
    CHECK (licence IN ('textbook', 'cc_by', 'cc_by_sa', 'generated', 'published_instrument'));

COMMENT ON COLUMN public.challenge_passages.provenance IS
  'Internal. published_calibrated | reviewer_levelled | generated (default). Only the first two are drawn for a counted serve.';

COMMIT;
