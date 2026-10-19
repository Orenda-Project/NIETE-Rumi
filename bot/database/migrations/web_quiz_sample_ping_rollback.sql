-- Rollback of web_quiz_sample_ping.sql: drops the direct ping's two tables (nothing else references them).
DROP TABLE IF EXISTS public.sample_pings;
DROP TABLE IF EXISTS public.sample_ping_consents;
