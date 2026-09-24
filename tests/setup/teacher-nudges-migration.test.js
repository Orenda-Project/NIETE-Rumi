/**
 * V1.5.3__teacher_nudges.sql — the table every scheduled teacher nudge lives in.
 *
 * The migration is asserted as TEXT because that is the only artefact this repo
 * owns: the runner (`infrastructure/scripts/migrate.js`) reads the file and
 * hands it to `exec_sql`, so a typo in a CHECK list or a missing IF NOT EXISTS
 * is discovered on the database, after the fact, in whichever environment ran
 * it first. These assertions are the pre-flight.
 *
 * What is pinned, and why each one:
 *   C1  the two `kind` values — pre-merge Class C (a new enum value that never
 *       reached the CHECK constraint is an insert that fails in production only)
 *   C2  the six `status` values, and NOTHING else: the sweeper's claim
 *       (pending → sending) and every terminal mark are those words exactly
 *   C3  UNIQUE (user_id, nudge_date, kind) — this is what makes cohort building
 *       idempotent across five worker replicas. Without it the
 *       second replica's insert succeeds and a teacher is asked twice.
 *   C4  the partial index the sweeper's due-scan actually uses
 *   C5  idempotency — the file is re-runnable; the runner's ledger is behind the
 *       files on sandbox (1.3.6 vs 1.5.1), so a re-application is expected
 *   C6  a `-- down` block, commented, so the rollback is written down before it
 *       is needed rather than improvised during an incident
 *   C7  the runner's own filename gate accepts this file
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..',
  'infrastructure', 'supabase', 'migrations', 'V1.5.3__teacher_nudges.sql',
);

describe('V1.5.3__teacher_nudges.sql', () => {
  let sql;

  beforeAll(() => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    sql = fs.readFileSync(MIGRATION, 'utf-8');
  });

  /** The body of `CHECK (<col> IN (...))` as an array of the quoted literals. */
  function checkValues(column) {
    const re = new RegExp(`${column}[\\s\\S]{0,120}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i');
    const m = sql.match(re);
    if (!m) return null;
    return (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''));
  }

  test('C0 creates the teacher_nudges table, idempotently', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+teacher_nudges\s*\(/i);
  });

  test('C1 kind CHECK lists exactly the two nudge kinds this build ships', () => {
    expect(checkValues('kind')).toEqual(['coaching_after_lp', 'lp_quiz_offer']);
  });

  test('C2 status CHECK lists exactly the six states, and defaults to pending', () => {
    expect(checkValues('status')).toEqual(
      ['pending', 'sending', 'sent', 'failed', 'skipped', 'expired'],
    );
    expect(sql).toMatch(/status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i);
  });

  test('C3 UNIQUE (user_id, nudge_date, kind) — one nudge of a kind per teacher per day', () => {
    expect(sql).toMatch(
      /CONSTRAINT\s+teacher_nudges_one_per_day\s+UNIQUE\s*\(\s*user_id\s*,\s*nudge_date\s*,\s*kind\s*\)/i,
    );
  });

  test('C4 the due index is PARTIAL on status = pending, and there is a per-teacher recency index', () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+teacher_nudges_due\s+ON\s+teacher_nudges\s*\(\s*scheduled_at\s*\)\s*WHERE\s+status\s*=\s*'pending'/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+teacher_nudges_user_recent\s+ON\s+teacher_nudges\s*\(\s*user_id\s*,\s*nudge_date\s+DESC\s*\)/i,
    );
  });

  test('C4b the foreign keys carry the right delete behaviour', () => {
    // A deleted teacher takes their nudges with them.
    expect(sql).toMatch(/user_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    // A deleted quiz must NOT delete the record that the teacher was asked.
    expect(sql).toMatch(/quiz_id\s+uuid\s+REFERENCES\s+quizzes\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });

  test('C5 every DDL statement is re-runnable (IF NOT EXISTS on the table and both indexes)', () => {
    const creates = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .match(/CREATE\s+(TABLE|INDEX)[^;]*/gi) || [];
    expect(creates.length).toBeGreaterThanOrEqual(3);
    for (const stmt of creates) {
      expect(stmt).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });

  test('C6 carries a commented -- down block that drops both indexes and the table', () => {
    const down = sql.slice(sql.search(/--\s*down/i));
    expect(down.length).toBeGreaterThan(0);
    expect(down).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+teacher_nudges_due/i);
    expect(down).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+teacher_nudges_user_recent/i);
    expect(down).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+teacher_nudges/i);
    // …and every line of it is a comment, so applying the file never drops anything.
    for (const line of down.split('\n')) {
      if (line.trim() === '') continue;
      expect(line.trim().startsWith('--')).toBe(true);
    }
  });

  test('C7 the migration runner accepts the filename and reads 1.5.3 from it', () => {
    const { MigrationRunner } = require('../../infrastructure/scripts/migrate');
    const runner = new MigrationRunner({
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
      migrationsDir: path.dirname(MIGRATION),
    });
    const filename = path.basename(MIGRATION);
    expect(runner.extractVersion(filename)).toBe('1.5.3');
    // …and the directory scan's own filter accepts it (the runner filters twice).
    expect(/^V\d+\.\d+\.\d+__.*\.sql$/.test(filename)).toBe(true);
    // No other file claims 1.5.3. The ledger is keyed by version alone, so a second
    // file carrying the same number would be reported "already applied" and never run.
    //
    // (This used to assert that 1.5.3 sorts after EVERY other file, which was true the
    // day it was written and stopped being true the moment the next migration landed.
    // Uniqueness is the property that stays true, and it is the one the runner needs.)
    const versions = fs.readdirSync(path.dirname(MIGRATION))
      .filter((f) => /^V\d+\.\d+\.\d+__.*\.sql$/.test(f) && f !== filename)
      .map((f) => runner.extractVersion(f));
    expect(versions).not.toContain('1.5.3');
    // …and it still sorts after the migration before it.
    expect(versions).toContain('1.5.2');
    expect(runner.compareVersions('1.5.3', '1.5.2')).toBeGreaterThan(0);
  });
});
