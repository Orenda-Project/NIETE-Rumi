'use strict';
/**
 * "Is this you?" at sign-up has its own switch, registration_is_this_you_enabled, so the code ships with the question
 * off (bd-apnnh2.6, plan section 5.1). Fail closed, like every key in feature-flags.js: an absent row, false, junk or a
 * failed read is off. true or "true" is on for everyone; a JSON list of users.id is on only for those accounts (testers).
 */
const mockRow = { data: null, error: null, throws: false };
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => {
  const q = {
    select: () => q,
    eq: (col, key) => { q.key = key; return q; },
    maybeSingle: async () => {
      if (mockRow.throws) throw new Error('network');
      return { data: mockRow.data, error: mockRow.error };
    },
  };
  return { from: (table) => { q.table = table; return q; }, q };
});

const Flags = require('../../bot/shared/config/feature-flags');
const supabase = require('../../bot/shared/config/supabase');

const HER = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000009';

beforeEach(() => { mockRow.data = null; mockRow.error = null; mockRow.throws = false; });

test('F0: reads its own app_settings key', async () => {
  expect(Flags.REGISTRATION_IS_THIS_YOU_KEY).toBe('registration_is_this_you_enabled');
  mockRow.data = { value: true };
  await Flags.isRegistrationIsThisYouEnabled(HER);
  expect(supabase.q.table).toBe('app_settings');
  expect(supabase.q.key).toBe('registration_is_this_you_enabled');
});

test.each([
  ['an absent row (the default)', null],
  ['false', { value: false }],
  ['"false"', { value: 'false' }],
  ['junk text', { value: 'maybe' }],
  ['a number', { value: 1 }],
  ['an object', { value: { on: true } }],
  ['an empty list', { value: [] }],
])('F1: %s is off', async (_label, data) => {
  mockRow.data = data;
  expect(await Flags.isRegistrationIsThisYouEnabled(HER)).toBe(false);
});

test('F1: a refused read is off', async () => {
  mockRow.error = { message: 'permission denied' };
  expect(await Flags.isRegistrationIsThisYouEnabled(HER)).toBe(false);
});

test('F1: a read that throws is off, and does not throw', async () => {
  mockRow.throws = true;
  await expect(Flags.isRegistrationIsThisYouEnabled(HER)).resolves.toBe(false);
});

test.each([['true', { value: true }], ['"true"', { value: 'true' }], ['" TRUE "', { value: ' TRUE ' }]])(
  'F2: %s is on for everyone', async (_label, data) => {
    mockRow.data = data;
    expect(await Flags.isRegistrationIsThisYouEnabled(HER)).toBe(true);
    expect(await Flags.isRegistrationIsThisYouEnabled(OTHER)).toBe(true);
  },
);

test('F3: a list admits only the accounts it holds', async () => {
  mockRow.data = { value: [HER] };
  expect(await Flags.isRegistrationIsThisYouEnabled(HER)).toBe(true);
  expect(await Flags.isRegistrationIsThisYouEnabled(OTHER)).toBe(false);
  mockRow.data = { value: JSON.stringify([HER]) };            // the JSON-string form of the same list
  expect(await Flags.isRegistrationIsThisYouEnabled(HER)).toBe(true);
});

test('F3: no account id is never admitted, even when the switch is on', async () => {
  mockRow.data = { value: true };
  for (const id of [undefined, null, '', 42]) expect(await Flags.isRegistrationIsThisYouEnabled(id)).toBe(false);
});
