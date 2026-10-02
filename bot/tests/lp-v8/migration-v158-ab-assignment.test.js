/**
 * bd-5o0ay.10.2 — V1.5.8 niete_lp_ab_assignment shape guard (TDD, red first).
 *
 * The draw (ICT NIETE/ab-test-ch310/workbench/randomise.py) is written here once, on launch
 * day: one row per programme school. No Postgres here, so these are static guards: re-runnable,
 * nothing destroyed, a school in one group only, and the group can only be A or B.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'infrastructure', 'supabase', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const statements = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--'))
  .join('\n').split(';').map((s) => s.trim()).filter(Boolean);

describe('V1.5.8 niete_lp_ab_assignment', () => {
  const sql = read('V1.5.8__niete_lp_ab_assignment.sql');
  const st = statements(sql);

  test('header justifies a new table (Rule 15)', () => {
    expect(sql).toMatch(/WHY A TABLE/);
    expect(sql).toMatch(/Rollback: ROLLBACK_V1\.5\.8__niete_lp_ab_assignment\.sql/);
  });

  test('is re-runnable', () => {
    expect(st.filter((s) => /^CREATE TABLE/i.test(s) && !/IF NOT EXISTS/i.test(s))).toEqual([]);
    expect(st.filter((s) => /^CREATE (UNIQUE )?INDEX/i.test(s) && !/IF NOT EXISTS/i.test(s))).toEqual([]);
  });

  test('destroys nothing', () => {
    expect(st.filter((s) => /^(DROP|TRUNCATE|DELETE)\b|DROP COLUMN/i.test(s))).toEqual([]);
  });

  test('one group per school, A or B only, seed and draw time kept', () => {
    expect(sql).toMatch(/school_id\s+UUID\s+PRIMARY KEY\s+REFERENCES schools\s*\(id\)/i);
    expect(sql).toMatch(/ab_group\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*ab_group IN \('A',\s*'B'\)\s*\)/i);
    expect(sql).toMatch(/seed\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/drawn_at\s+TIMESTAMPTZ\s+NOT NULL/i);
  });

  test('the flag starts off', () => {
    expect(sql).toMatch(/INSERT INTO app_settings[\s\S]*'ab_lp_ch310_enabled'[\s\S]*'false'[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/i);
  });

  test('rollback drops only what V1.5.8 added', () => {
    const rb = statements(read('ROLLBACK_V1.5.8__niete_lp_ab_assignment.sql'));
    expect(rb.every((s) => /niete_lp_ab_assignment|ab_lp_ch310_enabled|^BEGIN$|^COMMIT$/i.test(s))).toBe(true);
  });
});
