---
name: niete-registration-agent
description: NIETE (ICT) WhatsApp E2E agent for the Registration onboarding Flow. Self-contained — resolves the target, loads @e2e scenarios from registration.feature, drives them via Chrome MCP against a linked WhatsApp Web session, and returns JSON. NO prompts.
order: 1
feature: tests/features/whatsapp/niete/registration.feature
---

# NIETE — Registration E2E Agent

Execute `@e2e`-tagged scenarios from **`registration.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its
full run procedure; there is no shared surface executor.
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.

## Learned live (2026-08-23)

- **The deployed Flow has NO language screen.** Screens are PERSONAL_INFO → REGION_INFO (PK only) →
  PROFESSIONAL_INFO → ORG_DETAILS (only when org = Other) → SUCCESS. Any scenario asserting a
  language choice at sign-up is BLOCKED on an absent screen, not a missed step.
- **ORG_DETAILS routing is server-side, on SUBMIT.** Selecting "Other" in the dropdown changes
  nothing on screen; the extra screen appears only after submitting PROFESSIONAL_INFO. Testing it by
  changing the dropdown alone produces a false FAIL.
- **Expect fields to be dropped** until the per-screen persistence fix lands: only the LAST screen's payload survives, and
  re-registering NULLs previously-good values. Assert against the DB, not the greeting.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from `tests/features/whatsapp/niete/registration.feature`
   (fallback: `default_profile` in `../config/whatsapp-targets.yaml`). Uppercase for reporting.
2. **Load target** — `../config/whatsapp-targets.yaml` → `profiles.niete` → `{number, env, method}`.
   This agent covers `method: chrome` (registration is a native Flow — Baileys can't drive it).
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
8. **Lean snapshots** — inject `#side{display:none}` (add `#main{display:none}` inside the Flow iframe).
9. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:registration`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/registration.feature --tag @e2e
```
Execute every returned scenario. `@destructive` = do NOT run on the shared driver — it writes
first_name/school/org and flips `registration_completed`; run only on a **throwaway test teacher**, else mark
`BLOCKED` with reason "destructive — needs throwaway account". `@config-gated` = only where `REGISTRATION_FLOW_ID`
is blank (prod has it set) → `BLOCKED` otherwise. `@known-fail` / `@known-issue` still run — report real status.

**`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run".

## Step 2: Execute Each Scenario
Use the [interaction map](../shared/whatsapp-interaction-map.md) — registration is a native Flow (drive via
`take_snapshot` uids + MCP `click`). Screens: PERSONAL_INFO (name + country + **language**) → REGION_INFO
(Pakistan only) → PROFESSIONAL_INFO (organization* / school / grade / subjects / role) → ORG_DETAILS
(only when organization = "other") → SUCCESS ("Thank you for registering, <name>!"). `*organization` is the
only mandatory field on that screen. **BACK is country-dependent** — ORG_DETAILS → PROFESSIONAL_INFO,
PROFESSIONAL_INFO → REGION_INFO for PK else PERSONAL_INFO, and stepping back re-reads the stored language so
it is not silently reset (registration-endpoint.js:383-427).
**Expected values live in [`answer-keys.yaml`](../fixtures/whatsapp/niete/answer-keys.yaml) → `registration`**
(added 2026-08-19, a tracked issue): validation copy, both already-registered variants, the completion template, the
portal-setup PATH, and the 1-hour partial-state TTL. Read them from there — never inline a string in a step.
Two traps that produced false results before: the greeting's name is EMPTY while F-REG1 is open, and the
portal HOST differs per environment (prod `portal.niete.edu.pk`, staging the Railway app host) — assert the
`/portal/setup/` path, never the host.
The already-registered and pending-name paths need a specific account state — note it, don't force it.
The already-registered gate is `user.first_name` ALONE (text-message.handler.js:1650) — not
`registration_completed`, not `registration_state`; on staging those three have been observed disagreeing.
Per scenario: snapshot/scrape fresh state; Given (chat open); When (send/tap/Flow steps); Then (one batched
`evaluate_script` object); on FAIL only `take_screenshot` + `list_console_messages(['error','warn'])`; record
`duration_ms`; write evidence under `../results/whatsapp/niete/<run>/`.

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
   }, ".claude/qa/ledgers/drift/whatsapp/niete/registration.jsonl")
   PY
   ```
   `assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`.
   A drift-append failure is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build the `covered` list `{kind,label}` from this feature's
   scenarios **plus `answer-keys.yaml` → `registration`** (that section now exists —
   `screens`, `validation`, `already_registered`, `completion`) — the native-Flow screens
   named in Step 2: `{kind:"flow-screen", label:"PERSONAL_INFO"}`, `REGION_INFO`,
   `PROFESSIONAL_INFO`, `ORG_DETAILS`, `SUCCESS`.
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/registration.md` (if any) and
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
   `../ledgers/discoveries/whatsapp/niete/registration.md`:
   ```markdown
   ### D-niete-registration-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/registration.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-registration-NNN`. Write ONLY the
   stub — never a full scenario (the human judges; the apply pass drafts). A capture
   failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 3: Return JSON
```json
{
  "feature": "Registration",
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
(On the shared driver, `@destructive` completion + the already-registered path are expected `BLOCKED`.)

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row** (in addition to returning the JSON):
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "registration",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-registration-<short>`. A runs-append failure is logged, does not
change the returned JSON.
