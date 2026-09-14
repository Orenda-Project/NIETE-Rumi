-- bd-60092 · Backfill `users.name` from the split columns, before they are dropped.
--
-- This is the IN-DATABASE half of the backfill. It rescues the people whose
-- `name` is empty but whose first/last columns still hold something.
--
-- Measured on NIETE prod (ihzciabopbttygxxgrkm) 2026-09-14, 14,574 users:
--   · 9,037 already have a `name`            -> untouched
--   ·    43 have an empty `name` that first+last CAN fill  -> this migration
--   · 5,494 have NOTHING in any of the three -> untouched here; 1,596 of them
--     are recoverable from fde_production.users_user by phone, which is a
--     separate scripted backfill (scripts/backfill-names-from-fde.js) because
--     it crosses databases and cannot run as SQL in this one.
--
-- Deliberately NOT `first_name || ' ' || last_name` for everyone: `name` is the
-- fuller column (8,876 populated vs 4,306 for last_name), and 6,820 people have
-- a one-word first_name beside a multi-word name. Overwriting `name` with the
-- concatenation would SHORTEN 4,069 names and blank 1,525 outright.
--
-- Idempotent: re-running changes nothing, because the WHERE clause only matches
-- rows that still have an empty name.

BEGIN;

UPDATE users
SET    name = NULLIF(
         TRIM(REGEXP_REPLACE(
           CONCAT_WS(' ', NULLIF(TRIM(first_name), ''), NULLIF(TRIM(last_name), '')),
           '\s+', ' ', 'g')),
         ''
       )
WHERE  COALESCE(TRIM(name), '') = ''
  AND  (COALESCE(TRIM(first_name), '') <> '' OR COALESCE(TRIM(last_name), '') <> '');

COMMIT;
