-- Partial index on users.teacher_uuid to speed cross-DB lookups from Taleemabad.
--
-- Why partial (WHERE teacher_uuid IS NOT NULL): most WhatsApp-registered users
-- have no teacher_uuid — indexing only the imported rows keeps the index tight
-- (~5-10K rows vs. potentially 100K+ once teachers activate). Postgres will
-- pick this index for equality lookups against a non-null literal.
--
-- Future ETL scripts (completed LPs, completed trainings, coaching observations)
-- will JOIN Taleemabad-side records against NIETE users on this column,
-- potentially millions of lookups per run — the index is load-bearing there.

CREATE INDEX IF NOT EXISTS users_teacher_uuid_idx
  ON users (teacher_uuid)
  WHERE teacher_uuid IS NOT NULL;
