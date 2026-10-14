-- V1.6.7 — coach_visit_requests: a teacher in group C or D who disagreed with her AI coaching report and
-- asked for a person to observe her class instead (bd-v0toag.45). Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. One row per report (UNIQUE coaching_session_id): she picked one of her school's coaches, or "none
-- of these". Written by the portal (dashboard/services/coach-visit-request.js) when she confirms; status
-- moves pending -> sent | failed once the coach's WhatsApp ping (template coach_visit_request_v1) is tried.
-- no_coach = she picked "none of these", nobody pinged. Read by the tracker: requests per group, and
-- whether visits pile up in C/D (the stop rule on uneven measurement).
--
-- WHY A NEW TABLE. Checked against the live schema (14 Oct 2026): observation_schedules holds visits a
-- coach has BOOKED and is read by many observe flows — a request nobody has booked yet would show there as
-- a visit. coaching_quality_metrics is the report survey (one thumb + a reason), not a request with a coach
-- and a delivery status. app_settings / feature_suggestions / cta_clicks do not carry a target coach. The
-- UNIQUE key is what stops a second tap pinging the coach twice.
--
-- DATA. Ids, a group letter, a status and the WhatsApp message id. No names, no phone, no message text.
-- LOAD. A few rows a day at most, C/D only, while ab_v10_enabled is on. Reads by the tracker only.
-- IDEMPOTENT. IF NOT EXISTS throughout.
-- Rollback: ROLLBACK_V1.6.7__coach_visit_requests.sql
-- ORDER. Safe either side of the code: nothing writes here unless ab_v10_enabled is on and the school is
-- in C or D.

CREATE TABLE IF NOT EXISTS coach_visit_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coaching_session_id  UUID NOT NULL UNIQUE REFERENCES coaching_sessions (id),
  teacher_user_id      UUID NOT NULL REFERENCES users (id),
  coach_user_id        UUID REFERENCES users (id),
  school_id            UUID REFERENCES schools (id),
  ab_group             TEXT NOT NULL CHECK (ab_group IN ('C', 'D')),
  status               TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'no_coach')),
  wa_message_id        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE coach_visit_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE coach_visit_requests IS
  'ICT G1-5 v10 coaching test (bd-v0toag.45): a C/D teacher who disagreed with her AI report asked for a '
  'coach to observe. One row per report; status pending -> sent | failed, or no_coach. Ids only. '
  'Transitional — dropped when the test is promoted.';

NOTIFY pgrst, 'reload schema';
