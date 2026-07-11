# 05 — Exam Generator

**Status**: 🟡 Draft
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md)
**Related**: Rumi's existing **Quiz** feature (`bot/shared/services/quiz/` — 13 files)

---

## Scope

Teachers can generate curriculum-aligned assessments for their classes. Two shapes to distinguish:

| Shape | Length | Delivery | Existing Rumi feature |
|---|---|---|---|
| **Class quiz** | 5–10 MCQs | LLM-generates on the fly, sent to parents' WhatsApp per student, class report back to teacher | ✅ `bot/shared/services/quiz/*` in `rumi-platform` |
| **Exam paper** | 20–50 questions, mixed types, curriculum-aligned | Generated as a PDF (or WhatsApp doc), teacher prints/shares | ❌ Not in Rumi today; Taleemabad has this via external `EG_Pipeline` |

**Scope of this doc**: build the second shape (exam paper) on top of Rumi's existing quiz-generation infrastructure — do NOT port Taleemabad's `EG_Pipeline` microservice wholesale.

## Existing quiz feature (reuse the primitives)

Rumi already has the pieces we need:

| Rumi service | What it does | Use in exam gen? |
|---|---|---|
| `quiz-generation.service.js` | LLM generates MCQs on a topic | ✅ Extend for exam-length + mixed question types |
| `quiz-orchestrator.service.js` | Trigger + class selection + gate | ✅ Reuse the trigger pattern |
| `quiz-delivery.service.js` | Sends to student parent phones | ❌ Exam paper is teacher-only — not delivered to students |
| `quiz-report.service.js` | Compiles class results | ❌ Exam paper isn't answered inside Rumi |
| `quiz-adaptive.js`, `quiz-follow-up.service.js`, `quiz-insight.service.js` | Adaptive follow-ups, insight aggregation | ❌ Not in scope for exam paper |
| Tables: `quizzes`, `quiz_questions`, `quiz_sessions`, `quiz_answers` | Existing quiz schema | 🟡 Extend or parallel-table (see below) |

## What we build

### New: exam-paper flow

```
Teacher /exam <topic> <grade>
    ↓
exam-orchestrator.service.js
    ↓
exam-generation.service.js  (extends quiz-generation with:
   - question count 20–50, not 5–10
   - mixed types: MCQ + short answer + long answer
   - lightweight curriculum tag per question (region-scoped, not full SLO tree)
   - Bloom-level distribution)
    ↓
exam-render.service.js  (uses pdf.service.js — backported from main Rumi bot per doc 06)
    ↓
WhatsApp: teacher receives PDF exam paper + answer key as separate document
```

### Schema

**Decision needed**: extend `quizzes` table with an `exam_mode` flag, or create parallel `exams`?

**Recommendation**: parallel tables. The quiz feature's `quiz_sessions` and `quiz_answers` are student-response tracking — exam papers don't have that. Overloading breaks the guard tests.

```sql
CREATE TABLE exams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  region            TEXT NOT NULL,
  grade             TEXT NOT NULL,
  subject           TEXT,
  chapter_scope     TEXT[],                   -- chapter titles or IDs, region-defined
  question_count    INT NOT NULL,
  total_marks       INT,
  duration_minutes  INT,
  language          TEXT NOT NULL,
  pdf_url           TEXT,                     -- generated exam paper
  answer_key_url    TEXT,                     -- separate answer key PDF
  status            TEXT NOT NULL,            -- 'generating' | 'ready' | 'failed'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE exam_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  order_index       INT NOT NULL,
  type              TEXT NOT NULL,            -- 'mcq' | 'short_answer' | 'long_answer'
  statement         TEXT NOT NULL,
  options           JSONB DEFAULT '[]'::jsonb, -- for MCQ only
  correct_answer    TEXT NOT NULL,             -- for answer-key generation
  marks             INT NOT NULL DEFAULT 1,
  bloom_level       TEXT,                     -- 'remember' | 'understand' | 'apply' | ...
  curriculum_tag    TEXT                       -- region-scoped, e.g. "grade-5-math-fractions"
);
```

**Why lightweight curriculum tagging instead of Sub-NCP-SLO**: Rumi doesn't have the SLO tree, and building it just for exam-gen is out of scope. A flat text tag ("grade-5-math-fractions") is enough for the LLM prompt to align questions and for later analytics.

### Prompt strategy

The LLM prompt for exam generation takes:
- Region-specific chapter list (from `lesson_plan_catalog` chapters — same source as LPs)
- Question count + type distribution (MCQ %, short %, long %)
- Bloom-level target distribution
- Language

Output constrained to JSON: `[{type, statement, options?, correct_answer, bloom_level, curriculum_tag}]`.

### PDF rendering

Reuse `pdf.service.js` (backported per [06](./06-from-main-rumi-bot.md)) — same lib that renders coach reports and certificates. Two PDFs per exam: the paper (student-facing, no answers) and the answer key (teacher-only).

## Not doing

- Curriculum standards tree (Sub-NCP-SLO) — flat text tags only
- Automatic grading of paper-based exams (that's what `exam-checker` does — separate feature)
- Adaptive difficulty across attempts
- Full multi-tenant exam library like Taleemabad's `GeneratedExam` + `GeneratedExamQuestionMapping`
- Cloning `EG_Pipeline` microservice

## Data migration dependency

**None for the paper itself** — exam papers are generated fresh on request. However, we may want to migrate **exam templates** (typical patterns per grade/subject) from Taleemabad's `GeneratedExam` table as seed prompts for the LLM. Low priority — [04](./04-data-migration.md) can add this.

## Open items

- Question type mix per region — is short-answer / long-answer viable, or MCQ-only?
- Do teachers need to *edit* generated exams before printing? (If yes, add a portal page.)
- WhatsApp delivery: two PDFs is chunky — do we auto-send both, or teacher requests answer key separately?
- Should the exam feature be gated by a portal-side approval step (like coach HITL) for regions where quality control matters?
