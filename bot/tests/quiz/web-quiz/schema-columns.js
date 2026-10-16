'use strict';
/**
 * The column set of a table as the schema bootstrap (infrastructure/supabase/00_complete-schema.sql) declares it:
 * its CREATE TABLE body plus every later ALTER TABLE … ADD COLUMN. `strictColumns(fake, tables)` makes an in-memory
 * Supabase fake answer a select, insert, update or filter that names a column outside that set with Postgres's
 * 42703, so a misspelt column fails the test instead of reading undefined.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.join(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql');
const NOT_A_COLUMN = new Set(['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude']);
let sql = null;

function columnsOf(table) {
  if (sql == null) sql = fs.readFileSync(SCHEMA, 'utf8');
  const cols = new Set();
  const create = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?"?${table}"? \\(\\n([\\s\\S]*?)\\n\\);`, 'g');
  let m;
  while ((m = create.exec(sql))) {
    m[1].split('\n').forEach((l) => {
      const c = (/^\s+"?([a-z_0-9]+)"?\s/.exec(l) || [])[1];
      if (c && !NOT_A_COLUMN.has(c)) cols.add(c);
    });
  }
  const alter = new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\\.)?"?${table}"?\\s+ADD COLUMN (?:IF NOT EXISTS )?"?([a-z_0-9]+)"?`, 'gi');
  while ((m = alter.exec(sql))) cols.add(m[1]);
  if (!cols.size) throw new Error(`schema-columns: no table ${table} in the schema bootstrap`);
  return cols;
}

function strictColumns(fake, tables) {
  const sets = Object.fromEntries(tables.map((t) => [t, columnsOf(t)]));
  const from = fake.from.bind(fake);
  fake.from = (t) => {
    const b = from(t);
    const cols = sets[t];
    if (!cols) return b;
    let bad = null;
    const check = (names) => { names.forEach((c) => { if (!bad && c && c !== '*' && !cols.has(c)) bad = c; }); };
    const wrap = (name, pick) => {
      const orig = b[name];
      b[name] = (...args) => { check(pick(...args)); orig(...args); return b; };
    };
    wrap('select', (c) => String(c || '').split(',').map((x) => x.trim()));
    ['eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'order'].forEach((f) => wrap(f, (c) => [c]));
    wrap('insert', (row) => (Array.isArray(row) ? row : [row]).flatMap((r) => Object.keys(r)));
    wrap('update', (patch) => Object.keys(patch || {}));
    const then = b.then;
    b.then = (res, rej) => (bad
      ? Promise.resolve({ data: null, error: { code: '42703', message: `column ${t}.${bad} does not exist` } }).then(res, rej)
      : then(res, rej));
    return b;
  };
  return fake;
}

module.exports = { columnsOf, strictColumns };
