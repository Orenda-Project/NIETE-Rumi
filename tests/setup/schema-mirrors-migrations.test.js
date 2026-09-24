/**
 * Every table and column a migration creates is declared in 00_complete-schema.sql.
 *
 * A clone is bootstrapped from 00_complete-schema.sql alone (`npm run bootstrap:db` never
 * reads migrations/), so a table that exists only in its migration is a table a fresh
 * install does not have. schema-completeness cannot see most of these gaps: it greps
 * `.from('<literal>')`, and a store that names its table through a constant, or a column
 * that is only ever written, slips past it. This guard reads the other side — the
 * migrations — and asks the schema file to account for their net effect.
 *
 * Net effect, in version order: a table or column a LATER migration drops is not expected;
 * a RENAME COLUMN expects the new name, not the old one.
 *
 * NOT_IN_REFERENCE_SCHEMA is the only way out, and each entry says why. It is not an
 * allowlist of gaps nobody got to: an entry is a table a fresh install must NOT have.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'infrastructure', 'supabase', 'migrations');
const SCHEMA = path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql');

// The legacy-coaching import's landing tables (V1.0.5). They are written only by the
// one-off import from the retired source system (scripts/migrate-coaching-observations.py)
// and read by no runtime code. A fresh install has no legacy system to import from, so
// shipping ten empty copies of a foreign schema would only confuse a cloner.
const NOT_IN_REFERENCE_SCHEMA = new Set([
  'nietemigrated_observation_templates',
  'nietemigrated_observation_sections',
  'nietemigrated_observation_question_groups',
  'nietemigrated_observation_questions',
  'nietemigrated_question_options',
  'nietemigrated_visit_plans',
  'nietemigrated_school_visits',
  'nietemigrated_teacher_visits',
  'nietemigrated_observations',
  'nietemigrated_observation_answers',
]);

const semver = (f) => f.match(/^V(\d+)\.(\d+)\.(\d+)__/).slice(1).map(Number);
const bySemver = (a, b) => {
  const x = semver(a);
  const y = semver(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Comments removed; FUNCTION bodies emptied (code that runs later is not DDL that runs now). */
function strip(sql) {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  return s.replace(/\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\1/gi, 'AS $$ $$');
}

const LEAD = /^(?:do\s+\$[a-z0-9_]*\$|begin|else|loop|declare\b[\s\S]*?\bbegin|(?:if|elsif)\b[\s\S]*?\bthen)\s+/i;

/** Statements, with a DO block's PL/pgSQL scaffolding peeled so its DDL is read as DDL. */
function statements(sql) {
  return strip(sql).split(';').map((st) => {
    let s = st.trim();
    for (let prev = null; prev !== s;) { prev = s; s = s.replace(LEAD, '').trim(); }
    const ex = s.match(/^execute\s+'((?:[^']|'')*)'\s*$/i);
    return ex ? ex[1].replace(/''/g, "'").trim() : s;
  }).filter(Boolean);
}

/** Top-level comma split of an ALTER TABLE action list. */
function clauses(rest) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of rest) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const ID = '(?:public\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?';

/** The net tables and columns a list of migrations ({ name, sql }, in version order) leaves behind. */
function netEffect(migrations) {
  const tables = new Map();   // table -> file
  const columns = new Map();  // "table.column" -> file
  for (const { name: file, sql } of migrations) {
    for (const st of statements(sql)) {
      let m = st.match(new RegExp(`^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${ID}`, 'i'));
      if (m) { tables.set(m[1].toLowerCase(), file); continue; }
      m = st.match(new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${ID}`, 'i'));
      if (m) {
        const t = m[1].toLowerCase();
        tables.delete(t);
        for (const k of [...columns.keys()]) if (k.startsWith(`${t}.`)) columns.delete(k);
        continue;
      }
      m = st.match(new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${ID}\\s+([\\s\\S]*)$`, 'i'));
      if (m) {
        const t = m[1].toLowerCase();
        for (const c of clauses(m[2])) {
          let cm = c.match(new RegExp(`^add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${ID}`, 'i'));
          if (cm) { columns.set(`${t}.${cm[1].toLowerCase()}`, file); continue; }
          cm = c.match(new RegExp(`^drop\\s+column\\s+(?:if\\s+exists\\s+)?${ID}`, 'i'));
          if (cm) { columns.delete(`${t}.${cm[1].toLowerCase()}`); continue; }
          cm = c.match(new RegExp(`^rename\\s+column\\s+${ID}\\s+to\\s+${ID}`, 'i'));
          if (cm) {
            columns.delete(`${t}.${cm[1].toLowerCase()}`);
            columns.set(`${t}.${cm[2].toLowerCase()}`, file);
          }
        }
        continue;
      }
      for (const sd of st.matchAll(/add_soft_delete\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)/gi)) {
        if (/^(create|comment)\b/i.test(st)) break;
        for (const c of ['deleted_at', 'deleted_reason', 'deleted_by']) columns.set(`${sd[1].toLowerCase()}.${c}`, file);
      }
    }
  }
  return { tables, columns };
}

