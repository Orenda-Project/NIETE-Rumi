-- ROLLBACK V1.9.0 — niete_lp612_segments: restore the 6-12 grade check.
-- Fails (and changes nothing) while any Grade 1-5 segment exists: delete those rows first, deliberately.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_segments DROP CONSTRAINT IF EXISTS niete_lp612_segments_grade_check;
ALTER TABLE niete_lp612_segments
  ADD CONSTRAINT niete_lp612_segments_grade_check CHECK (grade BETWEEN 6 AND 12);

NOTIFY pgrst, 'reload schema';
