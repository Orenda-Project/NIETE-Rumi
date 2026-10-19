/**
 * Every table a bot migration creates (bot/database/migrations, applied in `-- requires:` order, a later DROP,
 * DROP COLUMN or RENAME COLUMN honoured) has a CREATE TABLE in the schema mirror, 00_complete-schema.sql, with the
 * SAME column names: none only in the migrations, none only in the mirror. A fresh install is built from the mirror
 * alone, so a column one side lacks is a column a clone and a deployed tier disagree on. schema-mirrors-migrations
 * reads infrastructure/supabase/migrations and the columns ALTERs add; this reads the bot migrations and the
 * CREATE TABLE bodies too, both ways. Names only, never types.
 * Tables that drifted before this gate are in bot-migrations-mirror.allowlist.json with their exact names; that
 * list may only shrink: a drift not on it fails; a listed name that no longer drifts prints a CLEAN: warning, and one
 * whose creating migration is not in this tree a GONE: warning, and both pass (the list is pruned on the branch that
 * owns it). Only the migrations present in the tree are compared, never a list of another branch's files.
 */
const fs = require('fs');
const L = require('./bot-migrations-lib');
const ALLOW = require('./bot-migrations-mirror.allowlist.json');

const lines = (d) => [
  ...(d.mirror ? [] : [`${d.table}: no CREATE TABLE in the mirror (${d.creator})`]),
  ...d.onlyMigration.map((c) => `${d.table}.${c}: in the migrations (${d.creator}), not in the mirror`),
  ...d.onlyMirror.map((c) => `${d.table}.${c}: in the mirror, not in the migrations`),
];
const { listVerdict, report } = require('./ratchet-verdict-lib');

/** The allowlist as [{ line, creator }]: each drift line it allows and the migration that creates its table. */
const entriesOf = (allow) => Object.entries(allow.tables).flatMap(([table, a]) => lines({ table, creator: a.creator, mirror: a.mirror !== false, onlyMigration: a.onlyMigration || [], onlyMirror: a.onlyMirror || [] }).map((line) => ({ line, creator: a.creator })));

/** Drift lines found vs allowed: a new line fails; a listed line no longer found warns (GONE when its creator is absent). */
function mirrorVerdict(found, entries, presentFiles) {
  const creatorOf = new Map(entries.map((e) => [e.line, e.creator]));
  return listVerdict(found, entries.map((e) => e.line), {
    what: 'is new drift: give the mirror and the migrations the same columns',
    list: 'bot-migrations-mirror.allowlist.json',
    gone: (line) => !presentFiles.has(creatorOf.get(line)),
  });
}

describe('bot migrations: the schema mirror has the same columns', () => {
  const migrations = L.readMigrations();
  const drift = L.mirrorDrift(migrations, fs.readFileSync(L.SCHEMA, 'utf8'));
  const found = drift.flatMap(lines);

  test('the migrations and the mirror are read at all', () => {
    const { tables } = L.netTables(migrations);
    expect(tables.size).toBeGreaterThan(30);
    expect(L.mirrorColumns(fs.readFileSync(L.SCHEMA, 'utf8'), 'web_quiz_challenge_runs').size).toBeGreaterThan(20);
  });

  test('no column only one side has (legacy allowlist aside); a fixed or absent entry is a warning', () => {
    expect(report(mirrorVerdict(found, entriesOf(ALLOW), new Set(migrations.map((m) => m.file))))).toEqual([]);
  });
});

describe('the mirror verdict, on a seeded allowlist', () => {
  const entries = [
    { line: 't.a: in the migrations (t.sql), not in the mirror', creator: 't.sql' },
    { line: 't.b: in the migrations (t.sql), not in the mirror', creator: 't.sql' },
    { line: 'u.c: in the mirror, not in the migrations', creator: 'u.sql' },
  ];
  const present = new Set(['t.sql']);

  test('every listed line still drifts and nothing new: pass, no line', () => {
    expect(mirrorVerdict(entries.map((e) => e.line), entries, new Set(['t.sql', 'u.sql']))).toEqual({ failures: [], warnings: [] });
  });

  test('a listed line that no longer drifts (below the list): CLEAN warning, pass', () => {
    const v = mirrorVerdict([entries[0].line, entries[2].line], entries, new Set(['t.sql', 'u.sql']));
    expect(v.failures).toEqual([]);
    expect(v.warnings).toEqual([`CLEAN: ${entries[1].line} is fixed. Remove it from bot-migrations-mirror.allowlist.json.`]);
  });

  test('a listed line whose creating migration is not in this tree: GONE warning, pass', () => {
    const v = mirrorVerdict(entries.slice(0, 2).map((e) => e.line), entries, present);
    expect(v.failures).toEqual([]);
    expect(v.warnings).toEqual([`GONE: ${entries[2].line} names a file not in this tree. Remove it from bot-migrations-mirror.allowlist.json.`]);
  });

  test('a new drift line fails', () => {
    const v = mirrorVerdict([...entries.map((e) => e.line), 't.z: in the mirror, not in the migrations'], entries, new Set(['t.sql', 'u.sql']));
    expect(v.failures).toEqual(['NEW: t.z: in the mirror, not in the migrations is new drift: give the mirror and the migrations the same columns.']);
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
