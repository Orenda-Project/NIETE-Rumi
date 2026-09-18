-- bd-60118 — options that are pictures.
--
-- I-SAPS M1 summative item 1.6 ships its four choices as ONE embedded image (a
-- 2x2 grid of lesson-plan drafts). There is no option text, so the item
-- imported with `options: []` and could not be answered at all.
--
-- The panels are split, stamped with their option NUMBER, uploaded to R2 and
-- sent as their own image messages ahead of the question. This column holds
-- those URLs, in option order: element 0 is option 1.
--
-- Additive and nullable ON PURPOSE. NULL / [] means "text options", which is
-- every other question in the system — no backfill, and no existing row changes
-- behaviour. `options` stays authoritative for text; a question never uses both.
BEGIN;

ALTER TABLE training_questions
  ADD COLUMN IF NOT EXISTS option_images jsonb;

COMMENT ON COLUMN training_questions.option_images IS
  'bd-60118: ordered option-panel image URLs (index 0 = option 1). NULL/[] => text options.';

COMMIT;
