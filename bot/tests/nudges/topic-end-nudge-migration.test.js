'use strict';
/**
 * bd-pw1ccr.4 — V1.8.4 must allow every kind the store can schedule (else the insert fails 23514), create the
 * school -> group table the arm reads, and seed the nudge OFF without overwriting a live value.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../shared/config/supabase', () => ({}));
const { KINDS } = require('../../shared/services/nudges/teacher-nudges.store');
const { FLAG_KEY, TABLE } = require('../../shared/services/nudges/topic-end-arm');

const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const up = fs.readFileSync(path.join(dir, 'V1.8.4__topic_end_nudge.sql'), 'utf8');
const down = fs.readFileSync(path.join(dir, 'ROLLBACK_V1.8.4__topic_end_nudge.sql'), 'utf8');
const checkKinds = (sql) => sql.match(/CHECK \(kind IN \(([^)]*)\)\)/)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));

test('the widened CHECK allows exactly the store kinds', () => {
  expect(checkKinds(up).sort()).toEqual(Object.values(KINDS).sort());
});

test('the assignment table is the one the arm reads: one A or B per school', () => {
  expect(up).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${TABLE} \\(`));
  expect(up).toMatch(/school_id\s+UUID PRIMARY KEY REFERENCES schools \(id\)/);
  expect(up).toMatch(/ab_group\s+TEXT NOT NULL CHECK \(ab_group IN \('A', 'B'\)\)/);
});

test('the switch is seeded off, without overwriting a live value', () => {
  expect(up).toMatch(new RegExp(`'${FLAG_KEY}', 'false'::jsonb`));
  expect(up.match(/ON CONFLICT \(key\) DO NOTHING/g)).toHaveLength(1);
});

test('the rollback removes the nudge rows before narrowing the CHECK back, and drops what V1.8.4 added', () => {
  expect(down).toMatch(/destructive: reviewed/);
  expect(down.indexOf("DELETE FROM teacher_nudges WHERE kind = 'topic_end_nudge'"))
    .toBeLessThan(down.indexOf('ADD CONSTRAINT'));
  expect(checkKinds(down).sort()).toEqual(Object.values(KINDS).filter((k) => k !== KINDS.TOPIC_END_NUDGE).sort());
  expect(down).toMatch(new RegExp(`DELETE FROM app_settings WHERE key = '${FLAG_KEY}'`));
  expect(down).toMatch(new RegExp(`DROP TABLE IF EXISTS ${TABLE}`));
});
