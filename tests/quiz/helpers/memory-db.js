'use strict';
/**
 * A Supabase stub whose tables REMEMBER their writes.
 *
 * `filtering-chain.js` applies filters but forgets an insert once the query
 * resolves; that is enough for a single read. The /quiz lesson claim is about
 * what a SECOND call sees after the first one wrote — a double tap, two
 * replicas, the 15:00 offer landing on a lesson /quiz already made a quiz for
 * — so this stub keeps one array per table, applies every filter the code
 * under test uses (eq/neq/is/in/gte/gt/lte/lt/contains/order/limit/range) to
 * reads, updates and deletes alike, and appends inserts with a fresh id and a
 * strictly increasing created_at that starts at the real clock (so a row written
 * now is "today" to code that asks).
 *
 * A select's `alias:col->key` projections are modelled (PostgREST's JSON-path
 * select), so code that reads only the slice it asked for sees that slice.
 *
 * `failTables` makes every query on a table resolve `{ error }`: an array of
 * names answers the way PostgREST answers a table that does not exist on that
 * database; an object maps a name to the exact error to answer with.
 */

function contains(value, subset) {
  if (subset === null || typeof subset !== 'object') return value === subset;
  if (Array.isArray(subset)) {
    if (!Array.isArray(value)) return false;
    return subset.every((s) => value.some((v) => contains(v, s)));
  }
  if (value === null || typeof value !== 'object') return false;
  return Object.keys(subset).every((k) => contains(value[k], subset[k]));
}

function makeDb(seed = {}, { failTables = [], clockStart = Date.now() - 60000 } = {}) {
  const tables = {};
  Object.keys(seed).forEach((t) => { tables[t] = seed[t].map((r) => ({ ...r })); });
  const reads = [];
  let n = 0;
  let clock = clockStart;
  // uuids, as the real ids are: some consumers (the quiz funnel) accept only an id-shaped value.
  const nextId = () => { n += 1; return require('crypto').randomUUID(); };
  const nextTime = () => { clock += 1000; return new Date(clock).toISOString(); };
  const fail = new Map(Array.isArray(failTables)
    ? failTables.map((t) => [t, { message: `Could not find the table 'public.${t}' in the schema cache`, code: 'PGRST205' }])
    : Object.entries(failTables || {}));

  function from(table) {
    reads.push(table);
    if (!tables[table]) tables[table] = [];
    const filters = [];
    let op = 'select';
    let payload = null;
    let head = false;
    let orderKey = null;
    let desc = false;
    let lim = null;
    let rng = null;
    let returning = false;
    let projections = [];
    const time = (v) => {
      const x = new Date(v).getTime();
      return Number.isNaN(x) ? v : x;
    };
    const matches = (r) => filters.every((f) => f(r));
    const chain = {
      select: (cols, opts) => {
        if (opts && opts.head) head = true;
        if (op !== 'select') returning = true;
        projections = String(cols || '').split(',').map((c) => c.trim())
          .map((c) => /^(\w+):(\w+)((?:->>?\w+)+)$/.exec(c)).filter(Boolean)
          .map((m) => ({ alias: m[1], column: m[2], path: m[3].split(/->>?/).filter(Boolean) }));
        return chain;
      },
      eq: (f, v) => { filters.push((r) => r[f] === v); return chain; },
      neq: (f, v) => { filters.push((r) => r[f] !== v); return chain; },
      is: (f, v) => { filters.push((r) => (v === null ? r[f] === null || r[f] === undefined : r[f] === v)); return chain; },
      in: (f, vs) => { filters.push((r) => vs.includes(r[f])); return chain; },
      gte: (f, v) => { filters.push((r) => time(r[f]) >= time(v)); return chain; },
      gt: (f, v) => { filters.push((r) => time(r[f]) > time(v)); return chain; },
      lte: (f, v) => { filters.push((r) => time(r[f]) <= time(v)); return chain; },
      lt: (f, v) => { filters.push((r) => time(r[f]) < time(v)); return chain; },
      contains: (f, v) => { filters.push((r) => contains(r[f], v)); return chain; },
      not: (f, o, v) => {
        if (o !== 'is') throw new Error(`memory-db: .not(${f}, ${o}) is not modelled`);
        filters.push((r) => (v === null ? !(r[f] === null || r[f] === undefined) : r[f] !== v));
        return chain;
      },
      order: (f, opts) => { orderKey = f; desc = Boolean(opts && opts.ascending === false); return chain; },
      limit: (k) => { lim = k; return chain; },
      range: (a, b) => { rng = [a, b]; return chain; },
      insert: (row) => { op = 'insert'; payload = row; return chain; },
      update: (patch) => { op = 'update'; payload = patch; return chain; },
      upsert: (row) => { op = 'insert'; payload = row; return chain; },
      delete: () => { op = 'delete'; return chain; },
      single: () => run().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error || (r.data && r.data.length ? null : null) })),
      maybeSingle: () => run().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error || null })),
      then: (res, rej) => run().then(res, rej),
    };
    async function run() {
      if (fail.has(table)) return { data: null, error: fail.get(table) };
      const rows = tables[table];
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
          id: nextId(table), created_at: nextTime(), ...r,
        }));
        list.forEach((r) => rows.push(r));
        return { data: list.map((r) => ({ ...r })), error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !matches(r));
        const gone = rows.length - keep.length;
        tables[table] = keep;
        return { data: null, error: null, count: gone };
      }
      let data = rows.filter(matches).map((r) => {
        const out = { ...r };
        projections.forEach(({ alias, column, path }) => {
          out[alias] = path.reduce((v, k) => (v == null ? null : (v[k] === undefined ? null : v[k])), r[column]);
        });
        return out;
      });
      if (orderKey) {
        data.sort((a, b) => {
          const av = time(a[orderKey]);
          const bv = time(b[orderKey]);
          const c = av > bv ? 1 : av < bv ? -1 : 0;
          return desc ? -c : c;
        });
      }
      if (rng) data = data.slice(rng[0], rng[1] + 1);
      if (lim !== null) data = data.slice(0, lim);
      return { data: head ? null : data, error: null, count: data.length };
    }
    return chain;
  }

  return { from: jest.fn(from), tables, reads, rpc: jest.fn().mockResolvedValue({ data: null, error: null }) };
}

module.exports = { makeDb, contains };
