-- ROLLBACK V1.10.11 — drops niete_lp_opens.lesson_key. The writer falls back to the keyless insert when the column
-- is missing (42703), so code may stay deployed. Loses the stored keys; the backfill script can recompute them.
ALTER TABLE niete_lp_opens DROP COLUMN IF EXISTS lesson_key;

NOTIFY pgrst, 'reload schema';
