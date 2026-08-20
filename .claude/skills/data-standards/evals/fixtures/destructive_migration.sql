-- alembic revision destructive_test
DROP TABLE legacy_scores;
ALTER TABLE users DROP COLUMN old_username;
