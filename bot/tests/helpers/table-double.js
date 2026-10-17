'use strict';
/**
 * A shared in-memory stand-in for the Supabase client: tables are plain arrays of rows, and a query is answered
 * the way PostgREST would answer it.
 *
 * Why: hand-rolled doubles drift. One that ignores a filter it does not know (`.gte`, `.neq`, `.or`) lets a test
 * pass while the product query is never really checked; one whose insert answers `[]` makes a path that needs the
 * new row go quiet, and a test asserting "nothing happened" passes for the wrong reason. So here:
 *   - every filter applies, with SQL NULL rules: eq/neq/gt/gte/lt/lte/in/like/ilike never match a NULL cell
 *     (neq included — `NULL <> 'x'` is not true); only `is null` / `not is null` test NULL;
 *   - a filter method this double does not implement THROWS, never passes rows through;
 *   - insert/upsert/update/delete change the table and, after `.select()`, answer the rows written (an insert keeps
 *     a given id, else gets a UUID);
 *   - single() on zero or many rows is PGRST116; maybeSingle() on zero rows is null data and no error.
 *
 * Every read and write is recorded ({ table, op, filters }) so a test can count round-trips.
 * Options: failTables { [table]: message } — any op on that table answers { data: null, error: { message } };
 *          rpcs { [name]: (args) => answer } — rpc() otherwise answers { data: null, error: null }.
 * Not modelled: column projection (select('a,b') returns whole rows), embedded joins, unique constraints.
 */
const crypto = require('crypto');

// Filter methods of postgrest-js that this double does not model: calling one is an error, not a no-op.
const UNSUPPORTED = ['contains', 'containedBy', 'filter', 'textSearch', 'overlaps', 'rangeGt', 'rangeGte', 'rangeLt',
  'rangeLte', 'rangeAdjacent', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf', 'isDistinct'];

const unsupported = (m) => { throw new Error(`table-double: unsupported ${m}`); };

/** Compare a cell with a filter value as Postgres would after casting the value to the column type. */
function cmp(cell, v) {
  if (typeof cell === 'number' || typeof v === 'number') return Number(cell) - Number(v);
  const a = String(cell); const b = String(v);
  return a < b ? -1 : a > b ? 1 : 0;
}

// A LIKE pattern as a regex: % is any run, _ is one char (PostgREST also takes * for %).
const likeRx = (pat, flags) => new RegExp(`^${String(pat).split('').map((ch) => {
  if (ch === '%' || ch === '*') return '.*';
  if (ch === '_') return '.';
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}).join('')}$`, flags);

// `.in()` takes an array; `.not(c, 'in', '(a,b)')` and or() take PostgREST's list text.
const list = (v) => (Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')));

// `is` takes null/true/false (or their PostgREST spellings).
const isVal = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v);

/** One comparison on one row. A NULL cell matches only `is`. */
function test(op, cell, v) {
  if (op === 'is') {
    const want = isVal(v);
    return want === null ? cell == null : cell === want;
  }
  if (cell == null) return false;
  switch (op) {
    case 'eq': return String(cell) === String(v);
    case 'neq': return String(cell) !== String(v);
    case 'gt': return cmp(cell, v) > 0;
    case 'gte': return cmp(cell, v) >= 0;
    case 'lt': return cmp(cell, v) < 0;
    case 'lte': return cmp(cell, v) <= 0;
    case 'in': return list(v).map(String).includes(String(cell));
    case 'like': return likeRx(v, '').test(String(cell));
    case 'ilike': return likeRx(v, 'i').test(String(cell));
    default: return unsupported(op);
  }
}

// Split on top-level commas only, so `id.in.(a,b)` stays one term.
function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((t) => t.trim());
}

const OR_OPS = ['is', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'ilike'];

