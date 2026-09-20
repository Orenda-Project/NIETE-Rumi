# E2E engine — the tenant-agnostic commit-to-E2E harness

**Authored here** (`rumi-agent-home/.claude/qa/engine/`) · **read-only downstream** (vendored into each bot repo by
`.claude/scripts/port_qa.py`) · **spec**: `docs/superpowers/specs/2026-09-17-e2e-multi-tenant-harness-design.md` ·
**bead**: bd-9157r · **source**: extracted from `Orenda-Project/NIETE-Rumi` `sandbox@de93aee5` (see `ENGINE_SOURCE`).

The pipeline: a commit (Claude session, terminal or IDE) → which features did it touch (`feature-map.yaml`) → which
tenants have them (`tenants.yaml`) → a Gherkin sync brief → the validator gate → the mock lane boots the bot from
that exact commit, once per tenant with that tenant's `PHONE_NUMBER_ID`, behind a local Graph API stand-in →
`runs.jsonl`. The Stop hook holds the session's turn until the spec is synced; the PR check reads the proof.
NIETE's `docs/qa-automation.md` describes the single-tenant flow in full; this engine is that flow with every
region-specific fact moved into one file.

## Three layers

| Layer | What | Where | Edited where |
|---|---|---|---|
| **Engine** | hooks, git hooks, selector, spec sync, validator, impact, commit-e2e, run-suite, runner, mock driver, ledgers, scaffolder, `/e2e` `/sync-specs` `/testcases` commands, `gherkin-*` skills, `qa-impact.yml` | `.claude/qa/engine/**` (+ the ported commands/skills/workflow at their required paths) | **only here**; `qa-engine-guard.sh` refuses edits downstream |
| **Bot seams** | `WHATSAPP_API_BASE`, `/health.commit`, `simulate.js`, `e2e-cassette.js`, `mock-graph-api.js`, `local-stack.sh`, `flow-emulator.js` | `<bot_root>/scripts/e2e/`, `<bot_root>/shared/…` | each bot repo (product code) |
| **Tenant layer** | `tenants.yaml`, `feature-map.yaml`, `whatsapp-targets.yaml`, `known-findings.json`, specs, fixtures, drivers, per-repo DB tools, agents, ledgers | `.claude/qa/config/`, `.claude/qa/fixtures/`, `.claude/qa/shared/features/`, `tests/features/whatsapp/<suite>/` | each bot repo |

## The manifest — the only file that names a region

`.claude/qa/config/tenants.yaml` (template: `config-templates/tenants.example.yaml`, **block-style YAML only**).
Every engine script resolves the repo root and every tenant fact through `bin/tenants_lite.py` (Python),
`hooks/lib/tenants.sh` (bash) or `bin/tenant.cjs` (Node). Nothing under the engine may hardcode a tenant —
`tests/no-tenant-literals.test.sh` enforces it.

| Key | Meaning |
|---|---|
| `repo`, `command` | repo basename (matched against the origin URL); the slash command the hooks print (`/niete-e2e`, `/rumi-e2e`) |
| `runtime_scope` | globs whose change can alter WhatsApp behaviour (mirrors `feature-map.yaml` `scope:`) |
| `spec_suite` → `spec_dir` | `tests/features/whatsapp/<suite>/` — ONE spec set for every tenant of the repo |
| `bot_root`, `e2e_scripts` | where the bot runtime and its E2E helpers live (`bot`/`bot/scripts/e2e` for NIETE; `.`/`scripts/e2e` for the main bot) |
| `drivers_dir`, `agents_dir`, `command_doc` | tenant-layer locations (defaults shown in the template) |
| `branches.landing / promotion / release / deploy_triggers / full_suite_on` | which pushes arm a run, which merges earn the full suite |
| `keys.local / record`, `db.env_prefix / forbidden_project_refs` | the mock lane's env file and DB creds prefix; refs the cassette and DB tools refuse |
| `tenant_tools.*` | optional per-repo seed/reset scripts; absent → the step is logged as skipped |
| `tenants.<id>` | `region_code`, `phone_number_id` (what the mock lane boots the bot with), `driver`, `language`, `features`, `chrome`, `targets_match` |

**Path resolution (every script):** `CLAUDE_PROJECT_DIR` if it holds a manifest → walk up from `--repo`/cwd →
the engine's own vendored parent. Never a script's own ancestors, and never through symlinks. A repo with no
manifest is not guarded: every hook exits 0 silently (`tests/no-manifest.test.sh`).

## Two layouts: repo mode and workspace mode

The engine finds its tenant layer in one of two places, and every script uses the manifest's absolute paths
(`spec_abs`, `drivers_abs`, `config_abs`, `agents_abs`, `fixtures_abs`, `ledgers_abs`, `results_abs`, `pending_abs`)
so it never cares which:

| | repo mode | workspace mode |
|---|---|---|
| manifest | `<repo>/.claude/qa/config/tenants.yaml` | `<workspace>/.claude/qa/tenants/<name>/config/tenants.yaml` |
| how the repo is matched | it carries the manifest | the nested clone's `origin` basename equals the layer's `repo:` (folder name as fallback) |
| engine | `<repo>/.claude/qa/engine` (vendored copy) | `<workspace>/.claude/qa/engine` (the one copy) |
| specs, drivers, command doc | with the bot code | with the bot code (`<repo>/tests/features/…`, `<repo>/.claude/qa/shared/features/`) |
| config, agents, fixtures, ledgers, results | `<repo>/.claude/qa/…` | the tenant layer dir |
| pending markers, per clone | `<repo>/.claude/.e2e-pending` | same |
| git hooks | `core.hooksPath=.claude/qa/engine/githooks` | `core.hooksPath=<workspace>/.claude/qa/engine/githooks`; the hook finds the engine from its own path |

