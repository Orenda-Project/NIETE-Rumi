-- V1.0.5  Historic NIETE coaching-observation import (read-only mirror)
--
-- One-time historic pull from `fde_production.coaching_*` (the NIETE / FDE
-- production Postgres reached via TALEEMABAD_DB_* creds) into Rumi's Supabase
-- as `nietemigrated_*` tables. Powers the FEAT-061 HITL / leader-dashboard
-- surface: leaders see historic human-coach visits alongside Rumi's AI-coaching.
--
-- Design notes:
--   * PK = source id (uuid on main tables, bigint on child tables). Keeps FK
--     integrity as-is; no ID remapping needed at migration time.
--   * `source_system` = 'fde_production' constant on every row for provenance.
--   * `migrated_at` timestamptz default now() for audit / re-run detection.
--   * Soft-deleted (`deleted_at IS NOT NULL`) + inactive (`is_active = false`)
--     source rows are EXCLUDED at migration-script level, not here — this
--     schema mirrors the source shape faithfully.
--   * Django polymorphic FKs (`user_profile_content_type_id` + `_object_id`) are
--     preserved as opaque columns; consumers who need the user identity join
--     via other paths (teachervisit.teacher_id, observation.coach_id, etc).
--   * No RLS by default — these tables are analytics/read-only for leader UI.

-- ─── Templates + questions (small, migrate first as FK ancestors) ────

