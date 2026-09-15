'use strict';
/**
 * A deploy must not cut a webhook's work off after the ack.
 *
 * The /webhook route acks Meta first and does the work afterwards (a quiz
 * answer, the next question, a class card, an enqueue). The old drain exited in
 * server.close()'s callback, which fires as soon as the sockets close — that is,
 * right after the ack, not after the work. Production container logs for four
 * web deploys on 15 Sep 2026 show quiz sends waiting on the rate limiter in the
 * seconds before "HTTP server drained, exiting", logged in the same millisecond
 * as SIGTERM.
 *
 * The drain now waits for tracked webhook work, bounded so it always exits
 * inside Railway's 30-second draining window.
 */
const { EventEmitter } = require('events');

const later = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  jest.resetModules();
  const drainMod = require('../../bot/shared/utils/web-drain');
  const proc = new EventEmitter();
  const server = { close: jest.fn(), closeIdleConnections: jest.fn() };
  const exit = jest.fn();
  const log = jest.fn();
  drainMod.installWebDrain({ server, proc, exit, log, waitMs: 1000, forceMs: 2000, ...opts });
  return { drainMod, proc, server, exit, log };
}

describe('web drain', () => {
  test('SIGTERM waits for webhook work that is still running, then exits', async () => {
    const { drainMod, proc, server, exit } = setup();
    drainMod.trackWebhookWork(later(250));
    proc.emit('SIGTERM');
    expect(server.close).toHaveBeenCalled();
    await later(100);
    expect(exit).not.toHaveBeenCalled();
    await later(250);
    expect(exit).toHaveBeenCalledWith(0);
    expect(drainMod.inFlightCount()).toBe(0);
  });

  test('with nothing in flight it exits straight away', async () => {
    const { proc, exit } = setup();
    proc.emit('SIGTERM');
    await later(20);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('work that never finishes cannot hold the process past the deadline', async () => {
    const { drainMod, proc, exit, log } = setup({ waitMs: 150 });
    drainMod.trackWebhookWork(new Promise(() => {}));
    proc.emit('SIGTERM');
    await later(80);
    expect(exit).not.toHaveBeenCalled();
    await later(150);
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.map((c) => c[0]).join('\n')).toMatch(/still running/);
  });

  test('a failed piece of work still counts as finished', async () => {
    const { drainMod, proc, exit } = setup();
    drainMod.trackWebhookWork(later(100).then(() => { throw new Error('boom'); })).catch(() => {});
    proc.emit('SIGTERM');
    await later(200);
    expect(exit).toHaveBeenCalledWith(0);
    expect(drainMod.inFlightCount()).toBe(0);
  });

  test('a second signal does not exit twice', async () => {
    const { proc, exit } = setup();
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await later(50);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
