---
name: niete-mock-e2e
description: 'Run or unblock the NIETE mock WhatsApp E2E lane — bot from one commit behind a fake Graph API, no browser or number. Use for "run mock e2e", "PR says e2e: missing", "mock not running on my laptop", "niete-local.env missing". NOT the paused WhatsApp Web lane (/niete-e2e).'
metadata:
  disclosure: auto
  last_verified: 2026-09-29
---

# NIETE mock WhatsApp E2E — the commit lane

The mock lane starts the NIETE bot **from exactly one commit** (a detached worktree at that sha),
points it at a local stand-in for Meta's Graph API, and drives the same feature scripts the
WhatsApp Web lane uses. No browser, no linked phone, no live vendor call. It is **layer 1** — the
only lane that auto-runs for a commit. The chrome lane (`/niete-e2e`, WhatsApp Web against the
deployed build) is **paused**; it comes back only with `E2E_CHROME_ON=1` exported.

Everything runs in this repo (`git remote -v` shows `Orenda-Project/NIETE-Rumi`). The full lane
lives on `sandbox`; the long-form guide is `docs/e2e-mock-lane.md`. Its sibling for the chrome lane
is `.claude/skills/chrome-mcp-whatsapp-e2e/`.

**Features on the lane** are not a list anyone maintains: a feature is covered iff its driver
`.claude/qa/shared/features/<feature>.cjs` carries a `// @mock-lane` marker in its first 5 lines
(`e2e_mock_features` in `.claude/hooks/lib/mock-lane.sh`). Today: menu · language · status ·
lesson-plan · coaching · training · registration. `E2E_MOCK_FEATURES=a,b` overrides for one run.

---

## 1 — How a commit becomes a recorded run

There are four links. "Tests generated but E2E shows missing" means one of them broke — find which.

| # | Link | Where it can break |
|---|---|---|
| 1 | `.githooks/post-commit` **arms** the commit: writes `.claude/.e2e-pending/git-<sha>.json` (+ `.sync.json` Gherkin brief) and prints the mock command. It never runs anything. | `core.hooksPath` is not `.githooks` → nothing is armed |
| 2 | The next **Claude Code session in that clone** sees the marker (SessionStart banner) and is held once at end of turn (Stop hook) until the run is driven | the three E2E hooks are not registered in `.claude/settings.json` on that branch |
| 3 | `commit-e2e.sh` drives the stack and **appends a row** to `.claude/qa/ledgers/runs.jsonl` | machine not ready (§2) → exit 3, no row |
| 4 | `ledger_row.py` **commits that one file and pushes the branch** by itself | skipped silently-ish — see below |

The PR check (`scripts/qa/impact.py`, run by `.github/workflows/qa-impact.yml`) marks a feature
`recorded` **only if a `runs.jsonl` row for it was ADDED inside the PR's commit range, on the
remote**. A run that happened but was not committed *and pushed* is indistinguishable from no run.
The workflow runs **only on PRs into `sandbox`** (operator, 2026-09-16) — a PR into
`staging`/`main` gets no comment at all.

**Link 4 skips itself** in these cases; the run's `ledger:` line says which (`not committed (…)` /
`not pushed (…)`):

| Line says | Why | Fix |
|---|---|---|
| `not committed (detached HEAD)` | ran on a detached checkout | run from the PR branch |
| `not pushed (sandbox is protected)` (or staging/main/develop) | ran on a shared line checked out | run from the PR branch — never push a row to a shared line |
| `not pushed (no upstream)` | the branch was never pushed, so there is no remote to push to | `git push -u origin <branch>` first, then run (or push after — the row IS committed) |
| `not pushed (the remote or a pre-push gate refused …)` | the row is committed; the push was refused | fix the refusal, `git push` yourself |
| `… (switched off)` | `E2E_LEDGER_COMMIT_OFF=1` / `E2E_LEDGER_PUSH_OFF=1` exported | unset it |

The push sends the whole branch, not just the ledger commit — anything else committed there goes
with it.

## 2 — Machine preconditions (all self-healing except one)

| Need | Made by | Manual? |
|---|---|---|
| Git hooks: `core.hooksPath = .githooks` | SessionStart banner runs `scripts/qa/install-hooks.sh` when unset; `npm install` (`prepare`) does the same | Only if hooksPath already points elsewhere → `bash scripts/qa/install-hooks.sh --force` |
| `keys/niete-local.env` | `bot/scripts/e2e/provision-local-keys.sh`, called by the banner, post-commit and `commit-e2e.sh` whenever the file is missing | **`railway login`** with an account that is a **member of the "NIETE-Rumi Staging" project** — the one thing nothing can create |
| `redis-server` | `commit-e2e.sh` runs `brew install redis` (or passwordless `apt-get`) | only without brew / sudo |
| `node_modules` matching the commit's lockfiles | `provision-local-modules.sh` builds a private tree keyed by the lockfile blob; never runs npm in the shared clone | no |

**Where the keys file is looked for:** `<main checkout>/keys/niete-local.env`, then the
`keys/` in the directory that contains the repo (`../keys/`). Same two places for `niete-sandbox.env`. Both gitignored, `0600`.

**Railway access is per account, not per login.** `railway login` succeeding means nothing if the
account was never invited to the project. The script reads service `bot` in **two** environments
of "NIETE-Rumi Staging": `sandbox` (the two Supabase lines) and `staging` (`R2_*`, `*_FLOW_ID`,
`PORTAL_URL`). Check on the laptop in question:

