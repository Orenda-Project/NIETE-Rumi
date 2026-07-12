# 01 — Lesson Plans

**Status**: 🟢 JSON AST corpus imported (2026-07-12); PDF rendering + intercept wiring pending
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md) D-001
**Feeds**: [04-data-migration](./04-data-migration.md)

---

## Scope

Teacher opens WhatsApp → tells Rumi their class + grade → Rumi looks up the relevant pre-baked lesson plan and sends it (as PDF or interactive message flow).

**Not**: LP generation. NIETE-Rumi consumes finished LPs from Taleemabad prod.

## Corpus imported (2026-07-12)

The finished-LP content ships as **structured JSON** in `curriculum_lp_ast`, imported from `taleemabad-core.slo_lessonplan` via `bot/scripts/migration/import-tbcore-lps.js`.

- Migration: `bot/database/migrations/016_curriculum_lp_ast.sql`
- Import script: `bot/scripts/migration/import-tbcore-lps.js` (dry-run + idempotent upsert on `(source_chapter_id, source_lp_uuid)`)
- Filter: `Book.is_active=true AND Book.status='OnProd' AND publisher IN ('NBF','Taleemabad')` + downstream soft-delete flags
- **Result: 2,415 rows** — 942 NBF + 1,473 Taleemabad
- **Content shape**: JSON step arrays (`opening_steps`, `explain_steps`, `practice_steps`, `independent_practice_steps`, `conclusion_steps`, `classroom_setup_instructions`, `homework_instructions`), plus timing / videos / SLO refs
- **Pre-render framing**: the JSON steps ARE the finished LP. Rendering to PDF or to a WhatsApp message flow is deferred to serve time. Cached PDF r2 keys populate `pdf_r2_key_en` / `pdf_r2_key_ur` after first render.

Round-trip verified: md5(`explain_steps`) matches between source and destination for random spot-checks.

## What's next

1. Renderer: `bot/shared/services/lp-ast-renderer.service.js` — takes a `curriculum_lp_ast` row, produces either a PDF (v7-style template) OR a series of WhatsApp messages
2. Wire `tryCurriculumLessonPlanServe` (in `text-message.handler.js`) to prefer `curriculum_lp_ast` matches over `pre_generated_lps` when the teacher's `region_features.curriculum_key IN ('nbf_snc','taleemabad')`
3. R2 caching for rendered PDFs — key format `lps/v8/<source_lp_uuid>.<lang>.pdf`

## Not doing

