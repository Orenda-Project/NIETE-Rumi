# 🟢 NIETE-Rumi — LIVE regional deployment

> **You are in the NIETE-Rumi fork** — the region-specific customer-facing deployment for **NIETE — National Institute for Excellence in Teacher Education** (Islamabad, Pakistan). Federal Directorate of Education.
>
> | Fact | Value |
> |---|---|
> | **Full name** | National Institute for Excellence in Teacher Education (NIETE), Islamabad |
> | **WhatsApp (prod)** | `+92 320 6281951` (Meta App `2052724122329740`, Mudareb-adopted) |
> | **WhatsApp (staging)** | `+92 322 2482222` (Meta App `4509630046027431`, added 2026-08-03) |
> | **WhatsApp (sandbox)** | `+92 302 5502255` — display name "Digital Coach Updates". Railway project **NIETE-Rumi Staging**, env `sandbox` (tracks branch `sandbox`), bot `https://bot-sandbox.up.railway.app`. **Its logs ship to the Axiom dataset `rumi-sandbox` (`env == "sandbox"`), NOT `niete-logs`** — query the wrong one and a sandbox test looks like it never happened (bd-bxa6m). |
> | **Env** | `NIETE-Rumi/.env` for prod; staging creds in project-root `01_Digital Coach Docs/03_ACCESS_CREDENTIALS.md` |
> | **Staging URLs** | portal `https://portal-production-24e6.up.railway.app` · bot `https://bot-production-67c2.up.railway.app` — Railway project **NIETE-Rumi Staging** (`0aef0655`), env `staging`. Which branch that env tracks is NOT recorded here on purpose — it was written as `develop`, `develop` is now frozen, and a stale branch in this table is exactly what sends people to the wrong host. The `-production-` in those hostnames is Railway's default naming, NOT an environment: **prod** is `portal.niete.edu.pk` / `portal-production-6a508` / `bot-production-2cb6`. Read them with `railway status --json` (each service carries its deployed branch + commit) and `railway variables --service portal`. Not knowing this cost two rounds of "is it deployed yet?" against the wrong host. |
> | **Branches** | **`sandbox` → cherry-pick → `staging` → `main`.** All work lands on `sandbox` first (merge your branch there, then let the tests run *on `sandbox`*, not just on the branch). Finished work is **cherry-picked with `-x`** to `staging`, which is cut from `main` and is the promotion gate. `staging` reaches `main` by one of two lanes: **lane A**, a PR from `staging` itself (a plain merge); **lane B**, `git cherry-pick -x` of one feature's staging merge (`-m 1` for a merge commit) onto a branch off `main`, when that feature ships on its own go. Lane B is the usual lane while `staging` carries unreleased work; the goal is lane A only. **Both rungs are required checks** (repository rulesets, since 4 and 5 Nov 2026): a PR into `staging` may only carry commits `sandbox` already has (`staging needs sandbox`), and a PR into `main` only commits `staging` already has (`main needs staging`, logic in `scripts/ci/needs-upstream.sh`). They read the last `(cherry picked from commit …)` trailer that `-x` writes, then the patch-id. A bypass list of four release owners, set in the rulesets, can merge a PR past either check, and each bypass is logged (Settings → Rules → Insights); an outage fix that skips a rung is back-filled to the rungs it skipped the same day. `staging only rejects main` (a PR whose head is `main`) is still advisory. Do not back-merge `main` into `staging` to clear divergence: that hides the bypass instead of fixing it. The one exception is the weekly **content-neutral sync**: when a lane-B pick adapted for `main` leaves a file different although `main` has no line `staging` lacks, merge `main` into a branch off `staging` keeping `staging`'s content, so no file on `staging` changes (`git diff origin/staging HEAD` is empty; #4224 is the example). `promotion-invariant.yml` checks that `staging` contains `main` after every push to `main`. **`develop` is FROZEN since 2026-09-08** and deploys nowhere; it is kept only as a rollback anchor. |
> | **Deploys** | Git push ONLY. Railway auto-deploys each branch to its own environment (`sandbox`, `staging`, `main`→prod). The `develop`→staging trigger is retired with the branch; confirm the live triggers from Railway rather than from this table, because a stale entry here is what sent people to the wrong host before. Deploying by CLI upload is FORBIDDEN and blocked by `.claude/hooks/block-railway-up.sh` — it uploads the local working tree, so it can put unreviewed code on prod and records no commit, which makes "what is prod running?" unanswerable. |
> | **Status** | 🟢 LIVE — Feature #1 (LP via UGLP) proven E2E, other features being ported |
>
> **NOT the same as:**
> - `rumi-platform/` — upstream open-source template, no WhatsApp number
> - `02_Main Rumi Bot/` — production Rumi PK (+92 329 5012345), different codebase
> - `taleemabad-core/` — Django source app (read-only migration source)
>

---

# Rumi Platform — Agent Guide (L0)

Open-source AI teaching companion on WhatsApp: 24/7 coaching, reading assessments, lesson plans, quizzes,
and PD — in the teacher's own language. This file is the **entry point for AI coding agents**. (Other tools:
see [AGENTS.md](AGENTS.md), which points here.)

