'use strict';
/**
 * V1.9.0 — niete_lp612_segments grade check widens 6-12 -> 1-12 (bd-rj6w0n.14.13).
 * Gilgit-Baltistan Grade 1-5 NBF books (curriculum 'nbf_snc', V1.8.6's column) share the 6-12 serving tables,
 * so a Grade 1-5 segment must be insertable. The curriculum column itself is V1.8.6's; this migration never
 * touches it. SQL-text contract test (no database): re-runnable, mirrored in the fresh-install schema, reversed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../infrastructure/supabase');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('migrations/V1.9.0__lp612_segments_grade_1_12.sql');
const DOWN = read('migrations/ROLLBACK_V1.9.0__lp612_segments_grade_1_12.sql');
const SCHEMA = read('00_complete-schema.sql');

test('widens the grade check from 6-12 to 1-12, re-runnably', () => {
  expect(UP).toContain('drop constraint if exists niete_lp612_segments_grade_check');
  expect(UP).toContain('add constraint niete_lp612_segments_grade_check check (grade between 1 and 12)');
});

test("leaves V1.8.6's curriculum column alone", () => {
  expect(UP).not.toContain('curriculum');
  expect(DOWN).not.toContain('curriculum');
});

test('reloads PostgREST last, up and down', () => {
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(DOWN.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback restores the 6-12 grade check', () => {
  expect(DOWN).toContain('drop constraint if exists niete_lp612_segments_grade_check');
  expect(DOWN).toContain('add constraint niete_lp612_segments_grade_check check (grade between 6 and 12)');
});

test('the fresh-install schema carries the 1-12 grade check', () => {
  expect(SCHEMA).toContain('grade integer not null check (grade between 1 and 12), subject text not null, medium');
  expect(SCHEMA).not.toContain('grade integer not null check (grade between 6 and 12), subject text not null, medium');
});
