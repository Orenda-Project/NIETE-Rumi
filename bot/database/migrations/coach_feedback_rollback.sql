-- Migration rollback for coach_feedback.sql (bd-whlsm0).
-- destructive: reviewed. Drops the coach "Report an issue" table and every report in it. Export the rows first if any
-- were sent; nothing else reads or references this table.

DROP TABLE IF EXISTS public.coach_feedback;
