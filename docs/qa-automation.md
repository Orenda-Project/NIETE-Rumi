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
        │  the next Claude Code session in that clone is told at start; at end of turn it is HELD
        │  until the spec is changed+valid or declared none-needed (phase 1 gate, ≤3 holds),
        │  and ordered once to drive the E2E (phase 2)
        ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 3. SYNC THE GHERKIN   /sync-specs --brief …  (skill: gherkin-spec-sync,             │
│    authors via gherkin-test-cases; adds / updates / tags @obsolete — never deletes) │
│ 4. GATE               validate_specs.py  (+ check-all-mode-counts.py)              │
│ 5. DRIVE              /niete-e2e <features>  against staging, linked WhatsApp Web  │
│ 6. RECORD             .claude/qa/ledgers/runs.jsonl  (+ results/, gitignored)      │
└────────────────────────────────────────────────────────────────────────────────────┘
        │  push — any branch
        ▼
   pre-push hook (scripts/qa/impact.py): affected features · spec freshness · E2E proof,
   printed in the terminal — advisory unless QA_HOOKS_STRICT=1
        │  pull request into sandbox / staging / main
        ▼
   .github/workflows/qa-impact.yml: the SAME impact.py, as a PR check + one comment edited
   in place — a stale spec FAILS the PR unless `Spec-Sync: <feature>=none-needed (<why>)`
   is declared in a commit or the PR body
