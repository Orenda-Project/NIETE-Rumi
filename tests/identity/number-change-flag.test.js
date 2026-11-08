'use strict';
/**
 * Moving a teacher's account when WhatsApp says she changed her number has its own switch, so the code can ship with
 * the move off. Fail closed, like every key in feature-flags.js: only a written true turns it on.
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

beforeEach(() => { mockRow.data = null; mockRow.error = null; mockRow.throws = false; });

test('reads its own app_settings key', async () => {
  expect(Flags.META_NUMBER_CHANGE_KEY).toBe('meta_number_change_enabled');
  mockRow.data = { value: true };
  expect(await Flags.isMetaNumberChangeEnabled()).toBe(true);
  expect(supabase.q.table).toBe('app_settings');
  expect(supabase.q.key).toBe('meta_number_change_enabled');
});

test('a written "true" (the JSON string form) is on too', async () => {
  mockRow.data = { value: 'true' };
  expect(await Flags.isMetaNumberChangeEnabled()).toBe(true);
});

test.each([
  ['absent row (the default: off)', null],
  ['false', { value: false }],
  ['"false"', { value: 'false' }],
  ['a stray string', { value: 'yes' }],
  ['a number', { value: 1 }],
])('%s -> off', async (_label, data) => {
  mockRow.data = data;
  expect(await Flags.isMetaNumberChangeEnabled()).toBe(false);
});

test('a failed read -> off', async () => {
  mockRow.error = { message: 'boom' };
  expect(await Flags.isMetaNumberChangeEnabled()).toBe(false);
  mockRow.error = null;
  mockRow.throws = true;
  expect(await Flags.isMetaNumberChangeEnabled()).toBe(false);
});
