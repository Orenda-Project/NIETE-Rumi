-- ROLLBACK for V1.6.10 — narrows users.grades_taught back to VARCHAR(100).
--
-- Narrowing is NOT metadata-only and it can fail or lose data: a value longer than 100 (a teacher
-- who ticked most grades after V1.6.10) cannot be kept. This refuses rather than truncating — look
-- at those rows first and decide what they should hold.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE length(grades_taught) > 100) THEN
    RAISE EXCEPTION 'ROLLBACK V1.6.10 refused: % users.grades_taught value(s) exceed 100 characters',
      (SELECT count(*) FROM users WHERE length(grades_taught) > 100);
  END IF;
END $$;

ALTER TABLE users
  ALTER COLUMN grades_taught TYPE VARCHAR(100);
