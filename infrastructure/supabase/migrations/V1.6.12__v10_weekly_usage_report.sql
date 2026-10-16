-- V1.6.12 — the v10 group B weekly usage report (bd-v0toag.32): a third teacher_nudges kind and its two switches.
--
-- NO NEW TABLE OR COLUMN. Checked against the schema on disk and origin/staging (16 Oct), not from memory:
--   · teacher_nudges (V1.5.3) already holds "which teacher, which date, sent or not, why skipped" with
--     UNIQUE (user_id, nudge_date, kind). The report is one row per teacher per WEEK, keyed on the week's
--     Monday (PKT) in nudge_date, so the UNIQUE is the once-per-teacher-per-week guarantee across replicas
--     and restarts. V1.5.3 made a new kind a migration on purpose; this is that migration.
--   · app_settings holds the switch and the approved-template list, read like ab_v10_enabled.
--   · Every count in the report is computed at send time from existing tables (conversations,
--     niete_lp_downloads, niete_lp_opens, coaching_sessions, coaching_quality_metrics).
--
-- OFF BY DEFAULT. v10_weekly_report_enabled = false and v10_weekly_report_templates = [] mean nothing is
-- scheduled and nothing is sent. To go live: Meta approves the templates → add their names to the list →
-- flip the switch. A template not on the list is skipped (template_not_approved), never sent as free text.
--
-- IDEMPOTENT: the CHECK is dropped and re-added by name; the settings rows are ON CONFLICT DO NOTHING.

BEGIN;

ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report'));

INSERT INTO app_settings (key, value, description)
VALUES ('v10_weekly_report_enabled', 'false'::jsonb,
        'v10 coaching A/B, group B only: the Saturday-morning weekly usage report on WhatsApp (bd-v0toag.32). '
        'On = group B teachers get weekly_usage_v1 (or weekly_usage_quiet_v1 for a quiet week). Needs '
        'ab_v10_enabled on and TEACHER_NUDGES_ENABLED=true on the main sqs-worker. Off = nothing scheduled or sent.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('v10_weekly_report_templates', '[]'::jsonb,
        'The weekly usage report templates Meta has APPROVED, e.g. ["weekly_usage_v1","weekly_usage_quiet_v1"]. '
        'A template not listed here is never sent (skipped template_not_approved); there is no free-form fallback.')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
