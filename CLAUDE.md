# 🟢 NIETE-Rumi — LIVE regional deployment

> **You are in the NIETE-Rumi fork** — the region-specific customer-facing deployment for **NIETE — National Institute for Excellence in Teacher Education** (Islamabad, Pakistan). Federal Directorate of Education.
>
> | Fact | Value |
> |---|---|
> | **Full name** | National Institute for Excellence in Teacher Education (NIETE), Islamabad |
> | **WhatsApp (prod)** | `+92 320 6281951` (Meta App `2052724122329740`, Mudareb-adopted) |
> | **WhatsApp (staging)** | `+92 322 2482222` (Meta App `4509630046027431`, added 2026-08-03) |
> | **Env** | `NIETE-Rumi/.env` for prod; staging creds in project-root `01_Digital Coach Docs/03_ACCESS_CREDENTIALS.md` |
> | **Docs** | `NIETE-Rumi/docs/migration/` (00 through 08) |
> | **Branches (Gitflow)** | `main` → prod · `develop` → staging · feature branches → PR into `develop`. **No cherry-picking** — staging must promote to prod via `develop → main` PR only. |
> | **Deploys** | Git push ONLY. Railway auto-deploys `develop`→staging and `main`→prod. Deploying by CLI upload is FORBIDDEN and blocked by `.claude/hooks/block-railway-up.sh` — it uploads the local working tree, so it can put unreviewed code on prod and records no commit, which makes "what is prod running?" unanswerable. |
> | **Status** | 🟢 LIVE — Feature #1 (LP via UGLP) proven E2E, other features being ported |
>
> **NOT the same as:**
> - `rumi-platform/` — upstream open-source template, no WhatsApp number
> - `02_Main Rumi Bot/` — production Rumi PK (+92 329 5012345), different codebase
> - `taleemabad-core/` — Django source app (read-only migration source)
>
> **Sanity check**: `head -1 CLAUDE.md` in this dir should show "NIETE-Rumi". Any WhatsApp E2E from this project uses NIETE's `PHONE_NUMBER_ID`.

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
| The bot codebase (handlers, services, workers) | [bot/CLAUDE.md](bot/CLAUDE.md) |
| Database schema, RLS, seed, one-command bootstrap | [infrastructure/CLAUDE.md](infrastructure/CLAUDE.md) |
| Writing a migration / adding a table or a data column | [docs/data-standards.md](docs/data-standards.md) · [.claude/skills/data-standards](.claude/skills/data-standards/SKILL.md) |
| Agent/skill config + what skills exist | [.claude/CLAUDE.md](.claude/CLAUDE.md) |
| Set up a clone from scratch | [SETUP.md](SETUP.md) · `npm run doctor` (preflight) |
| Customize branding / swap a framework / add a feature | [docs/agent-customization.md](docs/agent-customization.md) |
| Architecture, cost, monitoring | [docs/architecture.md](docs/architecture.md) · [docs/cost-guide.md](docs/cost-guide.md) · [docs/monitoring.md](docs/monitoring.md) |
| **Active work: regional fork migration** (Taleemabad → new region) | [docs/migration/README.md](docs/migration/README.md) |

## Architecture facts that change how you write code

1. **Feature gating is presence-based.** A feature is ON iff its env keys are present —
   `bot/shared/config/feature-availability.js` is the single source of truth (`FEATURES` maps feature →
   real env key). There is **no `RUMI_TIER`** and no tier system.
2. **The queue backend is pluggable** via `QUEUE_DRIVER` (default `sqs`; `bullmq` runs the whole async
   pipeline on Redis with no AWS). Producers/consumers require `bot/shared/services/queue/` (the index),
   never a specific driver. See [bot/CLAUDE.md](bot/CLAUDE.md).
3. **All LLM calls go through** `bot/shared/services/llm-client.js` (OpenRouter — one API, many models).
4. **Region behaviour is config-driven** (`region_features` table, fail-open) — never hardcode a country,
   phone-number-id, or region name.
5. **No credentials in code.** Everything comes from `.env` (copy `.env.template`). The repo is public —
   no secrets, no internal phone numbers, no internal ticket refs in source (CI enforces all three).

## Working rules

- **TDD**: tests live at repo-root `tests/<domain>/` and require bot code via `../../bot/shared/...`.
- **`npm test` is the BASELINE GATE, not raw Jest.** The suite is not green and has not been for a while.
  `npm test` runs every suite and then judges the *delta* against `tests/baseline.snapshot.json`:
  **exit 0 means "you added no new failure"**, which is the only question a gate can usefully answer here.
  A suspected regression is re-run once and only fails if it reproduces, so a flaky suite cannot redden
  your PR at random. Use `npm run test:raw` for unfiltered Jest output when debugging (add `--forceExit`
  to a filtered run).
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

## Repo map

`bot/` WhatsApp bot (Node/Express; entry `bot/whatsapp-bot.js`; 10 handlers, 49 services, 10 workers) ·
`infrastructure/` Supabase schema (73 tables) + deploy configs · `tests/` Jest suites (407 suites / 4,713
tests) · `docs/` architecture & customization · `dashboard/` + `portal/` observability/teacher UIs.
