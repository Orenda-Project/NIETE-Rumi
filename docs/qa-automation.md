# QA automation — from any commit, on any machine, to a synced spec and a driven E2E

**Owner:** the repo. **Applies to:** every developer who commits to NIETE-Rumi, however they commit.

Every commit to this repo that changes what a teacher sees on WhatsApp is meant to end
in two things: the Gherkin spec for that surface describing the *new* behaviour, and a
targeted end-to-end run against staging that proves it. This document is the map of how
that happens without depending on any one laptop, any one workspace, or Claude Code
being open at the moment of the commit.

```
developer changes bot code
        │
        ▼ commit  (terminal, IDE, or a Claude Code session — all three arm the same thing)
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 1. WHICH FEATURES?   select_e2e.py + .claude/qa/config/feature-map.yaml            │
│ 2. WHAT DO THE SPECS NEED?   spec_sync.py → brief: changed files, diff, scenarios  │
│    → marker in .claude/.e2e-pending/  (per clone, gitignored)                       │
└────────────────────────────────────────────────────────────────────────────────────┘
        │  the next Claude Code session in that clone is told at start and held once at end of turn
        ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 3. SYNC THE GHERKIN   /sync-specs --brief …  (skill: gherkin-spec-sync,             │
│    authors via gherkin-test-cases; adds / updates / tags @obsolete — never deletes) │
│ 4. GATE               validate_specs.py  (+ check-all-mode-counts.py)              │
│ 5. DRIVE              /niete-e2e <features>  against staging, linked WhatsApp Web  │
│ 6. RECORD             .claude/qa/ledgers/runs.jsonl  (+ results/, gitignored)      │
└────────────────────────────────────────────────────────────────────────────────────┘
        │  push / PR
        ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ CI  .github/workflows/qa-impact.yml → scripts/qa/ci_impact.py                       │
│     same selection over the PR range · spec freshness · E2E proof · sticky comment │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Why three mechanisms, and what each one can and cannot guarantee

| Mechanism | Fires for | Can do | Cannot do |
|---|---|---|---|
| **Git hooks** (`.githooks/`, installed by `npm install` via `prepare`, or `bash scripts/qa/install-hooks.sh`) | every commit on that machine, from any tool | select features, build the sync brief, leave a marker, print the next commands, warn at push time | author a scenario (judgement), drive WhatsApp (needs a linked browser), or run if the developer skipped the one-time `core.hooksPath` install |
| **Claude Code hooks** (`.claude/hooks/`, wired in `.claude/settings.json`) | a Claude session rooted in any clone of this repo | arm on the session's own commits; announce terminal-armed markers at SessionStart; hold the turn **once** per marker until the agent syncs, validates and drives — the only place phases 3–6 can actually be executed | see a commit made on another machine, or one made before the session existed (that is what the marker bridge is for) |
| **CI** (`qa-impact.yml`) | every PR into `develop`/`main`, every push to `develop`, **from any machine** | prove specs are valid; report per feature whether its spec was synced or explicitly declared unneeded, and whether a run was recorded; block the merge when configured to | author or drive anything — it makes the gaps visible and, in block mode, un-mergeable |

The honest summary: **CI is the guarantee, the hooks are the convenience that makes the
guarantee cheap to satisfy.** Authoring Gherkin needs a model following a skill; driving
WhatsApp needs a human-linked browser. Neither can live in a server-side check, so the
check's job is to refuse to merge until they have happened — or until someone has said,
in the commit or the PR, why they were not needed.

## Developer setup (once per clone)

```bash
npm install                          # root — its `prepare` script installs the git hooks
# or, explicitly:
bash scripts/qa/install-hooks.sh     # sets core.hooksPath = .githooks; --uninstall / --force
```

Nothing else. Python 3 is the only runtime the tooling needs; PyYAML is used when
present and a bundled zero-dependency reader (`.claude/qa/shared/yaml_lite.py`) is used
when it is not. `bash scripts/qa/verify-clean-clone.sh` clones this repo into a temp
dir with a scrubbed environment and walks the whole pipeline end to end — run it when
you change any part of this.

## What a developer sees

**Terminal commit touching `bot/shared/services/menu.service.js`:**
```
┌ QA · commit 3f2a9c1d7e0b touched: menu
│ Gherkin: sync needed first →  /sync-specs --brief .claude/.e2e-pending/git-3f2a9c1d7e0b.sync.json
│ Then the targeted E2E →  /niete-e2e menu
│ Open Claude Code in this clone: it announces this at start and holds the turn once until
│ it is driven or cleared. Off: QA_HOOKS_OFF=1 · Quiet: QA_HOOKS_QUIET=1
└ marker: .claude/.e2e-pending/git-3f2a9c1d7e0b.json
```
Docs-only, test-only and out-of-scope commits print nothing.

**Next Claude Code session in that clone:** the SessionStart banner lists every pending
`git-<sha>` marker with its brief and commands. At the end of the first turn the Stop
hook holds the session once, with the same instructions, until the run is driven or the
marker is cleared with a stated reason (`bash .claude/hooks/e2e-autorun.sh --clear
--session git-<sha>`). A commit the session makes itself is armed the same way.

**On the PR:** one sticky comment, updated in place, per feature:

| Feature | Pulled in by | Gherkin spec | E2E run recorded |
|---|---|---|---|
| **menu** (12 scenarios) | `menu.service.js` | ❌ stale — `menu.feature` unchanged | ⬜ missing |
| **coaching** (15) | shared file only | ➖ only-shared | ⬜ missing |

with the exact commands to fix each gap.

## Declaring "no spec change is needed"

Some code changes under a mapped file alter nothing a teacher can see (a log line, a
refactor). Say so where CI can read it — a commit trailer or a line in the PR body:

```
Spec-Sync: menu=none-needed (log line only, no teacher-visible change)
Spec-Sync: menu,status=none-needed (<why>)
Spec-Sync: none-needed (<why>)            # all affected features
```

A feature pulled in **only** through a shared fan-out file (`whatsapp.service.js`,
`text-message.handler.js`, …) is reported `only-shared` and needs no declaration — the
default for those is to leave the spec alone.

## Modes — warn first, then block

Two repository variables (Settings → Secrets and variables → Actions → Variables) set the
posture, so promotion is a settings change, not a code change:

| Variable | Values | Default | What `block` does |
|---|---|---|---|
| `QA_SPEC_FRESHNESS` | `off` · `warn` · `block` | `warn` | fails the `impact` check when any feature is `stale` |
| `QA_E2E_PROOF` | `off` · `warn` · `block` | `warn` | fails when no `runs.jsonl` row for an affected feature was added in the range |

`specs-valid` (parse + duplicate-name + tag checks, the QA tooling's own tests) is
always blocking — a broken spec is a defect, not a judgement. Locally, `QA_HOOKS_STRICT=1`
makes the pre-push hook block on a stale spec too.

## The rules the sync will not bend

- **It never deletes a scenario.** Behaviour that has gone away is tagged `@obsolete` with
  a `# OBSOLETE <date> (<bead>): <why>` line and raised as an explicit ask.
