/**
 * Every table a bot migration creates (bot/database/migrations, applied in `-- requires:` order, a later DROP,
 * DROP COLUMN or RENAME COLUMN honoured) has a CREATE TABLE in the schema mirror, 00_complete-schema.sql, with the
 * SAME column names: none only in the migrations, none only in the mirror. A fresh install is built from the mirror
 * alone, so a column one side lacks is a column a clone and a deployed tier disagree on. schema-mirrors-migrations
 * reads infrastructure/supabase/migrations and the columns ALTERs add; this reads the bot migrations and the
 * CREATE TABLE bodies too, both ways. Names only, never types.
 * Tables that drifted before this gate are in bot-migrations-mirror.allowlist.json with their exact names; that
 * list may only shrink (a name that no longer drifts fails until it is removed).
 */
const fs = require('fs');
const L = require('./bot-migrations-lib');
const ALLOW = require('./bot-migrations-mirror.allowlist.json');

const lines = (d) => [
  ...(d.mirror ? [] : [`${d.table}: no CREATE TABLE in the mirror (${d.creator})`]),
  ...d.onlyMigration.map((c) => `${d.table}.${c}: in the migrations (${d.creator}), not in the mirror`),
  ...d.onlyMirror.map((c) => `${d.table}.${c}: in the mirror, not in the migrations`),
];
const allowed = Object.entries(ALLOW.tables).flatMap(([table, a]) => lines({ table, creator: a.creator, mirror: a.mirror !== false, onlyMigration: a.onlyMigration || [], onlyMirror: a.onlyMirror || [] }));

describe('bot migrations: the schema mirror has the same columns', () => {
  const migrations = L.readMigrations();
  const drift = L.mirrorDrift(migrations, fs.readFileSync(L.SCHEMA, 'utf8'));
  const found = drift.flatMap(lines);

  test('the migrations and the mirror are read at all', () => {
    const { tables } = L.netTables(migrations);
    expect(tables.size).toBeGreaterThan(30);
    expect(L.mirrorColumns(fs.readFileSync(L.SCHEMA, 'utf8'), 'web_quiz_challenge_runs').size).toBeGreaterThan(20);
  });

  test('no column only one side has (legacy allowlist aside)', () => {
    expect(found.filter((l) => !allowed.includes(l))).toEqual([]);
  });

  test('the allowlist only shrinks: every entry still drifts', () => {
    expect(allowed.filter((l) => !found.includes(l))).toEqual([]);
  });
});

describe('bot-migrations-lib: the mirror rules on small inputs', () => {
  const mig = (file, sql) => ({ file, sql });

  test('a CREATE TABLE body: columns read, constraints skipped, quoted and public. names', () => {
    const t = new Map();
    L.apply(t, 'CREATE TABLE IF NOT EXISTS public."t" (id uuid PRIMARY KEY, "set" text, n numeric(4,2) CHECK (n > 0), CONSTRAINT t_chk CHECK (true), UNIQUE (id, "set"), PRIMARY KEY (id));');
    expect([...t.get('t')].sort()).toEqual(['id', 'n', 'set']);
  });

  test('ADD / DROP / RENAME COLUMN in order; ADD CONSTRAINT is not a column', () => {
    const t = new Map();
    L.apply(t, 'CREATE TABLE t (a int, b int); ALTER TABLE t ADD COLUMN IF NOT EXISTS c int, ADD CONSTRAINT k CHECK (a > 0), DROP COLUMN IF EXISTS b, DROP CONSTRAINT IF EXISTS k; ALTER TABLE t RENAME COLUMN a TO a2;');
    expect([...t.get('t')].sort()).toEqual(['a2', 'c']);
  });

  test('mirrorDrift: a missing column either way, a missing table, a dropped table not expected', () => {
    const ms = [
      mig('t.sql', 'CREATE TABLE t (id int, a int);'),
      mig('t2.sql', '-- requires: t.sql\nALTER TABLE t ADD COLUMN b int;'),
      mig('g.sql', 'CREATE TABLE gone (id int); DROP TABLE gone;'),
      mig('n.sql', 'CREATE TABLE nomirror (id int);'),
    ];
    const d = L.mirrorDrift(ms, 'CREATE TABLE t (id int, a int, extra text);');
    expect(d).toEqual([
      { table: 'nomirror', creator: 'n.sql', mirror: false, onlyMigration: ['id'], onlyMirror: [] },
      { table: 't', creator: 't.sql', mirror: true, onlyMigration: ['b'], onlyMirror: ['extra'] },
    ]);
  });

  test('the mirror\'s own ALTER TABLE … ADD COLUMN counts as declared', () => {
    expect(L.mirrorDrift([mig('t.sql', 'CREATE TABLE t (id int, a int);')], 'CREATE TABLE t (id int); ALTER TABLE t ADD COLUMN a int;')).toEqual([]);
  });
});
