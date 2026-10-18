'use strict';
/**
 * Two lines of the hub's reads-together switch (app_settings web_quiz_hub_fanout) that its own tests leave unpinned:
 *   - the switch keeper's timer never keeps a process alive (its interval is unref'd);
 *   - fanoutNow() answers from the hub's switch cache only while it is younger than two cache lives (60 s), never reads
 *     on its own, and is off on a cold cache.
 * Supabase and the loggers are the boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

let rows = [];
let settingsReads = 0;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      if (t === 'app_settings') settingsReads += 1;
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; },
        async maybeSingle() { return { data: null, error: null }; },
        then(res, rej) { return Promise.resolve({ data: t === 'app_settings' ? rows : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

beforeEach(() => {
  jest.resetModules();
  rows = [];
  settingsReads = 0;
  seed();
});

describe('the switch keeper never keeps a process alive', () => {
  test('touch() starts one interval and unrefs it', () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setInterval').mockImplementation(() => ({ unref }));
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    try {
      const Warm = require('../../../shared/services/quiz/web-quiz-hub-warm');
      Warm.touch([() => null]);
      Warm.touch([() => null]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
      Warm._stop();
    } finally {
      spy.mockRestore();
      clear.mockRestore();
    }
  });
});

describe('fanoutNow answers from the hub\'s cache only, for two cache lives', () => {
  test('a cold cache: off, and no settings read starts', async () => {
    rows = [{ key: 'web_quiz_hub_fanout', value: true }];
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.fanoutNow()).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(settingsReads).toBe(0);
  });

  test('primed true: on inside 60 s, off after it, with no read of its own', async () => {
    rows = [{ key: 'web_quiz_hub_fanout', value: true }];
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    const t0 = Date.now();
    await Flags.flags();
    const reads = settingsReads;
    expect(Flags.fanoutNow(t0 + 1000)).toBe(true);
    expect(Flags.fanoutNow(t0 + 59 * 1000)).toBe(true);
    expect(Flags.fanoutNow(t0 + 61 * 1000)).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(settingsReads).toBe(reads);
  });

  test('primed with anything but the JSON true: off', async () => {
    rows = [{ key: 'web_quiz_hub_fanout', value: 'true' }];
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    await Flags.flags();
    expect(Flags.fanoutNow()).toBe(false);
  });
});
