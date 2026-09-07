-- sections F–O — the closed vocabulary was seeded A–E and ICT schools run bigger.
--
-- WHY. On 7 Sep a coach at a school with TEN sections could not register anything past
-- E: the Section dropdown on /class and on /roster stops at E. Both pickers read this
-- table, and classes.section is a FOREIGN KEY to it (classes_section_fkey), so a section
-- that is not a row here cannot exist — that is the point of the closed vocabulary
-- (database-engineering §3.2: 32 spellings of 7 values is what free text produced), and
-- it is why the fix is a row, not a code change. No Flow asset changes: the dropdowns are
-- data-bound.
--
-- Fifteen, not ten: the operator asked for headroom. Sort order continues the seed.
-- Idempotent — safe to run on staging and prod, and again.

INSERT INTO sections (code, sort_order, is_active) VALUES
  ('F',  6, true), ('G',  7, true), ('H',  8, true), ('I',  9, true), ('J', 10, true),
  ('K', 11, true), ('L', 12, true), ('M', 13, true), ('N', 14, true), ('O', 15, true)
ON CONFLICT (code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- DOWN (only if no class references them):
--   DELETE FROM sections WHERE code IN ('F','G','H','I','J','K','L','M','N','O');
