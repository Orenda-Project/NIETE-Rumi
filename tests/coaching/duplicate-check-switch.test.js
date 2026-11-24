'use strict';
/**
 * bd-r98hph — test accounts skip the "already analysed" recording check.
 *
 * A coach testing a new rubric on the same classroom recording got "This classroom recording has already been
 * analyzed" every time (HITL row 185's rule, bd-erpvf / bd-zq0ea), so she could not test at all. The rule stays
 * for everyone; a per-account switch in app_settings lets a named test account skip it.
 *
 *   app_settings.skip_recording_duplicate_check   'off' | 'on'   default OFF (no row, unknown value, failed read)
 *
 * Same value shape and lookup as obs612_coach / fico_coach_rubric: "on" for everyone, or a map keyed
 * "user:<users.id>", region, organization, "*".
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockRows = { value: [] };
const mockFail = { on: false };
// bd-ce6xwt: users.is_test_user per id (absent = null, as for most real accounts), and a failing users read.
const mockTestUsers = { ids: new Set(), fail: false };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = {
      select: () => q,
      eq: (_col, id) => {
        if (table === 'users') {
          return {
            maybeSingle: async () => (mockTestUsers.fail
              ? { data: null, error: { message: 'users read failed' } }
              : { data: { region: 'sihala', is_test_user: mockTestUsers.ids.has(id) ? true : null }, error: null }),
          };
        }
        return Promise.resolve(mockFail.on ? { data: null, error: { message: 'down' } } : { data: mockRows.value, error: null });
      },
    };
    return q;
  }),
}));
jest.mock('../../bot/shared/services/region-registry', () => ({ organizationForRegion: async () => 'ict' }));

const Switch = require('../../bot/shared/services/coaching/duplicate-check-switch');

const TEST_COACH = '060929f8-0000-4000-8000-000000000001';
const OTHER_COACH = '11111111-0000-4000-8000-000000000002';
const row = (value) => { mockRows.value = [{ key: 'skip_recording_duplicate_check', value }]; };

beforeEach(() => {
  mockRows.value = [];
  mockFail.on = false;
  mockTestUsers.ids = new Set();
  mockTestUsers.fail = false;
  Switch._resetCache();
});

test('the key and its values', () => {
  expect(Switch.KEY).toBe('skip_recording_duplicate_check');
  expect(Switch.VALUES).toEqual(['off', 'on']);
});

test('no row: nobody skips the check (the rule stays for everyone)', async () => {
  expect(await Switch.skipsCheck(TEST_COACH)).toBe(false);
});

test('a per-account map: only the named account skips it', async () => {
  row(JSON.stringify({ [`user:${TEST_COACH}`]: 'on' }));
  expect(await Switch.skipsCheck(TEST_COACH)).toBe(true);
  expect(await Switch.skipsCheck(OTHER_COACH)).toBe(false);
});

test('"off" for the account, or an unknown value, keeps the check', async () => {
  row({ [`user:${TEST_COACH}`]: 'off' });
  expect(await Switch.skipsCheck(TEST_COACH)).toBe(false);
  Switch._resetCache();
  row({ [`user:${TEST_COACH}`]: 'yes please' });
  expect(await Switch.skipsCheck(TEST_COACH)).toBe(false);
});

test('a failed settings read keeps the check, and never throws', async () => {
  mockFail.on = true;
  await expect(Switch.skipsCheck(TEST_COACH)).resolves.toBe(false);
});

test('no account id: the check stays', async () => {
  row('on');
  expect(await Switch.skipsCheck(null)).toBe(false);
  expect(await Switch.skipsCheck(undefined)).toBe(false);
});

// bd-ce6xwt — every test account (users.is_test_user = true) skips the check too, with no switch row. The
// operator, 24 Nov 2026: test accounts are allowed duplicate recordings. The switch stays for an account that is
// not marked test, and an explicit "off" for a test account's own id keeps the check for it.
describe('test accounts (users.is_test_user) skip the check (bd-ce6xwt)', () => {
  test('a test account skips it with no switch row', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    expect(await Switch.skipsCheck(TEST_COACH)).toBe(true);
  });

  test('a real account (is_test_user null or false) keeps the check', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    expect(await Switch.skipsCheck(OTHER_COACH)).toBe(false);
  });

  test('a test account skips it while the switch names other accounts only', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    row({ [`user:${OTHER_COACH}`]: 'on' });
    expect(await Switch.skipsCheck(TEST_COACH)).toBe(true);
  });

  test('the switch still works for an account that is not marked test', async () => {
    row({ [`user:${OTHER_COACH}`]: 'on' });
    expect(await Switch.skipsCheck(OTHER_COACH)).toBe(true);
  });

  test('"off" for a test account\'s own id keeps the check for it', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    row({ [`user:${TEST_COACH}`]: 'off' });
    expect(await Switch.skipsCheck(TEST_COACH)).toBe(false);
  });

  test('"off" for everyone ("*") does not stop a test account skipping it', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    row({ '*': 'off' });
    expect(await Switch.skipsCheck(TEST_COACH)).toBe(true);
  });

  test('a failed users read keeps the check, and never throws', async () => {
    mockTestUsers.ids.add(TEST_COACH);
    mockTestUsers.fail = true;
    await expect(Switch.skipsCheck(TEST_COACH)).resolves.toBe(false);
  });
});
