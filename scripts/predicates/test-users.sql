-- Rows this file returns are the accounts scripts/mark-test-users.py will flag.
-- Contract: return (id text, rule text). Only rows not yet flagged. Reviewed before every run.
-- Coaches are never selected by a school-based rule (2026-10-27): a working coach's account can sit on a
-- test or HQ school row while the coach's visits and school assignments are real. IS DISTINCT FROM keeps
-- rows whose role is NULL, which `<> 'coach'` would silently drop.
--
-- rule 1: the account's school is a heuristic test school (schools.is_probable_test)
SELECT u.id::text AS id, 'probable_test_school' AS rule
FROM users u
JOIN schools s ON s.id = u.school_id
WHERE s.is_probable_test AND u.is_test_user = false AND u.deleted_at IS NULL
  AND u.role IS DISTINCT FROM 'coach'
UNION ALL
-- rule 2: the account's name says so
SELECT u.id::text, 'name_pattern'
FROM users u
WHERE u.is_test_user = false
  AND u.name ~* '(^|[^a-z])(test|testing|dummy|demo|xyz|sample)([^a-z]|$)'
UNION ALL
-- rule 3: NIETE HQ accounts (data team ask, 2026-10-27): the school row is "NIETE, H-9" (two rows) or
-- "NIETE1, H-9", or there is no school row and the typed school name says the same.
SELECT u.id::text, 'niete_h9_hq'
FROM users u
WHERE u.is_test_user = false AND u.deleted_at IS NULL
  AND u.role IS DISTINCT FROM 'coach'
  AND (u.school_id IN (SELECT id FROM schools WHERE name ~* '^\s*niete1?\s*,\s*h-?\s?9\s*$')
       OR (u.school_id IS NULL AND u.school_name ~* '^\s*niete1?\s*,\s*h-?\s?9\s*$'))
