-- ---------------------------------------------------------------------------
-- V1.3.1 — one book, taught in two years.
--
-- `grade_9_10_chemistry_experiment` is a single chemistry PRACTICALS book used by both grade 9
-- and grade 10. Its 34 segments carry `grade: "9-10"`, which an INTEGER column with a
-- CHECK (grade BETWEEN 6 AND 12) cannot hold, so all 34 were skipped and the corpus landed at
-- 5,448 of 5,482.
--
-- Operator's decision: visible under BOTH grades, and NOT authored twice.
--
-- WHY A COLUMN AND NOT A SECOND ROW. segment_id is the primary key; niete_lp612_renders carries
-- a foreign key to it; and the R2 cache is keyed (segment_id, lang, template_version). A second
-- row therefore means a second segment_id, a second cache entry, and the same lesson authored
-- and paid for twice — around $0.60 and several minutes each time, for identical output. One row
-- that lists its extra years costs nothing and dedupes by construction rather than by luck.
--
-- Every menu read filters `grade = N OR also_grades @> {N}`. Half this fix — the column without
-- the read — imports the book successfully and still leaves it invisible in grade 10.
--
-- NOT NULL DEFAULT '{}', matching pages_covered and slo_codes: a null array reaching a chunked
-- upsert fails the whole 250-row chunk rather than the one row.
--
-- Anti-sprawl (Rule 15): 1 column, 0 tables, and it is not derivable — which years share a book
-- is a fact about the book.
-- ---------------------------------------------------------------------------

ALTER TABLE niete_lp612_segments
  ADD COLUMN IF NOT EXISTS also_grades INTEGER[] NOT NULL DEFAULT '{}';

-- The menu asks "does any row belong to grade N?" on every screen, so the containment test needs
-- to be indexable rather than a sequential scan over 5,482 rows.
CREATE INDEX IF NOT EXISTS idx_lp612_segments_also_grades
  ON niete_lp612_segments USING GIN (also_grades);

COMMENT ON COLUMN niete_lp612_segments.also_grades IS
  'Additional grades this same segment is taught in (Grade 9-10 shared practicals books). One row, one segment_id, one cached render, listed in several menus. Menu reads must filter grade = N OR also_grades @> {N}.';
