'use strict';
/**
 * V1.10.14 — the A/B ledger takes phone_group units (bd-dha3q0). SQL-text contract test (no database).
 * The ICT quiz practice door test (ict-quiz-practice-door) splits by the phone a child's quiz arrives on, so its
 * ab_card_lock row has unit_kind 'phone_group'. V1.10.7 allowed only school and teacher; this widens that one CHECK
 * and touches nothing else. A phone_group test gets no rows from ab_tracker_unit_teachers (it reads its own child
 * measures), so the teacher metrics stay as they are.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const flat = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => flat(fs.readFileSync(path.join(DIR, f), 'utf8'));
const UP = read('V1.10.14__ab_unit_kind_phone_group.sql');
const DOWN = read('ROLLBACK_V1.10.14__ab_unit_kind_phone_group.sql');

test('replaces the unit_kind check with one that allows school, teacher and phone_group', () => {
  expect(UP).toContain('drop constraint if exists ab_card_lock_unit_kind_check');
  expect(UP).toMatch(/add constraint ab_card_lock_unit_kind_check check \(unit_kind in \('school', 'teacher', 'phone_group'\)\)/);
});

test('changes only ab_card_lock: no new table, no function, no data write', () => {
  expect(UP).not.toMatch(/create table|create or replace function|insert into|delete from|update public\./);
  for (const m of UP.matchAll(/alter table (?:public\.)?(\w+)/g)) expect(m[1]).toBe('ab_card_lock');
});

test('has no BEGIN/COMMIT (the runner wraps one transaction)', () => {
  expect(UP).not.toMatch(/\bbegin;|\bcommit;/);
});

test('rollback restores school and teacher only, and refuses while a phone_group row exists', () => {
  expect(DOWN).toContain('drop constraint if exists ab_card_lock_unit_kind_check');
  expect(DOWN).toMatch(/add constraint ab_card_lock_unit_kind_check check \(unit_kind in \('school', 'teacher'\)\)/);
  expect(DOWN).toMatch(/unit_kind = 'phone_group'/);
  expect(DOWN).toMatch(/raise exception/);
});
