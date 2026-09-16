---
name: niete-language-agent
description: NIETE (ICT) WhatsApp E2E agent for the language feature — the /language picker + selection/persistence, the one-writer guarantee (a voice note cannot override a locked choice), and i18n propagation across every flow (menu, status, lesson-plan, training, coaching, registration, settings, observe, attendance, ask, reading). Self-contained — resolves the target, loads @e2e scenarios from language.feature, drives them via Chrome MCP against a linked WhatsApp Web session, reads/restores preferred_language via the DB, and returns JSON. NO prompts.
order: 6
feature: tests/features/whatsapp/niete/language.feature
---

# NIETE — Language E2E Agent

Execute `@e2e`-tagged scenarios from **`language.feature`** against the NIETE (ICT) bot and
return structured JSON. No permission prompts. **Self-contained** — this agent owns its full
run procedure. Grounded on the NIETE-Rumi `develop` branch (OPS-118 language unification).
Method: [`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).
Interaction map: [`../shared/whatsapp-interaction-map.md`](../shared/whatsapp-interaction-map.md).

> WhatsApp Web has no `data-cy` and no login form — the target is a *linked session* driving a *bot number*.
> **This feature WRITES `users.preferred_language`** on the driver account (a reversible DB write,
> pre-authorized for the throwaway driver per `whatsapp-targets.yaml → standing_authorization`).
> Capture the pre-test language at Step 0 and **restore it at the end** — leave the driver reversible.

## Step 0: Setup
1. **Resolve tenant** — read `@profile:niete` from the `Feature:` line of
   `tests/features/whatsapp/niete/language.feature` (fallback: `default_profile` in
   `../config/whatsapp-targets.yaml`). Uppercase for reporting.
2. **Load target** — `../config/whatsapp-targets.yaml` → `profiles.niete` → `{number, env, method, test_driver}`.
   If `method: baileys`, defer to the Baileys runner (headless; read-assertions + dispatch only —
   cannot drive native Flows or read a reply's rendered script reliably). This agent covers `method: chrome`.
3. **Open WhatsApp Web** — `list_pages`; else `navigate_page(url='https://web.whatsapp.com')`.
4. **Verify linked** — `take_screenshot`. QR "Scan to log in" screen → return `BLOCKED` ("link session"). Chat list → OK.
5. **Capture + restore-plan the language** — read the driver's current language so persistence
   assertions have a baseline AND so the run is reversible:
   ```bash
   python3 .claude/qa/shared/niete_training_db.py lookup --phone <test_driver>
   ```
   Record `preferred_language` + `language_locked` as `LANG_BEFORE`. Restoration at the end is via
   the bot itself (send `/language` → pick `LANG_BEFORE`), since language is set through the surface
   under test — there is no separate write CLI, by design (the one-writer rule).
6. **Open bot chat** — `fill` search with `number` → `click` the result → confirm header.
7. **Check the driving helpers are loaded** — `evaluate_script`: `typeof window.__wa`. It is
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
8. **Snapshot to a FILE, then grep it** — `take_snapshot(filePath="<run-dir>/snap_<what>.txt")` and
   pull the uid out with `grep`. A country or module list is thousands of tokens and you almost
   always need one uid from it.
9. **Lean snapshots** — inject `#side{display:none}` (add `#main{display:none}` inside a Flow iframe).
   ⚠️ Restore `#main` before reading a chat reply — a hidden `#main` makes the composer swallow
   pastes silently, and `wa.send()` reports `healed:true` when it has had to fix that for you.
10. **Log** — `[WA-E2E] setup complete — tenant:NIETE env:<env> method:chrome feature:language lang_before:<LANG_BEFORE>`.

**If setup fails**: return `status: "BLOCKED"` with the error.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/language.feature --tag @e2e
```
Execute every returned scenario. Skip untagged. Apply the run's exclusions (the `/niete-e2e`
default drops `@destructive @slow @wip @first-use @config-gated`). **`@wip` / `@draft` handling is MODE-DEPENDENT — do not blanket-skip.** Under the default/SAFE subset they are excluded. Under **`all` they RUN**, and one that passes must be **promoted** (drop the tag) in the same pass — `@wip` means "not yet driven live", never "do not run". Recording them as `BLOCKED reason:wip` under `all` is what made a whole run non-exhaustive. `@known-fail` / `@known-issue` always run — report the REAL status; a passing `@known-fail` means the bug is fixed and the spec is stale. `@known-issue` still runs — **report the real status: a passing `@known-issue` means
the i18n leak is FIXED** (flip the spec to positive). `@persona:*` other than `teacher` needs a
`users.role` flip — if `role_switch.enabled` is false, record `BLOCKED` (reason "persona role_switch disabled").

## Step 2: Execute Each Scenario
Use the [interaction map](../shared/whatsapp-interaction-map.md) for every send/read/tap/Flow step.
Expected values (offered set, picker chrome, confirm strings, the must-not-offer list, the known
English-leak surfaces) come from
[`../fixtures/whatsapp/niete/answer-keys.yaml → language`](../fixtures/whatsapp/niete/answer-keys.yaml) —
never inline them.

**Language-specific assertion rules (READ FIRST):**
- **Language of a reply is asserted by SCRIPT, not wording.** "Renders in Urdu" = the reply text
  contains RTL Perso-Arabic characters (`/[؀-ۿ]/`); "renders in English" = Latin-only, no
  Perso-Arabic. Only `@copy` scenarios pin an exact string (from `answer-keys.language`).
- **Persistence is asserted from the DB, not the reply.** After a switch, re-run
  `niete_training_db.py lookup --phone <test_driver>` and assert `preferred_language` / `language_locked`.
  A confirmation bubble alone is not proof of persistence.
- **The one-writer scenario (voice note cannot override):** set Urdu, then send an audio message
  spoken in English (Attach → **Document** — the "Audio" item silently fails under Chrome-MCP), then
  assert (a) the reply still renders Urdu AND (b) `lookup` shows `preferred_language='ur'` unchanged.
- **Off-offer / stale-row & /settings-reject scenarios** are `@defensive` — reachable only via a
  crafted/replayed client; if you cannot synthesize the stale row id, record `BLOCKED` (reason
  "defensive — not client-reproducible"), never a false PASS.

Per scenario:
1. **Snapshot/scrape** fresh state (uids change after DOM updates).
2. **Given** — ensure the bot chat is open (reuse the page; don't reload). Set any required
   precondition language via `/language` first (and remember to restore at run end, not per-scenario).
3. **When** — perform sends/taps/Flow drives.
4. **Then** — assert with ONE batched `evaluate_script` returning an object; for persistence/`preferred_language`
   assertions, pair it with a `lookup` call.
5. **On FAIL only** — `take_screenshot` + `list_console_messages(['error','warn'])`.
6. **Reset** — re-scrape between scenarios; re-open the chat only if the DOM is stuck.
7. **Timer** — record `duration_ms`. Write evidence under `../results/whatsapp/niete/<run>/`.

**Status values**: `PASS | FAIL | BLOCKED`. Target ~20–40s/scenario (persistence lookups add a few s).

8. **Record observed surface.** Accumulate every interactive element encountered as `{kind,label}`
   — `kind` ∈ `list-row | button | flow-screen | command`. Keep one deduped list for the run.
9. **On FAIL, emit a drift row.**
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
   }, ".claude/qa/ledgers/drift/whatsapp/niete/language.jsonl")
   PY
   ```
   `assertion_kind` = `copy` if the scenario carries `@copy`, else `contract`. A drift-append failure
   is logged and ignored — it never changes the verdict.

## Step 4: Discovery capture (additive — never affects PASS/FAIL)
1. **Covered set.** Build `covered` `{kind,label}` from this feature's scenarios +
   `../fixtures/whatsapp/niete/answer-keys.yaml → language` (offered rows → `{kind:"list-row", label:<title>}`;
   recognized commands `/language`, `/settings`).
2. **Existing slugs.** Read `../ledgers/discoveries/whatsapp/niete/language.md` (if any) and collect
   every `D-...` entry's slug.
3. **Diff + append.**
   ```bash
   python3 - <<'PY'
   import sys, json; sys.path.insert(0, ".claude/qa/shared")
   import discovery_diff as dd
   fresh = dd.new_slugs(OBSERVED, COVERED, EXISTING_SLUGS)
   print(json.dumps(fresh))
   PY
   ```
4. **Write entries.** For each `fresh` item, append to
   `../ledgers/discoveries/whatsapp/niete/language.md`:
   ```markdown
   ### D-niete-language-<n> · "<label>" <kind>
   - status: proposed
   - slug: <slug>
   - surface: whatsapp/niete/language.feature
   - kind: <kind>
   - observed: <YYYY-MM-DD> · run <short> · not in covered set
   - evidence: <relative screenshot path, or "none">
   - suggested: Scenario "<one-line stub asserting the element>"
   ```
   `<n>` = next integer after the highest existing `D-niete-language-NNN`. Write ONLY the stub. A
   capture failure is logged and ignored.
5. **Set coverage.** `coverage = {scenarios: <#loaded>, surface_observed: <#covered ∪ observed>,
   uncovered: <len(fresh) + len(already-open discoveries)>}` for the runs row.

## Step 5: Restore (ALWAYS, even on failure)
Return the driver to `LANG_BEFORE`: send `/language`, open the "Languages" list, pick the row for
`LANG_BEFORE`, and confirm via `lookup` that `preferred_language` is back to its pre-test value.
Log `[WA-E2E] language restored — <LANG_BEFORE>`. If restoration cannot be confirmed, say so
loudly in the report (the driver is left in a non-default language).

## Step 3: Return JSON
```json
{
  "feature": "the language surface",
  "surface": "whatsapp",
  "profile": "NIETE",
  "env": "prod | staging",
  "target": "<number>",
  "lang_before": "ur | en",
  "lang_restored": true,
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
**Expected for this suite (OPS-118 grounded on develop):** the SELECTION scenarios (A) and the
voice-note one-writer scenario (B) should PASS on a develop/main deployment; the PROPAGATION
`@known-issue` scenarios (E2 — `/menu`, `/status`, LP Pick-Class Flow, Training inner screens,
coaching Steps 1–5/5, attendance, registration greeting) are EXPECTED to FAIL (English on an Urdu
account) until each surface is localized — so a large FAIL count here is largely known-issue drift,
not regression. Read the per-scenario `@known-issue` tag before calling the build unhealthy.

**Return ONLY JSON** — no prose.

**Also append a runs-ledger row:**
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, ".claude/qa/shared")
import ledger
ledger.append_run({
  "run_id": RUN_ID, "ts": TS, "surface": "whatsapp", "tenant": "niete",
  "env": ENV, "method": "chrome", "feature": "language",
  "summary": {"total": T, "passed": P, "failed": F, "blocked": B},
  "duration_ms": DURATION_MS,
  "status": "HEALTHY" if F+B==0 else ("CRITICAL" if F>=3 or B>0 else "DEGRADED"),
  "coverage": COVERAGE, "drift_count": DRIFT_N, "discovery_count": DISCOVERY_N,
  "evidence_dir": "results/whatsapp/niete/<short>/",
}, ".claude/qa/ledgers/runs.jsonl")
PY
```
`RUN_ID` = `<TS>-niete-language-<short>`. A runs-append failure is logged, does not change the returned JSON.
