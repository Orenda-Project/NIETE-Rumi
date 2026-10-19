-- Rollback of web_quiz_challenge_passages_licence_calib.sql: drops the five columns and narrows the licence CHECK back.
-- Narrowing fails while a row has licence 'partner_instrument' or 'public_domain'; change or remove those rows first.
-- The provenance column and its CHECK stay.
BEGIN;
ALTER TABLE public.challenge_passages
  DROP COLUMN IF EXISTS attribution,
  DROP COLUMN IF EXISTS adapted,
  DROP COLUMN IF EXISTS adaptation_note,
  DROP COLUMN IF EXISTS calib,
  DROP COLUMN IF EXISTS review;
ALTER TABLE public.challenge_passages
  DROP CONSTRAINT IF EXISTS challenge_passages_licence_check,
  ADD CONSTRAINT challenge_passages_licence_check
    CHECK (licence IN ('textbook', 'cc_by', 'cc_by_sa', 'generated', 'published_instrument'));
COMMIT;
