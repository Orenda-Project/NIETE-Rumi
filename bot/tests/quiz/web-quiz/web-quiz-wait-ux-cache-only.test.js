'use strict';
/**
 * The designed wait's switch is cache-only (app_settings web_quiz_wait_ux, web-quiz-wait-ux.js on()): it answers from
 * the cache the hub's one batched switch read keeps warm (web-quiz-hub-flags.js) and never reads on its own.
 *   - a cold cache is off and starts no settings read;
 *   - a cache older than two cache lives (60 s) is off, even with the stored value true; inside them it stays on, so a
 *     hub answer built across the 30 s mark keeps it;
 *   - the hub's read primed with the key true turns it on with no read of its own.
 * Supabase and the loggers are the boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_wait_ux';
let rows = [];
let settingsReads = 0;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      if (t === 'app_settings') settingsReads += 1;
      const st = { key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { return b; },
        async maybeSingle() { return { data: rows.find((r) => r.key === st.key) || null, error: null }; },
        // the hub's one switch read is an .in() list
        then(res, rej) { return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

let WaitUx;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  settingsReads = 0;
  seed();
  WaitUx = require('../../../shared/services/quiz/web-quiz-wait-ux');
});

const tick = async () => {
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setTimeout(res, 5));
};

describe('the designed wait\'s switch never reads on its own', () => {
  test('a cold cache: off, and no settings read starts', async () => {
    rows = [{ key: KEY, value: true }];
    expect(WaitUx.on()).toBe(false);
    await tick();
    expect(settingsReads).toBe(0);
  });

  test('a cache older than two cache lives is off, even with the stored value true; inside them it stays on', async () => {
    rows = [{ key: KEY, value: true }];
    const t0 = Date.now();
    expect(await WaitUx.refresh()).toBe(true);
    const reads = settingsReads;
    expect(WaitUx.on(t0 + 1000)).toBe(true);
    expect(WaitUx.on(t0 + 31 * 1000)).toBe(true);
    expect(WaitUx.on(t0 + 61 * 1000)).toBe(false);
    await tick();
    expect(settingsReads).toBe(reads);
  });

  test('the hub\'s switch read primed with the key true: on, with no read of its own', async () => {
    rows = [{ key: KEY, value: true }];
    await require('../../../shared/services/quiz/web-quiz-hub-flags').flags();
    const before = settingsReads;
    expect(WaitUx.on()).toBe(true);
    await tick();
    expect(settingsReads).toBe(before);
  });
});
