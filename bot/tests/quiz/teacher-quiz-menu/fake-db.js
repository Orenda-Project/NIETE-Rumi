'use strict';
/**
 * A table-driven supabase double for the teacher /quiz menu tests. Every read
 * is recorded ({table, op, filters}) so a test can assert how many round-trips
 * a page cost (one per table, never one per quiz).
 */
function fakeDb(tables = {}) {
  const reads = [];
  const writes = [];
  const match = (row, f) => f.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'in') return val.map(String).includes(String(v));
    if (op === 'is') return val === null ? v == null : v === val;
    return true;
  });
  return {
    rpc: async () => ({ data: null, error: null }),
    reads,
    writes,
    tables,
    from(table) {
      const filters = [];
      const q = { table, filters, order: null, limit: null, update: null };
      const b = {};
      b.select = () => b;
      b.eq = (c, v) => { filters.push(['eq', c, v]); return b; };
      b.in = (c, v) => { filters.push(['in', c, v]); return b; };
      b.is = (c, v) => { filters.push(['is', c, v]); return b; };
      b.order = (c, o) => { q.order = [c, o]; return b; };
      b.limit = (n) => { q.limit = n; return b; };
      b.range = (a, z) => { q.limit = z - a + 1; return b; };
      ['not', 'gte', 'lte', 'gt', 'lt', 'or', 'neq', 'ilike', 'like', 'contains', 'filter'].forEach((m) => { b[m] = () => b; });
      b.update = (fields) => { q.update = fields; return b; };
      ['insert', 'upsert', 'delete'].forEach((m) => { b[m] = (rows) => { writes.push({ table, op: m, rows }); q.write = true; return b; }; });
      const run = () => {
        if (q.write) return { data: [], error: null };
        if (q.update) {
          writes.push({ table, fields: q.update, filters: [...filters] });
          (tables[table] || []).filter((r) => match(r, filters)).forEach((r) => Object.assign(r, q.update));
          return { data: [], error: null };
        }
        reads.push({ table, filters: [...filters] });
        let rows = (tables[table] || []).filter((r) => match(r, filters));
        if (q.order) {
          const [c, o] = q.order;
          rows = [...rows].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : 1) * (o && o.ascending === false ? -1 : 1));
        }
        if (q.limit != null) rows = rows.slice(0, q.limit);
        return { data: rows, error: null };
      };
      b.maybeSingle = async () => { const r = run(); return { data: r.data[0] || null, error: null }; };
      b.single = b.maybeSingle;
      b.then = (ok, ko) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  };
}

module.exports = { fakeDb };
