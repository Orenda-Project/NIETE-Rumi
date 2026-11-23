'use strict';
/**
 * V1.10.9 — "A whole unit" from learning goals with NO textbook (bd-snkn32.59.4, queue #165). SQL-text contract test.
 * Amena 20 Nov: "pls dont link the textbook for learning goals" — a goal unit names no book, and its day plans name
 * no segment and no book day.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.10.9__lp_own_units_goals.sql');
const DOWN = read('ROLLBACK_V1.10.9__lp_own_units_goals.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');
const BASE = fs.readFileSync(path.join(__dirname, '../../supabase/baseline/schema.sql'), 'utf8').toLowerCase();

test('goal_codes becomes goals (her words), renamed only when it is still there', () => {
  expect(UP).toMatch(/column_name='goal_codes'.*not exists.*column_name='goals'.*rename column goal_codes to goals/);
});

test('a goal unit names no book; a book unit must', () => {
  expect(UP).toContain('alter column book_stem drop not null');
  expect(UP).toContain("check (start_kind <> 'goals' or (cardinality(goals) between 2 and 8 and book_stem is null and chapter_from is null))");
  expect(UP).toContain("check (start_kind <> 'book' or book_stem is not null)");
});

test('only a goal-unit day plan may name neither a segment nor a book day', () => {
  expect(UP).toContain("num_nonnulls(segment_id, lesson_id) = 1 or (segment_id is null and lesson_id is null and answers->'unit'->>'start' = 'goals')");
  expect(UP).not.toMatch(/add column/);
});

test('idempotent, no transaction of its own, reloads PostgREST', () => {
  expect(UP).toMatch(/drop constraint if exists niete_lp612_own_plans_one_parent/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit\b/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback removes goal-unit rows first, then restores the old checks and name', () => {
  expect(DOWN.indexOf('delete from niete_lp612_own_plans')).toBeLessThan(DOWN.indexOf('add constraint niete_lp612_own_plans_one_parent'));
  expect(DOWN).toContain('rename column goals to goal_codes');
  expect(DOWN).toContain('alter column book_stem set not null');
});

test('the fresh-install schema and the local baseline match', () => {
  expect(MIRROR).toContain('goals text[],');
  expect(MIRROR).not.toContain('goal_codes');
  expect(BASE).toContain('goals text[],');
  expect(BASE).not.toContain('goal_codes');
});
