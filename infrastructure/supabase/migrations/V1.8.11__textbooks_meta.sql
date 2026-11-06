-- V1.8.11 — textbooks.meta: where a book's rows came from and how far to trust them (bd-5jmnfj.38, G6–12 import).
-- Flyway-style versioned migration (D8). Applied to sandbox (olvritwoqujtjvwfulbh), then staging (rpqkekcfvumypldbejhp),
-- through MigrationRunner.applyMigration ALONE; to prod (ihzciabopbttygxxgrkm) only with the operator's go.
-- Rollback: ROLLBACK_V1.8.11__textbooks_meta.sql. If another PR takes V1.8.11 first, renumber both files (ledger is keyed
-- by version alone).
--
-- WHY. Grades 6–12 are imported from the held page-truth corpus (scripts/assessment/corpus_import.py), not from
-- fde_staging. The importer records {source, stem, pages_flagged, pages_low_conf, content_hash} per book so that
-- (1) a re-run with the same content is a no-op (content_hash), (2) --verify can prove a tier holds exactly what the
-- corpus says, and (3) downstream lanes can see per-book OCR risk. The hash is written LAST, after pages and TOC, so a
-- crashed run is detected and repaired on the next one.
-- WHY A COLUMN, NOT A TABLE (root rule 15). One value per textbooks row, read only with that row.
-- BEHAVIOUR. Additive only. Existing G1–5 rows get '{}' and nothing reads this column on their path.
-- DATA CLASSIFICATION (D6): '[Internal]' — import provenance and counts, no person data.
-- OWNER (D7): NIETE-Rumi assessment generator (bd-5jmnfj.38). STEWARD: Hataf Atif.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS. ORDER: before the first corpus import (the importer PATCHes meta).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TABLE public.textbooks ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.textbooks.meta IS
  'Import provenance (G6-12 corpus path): {source, stem, pages_flagged, pages_low_conf, content_hash}. {} for G1-5 rows.';
