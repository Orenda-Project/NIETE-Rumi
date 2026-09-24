'use strict';
/**
 * A STATEFUL in-memory stand-in for the Supabase client, for suites that drive
 * a whole chain of real services against one set of rows.
 *
 * The two older helpers answer one query at a time: `supabase-chain.js`
 * replays a canned result, `filtering-chain.js` filters fixtures but never
 * applies a write. A chain — hand-off → a child joins → answers → the class
 * report → the child's card — only means something if what one service WRITES
 * is what the next one READS: the share code the hand-off mints is the code
 * the child joins with, the session the join inserts is the row the report
 * counts, the `report_sent` the report stamps is what /quiz reads back. So
 * here an insert appends, an update patches the matching rows, and a read sees
 * both.
 *
 * Modelled the way PostgREST behaves where it matters to these services:
 *   - every read returns COPIES (a service that mutates what it read must not
 *     edit the table behind the next reader's back);
 *   - an insert/update/upsert returns rows only when `.select()` is chained;
 *   - `.single()` on no row is an error, `.maybeSingle()` on no row is null;
 *   - column DEFAULTs are whatever the caller passes as `defaults` per table
 *     (read them off `information_schema.columns`, never guess) — an insert
 *     that omits `active` must read back `true` if the column says so;
 *   - an embedded resource (`users!inner(...)`) is whatever the seed row
 *     carries under that key — seed it pre-joined.
 * Anything not modelled THROWS, so a query the suite did not anticipate fails
 * loudly instead of quietly reading nothing.
 *
 * Framework-agnostic (no jest.fn inside): the lane's render scripts drive the
 * same chain outside jest.
 */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function asTime(v) {
  if (typeof v !== 'string') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}/.test(v) ? v : t;
}

