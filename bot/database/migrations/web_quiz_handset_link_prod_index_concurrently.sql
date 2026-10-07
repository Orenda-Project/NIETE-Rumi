-- PROD variant of the index in web_quiz_handset_link.sql: quiz_sessions is live, so the index is
-- built CONCURRENTLY. Run OUTSIDE a transaction (psql without BEGIN; not through a migration
-- wrapper that opens one). The function part of web_quiz_handset_link.sql is applied separately.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_sessions_device_ref ON public.quiz_sessions (device_ref) WHERE device_ref IS NOT NULL;
