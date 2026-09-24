/**
 * PLAN R8 §2.1 — `niete_lp_asset_sources`, the slide script of the EXACT lesson
 * version a teacher was served.
 *
 * The LP-born quiz is written from the slide script the served PDF was rendered
 * from (verification: the published slide script matched the served PDF on 50/50
 * OCR'd lessons; the stable-path enrichment is stale for 79% and is never used).
 * That only holds if the stored script is bound to the SAME version triple the
 * asset carries — so the shape of this table is the guard, not a convention:
 *
 *   - PK on asset_id REFERENCES niete_lp_assets(id) ON DELETE CASCADE
 *       one source row per asset; a deleted asset can never leave a dangling
 *       script that a quiz would then be written from.
 *   - UNIQUE (lesson_id, version_stamp, content_hash)
 *       the upsert key. Without it, two ingests of the same version make two
 *       rows and `resolveSlideScript` picks one at random.
 *   - verified NOT NULL
 *       how we know this script belongs to that PDF ('upload' | 'backfill:link'
 *       | 'backfill:link+ocr'). A nullable column would let an unprovenanced
 *       row look exactly like a proven one.
 *
 * No Postgres server runs in this environment, so the migration is not executed
 * here. These are static guards over the classes that make an
 * applied-by-someone-else migration dangerous: non-idempotent statements, a
 * destructive statement hiding in an additive file, and a missing constraint.
 * Applying it on sandbox is lane Z's step (task 2.4).
 */

const fs = require('fs');
const path = require('path');

const SQL_PATH = path.join(
  __dirname, '..', '..', 'infrastructure', 'supabase', 'migrations', 'V1.5.2__lp_asset_sources.sql',
);

/** Statements with `--` line comments stripped, so a comment can never satisfy a guard. */
function statementsOf(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/^\s*--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('V1.5.2__lp_asset_sources — niete_lp_asset_sources', () => {
  let sql;
  let code;          // comments stripped
  let statements;

  beforeAll(() => {
    sql = fs.readFileSync(SQL_PATH, 'utf8');
    statements = statementsOf(sql);
    code = statements.join(';\n');
  });

  test('the migration file exists and carries real DDL', () => {
    expect(sql.length).toBeGreaterThan(400);
    expect(statements.length).toBeGreaterThan(1);
  });

  test('creates niete_lp_asset_sources', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS\s+niete_lp_asset_sources/i);
  });

  // ── the shape the resolver depends on ────────────────────────────────────
  test('asset_id is the primary key and references niete_lp_assets(id) ON DELETE CASCADE', () => {
    expect(code).toMatch(/asset_id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+niete_lp_assets\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i);
  });

  test('UNIQUE (lesson_id, version_stamp, content_hash) — the upsert key', () => {
    expect(code).toMatch(/UNIQUE\s*\(\s*lesson_id\s*,\s*version_stamp\s*,\s*content_hash\s*\)/i);
  });

  test('the version triple and the script itself are NOT NULL', () => {
    for (const col of ['lesson_id', 'version_stamp', 'content_hash']) {
      expect(code).toMatch(new RegExp(`${col}\\s+text\\s+NOT NULL`, 'i'));
    }
    expect(code).toMatch(/slide_script\s+jsonb\s+NOT NULL/i);
  });

  test('verified is NOT NULL — an unprovenanced row must not be storable', () => {
    expect(code).toMatch(/verified\s+text\s+NOT NULL/i);
  });

  test('source_url is nullable — the upload path has no URL to record', () => {
    expect(code).toMatch(/source_url\s+text(?!\s+NOT NULL)/i);
  });

  test('ingested_at defaults to now()', () => {
    expect(code).toMatch(/ingested_at\s+timestamptz\s+NOT NULL\s+DEFAULT\s+now\(\)/i);
  });

  test('lesson_id is indexed (the backfill and the per-lesson reads scan by it)', () => {
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_niete_lp_asset_sources_lesson\s+ON\s+niete_lp_asset_sources\s*\(\s*lesson_id\s*\)/i);
  });

  // ── idempotency: lane Z applies this, and a re-run must be a no-op ───────
  test('every CREATE TABLE is IF NOT EXISTS', () => {
    const bad = statements.filter((s) => /^CREATE TABLE/i.test(s) && !/^CREATE TABLE IF NOT EXISTS/i.test(s));
    expect(bad).toEqual([]);
  });

  test('every CREATE INDEX is IF NOT EXISTS', () => {
    const bad = statements.filter((s) => /^CREATE (UNIQUE )?INDEX/i.test(s) && !/IF NOT EXISTS/i.test(s));
    expect(bad).toEqual([]);
  });

  // ── it must not destroy anything ─────────────────────────────────────────
  test('no DROP / TRUNCATE / DELETE outside the commented -- down block', () => {
    const bad = statements.filter((s) => /^(DROP|TRUNCATE|DELETE)\b/i.test(s));
    expect(bad).toEqual([]);
  });

  test('carries a commented -- down block naming the index and the table', () => {
    const commentLines = sql.split('\n').filter((l) => /^\s*--/.test(l)).join('\n');
    expect(commentLines).toMatch(/--\s*down/i);
    expect(commentLines).toMatch(/DROP INDEX IF EXISTS\s+idx_niete_lp_asset_sources_lesson/i);
    expect(commentLines).toMatch(/DROP TABLE IF EXISTS\s+niete_lp_asset_sources/i);
  });

  test('the version is not already taken by another migration file', () => {
    const dir = path.dirname(SQL_PATH);
    const same = fs.readdirSync(dir).filter((f) => f.startsWith('V1.5.2__'));
    expect(same).toEqual(['V1.5.2__lp_asset_sources.sql']);
  });
});

