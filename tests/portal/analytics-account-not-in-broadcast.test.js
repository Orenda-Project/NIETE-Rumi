/**
 * An analytics-only account must never be swept into a broadcast.
 *
 * The cohort audit (every scheduled sweep, nudge and bulk send) found exactly one
 * automatic path that selects users with no prior activity: the admin broadcast in filter
 * mode with activity 'all', which takes every user with registration_completed = true and a
 * phone (dashboard/database/queries.js). Every other sweep needs activity rows the account
 * never has, or role 'teacher' with a school.
 *
 * So the account is kept out by the row the script writes. This pins the two together:
 * the script's own defaults, run through the real broadcast selector, never come back.
 */

let usersTable;

function chain() {
  const preds = [];
  const c = {
    select: () => c,
    eq: (col, val) => { preds.push((r) => r[col] === val); return c; },
    not: (col, op, val) => {
      if (op === 'is' && val === null) preds.push((r) => r[col] !== null && r[col] !== undefined);
      return c;
    },
    like: (col, pattern) => {
      const prefix = pattern.replace(/%$/, '');
      preds.push((r) => String(r[col] || '').startsWith(prefix));
      return c;
    },
    in: (col, vals) => { preds.push((r) => vals.includes(r[col])); return c; },
    then: (resolve, reject) => Promise.resolve({ data: usersTable.filter((r) => preds.every((p) => p(r))), error: null }).then(resolve, reject),
  };
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(() => chain()) }));
  jest.doMock('../../dashboard/services/materialized-views.service', () => ({}));
});

afterEach(() => jest.resetModules());

test('filter-mode broadcast (all users, PK prefix) skips the account the script creates', async () => {
  const { ANALYTICS_ACCOUNT_DEFAULTS } = require('../../scripts/create-analytics-user');
  const account = {
    id: 'acct', phone_number: '923001234567', name: 'FDE Analytics', role: 'unregistered', school_id: null,
    ...ANALYTICS_ACCOUNT_DEFAULTS,
  };
  const teacher = { id: 't1', phone_number: '923009999999', name: 'Teacher', role: 'teacher', registration_completed: true };
  usersTable = [account, teacher];

  const { getUsersForBroadcast } = require('../../dashboard/database/queries');
  for (const country of ['all', '92']) {
    // eslint-disable-next-line no-await-in-loop
    const users = await getUsersForBroadcast({ activity: 'all', country });
    expect(users.map((u) => u.id)).toEqual(['t1']);
  }
});

test('the account is never written as registration-completed', () => {
  const { ANALYTICS_ACCOUNT_DEFAULTS } = require('../../scripts/create-analytics-user');
  expect(ANALYTICS_ACCOUNT_DEFAULTS.registration_completed).not.toBe(true);
});
