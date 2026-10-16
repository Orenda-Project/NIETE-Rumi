/**
 * The bot migrations' `-- requires: <file>.sql` headers are the apply order (bot-migrations-lib.js `order`):
 *   - every file a header names exists and is a forward migration (not a rollback, not itself);
 *   - the headers have no cycle, so every migration has a place in the order;
 *   - a migration that uses a table another migration creates (ALTER TABLE, an index, a policy or trigger on it,
 *     a REFERENCES) requires that migration, directly or through another.
 * The last rule came after the order had been typed by hand once and was wrong. The files that predate it are in
 * bot-migrations-order.allowlist.json, one line per use; that list may only shrink: a use not on it fails; a listed
 * use that no longer applies prints a CLEAN: warning, and one naming a migration not in this tree a GONE: warning, and
 * both pass (the list is pruned on the branch that owns it).
 */
const L = require('./bot-migrations-lib');
const ALLOW = require('./bot-migrations-order.allowlist.json');

const { listVerdict, report } = require('./ratchet-verdict-lib');

const key = (u) => `${u.file} uses ${u.table} (${u.creator})`;

/** Undeclared uses found vs allowed: a new one fails; a listed one no longer found warns (GONE when a file is absent). */
function orderVerdict(found, allowed, presentFiles) {
  return listVerdict(found, allowed, {
    what: 'is undeclared: add the -- requires: header',
    list: 'bot-migrations-order.allowlist.json',
    gone: (k) => {
      const m = /^(\S+) uses \S+ \((\S+)\)$/.exec(k);
      return !m || !presentFiles.has(m[1]) || !presentFiles.has(m[2]);
    },
  });
}

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

  test('a migration that uses a table another migration creates requires it (legacy allowlist aside; a fixed or absent entry warns)', () => {
    const found = L.undeclaredUses(migrations).map(key);
    expect(report(orderVerdict(found, ALLOW.undeclared, files))).toEqual([]);
  });
});

describe('a header the order gate cannot infer: a column, not a table', () => {
  test('the sampling migration requires the runs v2 migration (it reads the record column that file adds)', () => {
    const m = L.readMigrations().find((x) => x.file === 'web_quiz_challenge_runs_sampling.sql');
    expect(m).toBeDefined();
    expect(L.requiresOf(m.sql)).toEqual(expect.arrayContaining(['web_quiz_challenge.sql', 'web_quiz_challenge_runs_v2.sql']));
    const order = L.applyOrder(L.readMigrations());
    expect(order.indexOf('web_quiz_challenge_runs_v2.sql')).toBeLessThan(order.indexOf('web_quiz_challenge_runs_sampling.sql'));
  });
});

describe('the order verdict, on a seeded allowlist', () => {
  const listed = ['a.sql uses t (t.sql)', 'b.sql uses t (t.sql)', 'gone.sql uses t (t.sql)'];
  const present = new Set(['a.sql', 'b.sql', 't.sql']);

  test('a listed use that now has its header (below the list): CLEAN warning, pass', () => {
    const v = orderVerdict(['a.sql uses t (t.sql)'], listed.slice(0, 2), present);
    expect(v).toEqual({ failures: [], warnings: ['CLEAN: b.sql uses t (t.sql) is fixed. Remove it from bot-migrations-order.allowlist.json.'] });
  });

  test('a listed use whose migration is not in this tree: GONE warning, pass', () => {
    const v = orderVerdict(listed.slice(0, 2), listed, present);
    expect(v).toEqual({ failures: [], warnings: ['GONE: gone.sql uses t (t.sql) names a file not in this tree. Remove it from bot-migrations-order.allowlist.json.'] });
  });

  test('a new undeclared use fails', () => {
    const v = orderVerdict([...listed.slice(0, 2), 'c.sql uses t (t.sql)'], listed.slice(0, 2), present);
    expect(v.failures).toEqual(['NEW: c.sql uses t (t.sql) is undeclared: add the -- requires: header.']);
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
