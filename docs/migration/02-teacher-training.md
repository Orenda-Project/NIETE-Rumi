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

---

## Investigation findings — live catalog + visibility + assessments (added 2026-07-12)

Deep-dive against live Taleemabad prod DB + `schools.niete.pk` UI (browser IDB + `taleemabad-core` source). See also [DB-SURVEY.md](./DB-SURVEY.md) and the machine-readable [schema/](./schema/) dump (602 tables, 1,351 relationships).

### 1. The naive "758 active trainings" number is wrong by ~2×

| Filter | Trainings |
|---|---:|
| `training.is_active = true` (the DB-SURVEY.md figure) | **758** |
| Of those, whose parent **course** is also live | **384** ← real target |
| Of those, whose parent course is **retired** (orphans) | 374 |
| Live courses (parent buckets) | **57** |
| Live levels (containers) | **9 / 9** all live |

Half of the 758 "active" trainings are orphans — Taleemabad flipped `course.is_active=false` without cascading to child trainings. Teachers using the platform today don't see these. **Import the 384, skip the 374.**

**Definitive filter chain**:
```sql
WHERE tr.is_active AND tr.deleted_at IS NULL
  AND c.is_active  AND c.deleted_at IS NULL
  AND lv.is_active AND lv.deleted_at IS NULL
```
`status='OnProd'` looked like a discriminator but isn't — all 890 trainings ever have `status='OnProd'`; only `is_active` + parent liveness carries filtering power.

### 2. Live catalog by vendor (2026-07-12 snapshot)

| Vendor | Levels | Live courses | Live trainings | Grand-quiz Qs | Diagnostic Qs |
|---|---:|---:|---:|---:|---:|
| **TALEEMABAD** (branded "NIETE OFFICIAL") | 4 (Aspiring Teacher → Teacher Leader) | 36 | **171** | 62/69/88/60 per level | 0/59/73/60 (L0 has no diagnostic) |
| **BEACONHOUSE** (Computer Science partner) | 4 (English / Math / GenSci / CS) | 20 | 206 | 8/8/10/7 per level | — |
| **OXBRIDGE** (game-based teaching) | 1 (Prof. Training in Game-Based Teaching) | 1 | 7 | — (no grand quiz) | — |
| I_SAPS | 0 | 0 | 0 | — | — |
| **All** | **9** | **57** | **384** | | |

### 3. Vendor visibility — two-gate frontend filter (NOT backend)

Backend returns **all 9 levels** to every user ([`teacher_training/views.py:754-763`](../../../taleemabad-core/taleemabad_core/apps/teacher_training/views.py) — literal comment: *"Frontend filters by vendor locally based on user context"*). The frontend applies two independent gates ([`training-level-page.tsx:725-775`](../../../taleemabad-core/frontend/apps/school-app/src/features/teachers/pages/training-level-page.tsx)):

```
for each vendor with content the user has synced:
  # Gate 1 — feature-flag kill switch (per-user, from userDB.featureFlags)
  if flag[vendor + "Enabled"] === true and profile.type != "COACH":
      hide vendor
  # Gate 2 — profile-type match
  if not COACH and (user.profileTypes ∩ vendorConfig.profileTypesAllowed) == ∅:
      hide vendor
  show vendor
```

`profileTypesAllowed` values (from [`vendor-configs.ts`](../../../taleemabad-core/frontend/apps/school-app/src/features/teachers/services/vendor-configs.ts)):
- **NIETE / TALEEMABAD**: `[PRIMARY, MIDDLE, HIGH]` — all teachers
- **Beaconhouse / Oxbridge**: `[MIDDLE, HIGH]` — no primary teachers
- **Coach**: bypasses both gates

Field-verified 2026-07-12 on `schools.niete.pk` as user `03333232533` (Mashhood Rastgar, 2 profiles both `levels=['PRIMARY']`):
- Feature flags `oxbridgeEnabled` / `beaconhouseTrainingEnabled`: **absent** from user's flag dict → gate 1 inactive.
- Profile-type overlap with Beaconhouse/Oxbridge: **empty** → gate 2 blocks. UI shows the 4 TALEEMABAD levels only.

### 4. Teacher-level population (blast radius of gate 2)

Across all 10,882 active NIETE teachers:

