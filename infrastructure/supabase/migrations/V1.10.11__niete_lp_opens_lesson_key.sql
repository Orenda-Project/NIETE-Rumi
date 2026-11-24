-- V1.10.11 — niete_lp_opens.lesson_key: the stable lesson + skill key of a Reading Hour / Numeracy (FLN) plan open
-- (bd-chz35n.26). Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. Grades 1-2 plans are FLN plans, and an FLN open stores only the plan id (plan_ref). The id names no book,
-- unit, lesson or skill, and the bundle that does (fln/corpus/<ver>/corpus.json, file storage) moves lessons between
-- versions, so the evals could not join a Grades 1-2 plan to the quiz made after it or to a child's tested skill.
-- The portal now writes the key it computes from the bundle when it serves the plan:
--   fln1:<book>:<strand>:u<unit_no>:l<lesson_no>:<skill|none>:p<plan_id>   (bot/shared/services/fln-lesson-key.js)
-- A column, not a table: one short value per FLN open, read with the row (schema-first; no new table).
-- DATA CLASSIFICATION (D6): '[Internal]' — curriculum metadata (book, unit, lesson, skill); no person, no contact.
-- OWNER (D7): NIETE-Rumi platform. Written by dashboard/services/lp-activity.service.js on an FLN open, and for past
-- FLN opens by scripts/backfill-fln-lesson-keys.js (dry run by default).
-- DATA. Existing rows: NULL until the backfill; k5 and g612 rows stay NULL (their plan_ref is already a lesson id).
-- LOAD. No index: readers filter by user/plan as before and read the key with the row.
-- SECURITY. Unchanged (RLS on, service role only, as before).
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.10.11__niete_lp_opens_lesson_key.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp_opens ADD COLUMN IF NOT EXISTS lesson_key TEXT;

COMMENT ON COLUMN niete_lp_opens.lesson_key IS '[Internal] FLN opens only: the plan''s lesson + skill key, fln1:<book>:<strand>:u<unit>:l<lesson>:<skill|none>:p<plan_id>, as served. NULL for k5/g612 and for FLN opens not yet keyed. bd-chz35n.26.';

NOTIFY pgrst, 'reload schema';
