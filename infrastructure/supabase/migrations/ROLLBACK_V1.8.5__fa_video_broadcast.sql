-- ROLLBACK V1.8.5 — FA video broadcast switch (reverses migration V1.8.5).
-- Removes only the switch. broadcast_logs / broadcast_messages rows from a send stay: they are the A/B record.
DELETE FROM app_settings WHERE key = 'fa_video_broadcast_enabled';
NOTIFY pgrst, 'reload schema';
