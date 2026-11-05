-- V1.9.0 — niete_lp612_segments: the grade check widens from 6-12 to 1-12 (bd-rj6w0n.14.13).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. Gilgit-Baltistan Grade 1-5 NBF books are served through the same segment/render tables as the ICT 6-12
-- books, tagged curriculum = 'nbf_snc' (V1.8.6's column, bd-97daxo.5). The old 6-12 check refuses their rows.
-- ORDER: after V1.8.6. This migration does not touch the curriculum column.
--
-- DATA. No rows change. LOAD. The re-added CHECK validates one scan of the table (~6.6k rows).
-- SECURITY. Unchanged. IDEMPOTENT. The constraint is dropped IF EXISTS, then re-added.
-- Rollback: ROLLBACK_V1.9.0__lp612_segments_grade_1_12.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_segments DROP CONSTRAINT IF EXISTS niete_lp612_segments_grade_check;
ALTER TABLE niete_lp612_segments
  ADD CONSTRAINT niete_lp612_segments_grade_check CHECK (grade BETWEEN 1 AND 12);

NOTIFY pgrst, 'reload schema';
