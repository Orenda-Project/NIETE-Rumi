/**
 * A small in-memory PostgREST for the versioned-editing tests.
 *
 * Honours the filters these services use (eq, neq, is, not-is-null, lte, gt,
 * in) and the terminal shapes (maybeSingle, single, head counts, await). An
 * embedded `assessment_requests!inner(...)` select on assessment_papers joins
 * the request row by request_id. Every write is recorded in `writes`, so a test
 * can assert what was — and was NOT — written.
 */
function makeFakeDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  const writes = [];
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 8, 30, 10, 0, seq++)).toISOString();

  function from(name) {
    const st = { filters: [], op: 'select', payload: null, cols: '*', head: false, count: null, limit: null, order: null, range: null };
    const t = () => (tables[name] || (tables[name] = []));
    const cmp = ([k, op, v], r) => {
      const x = r[k];
      switch (op) {
        case 'eq': return x === v;
        case 'neq': return x !== v;
        case 'is': return v === null ? x == null : x === v;
        case 'notnull': return x != null;
        case 'lte': return String(x) <= String(v);
        case 'gt': return String(x) > String(v);
        case 'in': return v.includes(x);
        default: return true;
      }
    };
    // A dotted key ("assessment_papers.status") filters the EMBEDDED rows, as
    // PostgREST does; `!inner` then drops a parent left with none.
    const own = () => st.filters.filter(([k]) => !k.includes('.'));
    const embedded = (rel) => st.filters.filter(([k]) => k.startsWith(`${rel}.`)).map(([k, op, v]) => [k.slice(rel.length + 1), op, v]);
    const match = (r) => own().every((f) => cmp(f, r));
    const join = (r) => {
      if (name === 'assessment_papers' && /assessment_requests/.test(st.cols)) {
        const req = (tables.assessment_requests || []).find((q) => q.id === r.request_id) || null;
        return { ...r, assessment_requests: req };
      }
      if (name === 'assessment_requests' && /assessment_papers/.test(st.cols)) {
        const fs = embedded('assessment_papers');
        return { ...r, assessment_papers: (tables.assessment_papers || []).filter((p) => p.request_id === r.id && fs.every((f) => cmp(f, p))) };
      }
      return r;
    };
    const innerDrop = (r) => name === 'assessment_requests' && /assessment_papers!inner/.test(st.cols) && !(r.assessment_papers || []).length;
    const exec = () => {
      if (st.op === 'insert') {
        const rows = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({
          id: p.id || `00000000-0000-4000-8000-${String(1000 + seq).padStart(12, '0')}`,
          created_at: p.created_at || now(), ...p,
        }));
        rows.forEach((r) => t().push(r));
        writes.push({ table: name, op: 'insert', rows: JSON.parse(JSON.stringify(rows)) });
        return { data: rows, error: null };
      }
      if (st.op === 'update') {
        const hit = t().filter(match);
        writes.push({ table: name, op: 'update', ids: hit.map((r) => r.id), patch: JSON.parse(JSON.stringify(st.payload)) });
        hit.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: hit, error: null };
      }
      let rows = t().filter(match).map(join).filter((r) => !innerDrop(r));
      if (name === 'assessment_papers' && /assessment_requests!inner/.test(st.cols)) {
        const fs = embedded('assessment_requests');
        rows = rows.filter((r) => r.assessment_requests && fs.every((f) => cmp(f, r.assessment_requests)));
      }
      if (st.order) rows.sort((a, b) => (String(a[st.order.col]) < String(b[st.order.col]) ? -1 : 1) * (st.order.asc ? 1 : -1));
      const total = rows.length;
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit) rows = rows.slice(0, st.limit);
      if (st.head) return { data: null, count: total, error: null };
      return { data: JSON.parse(JSON.stringify(rows)), count: st.count ? total : null, error: null };
    };
    const b = {
      select: (cols = '*', opts = {}) => { st.cols = cols; st.head = !!opts.head; st.count = opts.count || null; return b; },
      insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      eq: (k, v) => { st.filters.push([k, 'eq', v]); return b; },
      neq: (k, v) => { st.filters.push([k, 'neq', v]); return b; },
      is: (k, v) => { st.filters.push([k, 'is', v]); return b; },
      not: (k, op, v) => { if (op === 'is' && v === null) st.filters.push([k, 'notnull']); return b; },
      lte: (k, v) => { st.filters.push([k, 'lte', v]); return b; },
      gt: (k, v) => { st.filters.push([k, 'gt', v]); return b; },
      in: (k, v) => { st.filters.push([k, 'in', v]); return b; },
      order: (col, o = {}) => { st.order = { col, asc: o.ascending !== false }; return b; },
      limit: (n) => { st.limit = n; return b; },
      range: (a, z) => { st.range = [a, z]; return b; },
      maybeSingle: () => Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data })),
      single: () => Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data })),
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  }
  return { client: { from }, tables, writes };
}

module.exports = { makeFakeDb };
