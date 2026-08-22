'use strict';
/**
 * A tiny in-memory stand-in for the Supabase client.
 *
 * Hand-rolled chain mocks (`select: () => ({ eq: () => ({ ... }) })`) test the
 * shape of the calls rather than the behaviour of the code, and they go stale
 * silently the moment a filter is added. This fake stores rows and actually
 * applies the filters, so a test asserting "the mirror row was reused rather
 * than duplicated" is asserting something real.
 *
 * Supports only what this codebase's services use:
 *   .from(t).select(cols).eq(c,v).in(c,vals).is(c,null).not(c,'is',null)
 *            .order(c,{ascending}).limit(n).maybeSingle() / .single()
 *   .from(t).insert(rowOrRows).select().single()
 *   .from(t).update(patch).eq(c,v)
 *   .from(t).upsert(rowOrRows)
 * A builder is thenable, so `await` without a terminal works like PostgREST.
 */

let idCounter = 0;
function nextId(table) {
  idCounter += 1;
  return `${table}-${idCounter}`;
}

function matches(row, filters) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'eq') return row[col] === val;
    if (kind === 'in') return val.includes(row[col]);
    if (kind === 'isNull') return row[col] === null || row[col] === undefined;
    if (kind === 'notNull') return row[col] !== null && row[col] !== undefined;
    return true;
  });
}

function createFakeSupabase(seed = {}, opts = {}) {
  /** table → rows */
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  /** Tables whose next operation should fail, e.g. { classes: 'boom' }. */
  const failures = { ...(opts.failOn || {}) };

  /** Every write, in order — so a test can assert what was actually written. */
  const writes = [];

  function table(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(name) {
    const filters = [];
    let mode = 'select';
    let payload = null;
    let order = null;
    let limitN = null;

    const fail = () => (failures[name] ? { data: null, error: { message: failures[name] } } : null);

    function resolveRows() {
      const failed = fail();
      if (failed) return failed;

      if (mode === 'insert' || mode === 'upsert') {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const inserted = incoming.map((r) => ({ id: r.id || nextId(name), ...r }));
        for (const row of inserted) {
          if (mode === 'upsert') {
            // Crude but sufficient: replace a row sharing every key of the payload
            // except timestamps. Real upsert conflict targets are not modelled.
            const existing = table(name).find((e) => Object.keys(r0Keys(row)).every((k) => e[k] === row[k]));
            if (existing) {
              Object.assign(existing, row);
              continue;
            }
          }
          table(name).push(row);
        }
        writes.push({ table: name, op: mode, rows: inserted });
        return { data: inserted, error: null };
      }

      if (mode === 'delete') {
        const hit = table(name).filter((r) => matches(r, filters));
        const keep = table(name).filter((r) => !matches(r, filters));
        tables[name] = keep;
        writes.push({ table: name, op: 'delete', count: hit.length });
        return { data: hit, error: null };
      }

      if (mode === 'update') {
        const hit = table(name).filter((r) => matches(r, filters));
        for (const row of hit) Object.assign(row, payload);
        writes.push({ table: name, op: 'update', patch: payload, count: hit.length });
        return { data: hit, error: null };
      }

      let rows = table(name).filter((r) => matches(r, filters));
      if (order) {
        const { col, ascending } = order;
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return { data: rows, error: null };
    }

    function r0Keys(row) {
      const { id, created_at: _c, updated_at: _u, ...rest } = row;
      return rest;
    }

    const api = {
      select() { if (mode === 'select') mode = 'select'; return api; },
      insert(p) { mode = 'insert'; payload = p; return api; },
      upsert(p) { mode = 'upsert'; payload = p; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      delete() { mode = 'delete'; return api; },  // removes matching rows, see resolveRows
      eq(col, val) { filters.push(['eq', col, val]); return api; },
      in(col, vals) { filters.push(['in', col, vals]); return api; },
      is(col) { filters.push(['isNull', col, null]); return api; },
      not(col) { filters.push(['notNull', col, null]); return api; },
      order(col, o = {}) { order = { col, ascending: o.ascending !== false }; return api; },
      limit(n) { limitN = n; return api; },
      async maybeSingle() {
        const res = resolveRows();
        if (res.error) return res;
        return { data: res.data.length ? res.data[0] : null, error: null };
      },
      async single() {
        const res = resolveRows();
        if (res.error) return res;
        if (res.data.length !== 1) {
          // PostgREST answers PGRST116 when a single-object read matches 0 or >1.
          return { data: null, error: { code: 'PGRST116', message: 'not exactly one row' } };
        }
        return { data: res.data[0], error: null };
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolveRows()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return {
    from: (name) => builder(name),
    /** Test helpers — not part of the Supabase surface. */
    _tables: tables,
    _writes: writes,
    _failOn: (t, msg) => { failures[t] = msg; },
    _clearFailures: () => { for (const k of Object.keys(failures)) delete failures[k]; },
  };
}

module.exports = { createFakeSupabase };
