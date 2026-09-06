---
name: niete-training-agent
description: NIETE (ICT) WhatsApp E2E agent for the Teacher Training surface. Self-contained — resolves the target, loads @e2e scenarios from training.feature, drives them via Chrome MCP against a linked WhatsApp Web session, and returns JSON. NO prompts.
order: 3
feature: tests/features/whatsapp/niete/training.feature
---

# NIETE — Teacher Training E2E Agent

Execute `@e2e`-tagged scenarios from **`training.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its
full run procedure; there is no shared surface executor.
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.

## Learned live (2026-08-23) — read before driving quizzes

- **`correct_option` is 1-BASED.** Proven two ways: every verdict across 6 driven questions is
  consistent with 1-based and inconsistent with 0-based, and a sweep of all 2,534 rows finds ZERO
  out of range under 1-based (under 0-based the 175 rows with `correct_option='4'` on 4-option
  questions would all overflow). Do not "fix" a grader that is behaving correctly.
- **Displayed option order is deliberately permuted** (`buildOptionDisplayOrder` in
  `quiz-delivery.service.js`), so the on-screen A/B/C/D will NOT match the DB array order. Match the
  answer by TEXT, never by position.
- **Read options from the MESSAGE, not the picker dialog.** When options are long the dialog renders
  as literally `Answer / A / B / C / D` with no text at all; the chat message always carries them in
  full. (That truncation is itself a filed bug.)
- **The module check grades PER QUESTION now** ("Correct" / "✗ Not correct." after each), then gives
  a final "Module check — passed/not quite … N/3". The older all-then-grade note is stale.
- **Seeds make the exam reachable** — `niete_training_db.py seed-level-complete --level N` marks
  every module done so the grand quiz unlocks (this is what turns T5/T6/T16 from BLOCKED into
  runnable); `revert-level --level N` undoes progress, certificate AND attempts, which also clears a
  24h cooldown. NIETE Level 0 is level id **1**. Always revert what you seed.
- **The exam header disagrees with the ladder** — the ladder says "Level 0 · Aspiring Teacher", the
  exam says "Level 1 · Aspiring Teacher" (header prints the DB id, ladder prints `order_index`).
  Same level; don't chase it as a data bug.
- **MSQ questions live only in level 17 (GBTLA/Oxbridge)**, not in the NIETE ladder — so the
  multi-select Flow path is NOT reachable on a NIETE-only driver.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from the `Feature:` line of
   `tests/features/whatsapp/niete/training.feature` (fallback: `default_profile` in
   `../config/whatsapp-targets.yaml`). Uppercase for reporting.
2. **Load target** — `../config/whatsapp-targets.yaml` → `profiles.niete` → `{number, env, method}`.
   If `method: baileys`, defer to the Baileys runner (headless; read-assertions + dispatch
   only — cannot drive native Flows). This agent covers `method: chrome`.
3. **Open WhatsApp Web** — `list_pages`; else `navigate_page(url='https://web.whatsapp.com')`.
4. **Verify linked** — `take_screenshot`. QR screen → return `BLOCKED` ("link session"). Chat list → OK.
5. **Open bot chat** — `fill` search with `number` → `click` the result → confirm header.
6. **Check the driving helpers are loaded** — `evaluate_script`: `typeof window.__wa`. It is
   normally **already injected for you** over CDP by `preflight.py` at run start,
   because this step being an instruction rather than a fact is what produced the 4h23m run of
   2026-08-21 and `"wa_drive_loaded": false` on 2026-08-25. If it reports `undefined` — a page
   reload drops it — re-inject with
   `node .claude/qa/shared/inject-wa-drive.js --run-dir <run-dir>`, or paste
   [`../shared/wa-drive.js`](../shared/wa-drive.js) via `evaluate_script`. Everything below assumes `wa.*` exists. Use `wa.sendAndWait(text)` (send + submit + wait
   in ONE round-trip); if you use the three-call form, **pass the baseline `wa.send()` returned** into
   `wa.waitForNew(baseline)` — passing `null` re-reads the baseline after the reply may already have
   landed and you then wait the full timeout for a message already on screen. Never write a fixed
   sleep. Read the **Speed contract** at the top of the
   [interaction map](../shared/whatsapp-interaction-map.md) before the first send.
7. **Snapshot to a FILE, then grep it** — `take_snapshot(filePath="<run-dir>/snap_<what>.txt")` and
   pull the uid out with `grep`. A country or module list is thousands of tokens and you almost
   always need one uid from it. Dumping snapshots inline is what made the 2026-08-21 run cost
   146 snapshots / 2.5 MB; the same suite cost 80 / 0.7 MB when written to disk.
8. **Lean snapshots** — inject `#side{display:none}` (add `#main{display:none}` inside a Flow iframe).
9. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:training`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/training.feature --tag @e2e
```
Execute every returned scenario. Skip untagged. `@chunk` = backend-only → `BLOCKED`.
**`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run". Recording them as `BLOCKED reason:wip` under `all` is what made a whole run non-exhaustive. `@known-fail` / `@known-issue` always run — report the REAL status; a passing `@known-fail` means the bug is fixed and the spec is stale. `@known-fail` / `@known-issue` still
run — report the real status.

## Step 2: Execute — drive the Flow as a navigation graph, NOT per-scenario

Teacher Training lives in a cross-origin Flow iframe: `evaluate_script` cannot reach Flow
controls, so **each Flow screen costs a `take_snapshot` → find uid → `click` → `take_snapshot`**.
Re-opening the Flow for every scenario multiplies that cost — it is the sole reason this suite
is slow (not bot latency). So: **open the Flow once, walk each position once, and read every
co-located scenario's assertion from that position.** This is an execution optimisation only —
scenarios stay fully independent (each still emits its own PASS/FAIL/BLOCKED + duration +
evidence), the `.feature` is unchanged, assertions are never weakened, and expected values
still come from [`answer-keys.yaml`](../fixtures/whatsapp/niete/answer-keys.yaml) (never inlined).
Use the [interaction map](../shared/whatsapp-interaction-map.md) for every send/read/tap/Flow step.

### 2.0 — Classify every loaded scenario BEFORE opening the Flow
For each scenario from Step 1, with NO navigation yet:
- **Excluded by tag** → ONLY when the run was **not** invoked with `all` **and** the feature was
  **not** named explicitly. In that default/safe mode, `@wip`, `@draft`, `@destructive`,
  `@config-gated` and `@first-use` record `BLOCKED`, `error: "excluded by tag (<tag>)"`, and **do
  not navigate**. (`@known-issue` / `@known-fail` still run — report their real status.)
- **Under `all`, or when this feature is named (`/niete-e2e training`), NOTHING is excluded by tag —
  drive all 23 `@e2e` scenarios.** `@wip`/`@draft` mean "not yet driven live", not "skip": run them
  and **promote** any that pass (drop the tag). Verify the expected count with
  `parse-gherkin.py … --tag @e2e | jq .count` rather than trusting a number in prose — if you
  accounted for fewer than that, the run is not `all`. The only legitimate non-runs are the
  ones §3 makes you justify in writing: a **shared-catalog/env seed a human must apply**, or a
  **content gap in the target env** — e.g. on 2026-08-18 staging held 43 video + 3 html and **zero PDF**
  modules (so "A PDF module arrives as a document" had nothing to drive) and `question_urdu` was NULL
  for every row (so the Urdu-question scenario had no data). Log the query that establishes the gap.
- Otherwise assign a **Flow position** from the scenario's Given/steps:

  | Position | Needs | Signals in the steps |
  |---|---|---|
  | `chat` | only a command + chat reply (no Flow) | `send "/…"`, certificate, alias, two-word phrase, mid-conversation, unregistered number |
  | `program` | programme + level ladder | "choose the … programme", "level ladder", "locked level", "Open level" |
  | `level0` | Level 0 detail (read-only) | "Level 0 details", "grand quiz", "exam caption", "module … further down" |
  | `module` | a module opened / a quiz answered | "module check", "Take quiz", "answer …", "next module", "next-up module" |

  Ambiguous → pick the **deepest** position its steps require. Build the run order:
  `chat` → `program` → `level0` → `module`.

### 2.1 — Run the `chat` group first (no Flow, cheapest)
Each is a single send → read. Drive with the interaction map's send + ONE batched
`evaluate_script` that reads the last rows AND asserts, returning `{pass, actual, expected}`.
No `take_snapshot`. Record each scenario's result.

### 2.2 — Open the Flow ONCE, then walk the positions in order
1. Send `/training`; tap the **Open** CTA with a real MCP `click(uid)` (a synthetic `.click()`
   does NOT open a native Flow). Inject `#main{display:none}` (keep `#side` hidden) so every
   Flow snapshot is ~20 lines, not the whole scrollback.
