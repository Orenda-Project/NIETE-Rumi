'use strict';
/**
 * An in-memory stand-in for the Supabase client — the network boundary — that
 * APPLIES the filters it is given (eq/is/not/in/ilike/gte/gt/lt/order/limit; select/insert/update/delete; is/not also on a
 * `col->>key` path), so a test fails when a query forgets one. Tables are plain arrays in `db`.
 */
const crypto = require('crypto');

// ~390 UUIDs is where a `.in()` list overflows the 16 KB response-header cap (measured on sandbox: 400 ids → 16.6 KB).
const IN_MAX = 390;

// PostgREST compares a jsonb column with eq.<json literal> as jsonb (key order does not matter); a plain value with ===.
const canon = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
// A filter column may be a jsonb path, `meta->>audio_key` (PostgREST's text arrow): the key's value, or null.
const val = (r, c) => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  if (!m) return r[c];
  const o = r[m[1]];
  return o && typeof o === 'object' && o[m[2]] != null ? String(o[m[2]]) : null;
};
const same = (cell, v) => {
  if (cell && typeof cell === 'object' && typeof v === 'string') {
    try { return JSON.stringify(canon(cell)) === JSON.stringify(canon(JSON.parse(v))); } catch (e) { return false; }
  }
  return cell === v;
};

function makeFake(db = {}, { uniques = { quiz_answers: ['session_id', 'question_id'], quiz_share_codes: ['code'] } } = {}) {
  const calls = [];
  const rpcs = [];
  const table = (t) => { db[t] = db[t] || []; return db[t]; };

  function builder(t) {
    const st = { t, filters: [], order: [], limit: null, op: 'select', count: false, head: false, payload: null, single: null };
    const b = {
      select(cols, opts) { if (st.op === 'select') st.op = 'select'; st.returning = true; if (opts && opts.count) { st.count = true; st.head = !!opts.head; } return b; },
      eq(c, v) { st.filters.push((r) => same(r[c], v)); return b; },
      neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
      is(c, v) { st.filters.push((r) => (v === null ? val(r, c) == null : val(r, c) === v)); return b; },
      not(c, op, v) { if (op === 'is' && v === null) st.filters.push((r) => val(r, c) != null); return b; },
      // PostgREST echoes the query into the Content-Location header and Node's fetch caps response headers at 16 KB:
      // a list of more than ~390 UUIDs fails the request as supabase-js reports it (postgrest-js: `TypeError: fetch failed`,
      // the headers-overflow hint, data null). A read that feeds a data-sized list in unchunked goes red here.
      in(c, vs) { if ((vs || []).length > IN_MAX) st.overflow = vs.length; st.filters.push((r) => vs.includes(r[c])); return b; },
      // PostgREST ilike: % is any run, case-insensitive.
      ilike(c, pat) {
        const rx = new RegExp(`^${String(pat).split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
        st.filters.push((r) => r[c] != null && rx.test(String(r[c]))); return b;
      },
      gte(c, v) { st.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return b; },
      gt(c, v) { st.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return b; },
      lt(c, v) { st.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b; },
      order(c, o = {}) { st.order.push([c, o.ascending !== false]); return b; },
      limit(n) { st.limit = n; return b; },
      insert(row) { st.op = 'insert'; st.payload = Array.isArray(row) ? row : [row]; return b; },
      update(patch) { st.op = 'update'; st.payload = patch; return b; },
      delete() { st.op = 'delete'; return b; },
      maybeSingle() { st.single = 'maybe'; return b; },
      single() { st.single = 'one'; return b; },
      then(res, rej) { return Promise.resolve(st.overflow ? overflow(st) : run(st)).then(res, rej); },
    };
    return b;
  }

  // supabase-js 2.112's answer when fetch fails on the headers cap (postgrest-js PostgrestBuilder.then's catch): the shape verbatim.
  function overflow(st) {
    calls.push({ table: st.t, op: st.op, payload: st.payload, overflow: st.overflow });
    return {
      success: false,
      error: { message: 'TypeError: fetch failed', details: 'TypeError: fetch failed\n\nCaused by: HeadersOverflowError: Headers Overflow Error (UND_ERR_HEADERS_OVERFLOW)', hint: 'HTTP headers exceeded server limits (typically 16KB)', code: '' },
      data: null, count: null, status: 0, statusText: '',
    };
  }

  function run(st) {
    calls.push({ table: st.t, op: st.op, payload: st.payload });
    const rows = table(st.t);
    if (st.op === 'insert') {
      const out = [];
      // One INSERT is atomic, as in Postgres: a duplicate anywhere in the batch writes nothing.
      const keys = uniques[st.t];
      const clash = (r, i) => keys && (rows.some((x) => keys.every((k) => x[k] === r[k]))
        || st.payload.slice(0, i).some((x) => keys.every((k) => x[k] === r[k])));
      if (st.payload.some(clash)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      for (const r of st.payload) {
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
    if (st.op === 'delete') {
      db[st.t] = rows.filter((r) => !hit.includes(r));
      return { data: hit.map((r) => ({ ...r })), error: null };
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

  const fake = {
    db, calls, rpcs,
    from: (t) => builder(t),
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (name === 'increment_share_code_uses') {
        const sc = table('quiz_share_codes').find((r) => r.id === args.code_id);
        if (sc) sc.uses_count = (sc.uses_count || 0) + 1;
      }
      // A test may script the rpc answer (fake.rpcResult = { data, error }, or on the object it was assigned onto); default: nothing.
      return (this && this.rpcResult) || fake.rpcResult || { data: null, error: null };
    },
  };
  return fake;
}

module.exports = { makeFake };
