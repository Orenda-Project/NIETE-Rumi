# Scope & Architecture Decisions

Load-bearing decisions that shape every downstream workstream. Update when a decision changes; don't edit silently.

---

## In scope

- Deploy a **new regional fork of `rumi-platform`**, separately maintained from the main Rumi bot.
- Port **three features** from `taleemabad-core`:
  1. **Lesson Plans** — serve pre-baked LPs from S3 by class+grade (see [01](./01-lesson-plans.md))
  2. **Teacher Training** — own content + external partner content, with quizzes + certificates (see [02](./02-teacher-training.md))
  3. **Digital Coach** — Rumi's existing FICO pipeline PLUS a new human-in-the-loop review layer for coaches (see [03](./03-digital-coach.md))
- **Exam Generator** — curriculum-aligned exam paper generation, extending Rumi's existing quiz feature (see [05](./05-exam-generator.md))
- **Data migration** from Taleemabad's Postgres (and/or BigQuery mirror) into the fork's Supabase (see [04](./04-data-migration.md))
- **Capacitor mobile app** — deferred to end of migration, but committed (see [07](./07-capacitor-mobile.md))
- **Backport from production Rumi bot** — services that exist in `02_Main Rumi Bot` but were stripped from open-source (see [06](./06-from-main-rumi-bot.md))

## Explicitly out of scope

| Item | Reason |
|---|---|
| Multi-tenant django-tenants schema isolation | Rumi is single-tenant Supabase; the fork stays single-tenant |
| Taleemabad's LP generation pipeline (`generate_lesson_plan_content` Celery task) | Not needed — LPs come pre-baked from Taleemabad's S3 |
| SLO tagging (`LessonPlanSubNcpSloMapping` + Sub-NCP-SLO curriculum standards) | Not part of the new region's requirements |
| External LP vendor rating/favoriting (`TeacherExternalLessonPlanStatus`) | Bot serves LPs, doesn't need engagement tracking today |
| Structured observation forms + coach visit scheduling (Taleemabad `coaching` app — CoT rubrics) | Different product; our HITL layer sits on Rumi's AI report, not a form |
| Porting the `EG_Pipeline` microservice wholesale | We build lighter exam generation on top of Rumi's existing quiz feature — see [05](./05-exam-generator.md) |

## Locked decisions

### D-001 — Portal architecture: web-first, Capacitor mobile deferred to end

**Date**: 2026-07-11
**Status**: CONFIRMED (2026-07-11 conversation)

**Phase 1 — web-first**: build all new coach + training + admin surfaces into `rumi-platform/portal/` (Vite + React + Tailwind). No Capacitor in phase 1.

**Phase 2 — Capacitor mobile** (deferred to end of migration): wrap the same portal codebase into a Capacitor Android/iOS build, matching Taleemabad's `school-app` delivery model. This is committed but lower priority than the feature workstreams.

**Why sequence it this way**:
- The Rumi portal already exists as a Vite web app — extending it is faster than starting from Capacitor.
- Every UI surface built for the web can be wrapped in Capacitor without a rewrite (React components stay the same; only build/deploy pipeline changes).
- Capacitor adds Play Store submission, offline caching design, and native permission handling — real work, but deferrable.

**Deferred work tracked in** [07-capacitor-mobile.md](./07-capacitor-mobile.md).

### D-002 — Delivery model per audience

**Date**: 2026-07-11
**Status**: Follows from D-001

| Audience | Interface |
|---|---|
| Teachers | WhatsApp (voice, text, Flows, documents) — unchanged from Rumi baseline |
| Coaches | Web portal — new pages for coaching review + training content management |
| Admins / partners | Web portal — new pages for content upload + region config |

### D-003 — Digital Coach: augment, don't replace

**Date**: 2026-07-11
**Status**: PROPOSED — awaiting confirmation

Rumi's existing FICO coaching pipeline (`bot/shared/services/coaching/*`) stays. The new work is a review layer on top, not a rewrite. Detailed in [03-digital-coach.md](./03-digital-coach.md).

---

## Open questions (blockers)

| # | Question | Blocks | Owner |
|---|---|---|---|
| ~~Q-1~~ | ~~Confirm portal architecture~~ | — | ✅ Resolved (D-001 confirmed) |
| ~~Q-2~~ | ~~Confirm Exam Generator is dropped~~ | — | ✅ Resolved (BACK IN scope, see [05](./05-exam-generator.md)) |
| Q-3 | Which GCP project + service account gives BigQuery read on Taleemabad's data? | [04](./04-data-migration.md) | Taleemabad DevOps |
| Q-4 | Postgres bastion access (host + SSH key + password) for Taleemabad prod | [04](./04-data-migration.md) (system of record, not BQ mirror) | Taleemabad DevOps |
| Q-5 | Which S3 bucket holds pre-baked LP PDFs, and do we mirror to Rumi's R2 or read cross-account? | [01](./01-lesson-plans.md) | You + Taleemabad DevOps |
| Q-6 | Target region — determines curriculum, language(s), and which external vendors' content ships | All feature docs | You |
| ~~Q-7~~ | ~~Training shape decision~~ | — | ✅ Resolved 2026-07-11: build structured schema fresh; do NOT backport prod Rumi's training/ |

---

## Decision log

| Date | Change | By |
|---|---|---|
| 2026-07-11 | Initial scope + D-001, D-002, D-003 proposed | Design session |
| 2026-07-11 | D-001 confirmed as web-first + Capacitor deferred to end (was: web-only) | User |
| 2026-07-11 | Exam Generator moved from OUT of scope → IN scope | User |
| 2026-07-11 | Discovery: prod Rumi bot already has a `training/` service (7 files, scenario-based, Redis-backed). Opens Q-7 on training shape. | Design session |
| 2026-07-11 | Q-7 resolved: DO NOT backport prod Rumi's training. Build fresh structured schema per [02](./02-teacher-training.md). | User |