```

## Three mechanisms, and what each one can and cannot guarantee

| Mechanism | Fires for | Can do | Cannot do |
|---|---|---|---|
| **Git hooks** (`.githooks/`, installed by `npm install` via `prepare`, or `bash scripts/qa/install-hooks.sh`) | every commit and every push on that machine, from any tool | select features, build the sync brief, leave a marker, print the next commands, report at push time (any branch) | author a scenario (judgement), drive WhatsApp (needs a linked browser), or run if the developer skipped the one-time `core.hooksPath` install |
| **Claude Code hooks** (`.claude/hooks/`, wired in `.claude/settings.json`) | a Claude session rooted in any clone of this repo | **install the git hooks at SessionStart when the clone has none**; arm on the session's own commits; announce terminal-armed markers at SessionStart; **hold the turn until the Gherkin is synced and valid, or declared none-needed** (phase 1 — a gate, bounded to 3 holds, `--clear` refuses while open); order the E2E **once** (phase 2) — the only place phases 3–6 can actually be executed | see a commit made on another machine, or one made before the session existed (that is what the marker bridge is for) |
| **GitHub check** (`.github/workflows/qa-impact.yml`) | every PR into `sandbox` / `staging` / `main`, whoever opened it, however they commit | run `impact.py` over the PR range, post one comment (edited in place) naming the features, the stale specs and the exact `/sync-specs` + `/niete-e2e` commands, and **fail the PR** on a stale spec that nobody declared `none-needed` | author or drive anything; see a run that was not committed to `runs.jsonl` |

**History.** The pipeline was "hooks only, no CI" by decision on 2026-09-07. On
2026-09-09 PRs #835 and #836 changed `bot/shared/services/coaching/**` and reached
`sandbox` with no spec sync and no E2E: the author's clone either had no hooks or the
hook exited silently, the pre-push report did not cover `sandbox` or feature branches,
and the GitHub-UI merge touched no hook at all. Nothing anywhere noticed. The decision
was reversed the same day (bd-c3jx8) and the GitHub check above is the piece that no
local setup can skip. The hooks remain the only place authoring and driving can
happen — the check tells the author what to run, in the PR, where it cannot be missed.

## Developer setup (once per clone)

**Open Claude Code in the clone — that is enough.** Since 2026-09-09 the SessionStart hook
(`.claude/hooks/e2e-pending-banner.sh`) installs the git hooks itself when `core.hooksPath` is
unset, tells the session it did, and warns (with the `--force` command) when a foreign hooksPath
is in the way. Sessions launched from the parent workspace reach every NIETE checkout under it
through the workspace's SessionStart shim, so worktrees are covered too.

By hand, for a terminal-only developer:

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
│ Open Claude Code in this clone: it announces this at start and holds the turn until
│ it is driven or cleared. Off: QA_HOOKS_OFF=1 · Quiet: QA_HOOKS_QUIET=1
└ marker: .claude/.e2e-pending/git-3f2a9c1d7e0b.json
```
Docs-only, test-only and out-of-scope commits print nothing.

**Next Claude Code session in that clone:** the SessionStart banner lists every pending
`git-<sha>` marker with its brief and commands. At the end of the first turn the Stop
hook holds the session, with the same instructions, until the spec is synced (or declared) and the run is driven or the
marker is cleared with a stated reason (`bash .claude/hooks/e2e-autorun.sh --clear
--session git-<sha>`). A commit the session makes itself is armed the same way.

**On a push to `develop` or `main`:** the pre-push hook prints, per feature, whether its
spec was synced in the pushed range and whether a run was recorded, with the commands to
fix each gap. Advisory by default; `QA_HOOKS_STRICT=1` blocks the push on a stale spec.
`npm run qa:impact` prints the same report for the current branch at any time.

## Declaring "no spec change is needed"

Some code changes under a mapped file alter nothing a teacher can see (a log line, a
refactor). Say so where the pre-push check can read it — a commit trailer (a PR body works too if the check is ever run over one):

```
Spec-Sync: menu=none-needed (log line only, no teacher-visible change)
Spec-Sync: menu,status=none-needed (<why>)
Spec-Sync: none-needed (<why>)            # all affected features
```

A feature pulled in **only** through a shared fan-out file (`whatsapp.service.js`,
`text-message.handler.js`, …) is reported `only-shared` and needs no declaration — the
default for those is to leave the spec alone.

## Modes

The pre-push report has two verdicts, each with a mode `off` · `warn` · `block`, read from
the env vars `QA_SPEC_FRESHNESS` and `QA_E2E_PROOF` (default `warn`). `QA_HOOKS_STRICT=1`
puts spec freshness into `block` for the hook, so a push with a stale spec fails locally.
Nothing server-side enforces either verdict.

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
| Pre-push range report (`npm run qa:impact`) | `scripts/qa/impact.py` |
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

## Phase 1 is a gate (2026-09-09, bd-zqtgs)

PR #841 changed training code from a Claude session; the hook selected `training`, built
the brief, nudged once at the end of the turn — and the turn ended with `training.feature`
untouched. The Stop hook asked "was it nudged?", never "did the spec change?", and told the
agent to "clear it either way". Now:

- arming records a **hash of each spec the brief says to author** (`spec_hashes` on the marker,
  both for session commits and terminal commits);
- at end of turn the Stop hook compares: a spec byte-identical to arming, with no declaration,
  **holds the turn again** — up to `E2E_PHASE1_MAX_BLOCKS` (default 3) times, then lets go with a
  loud stderr line, and the PR check catches it. A changed spec is run through
  `validate_specs.py`; an invalid one holds too, quoting the validator;
- `bash .claude/hooks/e2e-autorun.sh --clear` **refuses** while phase 1 is open (`--force` is the
  escape hatch, and `qa-impact` still flags it);
- the two legitimate exits are a changed+valid `.feature`, or an explicit declaration:
  `bash .claude/hooks/e2e-autorun.sh --declare --session <id> '<feature>=none-needed (<why>)'`,
  or the same grammar as a `Spec-Sync:` trailer on HEAD — one declaration satisfies the hook,
  the pre-push report and the PR check alike.

Phase 2 (driving WhatsApp) is unchanged: ordered once, because a linked browser is a human
precondition and blocking on it wedges sessions.

## Known limits, stated plainly

- A developer who never runs `npm install` at the root and never runs the installer has
  no git hooks locally. Their commits are still seen — by `qa-impact.yml` on the PR, which
  fails on a stale spec and names the commands. The hooks now also say so out loud when
  they cannot run (`python3` missing, selector error → `.claude/.e2e-pending/last-error.log`)
  instead of exiting 0 in silence.
- The GitHub check cannot make a run happen. `e2e_proof` is reported in `warn` mode
  because a run cannot precede the merge it tests; a merged PR with `missing` proof is
  covered by the scheduled full run (`.claude/qa/SCHEDULE.md`), which must be alive for
  that to hold — check `bash scripts/qa/niete-e2e-schedule.sh status`.
- The marker bridge is per clone. A commit made in clone A is announced to a Claude
  session opened in clone A, not in clone B.
- `runs.jsonl` proof is "a row for this feature was added in the range". Since 2026-09-09
  `ledger.append_run` stamps `commit` (HEAD of the checkout holding the ledger) on every
  row, so a row CAN be tied to the build it drove — `impact.py` does not yet require the
  stamped commit to be inside the range; that is the next tightening.
- The `main` promotion arms the full suite (`/niete-e2e all`, hours) in the session that
  makes it; nothing runs it unattended.
