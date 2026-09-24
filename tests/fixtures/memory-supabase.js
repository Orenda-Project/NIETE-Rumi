'use strict';
/**
 * A STATEFUL in-memory Supabase stand-in, for tests that follow one teacher
 * through several services in a row: one service writes a row, a second one
 * reads it back an hour of (fake) clock later, a third one updates it.
 *
 * The other fakes in this repo either replay a canned answer
 * (`tests/quiz/helpers/supabase-chain.js`) or filter a fixture per query
 * without keeping writes (`tests/quiz/helpers/filtering-chain.js`). Neither can
 * answer "after the sweep put the row back to pending, does the next sweep send
 * it?" — this one can, because:
 *
 *   - filters are applied to reads AND to updates, and an update mutates the
 *     rows it matched and returns them. The conditional claims in this code base
 *     (`.update(...).eq('status','pending').select()`) depend on exactly that.
 *   - range filters (`lt`/`lte`/`gt`/`gte`) compare instants when both sides
 *     read as dates, so `…+00:00` and `…Z` spellings of one instant agree.
 *   - an optional UNIQUE per table answers a duplicate insert with 23505, the
 *     way `teacher_nudges_one_per_day` does.
 *   - `.single()` on no rows is PostgREST's PGRST116 error, not a quiet null.
 *
 * NOT modelled: `.or()` is recorded and ignored (every row passes). A test whose
 * outcome turns on an `.or()` filter must not rely on this fake for it.
 */

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T|$)/;

function comparable(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && DATE_LIKE.test(v)) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return v;
}

function createMemorySupabase(seed = {}, { unique = {} } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let seq = 0;

  function from(table) {
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];
    const filters = [];
    let op = 'select';
    let payload = null;
    let head = false;
    let order = null;
    let lim = null;
    let rng = null;

    const test = (r) => filters.every((f) => f(r));

    const exec = () => {
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        const made = [];
        for (const p of list) {
          seq += 1;
          const row = { id: `${table}-${seq}`, ...p };
          const keys = unique[table];
          if (keys && rows.some((r) => keys.every((k) => r[k] === row[k]))) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } };
          }
          rows.push(row);
          made.push({ ...row });
        }
        return { data: made, error: null };
      }
      let hit = rows.filter(test);
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (order) {
        const { col, asc } = order;
        hit = [...hit].sort((a, b) => {
          const av = comparable(a[col]);
          const bv = comparable(b[col]);
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (asc ? 1 : -1);
        });
      }
      if (rng) hit = hit.slice(rng[0], rng[1] + 1);
      if (lim != null) hit = hit.slice(0, lim);
      return { data: head ? null : hit.map((r) => ({ ...r })), error: null, count: hit.length };
    };

    const cmp = (fn) => (col, v) => {
      filters.push((r) => {
        const a = comparable(r[col]);
        const b = comparable(v);
        return a !== null && a !== undefined && fn(a, b);
      });
      return c;
    };

    const c = {
      select: (_cols, opts) => { if (opts && opts.head) head = true; return c; },
      insert: (p) => { op = 'insert'; payload = p; return c; },
      update: (p) => { op = 'update'; payload = p; return c; },
      delete: () => { op = 'delete'; return c; },
      eq: (col, v) => { filters.push((r) => r[col] === v); return c; },
      neq: (col, v) => { filters.push((r) => r[col] !== v); return c; },
      in: (col, vs) => { filters.push((r) => vs.includes(r[col])); return c; },
      is: (col, v) => {
        filters.push((r) => (v === null ? (r[col] === null || r[col] === undefined) : r[col] === v));
        return c;
      },
      not: (col, o, v) => {
        if (o !== 'is') throw new Error(`memory-supabase: .not(${col}, ${o}) is not modelled`);
        filters.push((r) => (v === null ? !(r[col] === null || r[col] === undefined) : r[col] !== v));
        return c;
      },
      lt: cmp((a, b) => a < b),
      lte: cmp((a, b) => a <= b),
      gt: cmp((a, b) => a > b),
      gte: cmp((a, b) => a >= b),
      or: () => c,
      order: (col, o) => { order = { col, asc: !o || o.ascending !== false }; return c; },
      limit: (n) => { lim = n; return c; },
      range: (a, b) => { rng = [a, b]; return c; },
      single: async () => {
        const r = exec();
        if (r.error) return { data: null, error: r.error };
        const first = (r.data || [])[0];
        return first ? { data: first, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      maybeSingle: async () => {
        const r = exec();
        if (r.error) return { data: null, error: r.error };
        return { data: (r.data || [])[0] || null, error: null };
      },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    };
    return c;
  }

  return {
    from: jest.fn(from),
    rpc: jest.fn(async () => ({ data: null, error: null })),
    tables,
    rows: (t) => tables[t] || [],
    /** Replace every table's contents (the object identity the mock holds stays the same). */
    reset(next = {}) {
      for (const k of Object.keys(tables)) delete tables[k];
      for (const [name, list] of Object.entries(next)) tables[name] = list.map((r) => ({ ...r }));
    },
  };
}

/**
 * The shared cache, in memory, keyed and expiring on the (fake) clock — the
 * surface of `railway-redis.service` the survey windows and the sweeps use.
 */
function createMemoryRedis() {
  const store = new Map();
  const alive = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) { store.delete(k); return null; }
    return e;
  };
  return {
    store,
    reset() { store.clear(); },
    isAvailable: () => true,
    get: jest.fn(async (k) => { const e = alive(k); return e ? e.value : null; }),
    set: jest.fn(async (k, value, ttl = null) => {
      store.set(k, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
      return true;
    }),
    setNX: jest.fn(async (k, value, ttl = null) => {
      if (alive(k)) return false;
      store.set(k, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
      return true;
    }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    del: jest.fn(async (k) => { store.delete(k); return true; }),
    exists: jest.fn(async (k) => Boolean(alive(k))),
    getTTL: jest.fn(async (k) => {
      const e = alive(k);
      if (!e) return -2;
      return e.expiresAt === null ? -1 : Math.ceil((e.expiresAt - Date.now()) / 1000);
    }),
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => true),
    checkRateLimit: jest.fn(async () => ({ allowed: true })),
  };
}

module.exports = { createMemorySupabase, createMemoryRedis };
