-- V1.4.1 — class_enrollments.outcome learns to say "this enrolment was wrong".
--
-- WHY. The vocabulary opened in V1.1.3 with five values — 'promoted', 'retained',
-- 'transferred', 'left', 'completed'. Every one of them asserts something that
-- happened to the CHILD. None of them covers what a removal on `/class` or
-- `/roster` actually is: a person looked at the roster and said this enrolment
-- should not be there. The register scanner picks up a stray line (the "1" in
-- Mubashar Zia's 4 Sep report), a coach strikes a child off a class she was never
-- in, a teacher corrects a mis-typed name into a second child.
--
-- `ClassService.removeStudent()` defaulted to 'left', so on 2026-09-08 NIETE prod
-- held 865 closed enrolments claiming a child left — every one of them written by
-- a surface that never asked why. 'left' is the value attrition analysis reads, so
-- the corruption lands exactly where it does the most damage. The other 631 closed
-- enrolments (roster_apply_edits) stamped nothing at all, which is not wrong but
-- is not a record either.
--
-- ONE value, deliberately, not two. It is tempting to separate "she was never in
-- this class" (a scan error) from "a person took her off". Neither writer can tell
-- them apart: no surface asks for a reason, and the same `/roster` edit screen is
-- how a coach both deletes a scanner's phantom AND removes a child who really has
-- gone. A value the writer cannot choose truthfully is a value that will be
-- mis-stamped — which is the bug being fixed here, not a new feature. So the value
-- says the one thing that is certainly true: a person corrected this roster, and
-- the reason was not recorded. WHO corrected it and in which run is already held by
-- `row_history` and `roster_apply_edits(p_edited_by, p_run_id)` — encoding
-- provenance in the vocabulary as well would be a second copy of an answer we have.
--
-- A caller that DOES know keeps its voice: `removeStudent({ outcome })` still takes
-- an explicit value, so a future promotion or genuine-leaver flow passes its own.
--
-- SCOPE. A CHECK widening. No new table, no new column: `outcome` is already the
-- column for this fact, and none of the five existing values can hold it.
--
-- THE 865 EXISTING ROWS ARE NOT TOUCHED HERE. Re-stamping history is the operator's
-- call, not a migration's — see the PR for the exact statement and its evidence.
--
-- LOCK. The ADD is `NOT VALID`, so the ACCESS EXCLUSIVE lock covers a catalogue
-- write only — no table scan under it. The scan happens in the separate VALIDATE,
-- which takes SHARE UPDATE EXCLUSIVE and blocks neither readers nor writers. On
-- prod at 2026-09-08 the table is 17,074 rows / 1,960 kB heap, so the scan is a
-- couple of milliseconds; the widened set is a strict superset of the old one, so
-- no existing row can fail it.

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.class_enrollments'::regclass
    AND conname = 'class_enrollments_outcome_check';

  IF v_def IS NOT NULL AND v_def LIKE '%roster_correction%' THEN
    RAISE NOTICE 'class_enrollments_outcome_check already allows roster_correction — nothing to do';
    RETURN;
  END IF;

  -- Never wait behind a long transaction with ACCESS EXCLUSIVE queued: fail fast
  -- and be re-run, rather than stalling every writer that piles up behind us.
  PERFORM set_config('lock_timeout', '5s', true);

  ALTER TABLE public.class_enrollments
    DROP CONSTRAINT IF EXISTS class_enrollments_outcome_check;

  ALTER TABLE public.class_enrollments
    ADD CONSTRAINT class_enrollments_outcome_check
    CHECK (outcome IN ('promoted', 'retained', 'transferred',
                       'left', 'completed', 'roster_correction'))
    NOT VALID;
END $$;

-- Separate statement on purpose — this is the half that scans, and it must not sit
-- inside the transaction that holds ACCESS EXCLUSIVE.
ALTER TABLE public.class_enrollments
  VALIDATE CONSTRAINT class_enrollments_outcome_check;

COMMENT ON COLUMN public.class_enrollments.outcome IS
  'Why the enrolment closed. promoted/retained/transferred/left/completed are '
  'events in the child''s schooling. roster_correction is an event in the RECORD: '
  'a person took her off this roster and no reason was asked for — a scanner '
  'phantom, a wrong class, a mis-read register line. Never read it as attrition.';

NOTIFY pgrst, 'reload schema';

-- DOWN
--
-- Not a bare inverse: any row holding the new value would fail the narrow CHECK, so
-- the value has to go somewhere first. NULL, not 'left' — 'left' is the false claim
-- this migration exists to stop making.
--
--   UPDATE public.class_enrollments SET outcome = NULL WHERE outcome = 'roster_correction';
--   ALTER TABLE public.class_enrollments
--     DROP CONSTRAINT IF EXISTS class_enrollments_outcome_check;
--   ALTER TABLE public.class_enrollments
--     ADD CONSTRAINT class_enrollments_outcome_check
--     CHECK (outcome IN ('promoted', 'retained', 'transferred', 'left', 'completed'));
--   NOTIFY pgrst, 'reload schema';