| Level combo | Teachers | % |
|---|---:|---:|
| PRIMARY only (blocked from Beaconhouse/Oxbridge) | 4,734 | 54.6% |
| Has MIDDLE or HIGH (sees Beaconhouse/Oxbridge today) | 3,938 | **45.4%** |

**~45% of NIETE teachers already see Beaconhouse's 206 trainings on the portal.** Migrating only TALEEMABAD content would strip visible content for nearly half the user base.

### 5. Course locking WITHIN a level

Two mechanisms exist in Taleemabad:

**(a) Sequential unlock by `course.index`** — ACTIVE.
Each level has ~9 courses ordered by an integer `index`. NIETE's `nieteVendorConfig.unlockLogic = 'CHAIN_WITH_COOLDOWN'` unlocks courses in sequence. Example — Aspiring Teacher:

| Index | Course | Type | Trainings |
|---:|---|---|---:|
| 1 | Classroom Management | CLASSROOM_MANAGEMENT | 3 |
| 2 | Inclusive Education | INCLUSIVE_EDUCATION | 7 |
| 3 | Pedagogical Practice | PEDAGOGICAL_PRACTICE | 3 |
| 4 | Numeracy | CONTENT_EXPERTISE | 6 |
| 5 | Literacy 1 | CONTENT_EXPERTISE | 9 |
| 6 | Literacy 2 | CONTENT_EXPERTISE | 6 |
| 7 | Assessment and Feedback | ASSESSMENT_FEEDBACK | 5 |
| 8 | Digital Literacy and Innovation | DIGITAL_LITERACY | 3 |
| 9 | Professional Growth and Ethics | PROFESSIONAL_GROWTH_ETHICS | 4 |

**(b) Per-course grade/subject gate** — SCHEMA supports, **not populated**.
`teacher_training_course.grade_group_id` and `.subject_id` are FKs on the model but **NULL on all 57 live courses**. Every teacher within a level sees every course. If NIETE-Rumi wants "this course only for Primary math teachers", the infrastructure is a fresh feature: either populate these fields in the target DB or model our own equivalent.

**Answer to "can we lock down specific courses depending on level?"**: yes, mechanically — but Taleemabad doesn't. Their operating policy is *level-based access, then sequential-within-level, then no per-course specialisation*. If we want per-course targeting (e.g. "Math course only for math teachers"), it's a NEW policy we introduce, not a port.

### 6. Assessment types — three tiers, one blocking

| Type | Where | Who blocks progression | NIETE questions | Beaconhouse Qs |
|---|---|---|---:|---:|
| **Training quiz** | Per training module inside a course | No (per-module scoring) | 9–12 per training | Same shape |
| **Diagnostic test** | Per level, optional practice ("Practice Test" card) | No | 0/59/73/60 (L0 skipped) | — |
| **Grand quiz** | Per level, capstone assessment | **YES** — unlocks next level | 62/69/88/60 | 7–10 per level |

Grand quiz rules (`nieteVendorConfig`):
- **Prerequisite**: all 9 courses in the level 100% completed. Button disabled until then.
- **Pass threshold**: `passingPercentage = 100` for NIETE (must answer every question correctly). Beaconhouse/Oxbridge use `70`.
- **Cooldown on fail**: 24 hours (`COOLDOWN_MS = 24 * 60 * 60 * 1000`) before another attempt.
- **Unlock next level**: `CHAIN_WITH_COOLDOWN` — Level N+1 stays locked until Level N's grand quiz passes.
- **Real-world**: 820,753 total assessment attempts across all teachers, **72.1% pass rate**. Teachers do reach and pass grand quizzes at meaningful volume.

### 7. Certification — schema exists, **zero rows ever issued**

`teacher_training_certificate` has 17 columns (denormalised: `teacher_name`, `training_name`, `certificate_code`, `vendor`, `completion_date`, `metadata` JSONB) — but the table is **empty** across 7.4M training submissions.

Yet the portal *renders* a certificate ceremony page ("Certificate of Completion — Mashhood Rastgar has successfully completed the Digital Aspiring Teacher Program" — verified 2026-07-12 in the DOM). So Taleemabad **generates certs client-side on quiz pass but never persists them**. If a teacher clears their app data, the cert record is lost.

