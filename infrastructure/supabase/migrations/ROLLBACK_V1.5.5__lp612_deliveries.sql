-- Reverse of V1.5.5. A new table, so the reverse removes it — and with it every delivery record.
-- destructive: reviewed — the table holds only the /quiz lesson list's source; nothing else reads it.
-- SAFE ONLY after the code is rolled back or LP612_QUIZ_ENABLED is unset: lp612-serving writes a
-- row after every 6-12 delivery (soft-fail — a missing table is logged, never thrown), and the
-- lp612 /quiz provider reads it. Roll the CODE back first.
DROP INDEX IF EXISTS idx_lp612_deliveries_user_recent;
DROP TABLE IF EXISTS niete_lp612_deliveries;
NOTIFY pgrst, 'reload schema';
