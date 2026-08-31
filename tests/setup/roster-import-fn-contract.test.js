/**
 * The roster bulk-write lives in the DATABASE, not in JS — one function, one
 * transaction, serialized per class, idempotent per run.
 *
 * WHY. On its first live day /roster duplicated 460 children across 24 classes.
 * The save took 25-38s (2N sequential round-trips), coaches pressed Save again,
 * and every pass re-read the class before any other pass had committed — so the
 * in-code dedupe saw an empty class every time. A JS-side guard cannot fix a
 * concurrency bug between two server instances; only the database can.
 *
 * This test pins the migration's non-negotiables so a later edit cannot quietly
 * drop one: the advisory lock (serialization), the run-id guard (idempotency),
 * the conflict-proof enrolment insert, the count maintenance, the privilege
 * revoke (a PUBLIC-executable SECURITY DEFINER function is an open door), and
 * the PostgREST schema reload (psql success is not PostgREST success).
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'roster_import_students.sql'
);

describe('roster_import_students migration contract', () => {
  it('exists where migrations live', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = () => fs.readFileSync(MIGRATION, 'utf8');

  it('serializes per class with a transaction-scoped advisory lock', () => {
    expect(sql()).toMatch(/pg_advisory_xact_lock/);
    expect(sql()).toMatch(/lock_timeout/);
  });

  it('is idempotent on the run id — a run writes at most once, ever', () => {
    expect(sql()).toMatch(/import_run_id\s*=\s*p_run_id/);
    expect(sql()).toMatch(/'replay'/);
  });

  it('adds the provenance column and its partial index', () => {
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS import_run_id/i);
    expect(sql()).toMatch(/idx_students_import_run/);
  });

  it('cannot double-enrol even if a future edit breaks the dedupe', () => {
    expect(sql()).toMatch(/ON CONFLICT\s*\(class_id,\s*student_id\)/i);
  });

  it('maintains the legacy list count it touches', () => {
    expect(sql()).toMatch(/student_count/);
  });

  it('is not callable by anon — REVOKE then a service_role-only GRANT', () => {
    expect(sql()).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/i);
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
  });

  it('tells PostgREST the schema changed', () => {
    expect(sql()).toMatch(/notify pgrst/i);
  });
});
