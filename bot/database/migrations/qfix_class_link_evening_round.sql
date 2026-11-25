-- Migration: the class evening round (switch web_quiz_evening_round, OFF by default; web-quiz-evening-round.js).
--
-- ADDITIVE. No new table: a round is a quizzes row (meta.source 'evening_round', meta.class_id, meta.round_day
-- PKT YYYY-MM-DD) with a quiz_share_codes row (class_id set). Two indexes:
--
--   quizzes_evening_round_one   one round per class per PKT day, whichever replica writes first (the writer also
--                               holds a Redis lock); a second insert fails 23505 and is counted as 'exists'.
--                               round_day leads, so "every round of a day" (the writer, the hub's tile) reads it too.
--   quiz_sessions_student_done  the recall read: a class's children's sessions finished 2-3 days before the round
--                               (quiz_sessions has no student_id index on sandbox).
--
-- Both are partial and small. On a large table use CREATE INDEX CONCURRENTLY outside a transaction instead.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE UNIQUE INDEX IF NOT EXISTS quizzes_evening_round_one
  ON public.quizzes ((meta->>'round_day'), (meta->>'class_id'))
  WHERE meta->>'source' = 'evening_round';

CREATE INDEX IF NOT EXISTS quiz_sessions_student_done
  ON public.quiz_sessions (student_id, completed_at)
  WHERE completed_at IS NOT NULL;
