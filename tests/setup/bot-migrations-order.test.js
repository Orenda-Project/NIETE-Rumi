/**
 * The bot migrations' `-- requires: <file>.sql` headers are the apply order (bot-migrations-lib.js `order`):
 *   - every file a header names exists and is a forward migration (not a rollback, not itself);
 *   - the headers have no cycle, so every migration has a place in the order;
 *   - a migration that uses a table another migration creates (ALTER TABLE, an index, a policy or trigger on it,
 *     a REFERENCES) requires that migration, directly or through another.
 * The last rule came after the order had been typed by hand once and was wrong. The files that predate it are in
 * bot-migrations-order.allowlist.json, one line per use; that list may only shrink (an entry that no longer
 * applies fails until it is removed).
 */
const L = require('./bot-migrations-lib');
const ALLOW = require('./bot-migrations-order.allowlist.json');

const key = (u) => `${u.file} uses ${u.table} (${u.creator})`;

describe('bot migrations: the -- requires: order', () => {
  const migrations = L.readMigrations();
  const files = new Set(migrations.map((m) => m.file));

  test('the migrations are read at all', () => {
    expect(migrations.length).toBeGreaterThan(50);
    expect(migrations.filter((m) => L.requiresOf(m.sql).length).length).toBeGreaterThan(3);
  });

  test('every -- requires: target is another forward migration in the folder', () => {
    const bad = [];
    for (const m of migrations) {
      for (const r of L.requiresOf(m.sql)) {
        if (r === m.file) bad.push(`${m.file} requires itself`);
        else if (L.isRollback(r)) bad.push(`${m.file} requires a rollback: ${r}`);
        else if (!files.has(r)) bad.push(`${m.file} requires a missing file: ${r}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('no cycle: every migration has a place in the apply order', () => {
    const order = L.applyOrder(migrations);
    expect(order).toHaveLength(migrations.length);
    const at = new Map(order.map((f, i) => [f, i]));
    for (const m of migrations) for (const r of L.requiresOf(m.sql)) expect(at.get(r)).toBeLessThan(at.get(m.file));
  });

  test('a migration that uses a table another migration creates requires it (legacy allowlist aside)', () => {
    const found = L.undeclaredUses(migrations).map(key);
    const fresh = found.filter((k) => !ALLOW.undeclared.includes(k));
    expect(fresh).toEqual([]);
  });

  test('the allowlist only shrinks: every entry still applies', () => {
    const found = new Set(L.undeclaredUses(migrations).map(key));
    expect(ALLOW.undeclared.filter((k) => !found.has(k))).toEqual([]);
  });
});

describe('bot-migrations-lib: the order rules on small inputs', () => {
  const mig = (file, sql) => ({ file, sql });

  test('requiresOf: one or more per line, a ( note ignored', () => {
    expect(L.requiresOf('-- requires: a.sql (creates t; it needs b.sql)\n-- requires: c.sql, d.sql\nselect 1;')).toEqual(['a.sql', 'c.sql', 'd.sql']);
    expect(L.requiresOf('-- a note that requires: nothing\nselect 1;')).toEqual([]);
  });

  test('applyOrder: a required file first, ties by name in code units (. before _)', () => {
    const ms = [mig('b.sql', '-- requires: c.sql\n'), mig('c.sql', ''), mig('a_x.sql', ''), mig('a.sql', '')];
    expect(L.applyOrder(ms)).toEqual(['a.sql', 'a_x.sql', 'c.sql', 'b.sql']);
  });

  test('applyOrder: a cycle and a missing target are named', () => {
    expect(() => L.applyOrder([mig('a.sql', '-- requires: b.sql'), mig('b.sql', '-- requires: a.sql')])).toThrow(/cycle: a\.sql -> b\.sql -> a\.sql/);
    expect(() => L.applyOrder([mig('a.sql', '-- requires: gone.sql')])).toThrow(/missing migration: a\.sql -> gone\.sql/);
  });

  test('undeclaredUses: ALTER, index, REFERENCES and policy uses; a transitive requires counts', () => {
    const ms = [
      mig('t.sql', 'CREATE TABLE IF NOT EXISTS public.t (id uuid primary key);'),
      mig('u.sql', 'CREATE TABLE u (id int, t_id uuid REFERENCES t(id));'),
      mig('v.sql', 'ALTER TABLE public.t ADD COLUMN IF NOT EXISTS x int; CREATE INDEX IF NOT EXISTS v_idx ON t (x);'),
      mig('w.sql', '-- requires: y.sql\nCREATE POLICY p ON t FOR SELECT USING (true);'),
      mig('y.sql', '-- requires: t.sql\nselect 1;'),
      mig('z.sql', "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ALTER TABLE t ADD COLUMN q int; END $$;"),
    ];
    expect(L.undeclaredUses(ms).map(key).sort()).toEqual(['u.sql uses t (t.sql)', 'v.sql uses t (t.sql)']);
  });

  test('a DO block\'s DDL is read; a function body is not', () => {
    const ms = [mig('t.sql', 'CREATE TABLE t (id int);'), mig('d.sql', "DO $$ BEGIN IF true THEN ALTER TABLE t ADD COLUMN k int; END IF; END $$;")];
    expect(L.undeclaredUses(ms).map(key)).toEqual(['d.sql uses t (t.sql)']);
  });
});
