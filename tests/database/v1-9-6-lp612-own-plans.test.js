'use strict';
/**
 * V1.9.6 — "Make my own" lesson plans (bd-snkn32). SQL-text contract test (no database).
 * A teacher's own plan is a FORK: its own table, her user id on every row, its PDF under lp612/ (the edits/ path
 * editKeyFor builds), and it never writes the shared render table.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.9.6__lp612_own_plans.sql');
const DOWN = read('ROLLBACK_V1.9.6__lp612_own_plans.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8').toLowerCase();

test('creates her own-plan table, owned by her and tied to a real segment', () => {
  expect(UP).toContain('create table if not exists niete_lp612_own_plans');
  expect(UP).toContain('user_id uuid not null references users(id)');
  expect(UP).toContain('references niete_lp612_segments(segment_id)');
  expect(UP).toContain("status in ('authoring', 'ready', 'failed')");
  expect(UP).toContain("r2_key like 'lp612/%'");
  expect(UP).toContain('enable row level security');
});

test('is indexed for her own list and for the in-flight reaper', () => {
  expect(UP).toMatch(/create index if not exists \w+ on niete_lp612_own_plans \(user_id, created_at desc\)/);
  expect(UP).toMatch(/create index if not exists \w+ on niete_lp612_own_plans \(status, started_at\) where status = 'authoring'/);
});

test('never touches the shared render table', () => {
  expect(UP).not.toMatch(/(alter|update|insert into|delete from|drop)[^;]*niete_lp612_renders/);
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
});

test('the rollback drops exactly what it created', () => {
  expect(DOWN).toContain('drop table if exists niete_lp612_own_plans');
  expect(DOWN).not.toMatch(/niete_lp612_renders/);
});

test('the fresh-install schema declares the table too', () => {
  expect(MIRROR).toContain('create table if not exists niete_lp612_own_plans');
});
