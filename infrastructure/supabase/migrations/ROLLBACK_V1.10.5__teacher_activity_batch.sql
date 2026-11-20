-- Rollback for V1.10.5. Drops the two read functions of the twice-a-day teacher activity job. Nothing else depends on
-- them in the database; switch the job off first (app_settings teacher_activity_slots removed) so no run calls them.
DROP FUNCTION IF EXISTS public.teacher_activity_batch(uuid[]);
DROP FUNCTION IF EXISTS public.teacher_activity_teachers();
NOTIFY pgrst, 'reload schema';
