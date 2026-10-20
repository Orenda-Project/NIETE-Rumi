-- V1.6.19 — enable row level security on assessment_topics.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. V1.6.18 created assessment_topics with no RLS (mirroring niete_lp612_segments, V1.2.8). The newer tables
-- in this series enable RLS with no policies (V1.6.7 coach_visit_requests, V1.6.15 niete_fln_events), so the
-- anon/authenticated roles see nothing. Do the same here.
--
-- ACCESS. No policies on purpose: the bot reads and writes with the service role, which bypasses RLS. Nothing
-- else reads this table.
--
-- DATA. Sensitivity: internal. Curriculum metadata only, no personal data.
-- IDEMPOTENT. ENABLE ROW LEVEL SECURITY on a table that already has it is a no-op.
-- Rollback: ROLLBACK_V1.6.19__assessment_topics_rls.sql
-- ORDER. After V1.6.18 (the table must exist).

ALTER TABLE assessment_topics ENABLE ROW LEVEL SECURITY;
