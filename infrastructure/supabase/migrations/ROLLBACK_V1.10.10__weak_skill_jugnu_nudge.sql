-- ROLLBACK of the versioned migration V1.10.10 (infrastructure/supabase/migrations) — turns the weak-skill Jugnu
-- nudge off. NON-DESTRUCTIVE on purpose: it deletes nothing (data standard D9). The 'weak_skill_jugnu' kind stays
-- allowed by the CHECK: with the code rolled back nothing writes it, and its rows (per teacher per week: sent / skipped,
-- why) stay as the record of what was sent. Narrowing the CHECK would first need those rows deleted; that is a
-- separate, reviewed step if it is ever wanted.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).

UPDATE app_settings SET value = 'false'::jsonb WHERE key = 'weak_skill_jugnu_enabled';
UPDATE app_settings SET value = '[]'::jsonb WHERE key = 'weak_skill_jugnu_templates';
UPDATE app_settings SET value = '"test"'::jsonb WHERE key = 'weak_skill_jugnu_audience';
