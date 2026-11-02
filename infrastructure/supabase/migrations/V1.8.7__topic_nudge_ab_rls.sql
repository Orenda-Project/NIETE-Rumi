-- V1.8.7 — enable row level security on niete_topic_nudge_ab_assignment.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. V1.8.4 created niete_topic_nudge_ab_assignment with no RLS. The newer tables enable RLS with no policies
-- (V1.6.19 assessment_topics), so the anon/authenticated roles see nothing. Do the same here.
--
-- ACCESS. No policies on purpose: the bot reads it with the service role, which bypasses RLS. Nothing else reads it.
--
-- DATA. Sensitivity: internal. School ids and an A/B letter, no personal data.
-- IDEMPOTENT. ENABLE ROW LEVEL SECURITY on a table that already has it is a no-op.
-- Rollback: ROLLBACK_V1.8.7__topic_nudge_ab_rls.sql
-- ORDER. After V1.8.4 (the table must exist).

ALTER TABLE niete_topic_nudge_ab_assignment ENABLE ROW LEVEL SECURITY;
