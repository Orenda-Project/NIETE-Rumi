-- Rollback of web_quiz_student_videos_language.sql: the column and its check go; nothing else reads them.
ALTER TABLE student_videos DROP CONSTRAINT IF EXISTS student_videos_language_chk;
ALTER TABLE student_videos DROP COLUMN IF EXISTS language;
