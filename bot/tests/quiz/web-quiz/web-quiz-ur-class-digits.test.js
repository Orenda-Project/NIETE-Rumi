'use strict';
/**
 * app_settings web_quiz_ur_class_digits: the switch the Urdu class-name digits ride on (default off, JSON `true` only,
 * fail closed, cached 30 s). On, the quiz payload names `ur_class_digits: true` and the page draws the class's name with
 * Urdu digits on an Urdu page; off, the key is absent and the page is today's.
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: [], fail: false, reads: 0 };
  const q = { select: () => q, eq: () => q, maybeSingle: async () => { state.reads += 1; return state.fail ? { data: null, error: { message: 'boom' } } : { data: state.rows[0] || null, error: null }; } };
  return { from: () => q, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const supabase = require('../../../shared/config/supabase');
const { OFF_VALUES } = require('../../helpers/switch-off-matrix');
const Digits = require('../../../shared/services/quiz/web-quiz-ur-class-digits');

describe('web_quiz_ur_class_digits', () => {
  beforeEach(() => { Digits._reset(); supabase.__state.rows = []; supabase.__state.fail = false; supabase.__state.reads = 0; });
  test('absent → off; field() → null', async () => { expect(await Digits.flag()).toBe(false); expect(await Digits.field()).toBeNull(); });
  test('JSON true → on; field() → true', async () => {
    supabase.__state.rows = [{ key: Digits.KEY, value: true }];
    expect(await Digits.flag()).toBe(true);
    expect(await Digits.field()).toBe(true);
  });
  test.each(OFF_VALUES)('%s → off', async (_, v) => {
    if (v !== null) supabase.__state.rows = [{ key: Digits.KEY, value: v }];
    expect(await Digits.field()).toBeNull();
  });
  test.each([['true'], [' TRUE '], ['"true"']])('%p (a string) → off: JSON true only', async (v) => {
    supabase.__state.rows = [{ key: Digits.KEY, value: v }];
    expect(await Digits.flag()).toBe(false);
  });
  test('a failed read is off, cached; the next read after 30 s sees the row', async () => {
    supabase.__state.fail = true; expect(await Digits.flag()).toBe(false);
    supabase.__state.fail = false; supabase.__state.rows = [{ key: Digits.KEY, value: true }];
    expect(await Digits.flag()).toBe(false);
    expect(await Digits.flag(Date.now() + 31000)).toBe(true);
  });
  test('one read for many pages inside 30 s', async () => {
    await Promise.all([Digits.flag(), Digits.flag(), Digits.field()]);
    await Digits.flag();
    expect(supabase.__state.reads).toBe(1);
  });
  test('the key is the documented one', () => expect(Digits.KEY).toBe('web_quiz_ur_class_digits'));
});
