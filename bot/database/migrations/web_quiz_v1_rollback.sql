-- Rollback for web_quiz_v1.sql. Web sessions have no phone, so they get an
-- empty string before the constraint returns (the class-card sender treats ''
-- as no phone, same as NULL). The device_ref column and its values are lost.
UPDATE public.quiz_sessions SET parent_phone = '' WHERE parent_phone IS NULL;
ALTER TABLE public.quiz_sessions ALTER COLUMN parent_phone SET NOT NULL;
ALTER TABLE public.quiz_sessions DROP COLUMN IF EXISTS device_ref;
