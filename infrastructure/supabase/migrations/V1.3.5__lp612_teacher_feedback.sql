-- ---------------------------------------------------------------------------
-- V1.3.5 — teacher feedback on a 6-12 lesson, on the table that already holds it.
--
-- A versioned migration: applied in version order by infrastructure/scripts/migrate.js and
-- recorded in `schema_versions`, never run by hand. Additive and idempotent (ADD COLUMN IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS), so re-running it is safe and rolling back means dropping
-- one nullable column that nothing else reads.
--
-- THE ANTI-SPRAWL DECISION (root CLAUDE.md rule 15), stated here because a reader six months from
-- now will otherwise ask why 6-12 feedback is not in its own table.
--
-- `lp_feedback` already stores exactly this shape for the K-5 lane: one row per (teacher, lesson)
-- button tap, a boolean verdict, an optional free-text reason with its own language and polarity,
-- and a snapshot of grade/subject/chapter/topic so a query does not have to join back to a lesson
-- that may since have changed. The 6-12 lane needs no field that table does not have — except the
-- identity of the lesson, because a 6-12 lesson is NOT a `lesson_plans` row. It is a
-- (segment_id, lang, template_version) render in `niete_lp612_renders`.
--
-- What was ruled out, and why:
--
--   • A NEW `lp612_feedback` TABLE. Rejected. It would duplicate eleven columns, two of the four
--     existing indexes, and the entire reason-capture lifecycle, and it would split "how do
--     teachers rate our lesson plans?" into two queries that have to be kept in step by hand. The
--     database is past 76 tables; this is precisely the growth rule 15 exists to stop.
--
--   • REUSING `lesson_plan_id`. Impossible: it is `UUID REFERENCES lesson_plans(id)`, and a 6-12
--     segment id is text (`grade_9_chemistry.c01.p007-008`). It stays NULL on these rows, which is
--     already legal — the column is nullable — and is itself a usable discriminator.
--
--   • STORING THE SEGMENT IN `topic`. Rejected: `topic` is the human subtopic title and is
--     populated for these rows too. Overloading it would make both facts unqueryable.
--
--   • A SECOND COLUMN FOR THE DOCUMENT LANGUAGE. Not needed. `lp_variant` is an existing free-text
--     column whose whole job is naming which variant produced the lesson ('taleemabad_ast',
--     'niete_v8_segment' today), so the 6-12 lane writes 'lp612_en' / 'lp612_ur' into it. That is
--     the lane discriminator AND the language in a column that already means this, at zero schema
--     cost. `WHERE lp_variant LIKE 'lp612%'` selects the lane.
--
-- So: ONE nullable column, no new table, no new index that is not earned.
--
-- The index is partial and covers the only query this lane will run against it — "the 6-12
-- verdicts for one segment, newest first" — and, being partial on a column that is NULL for every
-- K-5 row, it costs nothing for the existing lane.
--
-- ON DELETE SET NULL rather than CASCADE: retiring a segment from the corpus must not silently
-- delete the evidence about how it was received. The verdict and the reason survive; only the
-- pointer goes.
-- ---------------------------------------------------------------------------

ALTER TABLE lp_feedback
  ADD COLUMN IF NOT EXISTS lp612_segment_id TEXT
  REFERENCES niete_lp612_segments(segment_id) ON DELETE SET NULL;

COMMENT ON COLUMN lp_feedback.lp612_segment_id IS
  'The 6-12 lesson this verdict is about (niete_lp612_segments.segment_id). NULL for every K-5 '
  'row, where lesson_plan_id carries the identity instead. Set together with '
  'lp_variant = ''lp612_en'' | ''lp612_ur'', which is the lane + document-language discriminator. '
  'Written by lp612-feedback.service on a survey button tap (V1.3.5).';

CREATE INDEX IF NOT EXISTS idx_lp_feedback_lp612_segment
  ON lp_feedback (lp612_segment_id, created_at DESC)
  WHERE lp612_segment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
