-- V1.8.10 — G6-12 exam generator: the subject codes its requests point at (G612 contract 2, §5).
--
-- assessment_requests.grade_code / subject_code are foreign keys to grade_levels(code) and
-- subjects(code) (V1.2.6). The grade 6-12 registry (bot/shared/services/assessment/subject-config.js)
-- uses ten subject codes the catalogue does not hold yet, so without these rows every G6-12 request
-- insert fails after the grade gate has already admitted the teacher.
--
-- Additive only: INSERT ... ON CONFLICT DO NOTHING. No existing row changes. Grades 1-5 never use
-- these codes. grade_levels 6-12 were seeded by V1.1.3; they are repeated here with the same values
-- so this file stands alone on a tier where V1.1.3's seed was trimmed (a no-op where they exist).
--
-- `general_science` is its own code for G6-8 because `science` stays the G4-5 code
-- (assessment-vocabulary.js GRADE_BANDS.science = [4, 5]). The `science` row already lists
-- 'general_science' among its aliases; nothing resolves subjects by alias today, and this file does
-- not edit that row.
--
-- Rollback (run by hand, only if no request references the rows):
--   DELETE FROM subjects s WHERE s.code IN ('general_science','computer_science','history','geography',
--     'zarai_taleem','physics','chemistry','biology','pakistan_studies','pakistan_studies_ur')
--     AND NOT EXISTS (SELECT 1 FROM assessment_requests r WHERE r.subject_code = s.code);
--   (grade_levels rows are left in place: V1.1.3 owns them.)

INSERT INTO grade_levels (code, ordinal, band, sort_order, aliases) VALUES
    ('grade_6',     6,  'middle',           6,  ARRAY['grade_6','Grade 6','Grade Six','6','6th']),
    ('grade_7',     7,  'middle',           7,  ARRAY['grade_7','Grade 7','Grade Seven','7','7th']),
    ('grade_8',     8,  'middle',           8,  ARRAY['grade_8','Grade 8','Grade Eight','8','8th']),
    ('grade_9',     9,  'high',             9,  ARRAY['grade_9','Grade 9','Grade Nine','9','9th']),
    ('grade_10',    10, 'high',             10, ARRAY['grade_10','Grade 10','Grade Ten','10','10th','Matric']),
    ('grade_11',    11, 'higher_secondary', 11, ARRAY['grade_11','Grade 11','Grade Eleven','11','11th','First Year','FSc I','Inter I']),
    ('grade_12',    12, 'higher_secondary', 12, ARRAY['grade_12','Grade 12','Grade Twelve','12','12th','Second Year','FSc II','Inter II'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO subjects (code, aliases, sort_order, is_active) VALUES
    ('general_science',     ARRAY['general_science', 'General Science'],                       80, TRUE),
    ('computer_science',    ARRAY['computer_science', 'Computer Science', 'Computer'],         81, TRUE),
    ('history',             ARRAY['history', 'History'],                                       82, TRUE),
    ('geography',           ARRAY['geography', 'Geography'],                                   83, TRUE),
    ('zarai_taleem',        ARRAY['zarai_taleem', 'Zarai Taleem', 'Agriculture'],              84, TRUE),
    ('physics',             ARRAY['physics', 'Physics'],                                       85, TRUE),
    ('chemistry',           ARRAY['chemistry', 'Chemistry'],                                   86, TRUE),
    ('biology',             ARRAY['biology', 'Biology'],                                       87, TRUE),
    ('pakistan_studies',    ARRAY['pakistan_studies', 'Pakistan Studies'],                     88, TRUE),
    ('pakistan_studies_ur', ARRAY['pakistan_studies_ur', 'Pakistan Studies (Urdu)'],           89, TRUE)
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
