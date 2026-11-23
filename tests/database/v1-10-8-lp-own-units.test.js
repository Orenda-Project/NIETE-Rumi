'use strict';
/**
 * V1.10.8 — "Make my own → A whole unit" (bd-snkn32.59, queue #165). SQL-text contract test (no database).
 * One small table holds her unit's outline; the day plans stay rows of niete_lp612_own_plans (answers.unit).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const UP = read('V1.10.8__lp_own_units.sql');
const DOWN = read('ROLLBACK_V1.10.8__lp_own_units.sql');
const MIRROR = fs.readFileSync(path.join(__dirname, '../../infrastructure/supabase/00_complete-schema.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');

test('creates one table, keyed to her and her book, no plan bodies in it', () => {
  expect(UP).toContain('create table if not exists niete_lp_own_units');
  expect(UP).toContain('user_id uuid not null references users(id)');
  expect(UP).toContain('class_id uuid references classes(id)');
  expect(UP).toContain('book_stem text not null'); // V1.10.9 relaxes it for a goal unit (no book)
  expect(UP).toContain('outline jsonb not null');
  expect(UP).not.toMatch(/r2_key|html|script/);
  expect(UP).not.toMatch(/alter table niete_lp612_own_plans|niete_lp612_renders|niete_lp_assets/);
});

test('closed values are checked: start, pace, period, chapter range, status', () => {
  expect(UP).toMatch(/start_kind text not null check \(start_kind in \('book', 'goals'\)\)/);
  expect(UP).toMatch(/pace text not null check \(pace in \('recommended', 'slower', 'faster'\)\)/);
  expect(UP).toMatch(/period_minutes smallint not null check \(period_minutes between 20 and 90\)/);
  expect(UP).toMatch(/status text not null default 'active' check \(status in \('active', 'done', 'archived'\)\)/);
  expect(UP).toContain("check (start_kind <> 'book' or (chapter_from is not null and chapter_to >= chapter_from))");
});

test('server only (RLS on), her latest unit is one index read, idempotent, reloads PostgREST', () => {
  expect(UP).toContain('alter table niete_lp_own_units enable row level security');
  expect(UP).toContain('on niete_lp_own_units (user_id, updated_at desc)');
  expect(UP.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  expect(UP).not.toMatch(/\bbegin\b|\bcommit\b/);
});

test('the rollback drops it', () => {
  expect(DOWN).toContain('drop table if exists niete_lp_own_units');
});

test('the fresh-install schema matches', () => {
  expect(MIRROR).toContain('create table if not exists niete_lp_own_units');
});
