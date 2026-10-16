/**
 * A column added to an existing table by `ADD COLUMN … REFERENCES t(…)` must
 * come after `CREATE TABLE t`. 00_complete-schema.sql runs top to bottom on a
 * fresh project (a new clone, a CI schema load), so a forward reference stops
 * the whole load with `relation "t" does not exist`. A live database never
 * notices, because the table is already there; only a fresh build breaks.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql');

const CREATE_RX = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/i;
const ADD_REF_RX = /add\s+column\s+.*references\s+(?:public\.)?"?(\w+)"?\s*\(/i;

/** Every `ADD COLUMN … REFERENCES t(` line that comes before t's CREATE TABLE. */
function forwardReferences(sql) {
  const created = new Set();
  const bad = [];
  sql.split('\n').forEach((line, i) => {
    const code = line.replace(/--.*$/, '');
    const made = code.match(CREATE_RX);
    if (made) created.add(made[1].toLowerCase());
    const ref = code.match(ADD_REF_RX);
    if (ref && !created.has(ref[1].toLowerCase())) bad.push(`${i + 1}: ${ref[1]}`);
  });
  return bad;
}

describe('00_complete-schema.sql forward references', () => {
  test('the checker sees a forward reference and passes one after the table', () => {
    expect(forwardReferences([
      'alter table kids add column school_id uuid references schools(id);',
      'CREATE TABLE IF NOT EXISTS schools (id uuid);',
    ].join('\n'))).toEqual(['1: schools']);
    expect(forwardReferences([
      'CREATE TABLE IF NOT EXISTS schools (id uuid);',
      'ALTER TABLE kids ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);',
    ].join('\n'))).toEqual([]);
  });

  test('no ADD COLUMN references a table that is created further down', () => {
    expect(forwardReferences(fs.readFileSync(SCHEMA_PATH, 'utf8'))).toEqual([]);
  });
});
