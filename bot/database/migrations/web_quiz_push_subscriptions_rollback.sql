-- Rollback for web_quiz_push_subscriptions.sql. Every stored reminder consent is lost; browsers keep their worker until
-- the kill-switch worker (/sw.js while web_quiz_push_remind is off) unregisters it on the next page load.
DROP TABLE IF EXISTS public.web_quiz_push_subscriptions;