Implication for NIETE-Rumi: no historical cert data to import. Design the cert-issue as an operation on grand-quiz pass, storing to a Rumi-side `training_certificates` table with a stable `certificate_code`. Clean-slate.

### 8. Refined migration recommendation

| Vendor | Trainings | Migrate? | Visibility rule in the WhatsApp bot |
|---|---:|---|---|
| **TALEEMABAD** (branded NIETE OFFICIAL) | 171 | ✅ Import + always visible | Every registered teacher sees the 4 levels |
| **BEACONHOUSE** (Computer Science) | 206 | ✅ Import + gate on `levels ∩ {MIDDLE, HIGH} ≠ ∅` | Preserves current portal behaviour for ~45% of teachers |
| **OXBRIDGE** (game-based) | 7 | 🟡 Import + same gate as Beaconhouse | Trivial cost, matches today's UX |
| Orphans (course retired) | 374 | ⛔ Skip | Taleemabad retired these; do not resurrect |
| I_SAPS | 0 | ⛔ Skip | No live content |

**Total scope: 384 trainings, 57 courses, 9 levels — port the visibility function alongside the data.**

### 9. Open decisions still to close with NIETE stakeholders

1. **Beaconhouse content**: keep it visible to MIDDLE/HIGH teachers (preserves portal parity) or explicitly gate it off? Question is whether NIETE views the CS partnership as "current offering" or "portal-experiment we're happy to drop."
2. **Per-course specialisation**: do we want a policy Taleemabad doesn't use — e.g. "Math course in Aspiring Teacher shown only to math teachers"? If yes, we need to populate `grade_group_id`/`subject_id` at migration time.
3. **Cert issuing**: since Taleemabad never persisted certs, we're building the first real cert-issue system. What data does NIETE want on the certificate (school branding? director signature? unique verification URL)?
4. **Grand-quiz pass threshold**: NIETE currently requires **100%**. Is that operationally sensible for WhatsApp Flow-delivered quizzes (where accidental taps happen), or should we drop to a Beaconhouse-style 70%?

---

## Locked design — grilling session outcome (2026-07-12)

Supersedes the earlier "Design shape" and "What we build" sections below. The grilling stress-tested 10 open questions against the domain model + legacy code; each has a locked verdict. Terms used here are defined in [`CONTEXT.md`](../../CONTEXT.md).

### The ten locked decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Domain framing | **(c) Generic platform** — multi-vendor from day 1. NIETE-Rumi is a reusable training platform; NIETE is the first Region using it. See [ADR-0001](../adr/0001-training-domain-model-programs.md). |
| Q2 | Access model | **Explicit assignment** — per-teacher, no derived access from region/attributes. |
| Q3 | Access unit | **Program** (curated bundle of Vendor(s) + optional Level/Course/Module filters). Teacher ⇄ Program, not Teacher ⇄ Vendor. Programs are reusable, admin-created. |
| Q3a | Registration flow | Phase 2+: Teacher picks Program at WhatsApp Registration. **Phase 1: all migrated Teachers auto-Assigned to one Program (`niete_standard`).** |
| Q4 | Where pedagogical rules live | **On Vendor** (passing %, cooldown length, cert code prefix, has-grand-quiz, etc.). |
| Q5a | Content sync policy | **One-shot fork** at migration + manual re-import on demand. No live sync back to Taleemabad. |
| Q5b | Media hosting | **Re-host to NIETE-Rumi R2**. No dependency on Taleemabad's URLs. |
| Q6 | Certificate template | **NIETE template ported as-is** from the legacy `LevelCertificate` React component. Server-side PDF render is a NEW capability (legacy has none — uses `window.print()`). |
| Q7a-c | Portal auth | Username = phone number. Password picked at Registration (new) or first Portal visit (migrated). Reset via one-time WhatsApp link. |
| Q8 | Assessment attempts schema | **Two-table design** — `assessment_attempts` + `assessment_answers`. Per-question durability across bot restarts. Partial unique constraint prevents parallel in-progress attempts. |
| Q9a-b | Cooldown | **Per-Level** scope. Message uses **relative hours remaining** ("try again in about X hours"). |
| Q10 | Coach fallback | **No `coaches` table in phase 1.** Empty state uses one hard-coded ops contact (env: `NIETE_OPS_CONTACT_*`). Coach concept deferred to a later phase. |

