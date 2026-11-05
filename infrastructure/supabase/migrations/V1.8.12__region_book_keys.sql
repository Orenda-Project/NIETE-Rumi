-- V1.8.12 — a region names its books: region_features.book_keys (bd-97daxo.4, GB book-first).
-- Flyway-style versioned migration (D8). Applied to sandbox (olvritwoqujtjvwfulbh), then staging (rpqkekcfvumypldbejhp),
-- through MigrationRunner.applyMigration ALONE; to prod (ihzciabopbttygxxgrkm) only with the operator's go.
-- Rollback: ROLLBACK_V1.8.12__region_book_keys.sql.
--
-- WHY. The operator, 2 Nov: "map the lesson plans not to GB region but to books". Gilgit-Baltistan teaches Grades 1-5
-- from NBF books for English, Urdu, Maths and Science and from ICT's English-medium GK and Social Studies and ICT's
-- Islamiat (Amena's GB Curriculum Matrix, Books tab). So a region carries the LIST of books its teachers use, by
-- lp_catalog.json book key (gb_g1_english, grade_1_islamiat, ...). A subject whose book is not on the list is not on
-- the menu; nothing falls back to another region's book.
-- WHY A COLUMN ON region_features, NOT A TABLE (root rule 15). region_features is already one row per region and the
-- registry (V1.8.8) already reads it; a region->book link table would hold the same key and nothing else.
-- BEHAVIOUR. NULL (every row, after this migration) = today's ICT list: every catalog book that is not opt_in. So
-- applying it changes no teacher's menu. The GB row's list is written by `bot/scripts/sync-sheet-lps.js --config gb
-- --books --commit`, per environment (prod with the operator's go).
-- DATA CLASSIFICATION (D6): '[Internal]' — region configuration, no person data.
-- OWNER (D7): NIETE-Rumi platform (bd-97daxo). STEWARD: Hataf Atif.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS. ORDER: before the code is useful, but the code reads it fail-open (a missing
-- column is the ICT list), so either order is safe.

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TABLE region_features ADD COLUMN IF NOT EXISTS book_keys TEXT[];

COMMENT ON COLUMN region_features.book_keys IS
  'The Grade 1-5 books this region''s teachers use, as lp_catalog.json book keys (e.g. gb_g1_english, grade_1_islamiat). NULL = the default ICT list (every book not marked opt_in). Written by bot/scripts/sync-sheet-lps.js --books.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT region, book_keys FROM region_features ORDER BY organization NULLS FIRST, sort_order;
--              -- every row NULL until sync-sheet-lps --books runs
