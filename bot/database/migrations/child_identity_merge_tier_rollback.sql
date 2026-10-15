-- Rollback: child_identity_merge_tier.sql. Drops the CHECK, then the column (the tier values are lost).
ALTER TABLE merge_log DROP CONSTRAINT IF EXISTS merge_log_tier_check;
ALTER TABLE merge_log DROP COLUMN IF EXISTS tier;
