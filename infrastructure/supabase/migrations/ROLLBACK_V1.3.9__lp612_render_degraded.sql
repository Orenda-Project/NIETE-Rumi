-- Reverse of V1.3.9. Additive column, so the reverse is a drop.
-- SAFE ONLY while no deployed code names the column: the worker writes `render_degraded` on every
-- success patch, and the serving path SELECTs it on the cache-hit read. Roll the CODE back first.
ALTER TABLE niete_lp612_renders DROP COLUMN IF EXISTS render_degraded;
NOTIFY pgrst, 'reload schema';
