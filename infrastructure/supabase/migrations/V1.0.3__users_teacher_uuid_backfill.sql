-- Normalize users.teacher_uuid to always equal the source user's UUID
-- (fde_production.users_user.uuid), regardless of which cohort imported the row.
--
-- Background: `migrate-teacher-training.py` step 8 (now retired) populated
-- `teacher_uuid` with `users_teacherprofile.uuid` — the profile-level identifier.
-- `migrate-users.py` (V1.0.1 era) uses `users_user.uuid` — the user-level
-- identifier — because cross-DB joins from Taleemabad's `users_user` need
-- a stable user-level anchor.
--
-- COALESCE in the migrate-users.py UPSERT preserved step 8's values on
-- re-enriched rows, producing two different UUID semantics in one column:
--   - 270 net-new rows: teacher_uuid = users_user.uuid                (correct)
--   - 4,227 re-enriched: teacher_uuid = users_teacherprofile.uuid     (wrong)
--
-- The JSONB copy at `preferences.taleemabad.uuid` is always the correct
-- users_user.uuid — so this migration backfills the column from that source.
--
-- Effect: all rows whose preferences.taleemabad.uuid disagrees with teacher_uuid
-- are updated to match the JSONB value. Rows without preferences.taleemabad
-- (WhatsApp-direct users, step-8 non-org-1 orphans) are untouched.

UPDATE users
SET teacher_uuid = (preferences->'taleemabad'->>'uuid')::uuid
WHERE preferences ? 'taleemabad'
  AND preferences->'taleemabad'->>'uuid' IS NOT NULL
  AND (
    teacher_uuid IS NULL
    OR teacher_uuid::text != preferences->'taleemabad'->>'uuid'
  );