- LP generation (Taleemabad's `generate_lesson_plan_content` Celery task)
- SLO/Bloom tagging (`LessonPlanSubNcpSloMapping`)
- External-LP rating/favoriting (`TeacherExternalLessonPlanStatus`)
- Multi-version LP edit tracking (`CoreLessonPlanEdit`)

## ⚡ Existing implementation discovered (2026-07-11)

**~80% of the LP UX already exists in `rumi-platform`.** See `bot/shared/handlers/lesson-plan-v2.handler.js` — the "curriculum LP" path already:

1. Takes `{userId, topic, grade, subject, curriculum, language}` as input
2. Calls `TopicMatchingService.findChapterByTopic()` to match topic → chapter
3. Calls `PreGenLookupService.findPreGenLP()` to find the pre-generated PDF's R2 key
4. Selects `pdf_r2_key_en` or `pdf_r2_key_ur` based on `language`
5. Downloads the PDF from R2 and sends it via `WhatsAppService.sendDocument()`
6. Falls through to Gamma generation if no match

Region-gated by `region_features.curriculum_key`. **This is a fully working feature — we just need to populate its lookup tables with the region's data (which is the [04](./04-data-migration.md) workstream) and set `region_features.curriculum_key` for the new region.**

**Consequences**:
- The `lesson_plan_catalog` schema below may be redundant with the existing `pregen_lookup` table — verify by reading `PreGenLookupService` and the existing schema before adding a new table (Critical Rule 15 anti-sprawl).
- The `lp-catalog.service.js` proposed below may already exist as `PreGenLookupService`. Extend that instead of adding a parallel service.
- Only genuinely new code is any **menu-driven browse path** (UX v1 Entry B below) — the existing handler is topic-driven only.

## WhatsApp UX (v1 proposal — awaiting workshop feedback)

Two coexisting entry points, both hitting the same PDF-lookup engine.

### Entry A — Type-a-topic (existing, works today)

```
Teacher:  "photosynthesis"           [or "grade 5 science photosynthesis"]
Rumi:     [matches chapter, downloads PDF, sends as document]
          "📄 Chapter 6 — How Plants Make Food.pdf
           If this isn't the right one, tell me which chapter you want."
```

This path is live in `lesson-plan-v2.handler.js`. No changes needed for the fork beyond region-features config + data.

### Entry B — Menu browse (new, additive)

```
Teacher:  [Menu → "Lesson Plans" button]        OR types "lesson plan"
Rumi:     "Which subject?"
          [Buttons: Math | Urdu | Science | ...]
Teacher:  [taps Math]
Rumi:     [List message]
          "Grade 5 Math — pick a chapter:
           1. Numbers up to 10,000
           2. Addition & subtraction
           3. Multiplication
           …"
Teacher:  [taps chapter 3]
Rumi:     [sends PDF]
          "📄 Chapter 3 — Multiplication.pdf"
```

New services required for Entry B (if we build it):
- Extend `PreGenLookupService` with `listSubjectsForRegion(regionKey, grade)` and `listChaptersForGradeSubject(grade, subject, curriculum)`
- New handler `lesson-plan-menu.handler.js` — handles the Menu → Lesson Plans button and its two-step list interaction
- WhatsApp List Message payloads — no Flow needed (Lists are simpler primitives)

### Open workshop questions

Answered by user during workshop; then this doc gets a "Decisions" section.

1. **Do we build Entry B?** — Or is topic-typing (Entry A) sufficient for the new region?
2. **Multi-class teachers** — if a teacher teaches Grade 3 Math AND Grade 5 Science, how does the browse path pick which grade? (ask upfront / show all / default to primary)
3. **>10 chapters** — WhatsApp Lists max at 10 items. Punjab math has 12–15 chapters per grade. Paginate / group / split by term?
4. **Language selection** — Existing handler picks EN/UR from `input.language`. Where does it come from — registered WhatsApp language, or per-request choice?
5. **Feedback capture** — 👍 / 👎 follow-up after PDF delivery? If yes → new `lesson_plan_feedback` table + handler branch.
6. **No-match fallback** — Existing behaviour falls through to Gamma generation. Keep, or replace with *"Not in your curriculum yet"*?

## What we build

### Schema — verify before adding

Before creating `lesson_plan_catalog` per the block below, **read `PreGenLookupService` and its underlying table**. If it already handles (region, grade, subject, chapter, language, url), we extend it — do NOT create a parallel table.

If a new table is genuinely needed:

```sql
-- Catalog of pre-baked LPs available to teachers
CREATE TABLE lesson_plan_catalog (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region            TEXT NOT NULL,           -- e.g. 'pk-punjab', 'tz'
  grade             TEXT NOT NULL,           -- e.g. 'grade-3'
  subject           TEXT NOT NULL,           -- e.g. 'math', 'urdu'
  chapter_index     INT,                     -- nullable — some LPs are cross-chapter
  chapter_title     TEXT,
  language          TEXT NOT NULL,           -- 'en', 'ur', 'sd', etc.
  source_vendor     TEXT,                    -- 'taleemabad-internal', 'oxbridge', 'tcf', 'teal', etc.
  s3_url            TEXT NOT NULL,           -- signed or public URL to the PDF
  title             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lp_catalog_lookup
  ON lesson_plan_catalog (region, grade, subject, is_active);
```

### New service

`bot/shared/services/lp-catalog.service.js` — sits alongside the existing `lp-shelf.service.js`. Query by `(region, grade, subject)`, optionally filter by chapter.

### Handler wiring

`lesson-plan-v2.handler.js` **already handles the curriculum path** — no changes needed for Entry A (type-a-topic). If we build Entry B (menu browse), add a new handler `lesson-plan-menu.handler.js` that shares the same lookup service.

## Data migration dependency

The catalog is populated from Taleemabad's LP URLs. Two candidate sources:

| Source | Table | Note |
|---|---|---|
| Postgres (system of record) | `lesson_plan_externallessonplan` | Full URLs, per-vendor tagging, active flags |
| BigQuery (analytics mirror) | Same table, synced downstream | Might lag; might be missing recent additions |

**Preferred**: Postgres, once we have bastion access. See [04-data-migration.md](./04-data-migration.md).

## Open items

- Workshop questions 1–6 above (UX shape, multi-class, pagination, language, feedback, fallback)
- **Q-5** (blocker): which S3 bucket, and do we mirror to Rumi's R2 or use cross-account reads?
- Do we filter by `source_vendor` at query time, or seed only the vendors the region has licenced?
- **Verify before schema add**: does `PreGenLookupService`'s underlying table already cover `lesson_plan_catalog`'s columns? If yes, don't add a table.
