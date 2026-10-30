-- V1.8.5 — the switch for the one-off formative-assessment video to group B teachers (bd-pw1ccr.8.4).
--
-- WHAT. scripts/broadcast-fa-video.js sends template niete_fa_video_ab_v1 (a two-minute Urdu video) to teachers
-- whose school is in group B of niete_topic_nudge_ab_assignment (V1.8.4). Its --live mode refuses unless this is on.
--
-- WHY ONLY A SWITCH. Checked against the schema on disk (30 Oct): broadcast_logs / broadcast_messages already hold
-- "which broadcast, which teacher, sent or failed, wamid", and the status webhook already updates them by wamid.
-- No new table or column is needed.
--
-- DATA. One app_settings row. No PII.
-- OFF BY DEFAULT. fa_video_broadcast_enabled = false: the script dry-runs and test-sends only.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).
-- IDEMPOTENT: ON CONFLICT DO NOTHING.
-- Rollback: ROLLBACK_V1.8.5__fa_video_broadcast.sql

INSERT INTO app_settings (key, value, description)
VALUES ('fa_video_broadcast_enabled', 'false'::jsonb,
        'Topic paper A/B, group B only: lets scripts/broadcast-fa-video.js --live send the 2 Nov formative-assessment '
        'video (template niete_fa_video_ab_v1) to group B teachers (bd-pw1ccr.8.4). Off = dry run and test sends only. '
        'Turn on for the send, then off again.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
