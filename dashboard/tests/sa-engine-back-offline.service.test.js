'use strict';
/**
 * The game's way back to the map (dashboard/sa/sa-engine.js done()): the map is an online page, so in game mode the
 * engine leaves only when the map answers. Offline, the child stays on the engine's last screen and goes once the
 * network returns (the 'online' event, or a re-probe), never to the browser's no-internet page. The coach's
 * (proctored) way back is unchanged. A stand-in window; nothing leaves the test.
 */
const { done } = require('../sa/sa-engine');

const runner = { results: () => [] };
function win(reachable) {
  const w = { went: [], probes: 0, listeners: {}, reachable };
  w.location = { origin: 'https://p.test', assign: (u) => w.went.push(u) };
  w.parent = w;
  w.addEventListener = (t, fn) => { (w.listeners[t] = w.listeners[t] || []).push(fn); };
  w.removeEventListener = (t, fn) => { w.listeners[t] = (w.listeners[t] || []).filter((f) => f !== fn); };
  w.fetch = (url, init) => { w.probes += 1; w.lastProbe = { url, method: init.method, cache: init.cache }; return w.reachable ? Promise.resolve({ status: 200 }) : Promise.reject(new TypeError('Failed to fetch')); };
  w.fire = (t) => (w.listeners[t] || []).slice().forEach((f) => f());
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('game, online: probes the map (HEAD, no-store) and then goes to it', async () => {
  const w = win(true);
  expect(done(w, { mode: 'game', back: '/sa-game/t?kid=k&done=maths&s=s1' }, 's1', runner)).toBe('waiting');
  await tick();
  expect(w.lastProbe).toEqual({ url: '/sa-game/t?kid=k&done=maths&s=s1', method: 'HEAD', cache: 'no-store' });
  expect(w.went).toEqual(['/sa-game/t?kid=k&done=maths&s=s1']);
});

test('game, offline: stays put; goes once when the network returns; a second tap starts no second wait', async () => {
  const w = win(false);
  expect(done(w, { mode: 'game', back: '/map' }, 's1', runner)).toBe('waiting');
  await tick();
  expect(w.went).toEqual([]);
  expect(done(w, { mode: 'game', back: '/map' }, 's1', runner)).toBe('waiting');
  await tick();
  expect(w.listeners.online).toHaveLength(1);
  w.reachable = true;
  w.fire('online');
  await tick();
  expect(w.went).toEqual(['/map']);
  w.fire('online');
  await tick();
  expect(w.went).toEqual(['/map']);
  expect(w.listeners.online).toHaveLength(0);
});

test('game, a server error (the offline worker\'s 503) counts as not there yet; a later re-probe goes', async () => {
  jest.useFakeTimers();
  try {
    const w = win(true);
    let status = 503;
    w.fetch = () => { w.probes += 1; return Promise.resolve({ status }); };
    done(w, { mode: 'game', back: '/map' }, 's1', runner);
    await flush();
    expect(w.went).toEqual([]);
    status = 200;
    jest.advanceTimersByTime(10000);
    await flush();
    expect(w.probes).toBe(2);
    expect(w.went).toEqual(['/map']);
  } finally { jest.useRealTimers(); }
});

test('proctored (the coach): goes at once, no probe, as before', () => {
  const w = win(false);
  expect(done(w, { mode: 'proctored', back: '/list' }, 's1', runner)).toBe('navigated');
  expect(done(w, { back: '/list' }, 's1', runner)).toBe('navigated');
  expect(w.probes).toBe(0);
  expect(w.went).toEqual(['/list', '/list']);
});

test('the engine: game mode, offline at the hand-back → the screen\'s back-wait line once; the network back → leaves', async () => {
  const core = require('../sa/sa-core');
  const storeMod = require('../sa/sa-store');
  const { start } = require('../sa/sa-engine');
  const store = await storeMod.open({ idb: null });
  const w = win(false);
  const waits = [];
  let uiOpts = null;
  const e = await start({ mount: {}, mode: 'game', lang: 'en', back: '/map', audio_check: false, warmup: false, mic_check: false,
    battery: { battery_id: 'b', tasks: [{ id: 't', mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] }] }, sink: null },
  { core, store: { open: async () => store }, ui: { mount: (el, o) => { uiOpts = o; return { backWait: () => waits.push(1) }; } },
    voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, win: w });
  uiOpts.onUnlock();
  await tick(); await tick();
  expect(waits).toEqual([1]);
  expect(w.went).toEqual([]);
  w.reachable = true;
  w.fire('online');
  await tick();
  expect(w.went).toEqual(['/map']);
  expect(waits).toEqual([1]);
  e.destroy();
});
