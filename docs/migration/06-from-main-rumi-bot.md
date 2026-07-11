# 06 — What to Backport from the Main Rumi Bot

**Status**: 🟡 Draft — catalog and prioritise
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md)
**Feeds**: [01](./01-lesson-plans.md), [02](./02-teacher-training.md), [03](./03-digital-coach.md), [05](./05-exam-generator.md)

---

## Why this doc exists

The **`rumi-platform` open-source repo** was created from `02_Main Rumi Bot` (production) by stripping out ~43 services deemed too partner-specific, too internal, or too in-flux for public release. See the top-level comparison we did earlier: production has 97 services vs. open-source's 54.

**But** the fork we're building for the new region is closer in shape to production than to bare open-source — it needs teacher training, coaching reports, PDF certificates, translation caching, A/B testing, and more. Rather than reinvent these, we **backport them** from `02_Main Rumi Bot` into the fork.

This file catalogs what to bring across, sorted by relevance to our four in-scope features.

## Directory mapping (important)

| Production | This fork |
|---|---|
| `02_Main Rumi Bot/shared/services/foo.js` | `rumi-platform/bot/shared/services/foo.js` |
| `02_Main Rumi Bot/workers/foo.js` | `rumi-platform/bot/workers/foo.js` |
| `02_Main Rumi Bot/tests/foo.test.js` | `rumi-platform/tests/foo.test.js` (**paths require `../../bot/shared/...` not `../../shared/...`**) |

## Backport priority buckets

### 🔴 Required (blocks a workstream if missing)

| File(s) from `02_Main Rumi Bot` | Why we need it | Feeds |
|---|---|---|
| `shared/services/pdf.service.js` + `shared/services/pdf-report-pdfmake.service.js` | Certificate generation, coach report PDFs. Open-source has no PDF library wired. | [02](./02-teacher-training.md), [03](./03-digital-coach.md) |
| `shared/services/translation-cache.service.js` | New region likely needs a language Rumi hasn't served yet — this caches LLM translations across users to avoid re-translating static strings. | All features |
| `shared/services/feature-health.service.js` | Health-monitor for LLM-backed features (rollup of error rates, cost). Needed to notice when the new region's coaching pipeline degrades. | [03](./03-digital-coach.md) + ops |
| `shared/services/ab-split.service.js` + `shared/services/ab-dashboard.service.js` | A/B testing framework (already stripped) — needed for staged rollout of coach-review, training flows to the new region. | Rollout of all features |

### 🟡 Likely-needed (revisit after Q-6 region choice)

| File(s) | Why we might need it | Feeds |
|---|---|---|
| `shared/services/support-assistant/` (whole folder) | Handles "how do I do X?" WhatsApp queries. New region operators will get these. | Operator UX |
| `shared/services/password-reset.service.js` + `password-reset-sender.service.js` | Portal auth flows. Needed if coach + admin portal requires login (very likely). | [03](./03-digital-coach.md) portal auth |
| `shared/services/user-preferences.service.js` | Per-user settings (language, notification prefs). Currently missing from open-source. | All features |
| `shared/services/slack-alert.service.js` | Ops alerts (e.g. coaching pipeline errors → Slack). Optional if the new region uses a different channel. | Ops |
| `shared/services/chart.service.js` | Renders Economist-style charts. Only if coach report PDFs include charts (they do in prod). | [03](./03-digital-coach.md) |
| `shared/services/lp-router-v2.service.js` + `lesson-plan-router.service.js` | Multi-source LP routing. Only if the fork ends up with multiple LP sources beyond the S3 catalog. | [01](./01-lesson-plans.md) |
| `shared/services/lp-feedback.service.js` + `lp-qa.service.js` + `lp-qa-turn.service.js` | Teacher-facing LP Q&A ("this LP has a mistake" flows). Skip unless the region wants engagement tracking. | [01](./01-lesson-plans.md) |

### 🟢 Nice-to-have (defer unless a specific ask)

