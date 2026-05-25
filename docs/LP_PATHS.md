# Lesson-Plan Paths

Rumi can produce a lesson plan three different ways. Which one runs depends on the request (text vs photo)
and on the region's configuration. This page maps the routing so you know exactly what happens to an LP
request and how to switch each path on.

All claims here are grounded in the shipped code — the router is
[bot/shared/services/lesson-plan-router.service.js](../bot/shared/services/lesson-plan-router.service.js).

## The three paths

| Path | When it runs | Output | Switched on by |
|------|-------------|--------|----------------|
| **Curriculum (gamma_enriched)** | Region has textbooks for the subject **and** the request names a page/chapter | A pre-generated PDF served instantly **or** a Gamma plan enriched with textbook context | `region_features.curriculum_lp_enabled` + `has_textbooks` + `GAMMA_API_KEY` |
| **Generic (gamma_standard)** | The default for any free-form topic | A Gamma-generated lesson-plan PDF from the topic | `GAMMA_API_KEY` |
| **Pic-to-LP** | The teacher sends a **photo** of a textbook page | A 2-page illustrated PDF rendered from the page | `region_features.pic_lp_enabled` + `KIE_API_KEY` (see [features/pic-to-lp.md](features/pic-to-lp.md)) |

## Text request → the router

A text lesson-plan request enters through
[bot/shared/handlers/text-message.handler.js](../bot/shared/handlers/text-message.handler.js)
(`handleLessonPlanRequest`), which extracts the topic and queues the work. The async worker calls the router:

```
LessonPlanRouterService.route({ userId, region, grade, subject, pageNumber })
  → reads region_features for the region
  → IF curriculum_lp_enabled AND has_textbooks AND a page number is present AND the subject is supported:
        return { track: 'gamma_enriched', reason }
     ELSE:
        return { track: 'gamma_standard', reason }
```

There are exactly **two tracks**. The pic-to-LP photo path is separate and never goes through this router.

### gamma_enriched (curriculum)

Handled by [bot/shared/handlers/lesson-plan-v2.handler.js](../bot/shared/handlers/lesson-plan-v2.handler.js)
(`handleCurriculumLessonPlan`):

1. `TopicMatchingService.findChapterByTopic()` matches the request to a chapter in `textbook_toc`.
2. `PreGenLookupService.findPreGenLP()` looks for a pre-generated PDF in the `pre_generated_lps` table (R2 keys `pdf_r2_key_en` / `pdf_r2_key_ur`).
3. **If a pre-generated PDF exists** → it's downloaded from object storage and sent **instantly** (no generation cost or wait).
4. **If not** → the request falls through to Gamma generation enriched with the textbook context for that page.

### gamma_standard (generic)

The default. The request is persisted to `lesson_plan_requests` (status `pending`) and queued; the worker
[bot/workers/lesson-plan-generation.worker.js](../bot/workers/lesson-plan-generation.worker.js) calls the
content service to generate a Gamma plan from the topic, then delivers the PDF and records it in
`lesson_plans`.

## Photo request → Pic-to-LP

A textbook **photo** is routed by [bot/shared/handlers/image-message.handler.js](../bot/shared/handlers/image-message.handler.js):
the image is classified, and if it's a book page the teacher is asked what they want (lesson plan / homework /
…). For a lesson plan, the job goes to [bot/workers/pic-lp-kieai.worker.js](../bot/workers/pic-lp-kieai.worker.js),
which renders a 2-page illustrated PDF with an image model and delivers it. Full detail:
[features/pic-to-lp.md](features/pic-to-lp.md).

## Configuration

Path selection for the text routes is driven by the **`region_features`** table (per-region, fail-open), not
by env vars:

| `region_features` column | Effect |
|--------------------------|--------|
| `curriculum_lp_enabled` | Turns on the curriculum (gamma_enriched) path; default off → everyone gets gamma_standard |
| `has_textbooks` | Region has curriculum textbooks loaded (needed with `curriculum_lp_enabled`) |
| `supported_subjects` | Subjects that have curriculum textbooks |
| `pic_lp_enabled` | Turns on the photo path (default on) |

Generation itself needs the API keys: **`GAMMA_API_KEY`** for the text paths, **`KIE_API_KEY`** for pic-to-LP.
With no `GAMMA_API_KEY`, the text LP feature is off (the bot degrades gracefully — see
[features/lesson-plans.md](features/lesson-plans.md)).

## Tables involved

| Table | Role |
|-------|------|
| `lesson_plan_requests` | Async queue state for a text LP request (`pending`/`processing`/`completed`/`failed`) |
| `lesson_plans` | Completed LPs (with a `source` of e.g. `gamma_standard`, `pre_generated`, `pic_to_lp_kieai`) |
| `pre_generated_lps` | Curriculum-aligned PDFs (R2 keys) served by the gamma_enriched path |
| `textbook_toc` | Curriculum table of contents, used to match a topic to a chapter/page |
| `pic_lp_sessions` | Photo-path session state |
| `region_features` | The per-region gating that the router reads |

## Related

- [features/lesson-plans.md](features/lesson-plans.md) — the teacher-facing lesson-plan feature.
- [features/pic-to-lp.md](features/pic-to-lp.md) — the photo path in depth.
- The `database-analysis` and `feature-tracer` skills under [.claude/skills/](../.claude/skills/) for tracing an LP request end to end.
