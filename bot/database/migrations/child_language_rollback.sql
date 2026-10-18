-- Rollback: child_language.sql. Drops the table (the kept languages are lost; the links then open as they did
-- before it, from the child's quizzes or the reply's language).
DROP TABLE IF EXISTS child_language;
