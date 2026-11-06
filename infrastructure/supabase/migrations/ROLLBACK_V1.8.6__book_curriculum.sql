-- ROLLBACK_V1.8.6 — reverse of V1.8.6 book curriculum (bd-97daxo.4/.5), Flyway-style rollback applied by migrate.js.
-- destructive: reviewed — drops the curriculum tag from assessment_topics and niete_lp612_segments, and puts
-- Gilgit-Baltistan's curriculum_key back to V1.8.5's 'gb'. While every row is 'ict' nothing is lost. If an nbf_snc book
-- was loaded, delete its rows FIRST (they would otherwise read as ICT's).
-- Roll the CODE back first: topics.repo and the 6-12 menu reads filter on these columns.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

UPDATE region_features SET curriculum_key = 'gb', updated_at = now()
 WHERE region = 'gilgit-baltistan' AND curriculum_key = 'nbf_snc';

-- destructive: reviewed (see header)
ALTER TABLE assessment_topics DROP COLUMN IF EXISTS curriculum;
-- destructive: reviewed (see header)
ALTER TABLE niete_lp612_segments DROP COLUMN IF EXISTS curriculum;

NOTIFY pgrst, 'reload schema';
