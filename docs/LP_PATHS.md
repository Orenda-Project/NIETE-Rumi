# Lesson-Plan Paths

Rumi can produce a lesson plan three different ways. Which one runs depends on the request (text vs photo)
and on the region's configuration. This page maps the routing so you know exactly what happens to an LP
request and how to switch each path on.

All claims here are grounded in the shipped code. Selection between the two text
paths happens **synchronously in the handler**
([bot/shared/handlers/text-message.handler.js](../bot/shared/handlers/text-message.handler.js)),
not in a separate router service. (A `lesson-plan-router.service.js` once existed
as a planned two-track abstraction but was never wired into the handler or the
worker — it was dead code and has been removed. The real intercept is described
below.)

## The three paths

| Path | When it runs | Output | Switched on by |
|------|-------------|--------|----------------|
| **Curriculum (pre-generated)** | Region enables curriculum LPs **and** the topic maps to a pre-generated chapter LP | A pre-generated PDF served instantly | `region_features.curriculum_lp_enabled` + `region_features.curriculum_key` + a matching `pre_generated_lps` row |
| **Generic (Gamma)** | The default for any free-form topic (and the fall-through when the curriculum intercept misses) | A Gamma-generated lesson-plan PDF from the topic | `GAMMA_API_KEY` |
| **Pic-to-LP** | The teacher sends a **photo** of a textbook page | A 2-page illustrated PDF rendered from the page | `region_features.pic_lp_enabled` + `KIE_API_KEY` (see [features/pic-to-lp.md](features/pic-to-lp.md)) |

…and, since FEAT-080, a fourth that is unlike the other three:

| Path | When it runs | Output | Switched on by |
|------|-------------|--------|----------------|
| **6-12 runtime (v9)** | The teacher walks the LP Flow to a grade 6-12 subtopic | A lesson plan **written at the moment she asks**, rendered to PDF, cached in R2 | `LP_612_ENABLED=true` + a loaded segment corpus |

### Why the fourth path is different

The first three either look a PDF up or generate from a free-form topic. This one
authors from the **book's own segmentation**: 62 NBF/FBISE textbooks are cut into
teaching-day segments (one segment = one period), and each segment is a menu row
a teacher can tap. There is no pre-generated corpus behind it — the first teacher
to ask for a lesson causes it to be written, and everyone after her is served the
cached render.

```
tap a subtopic
  → lp612-serving.service.js: is there a render for (segment_id, lang, template_version)?
      ready     → presign the R2 key, sendDocumentByLink. Done in ~a second.
      authoring → join the waiter list on the row already in flight, say so
      failed    → reset the row, retry
      absent    → claim the row (UNIQUE is the lock), ack her, enqueue lp612_author
  → bot/workers/lp612-author.worker.js (SQS, ~2-3 min typical, up to ~10 worst case)
      author (llm-client → OpenRouter, LP_AUTHOR_MODEL)
        → lint + revise ladder (LP612_AUTHOR_ROUNDS)
        → render to PDF
        → upload to R2 at lp612/<template_version>/<lang>/<segment_id>.pdf
        → mark the row ready, deliver to every waiter
```

**Two flags, not one.** `LP_612_ENABLED` gates the feature. `LP_612_RELIGIOUS_ENABLED`
separately gates Islamiat books and seerah content anywhere in the corpus, which
are held pending a native-speaker review — turning the feature on does not
release them, and there is no `||` between the two anywhere in the code.
`is_religious` is computed once at import
(`bot/scripts/import-lp612-segments.js`) and stored, so the rule lives in exactly
one place.

**Grades 6-10 keep Oxbridge as a fallback.** 70 Oxbridge LPs are live; the 6-12
corpus wins for a grade where it has segments, and where it does not, the
Oxbridge picker answers exactly as before. Grades 11-12 appear on the picker only
when the flag is on and the corpus actually holds segments for them.

Loading the corpus: `node bot/scripts/import-lp612-segments.js <dir> [--dry-run]`.
Idempotent, keyed on `segment_id`, and scoped per book — importing one finished
book never touches another's rows. Tables: `niete_lp612_segments` (the menu) and
`niete_lp612_renders` (the R2 cache ledger), migration
`infrastructure/supabase/migrations/V1.2.8__lp612_runtime_lesson_plans.sql`.

