# QA — E2E test system

> **How a commit reaches this system from any machine** — git hooks and Claude Code hooks, and
> what each guarantees — is in [docs/qa-automation.md](../../docs/qa-automation.md). This file is the
> system itself.

Executable end-to-end tests. Specs are Gherkin; agents interpret them via Chrome
MCP and return JSON. Separation of concerns:

```
tests/features/<surface>/<tenant>/*.feature   # SPECS (source of truth) — web/, whatsapp/
.claude/qa/
  agents/       niete-<feature>-agent.md       # EXECUTORS — one self-contained agent per feature file
  config/       whatsapp-targets.yaml          # targets per tenant/env; tags.md = tag vocabulary
                test-credentials.yaml          # web login profiles
  shared/       parse-gherkin.py               # tag filter (zero-dep); interaction maps
  fixtures/     <surface>/<tenant>/*.yaml       # expected values, answer keys (out of specs)
  results/      <surface>/<tenant>/<run>/…      # JSON + evidence (gitignored)
```

## Run an e2e suite
```bash
# 1. list the scenarios a run will cover
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/menu.feature --tag @e2e
# 2. invoke that feature's agent, e.g. agents/niete-menu-agent.md
#    (resolves @profile:<tenant> → whatsapp-targets.yaml → target+method)
#    → drives each scenario, writes results/whatsapp/niete/<run>/run.json
```

## Spec sync (phase 1 of the auto-run)

The specs are kept in step with the code by the same hook that arms the run, so
the suite is not driving scenarios written for behaviour that has since changed.

```
commit → select_e2e.py    which features the diff touched   (feature-map.yaml)
       → spec_sync.py     the brief: changed files, bounded diff, current
                          scenarios, and create | update | validate-only
       → /sync-specs      the agent authors  (skills/gherkin-spec-sync)
       → validate_specs.py  the gate — exit 1 means the suite does NOT run
       → /niete-e2e       phase 2, on specs that now describe the real behaviour
```

```bash
python3 .claude/qa/shared/spec_sync.py --repo <repo> --committed        # the brief
python3 .claude/qa/shared/validate_specs.py --only menu,status          # the gate
python3 .claude/qa/shared/validate_specs.py --json                      # machine-readable
```

Two rules the sync will not bend:

- **It never deletes a scenario.** Behaviour that has gone away is tagged
  `@obsolete` with a `# OBSOLETE <date> (<bead>): <why>` line and raised as an
  ask. A wrong auto-delete drops coverage with no failing test to catch it.
- **`only_shared` means leave it alone, usually.** A change to a fan-out file
  (`whatsapp.service.js` maps to `"*"`) selects all nine features without
  changing any of their surfaces.

Off switch for phase 1 alone: `export E2E_SPEC_SYNC_OFF=1`.

Tests:

```bash
python3 .claude/qa/shared/test_spec_sync.py          # the brief builder
python3 .claude/qa/shared/test_validate_specs.py     # the gate
bash    .claude/hooks/spec-sync-pipeline.test.sh     # the whole chain, end to end
```

The last one is the one to run after touching any part of this: it drives a real
`git commit` in a NIETE-shaped fixture through brief → author → gate → Stop
block, against copies of the real specs. Stops at the gate — phase 2 needs a
linked WhatsApp session and belongs to an agent, not a subprocess.

## Conventions
- **One agent per feature** — each `.feature` file has a matching **self-contained** agent
  (`agents/niete-<feature>-agent.md`) that owns its full setup/execute/report procedure. Tenant still
  comes from the feature's `@profile:<tenant>` tag → `config/whatsapp-targets.yaml`. Adding a feature =
  a new `.feature` **and** its own agent (copy an existing one, swap the `feature:` line).
- **No secrets/numbers in specs** — targets live in config; specs use the `@profile` tag.
- **Layer tag drives selection** (`@e2e`); see [`config/tags.md`](config/tags.md) for the full vocabulary.
- **Results are disposable** (gitignored); durable findings live in each suite's `_suite.md`.
- **Method reference** (how Chrome-MCP drives WhatsApp Web, incl. native Flows):
  [`../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../skills/chrome-mcp-whatsapp-e2e/SKILL.md).

## Ledgers (durable, git-tracked)

Alongside the disposable `results/` tree, each run also writes to three small,
git-tracked ledgers under `.claude/qa/ledgers/` — the durable record a dashboard
(not yet built) will read from:

```
runs.jsonl                              # append-only, ALL features/tenants, one row per run×feature
drift/<surface>/<tenant>/<feature>.jsonl   # append-only, one row per failing scenario per run
discoveries/<surface>/<tenant>/<feature>.md  # human-legible, one entry per uncovered element
```

Flow — each executor agent already does Steps 0–3 (setup → load scenarios → execute →
return JSON); the loop adds a **Step 4 (discovery capture)** and makes Steps 2–3 also
append to the ledgers, not just the disposable `run.json`:

```
run (per-feature executor agent)          human                apply pass
──────────────────────────────          ─────────           ──────────────
Step 2  execute scenarios ───────────▶ runs.jsonl  (append-only, git-tracked)
   │      on FAIL ────────────────────▶ drift/<feature>.jsonl  (verdict: pending)
Step 4  DISCOVERY CAPTURE ────────────▶ discoveries/<feature>.md (status: proposed)
                                              │
                                    human sets verdict/status
                                    (intended|bug  ·  approved|rejected)
                                              │
                                              ▼
                                     /apply-discoveries  ── edits .feature / answer-keys
                                       (approved entries only)
```

- **Drift** turns a red test into a one-glance triage decision: a human flips `verdict`
  to `intended` (feed `/apply-discoveries`) or `bug` (leave the spec, file a bead).
- **Discoveries** are a coverage/comprehension-debt record: uncovered elements the live
  bot showed that no scenario asserts on. A human flips `status` to `approved`/`rejected`;
  `/apply-discoveries` folds `approved` entries into the spec and flips them to `applied`.
- Run history + pass/fail counts now live in `runs.jsonl` — see each suite's `_suite.md`
  for prose findings only.

See [`ledgers/README.md`](ledgers/README.md) for the frozen schemas (field-by-field) and
the append rules — a change to any schema there is a dashboard-breaking change.

## Surfaces
| Surface | Feature file | Agent |
|---------|--------------|-------|
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/menu.feature` | `agents/niete-menu-agent.md` |
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/training.feature` | `agents/niete-training-agent.md` |
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/lesson-plan.feature` | `agents/niete-lesson-plan-agent.md` |
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/coaching.feature` | `agents/niete-coaching-agent.md` |
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/registration.feature` | `agents/niete-registration-agent.md` |
| WhatsApp (NIETE/ICT) | `tests/features/whatsapp/niete/status.feature` | `agents/niete-status-agent.md` |
| Web (portal/app) | `tests/features/web/<feature>/*.feature` | `agents/<feature>-e2e-agent.md` |