### Concrete schema (target Supabase in `NIETE-Rumi/infrastructure/`)

```sql
-- Content authorities (Vendors)
CREATE TABLE vendors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  VARCHAR NOT NULL UNIQUE,           -- 'TALEEMABAD', 'BEACONHOUSE', ...
  name                 VARCHAR NOT NULL,
  passing_pct          INT NOT NULL,                       -- Q4: rules on vendor
  cooldown_hours       INT NOT NULL DEFAULT 24,
  has_grand_quiz       BOOLEAN NOT NULL DEFAULT true,
  has_diagnostic       BOOLEAN NOT NULL DEFAULT false,
  cert_code_prefix     VARCHAR(8) NOT NULL,                -- 'NIETE', 'BH', 'OB'
  unlock_logic         VARCHAR NOT NULL DEFAULT 'chain',   -- 'chain' | 'auto'
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Curriculum structure
CREATE TABLE levels (
  id BIGSERIAL PRIMARY KEY,
  vendor_id            UUID NOT NULL REFERENCES vendors(id),
  name                 VARCHAR NOT NULL,
  order_index          INT NOT NULL,
  cpd_level            INT,                                -- NULL for Aspiring; 1/2/3 for Emerging/Skilled/Teacher Leader
  is_active            BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (vendor_id, order_index)
);

CREATE TABLE courses (
  id BIGSERIAL PRIMARY KEY,
  level_id             BIGINT NOT NULL REFERENCES levels(id),
  title                VARCHAR NOT NULL,
  type                 VARCHAR,                            -- 'CONTENT_EXPERTISE', 'PEDAGOGICAL_PRACTICE', ...
  order_index          INT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE modules (
  id BIGSERIAL PRIMARY KEY,
  course_id            BIGINT NOT NULL REFERENCES courses(id),
  title                VARCHAR NOT NULL,
  content_html         TEXT,                               -- HTML content for portal render
  audio_url            VARCHAR,                            -- R2 URL, WhatsApp voice-note delivery
  video_url            VARCHAR,                            -- R2 URL if video module
  duration_seconds     INT,
  order_index          INT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true
);

-- Assessments
CREATE TABLE grand_quizzes (
  id BIGSERIAL PRIMARY KEY,
  level_id             BIGINT NOT NULL REFERENCES levels(id),
  quiz_type            VARCHAR NOT NULL DEFAULT 'grand_quiz',  -- 'grand_quiz' | 'diagnostic'
  is_active            BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (level_id, quiz_type)
);

CREATE TABLE questions (
  id BIGSERIAL PRIMARY KEY,
  grand_quiz_id        BIGINT REFERENCES grand_quizzes(id),
  training_module_id   BIGINT REFERENCES modules(id),
  question_text        TEXT NOT NULL,
  question_urdu        TEXT,                               -- optional bilingual
  options              JSONB NOT NULL,                     -- [{key: '1', text: 'A', urdu: '...'}, ...]
  correct_option       VARCHAR NOT NULL,
  order_index          INT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  CHECK (
    (grand_quiz_id IS NOT NULL) OR (training_module_id IS NOT NULL)
  )
);

-- Programs (Q3: reusable access bundles)
CREATE TABLE programs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  VARCHAR NOT NULL UNIQUE,            -- 'niete_standard', 'bh_ai_v1', ...
  name                 VARCHAR NOT NULL,
  description          TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE program_scopes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id           UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  vendor_id            UUID NOT NULL REFERENCES vendors(id),
  level_ids            BIGINT[],                           -- NULL = all levels of this vendor
  course_ids           BIGINT[],                           -- NULL = all courses at those levels
  module_ids           BIGINT[]                            -- NULL = all modules in those courses
);

-- Teachers (identity + portal creds)
CREATE TABLE teachers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_uuid         UUID NOT NULL UNIQUE,               -- durable identity, ported from users_teacherprofile.uuid
  phone_number         VARCHAR NOT NULL UNIQUE,            -- E.164, portal username
  full_name            VARCHAR NOT NULL,
  levels               VARCHAR[],                          -- ['PRIMARY'] or ['MIDDLE', 'HIGH']
  school_id            UUID REFERENCES schools(id),
  password_hash        VARCHAR,                            -- argon2id, NULL until first Portal set
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assignments (Q2/Q3)
CREATE TABLE teacher_programs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id           UUID NOT NULL REFERENCES teachers(id),
  program_id           UUID NOT NULL REFERENCES programs(id),
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by          VARCHAR NOT NULL,                   -- 'migration_seed' | 'admin_csv' | 'registration'
  is_active            BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (teacher_id, program_id) WHERE is_active
);

-- Progress + Attempts (Q8)
CREATE TABLE training_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id           UUID NOT NULL REFERENCES teachers(id),
  module_id            BIGINT NOT NULL REFERENCES modules(id),
  completed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, module_id)
);

CREATE TYPE attempt_status AS ENUM (
  'in_progress', 'passed', 'failed', 'abandoned'
);

CREATE TABLE assessment_attempts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id                UUID NOT NULL REFERENCES teachers(id),
  program_id                UUID NOT NULL REFERENCES programs(id),
  quiz_id                   BIGINT NOT NULL REFERENCES grand_quizzes(id),
  level_id                  BIGINT NOT NULL REFERENCES levels(id),
  started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_question_index    INT NOT NULL DEFAULT 0,
  total_questions           INT NOT NULL,
  status                    attempt_status NOT NULL DEFAULT 'in_progress',
  score                     INT,
  total_score               INT NOT NULL,
  is_passed                 BOOLEAN,
  completed_at              TIMESTAMPTZ,
  cooldown_until            TIMESTAMPTZ                     -- set only on 'failed'
);

CREATE UNIQUE INDEX ux_one_active_attempt
  ON assessment_attempts (teacher_id, quiz_id)
  WHERE status = 'in_progress';

CREATE INDEX ix_attempts_abandon_sweep
  ON assessment_attempts (last_activity_at)
  WHERE status = 'in_progress';

CREATE TABLE assessment_answers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_index     INT NOT NULL,
  question_id        BIGINT NOT NULL REFERENCES questions(id),
  chosen_option      VARCHAR NOT NULL,
  is_correct         BOOLEAN NOT NULL,
  answered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, question_index)
);

CREATE INDEX ix_answers_question ON assessment_answers (question_id);

-- Certificates
CREATE TABLE training_certificates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id         UUID NOT NULL REFERENCES teachers(id),
  program_id         UUID NOT NULL REFERENCES programs(id),
  level_id           BIGINT NOT NULL REFERENCES levels(id),
  attempt_id         UUID NOT NULL REFERENCES assessment_attempts(id),
  certificate_code   VARCHAR(64) NOT NULL UNIQUE,           -- e.g. 'NIETE-20260712-A3F9E1'
  teacher_name_snapshot VARCHAR NOT NULL,                    -- denormalised
  level_name_snapshot   VARCHAR NOT NULL,                    -- for CPD-LEVEL-N rendering
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_r2_key         VARCHAR NOT NULL                        -- 'certs/{teacher_uuid}/{cert_code}.pdf'
);

-- Content change audit (Q5)
CREATE TABLE content_change_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type        VARCHAR NOT NULL,                       -- 'module', 'question', 'course', ...
  entity_id          VARCHAR NOT NULL,                       -- FK varies by type
  origin             VARCHAR NOT NULL,                       -- 'vendor_reimport' | 'niete_edit'
  actor              VARCHAR,                                -- admin user or 'system'
  before_json        JSONB,
  after_json         JSONB,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration seed algorithm

```python
# scripts/migrate-teacher-vendors.py — one-time job, idempotent

