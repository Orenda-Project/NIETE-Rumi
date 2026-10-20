'use strict';
/**
 * The hand-back (dashboard/sa/sa-ui.js handback): with the engine's onUnlock the screen never navigates itself: the
 * engine flushes the last writes and the sync, then goes to back or posts sa:done, once. A page without onUnlock (the
 * standalone demo) goes to back directly.
 */
const { handback } = require('../sa/sa-ui');
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');

test('with onUnlock the screen does not navigate; without it, it goes to back', () => {
  const went = [];
  const calls = [];
  handback({ onHandback: () => calls.push('handback'), onUnlock: () => calls.push('unlock'), back: '/list' }, (u) => went.push(u), (u) => u);
  expect(calls).toEqual(['handback', 'unlock']);
  expect(went).toEqual([]);
  handback({ back: '/list' }, (u) => went.push(u), (u) => u);
  expect(went).toEqual(['/list']);
});

test('the engine navigates once, only after the last writes and the sync flush', async () => {
  const order = [];
  const store = await storeMod.open({ idb: null });
  const origAppend = store.appendEvent;
  store.appendEvent = (e) => new Promise((r) => setTimeout(r, 5)).then(() => { order.push('wrote ' + e.type); return origAppend(e); });
  let uiOpts = null;
  const win = { location: { assign: (u) => order.push('go ' + u), origin: 'https://p.test' } };
  win.parent = win;
  {
    const e = await start({ mount: {}, mode: 'proctored', lang: 'ur', back: '/list', audio_check: false, warmup: false,
      battery: { battery_id: 'b', tasks: [{ id: 't', mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] }] },
      sink: { putBatch: async () => { order.push('flushed'); return { ok: true }; }, presignAudio: async () => ({}), registerAudio: async () => ({}) } },
    { core, store: { open: async () => store }, ui: { mount: (el, o) => { uiOpts = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
      sync: require('../sa/sa-sync'), win, now: (() => { let t = 0; return () => (t += 10); })() });
    e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a'); e.runner.next();
    uiOpts.onUnlock();
    await new Promise((r) => setTimeout(r, 200));
    const go = order.indexOf('go /list');
    expect(go).toBeGreaterThan(-1);
    expect(order.filter((x) => x === 'go /list')).toHaveLength(1);
    expect(order.lastIndexOf('wrote handover_out')).toBeLessThan(go);
    expect(order.lastIndexOf('flushed')).toBeLessThan(go);
    e.destroy();
  }
});
