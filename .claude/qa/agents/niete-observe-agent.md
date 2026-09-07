---
name: niete-observe-agent
description: NIETE (ICT) WhatsApp E2E agent for the Classroom Observation (/observe) coach/officer surface. Self-contained — resolves the target, loads @e2e scenarios from observe.feature, drives them via Chrome MCP against a linked WhatsApp Web session, and returns JSON. NO prompts.
order: 8
feature: tests/features/whatsapp/niete/observe.feature
---

# NIETE — Classroom Observation (/observe) E2E Agent

Execute `@e2e`-tagged scenarios from **`observe.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its
full run procedure; there is no shared surface executor.
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.

> **⚠ DRAFT SURFACE.** Every scenario in `observe.feature` is currently `@wip @draft` —
> code-grounded (file:line) but NOT yet driven live. Under Step 1's `@wip` rule the agent
> will mark them all `BLOCKED` (reason "wip") until they are promoted. **To promote one:**
> drive it live on a leader account, confirm the exact copy against `answer-keys.yaml`
> (`observe.*` + `observe.copy.*` where the value is `confirm_live`), then drop `@wip @draft`
> and add a `Verified live on PROD (<date>)` comment. This agent is the harness that makes
> that drive possible; it is *ready*, the scenarios are *pending*.

## Preconditions specific to /observe (STOP if unmet → BLOCKED)
- **LEADER role required.** `/observe` is gated to `users.role ∈ {school_leader, supervisor,
  coach, principal, aeo}` (`observe-gate.js:25`). A teacher-role driver reaches ONLY the
  negative "deny_role" scenario. **Use the role-flip mechanism** (`whatsapp-targets.yaml` →
  `role_switch`): set the single `test_driver`'s `users.role` to `@persona:coach`'s value
  (`school_leader`/`coach`) and READ IT BACK before driving — a mismatch → BLOCKED. One-time
  seed for the positive paths: `users.school_id` + a teacher roster so the visit-picker has data.
  If `role_switch.enabled:false` or no seed, only the "deny_role" negative is meaningful.
- **Config gate.** The whole feature is off unless `OBSERVE_MEWAKA_FLOW_ID` is set on the
  runtime (`observe-gate.js:62`); the scheduling UI additionally needs `OBSERVE_SCHEDULING_UI`,
  and the visit picker `OBSERVE_VISIT_FLOW_ID`. If the flag is unset, only the
  "inert when the Flow is not configured" negative is meaningful; the rest → `BLOCKED`
  (reason "config-gated").
- **@destructive discipline.** Capture/schedule/FICO-submit/debrief/send scenarios write real
  observation, schedule and debrief state — run ONLY on a throwaway leader, never a shared or
  personal number.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from the `Feature:` line of
   `tests/features/whatsapp/niete/observe.feature` (fallback: `default_profile` in
   `../config/whatsapp-targets.yaml`). Uppercase for reporting. Default = `niete` (staging, code
   verified current 2026-08-07). NOTE: observe is config-gated on `OBSERVE_MEWAKA_FLOW_ID` — it is
   confirmed SET on niete-prod; verify it is also set on the staging runtime before running here,
   else fall back to `niete-prod` for this feature only.
2. **Load target** — `../config/whatsapp-targets.yaml` → `profiles.niete` → `{number, env, method}`.
   If `method: baileys`, defer to the Baileys runner (headless; read-assertions + dispatch
   only — cannot drive native Flows). This agent covers `method: chrome`.
3. **Open WhatsApp Web** — `list_pages`; else `navigate_page(url='https://web.whatsapp.com')`.
4. **Verify linked** — `take_screenshot`. QR screen → return `BLOCKED` ("link session"). Chat list → OK.
5. **Set persona + open bot chat** — resolve the scenario persona (feature-level `@persona:coach`).
   Via `role_switch`: run `set_recipe` for the `test_driver` with `personas.coach.role_value`,
   then `read_back` (mismatch → BLOCKED). Then `fill` search with `number` → `click` → confirm
   header. The `test_driver` is the SAME single linked session for every persona — only its
   `users.role` differs.
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
9. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:observe`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/observe.feature --tag @e2e
```
Execute every returned scenario. Skip untagged. `@chunk` = backend-only → `BLOCKED`.
**`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run". Recording them as `BLOCKED reason:wip` under `all` is what made a whole run non-exhaustive. `@known-fail` / `@known-issue` always run — report the REAL status; a passing `@known-fail` means the bug is fixed and the spec is stale. — **today that is ALL of them** (draft
surface, see banner above). `@config-gated` scenarios whose env flag is unset → `BLOCKED`
(reason "config-gated"). `@known-fail` / `@known-issue` still run — report the real status
(e.g. the FICO **148-vs-104** report-max regression is a `@known-fail`; a PASS means the bug is fixed).

