-- V1.3.9 — niete_lp612_renders.checkpoint (bd-oak77.11)
--
-- WHAT IT IS. The best lesson document the authoring ladder has produced so far, persisted on the
-- render row after every round it accepts, and cleared the moment the run reaches a terminal status.
--
-- WHY IT EXISTS. Operator, 2026-09-06: "deploy should never kill in progress authoring lesson
-- plans." An lp612 authoring run is 2.5-7 minutes of LLM work costing ~$0.30-0.60. When the process
-- goes away mid-run — a Railway redeploy (SIGTERM then, at Railway's default draining of 0 seconds,
-- SIGKILL), an OOM, a host eviction — everything that run had produced was inside a closure in a
-- process that no longer exists. The row stayed `authoring`, the SQS message stayed invisible for up
-- to its remaining ~15-minute visibility window, and whichever replica finally claimed it authored
-- the same lesson AGAIN FROM ROUND 0. Measured residue on staging before this change: 4 of 92
-- renders reaped as AUTHOR_STRANDED.
--
-- With a checkpoint on the row, a redelivered job skips the initial author call — the single most
-- expensive step — and continues the ladder from the document already paid for.
--
-- WHY A COLUMN AND NOT A TABLE (root rule 15, anti-sprawl). There is nothing to query here and
-- nothing to keep: exactly one live checkpoint per render, written and read on a path that already
-- reads and writes this row, and NULLed at the end of the run. No existing column can hold a
-- per-round document and no view can compute one. A separate table would add a second row lifecycle
-- to keep in step with `status`, which is the failure this table's `waiters` column already avoids
-- for the same reason.
--
-- WHY NOT R2. The checkpoint's freshness is also what tells `reapStrandedRenders()` that the run's
-- owner is provably alive; keeping it on the row makes that one read instead of a bucket listing,
-- and the write is the same UPDATE the worker already issues.
--
-- SHAPE (v1). Written by bot/workers/lp612-author.worker.js:
--   { "v": 1, "round": 2, "lp_doc": { ... }, "blocking": ["..."], "deliverable": true,
--     "lint_clean": false, "model": "anthropic/claude-sonnet-5", "family": "sci", "tier": "standard",
--     "template_version": "v9.1", "lang": "en", "at": "2026-09-06T12:00:00.000Z" }
-- `v` is checked on read; an unrecognised version is ignored rather than trusted, so a future shape
-- change can never make a running worker resume from a document it does not understand.
--
-- ADDITIVE AND NULLABLE. Deploying the code without this column is safe by construction: the worker
-- reads the checkpoint in its OWN degrade-safe select (never in loadRender's column list, whose
-- failure aborts the job and would kill every lesson — the bd-tqkq9 class), and the write goes
-- through patch(), which logs and swallows. Both fall back to exactly today's behaviour.
--
-- ============================ HAND-APPLY NOTE — READ THIS ============================
-- NIETE DEPLOYS DO NOT RUN MIGRATIONS (bd-tqkq9), and the `schema_versions` ledger on prod is not
-- trustworthy (bd-7i0hs). This file must be applied to production BY HAND, and the effect asserted,
-- BEFORE the code that reads it is deployed. Order matters only for the benefit it buys: applied
-- first, the very first deploy after it already resumes; applied later, nothing breaks and the
-- benefit simply starts then.
--
--   Apply (prod ref ihzciabopbttygxxgrkm):
--     psql "$NIETE_PROD_URL" -f infrastructure/supabase/migrations/V1.3.9__lp612_checkpoint.sql
--
--   Assert the effect (NOT the ledger):
--     SELECT column_name, data_type, is_nullable
--       FROM information_schema.columns
--      WHERE table_name = 'niete_lp612_renders' AND column_name = 'checkpoint';
--     -- expect exactly one row: checkpoint | jsonb | YES
--
--   Reverse (safe at any time — nothing reads this column when it is absent):
--     ALTER TABLE niete_lp612_renders DROP COLUMN IF EXISTS checkpoint;
--     NOTIFY pgrst, 'reload schema';
-- =====================================================================================

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS checkpoint JSONB;

COMMENT ON COLUMN niete_lp612_renders.checkpoint IS
  'bd-oak77.11. The authoring ladder''s best-so-far document, persisted each accepted round so a process that dies mid-run (deploy, OOM, eviction) costs one round instead of the whole lesson. {v, round, lp_doc, blocking, deliverable, lint_clean, model, family, tier, template_version, lang, at}. NULLed on the terminal write. Its `at` is also what stops reapStrandedRenders() condemning a row whose owner is demonstrably still working.';

NOTIFY pgrst, 'reload schema';