```bash
for e in sandbox staging; do railway variables -p "NIETE-Rumi Staging" -s bot --environment $e --kv >/dev/null 2>&1 && echo "$e ok" || echo "$e FAIL"; done
```

**The hooks swallow a provisioning failure into one banner line.** To see the real reason, run it
by hand from the NIETE-Rumi root and read the exit code (table in `reference/exit-codes.md`):

```bash
bash bot/scripts/e2e/provision-local-keys.sh; echo "exit $?"
```

**No Railway access at all?** Hand-place `keys/niete-sandbox.env` (only `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` of the sandbox project), get a teammate's staging dump
(`railway variables -p "NIETE-Rumi Staging" -s bot --environment staging --kv > team.kv`), then
`bash bot/scripts/e2e/provision-local-keys.sh --from-kv team.kv`. Both carry credentials: send
privately, never commit.

## 3 — Run it

From a git worktree on your branch — never a shared checkout other sessions are using:

```bash
bash .claude/qa/shared/commit-e2e.sh HEAD                     # the mock-capable features this commit touched
bash .claude/qa/shared/commit-e2e.sh <sha> --features menu    # one feature
bash .claude/qa/shared/commit-e2e.sh HEAD --all-mock          # every mock-lane feature, regardless of the diff
DEEP=1 bash .claude/qa/shared/commit-e2e.sh HEAD --features coaching   # walk the whole coaching pipeline
```

Exit `0` = it ran — **the verdicts are in the rows it prints, not the exit code**. `1` = the
Gherkin validator found errors, nothing driven. `2` = usage. `3` = the stack or run was blocked —
open the run log; the stack's own exit code names the cause (`reference/exit-codes.md`).

Then read each row's `ledger:` line: `committed, pushed` means the PR will read `recorded` on its
next check. Anything else → the link-4 table in §1. New cassette fixtures (§4) are **not**
auto-committed — commit them yourself.

## 4 — Recording vendor answers (cassettes)

The lane is sealed: `E2E_CASSETTE=replay-strict`, no vendor key in `niete-local.env`. A vendor call
(OpenRouter, Soniox, ElevenLabs) with no recording **throws `E2E_CASSETTE_MISS`**, is logged, and
makes the row `CRITICAL` naming the affected scenarios. It never goes live.

To fill the library once, with **live paid calls**:

```bash
bash .claude/qa/shared/commit-e2e.sh HEAD --features coaching --record           # record everything (forces DEEP=1)
bash .claude/qa/shared/commit-e2e.sh HEAD --features coaching --record-missing   # replay hits, record only the misses
```

Needs `keys/niete-record.env` with real vendor keys (+ `R2_*`); refuses (exit 2) without it.
Review the new files under `.claude/qa/fixtures/cassettes/`, then commit them.

---

## Gotchas — read before trusting a result

- **A PASS listed under `cassette.scenarios_affected` is not evidence.** The bot answered from its
  error path because a vendor answer was missing. Record the cassette, re-run.
- **Never hand-write a cassette.** A fabricated transcription or LLM answer makes the tests assert
  against invented data and hides real bugs. A cassette is only ever a real recorded answer.
- **`dirty` on a row describes the developer's tree, not the code under test.** The bot always ran
  from a clean detached worktree at `commit_sha`.
- **Flows are emulated, never rendered.** The emulator plays the client from the stored published
  `FLOW_JSON` (`.claude/qa/fixtures/flows/`) with real encrypted `data_exchange`; results carry
  `via: flow-emulator`. A component it does not model (PhotoPicker) is refused, not faked. Layout,
  truncation and RTL are **not** tested here — that is what the chrome lane is for.
- **Sandbox DB only.** `provision-local-keys.sh` and the DB tooling assert the sandbox project ref
  and refuse anything else (exit 3). Never "fix" that by pointing the file at staging or prod.
- **One synthetic driver per machine.** The driver number is derived from `hostname|user`
  (`mock_driver.py`); `E2E_MOCK_DRIVER` pins it. Two laptops never share rows on the sandbox DB;
  `driver_lock.py` only guards parallel runs on the same machine.
- **Hook switches must be exported** — an inline `VAR=1 cmd` is invisible to hooks.
  `QA_HOOKS_OFF=1` (git hooks silent) · `E2E_AUTORUN_OFF=1` (no Stop nudge) ·
  `E2E_AUTOFIX_OFF=1` (no auto-provisioning) · `E2E_CHROME_ON=1` (un-pause chrome).
- **A touched feature with no driver runs nowhere.** Its spec is auto-authored, but someone has to
  scaffold the driver: `python3 .claude/qa/shared/scaffold-driver.py <feature>`; add the
  `@mock-lane` marker once it drives via the mock API.
- **`local-stack.sh` absent = wrong branch, not a broken machine.** As of 2026-09-25 `main` carries
  the runner (`commit-e2e.sh`, `mock-api.cjs`) but not the stack (`local-stack.sh`,
  `mock-graph-api.js`, the Flow emulator, `build-info.js`) nor the hook registrations. Work from a
  `sandbox`-based branch.

---

## What's in reference/ — read the one you need, not all of them

| Read this | When |
|---|---|
| `reference/exit-codes.md` | a run, the stack, or provisioning exited non-zero and you need the cause and the fix |
| `reference/reading-a-row.md` | interpreting a `runs.jsonl` row, the PR comment's `recorded`/`missing`/📼 cells, or a `CRITICAL` status |