CREATE TABLE IF NOT EXISTS nietemigrated_observation_templates (
    id            BIGINT PRIMARY KEY,
    uuid          UUID NOT NULL,
    name          TEXT NOT NULL,
    created       TIMESTAMPTZ NOT NULL,
    modified      TIMESTAMPTZ NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nietemigrated_observation_sections (
    id              BIGINT PRIMARY KEY,
    uuid            UUID NOT NULL,
    template_id     BIGINT NOT NULL REFERENCES nietemigrated_observation_templates(id),
    title           TEXT NOT NULL,
    "order"         INTEGER NOT NULL,
    is_scored       BOOLEAN NOT NULL,
    section_type    TEXT,
    created         TIMESTAMPTZ NOT NULL,
    modified        TIMESTAMPTZ NOT NULL,
    source_system   TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nietemigrated_observation_question_groups (
    id            BIGINT PRIMARY KEY,
    uuid          UUID NOT NULL,
    section_id    BIGINT NOT NULL REFERENCES nietemigrated_observation_sections(id),
    title         TEXT NOT NULL,
    "order"       INTEGER NOT NULL,
    created       TIMESTAMPTZ NOT NULL,
    modified      TIMESTAMPTZ NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nietemigrated_observation_questions (
    id                    BIGINT PRIMARY KEY,
    uuid                  UUID NOT NULL,
    prompt                TEXT NOT NULL,
    type                  TEXT NOT NULL,
    required              BOOLEAN NOT NULL,
    "order"               INTEGER NOT NULL,
    is_scored             BOOLEAN NOT NULL,
    is_lp_followed        BOOLEAN NOT NULL,
    purpose               TEXT,
    source                TEXT,
    tier                  TEXT,
    section_id            BIGINT REFERENCES nietemigrated_observation_sections(id),
    group_id              BIGINT REFERENCES nietemigrated_observation_question_groups(id),
    lesson_plan_id        BIGINT,   -- opaque; no target-side FK
    core_lesson_plan_id   BIGINT,   -- opaque
    subject_id            BIGINT,   -- opaque
    created               TIMESTAMPTZ NOT NULL,
    modified              TIMESTAMPTZ NOT NULL,
    source_system         TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_qs_section  ON nietemigrated_observation_questions(section_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_qs_group    ON nietemigrated_observation_questions(group_id);

CREATE TABLE IF NOT EXISTS nietemigrated_question_options (
    id           BIGINT PRIMARY KEY,
    uuid         UUID NOT NULL,
    question_id  BIGINT NOT NULL REFERENCES nietemigrated_observation_questions(id),
    label        TEXT NOT NULL,
    value        TEXT NOT NULL,
    "order"      INTEGER NOT NULL,
    score_type   TEXT,
    is_correct   BOOLEAN NOT NULL,
    created      TIMESTAMPTZ NOT NULL,
    modified     TIMESTAMPTZ NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_opts_question ON nietemigrated_question_options(question_id);

-- ─── Visit plans + visits (main entity ancestors) ─────────────────────

CREATE TABLE IF NOT EXISTS nietemigrated_visit_plans (
    id                            UUID PRIMARY KEY,
    uuid                          UUID NOT NULL,
    name                          TEXT,
    from_date                     DATE NOT NULL,
    to_date                       DATE NOT NULL,
    regional_manager_id           BIGINT,   -- opaque
    user_profile_content_type_id  INTEGER,  -- opaque (Django polymorphic)
    user_profile_object_id        INTEGER,  -- opaque
    created                       TIMESTAMPTZ NOT NULL,
    modified                      TIMESTAMPTZ NOT NULL,
    source_system                 TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nietemigrated_school_visits (
    id             UUID PRIMARY KEY,
    uuid           UUID NOT NULL,
    scheduled_date DATE,
    visit_date     DATE,
    comments       TEXT,
    status         TEXT NOT NULL,
    type           TEXT,
    school_id      BIGINT NOT NULL,   -- opaque
    visit_plan_id  UUID REFERENCES nietemigrated_visit_plans(id),
    created        TIMESTAMPTZ NOT NULL,
    modified       TIMESTAMPTZ NOT NULL,
    source_system  TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_sv_school ON nietemigrated_school_visits(school_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_sv_date   ON nietemigrated_school_visits(visit_date);

CREATE TABLE IF NOT EXISTS nietemigrated_teacher_visits (
    id                            UUID PRIMARY KEY,
    uuid                          UUID NOT NULL,
    scheduled_date                DATE,
    visit_date                    DATE,
    comments                      TEXT,
    status                        TEXT NOT NULL,
    visit_purpose                 TEXT NOT NULL,
    school_visit_id               UUID REFERENCES nietemigrated_school_visits(id),
    teacher_id                    BIGINT NOT NULL,  -- opaque
    coach_id                      BIGINT,           -- opaque
    grade_subject_id              BIGINT,           -- opaque
    school_id                     BIGINT,           -- opaque
    section                       TEXT,
    user_profile_content_type_id  INTEGER,          -- opaque
    user_profile_object_id        INTEGER,          -- opaque
    created                       TIMESTAMPTZ NOT NULL,
    modified                      TIMESTAMPTZ NOT NULL,
    source_system                 TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_tv_teacher     ON nietemigrated_teacher_visits(teacher_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_tv_coach       ON nietemigrated_teacher_visits(coach_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_tv_school      ON nietemigrated_teacher_visits(school_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_tv_date        ON nietemigrated_teacher_visits(visit_date);
CREATE INDEX IF NOT EXISTS ix_nietemig_tv_schoolvisit ON nietemigrated_teacher_visits(school_visit_id);

-- ─── Observations + answers (biggest tables) ──────────────────────────

CREATE TABLE IF NOT EXISTS nietemigrated_observations (
    id                            UUID PRIMARY KEY,
    uuid                          UUID NOT NULL,
    number_of_boys                INTEGER NOT NULL,
    number_of_girls               INTEGER NOT NULL,
    observation_date              DATE NOT NULL,
    start_time                    TIME NOT NULL,
    total_duration                INTERVAL,
    feedback                      TEXT,
    teacher_response              TEXT,
    agreed_with_feedback          BOOLEAN,
    status                        TEXT NOT NULL,
    audio_url                     TEXT,
    template_id                   BIGINT NOT NULL REFERENCES nietemigrated_observation_templates(id),
    visit_id                      UUID REFERENCES nietemigrated_teacher_visits(id),
    coach_id                      BIGINT,           -- opaque
    lesson_plan_id                BIGINT,           -- opaque
    core_lesson_plan_id           BIGINT,           -- opaque
    school_class_subject_id       BIGINT,           -- opaque
    book_chapter_id               BIGINT,           -- opaque
    user_profile_content_type_id  INTEGER,          -- opaque
    user_profile_object_id        INTEGER,          -- opaque
    created                       TIMESTAMPTZ NOT NULL,
    modified                      TIMESTAMPTZ NOT NULL,
    source_system                 TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_obs_visit  ON nietemigrated_observations(visit_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_obs_coach  ON nietemigrated_observations(coach_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_obs_date   ON nietemigrated_observations(observation_date);
CREATE INDEX IF NOT EXISTS ix_nietemig_obs_status ON nietemigrated_observations(status);

CREATE TABLE IF NOT EXISTS nietemigrated_observation_answers (
    id                       BIGINT PRIMARY KEY,
    uuid                     UUID NOT NULL,
    observation_id           UUID NOT NULL REFERENCES nietemigrated_observations(id),
    question_id              BIGINT NOT NULL REFERENCES nietemigrated_observation_questions(id),
    answer_text              TEXT,
    single_choice_option_id  BIGINT,   -- opaque (points at nietemigrated_question_options.id)
    student_number           INTEGER,
    is_lp_followed           BOOLEAN,
    student_scores           JSONB,
    created                  TIMESTAMPTZ NOT NULL,
    modified                 TIMESTAMPTZ NOT NULL,
    source_system            TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nietemig_ans_observation ON nietemigrated_observation_answers(observation_id);
CREATE INDEX IF NOT EXISTS ix_nietemig_ans_question    ON nietemigrated_observation_answers(question_id);

NOTIFY pgrst;
