-- Rollback of web_quiz_student_videos_title_ur.sql: the two columns go; only the switched-off library read names them.
ALTER TABLE student_videos DROP COLUMN IF EXISTS chapter_ur;
ALTER TABLE student_videos DROP COLUMN IF EXISTS title_ur;
