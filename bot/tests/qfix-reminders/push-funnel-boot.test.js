'use strict';
/**
 * The day's push_funnel_daily row (the daily read's C2 denominator) is logged by the funnel tick, once per PKT day after
 * 21:00 PKT. The tick ran only on the hourly interval, which starts again with every worker restart, so a deploy late in
 * the evening delayed the row by an hour, and one after ~23:00 PKT lost the day's row. The boot run now calls it with
 * the due and expiry ticks (it is time-gated and once-per-day guarded, so a call before 21:00 PKT does nothing).
 */
const { schedulePushTicks } = require('../../workers/push-ticks');

function boot() {
  const timeouts = [];
  const intervals = [];
  const calls = [];
  schedulePushTicks({
    setIntervalFn: (fn, ms) => intervals.push([fn, ms]),
    setTimeoutFn: (fn, ms) => { timeouts.push([fn, ms]); },
    dueTick: async () => { calls.push('due'); },
    expireTick: async () => { calls.push('expire'); },
    funnelTick: async () => { calls.push('funnel'); return null; },
    envReady: () => true,
  });
  return { timeouts, intervals, calls };
}

afterEach(() => { delete process.env.WEB_QUIZ_PUSH_SEND_ENABLED; });

test('the boot run calls the funnel tick once, with the send switch on, before any interval fires', async () => {
  process.env.WEB_QUIZ_PUSH_SEND_ENABLED = '1';
  const b = boot();
  for (const [fn] of b.timeouts) await fn();
  expect(b.calls.filter((c) => c === 'funnel')).toHaveLength(1);
  expect(b.calls).toEqual(['expire', 'due', 'funnel']);
});

test('with the send switch off, the boot run leaves the funnel tick alone', async () => {
  const b = boot();
  for (const [fn] of b.timeouts) await fn();
  expect(b.calls).not.toContain('funnel');
});

test('the hourly funnel interval is still scheduled', async () => {
  process.env.WEB_QUIZ_PUSH_SEND_ENABLED = '1';
  const b = boot();
  for (const [fn] of b.timeouts) await fn();
  expect(b.intervals.map(([, ms]) => ms)).toContain(60 * 60 * 1000);
});
