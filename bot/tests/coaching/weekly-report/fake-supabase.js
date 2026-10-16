'use strict';
/**
 * A recording stand-in for the supabase-js query builder, for the weekly-report suites. Every chain is
 * recorded as [table, [op, ...args], ...]; it resolves to `results[table]`, which may be a value or a
 * function of the recorded ops. Not a test file (no .test.js), so jest does not collect it.
 */

const OPS = ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'lt', 'lte', 'gt', 'order', 'limit', 'range',
  'insert', 'update', 'single', 'maybeSingle'];

function fakeSupabase() {
  const db = { calls: [], results: {} };
  db.from = (table) => {
    const ops = [];
    db.calls.push({ table, ops });
    const q = {};
    for (const op of OPS) {
      q[op] = (...args) => { ops.push([op, ...args]); return q; };
    }
    q.then = (res, rej) => {
      const r = db.results[table];
      const out = typeof r === 'function' ? r(ops) : (r || { data: [], error: null });
      return Promise.resolve(out).then(res, rej);
    };
    return q;
  };
  db.callsTo = (table) => db.calls.filter((c) => c.table === table);
  db.reset = () => { db.calls = []; db.results = {}; };
  return db;
}

module.exports = { fakeSupabase };
