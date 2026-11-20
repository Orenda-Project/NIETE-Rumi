-- Rollback for V1.10.7. Drops the A/B tracker's five tables and its six functions, and nothing else: no app table,
-- column or row is touched. Switch the nightly job off first (app_settings ab_tracker_rollup_enabled removed) so no run
-- calls them. The tracker's numbers are lost with the tables; the workspace keeps the cards and can rebuild them.
DROP FUNCTION IF EXISTS public.ab_tracker_refresh_close(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ab_tracker_upsert_rollup(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ab_tracker_refresh_open(integer, date);
DROP FUNCTION IF EXISTS public.ab_tracker_metric_rows(text, text, date, date);
DROP FUNCTION IF EXISTS public.ab_tracker_live_tests();
DROP FUNCTION IF EXISTS public.ab_tracker_unit_teachers(text, text);
DROP TABLE IF EXISTS public.ab_stop_state;
DROP TABLE IF EXISTS public.ab_rollup_unit_period;
DROP TABLE IF EXISTS public.ab_refresh_log;
DROP TABLE IF EXISTS public.ab_assignment;
DROP TABLE IF EXISTS public.ab_card_lock;
NOTIFY pgrst, 'reload schema';
