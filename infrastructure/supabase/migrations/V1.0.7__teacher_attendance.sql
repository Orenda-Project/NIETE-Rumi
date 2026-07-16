-- V1.0.7  Teacher Attendance (NIETE STEPS-P: Teacher Presence)
--
-- Backs the /api/portal/attendance/* endpoints. Principal (in a school) marks
-- daily attendance for teachers under them; teachers read their own records;
-- the STEPS framework consumes the presence rollup for each teacher's ACR
-- (Annual Confidential Report).
--
-- Two new tables (justified per root CLAUDE.md Rule 15):
--   * schools                       — first-class school entity. Today users.school_name
--                                     is a free-text VARCHAR(200); NIETE's org hierarchy
--                                     (region → school → principal → teachers) needs a
--                                     stable id to attach principals + attendance to.
--   * teacher_attendance_records    — one row per (teacher_id, date). Distinct from the
--                                     existing attendance_sessions / attendance_records
--                                     tables which are for STUDENT attendance inside a
--                                     lesson (linked to student_lists).
--
-- Anti-sprawl notes:
--   * No separate `regions` table — region is a low-cardinality string column on
--     `schools` (6 known regions: Urban-I, Urban-II, Sihala, Nilore, Tarnol, Barakahu).
--     A dedicated table adds a join with no lookup benefit; can be extracted later
--     if per-region metadata (RM, contact, calendar) grows.
--   * No `school_calendar` table — Hasnat's spec says `working_days = days actually
--     marked` for Round 1. A calendar-override table waits for real demand.
--   * `principal` role reuses the existing `users.role` column (VARCHAR) rather than
--     minting a new `dashboard_users` row per principal. Principals log in via the
--     same portal flow as teachers (phone_number + portal_password_hash).

-- ─── Schools ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schools (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 VARCHAR(255) NOT NULL,
    region               VARCHAR(64),                        -- Urban-I, Urban-II, Sihala, Nilore, Tarnol, Barakahu
    principal_user_id    UUID REFERENCES users(id),          -- nullable: schools can exist without a principal yet
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, region)                                    -- avoid dupes across regions
);
CREATE INDEX IF NOT EXISTS idx_schools_region ON schools(region);
CREATE INDEX IF NOT EXISTS idx_schools_principal ON schools(principal_user_id)
    WHERE principal_user_id IS NOT NULL;

-- ─── Users: add school_id + role ─────────────────────────────────────────────
-- users.school_id — FK to schools.id; nullable, backfilled per school onboarding.
-- users.role      — role within the NIETE org (teacher | principal). Free-text
--                   VARCHAR to stay flexible; CHECK constraint is intentionally
--                   omitted for the same reason `dashboard_users.role` is free-text.
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role       VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role)      WHERE role IS NOT NULL;

-- ─── Teacher attendance records ─────────────────────────────────────────────
-- One row per (teacher_id, date). status IN (present | absent | leave).
-- When status='leave', leave_type IN (casual | sick | official) MUST be set.
-- Otherwise leave_type MUST be NULL. Enforced via CHECK.
CREATE TABLE IF NOT EXISTS teacher_attendance_records (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id           UUID NOT NULL REFERENCES users(id),
    school_id            UUID NOT NULL REFERENCES schools(id),   -- denormalised for query speed
    date                 DATE NOT NULL,
    status               VARCHAR(16) NOT NULL,                  -- present | absent | leave
    leave_type           VARCHAR(16),                           -- casual | sick | official (only when status=leave)
    marked_by_user_id    UUID NOT NULL REFERENCES users(id),
    marked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (teacher_id, date),
    CONSTRAINT teacher_attendance_status_valid
        CHECK (status IN ('present', 'absent', 'leave')),
    CONSTRAINT teacher_attendance_leave_type_valid
        CHECK (
            (status = 'leave'  AND leave_type IN ('casual', 'sick', 'official'))
            OR
            (status <> 'leave' AND leave_type IS NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_teacher_attendance_school_date
    ON teacher_attendance_records(school_id, date);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_teacher_date
    ON teacher_attendance_records(teacher_id, date DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Portal routes use the service role key (bypasses RLS), but enable RLS on these
-- tables so ad-hoc analyst queries + future direct-Supabase reads are gated.
-- The routes themselves enforce the principal-owns-school and teacher-owns-self
-- checks in application code (see attendance.routes.js).
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_attendance_records ENABLE ROW LEVEL SECURITY;

-- Schools: readable by everyone (safe — name + region + principal_user_id only).
-- Writes restricted to service_role.
DROP POLICY IF EXISTS schools_read_all ON schools;
CREATE POLICY schools_read_all ON schools FOR SELECT USING (true);

-- Teacher attendance: readable if you are the teacher (auth.uid matches teacher_id)
-- OR you are the principal of the record's school. Application-layer enforcement
-- is the primary gate; RLS is defense-in-depth.
DROP POLICY IF EXISTS teacher_attendance_read_own ON teacher_attendance_records;
CREATE POLICY teacher_attendance_read_own ON teacher_attendance_records
    FOR SELECT USING (
        teacher_id = auth.uid()
        OR
        school_id IN (
            SELECT id FROM schools WHERE principal_user_id = auth.uid()
        )
    );

-- Writes restricted to service_role (portal routes do the work).
-- No INSERT/UPDATE/DELETE policies → default-deny for non-service-role.

-- ─── PostgREST reload ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
