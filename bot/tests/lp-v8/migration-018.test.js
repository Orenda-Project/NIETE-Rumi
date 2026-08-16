/**
 * FEAT-059 / bd-t56hp — migration 018 shape guard (TDD, red first).
 *
 * This migration will be applied to the LIVE NIETE Supabase by the operator,
 * against a schema this agent could not read (no NIETE Supabase credentials in
 * the root .env or 03_ACCESS_CREDENTIALS.md — see DELIVERY_WIRING_PLAN.md §0).
 * It must therefore be safe against *either* shape the DB might be in, and safe
 * to re-run.
 *
 * No Postgres server is available in this environment (psql client only), so
 * the migration is NOT executed here. These are static guards over the exact
 * risk classes that make an unexecutable-by-us migration dangerous:
 *   - a statement that is not idempotent (second run errors, leaves it half-applied)
 *   - a destructive statement hiding in an "additive" migration
 *   - a missing constraint that would let two "current" assets exist for one lesson
 * Live execution + verification is READY-FOR-GO item 2.
 */

const fs = require('fs');
const path = require('path');

const SQL_PATH = path.join(__dirname, '..', '..', 'database', 'migrations', '018_niete_lp_assets_and_downloads.sql');

describe('migration 018 — niete_lp_assets + niete_lp_downloads', () => {
  let sql;
  let statements;

  beforeAll(() => {
    sql = fs.readFileSync(SQL_PATH, 'utf8');
    statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  });

  test('exists and is non-trivial', () => {
    expect(sql.length).toBeGreaterThan(500);
    expect(statements.length).toBeGreaterThan(5);
  });

  // ── idempotency ──────────────────────────────────────────────────────────
  test('every CREATE TABLE is IF NOT EXISTS', () => {
    const bad = statements.filter((s) => /^CREATE TABLE/i.test(s) && !/^CREATE TABLE IF NOT EXISTS/i.test(s));
    expect(bad).toEqual([]);
  });

  test('every CREATE INDEX is IF NOT EXISTS', () => {
    const bad = statements.filter((s) => /^CREATE (UNIQUE )?INDEX/i.test(s) && !/IF NOT EXISTS/i.test(s));
    expect(bad).toEqual([]);
  });

  test('every ADD COLUMN is IF NOT EXISTS', () => {
    const bad = statements.filter((s) => /ADD COLUMN/i.test(s) && !/ADD COLUMN IF NOT EXISTS/i.test(s));
    expect(bad).toEqual([]);
  });

  // ── it must not destroy anything ─────────────────────────────────────────
  test('contains no destructive statement', () => {
    const destructive = /\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\w+\s+TYPE)\b/i;
    const bad = statements.filter((s) => destructive.test(s));
    expect(bad).toEqual([]);
  });

  test('touches only the two new tables plus an additive lp_feedback column', () => {
    const written = new Set();
    for (const s of statements) {
      const m = /^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE(?: IF EXISTS)?)\s+([a-z_]+)/i.exec(s);
      if (m) written.add(m[1].toLowerCase());
    }
    expect([...written].sort()).toEqual(['lp_feedback', 'niete_lp_assets', 'niete_lp_downloads']);
  });

  // ── the invariants the endpoint depends on ───────────────────────────────
  test('niete_lp_assets carries the full provenance chain', () => {
    const ddl = /CREATE TABLE IF NOT EXISTS niete_lp_assets[\s\S]*?\n\);/i.exec(sql)[0];
    for (const col of [
      'lesson_id', 'catalog_version', 'version_stamp', 'content_hash', 'r2_key',
      'bytes', 'source_bytes', 'source_sha1', 'prompt_layer_sha', 'rendered_at',
      'asset_kind', 'is_current', 'superseded_at',
    ]) {
      expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  test('exactly one CURRENT asset per (lesson, kind) is enforced by a partial unique index', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+\w+[\s\S]*?ON niete_lp_assets\s*\(lesson_id,\s*asset_kind\)[\s\S]*?WHERE is_current/i);
  });

  test('re-uploading identical bytes is a no-op — unique on (lesson, kind, content_hash)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+\w+[\s\S]*?ON niete_lp_assets\s*\(lesson_id,\s*asset_kind,\s*content_hash\)/i);
  });

  test('asset_kind is constrained to lesson | answer_key', () => {
    expect(sql).toMatch(/asset_kind[\s\S]{0,120}CHECK\s*\(\s*asset_kind IN \('lesson',\s*'answer_key'\)\s*\)/i);
  });

  test('every delivery attempt is recordable — status is sent | failed, not just sent', () => {
    expect(sql).toMatch(/status\s+TEXT\s+NOT NULL\s+CHECK\s*\(status IN \('sent',\s*'failed'\)\)/i);
  });

  test('the ✓ tick has its own partial index on (user_id, lesson_id) WHERE sent', () => {
    expect(sql).toMatch(/ON niete_lp_downloads\s*\(user_id,\s*lesson_id\)\s*WHERE status = 'sent'/i);
  });

  test('a download row survives its asset being superseded (ON DELETE SET NULL)', () => {
    expect(sql).toMatch(/asset_id\s+UUID REFERENCES niete_lp_assets\(id\) ON DELETE SET NULL/i);
  });

  test('the reserved voicenote column is added additively to lp_feedback', () => {
    expect(sql).toMatch(/ALTER TABLE lp_feedback\s+ADD COLUMN IF NOT EXISTS useful_component/i);
    expect(sql).toMatch(/useful_component[\s\S]{0,160}CHECK\s*\(useful_component IN \('lp_only',\s*'voicenote_only',\s*'both'\)\)/i);
  });

  test('the migration is registered in the apply script', () => {
    const applyPath = path.join(__dirname, '..', '..', 'scripts', 'migration', 'apply-018-lp-v8-assets.js');
    expect(fs.existsSync(applyPath)).toBe(true);
    expect(fs.readFileSync(applyPath, 'utf8')).toContain('018_niete_lp_assets_and_downloads.sql');
  });
});
