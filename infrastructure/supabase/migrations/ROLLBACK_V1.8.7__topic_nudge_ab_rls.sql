-- ROLLBACK for V1.8.7 — turn row level security back off on niete_topic_nudge_ab_assignment (the V1.8.4 state).
ALTER TABLE niete_topic_nudge_ab_assignment DISABLE ROW LEVEL SECURITY;
