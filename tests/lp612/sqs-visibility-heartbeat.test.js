/**
 * The reusable heartbeat helper itself (bot/shared/utils/sqs-visibility-heartbeat.js), in
 * isolation from sqs-worker.js's lp612_author wiring — see tests/lp612/visibility-heartbeat.test.js
 * for the integration-level coverage against the real `executeJob` switch.
 *
 * Deliberately generic (no lp612 naming inside the helper) so another long-running job can adopt
 * it later without copying the pattern by hand.
 */

const { startVisibilityHeartbeat } = require('../../bot/shared/utils/sqs-visibility-heartbeat');

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('startVisibilityHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects a missing extend function rather than silently doing nothing', () => {
    expect(() => startVisibilityHeartbeat({})).toThrow(/extend/);
  });

  test('calls extend on every interval tick until stopped', async () => {
    const extend = jest.fn(() => Promise.resolve());
    const hb = startVisibilityHeartbeat({ extend, intervalMs: 1000, extendSeconds: 900 });

    await jest.advanceTimersByTimeAsync(3500);
    await flush();
    expect(extend).toHaveBeenCalledTimes(3);
    expect(extend).toHaveBeenCalledWith(900);

    hb.stop();
    extend.mockClear();
    await jest.advanceTimersByTimeAsync(5000);
    await flush();
    expect(extend).not.toHaveBeenCalled();
  });

  test('stop() is idempotent — calling it twice does not throw', () => {
    const hb = startVisibilityHeartbeat({ extend: () => Promise.resolve(), intervalMs: 1000 });
    hb.stop();
    expect(() => hb.stop()).not.toThrow();
  });

  test('a rejected extend() is reported via onExtendError and does not stop the heartbeat', async () => {
    const onExtendError = jest.fn();
    const extend = jest.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(undefined);
    const hb = startVisibilityHeartbeat({
      extend, intervalMs: 1000, extendSeconds: 900, onExtendError,
    });

    await jest.advanceTimersByTimeAsync(1000);
    await flush();
    expect(onExtendError).toHaveBeenCalledTimes(1);
    expect(onExtendError.mock.calls[0][0].message).toBe('blip');

    await jest.advanceTimersByTimeAsync(1000);
    await flush();
    expect(extend).toHaveBeenCalledTimes(2);

    hb.stop();
  });

  test('a throwing onExtendError callback cannot break the interval', async () => {
    const extend = jest.fn().mockRejectedValue(new Error('blip'));
    const hb = startVisibilityHeartbeat({
      extend, intervalMs: 1000, onExtendError: () => { throw new Error('logger is broken'); },
    });

    await jest.advanceTimersByTimeAsync(3000);
    await flush();
    expect(extend.mock.calls.length).toBeGreaterThanOrEqual(2);

    hb.stop();
  });

  test('stops extending once the ceiling is reached, and fires onCeilingReached exactly once', async () => {
    const extend = jest.fn(() => Promise.resolve());
    const onCeilingReached = jest.fn();
    const hb = startVisibilityHeartbeat({
      extend, intervalMs: 1000, ceilingMs: 2500, onCeilingReached,
    });

    await jest.advanceTimersByTimeAsync(10000);
    await flush();

    expect(onCeilingReached).toHaveBeenCalledTimes(1);
    const callsAtCeiling = extend.mock.calls.length;
    expect(callsAtCeiling).toBeGreaterThan(0);

    extend.mockClear();
    await jest.advanceTimersByTimeAsync(10000);
    await flush();
    expect(extend).not.toHaveBeenCalled();
    expect(onCeilingReached).toHaveBeenCalledTimes(1); // fires once, not on every tick past it

    hb.stop();
  });

  test('no ceiling means it keeps extending indefinitely (the caller is responsible for stop())', async () => {
    const extend = jest.fn(() => Promise.resolve());
    const hb = startVisibilityHeartbeat({ extend, intervalMs: 1000 }); // ceilingMs omitted

    await jest.advanceTimersByTimeAsync(60000);
    await flush();
    expect(extend.mock.calls.length).toBe(60);

    hb.stop();
  });
});
