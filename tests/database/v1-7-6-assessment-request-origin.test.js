'use strict';
/**
 * V1.7.6 — assessment_requests.origin (bd-pw1ccr.1): which door a paper request came through, so the A/B test's
 * "1 in 5 of report schools' papers came from the report's button" can be counted. NULL = any other door (every
 * existing row); 'report' = the Class Quiz Traffic Light report's Make topic paper button.
 * SQL-text contract test (no database): re-runnable, mirrored in the fresh-install schema, reversed by its rollback.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../infrastructure/supabase');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('migrations/V1.7.6__assessment_request_origin.sql');
const DOWN = read('migrations/ROLLBACK_V1.7.6__assessment_request_origin.sql');

test("adds origin as a nullable text holding only 'report', IF NOT EXISTS", () => {
  expect(UP).toContain("alter table assessment_requests add column if not exists origin text check (origin in ('report'))");
  expect(UP).not.toContain('not null');
});

test('reloads PostgREST last, up and down', () => {
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops the column IF EXISTS and touches nothing else', () => {
  const stmts = DOWN.split(';').map((s) => s.trim()).filter(Boolean);
  expect(stmts).toEqual(['alter table assessment_requests drop column if exists origin', "notify pgrst, 'reload schema'"]);
});

test('the fresh-install schema carries the column', () => {
  expect(read('00_complete-schema.sql')).toContain("origin text check (origin in ('report'))");
});