# 1. Import teacher identity
INSERT INTO teachers (teacher_uuid, phone_number, full_name, levels, school_id, is_active)
SELECT
  tp.uuid,
  u.username,                        -- E.164 phone from users_user
  CONCAT(u.first_name, ' ', u.last_name),
  tp.levels,
  tp.school_id_mapped,               -- schools table imported first
  tp.is_active
FROM taleemabad.users_teacherprofile tp
JOIN taleemabad.users_user u ON u.id = tp.user_id
WHERE tp.is_active AND tp.deleted_at IS NULL
ON CONFLICT (teacher_uuid) DO NOTHING;

# 2. Import TALEEMABAD vendor + curriculum tree
INSERT INTO vendors (key, name, passing_pct, cooldown_hours, has_grand_quiz, has_diagnostic,
                     cert_code_prefix, unlock_logic)
VALUES ('TALEEMABAD', 'Taleemabad', 100, 24, true, true, 'NIETE', 'chain');

# ... import levels, courses, modules, questions, grand_quizzes ...
# ... media transferred from Taleemabad S3 to NIETE-Rumi R2 via download+upload ...

# 3. Create the one Program
INSERT INTO programs (key, name, description)
VALUES ('niete_standard', 'NIETE Standard Program',
        'Default Teacher Training Program for all NIETE teachers — full Taleemabad catalog');

