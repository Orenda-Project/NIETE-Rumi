---
name: niete-attendance-agent
description: NIETE (ICT) WhatsApp E2E agent for the Attendance surface — teacher student-marking + the new principal teacher-marking channel. Self-contained — resolves the target, loads @e2e scenarios from attendance.feature, drives them via Chrome MCP against a linked WhatsApp Web session, and returns JSON. NO prompts.
order: 9
feature: tests/features/whatsapp/niete/attendance.feature
---

# NIETE — Attendance E2E Agent

Execute `@e2e`-tagged scenarios from **`attendance.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its
full run procedure; there is no shared surface executor.
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.

> **⚠ DRAFT SURFACE.** Every scenario in `attendance.feature` is currently `@wip @draft` —
> code-grounded (file:line) but NOT yet driven live. Under Step 1's `@wip` rule the agent will
> mark them all `BLOCKED` (reason "wip") until promoted. **To promote one:** drive it live on
> the right account, confirm the exact copy against `answer-keys.yaml` (`attendance.*` +
> `attendance.copy.*` where the value is `confirm_live`), then drop `@wip @draft` and add a
> `Verified live on PROD (<date>)` comment.

## Preconditions specific to Attendance (STOP if unmet → BLOCKED)
- **Role fork via the single `test_driver`** — one throwaway number covers both personas by
  flipping `users.role` (`whatsapp-targets.yaml` → `role_switch`), set + read-back per scenario:
  - `@persona:teacher` (`role='teacher'`) for student-marking, setup, edit-class, voice roll-call
    — needs ≥1 student class seeded on the driver;
  - `@persona:principal` (`role='principal'` + `users.school_id` + teachers in that school) for the
    teacher-marking channel. Seeding the driver with BOTH a student class AND a school roster lets
    the "teachers-or-students" ASK branch fire under `role='principal'`.
- **Role-based, not feature-flagged.** The fork itself has no env gate. But the tap-mark, setup
  and edit Flows are env-gated: `ATTENDANCE_MARKING_FLOW_ID`, `ATTENDANCE_SETUP_FLOW_ID`,
  `EDIT_CLASS_FLOW_ID` (absent → text fallback; `@config-gated` scenarios).
- **@destructive discipline.** Marking/confirming writes real `attendance_sessions` /
  `attendance_records` / `teacher_attendance_records`. Run ONLY on throwaway accounts.
- **@out-of-band.** The web↔WhatsApp convergence scenario cannot be asserted from WhatsApp
  alone → `BLOCKED` (reason "out-of-band"); verify the Presence number via the portal
  attendance API / DB in a separate pass.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from the `Feature:` line of
   `tests/features/whatsapp/niete/attendance.feature` (fallback: `default_profile` in
   `../config/whatsapp-targets.yaml`). Uppercase for reporting. Default = `niete` (staging, verified current 2026-08-07); use `niete-prod` only for an explicit prod-runtime run.
2. **Load target** — `../config/whatsapp-targets.yaml` → `profiles.niete` → `{number, env, method}`.
   If `method: baileys`, defer to the Baileys runner (headless; read-assertions + dispatch
   only — cannot drive native Flows, but CAN drive the principal channel, which is text-only).
   This agent covers `method: chrome`.
3. **Open WhatsApp Web** — `list_pages`; else `navigate_page(url='https://web.whatsapp.com')`.
4. **Verify linked** — `take_screenshot`. QR screen → return `BLOCKED` ("link session"). Chat list → OK.
5. **Set persona + open bot chat** — resolve the scenario persona: scenario-level `@persona:principal`
   (or legacy `@new`) → principal; else feature default `@persona:teacher`. Via `role_switch`: run
   `set_recipe` with the resolved `role_value`, then `read_back` (mismatch → BLOCKED). Then `fill`
   search with `number` → `click` → confirm header — the SAME single `test_driver` session drives
   both personas, only `users.role` differs. Record which persona each scenario ran under.
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
9. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:attendance`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/attendance.feature --tag @e2e
```
Execute every returned scenario. Skip untagged. `@chunk` = backend-only → `BLOCKED`.
**`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run". Recording them as `BLOCKED reason:wip` under `all` is what made a whole run non-exhaustive. `@known-fail` / `@known-issue` always run — report the REAL status; a passing `@known-fail` means the bug is fixed and the spec is stale. — **today that is ALL of them** (draft
surface). `@config-gated` with the env flag unset → `BLOCKED` ("config-gated"). `@out-of-band`
→ `BLOCKED` ("out-of-band"). `@new` marks the principal channel. `@known-fail` /
`@known-issue` still run — report the real status.

