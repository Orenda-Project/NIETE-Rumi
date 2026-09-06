'use strict';
/**
 * Every column that raw SQL reads from `schools` must be declared in the schema.
 *
 * column-completeness.test.js parses Supabase client chains — `.from('x')`,
 * `.select(...)`, `.insert({...})`. The dashboard's leader services do not use the
 * client; they pass raw SQL template strings to `pool.query`. So a raw-SQL column
 * reference is invisible to that guard, and this one went unnoticed:
 *
 *   MASTER_SCHOOL_SQL  SELECT 'niete:' || emis … FROM schools
 *   SEARCH_SCHOOLS_SQL … FROM schools WHERE is_active IS NOT FALSE
 *
 * `00_complete-schema.sql` declares schools as (id, name, region,
 * principal_user_id, created_at, updated_at). Production carries five more, added
 * out of band: emis, source_school_id, source_system, is_active,
 * is_probable_test. So production works and anything built from the schema does
 * not — staging's schools has the declared six, and addSchool fails there on its
 * FIRST query with 42703 'column "emis" does not exist'. The portal's leader
 * school-add path therefore has no pre-prod test route at all.
 *
 * Scoped to `schools` deliberately. A general raw-SQL column checker is a parser
 * project; this pins the one table that has already cost us a whole untestable
 * feature, and the pattern extends a table at a time.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA = path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql');
const SCAN_DIRS = ['bot', 'dashboard'].map((d) => path.join(ROOT, d));

/** SQL keywords and function names that can sit where a column would. */
const NOT_A_COLUMN = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'as', 'on', 'join', 'left',
  'right', 'inner', 'outer', 'lateral', 'true', 'false', 'limit', 'order', 'by', 'asc', 'desc',
  'group', 'having', 'count', 'coalesce', 'min', 'max', 'sum', 'distinct', 'case', 'when',
  'then', 'else', 'end', 'ilike', 'like', 'in', 'exists', 'union', 'all', 'with', 'schools',
  'text', 'uuid', 'boolean', 'int', 'bigint', 'upper', 'lower', 'regexp_replace', 'array_agg',
  'filter', 'unnest', 'any', 'nullif', 'now', 'interval', 'cast', 'else', 'offset', 'returning',
]);

/** Columns declared for a table: CREATE TABLE body + the ALTER reconcile section. */
function declaredColumns(table) {
  const sql = fs.readFileSync(SCHEMA, 'utf-8');
  const cols = new Set();

  const create = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i')
    .exec(sql);
  if (create) {
    for (const line of create[1].split('\n')) {
      const m = /^\s*([a-z_][a-z0-9_]*)\s+[A-Za-z]/.exec(line);
      if (m && !['unique', 'primary', 'foreign', 'check', 'constraint'].includes(m[1])) {
        cols.add(m[1]);
      }
    }
  }

  const alter = new RegExp(
    `ALTER TABLE\\s+(?:public\\.)?${table}\\s*(?:\\n\\s*)?ADD COLUMN IF NOT EXISTS\\s+([a-z_][a-z0-9_]*)`,
    'gi',
  );
  let m;
  while ((m = alter.exec(sql)) !== null) cols.add(m[1]);
  return cols;
}

function jsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Raw SQL strings that read from `schools` as their ONLY table, so every bare
 * identifier in them has to be a schools column. Multi-table SQL is skipped
 * rather than guessed at — a wrong owner would be a false positive, and this
 * guard is worthless the moment it cries wolf.
 */
function singleTableSchoolsSql(code) {
  const found = [];
  for (const m of code.matchAll(/`([^`]*?\bFROM\s+schools\b[^`]*?)`/gis)) {
    const sql = m[1];
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((t) => t[1].toLowerCase());
    if (tables.every((t) => t === 'schools')) found.push(sql);
  }
  return found;
}

function columnsUsedIn(sql) {
  const used = new Set();
  // strip string literals, casts and parameter placeholders first
  const stripped = sql.replace(/'[^']*'/g, "''").replace(/::[a-z_]+/gi, '').replace(/\$\d+/g, '');
  for (const m of stripped.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
    const id = m[1].toLowerCase();
    if (!NOT_A_COLUMN.has(id)) used.add(id);
  }
  return used;
}

describe('raw SQL against schools only reads declared columns', () => {
  const declared = declaredColumns('schools');

  it('finds the schools table in the schema at all', () => {
    expect(declared.size).toBeGreaterThan(0);
    expect(declared).toContain('name');
  });

  it('every column raw SQL reads from schools is declared in 00_complete-schema.sql', () => {
    const offenders = [];
    for (const file of SCAN_DIRS.flatMap(jsFiles)) {
      const code = fs.readFileSync(file, 'utf-8');
      for (const sql of singleTableSchoolsSql(code)) {
        for (const col of columnsUsedIn(sql)) {
          // aliases introduced by the query itself are not columns
          if (new RegExp(`AS\\s+${col}\\b`, 'i').test(sql)) continue;
          if (!declared.has(col)) {
            offenders.push(`${path.relative(ROOT, file)}: schools.${col}`);
          }
        }
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  /**
   * The five columns production grew out of band. Pinned by name because the
   * check above only catches a column once some query reads it, and three of
   * these are not read anywhere yet — they would drift back out silently.
   */
  it.each(['emis', 'source_school_id', 'source_system', 'is_active', 'is_probable_test'])(
    'declares schools.%s, which production has',
    (col) => {
      expect(declared).toContain(col);
    },
  );
});
