'use strict';
/**
 * The Challenge tables' real column sets, read from their SQL (never a hand-kept list), and a guard that makes the
 * in-memory Supabase fake answer like PostgREST: a select naming a column the table does not have is 42703.
 * fake-supabase.js answers any column list, so without this a misspelt or missing column is invisible to a suite.
 *
 *   challenge_passages, challenge_items, challenge_periods, challenge_links, challenge_draws
 *                            bot/database/migrations/web_quiz_challenge_registry.sql (challenge_passages: + every
 *                            ADD COLUMN of web_quiz_challenge_passages_provenance.sql and
 *                            web_quiz_challenge_passages_licence_calib.sql)
 *   web_quiz_challenge_runs  the reference schema's CREATE TABLE + every ADD COLUMN of an ALTER on it there and in
 *                            web_quiz_challenge_runs_v2.sql / web_quiz_challenge_runs_sampling.sql
 *   child_identity           bot/database/migrations/child_identity.sql
 *   child_rungs              bot/database/migrations/web_quiz_challenge_runs_v2.sql (where it is created)
 *
 * Use: guardColumns(makeFake(db)) before Object.assign(supabase, fake). Other tables pass through untouched.
 */
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '../../../database/migrations');
const SCHEMA = path.join(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql');
const read = (f) => fs.readFileSync(f, 'utf8');
const NOT_COLS = new Set(['constraint', 'primary', 'unique', 'check', 'foreign']);

function createCols(sql, table) {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!m) throw new Error(`registry-columns: no CREATE TABLE for ${table}`);
  return m[1].split('\n').map((l) => (/^\s+"?([a-z_][a-z0-9_]*)"?\s/.exec(l) || [])[1]).filter((c) => c && !NOT_COLS.has(c));
}

function addedCols(sql, table) {
  const out = [];
  for (const st of sql.split(';')) {
    if (!new RegExp(`ALTER TABLE (?:public\\.)?${table}\\b`).test(st)) continue;
    for (const m of st.matchAll(/ADD COLUMN IF NOT EXISTS\s+"?([a-z_][a-z0-9_]*)"?/g)) out.push(m[1]);
  }
  return out;
}

const COLUMNS = (() => {
  const reg = read(path.join(MIG, 'web_quiz_challenge_registry.sql'));
  const v2 = read(path.join(MIG, 'web_quiz_challenge_runs_v2.sql'));
  const sampling = read(path.join(MIG, 'web_quiz_challenge_runs_sampling.sql'));
  const provenance = read(path.join(MIG, 'web_quiz_challenge_passages_provenance.sql'));
  const licenceCalib = read(path.join(MIG, 'web_quiz_challenge_passages_licence_calib.sql'));
  const schema = read(SCHEMA);
  const runs = 'web_quiz_challenge_runs';
  const sets = {};
  for (const t of ['challenge_passages', 'challenge_items', 'challenge_periods', 'challenge_links', 'challenge_draws']) sets[t] = new Set(createCols(reg, t));
  for (const c of [...addedCols(provenance, 'challenge_passages'), ...addedCols(licenceCalib, 'challenge_passages')]) sets.challenge_passages.add(c);
  sets[runs] = new Set([...createCols(schema, runs), ...addedCols(schema, runs), ...addedCols(v2, runs), ...addedCols(sampling, runs)]);
  sets.child_identity = new Set(createCols(read(path.join(MIG, 'child_identity.sql')), 'child_identity'));
  sets.child_rungs = new Set(createCols(v2, 'child_rungs'));
  return sets;
})();

/** The plain column names a select asks for (`*`, embeds and json paths are not checked). */
function requested(cols) {
  return String(cols || '').split(',').map((c) => c.trim()).filter(Boolean)
    .map((c) => (c.includes(':') ? c.split(':')[1].trim() : c))
    .filter((c) => /^"?[a-z_][a-z0-9_]*"?$/i.test(c)).map((c) => c.replace(/"/g, ''));
}

/** Wraps fake.from in place: a select on a guarded table naming an unknown column resolves { data: null, error: 42703 }. */
function guardColumns(fake) {
  const from = fake.from.bind(fake);
  fake.from = (t) => {
    const b = from(t);
    const known = COLUMNS[t];
    if (!known) return b;
    const select = b.select;
    b.select = (cols, ...rest) => {
      const bad = requested(cols).filter((c) => !known.has(c));
      if (!bad.length) return select(cols, ...rest);
      const res = { data: null, error: { code: '42703', message: `column ${t}.${bad[0]} does not exist` } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (ok, no) => Promise.resolve(res).then(ok, no) : () => chain) });
      return chain;
    };
    return b;
  };
  return fake;
}

module.exports = { guardColumns, COLUMNS };