2. **`program` position** — ONE `take_snapshot` at the programme/level-ladder screen. Run the
   whole `program` group from it. **Order read-only assertions before mutating ones:** assert
   the ladder (Level 0 in-progress + Levels 1–3 locked) first; then select a locked level (the
   "selectable client-side" assertion); then tap "Open level" (the server-reject assertion)
   **last**, because it changes the screen.
3. **`level0` position** — navigate programme → open Level 0 (ONE `take_snapshot`). The whole
   `level0` group is **read-only** (grand-quiz-locked, exam caption, refuse-to-start,
   later-locked-module) — inspect that single Level-0-detail snapshot; **do not start a quiz.**
4. **`module` position** — open the next-up module (ONE `take_snapshot`). Complete the quiz
   **once** for the pass scenarios and assert BOTH "next module unlocked" and the
   "Module check — passed" copy from that single run. For a FAIL scenario (wrong answer), open a
   **different** module so the pass module isn't consumed, and answer wrong.

### 2.3 — Snapshot discipline (per screen)
ONE `take_snapshot` per screen; reuse its uids for every read/click on that screen. Take a fresh
snapshot ONLY when the screen changes, new controls appear, or a prior uid goes stale ("not
interactive"). Never re-snapshot just to "refresh" an unchanged screen. Chat reads use
`evaluate_script`, never a snapshot.

**MANDATORY lean-Flow rule (measured live 2026-08-04, ~70× smaller snapshots).** The Flow overlay
(`iframe.flows-iframe`) is a sibling of the chat, NOT inside it — so hiding the chat does not hide
the Flow. Once the Flow is open, inject BOTH before every in-Flow snapshot:
```js
// evaluate_script — re-assert immediately before EACH Flow snapshot (WhatsApp purges it on re-render)
() => { let s=document.getElementById('e2e-hide')||Object.assign(document.createElement('style'),{id:'e2e-hide'});
        s.textContent='#side{display:none!important;} #main{display:none!important;}';
        document.head.appendChild(s); return true; }
```
With `#main` hidden the snapshot drops from ~1,900 lines (whole chat scrollback) to ~20–30 lines
(just the banner + iframe controls). **Re-assert it every time** — the style is stripped on
re-render, so a hide done once does NOT persist (this silently defeated the old `#side`-only rule).
**Restore `#main` (`s.textContent='#side{display:none!important;}'`) before reading a chat reply**
after a Flow submit (the reject/result posts to chat, not the iframe). The one unavoidable full-chat
snapshot per Flow-open is finding the "Open" CTA uid (a native Flow needs a REAL MCP `click(uid)`);
minimise those by opening the Flow rarely (§2.2 amortisation) and ordering read-only positions
before any submit that closes the Flow.

### 2.4 — Minimal quiz execution
Only scenarios that genuinely require answering questions drive a quiz (module pass, module
fail). Scenarios that verify copy / captions / labels / locked states / CTA text **navigate and
inspect only** — never start a quiz.

### 2.4a — @destructive seeded scenarios (grand quiz → certify → certificate → cooldown) — REPEATABLE

> **`--env` IS MANDATORY — the DB must be the one the bot under test runs on.**
> `niete_training_db.py` resolves creds per `--env` (`staging` → `keys/niete-staging.env`,
> project `rpqkekcfvumypldbejhp`; `prod` → `keys/niete-prod.env` or the repo-root `.env`, project `ihzciabopbttygxxgrkm`)
> and prints `env=… project=…` on stderr before acting. Omitting `--env` falls back to the env
> of `default_profile` in `whatsapp-targets.yaml`, which is STAGING. It **aborts** if the
> resolved project ref contradicts the env, so a staging run can no longer silently seed prod
> — the original bug: the tool read the repo-root prod `.env` unconditionally, so every "seed" during
> a staging run wrote to PROD and changed nothing in the bot being driven.
These run ONLY on the throwaway `test_driver` (never a real teacher), and they need a DB seed +
the DB answer key. The whole thing is encoded — **do NOT improvise it**:

1. **Resolve IDs** (read): `python3 .claude/qa/shared/niete_training_db.py lookup --env <env> --phone <driver>`
   → grab the user id, the in-progress level id (e.g. Aspiring Teacher = level 1), its grand-quiz id.
2. **Unlock the exam — #3/#9 precondition** (WRITE, operator-gated):
   `python3 .claude/qa/shared/niete_training_db.py seed-level-complete --env <env> --phone <driver> --level <id> --yes-write`
   Marks every module of that level done → `/training` → level shows "N/N courses ✓ · Ready for exam".
   **Run it with `--yes-write` AUTOMATICALLY — do NOT pause to ask.** Per `whatsapp-targets.yaml →
   niete-prod.standing_authorization` (operator, 2026-08-06: "don't re-ask for the seed step"), the
   reversible training seeds (`seed-level-complete` / `revert-level` / `activate-program` / role flip /
   language toggle) on **the run's resolved driver** (the runner's own linked number, resolved via the
   § Driver-resolution precondition) are pre-approved — the number never restricts the run. Always print
   what was written + the revert command. Anything outside that scope (OTHER accounts than the run's driver,
   prod-user data, outward sends, schema, irreversible writes) is STILL a per-action go.
