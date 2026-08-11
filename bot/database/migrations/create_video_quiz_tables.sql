-- Port of PK's video-quiz feature (bd-2482, sister to PK bd-2303/2305/2313/
-- 2334/2337/2339/2340). PK evolved this shape across migrations
-- 046_video_quizzes.sql / 047_video_quiz_report_once.sql /
-- 049_quiz_friend_invites.sql / 048_student_identity.sql /
-- 050_student_enrolled_by.sql / add_student_video_feedback.sql /
-- add_student_videos_r2_migration_cols.sql /
-- add_student_videos_clean_title_cols.sql, plus at least two undocumented
-- live-schema-only additions (video_quiz_deliveries table,
-- student_video_feedback.scope/quiz_useful/quiz_session_id/delivery_id) that
-- PK's own migration files never captured. Per root CLAUDE.md Rule 15, this
-- file was written against PK's LIVE schema (information_schema + pg_constraint
-- + pg_indexes), not against PK's migration files, since those are known to
-- have drifted. Verified against NIETE's LIVE schema first too: quizzes,
-- quiz_sessions, student_videos, students, student_video_feedback are all
-- 0 rows in NIETE prod as of 2026-08-04, so every change below is pure
-- additive DDL with no backfill risk.
--
-- Idempotent throughout (IF NOT EXISTS / DROP+ADD CONSTRAINT) so it is safe
-- to re-run.

BEGIN;

-- ============================================================
-- 1. quiz_questions — 4th option, media, per-option feedback (PK 046 §1)
-- ============================================================
ALTER TABLE quiz_questions ALTER COLUMN option_c DROP NOT NULL;

ALTER TABLE quiz_questions
  ADD COLUMN IF NOT EXISTS option_d        TEXT,
  ADD COLUMN IF NOT EXISTS media           JSONB,
  ADD COLUMN IF NOT EXISTS option_feedback JSONB,
  ADD COLUMN IF NOT EXISTS render_pattern  TEXT,
  ADD COLUMN IF NOT EXISTS external_id     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_questions_external_id
  ON quiz_questions(external_id) WHERE external_id IS NOT NULL;

ALTER TABLE quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_correct_option_check;
ALTER TABLE quiz_questions ADD CONSTRAINT quiz_questions_correct_option_check
  CHECK (correct_option ~ '^[A-D](,[A-D])*$');

-- ============================================================
-- 2. quiz_answers — same widening on the answer side (PK 046 §2)
-- ============================================================
ALTER TABLE quiz_answers DROP CONSTRAINT IF EXISTS quiz_answers_selected_option_check;
ALTER TABLE quiz_answers ADD CONSTRAINT quiz_answers_selected_option_check
  CHECK (selected_option ~ '^[A-D](,[A-D])*$');

