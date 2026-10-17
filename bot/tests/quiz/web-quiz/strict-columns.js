'use strict';
/**
 * A fake Supabase that answers like PostgREST for a misspelt column: a select, filter, order or write naming a column
 * the schema mirror (infrastructure/supabase/00_complete-schema.sql: CREATE TABLE + ALTER TABLE … ADD COLUMN) does not
 * create answers { error: { code: '42703' } } instead of quietly returning rows. A fake that answers any column hides
 * a typo that production refuses.
 *
 *   strictFrom(from, tables, extra)  wraps a fake's from(); only the named tables are checked (others pass through);
 *                             `extra` {table: [column]} admits a column the base code already reads and the mirror
 *                             lacks (a known item of the base's own column-completeness list, not this change's)
 *   COLUMNS                   table -> Set of column names, parsed from the mirror
 *   parse(sql)                the same parser, for any schema text (tests/setup/select-columns-exist.test.js reuses it)
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.resolve(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql');

function parse(sql) {
  const out = {};
  const createRe = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\)\s*;/gi;
  let m;
  while ((m = createRe.exec(sql)) !== null) {
    const cols = out[m[1].toLowerCase()] || new Set();
    m[2].split('\n').forEach((line) => {
      const c = (/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+[a-z]/i.exec(line) || [])[1];
      if (c && !['primary', 'foreign', 'unique', 'constraint', 'check', 'references', 'exclude'].includes(c.toLowerCase())) cols.add(c);
    });
    out[m[1].toLowerCase()] = cols;
  }
  const alterRe = /ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  while ((m = alterRe.exec(sql)) !== null) (out[m[1].toLowerCase()] = out[m[1].toLowerCase()] || new Set()).add(m[2]);
  return out;
}

const COLUMNS = parse(fs.readFileSync(SCHEMA, 'utf8'));
const FILTERS = new Set(['eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'like', 'ilike', 'contains']);
const WRITES = new Set(['insert', 'update', 'upsert']);

function strictFrom(from, tables, extra = {}) {
  const only = new Set(tables);
  return (t) => {
    const b = from(t);
    if (!only.has(t) || !COLUMNS[t]) return b;
    const cols = new Set([...COLUMNS[t], ...(extra[t] || [])]);
    let bad = null;
    const check = (c) => {
      const n = String(c == null ? '' : c).trim().replace(/^"|"$/g, '');
      if (!bad && n && n !== '*' && !n.includes('(') && !cols.has(n)) bad = n;
    };
    const refused = () => ({ data: null, error: { code: '42703', message: `column ${t}.${bad} does not exist` } });
    const proxy = new Proxy(b, {
      get(target, k) {
        const v = target[k];
        if (k === 'then') return bad ? (res, rej) => Promise.resolve(refused()).then(res, rej) : v;
        if (typeof v !== 'function') return v;
        return (...args) => {
          if (k === 'select' && typeof args[0] === 'string') args[0].split(',').forEach(check);
          if (FILTERS.has(k)) check(args[0]);
          if (WRITES.has(k) && args[0] && typeof args[0] === 'object') (Array.isArray(args[0]) ? args[0] : [args[0]]).forEach((o) => Object.keys(o).forEach(check));
          const r = v.apply(target, args);
          return r === target ? proxy : r;
        };
      },
    });
    return proxy;
  };
}

module.exports = { strictFrom, COLUMNS, parse };