Workspace mode is what lets the harness live once, in the workspace repo, with the bot repos carrying only what
must sit beside their code. `tenants_lite.py --get workspace_mode` says which layout a checkout is in; the fixture
builder's `workspace` shape (`tests/mkfixture.sh workspace <dir>`) exercises it.

## Tenancy in the selection

`select_e2e.py --json` carries `tenant_features: {tenant: [features]}` — every tenant whose manifest lists a
selected feature, narrowed by any `rules:` entry that names `tenants:` (a region-specific service must not arm
four other regions). With one tenant, `commands` are exactly the single-tenant form (`/niete-e2e menu`); with
several, `<command> <tenant> <feature>`. `commit-e2e.sh` loops `--tenant` over that set; `run-suite.sh --tenant`
exports `E2E_TENANT` and `E2E_PHONE_NUMBER_ID`; results land under `results/whatsapp/<tenant>/`. Scenarios may
carry `@tenants:a,b`; the validator errors `E-TENANT-UNKNOWN` on an id not in the manifest.

## Auto-run — the mock lane runs itself after a commit (1.2.0)

Nobody types `commit-e2e.sh`. On a commit, `githooks/post-commit` (any terminal) and `hooks/e2e-autorun.sh` (a Claude
session) map the diff to mock-lane features, check the machine (`hooks/lib/mock-lane.sh`: keys file via the bot's
`<e2e_scripts>/provision-local-keys.sh`, redis via brew) and hand the sha to `bin/mock-autorun.sh`, which queues it and
starts a **detached drainer** that runs `commit-e2e.sh` in the background. The commit returns at once.

- One run at a time per clone (an atomic lock directory; `driver_lock.py` is the second belt). Commits that pile up are
  **coalesced**: the newest sha is tested with the union of every queued feature list; older shas are marked `superseded`.
- The same sha is never run twice (both hooks fire on one `git commit` in a Claude session).
- Every request ends in `<repo>/.claude/.e2e-pending/mock-<sha7>.result` — `queued` → `running` → `done` (rows + whether
  the known-findings gate called a REGRESSION), or `not-ready` / `off` / `superseded`. Full output: `mock-<sha7>[-<tenant>].log`.
- The Stop hook **reports** the result (or "running") instead of ordering a run; the SessionStart banner shows it for
  pending commits; `bash .claude/qa/engine/bin/mock-autorun.sh --status [sha]` for a human; a desktop notification when
  the machine can show one.
- Off switch `E2E_MOCK_AUTORUN=off` (exported). Tests point `E2E_COMMIT_E2E_BIN` at a stand-in; `tests/run-all.sh` sets
  `E2E_AUTOFIX_OFF=1` so fixtures never provision.

The one step that stays with an agent is the Gherkin sync (phase 1): a spec is authored, not generated by a script.

## Tests

```bash
bash .claude/qa/engine/tests/run-all.sh
```

Runs the reader, fixture, literal and manifest gates, then every fixture-driven test on a **niete-shaped** and a
**rumi-shaped** throwaway repo (`tests/mkfixture.sh`), then — when a `NIETE-Rumi` checkout is reachable — the four
vendored Python suites and six vendored bash suites on a fixture overlaying NIETE's REAL tenant layer at the
pinned sha (`mkfixture.sh niete <dir> --real`). Fourteen of the vendored bash assertions already failed at that sha
(test-vs-spec drift owned by NIETE); they are listed in `tests/vendored-known-failures.txt` and only a NEW failure
fails the run. The runner fingerprints the engine tree and fails if a test wrote through a fixture's symlink.
`bin/test_mock_api.js` and the other `test_*.js` drivers need the bot seams and run from a bot checkout.

## Porting

```bash
python3 .claude/scripts/port_qa.py --dry-run                 # plan per target
python3 .claude/scripts/port_qa.py --target Orenda-Project/NIETE-Rumi   # one PR into that repo's landing branch
```

Targets and landing branches live in `PORT_TARGETS` (NIETE → `sandbox`, main bot → `staging`). One branch
`qa-engine-<version>`, one commit, one PR — never a direct push. `.claude/hooks/qa-sync-port.sh` logs a plan on
every engine edit here. Downstream, `impact.py` prints `Engine: this repo vX · upstream vY · ok|warn|fail`
(`QA_ENGINE_DRIFT=block` makes `fail` fail the check). Bump `ENGINE_VERSION` and regenerate `MANIFEST.txt`
(`find . -type f ! -name MANIFEST.txt | sort | xargs shasum -a 256 > MANIFEST.txt` from this dir) with every port.

## How a bot repo adopts the engine

1. Port the engine (above) — or, first time, copy `.claude/qa/engine/`, the `commands/`, `skills/` and
   `workflows/qa-impact.yml` to their paths by hand.
2. `cp .claude/qa/engine/config-templates/tenants.example.yaml .claude/qa/config/tenants.yaml` and edit.
3. Wire the hooks in `.claude/settings.json`: PostToolUse Bash → `hooks/e2e-autorun.sh`; Stop →
   `hooks/e2e-autorun-stop.sh`; SessionStart → `hooks/e2e-pending-banner.sh`; PreToolUse Edit|Write|MultiEdit →
   `hooks/qa-engine-guard.sh`.
4. `bash .claude/qa/engine/scripts/install-hooks.sh` (or `npm install` with a `prepare` script) — sets
   `core.hooksPath` to `.claude/qa/engine/githooks`.
5. Author the tenant layer: `feature-map.yaml`, `whatsapp-targets.yaml`, specs (`/testcases`), drivers
   (`python3 .claude/qa/engine/bin/scaffold-driver.py <feature>`), `fixtures/whatsapp/<tenant>/copy.yaml`.
