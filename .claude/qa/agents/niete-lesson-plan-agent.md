---
name: niete-lesson-plan-agent
description: NIETE (ICT) WhatsApp E2E agent for the Lesson Plans surface. Self-contained — resolves the target, loads @e2e scenarios from lesson-plan.feature, drives them via Chrome MCP against a linked WhatsApp Web session, and returns JSON. NO prompts.
order: 4
feature: tests/features/whatsapp/niete/lesson-plan.feature
---

# NIETE — Lesson Plans E2E Agent

Execute `@e2e`-tagged scenarios from **`lesson-plan.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its
full run procedure; there is no shared surface executor.
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.

## Learned live (2026-08-23)

- **The slash keyword is `/lp`.** `/lessonplan` is NOT a keyword — it falls through to the AI, and
  `/lesson plan` (slash + space) falls through to the curriculum fallback. Only `/lp` opens the card.
- **The Pick-Class Flow is a direct list now, not dropdown pickers** — `Grade 1 … Grade 10` as
  tappable rows, then subject, chapter, lesson. The older `haspopup="menu"` dropdown note is stale.
- **"Empty grade / empty subject" negatives are not reproducible through the UI** — the picker only
  lists populated grades and subjects. `lesson_plan_catalog` covers only "Grade One".."Grade Five";
  secondary grades come from a separate Oxbridge corpus. Log the grades you probed as evidence of
  the catalog gap rather than recording a false BLOCKED.
- **The photo fixture is real, and must stay real.** `fixtures/whatsapp/niete/media/textbook_page.png` is a rendered Grade 3 Maths page matching the live catalog (Ch3 "Multiplication Mountain", Topic 1, p.47); regenerate with `python3 .claude/qa/shared/make-textbook-fixture.py`. Its first version was abstract bars and the analysis simply invented content, which cannot tell you whether the feature works. Verified 2026-08-23: the bot now describes the page's own content.
- **Two delivery shapes**: primary returns a PDF, secondary (Oxbridge) returns the plan as TEXT. The
  interim acks differ in language too — assert the contract, not the copy.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from the `Feature:` line of
   `tests/features/whatsapp/niete/lesson-plan.feature` (fallback: `default_profile` in
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
9. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:lesson-plan`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/lesson-plan.feature --tag @e2e
```
Execute every returned scenario. Skip untagged. `@chunk` = backend-only → `BLOCKED`.
**`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run". Recording them as `BLOCKED reason:wip` under `all` is what made a whole run non-exhaustive. `@known-fail` / `@known-issue` always run — report the REAL status; a passing `@known-fail` means the bug is fixed and the spec is stale.
`@config-gated` = run only if the gating env is set (the Pakistan LP Flow scenario needs
`PAKISTAN_LP_FLOW_ID`); otherwise mark `BLOCKED` with reason "config-gated (unset)".
`@known-fail` / `@known-issue` still run — report the real status.

## Step 2: Execute Each Scenario
Use the [interaction map](../shared/whatsapp-interaction-map.md) for every send/read/tap/Flow step.
Expected prompt copy comes from
[`../fixtures/whatsapp/niete/answer-keys.yaml`](../fixtures/whatsapp/niete/answer-keys.yaml) — never inline it.
In this deployment `PAKISTAN_LP_FLOW_ID` is unset, so the active path is the free-text topic
prompt; the class-picker Flow is `@config-gated`.

Per scenario:
1. **Snapshot/scrape** fresh state (uids change after DOM updates).
2. **Given** — ensure the bot chat is open (reuse the page; don't reload).
3. **When** — perform sends/taps.
4. **Then** — assert with ONE batched `evaluate_script` returning an object.
5. **On FAIL only** — `take_screenshot` + `list_console_messages(['error','warn'])`.
6. **Reset** — re-scrape between scenarios; re-open the chat only if the DOM is stuck.
7. **Timer** — record `duration_ms`. Write evidence under `../results/whatsapp/niete/<run>/`.

**Status values**: `PASS | FAIL | BLOCKED`. Target ~20–40s/scenario.

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
   }, ".claude/qa/ledgers/drift/whatsapp/niete/lesson-plan.jsonl")
   PY
   ```
   `assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`.
   A drift-append failure is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build the `covered` list `{kind,label}` from this feature's
   scenarios + `../fixtures/whatsapp/niete/answer-keys.yaml` (e.g. `lesson_plan.grades`
   → `{kind:"flow-screen", label:<grade>}`; `lesson_plan.menu_cta` → `{kind:"button",
   label:"Pick a class"}`).
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/lesson-plan.md` (if any) and
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
   `../ledgers/discoveries/whatsapp/niete/lesson-plan.md`:
   ```markdown
   ### D-niete-lesson-plan-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/lesson-plan.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-lesson-plan-NNN`. Write ONLY the
   stub — never a full scenario (the human judges; the apply pass drafts). A capture
   failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 3: Return JSON
```json
{
  "feature": "Lesson Plans",
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
(`@wip` PDF generation and the `@config-gated` class-picker are expected `BLOCKED` here.)

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row** (in addition to returning the JSON):
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "lesson-plan",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-lesson-plan-<short>`. A runs-append failure is logged, does not
change the returned JSON.
