-- V1.9.5 — English-medium General Knowledge and Social Studies as their own subject codes (bd-uam6dh).
--
-- GK (G1-3) and SST (G4-5) each come in an Urdu-medium and an English-medium book. A teacher picks
-- the book she teaches from and gets that book's paper, so the English books are their own codes,
-- general_knowledge_en and social_studies_en. assessment_requests.subject_code is a foreign key to
-- subjects(code) (V1.2.6), so without these rows every English GK/SST request insert fails.
--
-- Additive only: INSERT ... ON CONFLICT DO NOTHING. No existing row changes. parent_code points at
-- the Urdu twin. The aliases carry the medium on purpose: class-vocabulary resolves a typed subject
-- by alias, and plain "General Knowledge" / "Social Studies" must keep resolving to the existing rows.
--
-- Rollback (run by hand, only if no request references the rows):
--   DELETE FROM subjects s WHERE s.code IN ('general_knowledge_en','social_studies_en')
--     AND NOT EXISTS (SELECT 1 FROM assessment_requests r WHERE r.subject_code = s.code);

INSERT INTO subjects (code, parent_code, aliases, sort_order, is_active) VALUES
    ('general_knowledge_en', 'general_knowledge', ARRAY['general_knowledge_en', 'General Knowledge (English)'], 90, TRUE),
    ('social_studies_en',    'social_studies',    ARRAY['social_studies_en', 'Social Studies (English)'],       91, TRUE)
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
