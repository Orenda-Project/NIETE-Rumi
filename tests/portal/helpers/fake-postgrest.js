'use strict';
/**
 * A small in-memory stand-in for the supabase-js query builder — the network boundary, and nothing above it.
 *
 * It runs the REAL query-building code of the module under test against real rows, so a filter that is
 * missing (`.is('notice_opened_at', null)`) or a claim that is not conditional shows up as a wrong
 * answer, which a jest.fn() returning canned rows would never reveal.
 *
 * Supported (only what the code under test uses; anything else throws, loudly):
 *   from(t).select(cols[, opts]) .eq .neq .is .in .gte .lte .gt .lt .not(col,'is',null) .order .limit
 *           .maybeSingle() .single() and `await` for { data, error }
 *   from(t).update(patch).eq/.is/.in...  .select(cols)   → the rows it changed (an UPDATE … RETURNING)
 *   from(t).insert(row|rows)                              → appended
 *   embedded resources in select(): 'name(cols)' and 'name!inner(cols)' via `relations`
 *   dotted filters on an embedded resource: .eq('assessment_papers.status', 'ready')
 *
 * `relations`: { parentTable: { embeddedName: { table, parentKey, childKey, one? } } } — embeddedName is what appears in
 * select(); the child rows are those whose childKey equals the parent's parentKey. Like PostgREST, a MANY-to-one
 * embed (`one: true`, a foreign key on the parent) comes back as a single OBJECT (or null), not an array — the shape a
 * real read of the live sandbox returned, and the one a test written against arrays would never have caught.
 */

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

function createFakePostgrest({ tables = {}, relations = {}, onQuery = null } = {}) {
  const db = {};
  Object.entries(tables).forEach(([name, rows]) => { db[name] = rows.map(clone); });
  const queries = [];

  function from(table) {
    if (!db[table]) db[table] = [];
    const state = {
      table, op: 'select', patch: null, filters: [], order: null, limit: null, embeds: [], returning: null, single: null, inserted: null,
    };
    const builder = {};
    const addFilter = (kind) => (col, val) => { state.filters.push({ kind, col, val }); return builder; };

    builder.select = (cols = '*') => {
      if (state.op === 'select') {
        state.embeds = [...String(cols).matchAll(/([a-z0-9_]+)(!inner)?\(([^)]*)\)/gi)]
          .map((m) => ({ name: m[1], inner: !!m[2] }));
      } else {
        state.returning = cols;
      }
      return builder;
    };
    builder.update = (patch) => { state.op = 'update'; state.patch = patch; return builder; };
    builder.insert = (rows) => { state.op = 'insert'; state.inserted = Array.isArray(rows) ? rows : [rows]; return builder; };
    builder.eq = addFilter('eq');
    builder.neq = addFilter('neq');
    builder.is = addFilter('is');
    builder.in = addFilter('in');
    builder.gte = addFilter('gte');
    builder.lte = addFilter('lte');
    builder.gt = addFilter('gt');
    builder.lt = addFilter('lt');
    builder.not = (col, op, val) => { state.filters.push({ kind: 'not', col, op, val }); return builder; };
    builder.order = (col, opts = {}) => { state.order = { col, asc: opts.ascending !== false }; return builder; };
    builder.limit = (n) => { state.limit = n; return builder; };
    builder.maybeSingle = () => { state.single = 'maybe'; return builder; };
    builder.single = () => { state.single = 'one'; return builder; };

    const test = (row, f) => {
      const v = row[f.col];
      switch (f.kind) {
        case 'eq': return v === f.val;
        case 'neq': return v !== f.val;
        case 'is': return f.val === null ? v === null || v === undefined : v === f.val;
        case 'in': return f.val.includes(v);
        case 'gte': return v !== null && v !== undefined && String(v) >= String(f.val);
        case 'lte': return v !== null && v !== undefined && String(v) <= String(f.val);
        case 'gt': return v !== null && v !== undefined && String(v) > String(f.val);
        case 'lt': return v !== null && v !== undefined && String(v) < String(f.val);
        case 'not': return f.op === 'is' && f.val === null ? v !== null && v !== undefined : v !== f.val;
        default: throw new Error(`fake-postgrest: unsupported filter ${f.kind}`);
      }
    };

    function run() {
      queries.push({ table, op: state.op, filters: state.filters.map((f) => ({ ...f })), patch: state.patch, embeds: state.embeds.map((e) => e.name) });
      if (onQuery) onQuery(queries[queries.length - 1]);
      if (state.op === 'insert') {
        const added = state.inserted.map(clone);
        db[table].push(...added);
        return { data: added, error: null };
      }
      const own = state.filters.filter((f) => !String(f.col).includes('.'));
      const embedded = state.filters.filter((f) => String(f.col).includes('.'));
      let rows = db[table].filter((r) => own.every((f) => test(r, f)));

      if (state.op === 'update') {
        rows.forEach((r) => Object.assign(r, clone(state.patch)));
        return { data: rows.map(clone), error: null };
      }

      rows = rows.map((r) => {
        const out = clone(r);
        for (const e of state.embeds) {
          const rel = (relations[table] || {})[e.name];
          if (!rel) throw new Error(`fake-postgrest: no relation ${table}.${e.name}`);
          const mine = embedded.filter((f) => f.col.startsWith(`${e.name}.`)).map((f) => ({ ...f, col: f.col.slice(e.name.length + 1) }));
          const kids = (db[rel.table] || [])
            .filter((c) => c[rel.childKey] === r[rel.parentKey] && mine.every((f) => test(c, f)))
            .map(clone);
          out[e.name] = rel.one ? (kids[0] || null) : kids;
        }
        return out;
      }).filter((r) => state.embeds.every((e) => !e.inner || (r[e.name] && (Array.isArray(r[e.name]) ? r[e.name].length : r[e.name]))));

      if (state.order) {
        const { col, asc } = state.order;
        rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (state.limit != null) rows = rows.slice(0, state.limit);
      if (state.single) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }

    builder.then = (resolve, reject) => {
      try { return Promise.resolve(run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
    };
    return builder;
  }

  return { from, db, queries };
}

module.exports = { createFakePostgrest };
