-- V1.8.4 — the topic-end "Make my paper" nudge (bd-pw1ccr.4): a fourth teacher_nudges kind, the school -> group
-- table for the topic paper A/B, and its switch.
--
-- WHAT. A group B teacher who takes the plan for a topic's last day gets one WhatsApp button at 14:30 PKT that opens
-- the paper generator on the Topics step for that chapter (topic-end-nudge.service.js).
--
-- WHY THESE, AND NOTHING ELSE. Checked against the schema on disk and origin/sandbox (29 Oct), not from memory:
--   · teacher_nudges (V1.5.3) already holds "which teacher, which date, sent or skipped, why" with
--     UNIQUE (user_id, nudge_date, kind): that UNIQUE is the one-a-day guarantee. A new kind is a migration on
--     purpose (V1.5.3); this is that migration.
--   · niete_topic_nudge_ab_assignment mirrors niete_lp_ab_assignment (V1.5.8): the group must be fixed for the
--     whole test and joinable to papers made by school_id; a hash cannot be re-rolled for balance. Dropped when
--     the test ends (ROLLBACK below).
--   · app_settings holds the switch, read by topic-end-arm.js (30 s cache, fails closed).
--
-- DATA. School ids, a letter, the block, the seed and a timestamp. No names, no phone, no PII.
-- OFF BY DEFAULT. topic_end_nudge_enabled = false and an empty table mean nothing is booked and nothing is sent.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).
-- IDEMPOTENT: the CHECK is dropped and re-added by name; IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.
-- Rollback: ROLLBACK_V1.8.4__topic_end_nudge.sql

ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report', 'topic_end_nudge'));

CREATE TABLE IF NOT EXISTS niete_topic_nudge_ab_assignment (
  school_id  UUID PRIMARY KEY REFERENCES schools (id),
  ab_group   TEXT NOT NULL CHECK (ab_group IN ('A', 'B')),
  block      TEXT,
  seed       TEXT,
  drawn_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE niete_topic_nudge_ab_assignment IS
  'Topic paper A/B (bd-pw1ccr): school -> group. B = the topic-end Make my paper nudge, A = no nudge. '
  'Written once at the draw; never updated during the test.';

INSERT INTO app_settings (key, value, description)
VALUES ('topic_end_nudge_enabled', 'false'::jsonb,
        'Topic paper A/B, group B only: after a teacher takes the plan for a topic''s last day, one WhatsApp button '
        'at 14:30 PKT opens the paper generator on that chapter''s topics (bd-pw1ccr.4). Needs schools in '
        'niete_topic_nudge_ab_assignment and TEACHER_NUDGES_ENABLED=true on the main sqs-worker. '
        'Off = nothing booked or sent.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
