-- V1.3.8 — niete_lp612_renders.over_time (bd-0cdug)
--
-- WHAT CHANGED ABOVE IT
--
-- An `AUTHOR_TIMEOUT` used to destroy a lesson that already rendered clean. `withTimeout` in
-- lp612-author.worker.js RACES the authoring closure and cannot cancel it, so when the clock won,
-- the document the revision ladder was holding stayed inside that closure, unreachable. Measured
-- on staging 2026-09-05: three Urdu cells timed out at 840s and TWO of them were still holding
-- renderable documents — d05's round-3 render had logged `lp612 render ok`, 11 pages. The teacher
-- received an apology for a lesson that existed.
--
-- The ladder now publishes its best-so-far as it climbs (`onCandidate`), and on a timeout the
-- worker draws and delivers that instead of failing. This is bd-vjk68's rule — *a lesson is never
-- lost for being long* — applied to TIME.
--
-- WHY THE ROW HAS TO CARRY IT
--
-- Because a delivered lesson and a delivered-late lesson are the same row otherwise, and the two
-- questions the recovery opens are both about RATES over the ledger:
--
--   * how often does the clock beat the ladder? (if it is common, the timeout or the round
--     budget is wrong, not the recovery)
--   * are recovered lessons WORSE? `lint_fails` and `page_count` are already on the row, so
--     "recovered lessons are 2 pages longer and carry a defect more often" becomes answerable by
--     one GROUP BY rather than by an argument.
--
-- Neither is answerable from a telemetry event alone: `event` is dark on NIETE staging (bd-7wr3f),
-- and an event stream rolls off while the ledger does not.
--
-- ANTI-SPRAWL (rule 15) — every existing column was considered first:
--
--   * `error_code` — cannot. A recovered lesson is `status='ready'`, and bd-7yxsu made it a rule
--     that status and error_code may never disagree: a delivered lesson must never read as
--     errored in a query.
--   * `lint_fails` (jsonb) — cannot. It is the canon LINT defect list and `lint_clean` is
--     computed from the same gate; a worker-side timing fact written into it corrupts both. This
--     is the identical refusal V1.3.7 recorded for `over_cap`.
--   * `rounds_used` — insufficient. A lesson that stopped at 5 rounds because it ran out of clock
--     and one that stopped at 5 because that is the budget are the same number.
--   * `completed_at - started_at` — insufficient. It says the run was long, not that the clock
--     ENDED it; a slow-but-finished run and a recovered one are indistinguishable, and the
--     timeout is an env var that moves (staging runs 840000 against a code default of 720000).
--   * a computed view — cannot. It would need the timeout as it stood at write time, which is
--     nowhere in the row.
--   * no free-form jsonb/meta column exists on this table, and adding one would be worse: it is
--     the sprawl this rule exists to prevent.
--
-- So: one narrow typed column plus a telemetry event carrying the detail — the house pattern this
-- table already set with `over_cap` in V1.3.7.
--
-- NOT NULL DEFAULT FALSE, and the worker names it on EVERY success patch. A NULL meaning "we did
-- not look" is indistinguishable from a false in every query anyone will run, and an UPDATE that
-- does not name a column leaves whatever is in it — so a retry after a recovered attempt would
-- silently inherit `true`.
--
-- DEPLOYS DO NOT RUN MIGRATIONS ON NIETE (bd-tqkq9). This file must be applied to the staging
-- database BY HAND, with the project ref asserted, BEFORE the code that writes the column ships.
-- A merged column that does not exist is a total lp612 outage.

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS over_time BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN niete_lp612_renders.over_time IS
  'True when this lesson was DELIVERED off the AUTHOR_TIMEOUT recovery path (bd-0cdug): the '
  'revision ladder ran out of clock while holding a document that was already deliverable — '
  'schema-valid, with no blocking defect except page count — so the worker drew and sent that '
  'instead of failing the row. False on every lesson that finished inside its timeout. Read it '
  'with rounds_used, page_count and lint_fails to answer whether recovered lessons are worse; '
  'read the rate to answer whether the timeout or the round budget is set wrong. The Urdu '
  'overlay pass is deliberately skipped on this path, so a recovered ur row also carries '
  'overlay_dropped = true.';

NOTIFY pgrst, 'reload schema';