## How to navigate (progressive disclosure)

Read top-down, only as deep as the task needs:

```
CLAUDE.md (this file)  →  <folder>/CLAUDE.md (router)  →  .claude/skills/<skill>/ (deep knowledge)
```

| Need | Go to |
|------|-------|
| Writing a migration / adding a table or a data column | [docs/data-standards.md](docs/data-standards.md) · [.claude/skills/data-standards](.claude/skills/data-standards/SKILL.md) |
| Set up a clone from scratch | [SETUP.md](SETUP.md) · `npm run doctor` (preflight) |
| Customize branding / swap a framework / add a feature | [docs/agent-customization.md](docs/agent-customization.md) |
| Architecture, cost, monitoring | [docs/architecture.md](docs/architecture.md) · [docs/cost-guide.md](docs/cost-guide.md) · [docs/monitoring.md](docs/monitoring.md) |
| Which model runs each job; switch, revert or kill one | [docs/model-switching.md](docs/model-switching.md) · `npm run models` |
| Classes, grades, subjects, sessions — and the promotion plan | [docs/classes-model.md](docs/classes-model.md) |
| **Active work: regional fork migration** (Taleemabad → new region) | [docs/migration/README.md](docs/migration/README.md) |
| **QA automation** — how a commit becomes a synced Gherkin spec + a driven E2E, from any machine | [docs/qa-automation.md](docs/qa-automation.md) · `/niete-e2e` · `/sync-specs` |

## Architecture facts that change how you write code

1. **Feature gating is presence-based.** A feature is ON iff its env keys are present —
   `bot/shared/config/feature-availability.js` is the single source of truth (`FEATURES` maps feature →
   real env key). There is **no `RUMI_TIER`** and no tier system.
2. **The queue backend is pluggable** via `QUEUE_DRIVER` (default `sqs`; `bullmq` runs the whole async
   pipeline on Redis with no AWS). Producers/consumers require `bot/shared/services/queue/` (the index),
   never a specific driver.
3. **All LLM calls go through** `bot/shared/services/llm-client.js` (OpenRouter — one API, many models).
   Each call names a job, and the job's model comes from one table, `bot/shared/config/model-registry.js`;
   a settings row moves any job without a deploy, and a kill switch puts them all back. `npm run models`,
   guide: [docs/model-switching.md](docs/model-switching.md).
4. **Region behaviour is config-driven** (`region_features` table, fail-open) — never hardcode a country,
   phone-number-id, or region name.
5. **No credentials in code.** Everything comes from `.env` (copy `.env.template`). The repo is public —
   no secrets, no internal phone numbers, no internal ticket refs in source (CI enforces all three).
6. **Pilot-certificate watermark** (`PILOT_WATERMARK_VENDORS`, empty since 2026-10-01): rule and test in
   [bot/shared/services/training/CLAUDE.md](bot/shared/services/training/CLAUDE.md).
7. **Lesson plans are known design debt (Nov 2026).** They are spread over ~20 tables, one set per product
   generation. Do NOT add another per-region or per-generation LP table or env flag: extend the existing
   table with the book as the separator, say so in the PR, and ask the operator (Hataf) before any new LP
   table. Why and the target model: [docs/lesson-plan-data-model-debt.md](docs/lesson-plan-data-model-debt.md)
   (follow-up `bd-42mo0w`, audit planned).

## Working rules

