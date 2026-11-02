'use strict';
/** A tiny in-memory stand-in for the supabase client calls the FA video broadcast makes. */
function fakeDb(tables, { failOn, strictPaging } = {}) {
  const writes = [];
  function from(name) {
    const rows = tables[name] || (tables[name] = []);
    const filters = [];
    let op = 'select';
    let payload = null;
    let range = null;
    let ordered = false;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
      neq(k, v) { filters.push((r) => r[k] !== v); return q; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return q; },
      order(k) { ordered = true; filters.sortKey = k; return q; },
      range(a, b) { range = [a, b]; return q; },
      maybeSingle() { op = op === 'select' ? 'one' : op; return q; },
      single() { return q.maybeSingle(); },
      insert(p) { op = 'insert'; payload = p; return q; },
      update(p) { op = 'update'; payload = p; return q; },
      then(res, rej) {
        // A paged read without .order() can skip or repeat rows between pages on a real database.
        if (strictPaging && range && !ordered) return Promise.resolve({ data: null, error: { message: `unordered page on ${name}` } }).then(res, rej);
        if (failOn === name) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        let out;
        if (op === 'insert') {
          const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `${name}-${rows.length + 1}`, ...p }));
          rows.push(...list); writes.push({ table: name, op, rows: list });
          out = Array.isArray(payload) ? list : list[0];
        } else if (op === 'update') {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          hit.forEach((r) => Object.assign(r, payload)); writes.push({ table: name, op, payload });
          out = hit;
        } else {
          let hit = rows.filter((r) => filters.every((f) => f(r)));
          if (filters.sortKey) hit = [...hit].sort((a, b) => String(a[filters.sortKey]).localeCompare(String(b[filters.sortKey])));
          if (range) hit = hit.slice(range[0], range[1] + 1);
          out = op === 'one' ? (hit[0] || null) : hit;
        }
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      },
    };
    return q;
  }
  return { from, writes };
}

module.exports = { fakeDb };
