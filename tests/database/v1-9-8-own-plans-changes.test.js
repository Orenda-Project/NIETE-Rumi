'use strict';
/**
 * V1.9.8 — "Change this plan" (bd-snkn32.15). SQL-text contract test (no database).
 * A change is a new row of the EXISTING own-plan table (no new LP table), pointing at the root plan; the database
 * itself holds the cap of two: round is 1 or 2 and (root, round) is unique among rows that did not fail.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.8__own_plans_changes.sql');
const DOWN = read('ROLLBACK_V1.9.8__own_plans_changes.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');
const OBJECTS = fs.readFileSync(path.join(__dirname, '../../supabase/baseline/schema.objects.txt'), 'utf8');

test('widens the existing table with the root, the round and her request', () => {
  expect(UP).toContain('alter table niete_lp612_own_plans add column if not exists parent_own_id uuid references niete_lp612_own_plans(id)');
  expect(UP).toContain('alter table niete_lp612_own_plans add column if not exists edit_round smallint');
  expect(UP).toContain('alter table niete_lp612_own_plans add column if not exists edit_request jsonb');
  expect(UP).not.toContain('create table');
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the cap lives in the database: round 1 or 2, set together with the root and the request', () => {
  expect(UP).toMatch(/add constraint niete_lp612_own_plans_edit_round check \( ?\(parent_own_id is null and edit_round is null and edit_request is null\) or \(parent_own_id is not null and edit_round in \(1, 2\) and edit_request is not null\) ?\)/);
  expect(UP.indexOf('drop constraint if exists niete_lp612_own_plans_edit_round')).toBeGreaterThan(-1);
  expect(UP.indexOf('drop constraint if exists')).toBeLessThan(UP.indexOf('add constraint'));
});

test('one live row per (root, round); a failed round may be tried again', () => {
  expect(UP).toContain("create unique index if not exists uq_lp612_own_plans_round on niete_lp612_own_plans (parent_own_id, edit_round) where status <> 'failed'");
});

test('the rollback removes change rows first, then the index, constraint and columns', () => {
  expect(DOWN).toContain('delete from niete_lp612_own_plans where parent_own_id is not null');
  expect(DOWN).toContain('drop index if exists uq_lp612_own_plans_round');
  expect(DOWN).toContain('drop constraint if exists niete_lp612_own_plans_edit_round');
  for (const c of ['parent_own_id', 'edit_round', 'edit_request']) expect(DOWN).toContain(`drop column if exists ${c}`);
  expect(DOWN.indexOf('delete from')).toBeLessThan(DOWN.indexOf('drop column'));
});

test('the fresh-install schema and the baseline column list match', () => {
  expect(MIRROR).toContain('parent_own_id uuid references niete_lp612_own_plans(id)');
  expect(MIRROR).toContain('edit_round smallint');
  expect(MIRROR).toContain('edit_request jsonb');
  expect(MIRROR).toContain('uq_lp612_own_plans_round');
  expect(OBJECTS).toContain('niete_lp612_own_plans.parent_own_id:uuid');
  expect(OBJECTS).toContain('niete_lp612_own_plans.edit_round:smallint');
  expect(OBJECTS).toContain('niete_lp612_own_plans.edit_request:jsonb');
});
