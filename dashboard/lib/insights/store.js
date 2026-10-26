'use strict';
/**
 * The job's writer (sandbox only until the operator's go): every write goes through here, and here only after
 * assertEnvironment() returned mode 'write'. Two stores: SupabaseStore (the job) and MemoryStore (the dry run and the
 * tests: keeps rows in memory, writes nothing anywhere). Same interface, so the stages never branch on the mode.
 */
const crypto = require('crypto');

const CHUNK = 500;

/**
 * The slice of the PostgREST query builder the job uses (select, eq, in, not is null, gt/gte/lt, the keyset `or`,
 * order, limit, range), over an in-memory array. Thenable like supabase-js: resolves { data, error }.
 */
class MemQuery {
  constructor(rows) { this.src = rows; this.filters = []; this.sorts = []; this.lim = null; this.from = 0; this.to = null; this.cols = null; }
  select(cols) { this.cols = cols && cols !== '*' ? cols.split(',').map((c) => c.trim()) : null; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  in(c, vs) { const s = new Set(vs); this.filters.push((r) => s.has(r[c])); return this; }
  not(c, op, v) { if (op === 'is' && v === null) this.filters.push((r) => r[c] != null); return this; }
  gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
  or(expr) {
    const m = /^(\w+)\.gt\.([^,]+),and\(\1\.eq\.([^,]+),(\w+)\.gt\.([^)]+)\)$/.exec(expr);
    if (!m) throw new Error(`MemQuery: unsupported or(${expr})`);
    const [, a, v1, v2, b, v3] = m;
    this.filters.push((r) => r[a] > v1 || (r[a] === v2 && r[b] > v3));
    return this;
  }
  order(c, { ascending = true } = {}) { this.sorts.push([c, ascending ? 1 : -1]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.from = a; this.to = b; return this; }
  run() {
    let out = this.src.filter((r) => this.filters.every((f) => f(r)));
    if (this.sorts.length) {
      out = [...out].sort((x, y) => {
        for (const [c, d] of this.sorts) { if (x[c] < y[c]) return -d; if (x[c] > y[c]) return d; }
        return 0;
      });
    }
    out = out.slice(this.from, this.to == null ? undefined : this.to + 1);
    if (this.lim != null) out = out.slice(0, this.lim);
    const cols = this.cols;
    return cols ? out.map((r) => Object.fromEntries(cols.map((c) => {
      const [alias, p] = c.includes(':') ? c.split(':') : [c, c];
      const v = p.split('->').reduce((o, k) => (o == null ? undefined : o[k]), r);
      return [alias.split('->').pop(), v === undefined ? null : v];
    }))) : out;
  }
  then(resolve, reject) { try { resolve({ data: this.run(), error: null }); } catch (e) { reject(e); } }
}

/** A read-only supabase-js look-alike over fixture tables (tests and the dry-run rehearsal). */
function memoryClient(tables) {
  return { from: (t) => new MemQuery(tables[t] || []), rpc: () => { throw new Error('no rpc'); } };
}

const SCOPE_ID = (r) => r.coach_user_id || r.school_id || r.sector;

class MemoryStore {
  constructor() { this.tables = new Map(); this.calls = []; this.changed = {}; }
  bump(table, n) { if (n) this.changed[table] = (this.changed[table] || 0) + n; }
  rows(table) { if (!this.tables.has(table)) this.tables.set(table, []); return this.tables.get(table); }
  async select(table, apply = (q) => q, columns = '*') {
    const { data } = await apply(new MemQuery(this.rows(table)).select(columns));
    return data;
  }
  async upsert(table, list, onConflict) {
    this.calls.push(['upsert', table, list.length]);
    const keys = onConflict ? onConflict.split(',') : ['id'];
    const t = this.rows(table);
    let written = 0;
    for (const r0 of list) {
      const r = table === 'coachip_rollups' ? { ...r0, scope_id: SCOPE_ID(r0) } : r0;
      const i = t.findIndex((x) => keys.every((k) => x[k] === r[k]));
      if (i >= 0) {
        // ON CONFLICT DO UPDATE: the stored id stands; count a write only when a column changed.
        const { id, ...rest } = r;
        const same = Object.keys(rest).every((k) => JSON.stringify(t[i][k]) === JSON.stringify(rest[k]));
        if (!same) { t[i] = { ...t[i], ...rest }; written += 1; }
      } else { t.push({ id: r.id || crypto.randomUUID(), ...r }); written += 1; }
    }
    this.bump(table, written);
    return { written };
  }
  async insert(table, list) {
    this.calls.push(['insert', table, list.length]);
    const out = list.map((r) => ({ id: r.id || crypto.randomUUID(), ...r }));
    this.rows(table).push(...out);
    this.bump(table, out.length);
    return out;
  }
  async update(table, id, patch) {
    this.calls.push(['update', table, 1]);
    const r = this.rows(table).find((x) => x.id === id);
    if (r && Object.keys(patch).some((k) => JSON.stringify(r[k]) !== JSON.stringify(patch[k]))) { Object.assign(r, patch); this.bump(table, 1); }
    return r;
  }
  async deleteWhere(table, column, values) {
    this.calls.push(['delete', table, values.length]);
    const set = new Set(values);
    const t = this.rows(table);
    const kept = t.filter((r) => !set.has(r[column]));
    this.bump(table, t.length - kept.length);
    this.tables.set(table, kept);
  }
  get writes() { return this.calls.filter((c) => c[0] !== 'select').reduce((n, c) => n + c[2], 0); }
}

/** supabase-js backed store. `client` must be the service-role client of the asserted environment. */
class SupabaseStore {
  constructor(client) { this.client = client; }
  async select(table, apply = (q) => q, columns = '*') {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await apply(this.client.from(table).select(columns)).range(from, from + 999);
      if (error) throw new Error(`select ${table}: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  async upsert(table, list, onConflict) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const { error } = await this.client.from(table).upsert(list.slice(i, i + CHUNK), { onConflict, ignoreDuplicates: false });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    }
    return { written: list.length };
  }
  async insert(table, list) {
    const out = [];
    for (let i = 0; i < list.length; i += CHUNK) {
      const { data, error } = await this.client.from(table).insert(list.slice(i, i + CHUNK)).select('id');
      if (error) throw new Error(`insert ${table}: ${error.message}`);
      out.push(...data);
    }
    return out;
  }
  async update(table, id, patch) {
    const { error } = await this.client.from(table).update(patch).eq('id', id);
    if (error) throw new Error(`update ${table}: ${error.message}`);
  }
  async deleteWhere(table, column, values) {
    for (let i = 0; i < values.length; i += CHUNK) {
      const { error } = await this.client.from(table).delete().in(column, values.slice(i, i + CHUNK));
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }
  }
}

/** One run at a time (NIGHTLY_JOB §0): a session-level advisory lock on its own pg connection. */
async function acquireLock(pg) {
  const { rows } = await pg.query("SELECT pg_try_advisory_lock(hashtext('coachip-nightly')) AS ok");
  return rows[0] && rows[0].ok === true;
}

module.exports = { MemoryStore, SupabaseStore, acquireLock, MemQuery, memoryClient };