/** The body of `CREATE TABLE [IF NOT EXISTS] <t> ( … )` in the schema text, or null. */
function tableBody(schema, table) {
  const m = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(`, 'i').exec(schema);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < schema.length && depth > 0; i += 1) {
    if (schema[i] === '(') depth += 1;
    if (schema[i] === ')') depth -= 1;
  }
  return schema.slice(start, i - 1);
}

function declaresColumn(schema, table, column) {
  const body = tableBody(schema, table);
  if (body && new RegExp(`(^|[,(\\s])${column}\\s`, 'i').test(body)) return true;
  if (new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\b`, 'i').test(schema)) return true;
  return new RegExp(`add_soft_delete\\(\\s*'${table}'\\s*\\)`, 'i').test(schema)
    && ['deleted_at', 'deleted_reason', 'deleted_by'].includes(column);
}

describe('00_complete-schema.sql declares what the migrations create', () => {
  const migrations = fs.readdirSync(MIGRATIONS)
    .filter((f) => /^V\d+\.\d+\.\d+__.*\.sql$/.test(f))
    .sort(bySemver)
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS, name), 'utf8') }));
  const schema = strip(fs.readFileSync(SCHEMA, 'utf8'));
  const { tables, columns } = netEffect(migrations);

  test('the migrations are read at all (a parser that finds nothing proves nothing)', () => {
    expect(tables.size).toBeGreaterThan(20);
    expect(columns.size).toBeGreaterThan(20);
  });

  test('every table a migration creates (and none drops later) is declared', () => {
    const missing = [...tables.entries()]
      .filter(([t]) => !NOT_IN_REFERENCE_SCHEMA.has(t) && tableBody(schema, t) === null)
      .map(([t, f]) => `${t} (${f})`)
      .sort();
    expect(missing).toEqual([]);
  });

  test('every column a migration adds (and none drops or renames later) is declared', () => {
    const missing = [...columns.entries()]
      .filter(([k]) => !NOT_IN_REFERENCE_SCHEMA.has(k.split('.')[0]))
      .filter(([k]) => { const [t, c] = k.split('.'); return !declaresColumn(schema, t, c); })
      .map(([k, f]) => `${k} (${f})`)
      .sort();
    expect(missing).toEqual([]);
  });

  test('every NOT_IN_REFERENCE_SCHEMA entry is a real migration table that the schema really omits', () => {
    for (const t of NOT_IN_REFERENCE_SCHEMA) {
      expect(tables.has(t)).toBe(true);
      expect(tableBody(schema, t)).toBeNull();
    }
  });

  test('the net-effect reader honours a later drop, a rename inside a DO block, and a dropped table', () => {
    const eff = netEffect([
      { name: 'V1.0.0__a.sql', sql: 'CREATE TABLE IF NOT EXISTS zz_a (id int); ALTER TABLE zz_a ADD COLUMN IF NOT EXISTS old_c int, ADD COLUMN gone int;' },
      { name: 'V1.0.1__b.sql', sql: 'ALTER TABLE zz_a DROP COLUMN IF EXISTS gone; DO $$ BEGIN IF true THEN ALTER TABLE zz_a RENAME COLUMN old_c TO new_c; END IF; END $$;' },
      { name: 'V1.0.2__c.sql', sql: 'CREATE TABLE zz_b (id int); DROP TABLE IF EXISTS zz_b; -- CREATE TABLE zz_ghost (id int);' },
      { name: 'V1.0.3__d.sql', sql: "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN CREATE TABLE zz_in_body (id int); END; $fn$; SELECT add_soft_delete('zz_a');" },
    ]);
    expect([...eff.tables.keys()]).toEqual(['zz_a']);
    expect([...eff.columns.keys()].sort()).toEqual(['zz_a.deleted_at', 'zz_a.deleted_by', 'zz_a.deleted_reason', 'zz_a.new_c']);
  });
});
