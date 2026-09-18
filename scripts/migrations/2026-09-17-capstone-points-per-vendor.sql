-- bd-60113 — per-vendor capstone answer scale.
--
-- Beacon House scores each open-ended capstone answer 0-5 (a module constant
-- since bd-2233). Every I-SAPS CRQ is worth 10 marks against its own printed
-- rubric, so a teacher shown a 10-mark rubric must not be marked out of 5.
--
-- Additive and nullable ON PURPOSE: NULL means "use the historical default of
-- 5", so Beacon House and Oxbridge keep their exact current behaviour without
-- a backfill. pointsPerQuestionFor() (bot/shared/services/training/
-- capstone-points.rules.js) treats NULL, 0, negatives, fractions and anything
-- over 100 as "fall back to 5" — a zero or negative scale would make every
-- capstone unpassable.
BEGIN;

ALTER TABLE training_vendors
  ADD COLUMN IF NOT EXISTS capstone_points_per_question smallint;

COMMENT ON COLUMN training_vendors.capstone_points_per_question IS
  'bd-60113: points per open-ended capstone answer. NULL => default 5.';

-- I-SAPS CRQs are 10 marks each (I-SAPS assessment doc, section 4.2).
UPDATE training_vendors
   SET capstone_points_per_question = 10
 WHERE key = 'ISAPS'
   AND capstone_points_per_question IS DISTINCT FROM 10;

COMMIT;
