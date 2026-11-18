'use strict';
/**
 * V1.10.3 — her own rating of her own plan (bd-snkn32.11, queue #134 C). SQL-text contract test (no database).
 * Three columns on niete_lp612_own_plans (no new LP table, and not lp_feedback: its yes/no "useful" feeds the daily
 * ready-made plan panel, which own plans must not skew). A rating is 1-5; "what was confusing" is short and only with a
 * rating; both carry when.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.10.3__own_plans_teacher_rating.sql');
const DOWN = read('ROLLBACK_V1.10.3__own_plans_teacher_rating.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8')
  .replace(/\s+/g, ' ').toLowerCase();

test('extends the own-plan table with three columns, no new table', () => {
  for (const c of ['teacher_rating smallint', 'teacher_confusing text', 'teacher_rated_at timestamptz']) {
    expect(UP).toContain(`alter table niete_lp612_own_plans add column if not exists ${c}`);
  }
  expect(UP).not.toMatch(/create table|lp_feedback/);
});

test('a rating is 1-5, the note is short and only with a rating, and both carry when', () => {
  expect(UP).toMatch(/check \(teacher_rating is null or teacher_rating between 1 and 5\)/);
  expect(UP).toMatch(/check \(teacher_confusing is null or \(teacher_rating is not null and char_length\(teacher_confusing\) <= 300\)\)/);
  expect(UP).toMatch(/check \(\(teacher_rating is null\) = \(teacher_rated_at is null\)\)/);
});

test('never touches her status, one transaction from the runner', () => {
  expect(UP).not.toMatch(/\bstatus\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly those columns', () => {
  for (const c of ['teacher_rating', 'teacher_confusing', 'teacher_rated_at']) expect(DOWN).toContain(`drop column if exists ${c}`);
  expect(DOWN).not.toMatch(/drop table/);
});

test('the fresh-install schema declares them too', () => {
  expect(MIRROR).toContain('teacher_rating smallint');
  expect(MIRROR).toContain('teacher_rated_at timestamptz');
});