INSERT INTO program_scopes (program_id, vendor_id, level_ids, course_ids, module_ids)
VALUES (
  (SELECT id FROM programs WHERE key='niete_standard'),
  (SELECT id FROM vendors  WHERE key='TALEEMABAD'),
  NULL, NULL, NULL   -- all of TALEEMABAD
);

# 4. Assign every teacher to it
INSERT INTO teacher_programs (teacher_id, program_id, assigned_by, is_active)
SELECT t.id, p.id, 'migration_seed', true
FROM teachers t
CROSS JOIN programs p
WHERE p.key = 'niete_standard';
```

### Phase 1 in / out

| In phase 1 | Explicitly deferred |
|---|---|
| TALEEMABAD content (4 levels, 36 courses, 171 modules, 4 grand quizzes) | Beaconhouse, Oxbridge, I-SAPS content |
| One Program (`niete_standard`) | Multi-Program admin UI |
| Auto-assign all migrated teachers | Teacher picks Program at Registration |
| CSV bulk admin operations | Admin portal UI |
| WhatsApp Flow home (2 screens) + inline Q-by-Q quiz + cert PDF | Vendor picker at Registration |
| Portal read-only routes + password auth | Portal write operations |
| Hardcoded ops-contact empty-state | Coach role, coach lookup, `coaches` table |
| Server-side PDF generation (new capability) | Verification URL, QR code, completion date on cert |
| Content change events audit log | Automated re-sync from Taleemabad |

---

## Design shape (Q-7 resolved 2026-07-11) — SUPERSEDED

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

---

## History import from FDE (2026-07-12) — ✅ DONE

**543,125 rows** imported into `teacher_training_progress` from the FDE production database.
Every NIETE teacher who trained on `schools.niete.pk` picks up their level progress the
instant they open `/training`.

### Where the data actually lived

The Taleemabad Postgres has **two schemas** — `public` and `fde_production`. The FDE cohort
runs entirely in `fde_production` (~97k users vs `public`'s 6k). Every teacher-training
history table was empty in `public` and full in `fde_production`. **Anti-pattern lesson**:
always `SELECT schema_name FROM information_schema.schemata` before assuming DB shape —
Django's default schema is `public` but production deploys often segregate customer data.

Rows-with-history in `fde_production`:

| Table | Rows |
|---|---:|
| `teacher_training_submission` (per-question quiz answers) | 17,211,719 |
| `teacher_training_teachertrainingstatus` (per-teacher/module status) | 2,432,130 |
| `teacher_training_assessment` (grand-quiz attempts) | 1,956,618 |
| `teacher_training_certificate` (issued certificates) | 0 |
| `analytics_analyticsevent` (raw event stream) | 41,717,919 |

**This import pass covers only** `teacher_training_teachertrainingstatus` where
`status='COMPLETED'`. Grand-quiz attempts and per-question submissions were deferred to a
follow-up (documented [below](#pending-follow-up-imports)).

### The join chain

```
FDE.teacher_training_teachertrainingstatus (source rows, filtered to status='COMPLETED')
  .profile_id (bigint) → FDE.users_teacherprofile.id
                       → users_teacherprofile.user_id (bigint)
                       → FDE.users_user.id
                       → FDE.users_user.uuid  ← MATCH KEY
Supabase.users.teacher_uuid                    ← MATCH KEY (populated at user migration time)
  .id (UUID)                                   ← what we write

FDE.teacher_training_teachertrainingstatus.training_id → Supabase.training_modules.source_module_id
                                                       → training_modules.id  ← what we write
