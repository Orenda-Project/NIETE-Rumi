'use strict';
/**
 * The child's-language table's migration stays additive and matches what the code reads and writes: one new table
 * (canonical_id, language en|ur, source join|chosen), idempotent, RLS on with no policy and no grant; the rollback drops
 * that table only; the full-schema mirror has the same table. The repo's own columns and table name are checked against it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const UP = code(read('bot/database/migrations/child_language.sql'));
const DOWN = code(read('bot/database/migrations/child_language_rollback.sql'));
const MIRROR = code(read('infrastructure/supabase/00_complete-schema.sql'));
const tableOf = (sql) => (/CREATE TABLE IF NOT EXISTS child_language \(([\s\S]*?)\n\);/.exec(sql) || [])[1];
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

test('additive: one CREATE TABLE IF NOT EXISTS, RLS on, nothing else touched (no DROP, ALTER of another table, policy or grant)', () => {
  expect(UP.match(/CREATE TABLE/g)).toHaveLength(1);
  expect(UP).toMatch(/CREATE TABLE IF NOT EXISTS child_language \(/);
  expect(UP).toMatch(/ALTER TABLE child_language ENABLE ROW LEVEL SECURITY;/);
  expect(UP.match(/ALTER TABLE/g)).toHaveLength(1);
  expect(UP).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|GRANT|POLICY|INSERT)\b/i);
});

test('the columns the code reads and writes, with their checks', () => {
  const t = squash(tableOf(UP));
  expect(t).toMatch(/canonical_id uuid PRIMARY KEY/);
  expect(t).toMatch(/language text NOT NULL CHECK \(language IN \('en','ur'\)\)/);
  expect(t).toMatch(/source text NOT NULL CHECK \(source IN \('join','chosen'\)\)/);
  expect(t).toMatch(/set_at timestamptz NOT NULL DEFAULT now\(\)/);
  const repo = read('bot/shared/services/quiz/child-language.repo.js');
  expect(repo).toMatch(/const TABLE = 'child_language';/);
  expect(repo).toMatch(/select\('canonical_id, language, source'\)/);
});

test('the rollback drops that table only, safely twice', () => {
  expect(squash(DOWN)).toBe('DROP TABLE IF EXISTS child_language;');
});

test('the full-schema mirror has the same table and RLS line', () => {
  expect(squash(tableOf(MIRROR))).toBe(squash(tableOf(UP)));
  expect(MIRROR).toMatch(/ALTER TABLE child_language ENABLE ROW LEVEL SECURITY;/);
});