## Step 2: Execute Each Scenario
Use the [interaction map](../shared/whatsapp-interaction-map.md) for every send/read/tap/Flow/voice step.
Expected values come from
[`../fixtures/whatsapp/niete/answer-keys.yaml`](../fixtures/whatsapp/niete/answer-keys.yaml)
(`attendance.*`) — never inline them; where a value is `confirm_live`, capture it on the drive
and write it back to the fixture.

Driving notes per surface:
- **Student conversational flow** — text sends drive class/date/session/marking-method
  selection; the **tap** method opens a native marking Flow (`ATTENDANCE_MARKING_FLOW_ID`) —
  drive the webview per SKILL §8. The **setup** Flow (`ATTENDANCE_SETUP_FLOW_ID`) collects the
  roster (bulk text or per-student loop).
- **Voice roll-call** — send a **voice note** while state = `AWAITING_VOICE_INPUT` (not a
  document); the async transcription → verification takes longer, poll the last rows.
- **Principal channel (`@new`)** — **text only, no native Flow**: the bot sends a numbered
  teacher roster; reply with `all` / `2,5` (absent) / `3L` (leave) then a leave-type
  (`1`/`2`/`3` or casual/sick/official) then `yes` to persist.
- **Role fork** — for the ASK branch, drive on the principal-who-also-owns-classes account and
  answer `1` (teachers) or `2` (students).

Per scenario:
1. **Snapshot/scrape** fresh state (uids change after DOM updates; re-scrape inside a Flow iframe).
2. **Given** — open the bot chat on the persona the scenario names.
3. **When** — perform sends/taps/Flow submits/voice notes.
4. **Then** — assert with ONE batched `evaluate_script` returning an object.
5. **On FAIL only** — `take_screenshot` + `list_console_messages(['error','warn'])`.
6. **Reset** — re-scrape between scenarios; a marking/confirm mutates state, so use fresh
   dates/classes to avoid the "already recorded" guard tripping a later positive.
7. **Timer** — record `duration_ms`. Write evidence under `../results/whatsapp/niete/<run>/`.

**Status values**: `PASS | FAIL | BLOCKED`. Target ~25–45s/scenario (voice + Excel delivery run longer).

8. **Record observed surface.** As you drive each scenario, accumulate every
   interactive element you actually encountered as `{kind,label}` — `kind` ∈
   `list-row | button | flow-screen | command`. Keep one deduped list for the run.
9. **On FAIL, emit a drift row.** When an assertion fails, you already have
   `expected` and `actual` from the single-call verdict object. Append a drift row:
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
   }, ".claude/qa/ledgers/drift/whatsapp/niete/attendance.jsonl")
   PY
   ```
   `assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`.
   A drift-append failure is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build the `covered` list `{kind,label}` from this feature's
   scenarios + `../fixtures/whatsapp/niete/answer-keys.yaml` (e.g. `attendance.keywords_high_conf`
   → `{kind:"command", label:<kw>}`; `attendance.leave_types` → `{kind:"button", label:<type>}`;
   the tap-Flow marking screens → `{kind:"flow-screen", …}`).
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/attendance.md` (if any) and
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
   `../ledgers/discoveries/whatsapp/niete/attendance.md`:
   ```markdown
   ### D-niete-attendance-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/attendance.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-attendance-NNN`. Write ONLY the
   stub — never a full scenario (the human judges; the apply pass drafts). A capture
   failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 3: Return JSON
```json
{
  "feature": "Attendance",
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
Notes: (a) until promoted, expect an **all-`BLOCKED` (wip)** run — the correct state, not a
failure. (b) Principal (`@new`) scenarios need the **principal** driver; running them on a
teacher account is `BLOCKED`, not FAIL. (c) The convergence scenario is `@out-of-band`. (d) The
"principal never in the student flow" invariant is the load-bearing NEGATIVE — treat a
regression there as `CRITICAL`. Run on the default staging target (`niete`, verified current
2026-08-07); `niete-prod` is explicit opt-in only (see `_suite.md`).

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row** (in addition to returning the JSON):
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "attendance",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-attendance-<short>`. A runs-append failure is logged, does not
change the returned JSON.
