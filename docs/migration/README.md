# Taleemabad → Rumi-Platform Fork Migration

**Status**: 🟡 Design in progress (started 2026-07-11)
**Target**: A separately-maintained fork of `rumi-platform`, deployed for **NIETE** (National Institute for Excellence in Teacher Education, Islamabad, Pakistan), seeded with Taleemabad content and augmented with a human-in-the-loop coach review layer. See [DEPLOYMENT.md](./DEPLOYMENT.md) for phase-1 infrastructure setup.

---

## What this folder is

Working docs for a one-time migration project — porting selected functionality from `Orenda-Project/taleemabad-core` (Django LMS) into a fork of `Orenda-Project/rumi-platform` (Node WhatsApp bot). Each numbered file is a separate work stream that can be executed independently.

Once the migration is done, these docs stop being "plans" and become "history of decisions" — do not delete.

---

## Documents in this folder

| # | File | Purpose | Status |
|---|------|---------|--------|
| — | [README.md](./README.md) | This file — index + status | Living |
| — | [DEPLOYMENT.md](./DEPLOYMENT.md) | **Phase 1**: fork setup, Supabase + Railway + WhatsApp connection, smoke test | 🟢 Bot + portal live, LP feature verified E2E (2026-07-11) |
| 00 | [00-scope-and-decisions.md](./00-scope-and-decisions.md) | Architecture decisions, out-of-scope items, open questions | 🟡 Draft |
| 01 | [01-lesson-plans.md](./01-lesson-plans.md) | Serve pre-baked LPs from S3 based on teacher class+grade — includes v1 WhatsApp UX proposal | 🟡 Draft (workshop) |
| 02 | [02-teacher-training.md](./02-teacher-training.md) | Own content + external partner content, quiz + certificate | 🟡 Draft (Q-7 resolved, UX workshop pending) |
| 03 | [03-digital-coach.md](./03-digital-coach.md) | Human-in-the-loop review over Rumi's existing FICO pipeline | 🟡 Draft |
| 04 | [04-data-migration.md](./04-data-migration.md) | ETL from Taleemabad Postgres/BigQuery → Rumi Supabase + S3/R2 | 🔴 Blocked on DB access |
| 05 | [05-exam-generator.md](./05-exam-generator.md) | Curriculum-aligned exam paper generation, extending Rumi's quiz feature | 🟡 Draft |
| 06 | [06-from-main-rumi-bot.md](./06-from-main-rumi-bot.md) | Services to backport from `02_Main Rumi Bot` (stripped from open-source) | 🟡 Draft |
| 07 | [07-capacitor-mobile.md](./07-capacitor-mobile.md) | Capacitor mobile app wrapping the portal — end of migration | 🟢 Deferred |
| 08 | [08-launch-checklist.md](./08-launch-checklist.md) | **What's between "deployed" and "usable by real NIETE teachers"** — Meta paperwork, Flow re-registration, feature verifications, infra hardening | 🟢 Living |

---

## How the streams relate

```
                    ┌──────────────────────────────────┐
                    │  00-scope-and-decisions          │
                    │  (portal choice, delivery model) │
                    └──────────────────────────────────┘
                                     │
      ┌──────────────┬───────────────┼───────────────┬──────────────┐
      ▼              ▼               ▼               ▼              ▼
  ┌────────┐    ┌────────┐      ┌─────────┐    ┌──────────┐   ┌────────┐
  │01-LPs  │    │02-TT   │      │03-Coach │    │05-Exam   │   │06-Back-│
  │        │    │        │      │(HITL)   │    │Generator │   │port    │
  └────────┘    └────────┘      └─────────┘    └──────────┘   └────────┘
      │              │               │               │              │
      │              │               │               │              │  supplies
      │              │               │               │              │  services to
      │              │               │               │              ▼
      │              │               │               │         ┌────────┐
      │              │               │               │         │(all 4  │
      │              │               │               │         │feature │
      │              │               │               │         │docs)   │
      │              │               │               │         └────────┘
      └──────────────┴───────────────┼───────────────┘
                                     ▼
                    ┌──────────────────────────────────┐
                    │  04-data-migration               │
                    │  (feeds features with content)   │
                    └──────────────────────────────────┘

                    ┌──────────────────────────────────┐
                    │  07-capacitor-mobile             │
                    │  (deferred — end of migration)   │
                    └──────────────────────────────────┘
```

- **00** locks architecture (portal, delivery, what we drop) before anything else moves.
- **01, 02, 03, 05** are the four feature workstreams. They can run in parallel once 00 is decided.
- **04** cuts across all four — one ETL pipeline feeds LP URLs, training content, exam seed templates, and (optionally) historic coaching data.
- **06** supplies backported services from `02_Main Rumi Bot` to all four features — this is *how* we build, not *what* we build.
- **07** is a mobile-app packaging step done at the end, after phase 1 feature work is stable.

---

## Working conventions

- **Progressive disclosure**: each doc starts minimal, grows only when we execute that section. Don't pre-write speculation.
- **Decisions get dated**: when a decision changes, add a dated entry in the doc's "Decisions" section rather than editing the previous entry silently.
- **Blockers stay visible**: any 🔴 status in the table above means someone (usually you) needs to unblock before that stream can move.
