'use strict';
/**
 * The live reading meter (app_settings `web_quiz_live_meter`: 'sky' | 'vine' | true = 'sky'; off unless set), read only
 * while live reading v3 is on. The menu and the hub name the variant so the page loads the meter; off, both are today's.
 * Supabase's app_settings read is the faked boundary.
 */
const mockRows = new Map();
const mockReads = { in: 0 };
jest.mock('../../../shared/config/supabase', () => ({
  from: () => ({ select: () => ({
    eq: async (_c, key) => ({ data: mockRows.has(key) ? [{ key, value: mockRows.get(key) }] : [], error: null }),
    // the kid hub's one settings read (web-quiz-hub-flags.js): the meter and its parent ride it
    in: async (_c, keys) => { mockReads.in += 1; return { data: keys.filter((k) => mockRows.has(k)).map((key) => ({ key, value: mockRows.get(key) })), error: null }; },
  }) }),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

function fresh() {
  jest.resetModules();
  return require('../../../shared/services/quiz/web-quiz-live-read-v3');
}

describe('web_quiz_live_meter', () => {
  beforeEach(() => mockRows.clear());

  test('off: the menu is today\'s ({lr3:true}) and the hub field is {}', async () => {
    mockRows.set('web_quiz_live_read_v3', true);
    const M = fresh();
    expect(await M.forMenu()).toEqual({ lr3: true });
    expect(await M.forHub()).toEqual({});
  });

  test('on with live reading v3: the menu and the hub name the variant', async () => {
    mockRows.set('web_quiz_live_read_v3', true);
    mockRows.set('web_quiz_live_meter', 'vine');
    const M = fresh();
    expect(await M.forMenu()).toEqual({ lr3: true, pace: 'vine' });
    expect(await M.forHub()).toEqual({ pace: 'vine' });
  });

  test('a literal true is the sky bar; a JSON string value is read too', async () => {
    mockRows.set('web_quiz_live_read_v3', 'true');
    mockRows.set('web_quiz_live_meter', true);
    expect(await fresh().forHub()).toEqual({ pace: 'sky' });
    mockRows.set('web_quiz_live_meter', '"sky"');
    expect(await fresh().forMenu()).toEqual({ lr3: true, pace: 'sky' });
  });

  test('an unknown value, false, or live reading v3 off: nothing', async () => {
    mockRows.set('web_quiz_live_read_v3', true);
    mockRows.set('web_quiz_live_meter', 'rainbow');
    expect(await fresh().forHub()).toEqual({});
    mockRows.set('web_quiz_live_meter', false);
    expect(await fresh().forMenu()).toEqual({ lr3: true });
    mockRows.delete('web_quiz_live_read_v3');
    mockRows.set('web_quiz_live_meter', 'sky');
    const M = fresh();
    expect(await M.forHub()).toEqual({});
    expect(await M.forMenu()).toEqual({});
  });

  test('the hub learns the meter from its one settings read: forHub makes no read of its own beside it', async () => {
    mockRows.set('web_quiz_live_read_v3', true);
    mockRows.set('web_quiz_live_meter', 'sky');
    jest.resetModules();
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    const M = require('../../../shared/services/quiz/web-quiz-live-read-v3');
    mockReads.in = 0;
    const [f, pace] = await Promise.all([Flags.flags(), M.forHub()]);
    expect(pace).toEqual({ pace: 'sky' });
    expect(f.liveMeter).toBe('sky');
    expect(mockReads.in).toBe(1);   // the hub's own read, shared
    expect(Flags.KEYS).toEqual(expect.arrayContaining(['web_quiz_live_meter', 'web_quiz_live_read_v3']));
  });
});