-- ============================================================
-- 3. quizzes — a quiz can now belong to a video (PK 046 §3)
-- ============================================================
ALTER TABLE quizzes ALTER COLUMN teacher_id DROP NOT NULL;

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES student_videos(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_video_id
  ON quizzes(video_id) WHERE video_id IS NOT NULL;

-- ============================================================
-- 4. quiz_share_codes — the forward-to-class loop (PK 046 §4 + 049)
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_share_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  quiz_id         UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  teacher_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id        UUID REFERENCES student_videos(id) ON DELETE SET NULL,
  teacher_name    TEXT,
  topic           TEXT,
  language        TEXT NOT NULL DEFAULT 'en',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  uses_count      INTEGER NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_sent_at  TIMESTAMPTZ,
  invited_by_student_id UUID,        -- FK added in step 6, after `students` gets its port-era columns
  parent_share_code_id  UUID REFERENCES quiz_share_codes(id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_teacher ON quiz_share_codes(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_quiz    ON quiz_share_codes(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_share_codes_report_pending
  ON quiz_share_codes (created_at) WHERE report_sent_at IS NULL;

-- ============================================================
-- 5. quiz_sessions — solo attempts, link attempts, friend invites
--    (PK 046 §5 + 049; also folds in the bd-2305 'in_progress' status fix,
--    since NIETE's quiz-session.service.js has the same latent bug PK had —
--    'in_progress' is written but was never in the CHECK)
-- ============================================================
ALTER TABLE quiz_sessions ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS student_name           TEXT,
  ADD COLUMN IF NOT EXISTS student_class          TEXT,
  ADD COLUMN IF NOT EXISTS share_code_id          UUID REFERENCES quiz_share_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source                 TEXT NOT NULL DEFAULT 'roster',
  ADD COLUMN IF NOT EXISTS invited_by_student_id   UUID;   -- FK added in step 6

ALTER TABLE quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_source_check;
ALTER TABLE quiz_sessions ADD CONSTRAINT quiz_sessions_source_check
  CHECK (source IN ('roster', 'video_solo', 'share_link'));

ALTER TABLE quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_has_identity;
ALTER TABLE quiz_sessions ADD CONSTRAINT quiz_sessions_has_identity
  CHECK (student_id IS NOT NULL OR user_id IS NOT NULL OR student_name IS NOT NULL);

ALTER TABLE quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_status_check;
ALTER TABLE quiz_sessions ADD CONSTRAINT quiz_sessions_status_check
  CHECK (status IN ('invited', 'active', 'in_progress', 'completed',
                    'incomplete', 'expired', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_id
  ON quiz_sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_share_code
  ON quiz_sessions(share_code_id) WHERE share_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_invited_by
  ON quiz_sessions (invited_by_student_id) WHERE invited_by_student_id IS NOT NULL;

-- ============================================================
-- 6. students — persistent quiz-taker identity (PK 048 + 050)
-- ============================================================
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS self_reported_class TEXT,
  ADD COLUMN IF NOT EXISTS enrolled_by_user_id UUID REFERENCES users(id);

COMMENT ON COLUMN students.phone IS
  'The WhatsApp number this child takes quizzes on, digits only. Distinct from '
  'parent_phone, which is roster data a TEACHER typed.';
COMMENT ON COLUMN students.self_reported_class IS
  'The class a child typed for themself. Rostered students get class from '
  'student_lists.class_name instead.';
COMMENT ON COLUMN students.enrolled_by_user_id IS
  'The teacher whose shared quiz first brought this child in. Set once, never '
  'rewritten.';

CREATE INDEX IF NOT EXISTS idx_students_phone
  ON students (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_enrolled_by
  ON students (enrolled_by_user_id) WHERE enrolled_by_user_id IS NOT NULL;

-- Now that `students` exists with the shape quiz_share_codes/quiz_sessions
-- expect, add the two FKs that step 4/5 deferred.
ALTER TABLE quiz_share_codes
  ADD CONSTRAINT quiz_share_codes_invited_by_student_id_fkey
  FOREIGN KEY (invited_by_student_id) REFERENCES students(id);

ALTER TABLE quiz_sessions
  ADD CONSTRAINT quiz_sessions_invited_by_student_id_fkey
  FOREIGN KEY (invited_by_student_id) REFERENCES students(id);

-- ============================================================
-- 7. student_videos — R2 delivery + cleaned labels
--    (PK add_student_videos_r2_migration_cols.sql + add_student_videos_clean_title_cols.sql
--    + the undocumented superseded_by column, reconstructed from PK's live schema)
-- ============================================================
ALTER TABLE student_videos
  ADD COLUMN IF NOT EXISTS r2_url TEXT,
  ADD COLUMN IF NOT EXISTS migration_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS clean_chapter TEXT,
  ADD COLUMN IF NOT EXISTS clean_title TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES student_videos(id) ON DELETE SET NULL;

ALTER TABLE student_videos DROP CONSTRAINT IF EXISTS student_videos_superseded_by_not_self;
ALTER TABLE student_videos ADD CONSTRAINT student_videos_superseded_by_not_self
  CHECK (superseded_by IS NULL OR superseded_by <> id);

COMMENT ON COLUMN student_videos.r2_url IS
  'Public Cloudflare R2 URL of the WhatsApp-ready (<=15MB) video. Flow serves '
  'this, not video_url.';
COMMENT ON COLUMN student_videos.migration_status IS
  'S3->R2 pipeline state: pending|downloaded|done|failed|broken_source. Flow '
  'filters WHERE migration_status=''done''.';

-- ============================================================
-- 8. student_video_feedback — quiz-outcome dimension
--    (undocumented on PK too — reconstructed from PK's live schema:
--    scope/quiz_useful/quiz_session_id/delivery_id + their 2 CHECK constraints)
-- ============================================================
ALTER TABLE student_video_feedback
  ADD COLUMN IF NOT EXISTS scope           TEXT NOT NULL DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS quiz_useful     BOOLEAN,
  ADD COLUMN IF NOT EXISTS quiz_session_id UUID REFERENCES quiz_sessions(id),
  ADD COLUMN IF NOT EXISTS delivery_id     UUID;   -- FK added in step 9, after video_quiz_deliveries exists

ALTER TABLE student_video_feedback DROP CONSTRAINT IF EXISTS student_video_feedback_scope_check;
ALTER TABLE student_video_feedback ADD CONSTRAINT student_video_feedback_scope_check
  CHECK (scope IN ('video', 'video_and_quiz'));

ALTER TABLE student_video_feedback DROP CONSTRAINT IF EXISTS svf_scope_quiz_useful_consistent;
ALTER TABLE student_video_feedback ADD CONSTRAINT svf_scope_quiz_useful_consistent
  CHECK ((scope = 'video' AND quiz_useful IS NULL)
      OR (scope = 'video_and_quiz' AND quiz_useful IS NOT NULL));

-- ============================================================
-- 9. video_quiz_deliveries — new table (undocumented on PK too;
--    reconstructed from PK's live schema + pg_constraint + pg_indexes)
-- ============================================================
CREATE TABLE IF NOT EXISTS video_quiz_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),
  video_id         UUID REFERENCES student_videos(id),
  phone            VARCHAR(50),
  status           TEXT NOT NULL,
  grade            VARCHAR(50),
  subject          VARCHAR(100),
  title            TEXT,
  correlation_id   TEXT,
  delivered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quiz_offered_at  TIMESTAMPTZ,
  quiz_response    TEXT,
  quiz_responded_at TIMESTAMPTZ,
  quiz_session_id  UUID REFERENCES quiz_sessions(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT video_quiz_deliveries_status_check
    CHECK (status = ANY (ARRAY['sent', 'failed'])),
  CONSTRAINT video_quiz_deliveries_quiz_response_check
    CHECK (quiz_response = ANY (ARRAY['accepted', 'shared', 'declined', 'ignored']))
);

CREATE INDEX IF NOT EXISTS idx_vqd_user ON video_quiz_deliveries(user_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_vqd_video ON video_quiz_deliveries(video_id);
CREATE INDEX IF NOT EXISTS idx_vqd_delivered ON video_quiz_deliveries(delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_vqd_response ON video_quiz_deliveries(quiz_response) WHERE quiz_response IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vqd_session ON video_quiz_deliveries(quiz_session_id) WHERE quiz_session_id IS NOT NULL;

-- Step 8's deferred FK, now that video_quiz_deliveries exists.
ALTER TABLE student_video_feedback
  ADD CONSTRAINT student_video_feedback_delivery_id_fkey
  FOREIGN KEY (delivery_id) REFERENCES video_quiz_deliveries(id);

COMMIT;
