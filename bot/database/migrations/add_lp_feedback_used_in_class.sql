-- bd-vw0aj — ICT voicenote survey Q2: what the teacher DID with the bundle.
--
-- Rawalpindi's survey asked which artefact she PREFERRED (lp_feedback.useful_component,
-- CHECK IN ('lp_only','voicenote_only','both')). ICT deliberately does not ask that — ranking our
-- own artefacts says nothing about whether the lesson happened. We ask what she did instead.
--
-- Deliberately a NEW column rather than reusing `useful_component`: that column's CHECK constraint
-- holds preference values, so writing usage values into it would fail the constraint outright and,
-- worse, would conflate two different questions in any shared analytics.
--
-- Safe to re-run.

ALTER TABLE lp_feedback
  ADD COLUMN IF NOT EXISTS used_in_class TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lp_feedback_used_in_class_chk'
  ) THEN
    ALTER TABLE lp_feedback
      ADD CONSTRAINT lp_feedback_used_in_class_chk
      CHECK (used_in_class IS NULL OR used_in_class IN ('taught', 'planned', 'not_yet'));
  END IF;
END $$;

COMMENT ON COLUMN lp_feedback.used_in_class IS
  'ICT voicenote survey Q2 (bd-vw0aj). taught | planned | not_yet. '
  'NULL = not asked (PDF-only delivery, or she tapped a thumbs-down) or not yet answered.';
