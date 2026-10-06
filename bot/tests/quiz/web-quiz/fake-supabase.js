'use strict';
/**
 * An in-memory stand-in for the Supabase client — the network boundary — that
 * APPLIES the filters it is given (eq/is/not/in/gte/lt/order/limit), so a test
 * fails when a query forgets one. Tables are plain arrays in `db`.
 */
const crypto = require('crypto');

function makeFake(db = {}, { uniques = { quiz_answers: ['session_id', 'question_id'], quiz_share_codes: ['code'] } } = {}) {
  const calls = [];
  const rpcs = [];
  const table = (t) => { db[t] = db[t] || []; return db[t]; };

  function builder(t) {
    const st = { t, filters: [], order: [], limit: null, op: 'select', count: false, head: false, payload: null, single: null };
    const b = {
      select(cols, opts) { if (st.op === 'select') st.op = 'select'; st.returning = true; if (opts && opts.count) { st.count = true; st.head = !!opts.head; } return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
      is(c, v) { st.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      not(c, op, v) { if (op === 'is' && v === null) st.filters.push((r) => r[c] != null); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      gte(c, v) { st.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return b; },
      lt(c, v) { st.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b; },
      order(c, o = {}) { st.order.push([c, o.ascending !== false]); return b; },
      limit(n) { st.limit = n; return b; },
      insert(row) { st.op = 'insert'; st.payload = Array.isArray(row) ? row : [row]; return b; },
      update(patch) { st.op = 'update'; st.payload = patch; return b; },
      maybeSingle() { st.single = 'maybe'; return b; },
      single() { st.single = 'one'; return b; },
      then(res, rej) { return Promise.resolve(run(st)).then(res, rej); },
    };
    return b;
  }

  function run(st) {
    calls.push({ table: st.t, op: st.op, payload: st.payload });
    const rows = table(st.t);
    if (st.op === 'insert') {
      const out = [];
      for (const r of st.payload) {
        const keys = uniques[st.t];
        if (keys && rows.some((x) => keys.every((k) => x[k] === r[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const row = { id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
        rows.push(row);
        out.push(row);
      }
      return { data: st.single ? out[0] : out, error: null };
    }
    let hit = rows.filter((r) => st.filters.every((f) => f(r)));
    if (st.op === 'update') {
      hit.forEach((r) => Object.assign(r, st.payload));
      return { data: hit, error: null };
    }
    for (const [c, asc] of [...st.order].reverse()) {
      hit = [...hit].sort((a, b2) => {
        const x = a[c] == null ? '' : String(a[c]); const y = b2[c] == null ? '' : String(b2[c]);
        return asc ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (st.limit != null) hit = hit.slice(0, st.limit);
    if (st.count) return { data: st.head ? null : hit, count: hit.length, error: null };
    if (st.single) return { data: hit[0] ? { ...hit[0] } : null, error: null };
    return { data: hit.map((r) => ({ ...r })), error: null };
  }

  return {
    db, calls, rpcs,
    from: (t) => builder(t),
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      if (name === 'increment_share_code_uses') {
        const sc = table('quiz_share_codes').find((r) => r.id === args.code_id);
        if (sc) sc.uses_count = (sc.uses_count || 0) + 1;
      }
      return { data: null, error: null };
    },
  };
}

module.exports = { makeFake };
