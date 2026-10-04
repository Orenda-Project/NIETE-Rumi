/**
 * A small stand-in for the Supabase query builder, for the /observe2 tests. It records every call
 * chain and answers from an in-memory table, applying the eq / is / gte filters the code uses, so a
 * test sees whether a write was guarded (e.g. `sealed_at IS NULL`) and what it would have returned.
 * Mock at this boundary only; the modules under test run for real.
 */
function createFakeSupabase(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = [];
  let nextId = 1;
  let failNext = null;

  function builder(table) {
    const q = { table, action: 'select', values: null, filters: [], order: null, limit: null, range: null, mode: 'many' };
    const rowsOf = () => (tables[table] = tables[table] || []);
    const matches = (row) => q.filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      if (op === 'is') return val === null ? row[col] == null : row[col] === val;
      if (op === 'gte') return String(row[col] || '') >= String(val);
      if (op === 'not_in') return !String(val).replace(/[()]/g, '').split(',').includes(String(row[col]));
      if (op === 'in') return (val || []).map(String).includes(String(row[col]));
      if (op === 'neq') return row[col] !== val;
      return true;
    });
    const run = () => {
      calls.push({ table, action: q.action, values: q.values, filters: q.filters.slice() });
      if (failNext) { const e = failNext; failNext = null; return { data: null, error: e }; }
      let out;
      if (q.action === 'insert') {
        const now = new Date().toISOString();
        const rec = { id: `row-${nextId++}`, created_at: now, updated_at: now, answers: {}, photos: [], evidence_review: {}, ...q.values };
        rowsOf().push(rec);
        out = [rec];
      } else if (q.action === 'update') {
        out = rowsOf().filter(matches).map((r) => Object.assign(r, q.values));
      } else {
        out = rowsOf().filter(matches);
        if (q.order) out = [...out].sort((a, b) => (q.order.ascending ? 1 : -1) * String(a[q.order.col]).localeCompare(String(b[q.order.col])));
        if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) out = out.slice(0, q.limit);
      }
      out = out.map((r) => ({ ...r }));
      if (q.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `expected one row, got ${out.length}` } };
      if (q.mode === 'maybe') return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const api = {
      insert(values) { q.action = 'insert'; q.values = values; return api; },
      update(values) { q.action = 'update'; q.values = values; return api; },
      select() { return api; },
      eq(col, val) { q.filters.push(['eq', col, val]); return api; },
      is(col, val) { q.filters.push(['is', col, val]); return api; },
      gte(col, val) { q.filters.push(['gte', col, val]); return api; },
      not(col, op, val) { if (op === 'in') q.filters.push(['not_in', col, val]); return api; },
      in(col, vals) { q.filters.push(['in', col, vals]); return api; },
      neq(col, val) { q.filters.push(['neq', col, val]); return api; },
      range(from, to) { q.range = [from, to]; return api; },
      order(col, opts = {}) { q.order = { col, ascending: opts.ascending !== false }; return api; },
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
    __failNext(error) { failNext = error; },
  };
}

module.exports = { createFakeSupabase };