| File(s) | Skip reason |
|---|---|
| `shared/services/training/*.js` (7 files) | **Decision 2026-07-11**: build the fork's training from scratch using the schema in [02](./02-teacher-training.md), don't inherit the prod scenario-flow shape. Prod's shape (Redis-only sessions, no course structure, no certificate) doesn't fit the structured multi-vendor content model we're porting from Taleemabad. |
| `shared/services/lesson-plan-prompts.service.v3–v10` (7 versioned LP prompt files) | We're serving pre-baked LPs, not generating. Skip all seven. |
| `shared/services/chapter-day-loader.service.js`, `chapter-lp-generation`, `page-lp-generation`, `textbook-page.service.js` | LP generation from curriculum — same reason. Skip. |
| `shared/services/ocr-ingestion.service.js`, `openai-file-extract.service.js` | Book scanning / OCR. Skip unless generating LPs from books. |
| `shared/services/ug-lesson-plan.service.js` + `ug-lesson-plan.worker.js` + `uglp-circuit-breaker.service.js` | UG LP path — Taleemabad-specific external service (`lp-assistant.taleemabad.com`). Not portable. Skip. |
| `shared/services/v20-scanner.service.js` | Voicenote V20 curriculum scanner — deep Rumi-internal, curriculum-specific. Skip. |
| `shared/services/batch-runner.service.js` | Internal batch execution. Not needed for a region. |
| `shared/services/storybook-delivery.service.js` + `storybook-feedback.service.js` | Story delivery — Taleemabad-partner-specific. Skip. |
| `shared/services/proj42/` + `rwp-broadcast.service.js` + `tfsl-broadcast.service.js` + `taleemhub.service.js` | Partner-specific broadcasts (Project 42, Rawalpindi, TFSL, TaleemHub). All skip. |
| `shared/services/coaching.service.js` (already deleted from open-source per PR #67) | Dead legacy monolith — the working code is in `shared/services/coaching/` (folder). Do not resurrect. |

### ❓ Investigate before deciding

| File(s) | Why unclear |
|---|---|
| `shared/services/lesson-plan-iteration.service.js` | Could be the "teacher edits LP" flow — depends on whether we support LP edits in the region. Read the code before deciding. |
| `shared/services/lp-shelf.service.js` | Already in open-source but likely diverged. Diff prod vs. OS before backporting changes. |
| `shared/services/rwp-broadcast.service.js` broadcast primitives | The *broadcast infrastructure* (queue, retry, template registration) might be worth generalising even if the RWP-specific config isn't. Read to see if it's abstractable. |

## New workers to check

| Worker in prod | Status in fork | Action |
|---|---|---|
| `workers/coaching-processor.js` | Deleted from open-source (PR #67, replaced by queue abstraction) | Do not resurrect |
| `workers/ug-lesson-plan.worker.js` | Prod only | Skip (UG LP path, out of scope) |
| Other 10 workers | All already in open-source | No action |

## Backport process

For each file in the 🔴 and 🟡 buckets:

1. **Read prod version** — check for hardcoded partner references (`taleemabad.com`, `92329…`, `hyasin270`, etc.)
2. **Sanitize** — replace hardcoded values with env vars or region-config lookups
3. **Copy to fork** — `bot/shared/services/foo.js` (mirror the prod path under `bot/`)
4. **Update require paths in tests** — from `../../shared/...` to `../../bot/shared/...`
5. **Add conformance guard entries** — if the service `.from()`s a new table or `.rpc()`s a new function, extend the guards in `tests/setup/`
6. **Run `npm test`** — must stay green
7. **Run source-hygiene test** — `tests/setup/source-hygiene.test.js` catches leaked partner names

## Timeline dependencies

- 🔴 items block their feature workstreams — do these FIRST for each feature we start
- 🟡 items can be deferred to a per-feature "polish" pass
- 🟢 items only surface if a specific ask comes up

## Open items

- Do we want the **`bugbuster/` QA rig** from production for this fork? Explicitly stripped from open-source. Answer probably yes for a new region (catches WhatsApp-flow regressions during rollout) but adds complexity.
- Should backports go through a PR to the open-source `rumi-platform` first (upstream fix), or straight into the fork? Depends on whether the code is genuinely generic (upstream it) or region/partner-specific (fork-only).
