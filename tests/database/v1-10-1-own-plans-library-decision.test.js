'use strict';
/**
 * V1.10.1 — a person's decision before an own plan is listed. SQL-text contract test (no database).
 * The decision columns extend niete_lp612_own_plans (no new LP table); a decision always names who and when; nothing
 * touches her status or the shared render table.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.10.1__own_plans_library_decision.sql');
const DOWN = read('ROLLBACK_V1.10.1__own_plans_library_decision.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8')
  .replace(/\s+/g, ' ').toLowerCase();

const COLS = ['library_decision text', 'library_decided_by uuid references users(id)', 'library_decided_at timestamptz',
  'library_reject_reason text'];

test('extends the own-plan table with the decision columns, no new table', () => {
  for (const c of COLS) expect(UP).toContain(`alter table niete_lp612_own_plans add column if not exists ${c}`);
  expect(UP).not.toMatch(/create table/);
  expect(UP).toMatch(/check \(library_decision is null or library_decision in \('approved', 'rejected'\)\)/);
});

test('a decision always names who and when; a reason only on a rejection', () => {
  expect(UP).toMatch(/check \(\(library_decision is null\) = \(library_decided_at is null\) and \(library_decision is null\) = \(library_decided_by is null\)\)/);
  expect(UP).toMatch(/check \(library_reject_reason is null or library_decision = 'rejected'\)/);
});

test('indexes the approved shelf and the reviewer queue', () => {
  expect(UP).toMatch(/create index if not exists \w+ on niete_lp612_own_plans \(segment_id, lesson_id\) where library_decision = 'approved'/);
  expect(UP).toMatch(/create index if not exists \w+ on niete_lp612_own_plans \(reviewed_at\) where library_eligible and library_decision is null/);
});

test('never touches her status or the shared render table, one transaction from the runner', () => {
  expect(UP).not.toMatch(/niete_lp612_renders/);
  expect(UP).not.toMatch(/\bstatus\b/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly the decision columns', () => {
  for (const c of ['library_decision', 'library_decided_by', 'library_decided_at', 'library_reject_reason']) {
    expect(DOWN).toContain(`drop column if exists ${c}`);
  }
  expect(DOWN).not.toMatch(/drop table/);
});

test('the fresh-install schema declares the decision columns too', () => {
  expect(MIRROR).toContain('library_decided_by uuid references users(id)');
  expect(MIRROR).toContain('library_reject_reason text');
});