- **TDD**: tests live at repo-root `tests/<domain>/` and require bot code via `../../bot/shared/...`.
  **The red test must EXECUTE the changed line on its live branch and fail for the intended reason.**
  A source-text grep assertion or a pure-helper test does not satisfy red-first: a grep-green line
  can still be a runtime `ReferenceError`. Mock at the network boundary, never the module you are
  changing, and never skip the call chain. (A parameter once dropped one hop short of its use site
  shipped a guaranteed crash under 28 green tests, and silently degraded every downstream consumer
  of that service's output for six days.)
- **`npm test` is the BASELINE GATE, not raw Jest.** The suite is not green and has not been for a while.
  `npm test` runs every suite and then judges the *delta* against `tests/baseline.snapshot.json`:
  **exit 0 means "you added no new failure"**, which is the only question a gate can usefully answer here.
  A suspected regression is re-run once and only fails if it reproduces, so a flaky suite cannot redden
  your PR at random.
  **`npm test` takes NO arguments** — it must run everything to judge a delta, and it refuses a filter
  rather than dropping it. For a filtered run use `npm run test:raw -- <any jest args>` (add
  `--forceExit`; a filtered run can hang on an open handle).
  **The snapshot may only ever SHRINK, and that is now enforced** — `npm run test:baseline:growth`
  compares it against the base branch and CI fails a PR that grows it. Adding your failure to the
  snapshot is not a way past the gate.
  **The ~30 suites in the snapshot are known-red debt. Do not try to fix them to get green — you already
  are green. Do not add to them either: the snapshot may only ever shrink.** Read
  [tests/BASELINE.md](tests/BASELINE.md) before concluding you broke something.
- **Bot-only dependencies must be stubbed.** CI runs root `npm test` **before** `bot/ npm ci`, so source
  that requires a `bot/node_modules` package at module scope kills the whole suite *file*. Every such
  package reachable from a root suite is already stubbed in `tests/__mocks__/` and wired through
  `moduleNameMapper` in `tests/jest.config.js`. Add a bot dependency, add its stub in the same PR — the
  gate reports a `Cannot find module` as a new failing suite.
- **Conformance guards** (`tests/setup/`) enforce: every `.from()` table + every `.rpc()` exists in the
  schema, every insert/select column exists, every schema table is referenced, entry files parse, and no
  secrets/internal-refs ship. Fourteen of them are currently red with stale allowlists — fix one
  just-in-time when you touch the surface it covers, and never widen its offender list (the gate compares
  offender-by-offender, so a new entry inside an already-red guard is still a regression).
- **Schema/data changes**: before writing a migration, adding a table, or adding a column that holds
  teacher or student data, load the [data-standards](.claude/skills/data-standards/SKILL.md) skill and
  check the change against it. A `PreToolUse` hook also warns (never blocks) on a `git commit` that
  stages a schema change with findings, and CI reports on every PR. Full guide, including the two known
  detection gaps you should not trust blindly: [docs/data-standards.md](docs/data-standards.md).
- **Run agent sessions from this repo, not from a parent workspace.** What gets loaded — this repo's
  `.claude/` skills *and* its hooks — is fixed by the directory Claude was launched in; a `cd` mid-session
  does not change it. Launch inside this clone or one of its worktrees, otherwise none of the guards above
  are active and a schema commit can pass unchecked while appearing green.
- **DB bootstrap**: `npm run bootstrap:db` applies schema → RLS → seed (idempotent).

## Map (generated)
<!-- kg:map repo=NIETE-Rumi gen=1b67797f7dec -->
| dir | what it is |
|---|---|
| `.claude/` | Agent & skill config (L1) → `.claude/CLAUDE.md` |
| `.cursor/` | (no door; 1 files) |
| `.githooks/` | (no door; 4 files) |
| `.github/` | GitHub repo config: contributing guide, issue templates, CI workflows → `.github/CLAUDE.md` |
| `bot/` | NIETE WhatsApp bot: webhook, workers, services, tests, migrations → `bot/CLAUDE.md` |
| `dashboard/` | Express server: admin pages, teacher/coach portal API, child-quiz edge → `dashboard/CLAUDE.md` |
| `docs/` | Repo docs: architecture, E2E and QA system, migration history, ops guides → `docs/CLAUDE.md` |
| `infrastructure/` | DB schema, migrations, deploy configs, WhatsApp templates → `infrastructure/CLAUDE.md` |
| `kg/` | (no door; 19 files) |
| `portal/` | React SPA: public marketing site plus the NIETE teacher/coach portal and Android app → `portal/CLAUDE.md` |
| `scripts/` | Operator tools: data migrations, backfills, Flow publishers, QA → `scripts/CLAUDE.md` |
| `supabase/` | Schema dump and seed list for the local mock-lane DB → `supabase/CLAUDE.md` |
| `tests/` | Root jest suite over bot/ and dashboard/ code, plus the no-new-failure baseline gate → `tests/CLAUDE.md` |
| `tools/` | (no door; 1 files) |

Deeper: `python3 kg/kg.py find <words>` · `python3 kg/kg.py file <path>`