3. **Fetch the answer key** (read):
   `python3 .claude/qa/shared/niete_training_db.py answer-key --env <env> --level <id>` → prints `[{q,correct}]`
   (`correct_option` is 1-based → resolved to option TEXT).
4. **Drive the exam** (Chrome-MCP): open the level → **Start exam** (hands back to chat), then paste
   [`grandquiz_exam_drive.js`](../shared/grandquiz_exam_drive.js), call `window.__gqInit(<answer-key JSON>)`,
   then loop `await window.__drive(n)` for each served question. Options SHUFFLE and render two ways
   (long → inline-lettered in the body; short → dialog rows) — the helper matches by TEXT. On a
   prefix-collision `noMatch` (e.g. the rhyming-words "sequence" questions share a stem), read the
   served options and `await window.__pickLetterSend('<letter>')`.
   - **#3 (pass/certify):** answer all correct → "Congratulations… passed … Certificate code: NIETE-…"
     + a certificate PDF. **#4:** send `/certificate <that code>` → expect the PDF document.
   - **#9 (fail → cooldown):** deliberately answer < the pass mark → "not quite" + `cooldown_until`
     set ~24h. #3 and #9 are **mutually exclusive on one attempt** — run #9 first, verify the lock,
     then `revert-level` (below) to re-enable, then #3.
