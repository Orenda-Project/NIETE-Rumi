-- Reverse of V1.4.1. Additive column, so the reverse is a drop.
--
-- SAFE ONLY while no deployed code names the column: the worker writes `lint_version` on every
-- success patch, and the serving path SELECTs it on the cache-hit read. Roll the CODE back first.
--
-- Both sides degrade rather than break (the worker's PGRST204/42703 retry, findRender's 42703
-- fallback), so a drop under live code is a lost stamp and a loud event rather than an outage —
-- but every row then reads as `unstamped`, which is exactly the blindness bd-2cbwr was filed over.
--
-- THE DROP IS NOT REVERSIBLE BY RE-RUNNING V1.4.1. The stamps themselves are gone, and there is
-- nothing in the schema to recompute them from; re-adding the column brings back an empty one and
-- the whole table reads as the pre-migration backlog again.
ALTER TABLE niete_lp612_renders DROP COLUMN IF EXISTS lint_version;
NOTIFY pgrst, 'reload schema';
