'use strict';
/**
 * V1.9.7 — "Make my own" for grades 1–5 (bd-snkn32.4). SQL-text contract test (no database).
 * The EXISTING own-plan table is widened, never a new LP table (docs/lesson-plan-data-model-debt.md): a row names a
 * 6-12 segment OR a grades 1–5 day (lesson_id), exactly one; r2_key stays under lp612/.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.7__own_plans_k5_lessons.sql');
const DOWN = read('ROLLBACK_V1.9.7__own_plans_k5_lessons.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');

test('widens the existing table: a nullable lesson_id, segment_id no longer required, exactly one of the two', () => {
  expect(UP).toContain('alter table niete_lp612_own_plans add column if not exists lesson_id text');
  expect(UP).toContain('alter table niete_lp612_own_plans alter column segment_id drop not null');
  expect(UP).toMatch(/add constraint \w+ check \(num_nonnulls\(segment_id, lesson_id\) = 1\)/);
  expect(UP).not.toContain('create table');
  expect(UP).not.toMatch(/niete_lp612_renders|niete_lp_assets/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('idempotent: the constraint is dropped before it is added', () => {
  expect(UP.indexOf('drop constraint if exists')).toBeGreaterThan(-1);
  expect(UP.indexOf('drop constraint if exists')).toBeLessThan(UP.indexOf('add constraint'));
});

test('the rollback undoes it (grades 1–5 rows first, then the column and the constraint)', () => {
  expect(DOWN).toContain('delete from niete_lp612_own_plans where lesson_id is not null');
  expect(DOWN).toContain('drop column if exists lesson_id');
  expect(DOWN).toContain('alter column segment_id set not null');
});

test('the fresh-install schema matches', () => {
  expect(MIRROR).toContain('lesson_id text');
  expect(MIRROR).toContain('num_nonnulls(segment_id, lesson_id) = 1');
});
