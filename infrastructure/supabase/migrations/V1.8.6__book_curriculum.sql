-- V1.8.6 — book curriculum: assessment_topics and niete_lp612_segments say whose curriculum they belong to, and
-- Gilgit-Baltistan's books are NBF's (curriculum_key 'nbf_snc') (bd-97daxo.4/.5).
-- Flyway-style versioned migration (D8). Applied to sandbox (olvritwoqujtjvwfulbh), then staging (rpqkekcfvumypldbejhp),
-- through MigrationRunner.applyMigration ALONE; to prod (ihzciabopbttygxxgrkm) only with the operator's go.
-- Rollback: ROLLBACK_V1.8.6__book_curriculum.sql.
--
-- WHY. A teacher gets her region's curriculum book where that curriculum has one for the grade and subject, and ICT's
-- otherwise (book-curriculum.service.js). textbooks already carries `curriculum`; the two other stores a book is picked
-- from do not: assessment_topics (keyed grade/subject/chapter_number — chapter 3 of NBF's book is not chapter 3 of
-- ICT's) and niete_lp612_segments (the grades 6-12 menu). With the column, NBF's books later are data only: rows tagged
-- 'nbf_snc', no code change. Grades 1-5 lesson plans are a static file (bot/data/lp_catalog.json) whose book entries
-- carry the same tag; no table changes for them.
-- GB'S KEY (operator, 2026-10-30). GB uses National Book Foundation books for grades 1-5 Maths, English and Urdu and
-- grades 4-5 Science; every other grade+subject is ICT's book. NIETE already names NBF content 'nbf_snc'
-- (curriculum_lp_ast.curriculum_key), so V1.8.5's 'gb' becomes 'nbf_snc'. V1.8.5 is applied on sandbox and is not
-- edited; the rename is here. Which pairs differ is never listed in code — the loaded nbf_snc books decide.
-- WHY COLUMNS, NOT A TABLE (root rule 15): the tag is a property of each row; a mapping table would key the same rows.
-- BEHAVIOUR. Every existing row is ICT's, so NOT NULL DEFAULT 'ict' is the backfill: an ICT read filtered on
-- curriculum = 'ict' returns exactly the rows it returned before. No textbooks/segments/topics row is nbf_snc yet, so a
-- GB teacher still gets ICT's book everywhere. No index: every read that filters curriculum also filters
-- grade+subject (idx_assessment_topics_current, idx_lp612_segments_menu) and ICT is today the only value.
-- DATA CLASSIFICATION (D6): '[Internal]' — curriculum metadata and region configuration, no person data.
-- OWNER (D7): NIETE-Rumi platform (bd-97daxo). STEWARD: Hataf Atif.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; the UPDATE matches only a row still on 'gb'.
-- ORDER: after V1.8.5, before the code (the topic and 6-12 menu reads filter on these columns).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TABLE assessment_topics ADD COLUMN IF NOT EXISTS curriculum TEXT NOT NULL DEFAULT 'ict';
ALTER TABLE niete_lp612_segments ADD COLUMN IF NOT EXISTS curriculum TEXT NOT NULL DEFAULT 'ict';

COMMENT ON COLUMN assessment_topics.curriculum IS
  'Whose book these topics belong to (textbooks.curriculum: ict, nbf_snc, ...). A non-ICT topic_id starts with its curriculum (nbf_snc_...).';
COMMENT ON COLUMN niete_lp612_segments.curriculum IS
  'Whose book this segment belongs to (ict, nbf_snc, ...). A teacher gets her region''s curriculum segments for a grade+subject where any exist, ICT''s otherwise. A non-ICT book_stem starts with its curriculum (nbf_snc_...).';

UPDATE region_features SET curriculum_key = 'nbf_snc', updated_at = now()
 WHERE region = 'gilgit-baltistan' AND curriculum_key = 'gb';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT curriculum, count(*) FROM assessment_topics GROUP BY 1;     -- one row: ict
--              SELECT curriculum, count(*) FROM niete_lp612_segments GROUP BY 1;  -- one row: ict
--              SELECT region, curriculum_key FROM region_features WHERE region = 'gilgit-baltistan';  -- nbf_snc
