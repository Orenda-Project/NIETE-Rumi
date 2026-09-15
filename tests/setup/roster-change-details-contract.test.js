/**
 * The class-details writer's migration contract: the same non-negotiables as the
 * other roster writers (one transaction, the same per-class lock, service_role
 * only, the actor into the ledger, nothing deleted), plus this function's own:
 * a collision is answered, not merged, unless p_merge says so; a merge closes the
 * source with a reason (merged_into_class_id) and locks both classes in id order.
 */
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '..', '..', 'bot', 'database', 'migrations', 'roster_change_class_details.sql');
const SCHEMA = path.join(__dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');

describe('roster_change_class_details migration contract', () => {
  const sql = () => fs.readFileSync(MIGRATION, 'utf8');

  it('exists, and the canonical schema carries the function and the column', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    expect(schema).toMatch(/CREATE OR REPLACE FUNCTION public\.roster_change_class_details\(/);
    expect(schema).toMatch(/ADD COLUMN IF NOT EXISTS merged_into_class_id uuid REFERENCES public\.classes\(id\)/);
  });

  it('adds exactly one nullable column, additively', () => {
    const adds = [...sql().matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(adds).toEqual(['merged_into_class_id']);
    const addLine = sql().split('\n').find((l) => /ADD COLUMN IF NOT EXISTS merged_into_class_id/.test(l));
    expect(addLine).not.toMatch(/NOT NULL|DEFAULT/);
  });

  it('serializes on the SAME per-class lock as the other writers, and locks both classes in id order when merging', () => {
    expect(sql()).toMatch(/pg_advisory_xact_lock\(hashtextextended\('roster_import:' \|\| p_class_id::text/);
    expect(sql()).toMatch(/v_first/);
    expect(sql()).toMatch(/v_second/);
    expect(sql()).toMatch(/lock_timeout/);
  });

  it('stamps the acting user into app.actor for the ledger', () => {
    expect(sql()).toMatch(/set_config\('app\.actor',\s*p_actor::text,\s*true\)/);
  });

  it('answers a collision without writing, and only merges on p_merge', () => {
    expect(sql()).toMatch(/IF NOT p_merge THEN[\s\S]*'collision'/);
  });

  it('a merge closes the duplicate enrolment as a roster_correction and the source class with a reason', () => {
    expect(sql()).toMatch(/outcome = 'roster_correction'/);
    expect(sql()).toMatch(/merged_into_class_id = v_target\.id/);
    expect(sql()).not.toMatch(/outcome = 'left'/);
  });

  it('never deletes', () => {
    expect(sql()).not.toMatch(/\bDELETE\b/i);
  });

  it('is service_role-only and tells PostgREST', () => {
    expect(sql()).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/i);
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
    expect(sql()).toMatch(/notify pgrst/i);
  });
});
