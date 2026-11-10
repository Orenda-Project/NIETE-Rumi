'use strict';
/**
 * V1.9.9 — the AI reviewer's verdict on a teacher's own plan (bd-snkn32.16). SQL-text contract test (no database).
 * The review columns extend niete_lp612_own_plans (no new LP table); library_eligible defaults false so an unreviewed
 * plan is never in the library; nothing touches her status or the shared render table.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.9__own_plans_review.sql');
const DOWN = read('ROLLBACK_V1.9.9__own_plans_review.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8')
  .replace(/\s+/g, ' ').toLowerCase();

const COLS = ['review_score numeric', 'review_pass boolean', 'review_items jsonb', 'review_model text',
  'reviewed_at timestamptz', 'library_eligible boolean not null default false'];

test('extends the own-plan table with the review columns, no new table', () => {
  for (const c of COLS) expect(UP).toContain(`alter table niete_lp612_own_plans add column if not exists ${c}`);
  expect(UP).not.toMatch(/create table/);
  expect(UP).toMatch(/check \(review_score is null or \(review_score >= 0 and review_score <= 100\)\)/);
});

test('library-eligible means reviewed and passed', () => {
  expect(UP).toMatch(/check \(not library_eligible or review_pass is true\)/);
  expect(UP).toMatch(/create index if not exists \w+ on niete_lp612_own_plans \(reviewed_at desc\) where library_eligible/);
});

test('never touches her status or the shared render table, one transaction from the runner', () => {
  expect(UP).not.toMatch(/niete_lp612_renders/);
  expect(UP).not.toMatch(/\bstatus\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly the review columns', () => {
  for (const c of ['review_score', 'review_pass', 'review_items', 'review_model', 'reviewed_at', 'library_eligible']) {
    expect(DOWN).toContain(`drop column if exists ${c}`);
  }
  expect(DOWN).not.toMatch(/drop table/);
});

test('the fresh-install schema declares the review columns too', () => {
  expect(MIRROR).toContain('library_eligible boolean not null default false');
  expect(MIRROR).toContain('review_items jsonb');
});
