-- Rollback for teacher_reminder_optouts.sql. Every recorded STOP is lost: a teacher who opted out would get the quiz
-- reminder template again while the switch (app_settings.lp_quiz_offer_window_template) names it; turn the switch off first.
DROP TABLE IF EXISTS public.teacher_reminder_optouts;