```

Match rate: **93.6%** of the 5,538 FDE teachers with progress had a Supabase user
(95.3% via `teacher_uuid`, extra 3.4% caught by phone fallback). The 6,894 unmatched
(profile, module) pairs were logged to `scripts/samples/training_history_unmatched.csv` and
skipped — none are broken data; the affected 352 FDE teachers just haven't registered on
NIETE-Rumi's WhatsApp yet.

### Numbers

| Metric | Value |
|---|---:|
| FDE (profile × module) COMPLETED rows on our 171 modules | 551,672 |
| Rows dropped as unmatched (no Supabase user) | 6,894 |
| Rows deduped (one Supabase user via ≥2 FDE profiles) | 1,664 |
| **Rows written to `teacher_training_progress`** | **543,125** |
| Distinct teachers touched | 4,271 (99.6% of them also have an assignment) |
| Distinct modules touched | 171 (100% of the imported catalog) |

### State distribution — what teachers see after import

Detailed report in [scripts/samples/training_history_state_validation.md](../../scripts/samples/training_history_state_validation.md).
Key numbers:

| Bucket | Count |
|---|---:|
| Teachers with all 4 levels' courses content-complete (will need 4 grand quizzes) | 1,976 |
| Teachers with ≥1 full level ready for its quiz | 1,878 |
| Teachers with any partial progress | 417 |
| **Total teachers now reflecting real history** | **4,271** |

Per-level "underlying state" (L1 shown as-is; L2/L3/L4 all show `locked` in practice until
each prior quiz is passed):

| Level | Ready | In-progress | Not-started |
|---|---:|---:|---:|
| L1 | 3,599 | 302 | 4,602 |
| L2 | 3,400 | 284 | 4,819 |
| L3 | 3,014 | 578 | 4,911 |
| L4 | 2,109 | 481 | 5,913 |

### Known limitations

1. **Timestamps are unreliable.** FDE's `modified` column was clobbered by their own bulk
   ETL — many teachers show 5+ modules "completed" within the same millisecond. Level-unlock
   only cares about presence so correctness is unaffected, but the analytics dashboard we
   build next won't get reliable watch-velocity signal from *pre-import* rows. Only
   *post-import* new completions will have real timestamps.
2. **17 imported teachers lack a program assignment.** Their `teacher_training_progress`
   rows exist but the endpoint returns `[]` — they'll see nothing on `/training`. Small
   enough that manual fix is fine; auto-assign on next message would also cover them.
3. **The status field is coarse.** FDE distinguishes only `COMPLETED` (1.77M) and
   `IN_PROGRESS` (658k). We deliberately imported only `COMPLETED` — `IN_PROGRESS` would
   falsely unlock levels since our schema has no half-state column.
4. **~2,149 teachers will find themselves "re-taking" quizzes they already passed on the
   Taleemabad platform.** No FDE grand-quiz attempts were imported in this pass, so a
   teacher who watched all content elsewhere still needs to prove mastery on NIETE-Rumi.
   Pedagogically defensible, but may frustrate power-users. If it becomes a problem, we
   backfill from `teacher_training_assessment` (1.96M rows) in a follow-up.

### Migration script

`scripts/migrate-training-history.py` — idempotent (POST with
`Prefer: resolution=ignore-duplicates` on `on_conflict=user_id,module_id`). Safe to re-run;
never overwrites an existing completion. Dry-run mode (`--dry-run`) writes CSVs without
touching the DB:
- `scripts/samples/training_history_to_write.csv` (rows we'd insert)
- `scripts/samples/training_history_unmatched.csv` (unmatched teachers, for a future
  reconciliation pass when they register)

### Pending follow-up imports

- **Grand-quiz history** (`teacher_training_assessment`, 1.96M rows): would restore
  "certified" state and skip re-testing. Deferred to keep this pass narrow.
- **Per-question submissions** (`teacher_training_submission`, 17.2M rows): useful only if
  we want to analyse *which* questions teachers historically got wrong (item-difficulty
  analytics). Not needed for level-unlock UX.
- **Unmatched-teacher reconciliation**: when one of the 352 unmatched teachers registers on
  NIETE-Rumi, run a delta script to backfill their progress. Cheap to add.
