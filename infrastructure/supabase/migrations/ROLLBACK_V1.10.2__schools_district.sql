-- Rollback for V1.10.2 (bd-97daxo.33). Drops schools.district and every district loaded into it.
-- Safe with the code that reads it: the dashboard's district read (dashboard/lib/analytics-areas loadPlacement) falls
-- back to "no district" when the column is missing, so a Moawin view shows every school under Area not set. Keep the
-- loader's undo file if the districts are to be loaded again.
ALTER TABLE schools DROP COLUMN IF EXISTS district;
NOTIFY pgrst, 'reload schema';
