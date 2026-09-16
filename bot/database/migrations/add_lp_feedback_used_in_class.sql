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

-- bd-b708h widened this to the PDF-only 6-12 lane, so the comment below no longer says
-- "PDF-only means not asked" — that exclusion was the reason the column sat at 0 of 524 lp612
-- rows while grades 1-5 filled a third of theirs.
COMMENT ON COLUMN lp_feedback.used_in_class IS
  'Survey Q2: taught | planned | not_yet. Asked on a thumbs-up in BOTH lanes — the voicenote '
  'bundle (bd-vw0aj) and the PDF-only 6-12 lane (bd-b708h). NULL = she tapped a thumbs-down, or '
  'has not answered yet. The only column separating "an artefact was produced" from "a lesson was '
  'taught", and the only delivery signal the 6-12 lane has at all.';
