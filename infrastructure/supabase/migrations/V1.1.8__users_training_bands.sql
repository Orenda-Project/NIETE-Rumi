-- V1.1.8 — users.training_bands: the teacher's OWN statement of which grade
-- bands they teach, used ONLY to scope teacher training.
--
-- WHY A NEW COLUMN INSTEAD OF RENAMING users.levels
-- `levels` is read by two role-backfill heuristics that treat a non-empty value
-- as evidence that a contact is a real teacher (school-migration.transform.js,
-- migrate-schools.py). Once teachers self-select, that meaning breaks: a
-- self-declared training band is not proof of teacherhood, and following the
-- rename there would inflate the teacher count. Renaming in place would also
-- make the code deploy and the schema change non-atomic on a live 8.7k-user
-- table.
--
-- So this is ADDITIVE and no-downtime (product decision): `levels` stays
-- exactly where it is, every prior migration keeps working untouched, and
-- training is re-plugged onto `training_bands`. `levels` can be dropped later
-- once nothing reads it — not in this change.
--
-- ISOLATION — READ THIS BEFORE ADDING A READER
-- This column is scoped to teacher training and nothing else. It must NOT gate
-- which lesson plans a teacher sees, nor any other feature. A teacher choosing
-- "Middle" to reach the Beacon House training must not thereby change their
-- lesson-plan content. If you need a band signal for another feature, derive it
-- from that feature's own data — do not read this column.

ALTER TABLE users ADD COLUMN IF NOT EXISTS training_bands VARCHAR(16)[];

COMMENT ON COLUMN users.training_bands IS
  'Teacher-selected grade bands (PRIMARY/MIDDLE/HIGH) for TEACHER TRAINING SCOPING ONLY. '
  'Chosen by the teacher on the bot or portal, not inferred. Maps to training_programs '
  'via scripts/lib/training-band-derivation.js. MUST NOT gate lesson plans or any other '
  'feature — see V1.1.8 migration header. Supersedes users.levels for training; levels is '
  'retained for the role-backfill heuristics and legacy migrations.';

-- Seed from the existing import so already-scoped teachers keep their access
-- with no re-prompt. Only fills NULLs: never overwrites a teacher's own choice.
UPDATE users
   SET training_bands = levels
 WHERE training_bands IS NULL
   AND levels IS NOT NULL
   AND array_length(levels, 1) > 0;

-- When the teacher last changed their bands. Drives the 48-hour cooldown
-- (product decision): after a change they cannot change again for 48h, and
-- a second attempt inside the window is told to contact NIETE Support.
-- NULL = never self-selected (so the picker is a first-time choice, not a
-- change, and is never blocked). Deliberately NOT set by the seed above:
-- an imported band was never a teacher's own edit and must not start them in
-- a cooldown.
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_bands_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN users.training_bands_updated_at IS
  'When the teacher last CHANGED training_bands themselves. NULL = never self-selected, '
  'so the first choice is always allowed. Drives the 48h change cooldown.';

-- Partial index: the picker looks up "has this teacher chosen yet?" per user,
-- and the cooldown check reads the timestamp. Both are single-user lookups on
-- the primary key, so no extra index is warranted — documented here so a future
-- reader does not add one speculatively.
