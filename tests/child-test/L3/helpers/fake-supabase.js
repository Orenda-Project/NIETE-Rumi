/**
 * A stand-in for the Supabase query builder for the child-test tests (a superset of
 * tests/observe2/helpers/fake-supabase.js). It answers from in-memory tables and applies the
 * filters the code uses (eq / neq / is / in / gte / lte), so a test sees what a write was guarded by
 * and what it would have returned. Unique keys can be declared per table: a violating insert gets
 * Postgres's 23505, as the real database would. Mock at this boundary only; the modules under test
 * run for real.
 */
function createFakeSupabase(seed = {}, { unique = {} } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = [];
  let nextId = 1;
  const failQueue = [];

  const rowsOf = (t) => (tables[t] = tables[t] || []);

  function violates(table, rec, ignoreId) {
    for (const key of unique[table] || []) {
      const cols = Array.isArray(key) ? key : key.cols;
      const where = Array.isArray(key) ? null : key.where;
      if (where && !where(rec)) continue;
      const clash = rowsOf(table).some((r) => r.id !== ignoreId && (!where || where(r))
        && cols.every((c) => r[c] != null && r[c] === rec[c]));
      if (clash) return { code: '23505', message: `duplicate key value violates unique constraint (${cols.join(', ')})` };
    }
    return null;
  }

  function builder(table) {
    const q = { table, action: 'select', values: null, filters: [], orders: [], limit: null, mode: 'many' };
    const matches = (row) => q.filters.every(([op, col, val]) => {
      const v = row[col];
      if (op === 'eq') return v === val;
      if (op === 'neq') return v !== val;
      if (op === 'is') return val === null ? v == null : v === val;
      if (op === 'in') return val.includes(v);
      if (op === 'gte') return v != null && String(v) >= String(val);
      if (op === 'lte') return v != null && String(v) <= String(val);
      return true;
    });
    const run = () => {
      calls.push({ table, action: q.action, values: q.values, filters: q.filters.slice() });
      if (failQueue.length) {
        const f = failQueue[0];
        if (!f.table || f.table === table) { failQueue.shift(); return { data: null, error: f.error }; }
      }
      let out;
      if (q.action === 'insert') {
        const list = Array.isArray(q.values) ? q.values : [q.values];
        const now = new Date().toISOString();
        const recs = list.map((v) => ({ id: `${table}-${nextId++}`, created_at: now, updated_at: now, ...v }));
        // All or nothing, as one INSERT statement is: check every row before writing any.
        const before = rowsOf(table).length;
        for (const rec of recs) {
          const err = violates(table, rec);
          if (err) { rowsOf(table).length = before; return { data: null, error: err }; }
          rowsOf(table).push(rec);
        }
        out = recs;
      } else if (q.action === 'update') {
        const hit = rowsOf(table).filter(matches);
        for (const r of hit) {
          const err = violates(table, { ...r, ...q.values }, r.id);
          if (err) return { data: null, error: err };
        }
        const now = new Date().toISOString();
        out = hit.map((r) => Object.assign(r, q.values, { updated_at: now }));
      } else {
        out = rowsOf(table).filter(matches);
        for (const o of [...q.orders].reverse()) {
          out = [...out].sort((a, b) => {
            const x = a[o.col]; const y = b[o.col];
            if (x == null && y == null) return 0;
            if (x == null) return 1;
            if (y == null) return -1;
            const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
            return o.ascending ? c : -c;
          });
        }
        if (q.limit != null) out = out.slice(0, q.limit);
      }
      out = out.map((r) => JSON.parse(JSON.stringify(r)));
      if (q.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `expected one row, got ${out.length}` } };
      if (q.mode === 'maybe') return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const api = {
      insert(values) { q.action = 'insert'; q.values = values; return api; },
      update(values) { q.action = 'update'; q.values = values; return api; },
      select() { return api; },
      eq(col, val) { q.filters.push(['eq', col, val]); return api; },
      neq(col, val) { q.filters.push(['neq', col, val]); return api; },
      is(col, val) { q.filters.push(['is', col, val]); return api; },
      in(col, val) { q.filters.push(['in', col, val]); return api; },
      gte(col, val) { q.filters.push(['gte', col, val]); return api; },
      lte(col, val) { q.filters.push(['lte', col, val]); return api; },
      order(col, opts = {}) { q.orders.push({ col, ascending: opts.ascending !== false }); return api; },
      limit(n) { q.limit = n; return api; },
      single() { q.mode = 'single'; return Promise.resolve(run()); },
      maybeSingle() { q.mode = 'maybe'; return Promise.resolve(run()); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }

  return {
    from: (table) => builder(table),
    __tables: tables,
    __calls: calls,
    __failNext(error, table) { failQueue.push({ error, table }); },
  };
}

// The unique keys V1.5.9 creates.
const CHILD_TEST_UNIQUE = {
  child_test_draws: [
    { cols: ['cycle_id', 'class_id', 'draw_rank'], where: (r) => r.sample_role === 'new' },
    ['cycle_id', 'student_id', 'sample_role'],
  ],
  child_test_sessions: [['draw_id']],
  child_test_blocks: [['session_id', 'block']],
};

module.exports = { createFakeSupabase, CHILD_TEST_UNIQUE };
