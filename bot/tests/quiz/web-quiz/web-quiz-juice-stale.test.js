'use strict';
/**
 * The sound + motion kit switch (app_settings web_quiz_juice, 30 s cache) on the quiz page's last round trip: with the
 * fast page on (web_quiz_fast), a value older than 30 s is answered at once and read again in the background, so the
 * quiz page never waits for it; a failed background read keeps the value. Off: a stale value waits for its read, as
 * today. Supabase is the boundary (faked, every read counted).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('./fake-supabase');

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
let reads;
let down;
let Juice;
let Fast;
function boot({ fast }) {
  jest.resetModules();
  reads = 0;
  down = false;
  const supabase = require('../../../shared/config/supabase');
  const fake = makeFake({ app_settings: [{ key: 'web_quiz_juice', value: true }, ...(fast ? [{ key: 'web_quiz_fast', value: true }] : [])] });
  Object.assign(supabase, { from: (t) => {
    if (t === 'app_settings') {
      const q = fake.from(t);
      const real = q.select.bind(q);
      q.select = (...a) => {
        const chain = real(...a);
        const eq = chain.eq.bind(chain);
        chain.eq = (k, v) => { const c = eq(k, v); if (v === 'web_quiz_juice') { reads += 1; if (down) throw new Error('db down'); } return c; };
        return chain;
      };
      return q;
    }
    return fake.from(t);
  } });
  Juice = require('../../../shared/services/quiz/web-quiz-juice');
  Fast = require('../../../shared/services/quiz/web-quiz-fast');
}
const settle = () => new Promise((r) => setImmediate(r));
beforeAll(() => jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] }));
afterAll(() => jest.useRealTimers());
beforeEach(() => jest.setSystemTime(NOW));

test('fast on: a stale value is answered at once (no read waited for), read again behind it; a failed re-read keeps it', async () => {
  boot({ fast: true });
  Fast.on();
  await settle();
  expect(await Juice.flag()).toBe(true); // cold: waited for, as today
  expect(reads).toBe(1);
  jest.setSystemTime(NOW + 31 * 1000);
  Fast.on();
  await settle();
  down = true;
  const p = Juice.flag();
  expect(reads).toBe(2);                 // the background read started
  expect(await p).toBe(true);            // answered from the cache
  await settle();
  expect(await Juice.flag()).toBe(true); // the failed read kept the value
});

test('fast off: a stale value waits for its read, as today', async () => {
  boot({ fast: false });
  Fast.on();
  await settle();
  expect(await Juice.flag()).toBe(true);
  jest.setSystemTime(NOW + 31 * 1000);
  const before = reads;
  expect(await Juice.flag()).toBe(true);
  expect(reads).toBe(before + 1);
});
