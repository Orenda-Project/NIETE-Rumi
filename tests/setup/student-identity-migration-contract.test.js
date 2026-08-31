/**
 * The child is a first-class entity: identified by OUR id, anchored to a school,
 * recognised (not identified) by the admission number the register prints.
 *
 * Three different things, and the distinction is the design:
 *   students.id      the IDENTITY — permanent, internal, everything FKs to it
 *   student_code     the HUMAN HANDLE — ours, exists even when the register gave
 *                    us nothing ("S-100234" in a support thread or a printed list)
 *   admission_no     a RECOGNITION attribute — school-issued, nullable, sometimes
 *                    written in the wrong column, never the identity
 *
 * Why not a name key: 18 same-name pairs were measured INSIDE single reviewed
 * registers (two Noor Fatimas in one Grade 1-A). Why nullable: real registers
 * were photographed with the admission column blank. Why school-scoped:
 * admission numbers are issued per school.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'student_identity.sql'
);

describe('student identity migration contract', () => {
  it('exists where migrations live', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = () => fs.readFileSync(MIGRATION, 'utf8');

  it('anchors the child to a school', () => {
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools\(id\)/i);
  });

  it('captures recognition data the registers actually carry', () => {
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS admission_no/i);
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS date_of_birth/i);
  });

  it('gives every child the platform’s own human handle', () => {
    expect(sql()).toMatch(/student_code_seq/);
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS student_code/i);
    expect(sql()).toMatch(/UPDATE students[\s\S]*student_code IS NULL/i);
  });

  it('models lifecycle and reversible merges, not deletes', () => {
    expect(sql()).toMatch(/status IN \('active','inactive','merged'\)/);
    expect(sql()).toMatch(/merged_into uuid REFERENCES students\(id\)/i);
  });

  it('backfills school_id from BOTH ownership paths', () => {
    expect(sql()).toMatch(/FROM class_enrollments/i);
    expect(sql()).toMatch(/FROM student_lists/i);
  });

  it('does NOT create the recognition unique index here — that ships after the duplicate sweep proves it clean', () => {
    expect(sql()).not.toMatch(/CREATE UNIQUE INDEX[^;]*admission_no/i);
  });

  it('replaces the import function with the recognising version, without leaving an ambiguous overload', () => {
    expect(sql()).toMatch(/DROP FUNCTION IF EXISTS public\.roster_import_students\(uuid, uuid, text, uuid, jsonb\)/i);
    expect(sql()).toMatch(/p_school_id uuid DEFAULT NULL/i);
  });

  it('tells PostgREST the schema changed', () => {
    expect(sql()).toMatch(/notify pgrst/i);
  });
});
