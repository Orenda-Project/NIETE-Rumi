'use strict';
/**
 * The battery's end, embedded in the coach page (dashboard/sa/sa-engine.js, RULING #34a): the engine tells the page
 * ({type:'sa:battery_end', s}) as the last task ends, then closes the recording and flushes, so the child is complete
 * however the coach takes the phone back. The page's hold after that is answered sa:done {reason:'complete'}, never a
 * coach_end. Only this session's page, only its origin.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');

function setup(s, order) {
  const listeners = {};
  const posted = [];
  const win = { location: { origin: 'https://p.test' }, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  win.parent = { postMessage: (m, o) => { posted.push([m, o]); order.push(m.type); } };
  const deps = {
    core,
    store: { open: () => Promise.resolve(s) },
    ui: { mount: () => ({ destroy() {} }) },
    voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
    sync: { create: () => ({ flush: async () => { order.push('flushed'); return { state: 'synced' }; }, poke() {}, status: () => ({}), stop() {} }) },
    now: (() => { let t = 0; return () => (t += 100); })(),
    win,
  };
  return { listeners, posted, deps };
}

const battery = { battery_id: 'be', tasks: [{ id: 'letters', mode: 'tap', items: [{ id: 'i1', target: 'a', options: ['a', 'b'] }] }] };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('embedded: battery_end posts sa:battery_end to the page, then flushes', async () => {
  const s = await storeMod.open({ idb: null });
  const order = [];
  const { posted, deps } = setup(s, order);
  const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'en', embed: true, session_id: 'sess-be', sink: {}, audio_check: false, warmup: false }, deps);
  e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a');
  await tick(10);
  expect(posted).toEqual([]);
  e.runner.next();
  expect(e.runner.view().phase).toBe('battery_end');
  await tick(10);
  expect(posted).toEqual([[{ type: 'sa:battery_end', s: 'sess-be' }, 'https://p.test']]);
  expect(order).toEqual(['sa:battery_end', 'flushed']);
});

test('a coach hold after battery_end is answered sa:done complete, and logs no coach_end', async () => {
  const s = await storeMod.open({ idb: null });
  const order = [];
  const { listeners, posted, deps } = setup(s, order);
  const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'en', embed: true, session_id: 'sess-be2', sink: {}, audio_check: false, warmup: false }, deps);
  e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a'); e.runner.next();
  await tick(10);
  listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 'sess-be2' } });
  await tick(10);
  expect(posted.map((p) => p[0])).toEqual([{ type: 'sa:battery_end', s: 'sess-be2' }, { type: 'sa:done', s: 'sess-be2', reason: 'complete' }]);
  expect(e.runner.results().map((r) => r.stop_reason)).toEqual(['complete']);
  const types = (await s.events('sess-be2')).map((x) => x.type);
  expect(types).not.toContain('coach_end_run');
  listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 'sess-be2' } });
  await tick(10);
  expect(posted).toHaveLength(2);
});

test('not embedded (the game): no message at battery_end', async () => {
  const s = await storeMod.open({ idb: null });
  const order = [];
  const { posted, deps } = setup(s, order);
  const e = await start({ mount: {}, battery, mode: 'game', lang: 'en', session_id: 'sess-be3', audio_check: false, warmup: false }, deps);
  e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a'); e.runner.next();
  await tick(10);
  expect(posted).toEqual([]);
});

describe('the sandbox-only jump (RULING #43): the engine hands it on only with SA_DEV_TOOLS, coach mode only', () => {
  async function boot(mode, flag) {
    const s = await storeMod.open({ idb: null });
    let uiOpts = null;
    const deps = {
      core,
      store: { open: () => Promise.resolve(s) },
      ui: { mount: (el, o) => { uiOpts = o; return { destroy() {}, render() {} }; } },
      voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
      now: (() => { let t = 0; return () => (t += 100); })(),
      win: { location: { origin: 'https://p.test' }, SA_DEV_TOOLS: flag },
    };
    const e = await start({ mount: {}, battery: { battery_id: 'j', tasks: [battery.tasks[0], { id: 'words', mode: 'tap', items: [{ id: 'w', target: 'a', options: ['a', 'b'] }] }] }, mode, lang: 'en', audio_check: false, warmup: false }, deps);
    return { e, ui: () => uiOpts };
  }
  test('SA_DEV_TOOLS true, proctored: devJump starts the chosen task, the one passed over is skipped_dev', async () => {
    const { e, ui } = await boot('proctored', true);
    expect(typeof ui().devJump).toBe('function');
    e.runner.start();
    ui().devJump(1);
    expect(e.runner.view().task.id).toBe('words');
    expect(e.runner.results().map((r) => r.stop_reason)).toEqual(['skipped_dev']);
  });
  test('no flag, a string flag, or game mode: no devJump and no jumpTo', async () => {
    for (const [mode, flag] of [['proctored', undefined], ['proctored', 'true'], ['game', true]]) {
      // eslint-disable-next-line no-await-in-loop
      const { e, ui } = await boot(mode, flag);
      expect(ui().devJump).toBeUndefined();
      expect(e.runner.jumpTo).toBeUndefined();
    }
  });
});
