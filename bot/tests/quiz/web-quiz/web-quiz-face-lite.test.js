/**
 * app_settings web_quiz_face_lite (default off, fail closed): the light Urdu face rides the hub flags' one batched read
 * (web-quiz-hub-flags.js KEYS) and is asked for only after the page builder awaited that read (faceLiteNow, a cache
 * peek: never a read of its own). The polished look's payload `ui: {ur2: true}` becomes `{ur2: true, fl: true}` when on;
 * off, the very same object.
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: [], fail: false, reads: [] };
  const from = (t) => {
    const q = { _t: t, select: () => q, eq: () => q, in: (_k, keys) => { q._keys = keys; return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res, rej) => { state.reads.push({ t, keys: q._keys }); return Promise.resolve(state.fail ? { data: null, error: { message: 'boom' } } : { data: state.rows, error: null }).then(res, rej); } };
    return q;
  };
  return { from, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
const supabase = require('../../../shared/config/supabase');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ur = require('../../../shared/services/quiz/web-quiz-ur-polish');

const NOW = 1_800_000_000_000;
beforeEach(() => { Flags._resetCache(); supabase.__state.rows = []; supabase.__state.fail = false; supabase.__state.reads = []; });

describe('web_quiz_face_lite in the hub flags read', () => {
  test('the key is the documented one and rides the one batched read', async () => {
    expect(Flags.FACE_LITE_KEY).toBe('web_quiz_face_lite');
    expect(Flags.KEYS).toContain('web_quiz_face_lite');
    await Flags.flags(NOW);
    expect(supabase.__state.reads).toHaveLength(1);
    // the child's language row rides the same one read, after KEYS (web-quiz-hub-flags.js readWithChildLang)
    expect(supabase.__state.reads[0]).toEqual({ t: 'app_settings', keys: [...Flags.KEYS, 'web_quiz_return_lang'] });
  });

  test('JSON true → on after the read; faceLiteNow itself never reads', async () => {
    supabase.__state.rows = [{ key: 'web_quiz_face_lite', value: true }];
    expect(Flags.faceLiteNow(NOW)).toBe(false); // cold: off, and no read
    expect(supabase.__state.reads).toHaveLength(0);
    expect((await Flags.flags(NOW)).faceLite).toBe(true);
    expect(Flags.faceLiteNow(NOW + 1000)).toBe(true);
    expect(Flags.faceLiteNow(NOW + 31000)).toBe(false); // stale: off, still no read
    expect(supabase.__state.reads).toHaveLength(1);
  });

  test.each([['the string "true"', 'true'], ['1', 1], ['false', false], ['an object', { enabled: true }], ['no row', undefined]])('%s → off', async (_n, v) => {
    supabase.__state.rows = v === undefined ? [] : [{ key: 'web_quiz_face_lite', value: v }];
    expect((await Flags.flags(NOW)).faceLite).toBe(false);
    expect(Flags.faceLiteNow(NOW)).toBe(false);
  });

  test('a failed read fails closed', async () => {
    supabase.__state.fail = true;
    expect((await Flags.flags(NOW)).faceLite).toBe(false);
    expect(Flags.faceLiteNow(NOW)).toBe(false);
  });

  test('prime() rows from another module\'s read carry the key', () => {
    Flags.prime([{ key: 'web_quiz_face_lite', value: true }], NOW);
    expect(Flags.faceLiteNow(NOW)).toBe(true);
    expect(supabase.__state.reads).toHaveLength(0);
  });
});

describe('ur polish lite(): the payload\'s ui', () => {
  test('off: the very same object, and null stays null', async () => {
    await Flags.flags();
    const u = { ur2: true };
    expect(Ur.lite(u)).toBe(u);
    expect(Ur.lite(null)).toBeNull();
  });
  test('on: { ur2: true, fl: true }; without the polished look nothing is added', async () => {
    supabase.__state.rows = [{ key: 'web_quiz_face_lite', value: true }];
    await Flags.flags();
    expect(Ur.lite({ ur2: true })).toEqual({ ur2: true, fl: true });
    expect(Ur.lite({ uf: true })).toEqual({ uf: true });
    expect(Ur.lite(null)).toBeNull();
    expect(supabase.__state.reads).toHaveLength(1);
  });
});
