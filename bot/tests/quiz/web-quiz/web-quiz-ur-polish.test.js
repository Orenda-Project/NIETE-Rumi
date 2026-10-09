/** app_settings web_quiz_ur_polish: the switch the child pages' Urdu look rides on (default off, fail closed, cached). */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: [], fail: false };
  const q = { select: () => q, eq: () => q, maybeSingle: async () => (state.fail ? { data: null, error: { message: 'boom' } } : { data: state.rows[0] || null, error: null }) };
  return { from: () => q, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
const supabase = require('../../../shared/config/supabase');
const Ur = require('../../../shared/services/quiz/web-quiz-ur-polish');

describe('web_quiz_ur_polish', () => {
  beforeEach(() => { Ur._reset(); supabase.__state.rows = []; supabase.__state.fail = false; });
  test('absent → off; ui() → null', async () => { expect(await Ur.flag()).toBe(false); expect(await Ur.ui()).toBeNull(); });
  test.each([[true], ['true'], [' TRUE '], ['"true"']])('%p → on; ui() → { ur2: true }', async (v) => {
    supabase.__state.rows = [{ key: Ur.KEY, value: v }];
    expect(await Ur.flag()).toBe(true); expect(await Ur.ui()).toEqual({ ur2: true });
  });
  test.each([[false], ['false'], ['yes'], [1], [{ enabled: true }]])('%p → off', async (v) => {
    supabase.__state.rows = [{ key: Ur.KEY, value: v }];
    expect(await Ur.flag()).toBe(false);
  });
  test('a db error fails closed and is cached', async () => {
    supabase.__state.fail = true; expect(await Ur.flag()).toBe(false);
    supabase.__state.fail = false; supabase.__state.rows = [{ key: Ur.KEY, value: true }];
    expect(await Ur.flag()).toBe(false);           // cached off for 30 s
    expect(await Ur.flag(Date.now() + 31000)).toBe(true);
  });
  test('the key is the documented one', () => expect(Ur.KEY).toBe('web_quiz_ur_polish'));
});
