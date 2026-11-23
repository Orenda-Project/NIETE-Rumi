'use strict';
/**
 * bd-ptl6x9.7 — V1.10.10 must allow every kind the store can schedule plus coach_weekly_report (V1.8.12's, written
 * by its own sender), seed the nudge OFF, nothing approved, test accounts only, without overwriting a live value;
 * the rollback removes the rows first and narrows the CHECK back to V1.8.12's.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../../shared/config/supabase', () => ({}));
const { KINDS } = require('../../../shared/services/nudges/teacher-nudges.store');
const { FLAG_KEY, TEMPLATES_KEY, AUDIENCE_KEY } = require('../../../shared/services/nudges/weak-skill-jugnu/switch');

const dir = path.join(__dirname, '../../../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const up = read('V1.10.10__weak_skill_jugnu_nudge.sql');
const down = read('ROLLBACK_V1.10.10__weak_skill_jugnu_nudge.sql');
const prev = read('V1.8.12__coach_weekly_report.sql');
const code = (sql) => sql.replace(/--.*$/gm, '');
const checkKinds = (sql) => code(sql).match(/CHECK \(kind IN \(([^)]*)\)\)/)[1].match(/'[^']+'/g).map((x) => x.slice(1, -1)).sort();

test('the widened CHECK allows every store kind, and keeps coach_weekly_report', () => {
  expect(checkKinds(up)).toEqual([...Object.values(KINDS), 'coach_weekly_report'].sort());
});

test('the switch is seeded off, nothing approved, test accounts only, never overwriting a live value', () => {
  const sql = code(up);
  expect(sql).toMatch(new RegExp(`'${FLAG_KEY}', 'false'::jsonb`));
  expect(sql).toMatch(new RegExp(`'${TEMPLATES_KEY}', '\\[\\]'::jsonb`));
  expect(sql).toMatch(new RegExp(`'${AUDIENCE_KEY}', '"test"'::jsonb`));
  expect(sql.match(/ON CONFLICT \(key\) DO NOTHING/g)).toHaveLength(3);
});

test('no new table, no transaction control', () => {
  expect(code(up)).not.toMatch(/CREATE TABLE|BEGIN;|COMMIT;/i);
});

test('V1.10.10 widens V1.8.12\'s CHECK by exactly this one kind', () => {
  expect(checkKinds(up)).toEqual([...checkKinds(prev), 'weak_skill_jugnu'].sort());
});

test('the rollback is non-destructive: it switches the nudge off, deletes nothing, leaves the CHECK', () => {
  const sql = code(down);
  expect(sql).not.toMatch(/DELETE|DROP|ALTER/i);
  expect(sql).toMatch(new RegExp(`SET value = 'false'::jsonb WHERE key = '${FLAG_KEY}'`));
  expect(sql).toMatch(new RegExp(`SET value = '\\[\\]'::jsonb WHERE key = '${TEMPLATES_KEY}'`));
  expect(sql).toMatch(new RegExp(`WHERE key = '${AUDIENCE_KEY}'`));
});
