-- Rows this file returns are the accounts scripts/mark-test-users.py will flag.
-- Contract: return (id text, rule text). Only rows not yet flagged. Reviewed before every run.
--
-- rule 1: the account's school is a heuristic test school (schools.is_probable_test)
SELECT u.id::text AS id, 'probable_test_school' AS rule
FROM users u
JOIN schools s ON s.id = u.school_id
WHERE s.is_probable_test AND u.is_test_user = false
UNION ALL
-- rule 2: the account's name says so
SELECT u.id::text, 'name_pattern'
FROM users u
WHERE u.is_test_user = false
  AND u.name ~* '(^|[^a-z])(test|testing|dummy|demo|xyz|sample)([^a-z]|$)'
