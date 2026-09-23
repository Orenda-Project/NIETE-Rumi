/**
 * coaching_sessions carries four observe columns on every live database
 * (observation_type, observer_user_id, autofill_analysis_data, debrief_status) that no
 * migration in this repo declared. The reference schema must describe the table the code
 * writes to, and the migration must be a no-op where the columns already exist.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIG = path.join(ROOT, 'infrastructure', 'supabase', 'migrations',
  'V1.5.4__coaching_sessions_observe_columns.sql');
const SCHEMA = path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql');
const COLS = ['observation_type', 'observer_user_id', 'autofill_analysis_data', 'debrief_status'];

describe('coaching_sessions observe columns are declared in the repo', () => {
  test('the migration adds each column idempotently, comments it, and carries no transaction control', () => {
    expect(fs.existsSync(MIG)).toBe(true);
    const sql = fs.readFileSync(MIG, 'utf8');
    for (const c of COLS) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE coaching_sessions\\s+ADD COLUMN IF NOT EXISTS ${c}\\b`));
      expect(sql).toMatch(new RegExp(`COMMENT ON COLUMN coaching_sessions\\.${c} IS`));
    }
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_coaching_sessions_observer_pending/);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });

  test('the reference schema declares each column on coaching_sessions', () => {
    const sql = fs.readFileSync(SCHEMA, 'utf8');
    for (const c of COLS) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS ${c}\\b`));
    }
  });
});
