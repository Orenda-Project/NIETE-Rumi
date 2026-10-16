-- Rollback of web_quiz_challenge_passages_provenance.sql: drops the provenance column and its CHECK, and narrows the
-- licence CHECK back. Narrowing fails while a row has licence 'published_instrument'; change or remove those rows first.
BEGIN;
ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_provenance_check,
  DROP COLUMN IF EXISTS provenance;
ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_licence_check,
  ADD CONSTRAINT challenge_passages_licence_check
    CHECK (licence IN ('textbook', 'cc_by', 'cc_by_sa', 'generated'));
COMMIT;
