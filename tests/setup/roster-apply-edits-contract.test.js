/**
 * The edit writer's migration contract. Same non-negotiables as the import
 * function — and one more: it takes the SAME advisory lock key as
 * roster_import_students, because an edit racing an import on one class is the
 * exact concurrency shape that produced 460 duplicate children on launch day.
 */
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'roster_apply_edits.sql');

describe('roster_apply_edits migration contract', () => {
  it('exists', () => { expect(fs.existsSync(MIGRATION)).toBe(true); });
  const sql = () => fs.readFileSync(MIGRATION, 'utf8');

  it('serializes on the SAME per-class lock as the import', () => {
    expect(sql()).toMatch(/pg_advisory_xact_lock\(hashtextextended\('roster_import:'/);
    expect(sql()).toMatch(/lock_timeout/);
  });

  it('replays are refused via the run id, so a double-tapped Save cannot double-add', () => {
    expect(sql()).toMatch(/import_run_id\s*=\s*p_run_id/);
    expect(sql()).toMatch(/'replay'/);
  });

  it('removes CLOSE enrolments — never delete (cascade would eat attendance)', () => {
    expect(sql()).toMatch(/is_active = false/i);
    expect(sql()).not.toMatch(/DELETE FROM class_enrollments/i);
    expect(sql()).not.toMatch(/DELETE FROM students/i);
  });

  it('maintains the legacy list count from truth', () => {
    expect(sql()).toMatch(/student_count/);
  });

  it('is service_role-only', () => {
    expect(sql()).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/i);
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
  });

  it('tells PostgREST', () => { expect(sql()).toMatch(/notify pgrst/i); });
});
