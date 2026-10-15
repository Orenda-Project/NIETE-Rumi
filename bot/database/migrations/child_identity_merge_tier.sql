-- Migration: merge_log.tier — which teacher-confirm queue tier a decision was made on.
--
-- NON-DESTRUCTIVE. One nullable column on merge_log (child_identity.sql), plus a
-- named CHECK. The teacher join queue writes the shown pair's tier on every
-- 'same' / 'no' and the same tier on the 'undo' that reverses a 'same'; per-tier
-- precision (and the automatic hold of a tier) is read from these rows. Rows
-- written by anything other than a queue decision on one of the two tiers keep
-- tier NULL.
--
-- Adds no table, so no ROW LEVEL SECURITY line: merge_log already has RLS on
-- (child_identity.sql).
--
-- Also widens merge_log.source to admit 'job' (the backward-join job's rows, which never carry a tier), so a
-- job never wears a teacher tap's label.
--
-- Idempotent: applying it twice is a no-op. Apply after child_identity.sql.
-- Rollback: child_identity_merge_tier_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE merge_log ADD COLUMN IF NOT EXISTS tier text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_log_tier_check') THEN
    ALTER TABLE merge_log
      ADD CONSTRAINT merge_log_tier_check CHECK (tier IN ('roster_unique_with_loose', 'probable'));
  END IF;
END
$$;

-- merge_log.source: queue | class_tab | job (the original CHECK admitted only the first two).
ALTER TABLE merge_log DROP CONSTRAINT IF EXISTS merge_log_source_check;
ALTER TABLE merge_log ADD CONSTRAINT merge_log_source_check CHECK (source IN ('queue', 'class_tab', 'job'));
