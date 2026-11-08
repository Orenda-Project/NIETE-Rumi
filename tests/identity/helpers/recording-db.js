'use strict';
/**
 * An in-memory Supabase client for the number-change suites: rows by table, `eq`/`in` filters, reads, head counts,
 * updates (with `.select()` returning the written rows, as PostgREST does) and inserts. Every write is recorded in
 * order as { table, op, patch | rows, where }, so a suite can assert exactly what was written and in what order.
 *
 *   const db = recordingDb({ users: [...] });
 *   jest.doMock('<…>/config/supabase', () => db.client);
 *   db.refuse = (table, op, payload, where) => true  → that write answers an error (and is still recorded)
 *   db.refuseRead = (table) => true                  → a read of that table answers an error
 *   db.throwOn = (table) => true                     → from(table) throws (one table unreachable)
 *   db.throwWrite = (table, op, payload) => true     → that write rejects, as a dropped connection would (recorded)
 *   db.down = true                                   → from() throws, as an unreachable database would
 */
function recordingDb(tables = {}) {
  const db = {
    tables, writes: [], refuse: () => false, refuseRead: () => false, throwOn: () => false, throwWrite: () => false, down: false,
  };
  db.client = {
    from(name) {
      if (db.down || db.throwOn(name)) throw new Error('database unreachable');
      const t = db.tables[name] || (db.tables[name] = []);
      const filters = [];
      let op = 'select';
      let patch = null;
      let inserted = null;
      let head = false;
      let single = false;
      let returning = false;
      const match = (row) => filters.every(([kind, c, v]) => (kind === 'eq' ? row[c] === v : v.includes(row[c])));
      const where = () => filters.map(([kind, c, v]) => [kind, c, Array.isArray(v) ? [...v] : v]);
      const run = () => {
        if (op === 'insert') {
          db.writes.push({ table: name, op, rows: inserted.map((r) => JSON.parse(JSON.stringify(r))) });
          if (db.refuse(name, op, inserted, where())) return { data: null, error: { message: `insert ${name} refused` } };
          // A stored row gets the column default `created_at now()`, as the real tables do; the recorded write keeps
          // exactly what the code sent.
          t.push(...inserted.map((r) => ({ created_at: new Date(Date.now()).toISOString(), ...r })));
          return { data: null, error: null };
        }
        if (op === 'update') {
          db.writes.push({ table: name, op, patch: { ...patch }, where: where() });
          if (db.throwWrite(name, op, patch)) throw new Error('connection reset');
          if (db.refuse(name, op, patch, where())) return { data: null, error: { message: `update ${name} refused` } };
          const hits = t.filter(match);
          hits.forEach((r) => Object.assign(r, patch));
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        if (db.refuseRead(name)) return { data: null, count: null, error: { message: `select ${name} refused` } };
        const hits = t.filter(match);
        if (head) return { data: null, count: hits.length, error: null };
        if (single) return { data: hits[0] ? { ...hits[0] } : null, error: null };
        return { data: hits.map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select(_cols, opts) { if (opts && opts.head) head = true; if (op === 'update') returning = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        limit() { return chain; },
        order() { return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      return chain;
    },
  };
  return db;
}

module.exports = { recordingDb };
