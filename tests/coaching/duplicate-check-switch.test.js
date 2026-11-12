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
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = {
      select: () => q,
      eq: () => {
        if (table === 'users') return { maybeSingle: async () => ({ data: { region: 'sihala' }, error: null }) };
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
