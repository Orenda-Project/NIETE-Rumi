-- V1.2.4 — mark `leader_teachers` deprecated, in the database itself.
--
-- No data changes, no schema changes. A COMMENT, so that anyone who opens this
-- table in a client, an ERD, or an information_schema query learns that it no
-- longer decides anything — rather than reasoning from 7,954 healthy-looking
-- rows that it must be authoritative.
--
-- That inference is exactly the failure mode worth preventing. The table is
-- populated, actively written, correctly indexed and completely unconsulted.
-- Nothing about its shape says so.

COMMENT ON TABLE leader_teachers IS
  'DEPRECATED — do not read, do not add callers. '
  'Stored one row per (coach, school, teacher) and answered both "who does this '
  'coach coach?" and, for want of a roster table, "who teaches at this school?". '
  'Both are now derived: leader_schools x users.school_id. The stored answer and '
  'the schools disagreed on 230 rows; a join cannot disagree with itself. '
  'Still WRITTEN by the school add/remove path, which is the only thing that '
  'reads the rows back — maintained for its own sake. '
  'Delete when: coach observation has run on the derived patch long enough to '
  'trust it; leader_roster_audit carries real coach-driven rows; and the 7 '
  'teachers held by a coach with no users.school_id have been given one (until '
  'then this table is the only record that they belong to anybody). '
  'Dropping it also retires extIdIsAmbiguous() and the niete:607 / niete:628 '
  'guards, which exist only because the old text join could not tell two '
  'schools apart and the foreign key can.';

COMMENT ON COLUMN leader_teachers.school_ext_id IS
  'DEPRECATED with the table. The text key (''niete:'' || emis) that every join '
  'used to run on. leader_schools.school_id is the real foreign key and is now '
  'populated on 490 of 495 rows.';

COMMENT ON COLUMN leader_teachers.leader_user_id IS
  'DEPRECATED with the table. Which coach held this teacher. Superseded by the '
  'derivation: whoever holds the school holds the teacher.';

-- ── verify ─────────────────────────────────────────────────────────────
--   SELECT obj_description('leader_teachers'::regclass);   -- the notice above
--   SELECT count(*) FROM leader_teachers;                  -- unchanged
