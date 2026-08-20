# Data standards in this repo

Schema changes here are checked against Taleemabad's 27 Data Standards (D1–D27).
The checker is a skill **owned by the Data Team** in
`Orenda-Project/agent-skills-taleemabad`, vendored into this repo verbatim at
`.claude/skills/data-standards/`.

**Never edit anything under that directory.** CI proves it is untouched
(`scripts/data-standards-verify.sh`), and that check fails hard. Everything this
repo needs to adapt the checker lives *outside* it, in `.data-standards.json`.

Because it sits under `.claude/skills/`, Claude Code picks it up as a project
skill — so `/data-standards`, "audit this migration", "is this table PII-safe"
work in a session here even for someone who has none of our agent tooling
installed.

Two consequences of vendoring someone else's docs into `.claude/`, both
deliberate:

- `tests/setup/source-hygiene.test.js` scans every `.md` under `.claude/` and
  forbids the org name. The skill's own docs use it 5 times and we cannot patch
  their files, so that guard applies a **reduced** check to
  `.claude/skills/data-standards/**`: the org name is allowed there, while ticket
  refs, partner/tester names and real deployment phone numbers stay enforced. If
  an upstream refresh introduces one of those, CI still catches it.
- `.claude/skills/data-standards.upstream.json` (the receipt) lives *beside* the
  directory, not inside it, so the vendored tree contains only their files.

## One-time setup

```bash
pip install pyyaml                       # required — see "Gotchas" below

# optional: also check plain terminal / GUI commits, not just Claude's
python3 .claude/skills/data-standards/scripts/install_repo_hooks.py --repo .
```

Run the hook installer against **this main clone, not a worktree** — a linked
worktree's `.git` is a file, not a directory, and the installer refuses it. Git
hooks live in the shared `.git/hooks`, so installing once covers every worktree.

## Checking your own change

```bash
git add <your migration>
python3 .claude/skills/data-standards/scripts/validate_schema.py --mode staged --markdown
```

Exit codes: `0` clean · `1` findings · `2` validator could not run · `3` nothing
schema-relevant staged.

## Writing a migration that passes

Four things cover almost everything:

```sql
-- V1.1.8 — coach_notes. Flyway migration.          <- 1. the word "migration" (D8)
-- Rollback: DROP TABLE coach_notes;

CREATE TABLE coach_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),    -- 2. UUID PK, never SERIAL (D1)
  teacher_id UUID NOT NULL REFERENCES users(id),    -- 3. real REFERENCES on *_id (D3)
  coach_phone TEXT, -- Restricted-PII               -- 4. classify PII columns (D4/D6)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),    --    TIMESTAMPTZ, never TIMESTAMP (D5)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

For a destructive statement, put a rollback note or `-- destructive: reviewed`
within a few lines above it.

## What is checked

`.data-standards.json` scopes the checker to the five migration directories:

```
bot/database/migrations/          dashboard/supabase/migrations/
dashboard/database/migrations/    infrastructure/supabase/migrations/
scripts/migrations/
```

The current-state snapshots (`infrastructure/supabase/00_complete-schema.sql`,
`bot/database/schema.sql`, `bot/shared/database/schema.sql`), seed/verify SQL and
`test_*.sql` are excluded — they mirror what already exists rather than
introducing change. Scoping takes the repo from 213 findings to 85.

Note `include` **replaces** the skill's defaults while `exclude` **appends** to
them, so anything missing from the include list is simply not checked. Also,
`--mode full` ignores this file entirely; `--mode diff` and `--mode staged` (what
CI and the commit gate use) honour it.

## Gotchas

**`pyyaml` is not optional.** Without it the validator exits 2, and the commit
gate treats 2 as blocking — so a missing Python package looks exactly like a
schema violation. `pip install pyyaml`.

**Two known noise sources.** Both are in the Data Team's skill; we vendor it
unmodified and do not patch around them. This is why CI is advisory:

1. The D8 destructive check does not strip SQL comments, so a commented-out
   rollback line like `-- DROP TABLE IF EXISTS x;` reads as live destructive SQL.
   **23 of our 85 findings (27%) are this.** Ignore them.
2. D4's PII pattern is `\b(phone|cnic|email|dob)\b`, and `_` is a word
   character — so `parent_phone`, `teacher_phone` and `work_email` are **not**
   flagged. 3 of our 6 real PII column names are invisible to it, so classify
   PII columns by hand rather than trusting a clean D4 result.

**Bypassing the commit gate** needs a real reason, not a flag:

```bash
export TALEEMABAD_DATA_STANDARDS_BYPASS="INC-1234: <ticket, incident or named approver>"
```

Generic values (`bypass`, `1`, `fix later`) are rejected. Accepted bypasses are
recorded to `.data-standards-bypass-log.jsonl` (gitignored) with actor, commit
SHA and which standards were skipped. Inline `VAR=value` before the command does
not work — `export` it.

## Refreshing the skill from upstream

Anyone with the pack cloned can refresh it; nobody needs write access to the pack:

```bash
rsync -a --exclude __pycache__ --exclude '*.pyc' \
  ~/Documents/agent-skills-taleemabad/skills/data-standards/ \
  .claude/skills/data-standards/
./scripts/data-standards-verify.sh --update    # regenerate the receipt
```

Then open a PR. Check whether the finding count moved before merging — an
upstream change can add checks that newly fail existing files.

`.claude/skills/data-standards.upstream.json` records which upstream commit this
copy came from. It sits *outside* the skill directory deliberately — that
directory holds only the Data Team’s files, nothing of ours.
