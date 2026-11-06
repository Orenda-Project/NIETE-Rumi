'use strict';
/**
 * V1.9.1 — Gilgit-Baltistan's curriculum_key is 'nbf_snc' on every database (bd-rj6w0n.14.15).
 *
 * V1.8.6 renames GB's key 'gb' -> 'nbf_snc', but the registry row is only inserted by V1.8.8, with 'gb'.
 * Applied in order on a fresh database or production, V1.8.6 matches nothing and GB stays on 'gb',
 * so its teachers would get ICT's books. V1.9.1 re-applies the rename after both. SQL-text contract
 * test (no database), like v1-8-6-book-curriculum.test.js.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.1__gb_curriculum_key.sql');
const DOWN = read('ROLLBACK_V1.9.1__gb_curriculum_key.sql');

test("re-applies V1.8.6's rename after V1.8.8 has inserted GB with 'gb', matching only a row still on 'gb'", () => {
  expect(read('V1.8.8__region_registry.sql')).toContain("'gilgit-baltistan', 'moawin', 'gilgit-baltistan', 1, 'gb', false");
  expect(UP).toContain("update region_features set curriculum_key = 'nbf_snc', updated_at = now() where region = 'gilgit-baltistan' and curriculum_key = 'gb'");
});

test('changes nothing else: one UPDATE, no DDL, no transaction control, PostgREST reload last', () => {
  expect(UP.match(/\bupdate\b/g)).toHaveLength(1);
  expect(UP).not.toMatch(/\b(alter|drop|create|insert|delete|truncate)\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback is a no-op: on a database where V1.8.6 already renamed, V1.9.1 changed nothing to undo', () => {
  expect(DOWN).not.toMatch(/\b(update|alter|drop|insert|delete)\b/);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});
