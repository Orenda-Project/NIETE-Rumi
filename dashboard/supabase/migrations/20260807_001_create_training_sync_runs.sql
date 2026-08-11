-- bd-2528 — the ledger that tells us when the legacy FDE app has gone quiet.
--
-- Context: the 2026-07-12 migration took a SNAPSHOT. Teachers kept using the old
-- FDE app afterwards, so their completions land in fde_production and are invisible
-- here. As of 2026-08-07 that is 1,665 teachers and ~78k completed-module pairs
-- written after the snapshot, still growing daily.
--
-- The delta sync (scripts/sync-training-from-fde.py) closes that gap on a schedule.
-- This table is what makes the sync RETIREABLE rather than permanent: every run
-- records how much NEW legacy data it found. When `source_rows_after_cutoff` reads
-- zero for a sustained window, the old app has stopped being written to and the
-- job can be switched off with evidence rather than a guess.
--
-- Deliberately NOT a watermark store. The sync is idempotent via the natural keys
-- (user_id, module_id) / (attempt natural key), so correctness never depends on a
-- row in here being accurate. The window columns are an optimisation and an audit
-- trail — if this table were dropped tomorrow, a full re-run would still be correct,
-- just slower. That property is why the `modified`-column unreliability in the
-- source (see below) is survivable.
--
-- Source-timestamp caveat, measured 2026-08-07: Django's auto_now is effectively
-- not firing on the FDE training tables — `modified > created` on only 4 of
-- 2,598,546 teachertrainingstatus rows and 798 of 2,040,771 assessment rows. So a
-- `modified`-only high-water mark would look like it worked while silently missing
-- genuine edits. The sync therefore uses GREATEST(created, modified) for the window
-- AND relies on conflict-ignore for correctness. Never use last_local_modified_at:
-- it is an offline DEVICE clock and its minimum value in the source is 1970-01-01.

CREATE TABLE IF NOT EXISTS training_sync_runs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which sync, so one ledger can serve progress/attempts/certificates.
    entity                    text        NOT NULL,

    started_at                timestamptz NOT NULL DEFAULT now(),
    finished_at               timestamptz,
    -- running | success | failed | dry_run
    status                    text        NOT NULL DEFAULT 'running',

    -- The source window this run scanned. window_end is the run's own start time,
    -- so consecutive runs tile without gaps.
    window_start              timestamptz,
    window_end                timestamptz,

    -- THE RETIREMENT SIGNAL. Rows in the source whose GREATEST(created, modified)
    -- falls after the migration cutoff — i.e. activity that happened in the OLD app
    -- after we supposedly moved off it. A sustained run of zeroes here is the
    -- evidence needed to turn the sync off.
    source_rows_after_cutoff  integer     NOT NULL DEFAULT 0,

    -- Volume accounting for this run.
    source_rows_scanned       integer     NOT NULL DEFAULT 0,
    rows_written              integer     NOT NULL DEFAULT 0,
    rows_skipped_duplicate    integer     NOT NULL DEFAULT 0,
    -- Legacy teachers with no user in this DB (never registered on the new platform).
    rows_unmatched_teacher    integer     NOT NULL DEFAULT 0,
    -- Legacy trainings with no corresponding active training_modules row.
    rows_unmatched_module     integer     NOT NULL DEFAULT 0,
    teachers_touched          integer     NOT NULL DEFAULT 0,

    -- Non-fatal detail: unmatched samples, per-level counts, the error on failure.
    notes                     jsonb       NOT NULL DEFAULT '{}'::jsonb,

    created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE training_sync_runs IS
    'bd-2528 — one row per delta-sync run from the legacy FDE Django DB. Exists to make the sync retireable: when source_rows_after_cutoff stays 0, the old app is quiet and the job can be switched off with evidence.';
COMMENT ON COLUMN training_sync_runs.source_rows_after_cutoff IS
    'THE RETIREMENT SIGNAL — legacy rows written AFTER the migration cutoff. Sustained zero = old app is no longer being written to.';
COMMENT ON COLUMN training_sync_runs.window_start IS
    'Optimisation + audit only. Correctness comes from the natural-key conflict-ignore, never from this value.';

-- "Has the legacy app gone quiet?" and "show me the last N runs" are the only two
-- read patterns this table has.
CREATE INDEX IF NOT EXISTS idx_training_sync_runs_entity_started
    ON training_sync_runs (entity, started_at DESC);

-- The sync must never double-count a still-running job as a completed one.
ALTER TABLE training_sync_runs DROP CONSTRAINT IF EXISTS training_sync_runs_status_check;
ALTER TABLE training_sync_runs ADD CONSTRAINT training_sync_runs_status_check
    CHECK (status IN ('running', 'success', 'failed', 'dry_run'));

ALTER TABLE training_sync_runs DROP CONSTRAINT IF EXISTS training_sync_runs_entity_check;
ALTER TABLE training_sync_runs ADD CONSTRAINT training_sync_runs_entity_check
    CHECK (entity IN ('progress', 'attempts', 'certificates'));
