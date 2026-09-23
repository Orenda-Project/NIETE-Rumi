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
