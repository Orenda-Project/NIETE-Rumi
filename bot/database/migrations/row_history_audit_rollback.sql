-- Rollback for row_history_audit.
--
-- Triggers first, then the function, then the table LAST and only by explicit
-- choice: dropping record_history destroys the audit trail, which is the one
-- thing here that cannot be rebuilt. Dropping the triggers alone stops all
-- recording and is the safe, reversible half.

DROP TRIGGER IF EXISTS users_history_trigger ON public.users;
DROP TRIGGER IF EXISTS coaching_sessions_history_trigger ON public.coaching_sessions;
DROP TRIGGER IF EXISTS lesson_plan_requests_history_trigger ON public.lesson_plan_requests;
DROP TRIGGER IF EXISTS training_assessment_attempts_history_trigger ON public.training_assessment_attempts;
DROP TRIGGER IF EXISTS observation_schedules_history_trigger ON public.observation_schedules;

DROP FUNCTION IF EXISTS public.log_row_changes();

-- Deliberately commented out. Uncomment ONLY when discarding the history is intended.
-- DROP TABLE IF EXISTS public.record_history;