/**
 * A clone is bootstrapped from 00_complete-schema.sql alone (`npm run bootstrap:db` never
 * reads migrations/), so a table that exists only in its migration is a table a fresh
 * install does not have. The store names it through a constant, which is why the
 * schema-completeness guard (it greps `.from('<literal>')`) could not see the gap.
 *
 * "Mirrored" is asserted as statement equality, not as "a table of that name exists":
 * a reference copy that drifts from the migration (a lost NOT NULL, a different upsert
 * key) is exactly the reference schema lying about the live one.
 */
describe('00_complete-schema.sql mirrors V1.5.2 exactly', () => {
  const SCHEMA_PATH = path.join(
    __dirname, '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql',
  );

  /** The one statement `re` matches, with `--` comments stripped and whitespace collapsed. */
  function statement(sqlText, re) {
    const flat = sqlText
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),;])\s*/g, '$1');
    const found = flat.match(re);
    return found ? found[0] : null;
  }

  const TABLE_RE = /CREATE TABLE IF NOT EXISTS niete_lp_asset_sources\([^;]*\);/i;
  const INDEX_RE = /CREATE INDEX IF NOT EXISTS idx_niete_lp_asset_sources_lesson ON niete_lp_asset_sources\(lesson_id\);/i;

  let migration;
  let schema;
  beforeAll(() => {
    migration = fs.readFileSync(SQL_PATH, 'utf8');
    schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  });

  test('the table is declared, column for column and constraint for constraint', () => {
    const want = statement(migration, TABLE_RE);
    expect(want).not.toBeNull();
    expect(statement(schema, TABLE_RE)).toBe(want);
  });

  test('the lesson index is declared', () => {
    const want = statement(migration, INDEX_RE);
    expect(want).not.toBeNull();
    expect(statement(schema, INDEX_RE)).toBe(want);
  });

  test('it is declared AFTER niete_lp_assets, which its primary key references', () => {
    const parent = schema.search(/CREATE TABLE IF NOT EXISTS niete_lp_assets\s*\(/i);
    const child = schema.search(/CREATE TABLE IF NOT EXISTS niete_lp_asset_sources\s*\(/i);
    expect(parent).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(parent);
  });
});
