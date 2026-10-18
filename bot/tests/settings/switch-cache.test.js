'use strict';
/**
 * settings/switch-cache: a good read is kept for the TTL (an expired one awaits a fresh read); a failed read is kept for
 * the TTL as the last good value, else OFF; one log line per failed read; callers at once share one read.
 */
const { cachedSwitch } = require('../../shared/services/settings/switch-cache');

const TTL = 30 * 1000;

function make({ off = false } = {}) {
  const store = { mode: 'ok', value: true, reads: 0, logs: 0 };
  const sw = cachedSwitch({
    ttlMs: TTL,
    off,
    read: async () => {
      store.reads += 1;
      await Promise.resolve();
      if (store.mode === 'down') throw new Error('settings store down');
      return store.value;
    },
    log: () => { store.logs += 1; },
  });
  return { sw, store };
}

test('(1) 20 calls in an outage, 10 of them at once → 1 read, 1 log line, OFF', async () => {
  const { sw, store } = make();
  store.mode = 'down';
  const answers = await Promise.all(Array.from({ length: 10 }, () => sw.get(0)));
  for (let i = 1; i <= 10; i += 1) answers.push(await sw.get(i * 2900));
  expect(answers.every((a) => a === false)).toBe(true);
  expect(store.reads).toBe(1);
  expect(store.logs).toBe(1);
});

test('(2) after the TTL, still down → exactly 1 more read', async () => {
  const { sw, store } = make();
  store.mode = 'down';
  await sw.get(0);
  await sw.get(TTL - 1);
  expect(store.reads).toBe(1);
  await sw.get(TTL);
  await sw.get(TTL + 5);
  expect(store.reads).toBe(2);
  expect(store.logs).toBe(2);
});

test('(3) recovery: the first good read after the TTL takes effect', async () => {
  const { sw, store } = make();
  store.mode = 'down';
  expect(await sw.get(0)).toBe(false);
  store.mode = 'ok';
  expect(await sw.get(TTL)).toBe(true);
  expect(await sw.get(TTL + 1)).toBe(true);
  expect(store.reads).toBe(2);
});

test('(4) last known ON then an outage → ON for the TTL; never read then an outage → OFF (a fresh off each time)', async () => {
  const { sw, store } = make();
  expect(await sw.get(0)).toBe(true);
  store.mode = 'down';
  expect(await sw.get(TTL)).toBe(true);
  expect(await sw.get(2 * TTL - 1)).toBe(true);
  expect(store.reads).toBe(2);

  const fresh = make({ off: () => ({ on: false }) });
  fresh.store.mode = 'down';
  const a = await fresh.sw.get(0);
  const b = await fresh.sw.get(1);
  expect(a).toEqual({ on: false });
  expect(a).not.toBe(b);
});

test('(5) healthy: kept for the TTL, an expired value awaits a fresh read, no log line', async () => {
  const { sw, store } = make();
  expect(await sw.get(0)).toBe(true);
  store.value = false;
  expect(await sw.get(TTL - 1)).toBe(true);
  expect(await sw.get(TTL)).toBe(false);
  expect(store.reads).toBe(2);
  expect(store.logs).toBe(0);
});

test('set() (another module\'s good read) is a good read; fresh() says so; reset() forgets', async () => {
  const { sw, store } = make();
  store.mode = 'down';
  await sw.get(0);
  sw.set(true, 10);
  expect(sw.fresh(10)).toBe(true);
  expect(await sw.get(11)).toBe(true);
  expect(store.reads).toBe(1);
  sw.reset();
  expect(sw.fresh(11)).toBe(false);
  expect(await sw.get(12)).toBe(false);
  expect(store.reads).toBe(2);
});

test('a log that throws never reaches the caller', async () => {
  const sw = cachedSwitch({ ttlMs: TTL, off: false, read: async () => { throw new Error('x'); }, log: () => { throw new Error('y'); } });
  await expect(sw.get(0)).resolves.toBe(false);
});

test('get(now, { retryFailed: true }) reads once more past a cached failed read; never past a good one', async () => {
  const { sw, store } = make();
  store.mode = 'down';
  await sw.get(0);
  store.mode = 'ok';
  expect(await sw.get(1)).toBe(false);
  expect(await sw.get(2, { retryFailed: true })).toBe(true);
  expect(await sw.get(3, { retryFailed: true })).toBe(true);
  expect(store.reads).toBe(2);
});

test('peek(now): the good value while fresh, else undefined; it never reads', async () => {
  const { sw, store } = make();
  expect(sw.peek(0)).toBeUndefined();
  expect(store.reads).toBe(0);
  await sw.get(0);
  expect(sw.peek(1)).toBe(true);
  expect(sw.peek(TTL)).toBeUndefined();
  store.mode = 'down';
  await sw.get(TTL);
  expect(sw.peek(TTL + 1)).toBeUndefined();
  expect(store.reads).toBe(2);
});
