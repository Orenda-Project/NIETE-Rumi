# /e2e — Run a tenant's WhatsApp E2E suite (engine command; a repo may alias it, e.g. `/niete-e2e`, `/rumi-e2e`)

Drives the bot's WhatsApp surface end to end through `feature-runner.cjs`, one process per feature, in
`feature-order.py` order. Two lanes: **mock** (the bot boots from ONE commit behind a local Graph API stand-in, no
browser, no WhatsApp number — tests THAT commit) and **chrome** (a linked WhatsApp Web session driving the deployed
build — tests what Meta does with the change). Everything repo- and region-specific comes from
`.claude/qa/config/tenants.yaml`; this command never names a tenant.

**Arguments (`$ARGUMENTS`)** — `/e2e <tenant> [safe|all|<feature>[,<feature>]] [--env <env>] [--method chrome|mock] [--commit <sha>]`

- `<tenant>` — an id from `tenants.yaml` (`python3 .claude/qa/engine/bin/tenants_lite.py --list-tenants`). A
  single-tenant repo may omit it.
- *(empty)* / `safe` → every `@e2e` scenario EXCEPT `@destructive` · `@slow` · `@wip` · `@first-use` · `@config-gated`.
- `<feature>` → EVERY `@e2e` scenario in that feature's `.feature` file (tag exclusions off, reversible driver-scoped
  seeds applied). Only a scenario whose `@tenants:` restriction excludes this tenant, or whose precondition cannot
  be set up on the throwaway driver, is skipped — each skip logged with its reason, never silent.
- `all` → exhaustive: every `@e2e` scenario of every feature the tenant lists, one PASS/FAIL/SKIP/BLOCKED line each.
  Mutates the driver account's state on the target env (reversible seeds, un-register after registration, language
  toggled and restored); run on a throwaway driver. Prod needs an explicit per-action "go" (root CLAUDE.md Rule 7).
- `--method mock --commit <sha>` → the commit-time lane; `bash .claude/qa/engine/bin/commit-e2e.sh <sha> [--tenant <t>]
  [--features a,b]` is the same thing driven from a selection.

## 0. Preconditions — STOP if any fail

- **A manifest.** `.claude/qa/config/tenants.yaml` exists and names the tenant. `tenants_lite.py --tenant <t> --json`
  must resolve, or there is nothing to drive.
- **Mock lane:** `keys.local` (from the manifest) exists next to the repo's `keys/`, installed deps match the commit's
  lockfiles, `redis-server` on PATH. No vendor keys — the lane is cassette replay-strict, a miss fails loudly.
- **Chrome lane:** desktop Chrome with a DevTools TCP port (`bash .claude/qa/engine/bin/start-chrome-cdp.sh`), a
  linked `web.whatsapp.com` tab past the QR screen (`node .claude/qa/engine/bin/inject-wa-drive.js --port 9223 --quiet`
  exits 0), the target chat OPEN in `#main` (opened by number — a saved contact may show another name), and the
  driver = the runner's OWN linked number (`test_driver: prompt`; read it off `localStorage['last-wid-md']` and
  confirm). A QR nobody scans is the ONLY legitimate precondition failure: say so and stop.
- **Target.** The tenant's `chrome:` profile in `whatsapp-targets.yaml` for the chrome lane; `local` for mock.
  `chrome: null` means the tenant has no non-prod number — mock only, prod by explicit go.
- **Nothing in flight on the driver** (a coaching session left mid-pipeline defers the next upload): the runner
  cancels stuck sessions through `tenant_tools.coaching_db` when configured.

## 1. The whole run is ONE command

```bash
bash .claude/qa/engine/bin/run-suite.sh all   --tenant <t> --driver <digits>          # exhaustive
bash .claude/qa/engine/bin/run-suite.sh safe  --tenant <t> --driver <digits>          # default subset
bash .claude/qa/engine/bin/run-suite.sh lesson-plan,status --tenant <t> --driver <digits>
#   --method mock --commit <sha> · --env <env> --target <digits> · --run-id <id> · --port 9223 · --no-seed
```

`run-suite.sh` checks §0, exports `E2E_TENANT` + `E2E_PHONE_NUMBER_ID` (the mock lane boots the bot as that
tenant's deployment), runs the features in order with `reset-state` between the ones that need it, and writes
`.claude/qa/results/whatsapp/<tenant>/<run-id>/` (`runner.log`, one `<feature>.json` + `progress-<feature>.log`
each, `PER-SCENARIO.md`) and one `runs.jsonl` row per feature. Start it in the background; a chrome `all` runs
20–45 min.

## 2. Report

Every scenario gets its own line — id · verdict · evidence · seconds — and BLOCKED/SKIP lines carry the exact
reason. Then: `python3 .claude/qa/engine/bin/validate-run.py "$RUN_DIR"`, `python3 .claude/qa/engine/bin/run_efficiency.py
"$RUN_DIR"`, and `check_known_findings.py`'s regression verdict (a run regresses only when a scenario NOT in
`known-findings.json` fails). A skipped run reported honestly is fine; a skipped run reported as a pass is not.
