-- V1.6.5 — niete_coaching_ab_assignment: which of the four groups each programme school is in for
-- the ICT G1-5 v10 coaching test (bd-v0toag.21). Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. One row per programme school, a 2x2 of plan x report:
--   A = v9 + today's report, B = v10 card + today's report, C = v9 + new report, D = card + new report.
-- Written ONCE, on launch day, from the seeded block draw (ICT NIETE/ab-test-v10-coaching/workbench/
-- draw.py: urban/rural x school recording band, re-rolled until recording frequency balances). Read by
-- bot/shared/services/coaching/ab-v10-arms.js and by the tracker. The plan and report arms are derived
-- from the letter in code, not stored.
--
-- WHY A TABLE, AND NOT niete_lp_ab_assignment. Same reasons as V1.5.8 (fixed for the test, joinable by
-- school_id, re-rollable for balance). Not a second row in niete_lp_ab_assignment: that table is keyed
-- one row per school and read with maybeSingle by the live ch3-8 test — a second row per school would
-- make that read fail and drop every school out of the ch3-8 test. Not ab_tests/ab_test_variants: those
-- are per-user variants with counters, not a fixed school draw.
-- The table is dropped when the test is promoted (ROLLBACK below).
--
-- DATA. School ids, a letter, the block, the seed and a timestamp. No names, no phone, no PII.
-- LOAD. ~370 rows, written once. One indexed read (primary key) per coaching report.
-- IDEMPOTENT. IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.
-- Rollback: ROLLBACK_V1.6.5__niete_coaching_ab_assignment.sql
-- ORDER. Safe either side of the code: the code reads nothing while ab_v10_enabled is off, and treats
-- a missing table as "not in the test" (fails closed).

CREATE TABLE IF NOT EXISTS niete_coaching_ab_assignment (
  school_id  UUID PRIMARY KEY REFERENCES schools (id),
  ab_group   TEXT NOT NULL CHECK (ab_group IN ('A', 'B', 'C', 'D')),
  block      TEXT,
  seed       TEXT NOT NULL,
  drawn_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE niete_coaching_ab_assignment IS
  'ICT G1-5 v10 coaching test (bd-v0toag): school -> group. A = v9 + today''s report, B = v10 card + '
  'today''s report, C = v9 + new report, D = card + new report. Written once at the draw; never updated '
  'during the test.';

INSERT INTO app_settings (key, value, description)
VALUES ('ab_v10_enabled', 'false'::jsonb,
        'ICT G1-5 v10 coaching test (bd-v0toag). Master switch: off = every teacher gets today''s plan and '
        'report, and nothing the test adds runs. On = schools in niete_coaching_ab_assignment get their '
        'group. Transitional — deleted when the test is promoted.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