## Step 2: Execute Each Scenario
Use the [interaction map](../shared/whatsapp-interaction-map.md) for every send/read/tap/Flow/upload step.
Expected values come from
[`../fixtures/whatsapp/niete/answer-keys.yaml`](../fixtures/whatsapp/niete/answer-keys.yaml)
(`observe.*`) — never inline them; where a value is `confirm_live`, capture it on the drive
and write it back to the fixture (that is how a scenario graduates out of draft).

/observe drives **two native Flows** — the **visit picker** (`OBSERVE_VISIT_FLOW_ID`,
`observe-visit-flow.json`, 10 screens: school → teacher → brief, + scheduling v2) and the
**editable FICO form** (`OBSERVE_MEWAKA_FLOW_ID`, `observe-fico-flow.json`, 4 domain screens +
SUCCESS). Drive both per SKILL §8 / the interaction map: real MCP `click` on the CTA, radio
via its wrapping button OR dropdown → listbox → option, `#main{display:none}` for lean
snapshots. **Picker chrome is Latin-only** (a tracked issue — Meta list/dropdown secondary text drops
Urdu). **Audio (the recording + the debrief) is uploaded as a Document** (Attach → Document;
the "Audio" item silently fails under Chrome-MCP). The capture → analysis → FICO-form and the
debrief → coach-feedback pipelines are async — poll the last rows for the review/feedback message.

Per scenario:
1. **Snapshot/scrape** fresh state (uids change after DOM updates; re-scrape inside the Flow iframe).
2. **Given** — open the bot chat on the leader account; open the visit / FICO Flow where required.
3. **When** — perform sends/taps/Flow edits/uploads.
4. **Then** — assert with ONE batched `evaluate_script` returning an object.
5. **On FAIL only** — `take_screenshot` + `list_console_messages(['error','warn'])`.
6. **Reset** — re-scrape between scenarios; re-open the chat/Flow only if the DOM is stuck.
7. **Timer** — record `duration_ms`. Write evidence under `../results/whatsapp/niete/<run>/`.

**Status values**: `PASS | FAIL | BLOCKED`. Target ~25–45s/scenario (audio/analysis flows run longer).

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
   }, ".claude/qa/ledgers/drift/whatsapp/niete/observe.jsonl")
   PY
   ```
   `assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`.
   A drift-append failure is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build the `covered` list `{kind,label}` from this feature's
   scenarios + `../fixtures/whatsapp/niete/answer-keys.yaml` (e.g. `observe.visit_flow_screens_v1`
   → `{kind:"flow-screen", label:<screen>}`; the debrief-choice buttons → `{kind:"button", …}`;
   the `/observe` command).
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/observe.md` (if any) and
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
   `../ledgers/discoveries/whatsapp/niete/observe.md`:
   ```markdown
   ### D-niete-observe-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/observe.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-observe-NNN`. Write ONLY the
   stub — never a full scenario (the human judges; the apply pass drafts). A capture
   failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 3: Return JSON
```json
{
  "feature": "Classroom Observation (/observe)",
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
Notes: (a) until the surface is promoted, expect an **all-`BLOCKED` (wip)** run — that is the
correct state, not a failure; report it plainly. (b) Positive paths need a **leader** driver +
`OBSERVE_MEWAKA_FLOW_ID` set; absent either, they are `BLOCKED` (role / config-gated). (c) The
FICO **148-vs-104** report-max scenario is `@known-fail`. Default target is staging (`niete`,
code current 2026-08-07); use `niete-prod` only if `OBSERVE_MEWAKA_FLOW_ID` isn't set on staging
(see `_suite.md`).

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row** (in addition to returning the JSON):
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "observe",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-observe-<short>`. A runs-append failure is logged, does not
change the returned JSON.
