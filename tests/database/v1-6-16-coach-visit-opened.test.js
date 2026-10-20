'use strict';
/**
 * V1.6.16 — coach_visit_requests.opened_at (bd-tbprit.7, the list's blue dot).
 * SQL-text contract test (no database): re-runnable, mirrored in the fresh-install schema, and reversed by
 * its rollback.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../infrastructure/supabase');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('migrations/V1.6.16__coach_visit_opened.sql');
const DOWN = read('migrations/ROLLBACK_V1.6.16__coach_visit_opened.sql');

test('adds opened_at as a timestamptz, IF NOT EXISTS', () => {
  expect(UP).toContain('alter table coach_visit_requests add column if not exists opened_at timestamptz');
});

test('reloads PostgREST last, up and down', () => {
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops the column IF EXISTS and touches nothing else', () => {
  const stmts = DOWN.split(';').map((s) => s.trim()).filter(Boolean);
  expect(stmts).toEqual(['alter table coach_visit_requests drop column if exists opened_at', "notify pgrst, 'reload schema'"]);
});

test('the fresh-install schema carries the column', () => {
  expect(read('00_complete-schema.sql')).toContain('alter table coach_visit_requests add column if not exists opened_at timestamptz');
});
