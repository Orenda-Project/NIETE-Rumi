-- ROLLBACK for V1.6.19 — turn row level security back off on assessment_topics (the V1.6.18 state).
ALTER TABLE assessment_topics DISABLE ROW LEVEL SECURITY;
