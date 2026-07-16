-- V1.0.6  Human Coach Platform (HCP) — visit schedules, coaching actions, and
--         feedback deliveries.
--
-- Adds three new tables that back the HCP portal endpoints under
-- /api/portal/hcp/*. These are the minimum persistent surface needed to move
-- the HCP prototype's coach-facing workflow onto Rumi's stack:
--
--   * hcp_visit_schedules      — coach schedules a classroom visit for a
--                                teacher; row is the record-of-truth (WhatsApp
--                                sync writes back here in Phase 3).
--   * hcp_coaching_actions     — small reference table: per-indicator action-
--                                plan text shown on the coach's coaching-plan
--                                screen. Seeded from the HCP prototype.
--   * hcp_feedback_deliveries  — every generated 6-box coaching feedback
--                                (Green/Orange/Purple/OrangeRed/Yellow/Blue),
--                                keyed to a coaching_session, with version
--                                history when a coach refines the prompt.
--
-- Anti-sprawl notes (per root CLAUDE.md Rule 15):
--   * Teachers are NOT re-added — reuse `users` filtered by region.
--   * DC observation history is NOT re-added — reuse `coaching_sessions`
--     with `analysis_data` JSONB rollups.
--   * Training-module recommendations are NOT re-added — reuse
--     `training_modules` filtered by weak indicators.

-- ─── Visit schedules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hcp_visit_schedules (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id             UUID NOT NULL REFERENCES dashboard_users(id),
    teacher_id           UUID NOT NULL REFERENCES users(id),
    scheduled_at         TIMESTAMPTZ NOT NULL,
    observation_tool     VARCHAR(32) NOT NULL,          -- 'FICO' | 'HOTs' | 'COTs'
    notes                TEXT,
    status               VARCHAR(32) NOT NULL DEFAULT 'upcoming',
                                                        -- upcoming | confirmed | reschedule_requested |
                                                        -- medical_leave | completed | cancelled
    confirmed_at         TIMESTAMPTZ,
    teacher_wa_msg_id    VARCHAR(255),                  -- WA message ID of the 3-button prompt (Phase 3)
    principal_wa_msg_id  VARCHAR(255),                  -- WA confirmation to principal (Phase 3)
    rm_wa_msg_id         VARCHAR(255),                  -- WA confirmation to Regional Manager (Phase 3)
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hcp_visit_schedules_teacher ON hcp_visit_schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_hcp_visit_schedules_coach   ON hcp_visit_schedules(coach_id);
CREATE INDEX IF NOT EXISTS idx_hcp_visit_schedules_status_time
    ON hcp_visit_schedules(status, scheduled_at);

-- ─── Coaching-action reference table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS hcp_coaching_actions (
    id                   BIGSERIAL PRIMARY KEY,
    indicator_code       VARCHAR(32) NOT NULL,
    action_text          TEXT NOT NULL,
    priority_order       INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (indicator_code, priority_order)
);
CREATE INDEX IF NOT EXISTS idx_hcp_coaching_actions_indicator
    ON hcp_coaching_actions(indicator_code);

-- Seed the 14 coaching actions the HCP prototype ships with.
-- The prototype pairs each FICO v3 indicator with a first-line action a coach
-- can propose to the teacher. Ported 1:1; can be edited/extended live.
INSERT INTO hcp_coaching_actions (indicator_code, action_text, priority_order) VALUES
    ('SI1',    'Open every lesson with a 30-second "what we''ll learn today" statement in plain language.', 1),
    ('SI3',    'Cross-check the day''s content against the textbook teacher guide before class; flag anything unclear.', 1),
    ('PIC-1',  'Pick ONE activity per lesson that directly practices the SLO — cut the rest.', 1),
    ('PIC-4',  'Move from yes/no questions to "why" and "how" — plan 3 open questions per lesson.', 1),
    ('PIA-1',  'Start each lesson with a 2-minute "what do you already know about X?" round.', 1),
    ('PIA-2',  'End each lesson with a "where do you see this in your life?" question.', 1),
    ('MA-0',   'Explicitly announce each phase: "I do", "We do together", "You try it".', 1),
    ('M1',     'Ask a student to explain their answer to the class before moving on.', 1),
    ('M2',     'Give students 60 seconds of quiet think-time before taking any answer.', 1),
    ('S1',     'Frame the lesson with one investigation question students must answer by the end.', 1),
    ('S2',     'Do a 5-minute "science talk" — students discuss what they observed in pairs.', 1),
    ('L1',     'Add a 5-minute daily phonics drill — one sound family per week.', 1),
    ('L2',     'Name ONE comprehension strategy per lesson (predicting, summarising, questioning) and model it aloud.', 1),
    ('L3',     'End each reading lesson with a 3-sentence written response.', 1)
ON CONFLICT (indicator_code, priority_order) DO NOTHING;

-- ─── Feedback deliveries (versioned 6-box coaching feedback) ──────────────
CREATE TABLE IF NOT EXISTS hcp_feedback_deliveries (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coaching_session_id  UUID REFERENCES coaching_sessions(id),
    teacher_id           UUID NOT NULL REFERENCES users(id),
    coach_id             UUID REFERENCES dashboard_users(id),
    language             VARCHAR(16) NOT NULL DEFAULT 'english',
                                                        -- english | urdu | roman_urdu
    feedback_json        JSONB NOT NULL,                -- 6-box shape: header + strengths / growth /
                                                        --   student_learning / student_engagement /
                                                        --   action_items / encouragement
    feedback_audio_url   TEXT,                          -- Phase 3 — TTS or coach voice recording
    wa_text_msg_id       VARCHAR(255),                  -- Phase 3 — WA delivery IDs
    wa_audio_msg_id      VARCHAR(255),
    version              INTEGER NOT NULL DEFAULT 1,
    prompt_used          TEXT,                          -- for audit + refinement iteration
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hcp_feedback_deliveries_teacher
    ON hcp_feedback_deliveries(teacher_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hcp_feedback_deliveries_session
    ON hcp_feedback_deliveries(coaching_session_id) WHERE coaching_session_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