function cmp(a, b) {
  const x = asTime(a);
  const y = asTime(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return x > y ? 1 : -1;
}

/** jsonb `@>` for the shapes these services use: an array of objects / scalars. */
function contains(have, want) {
  if (Array.isArray(want)) {
    return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  }
  if (want && typeof want === 'object') {
    return have && typeof have === 'object' && Object.entries(want).every(([k, v]) => contains(have[k], v));
  }
  return have === want;
}

/** `a.is.null,b.lte.3` — the one `.or()` shape the quiz engine sends. */
function parseOr(expr) {
  return String(expr).split(',').map((term) => {
    const [field, op, ...rest] = term.split('.');
    const raw = rest.join('.');
    const val = raw === 'null' ? null : (/^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw);
    const tests = {
      is: (r) => (val === null ? r[field] === null || r[field] === undefined : r[field] === val),
      eq: (r) => r[field] === val,
      lte: (r) => r[field] !== null && r[field] !== undefined && cmp(r[field], val) <= 0,
      lt: (r) => r[field] !== null && r[field] !== undefined && cmp(r[field], val) < 0,
      gte: (r) => r[field] !== null && r[field] !== undefined && cmp(r[field], val) >= 0,
      gt: (r) => r[field] !== null && r[field] !== undefined && cmp(r[field], val) > 0,
    };
    if (!tests[op]) throw new Error(`memory-supabase: .or() operator "${op}" is not modelled`);
    return tests[op];
  });
}

function createMemorySupabase(seed = {}, { rpc: rpcHandlers = {}, defaults = {}, now = () => new Date() } = {}) {
  const tables = {};
  Object.entries(seed).forEach(([t, rows]) => { tables[t] = (rows || []).map(clone); });
  const writes = [];
  let seq = 0;
  const newId = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  };
  const table = (t) => { if (!tables[t]) tables[t] = []; return tables[t]; };

  function query(t) {
    const filters = [];
    const orders = [];
    let op = 'select';
    let payload = null;
    let returning = false;
    let limitN = null;
    let rangeAB = null;
    let head = false;
    let onConflict = null;

    const matches = (r) => filters.every((f) => f(r));

    function run() {
      const rows = table(t);
      if (op === 'select') {
        let out = rows.filter(matches);
        if (orders.length) {
          out = [...out].sort((a, b) => {
            for (const { field, asc } of orders) {
              const c = cmp(a[field], b[field]);
              if (c) return asc ? c : -c;
            }
            return 0;
          });
        }
        if (rangeAB) out = out.slice(rangeAB[0], rangeAB[1] + 1);
        if (limitN !== null) out = out.slice(0, limitN);
        return { data: head ? null : out.map(clone), error: null, count: out.length };
      }
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(clone);
        const made = [];
        list.forEach((row) => {
          if (op === 'upsert' && onConflict) {
            const keys = onConflict.split(',').map((k) => k.trim());
            const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
            if (hit) { Object.assign(hit, row); made.push(hit); return; }
          }
          const full = { id: newId(), created_at: now().toISOString(), ...clone(defaults[t] || {}), ...row };
          rows.push(full);
          made.push(full);
        });
        writes.push({ table: t, op, rows: made.map(clone) });
        return { data: returning ? made.map(clone) : null, error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, clone(payload)));
        writes.push({ table: t, op, patch: clone(payload), ids: hit.map((r) => r.id) });
        return { data: returning ? hit.map(clone) : null, error: null, count: hit.length };
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !matches(r));
        const gone = rows.length - keep.length;
        tables[t] = keep;
        writes.push({ table: t, op, removed: gone });
        return { data: null, error: null, count: gone };
      }
      throw new Error(`memory-supabase: op ${op} is not modelled`);
    }

    const b = {
      select(_cols, opts) {
        if (op === 'select') { if (opts && opts.head) head = true; } else returning = true;
        return b;
      },
      insert(rows) { op = 'insert'; payload = rows; return b; },
      upsert(rows, opts) { op = 'upsert'; payload = rows; onConflict = opts && opts.onConflict; return b; },
      update(patch) { op = 'update'; payload = patch; return b; },
      delete() { op = 'delete'; return b; },
      eq(f, v) { filters.push((r) => r[f] === v); return b; },
      neq(f, v) { filters.push((r) => r[f] !== v); return b; },
      is(f, v) {
        filters.push((r) => (v === null ? r[f] === null || r[f] === undefined : r[f] === v));
        return b;
      },
      not(f, o, v) {
        if (o !== 'is') throw new Error(`memory-supabase: .not(${f}, ${o}) is not modelled`);
        filters.push((r) => (v === null ? !(r[f] === null || r[f] === undefined) : r[f] !== v));
        return b;
      },
      in(f, vs) { filters.push((r) => (vs || []).includes(r[f])); return b; },
      gte(f, v) { filters.push((r) => r[f] != null && cmp(r[f], v) >= 0); return b; },
      gt(f, v) { filters.push((r) => r[f] != null && cmp(r[f], v) > 0); return b; },
      lte(f, v) { filters.push((r) => r[f] != null && cmp(r[f], v) <= 0); return b; },
      lt(f, v) { filters.push((r) => r[f] != null && cmp(r[f], v) < 0); return b; },
      contains(f, v) { filters.push((r) => contains(r[f], v)); return b; },
      or(expr) {
        const tests = parseOr(expr);
        filters.push((r) => tests.some((fn) => fn(r)));
        return b;
      },
      order(field, opts) { orders.push({ field, asc: !(opts && opts.ascending === false) }); return b; },
      limit(n) { limitN = n; return b; },
      range(a, z) { rangeAB = [a, z]; return b; },
      async single() {
        const r = run();
        const rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
        if (rows.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: `expected one row from ${t}, got ${rows.length}` } };
        }
        return { data: rows[0], error: null };
      },
      async maybeSingle() {
        const r = run();
        const rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
        if (rows.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: `expected at most one row from ${t}, got ${rows.length}` } };
        }
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) {
        try { return Promise.resolve(run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return b;
  }

  async function rpc(name, args) {
    const h = rpcHandlers[name];
    if (!h) return { data: null, error: null };
    return h(args, { tables, table });
  }

  return {
    from: (t) => query(t), rpc, tables, writes, table,
  };
}

module.exports = { createMemorySupabase };
