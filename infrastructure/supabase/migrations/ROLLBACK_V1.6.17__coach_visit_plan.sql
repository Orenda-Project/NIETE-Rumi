-- Reverse of V1.6.17. Drops coach_visit_requests.coach_plan.
-- destructive: reviewed — loses the coaches' step-4 choices, the DC-team flags and the cached AI suggestions.
-- SAFE ONLY after the code is rolled back: the card selects coach_plan and the plan route writes it.
-- Roll the CODE back first. Idempotent.
ALTER TABLE coach_visit_requests DROP COLUMN IF EXISTS coach_plan;
NOTIFY pgrst, 'reload schema';
