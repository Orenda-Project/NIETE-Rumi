-- Rollback of web_quiz_class_link.sql: the class_links table and its indexes. Every /j/<code> then answers
-- like an unknown code (the bot reads no row); turn web_quiz_class_link off first.
DROP INDEX IF EXISTS public.class_links_teacher;
DROP INDEX IF EXISTS public.class_links_one_active;
DROP TABLE IF EXISTS public.class_links;
