# 🟢 NIETE-Rumi — LIVE regional deployment

> **You are in the NIETE-Rumi fork** — the region-specific customer-facing deployment for NIETE (National Institute of Education, Pakistan).
>
> | Fact | Value |
> |---|---|
> | **WhatsApp** | `+92 320 6281951` (Meta App `2052724122329740`, Mudareb-adopted) |
> | **Env** | `NIETE-Rumi/.env` — has its own `PHONE_NUMBER_ID` + `WHATSAPP_TOKEN` |
> | **Docs** | `NIETE-Rumi/docs/migration/` (00 through 08) |
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
  Run `npm test` (Jest via `tests/run.js`). CI runs root `npm test` **before** `bot/ npm ci`, so a test that
  loads bot code must mock bot-only deps (`aws-sdk`, `bullmq`, `pdfkit`, …) virtually.
- **Conformance guards** (`tests/setup/`) enforce: every `.from()` table + every `.rpc()` exists in the
  schema, every insert/select column exists, every schema table is referenced, entry files parse, and no
  secrets/internal-refs ship. Keep them green.
- **DB bootstrap**: `npm run bootstrap:db` applies schema → RLS → seed (idempotent).

## Repo map

`bot/` WhatsApp bot (Node/Express; entry `bot/whatsapp-bot.js`; 10 handlers, 49 services, 10 workers) ·
`infrastructure/` Supabase schema (73 tables) + deploy configs · `tests/` Jest suites (93 suites / 1161
tests) · `docs/` architecture & customization · `dashboard/` + `portal/` observability/teacher UIs.