/** or('a.is.null,a.neq.x') → [[negate, col, op, value], ...]; anything else (nested and/or, unknown op) throws. */
function parseOr(expr) {
  return splitTop(String(expr)).map((term) => {
    const parts = term.split('.');
    const col = parts.shift();
    let negate = false;
    if (parts[0] === 'not') { negate = true; parts.shift(); }
    const op = parts.shift();
    if (!col || /^(and|or)\(/.test(term) || !OR_OPS.includes(op)) unsupported(`or term "${term}"`);
    return [negate, col, op, parts.join('.')];
  });
}

/** A NOT over a comparison: a NULL cell still drops out (NOT NULL is NULL), except for `not is`. */
function notTest(op, cell, v) {
  if (op === 'is') return !test('is', cell, v);
  if (cell == null) return false;
  return !test(op, cell, v);
}

function tableDouble(tables = {}, { failTables = {}, rpcs = {} } = {}) {
  const reads = [];
  const writes = [];
  const rows = (t) => { if (!tables[t]) tables[t] = []; return tables[t]; };

  function from(table) {
    const st = { op: 'select', filters: [], preds: [], order: [], limit: null, range: null, returning: false,
      count: null, head: false, payload: null, opts: {}, single: null };
    const where = (rec, pred) => { st.filters.push(rec); st.preds.push(pred); return b; };
    const b = {};

    b.select = (cols, opts = {}) => {
      if (st.op === 'select') { st.count = opts.count || null; st.head = Boolean(opts.head); } else st.returning = true;
      return b;
    };
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'].forEach((m) => {
      b[m] = (c, v) => where([m, c, v], (r) => test(m, r[c], v));
    });
    b.is = (c, v) => where(['is', c, v], (r) => test('is', r[c], v));
    b.in = (c, vs) => where(['in', c, vs], (r) => test('in', r[c], vs));
    b.not = (c, op, v) => {
      if (!OR_OPS.includes(op)) unsupported(`not ${op}`);
      return where(['not', c, [op, v]], (r) => notTest(op, r[c], v));
    };
    b.or = (expr, opts) => {
      if (opts && (opts.foreignTable || opts.referencedTable)) unsupported('or on a referenced table');
      const terms = parseOr(expr);
      return where(['or', null, expr], (r) => terms.some(([neg, c, op, v]) => (neg ? notTest(op, r[c], v) : test(op, r[c], v))));
    };
    b.match = (obj) => { Object.entries(obj).forEach(([c, v]) => b.eq(c, v)); return b; };
    UNSUPPORTED.forEach((m) => { b[m] = () => unsupported(m); });

    b.order = (c, o = {}) => { if (o.foreignTable || o.referencedTable) unsupported('order on a referenced table'); st.order.push([c, o.ascending !== false, o.nullsFirst]); return b; };
    b.limit = (n) => { st.limit = n; return b; };
    b.range = (a, z) => { st.range = [a, z]; return b; };

    b.insert = (r) => { st.op = 'insert'; st.payload = [].concat(r); return b; };
    b.upsert = (r, opts = {}) => { st.op = 'upsert'; st.payload = [].concat(r); st.opts = opts; return b; };
    b.update = (patch) => { st.op = 'update'; st.payload = patch; return b; };
    b.delete = () => { st.op = 'delete'; return b; };

    b.single = () => { st.single = 'one'; return b; };
    b.maybeSingle = () => { st.single = 'maybe'; return b; };
    b.then = (ok, ko) => Promise.resolve().then(() => run(table, st)).then(ok, ko);
    return b;
  }

  const hits = (table, st) => rows(table).filter((r) => st.preds.every((p) => p(r)));

  function sorted(list0, order) {
    let out = [...list0];
    for (const [c, asc, nullsFirst] of [...order].reverse()) {
      // Postgres: NULLs sort last ascending, first descending, unless told otherwise.
      const nf = nullsFirst === undefined ? !asc : nullsFirst;
      out = out.sort((x, y) => {
        const a = x[c]; const z = y[c];
        if (a == null && z == null) return 0;
        if (a == null) return nf ? -1 : 1;
        if (z == null) return nf ? 1 : -1;
        const d = cmp(a, z);
        return asc ? d : -d;
      });
    }
    return out;
  }

  /** Shape the rows an op produced into what supabase-js answers. */
  function answer(st, out, count) {
    if (st.single) {
      if (out.length === 1) return { data: { ...out[0] }, error: null, count };
      if (out.length === 0 && st.single === 'maybe') return { data: null, error: null, count };
      return { data: null, error: { code: 'PGRST116', message: `JSON object requested, ${out.length} rows returned` }, count };
    }
    return { data: out.map((r) => ({ ...r })), error: null, count };
  }

  function write(table, st) {
    const t = rows(table);
    let out = [];
    if (st.op === 'insert' || st.op === 'upsert') {
      const keys = String(st.opts.onConflict || 'id').split(',').map((k) => k.trim());
      for (const r of st.payload) {
        const same = st.op === 'upsert' && t.find((x) => keys.every((k) => r[k] != null && String(x[k]) === String(r[k])));
        if (same) {
          if (!st.opts.ignoreDuplicates) { Object.assign(same, r); out.push(same); }
        } else {
          const row = { ...r, id: r.id != null ? r.id : crypto.randomUUID() };
          t.push(row);
          out.push(row);
        }
      }
    } else if (st.op === 'update') {
      out = hits(table, st);
      out.forEach((r) => Object.assign(r, st.payload));
    } else if (st.op === 'delete') {
      out = hits(table, st);
      tables[table] = t.filter((r) => !out.includes(r));
    }
    if (!st.returning) return { data: null, error: null, count: null };
    return answer(st, out, null);
  }

  function run(table, st) {
    const rec = { table, op: st.op, filters: st.filters.map((f) => [...f]) };
    if (st.op === 'select') reads.push(rec);
    else writes.push({ ...rec, rows: st.op === 'update' ? undefined : st.payload, fields: st.op === 'update' ? st.payload : undefined });
    if (Object.prototype.hasOwnProperty.call(failTables, table)) {
      return { data: null, count: null, error: { message: failTables[table] } };
    }
    if (st.op !== 'select') return write(table, st);
    let out = sorted(hits(table, st), st.order);
    const count = st.count ? out.length : null;
    if (st.head) return { data: null, count, error: null };
    if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
    if (st.limit != null) out = out.slice(0, st.limit);
    return answer(st, out, count);
  }

  return {
    tables,
    reads,
    writes,
    from,
    async rpc(name, args) {
      if (typeof rpcs[name] === 'function') return rpcs[name](args);
      return { data: null, error: null };
    },
  };
}

module.exports = { tableDouble };
