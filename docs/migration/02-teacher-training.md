# 02 — Teacher Training

**Status**: 🟡 Draft — largest design work in this migration
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md) D-001
**Feeds**: [04-data-migration](./04-data-migration.md)

---

## Scope

Deliver structured, curriculum-aligned teacher training via WhatsApp. Two content sources:

1. **Own content** — Taleemabad-authored training with our own quizzes
2. **External content** — partner-authored training for secondary schools (Beaconhouse ELT/CS, Oxbridge, I-SAPS, etc.)

Both use the **same schema** — the source is a `vendor` tag. This mirrors Taleemabad's design where `Level.vendor` is a CharField on the same tables.

Completion earns the teacher a **certificate** (WhatsApp-delivered PDF).

## Design shape (Q-7 resolved 2026-07-11)

**Decision**: build the structured course model (this doc). Do **not** backport the prod Rumi bot's `training/` service — its scenario-based, Redis-only, no-certificate shape doesn't fit the multi-vendor structured content we're porting from Taleemabad.

## Delivery model (open design)

Taleemabad delivers training through a Capacitor mobile app: video lessons, offline caching via Dexie, in-app quizzes, in-app certificates. **In phase 1** we deliver over WhatsApp (per D-001); Capacitor is deferred to [07](./07-capacitor-mobile.md).

**Proposed WhatsApp UX** (needs critique — this is the biggest open design question):

| Step | Rumi sends | Teacher does |
|---|---|---|
| Discover course | Menu button "Teacher Training" → list of courses (buttons or list) | Taps a course |
| Course intro | Short text summary + thumbnail image | Taps "Start" |
| Module 1 | Voice note (2–5 min) OR video document OR PDF, based on `media_type` | Listens/reads, taps "Mark complete" |
| Modules 2..N | Same shape, one at a time | Repeats until modules exhausted |
| Quiz | WhatsApp Flow (interactive form) with MCQs from `training_quiz_questions` | Answers, submits |
| Result | Score + pass/fail message | If pass → next level; if fail → retry (respecting `max_attempts`) |
| Certificate | On course completion: PDF certificate as WhatsApp document | Saves to phone |

Open decisions on delivery:
- **Media modality**: Taleemabad's `Training.media_asset` might be video (large — bad for WhatsApp). Do we transcode to voice notes for audio-only content, or send video as documents?
- **Progress persistence**: teacher pauses mid-course, comes back next week. How do we remind them? (Existing Rumi nudge system can be reused.)
- **Multi-language quiz**: WhatsApp Flows have per-language render limits — how do we handle Urdu MCQs?

## What we build

### Schema (new tables in the fork's Supabase)

```sql
-- Course = top-level program
CREATE TABLE training_courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor          TEXT NOT NULL,           -- 'taleemabad', 'beaconhouse-elt', 'oxbridge', 'i-saps', etc.
  title           TEXT NOT NULL,
  description     TEXT,
  region          TEXT NOT NULL,
  grade_group     TEXT,                    -- 'primary', 'secondary', or a specific grade band
  subject         TEXT,
  language        TEXT NOT NULL,
  thumbnail_url   TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Module = a single training unit (video/audio/doc) inside a course
-- Collapses Taleemabad's Course→Level→Training hierarchy: Level becomes `phase` here.
CREATE TABLE training_modules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  phase           INT NOT NULL DEFAULT 1,   -- was 'Level' in Taleemabad
  order_index     INT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  media_type      TEXT NOT NULL,            -- 'voice', 'video', 'document', 'text'
  media_url       TEXT,                     -- S3/R2 URL — nullable for 'text' modules
  body_text       TEXT,                     -- for 'text' modules
  duration_seconds INT,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_modules_course ON training_modules(course_id, phase, order_index);

-- Quiz belongs to a module or the whole course (grand quiz)
CREATE TABLE training_quizzes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  module_id       UUID REFERENCES training_modules(id) ON DELETE CASCADE, -- NULL = course-level grand quiz
  title           TEXT,
  instructions    TEXT,
  passing_score   INT NOT NULL DEFAULT 70,   -- percent
  max_attempts    INT NOT NULL DEFAULT 3,
  time_limit_seconds INT
);

CREATE TABLE training_quiz_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES training_quizzes(id) ON DELETE CASCADE,
  order_index     INT NOT NULL,
  type            TEXT NOT NULL,             -- 'mcq' | 'msq' | 'open_ended'
  statement       TEXT NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answers JSONB NOT NULL DEFAULT '[]'::jsonb, -- indices into options
  hint            TEXT
);

-- Progress + submissions
CREATE TABLE training_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES training_courses(id),
  module_id       UUID REFERENCES training_modules(id),
  status          TEXT NOT NULL,             -- 'started' | 'in_progress' | 'completed' | 'failed'
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, course_id, module_id)
);

CREATE TABLE training_quiz_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id         UUID NOT NULL REFERENCES training_quizzes(id),
  attempt_number  INT NOT NULL,
  answers         JSONB NOT NULL,            -- {question_id: [answer_indices]}
  score           INT,                       -- percent
  passed          BOOLEAN,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE training_certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  course_id       UUID NOT NULL REFERENCES training_courses(id),
  certificate_url TEXT NOT NULL,             -- S3/R2 URL to generated PDF
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);
```

### New services

- `bot/shared/services/training/course-catalog.service.js` — list/search courses
- `bot/shared/services/training/module-delivery.service.js` — send next module + track progress
- `bot/shared/services/training/quiz.service.js` — build/deliver WhatsApp Flow, grade submissions
- `bot/shared/services/training/certificate.service.js` — generate + send certificate PDF (reuse existing `pdf.service.js`)
- `bot/shared/handlers/training-menu.handler.js` — new handler for the "Teacher Training" menu button

### WhatsApp Flow

New Flow for quiz delivery — one per quiz (or one generic Flow parameterised at send time). Register via [../features/whatsapp-flows](../../.claude/skills/whatsapp-flows/) equivalent — check existing Flow patterns in the bot before designing.

### Portal work

- `/admin/training/courses` — CRUD courses + modules + quizzes
- `/admin/training/certificates` — view issued certificates
- `/coach/training-progress/:teacher_id` — see which teachers are progressing through which courses (useful for HITL flows in [03](./03-digital-coach.md))

## External content mapping

The external secondary-school content is **the same schema**, distinguished by `vendor`. Migrations found in `taleemabad-core`:

| Migration file | Vendor value | Grade | Subject |
|---|---|---|---|
| `0044_add_oxbridge_training_level.py` | `oxbridge` | ? | ? |
| `0048_beaconhouse_elt_grand_quiz_questions.py` | `beaconhouse` | Secondary | English (ELT) |
| `0051_beaconhouse_cs_grand_quiz_questions.py` | `beaconhouse` | Secondary | Computer Science |
| `0054_seed_i_saps_novice_level.py` | `i-saps` | ? | ? |

Effort for external content = ETL only (see [04](./04-data-migration.md)). No new code beyond what's in this doc.

## Open items

- **Delivery UX** — needs critique before we commit to the shape above
- Media transcoding: is it acceptable to strip video → voice notes for WhatsApp, or do partners require the video?
- Certificate template — do we use Taleemabad's designs or Rumi-branded?
- **Q-6** (blocker): target region determines which vendors to migrate (Beaconhouse only if secondary is in scope; I-SAPS only if that vendor operates there)
