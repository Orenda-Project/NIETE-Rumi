'use strict';
/**
 * The class round's tests read and write class_round_draws through this wrapper of the in-memory Supabase: like
 * PostgREST, a select, insert or update that names a column the migration does not create answers 42703, so a
 * misspelt column fails the test instead of passing silently. The column set is read from the migration itself.
 */
const fs = require('fs');
const path = require('path');

const DRAW_COLS = (() => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/web_quiz_class_round.sql'), 'utf8');
  const body = sql.split('CREATE TABLE IF NOT EXISTS class_round_draws (')[1].split('\n);')[0];
  return new Set(body.split('\n').map((l) => (/^\s{2}"?([A-Za-z_0-9]+)"?\s/.exec(l) || [])[1]).filter((c) => c && c !== 'CONSTRAINT'));
})();

const missing = (bad) => {
  const err = { data: null, error: { code: '42703', message: `column class_round_draws.${bad} does not exist` } };
  const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
  return chain;
};

/** fake.from with the class_round_draws column check. */
function strictFrom(fake) {
  return (t) => {
    const b = fake.from(t);
    if (t !== 'class_round_draws') return b;
    const sel = b.select.bind(b);
    const ins = b.insert.bind(b);
    const upd = b.update.bind(b);
    b.select = (cols, ...rest) => {
      const bad = String(cols || '').split(',').map((c) => c.trim()).filter((c) => c && c !== '*' && !DRAW_COLS.has(c));
      return bad.length ? missing(bad[0]) : sel(cols, ...rest);
    };
    b.insert = (rows) => {
      const bad = [].concat(rows).flatMap((r) => Object.keys(r)).filter((c) => !DRAW_COLS.has(c));
      return bad.length ? missing(bad[0]) : ins(rows);
    };
    b.update = (patch) => {
      const bad = Object.keys(patch || {}).filter((c) => !DRAW_COLS.has(c));
      return bad.length ? missing(bad[0]) : upd(patch);
    };
    return b;
  };
}

// The school break list the term draw requires (app_settings web_quiz_term_breaks, PKT dates, `to` inclusive): two
// one-day breaks clear of every round window and class week the class round's tests draw with.
const TERM_BREAKS = Object.freeze({ key: 'web_quiz_term_breaks', value: [{ from: '2026-11-09', to: '2026-11-09' }, { from: '2027-08-14', to: '2027-08-14' }] });

module.exports = { strictFrom, DRAW_COLS, TERM_BREAKS };
