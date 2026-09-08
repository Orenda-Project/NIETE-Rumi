# /niete-e2e — Run the NIETE (ICT) WhatsApp E2E suite

Run all ICT-region feature test cases against the NIETE bot via a linked WhatsApp Web
session, driven over the Chrome DevTools Protocol by `feature-runner.cjs` (one node process per feature — no MCP round trips). This drives the **real** bot and proves user-visible behaviour.

**Argument (`$ARGUMENTS`)** — optional:
- *(empty)* → run the **SAFE subset**: every `@e2e` scenario EXCEPT `@destructive` · `@slow` · `@wip` · `@first-use` · `@config-gated`, across all features.
- a **feature name** (any of, shown in run order: `registration` | `menu` | `training` | `lesson-plan` | `coaching` | `language` | `status` | `observe`† | `attendance`† — authoritative order via `feature-order.py`, §2) → run **that whole feature: EVERY `@e2e` scenario in its `.feature` file**, NOT the safe subset. Naming a feature turns off the default tag-exclusions and auto-applies the reversible `test_driver`-scoped seeds (§1b) so config/persona/seeded scenarios still run; a scenario is only skipped if it is genuinely un-runnable on the throwaway (shared-catalog/env seed a human must apply, or a mock-layer case) — and every skip is logged with its reason (§3), never silent. Unit/DB-backed scenarios in the file (e.g. `@coverage`, writer/clamp guards, corpus counts) are executed via their jest/DB path, not a WhatsApp drive. **†RUN-BY-NAME ONLY** — `observe` and `attendance` are excluded from `all` and only run when you name them; naming one still drives **every** `@e2e` scenario in its file. `observe`/`attendance` are code-grounded but not yet driven live (attendance: all `@wip`; observe: mostly `@wip`, the remainder `@config-gated`/`@first-use`), so the SAFE subset skips them entirely; run them **by name** to drive + promote them, and mind the special accounts (see the table).
- `all` → **maximum-runnable mode — EXHAUSTIVE, every scenario.** This is NOT a "core happy-path" or "one-per-feature" health check. `all` means: **enumerate every `@e2e` scenario in each feature file (via parse-gherkin, §2) and drive/account for each one INDIVIDUALLY** — each scenario gets its own PASS / FAIL / SKIP verdict with evidence in the report (§3). That is **98 runnable scenarios**: **menu 13 · training 23 · lesson-plan 10 · coaching 15 · registration 12 · status 4 · language 21**. **`all` covers those SEVEN features only** — **attendance and observe are excluded from `all` and run by NAME only** (operator, 2026-08-18): attendance because all 31 are `@wip` and need the principal persona; observe because all 29 are `@config-gated`/`@first-use` and need `role_switch.enabled: true`, which is `false` — both would otherwise pad the report with BLOCKED lines for preconditions nobody has set up. ⏱️ **Coaching IS in `all`** (operator, 2026-08-18) — budget for it: each of its 15 scenarios uploads real audio and waits ~10 min on analysis, so coaching alone dominates the wall-clock of an `all` run. These are the **full `@e2e` counts per file** — verify with `python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/<feature>.feature --tag @e2e` and treat that number, not this line, as authoritative if a file has changed. ⚠️ **These used to be the SAFE-subset counts** (training said 14), which silently capped `all` below exhaustive — corrected 2026-08-18. `all` is exhaustive **within its seven features**; it was never a claim to run every file in the directory. If your run touched fewer than the parse-gherkin count for a feature, you have not run `all` — go back and drive the rest. A teammate reading the report must see a line for every scenario, not a summary of "the core paths passed."
  - **What `all` runs:** the SAFE subset **plus** `@destructive` + `@slow` + `@known-fail`/`@known-issue` (these RUN — a passing `@known-fail` means the bug is fixed), **plus `@wip` / `@draft`** — these RUN too, and a passing `@wip` scenario should be **promoted** (drop the tag) in the same pass; `@wip` marks "not yet driven live", never "do not run", so leaving them out is exactly what makes `all` non-exhaustive (a tracked issue: 9 of training's 23 are `@wip`/`@draft`, and on 2026-08-18 **5 of those 9 passed** first time — exam→certify, certificate-by-code, Beacon House capstone, quiz resume, long-option render) — **plus** the `@seeded` scenarios whose prerequisite is a **test-driver-scoped, reversible seed** — auto-applied under `whatsapp-targets.yaml` → `standing_authorization` on **the run's resolved driver** (the runner's own linked number): e.g. first-use marker reset, `ur` language toggle. ⚠️ `@destructive`/`@slow` mutate the driver account's real state (training quiz progress, registration completion → blanks the account name, coaching 16-min upload → ~10-min analysis) — so run `all` on a **test/throwaway number you're fine resetting** (advice, not a block); prod needs an explicit per-action "go" (Rule 7).
  - **The ONLY legitimate SKIPs under `all`** (each logged in §3 with its exact reason — never silent, never counted as covered): `@config-gated` (needs a non-prod env with the flag *unset*); `@seeded` whose seed is a **shared-catalog write or env/deploy change** (R2-missing row · curriculum flag · `PIC_LP_FLOW_ID` — needs a human seed + go); a **catalog-gap negative** that the live catalog can't reproduce (e.g. LP "empty grade/subject" when every grade is populated — log which grades you probed); anything **not data-drivable** (a forced generation failure → jest/mock layer); and a **content/data gap in the target env** — the scenario's `Given` has no row to drive it and creating one is a shared-catalog write (e.g. training's "a PDF module" when the level holds only video/html modules, or the Urdu-question path when `training_questions.question_urdu` is NULL for every row). Log the query you ran to establish the gap, so it reads as evidence and not as a scenario nobody bothered with. `all` does **not** promote draft `observe`/`attendance` — those run only when named.


---

> ⚡ **How this runs since 2026-09-02 (PR #72, merged as `7b2260a`).** The suite is no longer driven
> step-by-step through the Chrome DevTools MCP tools. `feature-runner.cjs` opens ONE CDP socket to the
> WhatsApp tab, drives every `@e2e` scenario of a feature from `features/<feature>.cjs`, and writes
> `<feature>.json` + a `progress-<feature>.log`. Measured on staging: **all seven features, 96 scenarios,
> 22m22s** (registration 1.8 · menu 3.6 · training 4.7 · lesson-plan 5.0 · coaching-safe 1.5 · language 4.5 ·
> status 1.2) against the 3h33m MCP baseline. The deep coaching pipeline (`DEEP=1`) is ~20 min more. The
> MCP tools are not used at all; if `list_pages` says the browser is held by another session, that does
> not matter — the runner talks to port 9223 directly. Evidence and the harness findings that shaped this:
> `.claude/qa/results/whatsapp/niete/2026-09-02-premerge-pr72/{SUMMARY.md,FINDINGS.md}`.

## 0. Preconditions — STOP if any fail

> Run from the **root workspace**. The harness (`.claude/qa/shared/`), the feature drivers
> (`.claude/qa/shared/features/*.cjs`) and the `.feature` specs (`tests/features/whatsapp/niete/`) all
> live here — the suite is self-contained in this private repo. Node ≥ 21 (built-in `WebSocket`) and
> desktop Google Chrome are the only prerequisites.

- **Chrome with a DevTools TCP port — start it FIRST.** `chrome-devtools-mcp` launches Chrome with
  `--remote-debugging-pipe` (no port), which the runner cannot reach. So:
  ```bash
  bash .claude/qa/shared/start-chrome-cdp.sh          # CDP on 127.0.0.1:9223, profile ~/.cache/chrome-devtools-mcp/chrome-profile
  ```
  If Chrome is already up on that profile with the port, it just confirms `CDP already serving on 9223`.
  The WhatsApp link lives in the profile and survives restarts. Another Claude session holding the MCP
  handle to the same profile is fine — nothing here uses MCP.
- **Linked WhatsApp Web tab — PROVE it, never infer.** The WhatsApp page must exist as a CDP target AND
  be past the QR screen:
  ```bash
  node .claude/qa/shared/inject-wa-drive.js --port 9223 --quiet && echo linked-tab-ok   # exit 1 = no web.whatsapp.com target
  ```
  If there is no target, open `https://web.whatsapp.com` in that Chrome. If the page shows the **QR
  "Scan to log in"** screen, leave it up and ask the runner to scan it with the driver phone (Linked
  Devices → Link a device), then re-check. Only a QR nobody scans is a precondition failure — say so
  plainly and stop.
- **Driver resolution — ASK the runner, never assume a hardcoded number.** The driver is the
  WhatsApp account linked in this Chrome profile. `test_driver` in `whatsapp-targets.yaml` is `prompt`:
  ask the runner for THEIR OWN number (digits, no `+`) and use it for the whole run — it is what
  `E2E_DRIVER`, the driver lock, the DB lookups and the seed recipes bind to. Cross-check it against the
  page (`localStorage['last-wid-md']` in the WhatsApp tab holds `"<digits>:NN@c.us"`). The number never
  restricts which scenarios run.
  - ⚠️ **Heads-up, not a gate:** `all` (and the registration/language drivers even in the safe set)
    mutate the **driver account's** real state on the target env — registration completes then
    un-registers, language toggles then restores, training seeds revert. Use a number you are fine
    resetting; the drivers revert what they change, and the run reports anything they could not.
- **Target.** Resolve from [`.claude/qa/config/whatsapp-targets.yaml`](../qa/config/whatsapp-targets.yaml) (default profile `niete`).
  - ✅ **Default = staging `923222482222`** ("Rumi Staging Niete"). Staging runs the `develop` build of
    `Orenda-Project/NIETE-Rumi` and has its **own** Supabase (`rpqkekcfvumypldbejhp`, creds in
    `keys/niete-staging.env`, resolved by the DB tools even from a worktree). Seed / revert /
    destructive writes here never touch prod. Staging logs to Axiom `digital-coach-logs` as
    `service=="bot"` / `"sqs-worker"` with `env=="staging"` (region field `niete` inside `data_json`).
  - **Prod (`niete-prod` `923206281951`) is explicit opt-in only** — explicit "go" before any send
    (root CLAUDE.md rule 7), throwaway driver only, and `E2E_ENV=prod` so the DB tools resolve the
    prod ref (they abort on a mismatch).
- **The target chat must be OPEN in the WhatsApp tab.** The runner drives whatever chat is in `#main`
  and never switches chats itself. Open the bot's chat by its exact number (a **real** mouse click on
  its row over CDP — a synthetic `.click()` does not switch chats) and confirm the header reads the
  bot's display name before the first feature. Never drive a personal chat.
- **Nothing in flight on the driver account.** A coaching session left `initiated` /
  `awaiting_classroom_photo` / in analysis from a previous run defers the next upload (COA04 BLOCKED),
  and its late messages land mid-run and get picked as replies by other features. Run
  `node .claude/qa/shared/feature-runner.cjs reset-state` first (stops observation items through the
  `/status` Flow). A **coaching session** cannot be stopped through the product (the Flow offers no
  Stop row for it) — check `coaching_sessions` for the driver on the target DB and cancel stuck
  **test** sessions there before the run (staging: pre-authorised; prod: per-action go).
- **Persona / role resolution** is unchanged: scenario-level `@persona` > feature-level > `teacher`;
  one driver whose `users.role` is flipped per `role_switch` in `whatsapp-targets.yaml`, read back,
  mismatch = BLOCKED. `role_switch.enabled:false` today, so `observe`/`attendance` stay BLOCKED
  exactly as before (they also have no runner driver yet — see §2).

## 1. Setup — and the whole run — is ONE command

```bash
bash .claude/qa/shared/run-suite.sh all   --driver <digits>        # /niete-e2e all   → EVERYTHING (below)
bash .claude/qa/shared/run-suite.sh safe  --driver <digits>        # /niete-e2e       → the default subset
bash .claude/qa/shared/run-suite.sh lesson-plan,status --driver <digits>   # /niete-e2e <feature> → every scenario in it
#   --env prod --target 923206281951 (explicit go first) · --run-id <id> · --port 9223 · --no-seed · --reflect slash
```

`run-suite.sh` does §0's checks (CDP port, live WhatsApp target, the target chat open in `#main`,
driver lock) and stops with a `BLOCKED:` line if one fails; then preflight (run dir + `run.json` with
live counts + `wa-drive` injected), the feature loop of §2 in `feature-order.py` order with a
`reset-state` after menu and after coaching, and finally `build-per-scenario.py` → `PER-SCENARIO.md`.
It runs 20–45 min, so start it **in the background** and watch `$RUN_DIR/runner.log` (one line per
feature with its wall time and every non-PASS row) and `progress-<feature>.log` (every send, wait and
Flow op, timestamped). The driver lock is released on exit, crash included.

**What `all` does that `safe` does not** — all on the driver account, target env only, reversible,
and each step is logged in `runner.log`:
- stuck coaching sessions on the driver are cancelled in the DB first (`niete_coaching_db.py
  cancel-stuck`) — the product has no exit for them and one in flight defers the next upload;
- coaching runs `DEEP=1` (real 16-min upload, the 5-step pipeline, report, reflective step, commitment
  card — ~20 min; `--reflect slash` takes the COA10 branch instead of COA06);
- training runs on a reverted Level 0 (`revert-level 1` before, `seed-level-complete 1` after) so the
  module-check cluster is reachable;
- registration completes the destructive Flow and un-registers afterwards; language toggles and
  restores. Nothing else differs — the drivers already run `@known-fail`/`@known-issue` in every mode.

If you must run a feature by hand (a repro, or after a crash mid-suite), the underlying call is:
```bash
export RUN_DIR=.claude/qa/results/whatsapp/niete/<run-id> E2E_ENV=staging E2E_DRIVER=<digits>
E2E_PROGRESS="$RUN_DIR/progress-<feature>.log" node .claude/qa/shared/feature-runner.cjs <feature>
```
after `python3 .claude/qa/shared/driver_lock.py acquire --driver <digits> --run-id <run-id>`. A page
reload drops `window.__wa`; the runner re-injects it at process start, so `inject-wa-drive.js` is only
needed when hand-driving outside the runner.

## 1b. Maximum-runnable mode (arg = `all`)

Only when the argument is `all`. Precondition: an explicit prod "go" if targeting prod. Runs on the
run's resolved driver, which never restricts what runs. ⚠️ `all` mutates that account's real state,
so use a test/throwaway number you are fine resetting (advice, not a block).

- **`@destructive` / `@slow`** run. The drivers revert what they can: registration snapshots the
  user row and un-registers at the end; language restores the pre-run `preferred_language` through
  the bot itself; training state goes through `niete_training_db.py` and must be put back.
- **Coaching's deep set** (`@wip/@slow` — the 5-step pipeline, report, reflective step, commitment
  card) runs only with `DEEP=1`; `REFLECT=slash` swaps COA06 for COA10. Budget ~20 min and start
  with nothing in flight (§0).
- **Training's module-check cluster** (T01/T10/T12/T19/T20/T22, and T11) needs an account with an
  in-progress level: `niete_training_db.py revert-level --level 1 --yes-write` (NIETE Level 0 is
  level id 1), then `seed-level-complete --level 1 --yes-write` afterwards. ⚠️ Even so, the training
  driver records these BLOCKED today — it has **no module-check implementation yet**
  (`training.cjs:191`); the picker state is verified (exactly one "▶ Next up"), the quiz is not driven.
  Treat those seven as "not yet automated", not as account-state skips.
- **`@seeded` — `test_driver_scoped` / `discovery_only`** → auto-apply the reversible recipe under
  `standing_authorization`, read back, drive, REVERT. **`@seeded` — `gated`** (shared-catalog write ·
  env/deploy change) → do NOT apply; record BLOCKED with the exact seed a human must run.
- **`@config-gated`, `not_seedable`, draft `@wip` observe/attendance** → BLOCKED with the reason
  (env-only · mock-layer · run-by-name-only, and no runner driver exists for observe/attendance).

`niete_training_db.py` (reads free, writes need `--yes-write`, aborts if the resolved Supabase ref
does not match `--env`): `lookup` · `answer-key --grand-quiz N` · `seed-level-complete --level N` ·
`revert-level --level N` (progress, certificate AND attempts — clears a 24h cooldown) ·
`activate-program` · `seed-module-pass`. Always revert what you seed before the run ends.

## 2. Run each feature

**Order — the single source of truth is the `order:` value in each agent's frontmatter**
(`.claude/qa/agents/niete-<feature>-agent.md`). Get it at run start and run in exactly that sequence,
for the safe run and for `all` alike (the argument changes which scenarios are included, never the order):
```bash
python3 .claude/qa/shared/feature-order.py      # today: registration · menu · training · lesson-plan · coaching · language · status · observe · attendance
```

**One process per feature — `run-suite.sh` (§1) does this loop for you.** Under the hood it is
`node .claude/qa/shared/feature-runner.cjs <feature>` per feature, sequentially, `DEEP=1` on coaching
under `all`, with `reset-state` after menu and after coaching (the two features that leave work in
flight). Each feature writes `$RUN_DIR/<feature>.json`: `wallMs`, `perScenarioSec`, `botWaitStats`,
and one `results[]` row per scenario `{id, name, verdict, evidence, ms}`; `progress-<feature>.log`
timestamps every send, wait and Flow op, which is how a stuck open or a mis-picked reply is diagnosed
while the run is still going.

| Feature | Spec | Driver | Agent (procedure notes, live gotchas) |
|---|---|---|---|
| Registration | `registration.feature` | `features/registration.cjs` | `niete-registration-agent` |
| Menu (+ Ask Anything) | `menu.feature` | `features/menu.cjs` | `niete-menu-agent` |
| Teacher Training | `training.feature` | `features/training.cjs` | `niete-training-agent` |
| Lesson Plans | `lesson-plan.feature` | `features/lesson-plan.cjs` | `niete-lesson-plan-agent` |
| Classroom Coaching | `coaching.feature` | `features/coaching.cjs` (`DEEP=1` for the pipeline) | `niete-coaching-agent` |
| Language | `language.feature` | `features/language.cjs` | `niete-language-agent` |
| /status | `status.feature` | `features/status.cjs` | `niete-status-agent` |
| in-flight reset (utility) | — | `features/reset-state.cjs` | — |
| /observe · Attendance — **DRAFT @wip, no driver yet** | `observe.feature` · `attendance.feature` | none — hand-drive by name (below) | `niete-observe-agent` · `niete-attendance-agent` |

The agent files remain the **procedure notes and live-learned gotchas** for each feature (what the
copy really says on staging, which states swallow free text, which answer keys are illustrative).
Read the feature's agent before judging a FAIL; the driver encodes the mechanics, the agent explains
the surface. Where a driver and an agent disagree on an expected string, the live evidence in the
JSON wins and the stale one gets fixed.

**List a feature's scenarios first — and under `all`, this list is your checklist.**
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/<feature>.feature --tag @e2e
```
A driver records a row for every scenario it knows about, including BLOCKED rows with the reason
(account state, `@wip`, no fixture, not automated). A scenario in the `.feature` file with **no row in
the JSON** is a driver gap: record it `NOT DRIVEN` in the report and file it — never let the JSON's row
count stand in for the spec's count (`check-all-mode-counts.py` cross-checks).

**Hand-driving anything the drivers do not cover** (observe, attendance, a one-off repro) uses the same
CDP layer, not MCP: `node .claude/qa/shared/flow-drive.js probe|click --match <re>|screen` for the Flow
iframe, and `window.__wa.*` (`sendAndWait`, `tap`, `pickListRow`, `readLast`) evaluated in the page for
chat. Rules the runner learned the hard way, which apply to hand-driving too:
- **A Flow screen transition replaces the iframe's execution context.** Re-attach before every op and
  prove the target answers (`evaluate('1')`); a stale socket returns instantly with nothing and looks
  like success. A closed Flow's target lingers in `/json/list` — take the newest live one.
- **After a click, wait for the screen text to CHANGE** before probing; a probe 8 ms later returns the
  previous screen.
- **The Flow header has two `aria-label="Cancel"` buttons; the first is zero-width.** Click only a
  control with a visible box.
- **Media upload**: Attach → **Document** for audio (the "Audio" item silently fails); the file chooser
  is intercepted over CDP. Fixtures live in `.claude/qa/fixtures/whatsapp/niete/media/` — never in a
  results dir (untracked, empty on any other machine).
- **Pace bursts of Flow-card sends** (≥ 15 s apart): five inside 40 s trips Meta `#131056` pair rate
  limit and the card never arrives — and the bot currently sends no fallback text when that happens.
- **`@known-fail` / `@known-issue` still run** — report the real status (L09's photo dead-end is FIXED as
  of 2026-09-02; the spec should flip).

**Known limits of the runner (read before calling a FAIL a bug):**
1. **Reply picking** waits for two new message ids, so an **unsolicited** bot message landing between
   send and reply (coaching sweeper, the 30 s LP feedback prompt, a pipeline completing from an earlier
   session) is taken as the reply. Every false negative on the 2026-09-02 timed run was this (M03, T02,
   LANG01/12, STA-surface). Cross-check the scenario's window in Axiom before filing.
2. **State leaks between features**: any `/menu` leaves `awaiting_menu_selection`, which answers free
   text with the "(1-4)" nudge; menu M03 leaves coaching `AWAITING_CLASSROOM_AUDIO` (6 h). The
   lesson-plan and language drivers now enter Ask Anything / run `reset-state` first; a free-text
   scenario elsewhere that "passes" with a nudge as its reply has not been tested.
3. **Training module check not automated**; **coaching COA08** leaves the photo gate open (never taps
   "مکمل"), so the DEEP pipeline does not reach transcription until that is fixed.

## 2b. Cost gate — the run is also judged on what it cost

`validate-run.py` asks *did you drive every scenario?*; `run_efficiency.py` asks *what did it cost?*. Neither changes a verdict. With the runner, the primary cost ledger is in each
`<feature>.json` (`wallMs`, `perScenarioSec`, `botWaitStats` from `wa.stats()`); the reference points
from the 2026-09-02 run are the table at the top of this file (≈ 14 s per scenario, 22 min for the safe
set of seven). A feature taking ≥ 2× its reference is worth a look at its `progress-*.log` before the
next one starts — a 75 s `FLOW_READY_TIMEOUT` or a 150 s wait for a reply that never comes is the
harness, not the bot, and is exactly what the 2026-09-02 findings were about.

```bash
python3 .claude/qa/shared/run_efficiency.py "$RUN_DIR"     # still runs; snapshot budgets are moot (the runner takes none)
```

## 3. Report

### `PER-SCENARIO.md` is generated — check it, don't type it

An `all` run's report must account for **all 98** `@e2e` scenarios across its seven features — one
row each, PASS / FAIL / SKIP with a reason. `check-all-mode-counts.py` keeps this number, the per-feature
list in the `all` spec above, and the `.feature` files in agreement; update all three in one pass.

`run-suite.sh` ends by running `python3 .claude/qa/shared/build-per-scenario.py "$RUN_DIR"`, which
turns the `<feature>.json` files into the shape the artifact builder consumes. One section per feature,
one row per scenario, straight from `results[]`; the section count is the `.feature` file's `@e2e`
count and a driver that has fewer rows than the spec gets a ⚠️ line under its table:

```markdown
## 3. training (23)
| id | scenario | tags | verdict | waited | evidence |
|----|----------|------|---------|--------|----------|
| T01 | A teacher works through Teacher Training end to end | @quiz @P1 | BLOCKED | — | no module-check driver yet |
```
- Header `## <n>. <feature> (<count>)` — `<count>` is the `.feature` file's `@e2e` count, not the JSON's
  row count; add a `NOT DRIVEN` row for any spec scenario the driver has no row for.
- Ids match `^[A-Z]{1,4}-?\w{1,12}$` as the drivers emit them (`R01`, `M12`, `L03`, `T09-ladder`,
  `COA04`, `LANG12`, `STA-surface`). The verdict opens with `PASS` · `FAIL` · `BLOCKED` · `SKIP` ·
  `ERROR` · `DEFERRED` · `NOT DRIVEN` (`PASS → PROMOTE` for a promoted `@wip`). A `RUNNER ERROR` row
  means the feature aborted — the scenarios after it are `NOT DRIVEN`, not passed.
- Put the one-line evidence from the JSON in the last column (reply head, DB fields, Flow screen);
  Urdu is set in Nastaliq automatically.

### Gate, then publish

```bash
python3 .claude/qa/shared/validate-run.py "$RUN_DIR"          # exit 1 = do not publish
python3 .claude/qa/shared/parse-per-scenario.py "$RUN_DIR"
python3 .claude/qa/shared/build-run-artifact.py "$RUN_DIR"
python3 .claude/qa/shared/driver_lock.py release --driver <digits>
python3 .claude/qa/shared/preflight.py "$RUN_DIR" --finish
```
then republish the ONE living suite page with the Artifact tool using the recorded `url`
([`.claude/qa/ARTIFACT.md`](../qa/ARTIFACT.md)) — publishing without `url` forks the team's link.
Write `findings.json` in the run dir first (critical / new / fixed / unverified / harness).

Consolidated report rules (unchanged in substance):
- **Under `all`: one line PER SCENARIO**, every feature; per-feature subtotals on top, not instead.
  `check-all-mode-counts.py` confirms the per-feature numbers still match the `.feature` files.
- Overall verdict: `HEALTHY` (all pass) · `DEGRADED` (1–2 fail) · `CRITICAL` (3+ fail or any BLOCKED
  that is not a documented account-state / not-automated / config gap).
- **Separate harness verdicts from product verdicts.** A FAIL whose evidence is a nudge, a coaching
  interstitial, a `FLOW_*` harness error or a 1 ms Flow op is the runner, not the bot — say which, with
  the Axiom row that proves it. The 2026-09-02 `FINDINGS.md` is the worked example.
- **Bugs**: any `@known-fail` that failed, anything new, and any `@known-fail`/`@known-issue` that
  PASSED (the bug is fixed — flip the spec).
- Log every BLOCKED / SKIP with its reason; under `all` the default-run exclusions are not reasons.
- Update `_suite.md` "Last run" on a full pass.

---

## Which feature(s) does my change need? — targeted selection

You rarely need the whole suite. **A commit or a deploying push auto-runs the affected
feature(s)** — you don't have to ask for it:

```
commit or push → changed files → feature map → selected features → the agent runs them
```

Two hooks do this ([detail](../../docs/qa-automation.md)):
`e2e-autorun.sh` (PostToolUse) arms the run and hands the agent the commands; `e2e-autorun-stop.sh`
(Stop) refuses to let the turn end until they've run. A PostToolUse hook cannot compel a
follow-up action — `Stop` is the only event that can — which is why it's a pair. It nudges
**exactly once**. Off: `export E2E_AUTORUN_OFF=1`. Full suite instead of the selection:
`export E2E_AUTORUN_ALL=1` (arms `/niete-e2e all` — hours, opt-in for that reason).

**A COMMIT-TRIGGERED RUN CANNOT TEST THE COMMIT.** Nothing is deployed by a commit, so the run
drives the build that was already live. That is a real regression check and it is worth having;
it is not evidence about the change just made, and the hook says so in the order it emits.
A deploying push (`develop`/`main`/`staging`) is the one trigger where the run tests the change —
and even then it fires the moment the push returns, while the build is still going, so confirm
what is live before trusting a pass.

**The drive still needs a linked WhatsApp Web session and Chrome on port 9223.**
The hooks guarantee you're *asked* and can't quietly skip; they can't scan a QR code.

Feature-branch *pushes* don't arm (nothing deploys) — but a commit on any branch does, since a
commit deploys nothing regardless of branch. A commit made from a plain terminal arms too, through
`.githooks/post-commit` (installed by `npm install` / `bash scripts/qa/install-hooks.sh`): it writes a
`git-<sha>` marker that the next Claude session in that clone announces at start and is held for once.
A push to `develop`/`main` also gets a pre-push report of affected features and spec freshness
(`.githooks/pre-push`) — see [`docs/qa-automation.md`](../../docs/qa-automation.md).

Run it yourself any time, without pushing:

```bash
# what the current branch would earn
python3 .claude/qa/shared/select_e2e.py --repo .

# an arbitrary range, or explicit paths
python3 .claude/qa/shared/select_e2e.py --repo . --range 'origin/develop...HEAD'
python3 .claude/qa/shared/select_e2e.py bot/shared/services/menu.service.js
python3 .claude/qa/shared/select_e2e.py --repo . --json    # machine-readable
```

The map is [`.claude/qa/config/feature-map.yaml`](../qa/config/feature-map.yaml) — **hand-
maintained on purpose.** The `.feature` files carry incidental code groundings in comments
(`menu.service.js:265`), but their density is wildly uneven (language 22, observe 21, versus
status 2 and training 3), so inferring the map would under-select exactly where the suite is
thinnest.

Five verdicts per changed path:

| Verdict | Means | Selects |
|---|---|---|
| **MAPPED** | a rule claims it | that feature (a `shared:` file fans out to several) |
| **spec** | `tests/features/whatsapp/niete/<name>.feature` changed | `<name>` |
| **UNMAPPED** | in scope, no rule claims it | **the SAFE subset, as an explicit fallback** |
| **NOT COVERED** | real surface, deliberately no E2E (reading, video, homework) | nothing — reason printed |
| outside the bot runtime | `portal/**`, `dashboard/**`, `infrastructure/**` | nothing |

**Two things to know before you trust it.**

1. **The fallback is additive, not a substitute.** An unmapped file prints `/niete-e2e`
   (SAFE subset) *plus* whatever features were narrowed. Under-selection is never silent —
   if you see the fallback, add the file to the map and it narrows next time.
2. **It selects; it does not run.** Nothing is driven automatically: the runner needs the
   linked Chrome (§0), the driver number is asked for at runtime (`test_driver: prompt`),
   and the hook fires *before* the push, when staging still has the old code. **Run the
   printed commands after the deploy is live** — running them earlier tests the old build
   and green-lights a change that never ran.

The map keys must match the nine agents exactly; a key with no agent raises `MapError` rather
than quietly selecting nothing. Tests: `python3 .claude/qa/shared/test_select_e2e.py`.

---

## Reference
- Suite index + durable findings: [`tests/features/whatsapp/niete/_suite.md`](../../tests/features/whatsapp/niete/_suite.md)
- Runner: [`.claude/qa/shared/feature-runner.cjs`](../qa/shared/feature-runner.cjs) · drivers `features/*.cjs` · Flow layer `flow-lib.cjs` / `flow-drive.js` · chat layer `wa-drive.js`
- Why it is built this way: the 2026-09-02 harness findings (upstream workspace PR #72; the FINDINGS.md of that run lives in its results dir, which is gitignored)
- Method history (the MCP step-by-step how-to, kept for hand-driving primitives): [`chrome-mcp-whatsapp-e2e`](../skills/chrome-mcp-whatsapp-e2e/SKILL.md)
- Known env caveat: repo `.env.template` ≠ prod runtime — assert against the running env (bit us on `/portal`, LP flow, registration, `/status`).
