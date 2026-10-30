'use strict';
/**
 * V1.8.6 — a curriculum on assessment_topics and niete_lp612_segments (bd-97daxo.4 / .5).
 *
 * Every existing row is ICT's, so the column is NOT NULL DEFAULT 'ict': the backfill is the default,
 * and a later GB load is rows tagged 'gb' — no code change. SQL-text contract test (no database):
 * re-runnable, no transaction control (migrate.js runs it through exec_sql), mirrored in the
 * fresh-install schema, reversed by its rollback.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../infrastructure/supabase');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const raw = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UP = read('migrations/V1.8.6__book_curriculum.sql');
const DOWN = read('migrations/ROLLBACK_V1.8.6__book_curriculum.sql');
const SCHEMA = read('00_complete-schema.sql');

/** The body of one CREATE TABLE in the fresh-install schema. */
const tableBody = (name) => {
  const at = SCHEMA.indexOf(`create table if not exists ${name} (`);
  expect(at).toBeGreaterThan(-1);
  return SCHEMA.slice(at, SCHEMA.indexOf(');', at));
};

test("adds curriculum TEXT NOT NULL DEFAULT 'ict' to both tables, IF NOT EXISTS", () => {
  expect(UP).toContain("alter table assessment_topics add column if not exists curriculum text not null default 'ict'");
  expect(UP).toContain("alter table niete_lp612_segments add column if not exists curriculum text not null default 'ict'");
});

test("renames Gilgit-Baltistan's curriculum key gb -> nbf_snc (V1.8.5 is not edited), and the rollback reverses it", () => {
  expect(UP).toContain("update region_features set curriculum_key = 'nbf_snc', updated_at = now() where region = 'gilgit-baltistan' and curriculum_key = 'gb'");
  expect(DOWN).toContain("update region_features set curriculum_key = 'gb', updated_at = now() where region = 'gilgit-baltistan' and curriculum_key = 'nbf_snc'");
  expect(read('migrations/V1.8.5__region_registry.sql')).toContain("'gb', false");
});

test('has no transaction control and reloads PostgREST last, up and down', () => {
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('carries the D6 classification and D7 owner in its header', () => {
  const head = raw('migrations/V1.8.6__book_curriculum.sql');
  expect(head).toMatch(/DATA CLASSIFICATION \(D6\)/);
  expect(head).toMatch(/OWNER \(D7\)/);
});

test('the rollback drops both columns IF EXISTS, each DROP reviewed', () => {
  expect(DOWN).toContain('alter table assessment_topics drop column if exists curriculum');
  expect(DOWN).toContain('alter table niete_lp612_segments drop column if exists curriculum');
  const lines = raw('migrations/ROLLBACK_V1.8.6__book_curriculum.sql').split('\n');
  lines.forEach((l, i) => {
    if (/^\s*ALTER TABLE .* DROP /i.test(l)) expect(lines[i - 1]).toMatch(/-- destructive: reviewed/);
  });
});

test('the fresh-install schema carries the column in both tables', () => {
  expect(tableBody('assessment_topics')).toContain("curriculum text not null default 'ict'");
  expect(tableBody('niete_lp612_segments')).toContain("curriculum text not null default 'ict'");
});
