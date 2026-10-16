-- V1.6.10 — users.grades_taught: VARCHAR(100) → VARCHAR(255) (bd-x7aprz.2).
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
-- Follows V1.6.9 (main/staging). Rollback: ROLLBACK_V1.6.10__users_grades_taught_widen.sql
--
-- WHY. On 2026-09-30 06:30Z a coach's registration failed with "value too long for type character
-- varying(100)" (niete-logs, correlation corr-1790749797069-82uujno3g): she ticked every grade, and
-- the registration form stores its grades CheckboxGroup as JSON text. All twelve grade ids, quoted
-- and bracketed, are 135 characters. Both the per-screen write and the terminal write died, and she
-- was told to start again.
--
-- MEASURED BEFORE WRITING (read-only, 2026-10-16): character_maximum_length = 100 on production
-- (ihzciabopbttygxxgrkm) and sandbox (olvritwoqujtjvwfulbh); the longest stored value on production
-- is 81; NO view or materialized view depends on the column (pg_depend over public.users), so —
-- unlike V1.4.9's phone_number — nothing has to be dropped and rebuilt around the ALTER.
--
-- WHY WIDEN, NOT A SHORTER FORMAT. The readers (teacher-level.js bandsFromGrades,
-- attendance-setup-endpoint.js) already accept the three shapes production holds; a fourth, compact
-- encoding would be one more for each of them. 255 holds the longest answer the form can give with
-- room for the next grade.
--
-- SAFETY: widening a varchar is a metadata-only change in Postgres — no table rewrite, a brief
-- ACCESS EXCLUSIVE lock, safe on a live table. IDEMPOTENT: re-running is a no-op.

ALTER TABLE users
  ALTER COLUMN grades_taught TYPE VARCHAR(255);

COMMENT ON COLUMN users.grades_taught IS
  'Grades taught, as the registration form stores them: a JSON array of grade ids (["grade_3","grade_4"]); older rows hold a band token (PRIMARY) or a comma string (PRIMARY, MIDDLE). Widened to 255 in V1.6.10.';