## Text request → the handler intercept

A text lesson-plan request enters through
[bot/shared/handlers/text-message.handler.js](../bot/shared/handlers/text-message.handler.js).
Before queueing the generic job, the handler calls a **synchronous curriculum
intercept**, `tryCurriculumLessonPlanServe(from, topic, user, language)`:

```
tryCurriculumLessonPlanServe(from, topic, user, language)
  → reads region_features for the user's region
  → IF NOT curriculum_lp_enabled OR no curriculum_key:
        return false   // fall through to the generic Gamma path
     ELSE:
        result = handleCurriculumLessonPlan({ userId, topic, grade, subject, curriculum, language })
        return result.source === 'pre_generated'   // true ⇒ already served, stop here
```

If the intercept returns `true`, a pre-generated PDF was served and the handler
stops. If it returns `false` (the default for any deployment —
`curriculum_lp_enabled` defaults to `false`, so the intercept is inert), the
handler calls `handleLessonPlanRequest(...)`, which queues a generic Gamma job.

The pic-to-LP photo path is separate and never goes through this intercept.

### Curriculum (pre-generated)

Handled by [bot/shared/handlers/lesson-plan-v2.handler.js](../bot/shared/handlers/lesson-plan-v2.handler.js)
(`handleCurriculumLessonPlan`):

1. The request is matched to a chapter in `textbook_toc`.
2. A pre-generated PDF is looked up in `pre_generated_lps` (R2 keys `pdf_r2_key_en` / `pdf_r2_key_ur`).
3. **If a pre-generated PDF exists** → it's downloaded from object storage and sent **instantly** (no generation cost or wait); the intercept reports `source: 'pre_generated'`.
4. **If not** → the intercept reports no pre-generated hit and the handler falls through to the generic Gamma path.

### Generic (Gamma)

The default. `handleLessonPlanRequest` persists the request to `lesson_plan_requests`
(status `pending`) and queues it; the worker
[bot/workers/lesson-plan-generation.worker.js](../bot/workers/lesson-plan-generation.worker.js)
calls `ContentService.generateLessonPlan(topic, fullMessage, language)` **directly**
(there is no router hop) to generate a Gamma plan from the topic, then delivers the
PDF and records it in `lesson_plans`. The Gamma prompt framework (the 9-section /
5E structure) is built in
[bot/shared/services/lesson-plan-template.service.js](../bot/shared/services/lesson-plan-template.service.js)
and consumed by `ContentService._generateGammaContent`.

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
| `curriculum_lp_enabled` | Turns on the curriculum pre-gen intercept; default off → every text LP goes to the generic Gamma path |
| `curriculum_key` | Identifies which curriculum to match against (`pre_generated_lps` / `textbook_toc`); the intercept is a no-op without it |
| `pic_lp_enabled` | Turns on the photo path (default on) |

Generation itself needs the API keys: **`GAMMA_API_KEY`** for the text paths, **`KIE_API_KEY`** for pic-to-LP.
With no `GAMMA_API_KEY`, the text LP feature is off (the bot degrades gracefully — see
[features/lesson-plans.md](features/lesson-plans.md)).

## Tables involved

| Table | Role |
|-------|------|
| `lesson_plan_requests` | Async queue state for a text LP request (`pending`/`processing`/`completed`/`failed`) |
| `lesson_plans` | Completed LPs (with a `source` of e.g. `gamma_standard`, `pre_generated`, `pic_to_lp_kieai`) |
| `pre_generated_lps` | Curriculum-aligned PDFs (R2 keys) served by the curriculum intercept |
| `textbook_toc` | Curriculum table of contents, used to match a topic to a chapter/page |
| `pic_lp_sessions` | Photo-path session state |
| `region_features` | The per-region gating the handler intercept reads (`curriculum_lp_enabled`, `curriculum_key`, `pic_lp_enabled`) |

## Related

- [features/lesson-plans.md](features/lesson-plans.md) — the teacher-facing lesson-plan feature.
- [features/pic-to-lp.md](features/pic-to-lp.md) — the photo path in depth.
- The `database-analysis` and `feature-tracer` skills under [.claude/skills/](../.claude/skills/) for tracing an LP request end to end.
