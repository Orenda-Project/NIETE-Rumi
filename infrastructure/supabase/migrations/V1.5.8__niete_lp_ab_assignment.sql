-- V1.5.8 — niete_lp_ab_assignment: which group each programme school is in for the ICT G1-5
-- ch3-10 lesson-plan A/B test (bd-5o0ay.10.2). Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. One row per programme school: A = the August v8 PDF, B = the v9 render that is current.
-- Written ONCE, on launch day, from the seeded block draw (ICT NIETE/ab-test-ch310/workbench/
-- randomise.py, urban/rural x past quiz results, re-rolled until four baselines balance). Read by
-- lp-ab-ch310.service.js on each ch3-10 lesson send, and by the results script.
--
-- WHY A TABLE. The group must be fixed for two school weeks and joinable to downloads, fidelity
-- moves and quiz results by school_id. Checked against the alternatives:
--   · app_settings holds switches, not 187 keyed rows; a JSON blob there cannot be joined or
--     constrained to one group per school;
--   · schools is the shared registry; a test-only column on it outlives the test and invites
--     other code to read it;
--   · computing the group from a hash at send time is what draw 1 did — it cannot be re-rolled
--     for balance, and a later change to the seed silently moves schools between groups.
-- The table is dropped when the test is promoted (ROLLBACK below).
--
-- DATA. School ids, a letter, the block, the seed and a timestamp. No names, no phone, no PII.
-- LOAD. ~190 rows, written once. One indexed read (primary key) per ch3-10 lesson send.
-- IDEMPOTENT. IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.
-- Rollback: ROLLBACK_V1.5.8__niete_lp_ab_assignment.sql
-- ORDER. Apply before setting ab_lp_ch310_enabled; the code treats a missing table as "not in
-- the test" (fails closed), so applying it after the code is also safe.

CREATE TABLE IF NOT EXISTS niete_lp_ab_assignment (
  school_id  UUID PRIMARY KEY REFERENCES schools (id),
  ab_group   TEXT NOT NULL CHECK (ab_group IN ('A', 'B')),
  block      TEXT,
  seed       TEXT NOT NULL,
  drawn_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE niete_lp_ab_assignment IS
  'ICT G1-5 ch3-10 LP A/B (bd-5o0ay.10): school -> group. A = August v8 PDF, B = current v9. '
  'Written once at the draw; never updated during the test.';

INSERT INTO app_settings (key, value, description)
VALUES ('ab_lp_ch310_enabled', 'false'::jsonb,
        'ICT G1-5 ch3-10 lesson-plan A/B. On = schools in niete_lp_ab_assignment get their group''s '
        'plan (A: August v8, B: v9) and no voice note. Off = everyone gets the current plan. '
        'Transitional — deleted when the test is promoted.')
ON CONFLICT (key) DO NOTHING;
