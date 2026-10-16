/**
 * Every column a quiz service selects exists on its table.
 *
 * PostgREST answers a select naming a missing column with 42703 — on the live path, never in a unit test whose fake
 * answers any column. So every `.from(<table>)` chain under bot/shared/services/quiz/ (any depth) whose chain holds a
 * `.select(<cols>)` must name only columns the schema has.
 *
 * The schema: the strict-columns parser (bot/tests/quiz/web-quiz/strict-columns.js, `parse`: CREATE TABLE + ALTER
 * TABLE … ADD COLUMN), reused as is, over
 *   - the mirror, infrastructure/supabase/00_complete-schema.sql,
 *   - the migrations, bot/database/migrations/*.sql and infrastructure/supabase/migrations/*.sql (rollbacks skipped),
 *   - the production baseline dump, supabase/baseline/schema.sql.
 * A column any of them creates exists. (The mirror alone lags production on a dozen quiz columns; that gap is the
 * column-completeness gate's, not this one's.)
 *
 * Read from each select string: `*`, embedded relations `x(…)` and spreads are skipped; an alias `a:b` checks b;
 * `meta->x` checks meta; `c::text` checks c. The table and the string are read when they are literals, plain
 * templates, literals joined by +, a const the file binds that way, or a parameter of the enclosing same-file
 * function every call of which passes such a string. Anything else is dynamic and not checked (counted only).
 *
 * select-columns-exist.allowlist.json: { "<table>.<column>": "<reason>" } for the hits today (none). It only shrinks:
 * a new hit fails; a listed hit that is gone passes with a console.warn `CLEAN:` line.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./select-columns-exist.allowlist.json');
const { parse } = require('../../bot/tests/quiz/web-quiz/strict-columns');
const { REPO, walk, selectColumns, selectsOf, missingSelectedColumns, listVerdict } = require('./test-seam-gates-lib');

function schemaColumns() {
  const sqlIn = (dir) => {
    try {
      return fs.readdirSync(path.join(REPO, dir)).filter((n) => n.endsWith('.sql') && !/rollback/i.test(n))
        .map((n) => fs.readFileSync(path.join(REPO, dir, n), 'utf8'));
    } catch (_) { return []; }
  };
  const texts = [
    fs.readFileSync(path.join(REPO, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8'),
    ...sqlIn('bot/database/migrations'),
    ...sqlIn('infrastructure/supabase/migrations'),
    ...(fs.existsSync(path.join(REPO, 'supabase/baseline/schema.sql')) ? [fs.readFileSync(path.join(REPO, 'supabase/baseline/schema.sql'), 'utf8')] : []),
  ];
  const out = {};
  for (const t of texts) for (const [table, cols] of Object.entries(parse(t))) for (const c of cols) (out[table] = out[table] || new Set()).add(c);
  return out;
}

function scan(columns) {
  const hits = new Set();
  let dynamic = 0;
  for (const f of walk(path.join(REPO, 'bot/shared/services/quiz'), (n) => n.endsWith('.js'))) {
    const r = missingSelectedColumns(selectsOf(fs.readFileSync(f, 'utf8')), columns);
    r.hits.forEach((h) => hits.add(h));
    dynamic += r.dynamic;
  }
  return { hits: [...hits].sort(), dynamic };
}

describe('the rule, on in-memory sources', () => {
  const SCHEMA = [
    'CREATE TABLE IF NOT EXISTS students (',
    '  id uuid PRIMARY KEY,',
    '  student_name text,',
    '  meta jsonb',
    ');',
    'ALTER TABLE students ADD COLUMN IF NOT EXISTS list_id uuid;',
  ].join('\n');
  const cols = parse(SCHEMA);

  test('the select string: *, relations and spreads skipped; alias checks the column; json path and cast stripped', () => {
    expect(selectColumns('id, *, lists(id, name), ...x(y), nm:student_name, meta->lessons, meta->>a, id::text, "list_id"'))
      .toEqual(['id', 'student_name', 'meta', 'meta', 'id', 'list_id']);
  });

  test('a misspelt column is a hit; literal, concatenated, const and parameter strings are all read', () => {
    const src = [
      "const T = 'students';",
      "const COLS = 'id, '",
      "  + 'name';",
      'async function readIn(cols, col) {',
      '  return supabase.from(T).select(cols).in(col, []);',
      '}',
      "async function a() { await readIn('id, list_id, name', 'id'); await readIn(COLS, 'id'); }",
      "async function b() { return supabase.from('students').select('id, student_name').eq('id', 1); }",
      "async function c() { return supabase\n  .from('students')\n  .update({ x: 1 })\n  .eq('id', 1)\n  .select('id, nme:student_name, gone'); }",
    ].join('\n');
    expect(missingSelectedColumns(selectsOf(src), cols)).toEqual({ hits: ['students.name', 'students.name', 'students.gone'], dynamic: 0 });
  });

  test('a table the schema lacks is table.*; a dynamic table or string is counted, not checked; comments are not code', () => {
    const src = [
      "supabase.from('ghosts').select('id');",
      'supabase.from(name).select(\'id\');',
      'supabase.from(\'students\').select(`id, ${extra}`);',
      "supabase.from('students').select(flag ? 'id' : 'name');",
      "// supabase.from('students').select('nope');",
      "supabase.from('students').select();",
    ].join('\n');
    expect(missingSelectedColumns(selectsOf(src), cols)).toEqual({ hits: ['ghosts.*'], dynamic: 3 });
  });
});

describe('the tree', () => {
  test('every quiz-service select names columns the schema has, or is listed; nothing new', () => {
    const { hits } = scan(schemaColumns());
    for (const k of Object.keys(ALLOW)) expect([k, String(ALLOW[k]).length >= 10]).toEqual([k, true]);
    const { failures, cleans } = listVerdict(hits, Object.keys(ALLOW), 'is selected but the schema has no such column', 'select-columns-exist.allowlist.json');
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });
});
