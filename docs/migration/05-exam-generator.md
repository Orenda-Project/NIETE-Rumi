# 05 — Exam Generator

**Status**: 🟢 Design approved (2026-07-12) · ready for implementation plan
**Depends on**: [04-data-migration](./04-data-migration.md) (Taleemabad bastion access, question-bank import)
**Related**: Rumi's existing **Quiz** feature (`bot/shared/services/quiz/`) — parallel, not extended

---

## Scope

Student-facing exam papers. A NIETE-trained teacher triggers `/exam`, picks grade + subject + type + chapters via a WhatsApp Flow, and receives a printable **Microsoft Word document** she can hand to her class.

| In scope (v1) | Explicitly deferred |
|---|---|
| Type: `WEEKLY` (chapter assessment) | Type: `DIAGNOSTIC_ASSESSMENT` (baseline/endline) |
| Type: `TERM` (multi-chapter, comprehensive) | Type: `FORMATIVE_ASSESSMENT` |
| Composition from imported question bank (no LLM) | LLM-generated fresh questions |
| WhatsApp Flow (3 screens) | Portal-based editor |
| Delivered as `.docx` | PDF, answer key, or both |
| English + Urdu papers | Trainee-facing exams (post-training assessments) |
| Random sample per Bloom blueprint | Adaptive difficulty across attempts |
| — | Automatic student-answer grading (exam_checker) |
| — | Exam sharing between teachers |
| — | Editing generated exams |
| — | Checkpoints / school_class scoping (Taleemabad concepts NIETE doesn't use) |

---

## Design decisions (approved)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Bank-based, not LLM-generated** | Taleemabad's `question_bank_question` (~28-field, curriculum-tagged, marking-scheme-included pool) is pre-vetted by curriculum experts. Higher quality than fresh LLM generation, no per-question cost, no hallucination. |
| D2 | **Student-facing exams** (not trainee-facing) | Uses Taleemabad's grade+subject+chapter question pool. Trainee-facing = future feature. |
| D3 | **Port Taleemabad's exam-generator model, minus NIETE-irrelevant complexity**: drop 4-of-28 `Question` fields (`assessment_type`, `source`, `lesson_plans` M2M, `author`), 6-of-12 `ExamGenerator` fields (`time`, `diagnostic_assessment_type`, `total_students`, `total_images`, `checkpoint` FK, `school_class` FK, `is_exam_share`), and 3 whole tables (`Assessment`, `CheckPoint`, `SchoolClass`). Keep everything else. | Preserves proven pedagogy (SEEN/UNSEEN, Bloom criteria, marking schemes, question groups) without dragging in Taleemabad's checkpoint/timetable subsystems that NIETE doesn't have. |
| D4 | **Denormalise grade+subject+language to TEXT columns** | NIETE's LP catalog already uses this shape. Saves a `grade_subjects` join table. |
| D5 | **Import filter**: `question_status = 'ONPROD'` only | Skip Taleemabad's QA backlog. Cleaner pool. |
| D6 | **Media URLs proxied**, not rehosted | Read from Taleemabad's S3 at render time. Accept the risk of a bucket rotation; fix reactively. HEAD-check at render, substitute placeholder on 404. |
| D7 | **Snapshot statement + FK to bank** on `exam_questions` | ~2× storage overhead, but lineage for analytics + immunity from bank edits. |
| D8 | **Variable total marks** (sum picked-question `score`) | Matches Taleemabad's per-question authoring. Advertise "~30 marks" in the flow; deliver whatever sums. |
| D9 | **Blueprints from `question_bank_assessment` table** | Copy real Bloom/Skills breakdowns per grade+subject at import time. Human-review before shipping. |
| D10 | **Sections = `objective` / `subjective`** (matches Taleemabad), not A/B/C | Cleaner terminology; questions cluster by `question_format` (MCQs, Fill-in-Blanks, Comprehension Passage…) within each section. |
| D11 | **Word doc (.docx), not PDF, for v1** | Editable by teacher (add school header, tweak questions). No Playwright/Chromium dependency for exam-gen. Font is recipient's responsibility. |
| D12 | **No answer key in v1** | Ship half the render surface. `exam_questions` still snapshots answer + marking scheme (so a v2 answer key is a rendering change, not a data change). |

---

## Data model — 4 new tables

> **2026-07-12 correction**: Design originally said 3 tables with `question_groups` rolled into a self-FK. Realised during implementation that group metadata (passage text, image) genuinely needs a separate row. Added a small `exam_question_groups` companion table (~hundreds of rows).


Detailed columns match the schema block below; denormalisation choices (grade/subject/language as TEXT, chapters as `INT[]`) match D4.

### `exam_question_bank` — the imported vetted pool

```sql
CREATE TABLE exam_question_bank (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taleemabad_uuid     UUID UNIQUE NOT NULL,         -- lineage anchor for idempotent re-import
  grade               TEXT NOT NULL,                -- "5"
  subject             TEXT NOT NULL,                -- "Mathematics" | "English" | "Urdu" | ...
  language            TEXT NOT NULL,                -- "en" | "ur"
  chapter_index       INT NOT NULL,
  chapter_title       TEXT NOT NULL,
  question_statement  TEXT NOT NULL,
  question_media      JSONB DEFAULT '[]'::jsonb,    -- [{ "url": "s3://...", "type": "image" }]
  question_format     TEXT NOT NULL,                -- "text" | "media" | "statement-image"
  type                TEXT NOT NULL,                -- Taleemabad's granular type (MCQs, FTB, Brief Answer, ...)
  sub_type            TEXT,
  score               REAL NOT NULL CHECK (score >= 1),
  marking_scheme      TEXT,                         -- e.g. "3 marks: 1 for each correct statement"
  category            TEXT NOT NULL CHECK (category IN ('SEEN','UNSEEN')),
  answer_options      JSONB DEFAULT '[]'::jsonb,    -- MCQ: [{ "text": "...", "is_correct": true }]
  correct_answer      TEXT,                         -- freeform correct answer / model answer
  bloom_tags          TEXT[] NOT NULL DEFAULT '{}', -- ['REMEMBER','UNDERSTAND','APPLY']
  ncp_slo_ref         TEXT,                         -- flattened NCPSLO, e.g. "5-M-N-01"
  book_chapter_slo    JSONB,                        -- keep as-is (Taleemabad's LP SLO metadata)
  group_ref           UUID,                         -- self-FK for question groups (comprehension etc.)
  group_type          TEXT,                         -- 'comprehension' | 'match-the-columns' | 'choice' | ...
  index_in_chapter    INT NOT NULL DEFAULT 1,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON exam_question_bank (grade, subject, language, chapter_index);
CREATE INDEX ON exam_question_bank USING GIN (bloom_tags);
CREATE INDEX ON exam_question_bank (group_ref) WHERE group_ref IS NOT NULL;
```

Notes: no soft-delete (hard-delete on re-import if a source row retires); `taleemabad_uuid` is the reconciliation anchor.

### `exams` — a teacher-generated exam instance

```sql
CREATE TABLE exams (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  type                TEXT NOT NULL CHECK (type IN ('WEEKLY','TERM')),
  grade               TEXT NOT NULL,
  subject             TEXT NOT NULL,
  language            TEXT NOT NULL,
  chapters            INT[] NOT NULL,               -- chapter_index values, e.g. {1,2}
  total_questions     INT NOT NULL,                 -- from composition
  total_marks         INT NOT NULL,                 -- SUM(picked.score) at compose time
  duration_minutes    INT NOT NULL,                 -- from blueprint
  status              TEXT NOT NULL DEFAULT 'composing'
                        CHECK (status IN ('composing','ready','failed')),
  paper_docx_url      TEXT,                         -- R2 URL of the rendered .docx
  error_reason        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at            TIMESTAMPTZ
);

CREATE INDEX ON exams (created_by_user_id, created_at DESC);
```

### `exam_questions` — snapshot of picked questions

```sql
CREATE TABLE exam_questions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id                  UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  order_index              INT NOT NULL,
  source_bank_id           UUID NOT NULL REFERENCES exam_question_bank(id),
  section                  TEXT NOT NULL CHECK (section IN ('objective','subjective')),
  question_format          TEXT NOT NULL,           -- for PDF sub-heading grouping
  -- Snapshots — insulate rendered exam from future bank edits:
  statement_snapshot       TEXT NOT NULL,
  options_snapshot         JSONB DEFAULT '[]'::jsonb,
  correct_answer_snapshot  TEXT,                    -- kept for v2 answer key
  marking_scheme_snapshot  TEXT,                    -- kept for v2 answer key
  media_snapshot           JSONB DEFAULT '[]'::jsonb,
  score                    REAL NOT NULL,
  bloom_tags               TEXT[] DEFAULT '{}',
  group_ref                UUID,                    -- if part of a rendered group block
  UNIQUE(exam_id, order_index)
);

CREATE INDEX ON exam_questions (exam_id);
CREATE INDEX ON exam_questions (source_bank_id);
```

### Not creating

| Skipped | Why |
|---|---|
| `checkpoints` table | Federal PK doesn't formalise academic calendar the way Taleemabad does. |
| `school_classes` / `timetable` tables | NIETE has no class-timetable subsystem. |
| `assessments` table | Bloom/Skills blueprints live as JS constants (see below), not stored config. |
| `grade_subjects` join table | Denormalised TEXT columns match LP catalog. |
| `ncp_slos` normalised table | Flattened to `ncp_slo_ref` TEXT column. |

---

## Composition — blueprints + algorithm

Blueprints live at `bot/shared/services/exam/exam-composer.blueprints.js`. Seeded from Taleemabad's `question_bank_assessment` table via a one-shot SQL extract, then human-reviewed before shipping.

```js
// key = `${grade}::${subject}::${type}`
// Shape: BloomsBreakdown OR SkillsBreakdown (matches Taleemabad's Assessment.criteria)
{
  '5::Math::WEEKLY': {
    duration_minutes: 40,
    seen_pct: 80, unseen_pct: 20,
    criteria: { type: 'blooms', breakdown: { remember: 8, understand: 5, apply: 2 } },
  },
  '5::Math::TERM': {
    duration_minutes: 120,
    seen_pct: 30, unseen_pct: 70,
    criteria: { type: 'blooms', breakdown: { remember: 12, understand: 12, apply: 8 } },
  },
  '5::Eng::WEEKLY': {
    duration_minutes: 40,
    seen_pct: 80, unseen_pct: 20,
    criteria: { type: 'skills', breakdown: { reading: 6, writing: 6, listening: 2, speaking: 1 } },
  },
  // ... one entry per (grade × subject × type) NIETE supports at launch
}
```

Fallback for a missing blueprint: generic `{ type: 'blooms', breakdown: { remember: 40%, understand: 40%, apply: 20% } }`.

### Algorithm (pseudocode)

```
compose_exam(user, type, grade, subject, language, chapters):
  1. blueprint = BLUEPRINTS[`${grade}::${subject}::${type}`] ?? GENERIC
  2. For each bucket in blueprint.criteria.breakdown:
       pool = query bank filtered by grade+subject+language+chapters+bucket
       split by SEEN/UNSEEN, apply blueprint.seen_pct
       random-sample the target count
       if either subpool is short → borrow from the other
       if total pool still short → FAIL (see failure modes)
  3. Expand groups: any picked question with group_ref pulls all siblings atomically.
  4. Order: section (objective→subjective), chapter_index ASC, index_in_chapter ASC.
  5. Snapshot into exam_questions (statement + options + correct_answer + marking_scheme + media).
  6. total_marks = SUM(picked.score);  duration_minutes = blueprint.duration_minutes.
  7. status='ready' when docx render + R2 upload succeed.
```

### Failure modes

| Condition | Teacher-facing message |
|---|---|
| < 60% of any bucket's quota available | "Not enough questions in these chapters yet. Try picking more chapters, or ask us to add coverage." |
| Zero questions for the language filter | "We don't have Urdu questions for these chapters yet — want the English version?" |
| Group unresolvable (orphan siblings) | Silently drop the group; log for import fix. |
| Docx render fails | "Something went wrong. Try again in a minute." (no fallback in v1) |

---

## WhatsApp Flow UX — 3-screen linear

Trigger: teacher sends `/exam` in WhatsApp → `text-message.handler.js` detects the slash command → sends a Flow message with `EXAM_GENERATOR_FLOW_ID`.

```
Screen 1: Exam Type
  ○ Weekly test (1-2 chapters)
  ○ Term exam (multiple chapters)
  [Next]

Screen 2: Grade + Subject + Language
  Grade:    [ Grade 5      ▼ ]     ← from teacher's registered grade_subjects
  Subject:  [ Mathematics  ▼ ]
  Language: [ Urdu         ▼ ]     ← default: user.preferred_language
  [Next]

Screen 3: Chapters
  ☑ Ch 1: Numbers & Operations
  ☑ Ch 2: Fractions
  ☐ Ch 3: Decimals
  ...
  [Generate Exam]
```

Server receives one payload on completion; kicks off composition + docx render in the background. Teacher receives:

```
Bot: "Making your Grade 5 Math weekly test on Chapters 1 & 2. ~30 sec…"
Bot: [DOCX: Grade5_Math_Weekly_2026-07-12.docx]
```

### Flow registration

- Flow JSON at `docs/flows/exam-generator-flow.json` (published to Meta via `.claude/skills/whatsapp-flows`).
- `EXAM_GENERATOR_FLOW_ID` env var.
- Endpoint route at `bot/shared/routes/exam-generator-endpoint.js`, mounted in `flow-endpoint.routes.js`.

---

## Rendering — Word document

Library: **[`docx`](https://docx.js.org/)** (npm, `dolanmiu/docx`). Native Node builder API; emits proper OOXML.

- Template file: `bot/shared/services/exam/exam-paper.template.js`
- Single variant (paper only for v1). Answer-key rendering deferred to v2 — data already snapshotted.

### Anatomy

```
┌── HEADER BLOCK ──────────────────────────────┐
│ NIETE                                         │
│ Grade 5 · Mathematics · Weekly Test           │
│ Total Marks: 34    Time: 40 min               │
│ Student Name: ______________  Roll: ______    │
└───────────────────────────────────────────────┘

SECTION 1 — OBJECTIVE
  ─── MCQs ───
    1. Which is prime?               (1 mark)
       (a) 4   (b) 7   (c) 9   (d) 12
    2. …

  ─── Fill in the Blanks ───
    6. The sum of 5 and 3 is ______  (1 mark)

SECTION 2 — SUBJECTIVE
  ─── Short Answer ───
    11. Solve 24 ÷ 6 = ?             (4 marks)
        ___________________________
        ___________________________
        ___________________________

  ─── Comprehension Passage ───
    [passage — shaded block]
    15. (a) Who is the main character?  (2 marks)
        __________________________

  ─── Long Answer ───
    22. …                            (12 marks)
        [10 ruled lines]
```

### Answer space per type

| Type | Space after question |
|---|---|
| MCQs, MSQs, True/False | none (student marks options) |
| Fill in the Blanks | inline blank |
| Match the Column | 2-column table, no writing space |
| Brief Answer | 2 ruled lines |
| Short Answer | 4 ruled lines |
| Long Answer | 10 ruled lines |
| Essay / Letter / Story Writing | full page block |

### Font strategy

- Font stack for English: `Lexend, Arial, sans-serif`
- Font stack for Urdu: `Jameel Noori Nastaleeq, Noto Nastaliq Urdu, Arial, sans-serif`
- Fonts NOT embedded in .docx — recipient's OS provides them.
- RTL section direction for Urdu papers.
- Section labels translated: `Section 1 — Objective` ⇢ `حصہ اول — معروضی`.

### Media

- Rendered as inline `<img>`-equivalent in docx via `ImageRun`.
- URL fetched at render time (Playwright not needed for exam-gen).
- HEAD-check before render; on 404, substitute `[Figure unavailable]` placeholder and continue.

### File naming

`{Grade}{Grade#}_{Subject}_{Type}_{YYYY-MM-DD}.docx` — e.g. `Grade5_Math_Weekly_2026-07-12.docx`. Collisions unlikely; readable when re-shared.

---

## Data migration (executes before code ships)

Script: `scripts/migrate-exam-question-bank.py` (mirrors existing `migrate-teacher-training.py`, `migrate-users.py` patterns).

Pulls via the Taleemabad bastion (see [04-data-migration.md](./04-data-migration.md)):
1. `question_bank_question` where `question_status='onprod' AND is_active=true`
2. `question_bank_questiongroup` (for grouped questions)
3. `question_bank_question_lesson_plans` (dropped — redundant with book_chapter FK)
4. `question_bank_assessment` (for blueprint extraction — writes JS constant file, does NOT create a table)

Idempotent: re-runs upsert by `taleemabad_uuid`. Rows removed at source get hard-deleted at destination.

---

## Reuse from existing NIETE-Rumi

| Piece | What it does | How exam-gen uses it |
|---|---|---|
| `text-message.handler.js` | Slash-command routing | `/exam` → send Flow message |
| WhatsApp Flow infra (`whatsapp-flows` skill) | Flow endpoint, publish lifecycle | New endpoint + Flow JSON |
| `shared/services/queue/` | Pluggable SQS/BullMQ job queue | `EXAM_GENERATE` job type, worker case in `sqs-worker.js` |
| `whatsapp.service.js` | WhatsApp Cloud API wrapper | Document send |
| R2 helpers | File upload | Docx storage |
| `users` table | Teacher's registered `grade_subjects` + `preferred_language` | Screen 2 dropdowns |

Not reused (deliberately):
- `bot/shared/services/quiz/*` — parallel feature; different UX (student-facing per-message quiz vs paper-based printable exam).
- `html-to-pdf.js` / Playwright — not needed for docx.

---

## Composition timing (approx.)

| Step | Time |
|---|---|
| Bank query (indexed) | < 100 ms |
| Random-sample per bucket | < 50 ms |
| Group expansion + snapshot inserts | < 500 ms |
| docx build + serialize | 1-3 s |
| R2 upload | 500-800 ms |
| WhatsApp send | 500-800 ms |
| **Total** | **~5 seconds** |

No LLM call, no Playwright launch — composition is fast enough that "instant delivery" (~5s from tap to file) is realistic. No progress ticker needed.

---

## Rollout plan (Phase order — details go in the implementation plan)

1. **Schema** — 3 new tables in NIETE Supabase (`infrastructure/schema.sql`).
2. **Import script** — `scripts/migrate-exam-question-bank.py`, seeds bank + writes `exam-composer.blueprints.js`.
3. **Backend services** — `exam-composer.service.js` + `exam-render.service.js` + `exam-orchestrator.service.js`.
4. **Docx template** — `exam-paper.template.js`.
5. **Flow endpoint + JSON** — publish to Meta, wire in `flow-endpoint.routes.js`.
6. **Slash-command trigger** — `/exam` handler in `text-message.handler.js`.
7. **Worker** — `EXAM_GENERATE` case in `sqs-worker.js` calling the orchestrator.
8. **E2E test** — via WhatsApp against staging (Shams), verify one weekly + one term paper (English + Urdu each).
9. **Ship to NIETE prod** after operator sign-off.

---

## Open items for v2 (post-MVP)

- Answer key delivery (rendering only — data already snapshotted).
- Portal-side "review before printing" (teacher can tweak individual questions or regenerate a single section).
- Adaptive difficulty across attempts (re-issue a paper that avoids questions already used).
- Reading/listening/speaking rubrics for language subjects.
- Diagnostic assessments (baseline/endline pre/post-unit).
- Exam sharing between teachers (copy-with-new-owner pattern from Taleemabad).
