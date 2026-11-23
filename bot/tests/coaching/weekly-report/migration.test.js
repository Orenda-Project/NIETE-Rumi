'use strict';
/**
 * bd-v0toag.32 — V1.6.12 must allow every kind the store can schedule (else the insert fails 23514), and must
 * seed the report OFF with an empty approved-template list.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../../shared/config/supabase', () => ({}));
const { KINDS } = require('../../../shared/services/nudges/teacher-nudges.store');
const { FLAG_KEY, TEMPLATES_KEY } = require('../../../shared/services/coaching/weekly-report/switch');

const dir = path.join(__dirname, '../../../../infrastructure/supabase/migrations');
const up = fs.readFileSync(path.join(dir, 'V1.6.12__v10_weekly_usage_report.sql'), 'utf8');
const down = fs.readFileSync(path.join(dir, 'ROLLBACK_V1.6.12__v10_weekly_usage_report.sql'), 'utf8');
const checkKinds = (sql) => sql.match(/CHECK \(kind IN \(([^)]*)\)\)/)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));

// The kinds the store had when V1.6.12 shipped; later kinds widen the CHECK in their own migrations (V1.8.4, V1.8.12, V1.10.10).
test('the widened CHECK allows exactly the store kinds of its time', () => {
  expect(checkKinds(up).sort()).toEqual([KINDS.COACHING_AFTER_LP, KINDS.LP_QUIZ_OFFER, KINDS.WEEKLY_USAGE_REPORT].sort());
});

test('the switch is seeded off and the template list empty, without overwriting a live value', () => {
  expect(up).toMatch(new RegExp(`'${FLAG_KEY}', 'false'::jsonb`));
  expect(up).toMatch(new RegExp(`'${TEMPLATES_KEY}', '\\[\\]'::jsonb`));
  expect(up.match(/ON CONFLICT \(key\) DO NOTHING/g)).toHaveLength(2);
});

test('the rollback removes the report rows before narrowing the CHECK back', () => {
  expect(down.indexOf("DELETE FROM teacher_nudges WHERE kind = 'weekly_usage_report'"))
    .toBeLessThan(down.indexOf('ADD CONSTRAINT'));
  expect(checkKinds(down)).not.toContain(KINDS.WEEKLY_USAGE_REPORT);
});
