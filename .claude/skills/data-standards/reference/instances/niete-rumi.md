# NIETE-Rumi — the first governed instance

The shape is the same everywhere: 27 standards, one validator, three enforcement layers. What
differs per repository is scope, mode, and what the numbers actually came out as. This is the
worked instance every later repository should be compared against.

| | |
|---|---|
| Repository | `Orenda-Project/NIETE-Rumi` — **public** |
| Adopted | 2026-08-20 (PR #320), in production since 2026-08-24 |
| Copy location | `.claude/skills/data-standards/` in that repo, byte-verbatim, with a receipt beside it (`data-standards.upstream.json`) and `scripts/data-standards-verify.sh` failing CI if anyone edits it |
| Source of truth | this workspace — the copy in NIETE is pushed by the porter, never edited there |
| Mode | **warn** at commit time (`.claude/hooks/data-standards-warn.sh`, never blocks; `DATA_STANDARDS_BLOCK=1` promotes); **advisory** in CI |

## Scoping — `.data-standards.json` at that repo's root

`include` REPLACES the skill's defaults; `exclude` APPENDS to them. Five migration directories in,
three current-state snapshots plus seed/verify/test SQL out:

```
include: bot/database/migrations/**  dashboard/database/migrations/**
         dashboard/supabase/migrations/**  infrastructure/supabase/migrations/**  scripts/migrations/**
exclude: infrastructure/supabase/00_complete-schema.sql  01_rls-policies.sql  02_seed-data.sql  verify-schema.sql
         bot/database/schema.sql  bot/shared/database/schema.sql  **/test_connection.sql  **/test_migration_*.sql
```

Why the snapshots are out: `tests/setup/schema-production-parity.test.js` compares
`00_complete-schema.sql` against production, so a third of migration PRs also touch it — without the
exclusion those PRs inherit that file's 95 historical findings. Effect of the config: **213 → 85
findings** across 89 relevant files, 49 of them already clean.

## Enforcement layers present

| Layer | Detail |
|---|---|
| CI `.github/workflows/data-standards.yml` | three jobs — `ownership` (hard fail: receipt mismatch), `exemption` (hard fail: the hygiene carve-out widened), `report` (advisory comment). Runs on **every** PR with no `paths:` filter, so it can be made a required check; diffs from the true merge base, not the base-branch tip; corrects its own comment if a later push removes the last schema file. Stdlib-only scope step first, so a non-schema PR pays a checkout and ~30 ms. |
| Commit-time warn hook | project-level `PreToolUse` on `Bash`, registered in that repo's `.claude/settings.json`; resolves the repo from the cwd's `git rev-parse --show-toplevel` so it works from any subdirectory |
| `source-hygiene` carve-out | that repo's `tests/setup/source-hygiene.test.js` forbids the org name under `.claude/**/*.md`; the skill's own docs use it, so the vendored path gets a reduced check — org name allowed, **ticket refs, partner/tester names and deployment phone numbers still enforced**. Five assertions pin it. Consequence for anything ported there: no ticket ids in skill files. |

## What the numbers came out as (2026-08-20 → 2026-09-25)

| Measure | Value |
|---|---|
| CI runs | 2,302 (26 before 2026-08-21) |
| PRs the gate commented on | 122 — 71 clean, 51 with findings |
| Findings reduced after the comment | **2 of 51** — #888 a `DROP COLUMN` on `users` got a real review; #413 rewrote a rollback comment as prose to silence a false positive |
| New migrations born materially clean | 77% (99 migrations since 2026-01) |
| Finding classes at birth | 54% material · 27% commented-out SQL read as destructive (a validator bug, since fixed in this workspace) · 19% the one-line D8 migration-marker convention |
| Skill invoked deliberately | 1 (2026-09-02) |
| Commit gate blocked a real push | 1 (2026-09-08) — the agent moved to a clean worktree instead of fixing the findings |

## Real catches, still open

- **#321** `niete_lp_fidelity_moves.lesson_id text NOT NULL` with no `REFERENCES` (D3). Genuine: either a
  real FK to `niete_lp_assets` or a shared natural key — someone has to say which.
- **#386** `call_trace`, `call_memory`, `call_recall_docs`: non-UUID primary keys (D1 ×3) and `user_id`
  columns with no foreign key (D3 ×2). Merged to production unchanged four days after the gate went in.

## The convention that clears most noise

A new migration passes clean with a UUID primary key, `REFERENCES` on every `*_id`, `TIMESTAMPTZ`,
a classification comment on PII columns, and one header line containing the word *migration*:

```sql
-- V1.1.8 — coach_notes. Flyway migration.
-- Rollback: DROP TABLE coach_notes;
CREATE TABLE coach_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id),
  coach_phone TEXT, -- Restricted-PII
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Promotion criteria for this instance

Promote D5 (bare `TIMESTAMP`) and the D8 migration-marker check to blocking first — near-zero
false positives, one-line fixes. Promote D1 after a sweep of the 17 existing non-UUID keys. Keep
D3/D4 advisory: D3 needs a human to distinguish an FK from a natural key, D4 needs the sensitivity
registry the standard itself says it depends on.
