-- V1.10.10 — the weekly weak-skill Jugnu nudge (bd-ptl6x9.7): a sixth teacher_nudges kind, 'weak_skill_jugnu',
-- and its three app_settings rows. Versioned migration (infrastructure/supabase/migrations), applied per environment
-- in order. Follows V1.10.9 (renumbered from V1.10.3, which sandbox gave to own_plans_teacher_rating).
--
-- WHAT. Once a week (Saturday morning PKT) a teacher with a Jugnu class list may get ONE template message naming the
-- maths skill her class's grade found hardest in the children's maths check at her school (last 8 weeks), with a
-- button that forwards the matching Jugnu game to families from her own phone. One row per teacher per week, keyed on
-- the week's Monday: UNIQUE (user_id, nudge_date, kind) is the once-a-week guarantee (V1.5.3, as V1.6.12 and V1.8.12).
-- A new kind is a migration on purpose (V1.5.3); this is that migration. No new table, no new column.
--
-- DATA. A teacher id, a date, a status, a skip reason, the game and grade named. No child count, no name, no phone.
-- OFF BY DEFAULT. weak_skill_jugnu_enabled false; no approved template; the audience is test accounts only.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).
-- IDEMPOTENT: the CHECK is dropped and re-added by name, listing every kind in use (V1.8.12's five plus this one).
-- Rollback: ROLLBACK_V1.10.10__weak_skill_jugnu_nudge.sql

ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report', 'topic_end_nudge', 'coach_weekly_report', 'weak_skill_jugnu'));

INSERT INTO app_settings (key, value, description)
VALUES ('weak_skill_jugnu_enabled', 'false'::jsonb,
        'Weekly weak-skill Jugnu nudge (bd-ptl6x9.7): Saturday 09:00-21:00 PKT, one template per teacher with a Jugnu '
        'class list naming the maths skill her grade found hardest (groups under 5 children say nothing) and a button '
        'to forward that Jugnu game to families. Needs TEACHER_NUDGES_ENABLED=true on the main sqs-worker. Off = nothing booked or sent.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('weak_skill_jugnu_templates', '[]'::jsonb,
        'Meta-APPROVED template names the weak-skill Jugnu nudge may send, e.g. ["weak_skill_jugnu_v1"]. A name not '
        'listed is never sent (no free-form fallback).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description)
VALUES ('weak_skill_jugnu_audience', '"test"'::jsonb,
        '"test" = test accounts only (users.is_test_user); "all" = every teacher with a Jugnu class list. Going to '
        '"all" on production needs its own go.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