- **Author through the skill, never free-hand.** `gherkin-spec-sync` decides what the
  diff means for coverage; `gherkin-test-cases` decides how a scenario is written.
- **A commit-triggered run cannot test the commit.** Nothing deploys from a commit, so
  the run exercises the build that is already live. It is a regression check and must be
  reported as one; only a run after the `develop` deploy tests the change.
- **Never on production users.** `/niete-e2e` targets staging by default; prod is an
  explicit, per-action opt-in.

## Where everything lives

| Piece | Path |
|---|---|
| Feature map (hand-maintained: add a service/handler/route here in the same pass) | `.claude/qa/config/feature-map.yaml` |
| Selector · brief builder · spec validator · count check · YAML fallback | `.claude/qa/shared/select_e2e.py` · `spec_sync.py` · `validate_specs.py` · `check-all-mode-counts.py` · `yaml_lite.py` |
| Gherkin specs (nine features) + suite notes | `tests/features/whatsapp/niete/*.feature` · `_suite.md` |
| Per-feature executor agents · fixtures · targets · ledgers | `.claude/qa/agents/` · `.claude/qa/fixtures/` · `.claude/qa/config/whatsapp-targets.yaml` · `.claude/qa/ledgers/` |
| Runner | `.claude/qa/shared/feature-runner.cjs` (+ `features/*.cjs`, `wa-drive.js`, `flow-lib.cjs`) |
| Git hooks + installer | `.githooks/post-commit` · `.githooks/pre-push` · `scripts/qa/install-hooks.sh` |
| Claude Code hooks | `.claude/hooks/e2e-autorun.sh` · `e2e-autorun-stop.sh` · `e2e-pending-banner.sh` · `lib/git-push-match.sh` |
| Commands / skills | `/niete-e2e` · `/sync-specs` · `/testcases` · `/apply-discoveries` · `gherkin-spec-sync` · `gherkin-test-cases` · `chrome-mcp-whatsapp-e2e` |
| CI | `.github/workflows/qa-impact.yml` · `scripts/qa/ci_impact.py` |
| Verification from a clean clone | `scripts/qa/verify-clean-clone.sh` |

Tests for all of it: `npm run qa:test`.

## Switches

| Env var | Effect |
|---|---|
| `QA_HOOKS_OFF=1` | git hooks silent |
| `QA_HOOKS_QUIET=1` | post-commit arms but prints nothing |
| `QA_HOOKS_STRICT=1` | pre-push blocks on a stale spec |
| `E2E_AUTORUN_OFF=1` (exported) | Claude Code hooks silent |
| `E2E_SPEC_SYNC_OFF=1` (exported) | phase 1 (Gherkin sync) skipped, E2E half unchanged |
| `E2E_AUTORUN_ALL=1` (exported) | arm `/niete-e2e all` instead of the targeted selection (hours) |

## Known limits, stated plainly

- A developer who never runs `npm install` at the root and never runs the installer has
  no git hooks. CI still catches their PR; that is why CI exists.
- The marker bridge is per clone. A commit made in clone A is announced to a Claude
  session opened in clone A, not in clone B — CI is the cross-machine view.
- `runs.jsonl` proof is "a row for this feature was added in the range". It does not yet
  carry the commit sha the run drove against; a run against an older build still counts.
  Adding `commit` to the ledger schema is the next tightening.
- The `main` promotion arms the full suite (`/niete-e2e all`, hours); CI reports it, it
  does not run it.
