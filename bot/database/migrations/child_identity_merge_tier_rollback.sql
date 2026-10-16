-- Rollback: child_identity_merge_tier.sql. Drops the CHECK, then the column (the tier values are lost).
ALTER TABLE merge_log DROP CONSTRAINT IF EXISTS merge_log_tier_check;
ALTER TABLE merge_log DROP COLUMN IF EXISTS tier;
-- The source CHECK goes back to its two values only when no job row exists (a job row would break the narrower rule).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM merge_log WHERE source = 'job') THEN
    ALTER TABLE merge_log DROP CONSTRAINT IF EXISTS merge_log_source_check;
    ALTER TABLE merge_log ADD CONSTRAINT merge_log_source_check CHECK (source IN ('queue', 'class_tab'));
  END IF;
END
$$;
