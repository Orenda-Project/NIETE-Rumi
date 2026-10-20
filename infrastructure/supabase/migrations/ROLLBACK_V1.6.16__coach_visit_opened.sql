-- Reverse of V1.6.16. Drops coach_visit_requests.opened_at.
-- destructive: reviewed — opened_at only records when a coach first opened a card; losing it brings back
-- the blue dot on cards already opened, nothing else reads it.
-- SAFE ONLY after the code is rolled back: the list selects opened_at and the card route writes it.
-- Roll the CODE back first. Idempotent.
ALTER TABLE coach_visit_requests DROP COLUMN IF EXISTS opened_at;
NOTIFY pgrst, 'reload schema';