5. **Revert when done** (WRITE, operator-gated, optional): 
   `python3 .claude/qa/shared/niete_training_db.py revert-level --env <env> --phone <driver> --level <id> --yes-write`
   deletes the seeded progress + the certificate + the attempt, returning the account to pre-seed state.

Vendor-programme scenarios (#2 PDF / #5 Beacon House / #6 Oxbridge / #15 6-level) need the
multi-vendor programme active: `niete_training_db.py activate-program --env <env> --phone <driver> --program-key niete_standard --yes-write`
(reversible: set `is_active=false`). `niete_standard` is scoped to all three vendors, so opening it
exposes Beacon House + Oxbridge levels. Full IDs + rationale in
[`../fixtures/whatsapp/niete/training-seed-plan.md`](../fixtures/whatsapp/niete/training-seed-plan.md).

### 2.5 — Scenario independence + shared-failure propagation
Never merge scenarios: each emits its own `PASS | FAIL | BLOCKED`, `duration_ms`, and (on FAIL)
evidence. If a **shared navigation step fails** (Flow won't open, a position is unreachable),
mark EVERY scenario at and below that position `BLOCKED` with the SAME `error` (the root cause) —
do NOT silently skip them. Attempt **one** recovery (re-open the Flow / re-navigate) before
failing a position. Re-open the Flow only when it exits unexpectedly, navigation is
unrecoverable, or the current position can't reach the required state.

### 2.6 — Per scenario: assert, time, evidence
`Then` = ONE batched `evaluate_script` (or a Flow-snapshot read) returning `{pass, actual,
expected}`. Record `duration_ms`. **On FAIL only** — `take_screenshot` +
`list_console_messages(['error','warn'])`, written under `../results/whatsapp/niete/<run>/`.
**Status values**: `PASS | FAIL | BLOCKED`. Amortised, most scenarios land well under the old
~20–40s; only the two quiz-answering scenarios run longer.

### 2.7 — Record observed surface (additive)
As you drive, accumulate every interactive element you actually encountered as `{kind,label}` —
`kind` ∈ `list-row | button | flow-screen | command`. Keep one deduped list for the whole run
(feeds Step 4).

### 2.8 — On FAIL, emit a drift row
When an assertion fails, you already have `expected` and `actual` from the verdict object.
Append a drift row:
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_drift({
  "run_id": RUN_ID, "ts": TS, "scenario": SCENARIO, "step": STEP,
  "expected": EXPECTED, "actual": ACTUAL,
  "assertion_kind": "copy" if scenario_has_copy_tag else "contract",
  "verdict": "pending",
  "evidence": EVIDENCE_PNG_RELPATH,
}, ".claude/qa/ledgers/drift/whatsapp/niete/training.jsonl")
PY
```
`assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`.
A drift-append failure is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build the `covered` list `{kind,label}` from this feature's
   scenarios + `../fixtures/whatsapp/niete/answer-keys.yaml` (e.g. `training_flow.levels`
   → `{kind:"flow-screen", label:<title>}`; recognized commands like `/training`).
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/training.md` (if any) and
   collect every `D-...` entry's slug (the `slug:` field, or derive from the heading).
3. **Diff + append.** Run:
   ```bash
   python3 - <<'PY'
   import sys, json; sys.path.insert(0, ".claude/qa/shared")
   import discovery_diff as dd
   fresh = dd.new_slugs(OBSERVED, COVERED, EXISTING_SLUGS)   # lists/set from steps 1–2
   print(json.dumps(fresh))
   PY
   ```
4. **Write entries.** For each `fresh` item, append to
   `../ledgers/discoveries/whatsapp/niete/training.md`:
   ```markdown
   ### D-niete-training-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/training.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-training-NNN`. Write ONLY the
   stub — never a full scenario (the human judges; the apply pass drafts). A capture
   failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 3: Return JSON
```json
{
  "feature": "Teacher Training",
  "surface": "whatsapp",
  "profile": "NIETE",
  "env": "prod | staging",
  "target": "<number>",
  "started_at": "<ISO-8601>",
  "finished_at": "<ISO-8601>",
  "duration_ms": 0,
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0 },
  "scenarios": [
    { "id": "M1", "name": "…", "status": "PASS", "waited_ms": 0, "duration_ms": 0,
      "tags": "@copy @P1", "evidence": "one-line proof — quote what actually rendered",
      "error": null }
  ],
  "status": "HEALTHY"
}
```

`id`, `tags`, `status`, `waited_ms` and `evidence` are not decoration — the runner assembles
`PER-SCENARIO.md` from them, and that file is what the published artifact is built from. Give every
scenario a stable short id (`R01`, `M12`, `LP10`, `C9`, `L21`, `S4` — `^[A-Z]{1,2}\d{1,2}$`) and a
one-line `evidence` that QUOTES what rendered, not a restatement of the assertion. `status` must be
one of `PASS` · `FAIL` · `BLOCKED` · `SKIP` · `PARTIAL` · `DEFERRED` · `NOT DRIVEN`
(`PASS → PROMOTE` for a promoted `@wip`). `python3 .claude/qa/shared/validate-run.py <run-dir>`
rejects anything that does not classify, and cross-checks the count against the `.feature` file.
**Mapping**: `HEALTHY` = all PASS · `DEGRADED` = 1–2 FAIL · `CRITICAL` = 3+ FAIL or any BLOCKED.
Note: the locked-level copy is templated ("Pass Level {previous}'s grand quiz…") — assert it
for a level whose previous level is the in-progress one. Run against the DEFAULT staging target
(`niete`, `923222482222`): re-verified 2026-08-07, staging has Teacher Training and matches prod
code. Staging has its OWN Supabase (isolated from prod, corrected 2026-08-16). Drive seed/revert
on the run's resolved driver (the runner's own linked number — never a hardcoded one) and restore
afterwards. Use `niete-prod` only when you explicitly need the prod runtime (see `_suite.md`).

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row** (in addition to returning the JSON):
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "training",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-training-<short>`. A runs-append failure is logged, does not
change the returned JSON.
