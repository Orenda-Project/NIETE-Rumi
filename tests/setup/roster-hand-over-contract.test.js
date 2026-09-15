/**
 * The hand-over writer's migration contract — the same non-negotiables as the
 * import and the edit (one transaction, the SAME per-class lock, service_role
 * only), plus the two this function adds: the acting user reaches the
 * row-history ledger, and nothing is ever deleted.
 */
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'roster_hand_over_class.sql');
const SCHEMA = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');

describe('roster_hand_over_class migration contract', () => {
  it('exists, and the canonical schema carries the same function', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    expect(fs.readFileSync(SCHEMA, 'utf8')).toMatch(/CREATE OR REPLACE FUNCTION public\.roster_hand_over_class\(/);
  });
  const sql = () => fs.readFileSync(MIGRATION, 'utf8');

  it('serializes on the SAME per-class lock as the import and the edit', () => {
    expect(sql()).toMatch(/pg_advisory_xact_lock\(hashtextextended\('roster_import:'/);
    expect(sql()).toMatch(/lock_timeout/);
  });

  it('stamps the acting user into app.actor for the ledger, transaction-local', () => {
    expect(sql()).toMatch(/set_config\('app\.actor',\s*p_actor::text,\s*true\)/);
  });

  it('is scoped to the school it is given, and refuses a leader as class teacher', () => {
    expect(sql()).toMatch(/'wrong_school'/);
    expect(sql()).toMatch(/'not_a_teacher'/);
  });

  it('adopts a same-name legacy list rather than inserting a duplicate', () => {
    expect(sql()).toMatch(/lower\(class_name\)\s*=\s*lower\(v_label\)/);
  });

  it('retires mirrors — never deletes anything', () => {
    expect(sql()).toMatch(/SET is_active = false/);
    expect(sql()).not.toMatch(/\bDELETE\b/i);
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
