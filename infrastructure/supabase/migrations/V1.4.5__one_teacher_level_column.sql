-- One teacher level: `users.teacher_level` is the only place a teacher's band lives.
--
-- WHY
--   Four columns on `users` claimed to answer "what does this teacher teach?":
--
--     column          populated  format                    writer
--     --------------  ---------  ------------------------  ------------------------
--     training_bands      8,958  varchar[] {PRIMARY}       applyBandSelection (1)
--     grades_taught       4,635  text  "PRIMARY, MIDDLE"   registration Flow
--     levels              8,708  varchar[] {PRIMARY}       NOBODY
--     grade                   1  text                      NOBODY
--
--   Measured on production 2026-09-14 across 15,071 users. They do not agree:
--   233 teachers carry contradictory values — e.g. `levels: [PRIMARY]` beside
--   `training_bands: [HIGH, MIDDLE]`, which share no band at all. Any consumer
--   picking a different column got a different answer for the same teacher, and
--   `patch-resolver.bandOf()` read TWO of them with a fallback, returning only
--   the FIRST band, so a MIDDLE+HIGH teacher silently became MIDDLE.
--
--   `training_bands` wins on the merits and is renamed to `teacher_level`:
--   most populated, the only one with a disciplined single writer, and the only
--   one wired to teacher_training_assignments.
--
-- WHAT IS DELETED, AND WHY IT IS SAFE
--   · users.levels — 8,708 rows and NOT ONE reader or writer in bot/,
--     dashboard/ or portal/. Every `levels` hit in the codebase is
--     training_levels, grade_levels, or a local variable. Dead data that
--     disagreed with the live column, which is the worst kind.
--   · users.grade — 1 populated row. Dead.
--
-- WHAT SURVIVES, AND WHY (operator decision, 2026-09-14)
--   `grades_taught` is NOT deleted. It is not a duplicate of the band column —
--   it holds a FINER vocabulary (grade_1..grade_10, early_years,
--   higher_secondary) that three bands cannot express, and
--   attendance-setup-endpoint.js reads it to float a teacher's own grades to the
--   top of the class dropdown. Collapsing it to PRIMARY would make every primary
--   teacher see the same generic list. It keeps its original job — the record of
--   what the teacher said at signup — and stops being consulted for BAND, which
--   is now teacher_level's sole responsibility.
--
-- THE 48-HOUR COOLDOWN IS UNCHANGED. `training_bands_updated_at` is renamed to
-- `teacher_level_updated_at` and keeps its values, so an in-flight cooldown
-- survives this migration rather than resetting. A rename preserves data; a
-- drop-and-add would silently hand every teacher a fresh change window.
--
-- TYPE NOTE: teacher_level is varchar[] (NOT jsonb) on prod, staging AND
-- sandbox — verified against information_schema on all three. An earlier draft
-- of this migration used jsonb_array_length/to_jsonb and failed on sandbox with
-- 42883; running it there before production is what caught it.
--
-- IDEMPOTENT: every step is guarded on the current shape, so a re-run is a no-op
-- rather than an error.

BEGIN;

-- ------------------------------------------------- 1. rename, keeping values
-- ALTER ... RENAME preserves the data AND the cooldown timestamps. Guarded so a
-- second run does not fail on an already-renamed column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='users' AND column_name='training_bands')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='users' AND column_name='teacher_level') THEN
    ALTER TABLE users RENAME COLUMN training_bands TO teacher_level;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='users' AND column_name='training_bands_updated_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='users' AND column_name='teacher_level_updated_at') THEN
    ALTER TABLE users RENAME COLUMN training_bands_updated_at TO teacher_level_updated_at;
  END IF;
END $$;

COMMENT ON COLUMN users.teacher_level IS
  'The ONLY source of a teacher''s band (PRIMARY/MIDDLE/HIGH). Written solely by '
  'applyBandSelection(), which reconciles teacher_training_assignments and '
  'enforces a 48h cooldown via teacher_level_updated_at. Read it through '
  'teacherLevelOf() — never a second column, never a fallback.';

COMMENT ON COLUMN users.grades_taught IS
  'What the teacher said at SIGNUP, in grade granularity (grade_1..grade_10, '
  'early_years, higher_secondary). Consumed by attendance setup to order the '
  'class dropdown. NOT a source of band — that is teacher_level.';

-- ------------------------------------------- 2. backfill from signup answers
-- 142 users have no teacher_level but a derivable grades_taught. Derived only
-- where the band column is EMPTY: an existing teacher_level is the teacher's own
-- explicit statement and outranks a signup inference, permanently (the same
-- product rule SELF_SELECT_TAG protects in the backfill script).
WITH derived AS (
  SELECT u.id,
         (ARRAY(
           SELECT DISTINCT b FROM (
             SELECT CASE
               WHEN lower(tok) IN ('early_years','grade_1','grade_2','grade_3','grade_4','grade_5') THEN 'PRIMARY'
               WHEN lower(tok) IN ('grade_6','grade_7','grade_8')                                   THEN 'MIDDLE'
               WHEN lower(tok) IN ('grade_9','grade_10','higher_secondary')                         THEN 'HIGH'
               WHEN upper(tok) IN ('PRIMARY','MIDDLE','HIGH')                                       THEN upper(tok)
             END AS b
             FROM unnest(string_to_array(
                    regexp_replace(u.grades_taught::text, '[\[\]"]', '', 'g'), ',')) AS tok
           ) z WHERE b IS NOT NULL
         ))::varchar[] AS bands
    FROM users u
   WHERE (u.teacher_level IS NULL OR cardinality(u.teacher_level) = 0)
     AND coalesce(btrim(u.grades_taught::text), '') <> ''
)
UPDATE users u
   SET teacher_level = d.bands
  FROM derived d
 WHERE u.id = d.id
   AND cardinality(d.bands) > 0;

-- --------------------------------------------------- 3. drop the dead columns
-- mv_users_activity does not select either of these (checked against the live
-- definition), so no view has to be rebuilt here — unlike V1.4.4, where it did.
ALTER TABLE users DROP COLUMN IF EXISTS levels;
ALTER TABLE users DROP COLUMN IF EXISTS grade;

-- ------------------------------------------------------------ 4. prove it took
DO $$
DECLARE leftover INT; still_there INT;
BEGIN
  SELECT count(*) INTO still_there FROM information_schema.columns
   WHERE table_schema='public' AND table_name='users'
     AND column_name IN ('levels','grade','training_bands','training_bands_updated_at');
  IF still_there > 0 THEN
    RAISE EXCEPTION '% legacy level column(s) survived the migration', still_there;
  END IF;

  SELECT count(*) INTO leftover FROM users
   WHERE (teacher_level IS NULL OR cardinality(teacher_level) = 0)
     AND coalesce(btrim(grades_taught::text), '') <> '';
  RAISE NOTICE '% user(s) still have no teacher_level despite a grades_taught value', leftover;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- ROLLBACK (structure only — see the caveat):
--   ALTER TABLE users RENAME COLUMN teacher_level TO training_bands;
--   ALTER TABLE users RENAME COLUMN teacher_level_updated_at TO training_bands_updated_at;
--   ALTER TABLE users ADD COLUMN levels varchar[];
--   ALTER TABLE users ADD COLUMN grade  integer;
--
-- The renames are lossless both ways. The two dropped columns are NOT: their
-- CONTENTS are discarded by DROP COLUMN and cannot be restored from this file.
-- That is acceptable only because nothing read them — but capture them first if
-- you want the option (the bd-60095 run saved all four columns to disk before
-- applying this).
