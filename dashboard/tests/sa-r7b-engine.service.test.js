'use strict';
/**
 * Round 7b, part B: the engine's door (sa-engine.js) for the coach's controls and the auto stop-checks.
 *   ui.end_test_restart  the coach page's End test (sa:coach_end) leaves one end_test event { by:'coach', mode } on the
 *                        task on show before the run ends (OFF: no such event, the end as before).
 *   ui.end_section       the coach page's End this section (sa:end_section), RDF manual: the runner ends the section.
 *   ui.silence_repeat    RDF auto: the voice watch runs on every read-aloud recording, and the silent attempt's
 *                        recording is discarded (rec.discard), never uploaded; ui.under20_move_on reaches the runner.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');

function fakes(s) {
  let uiOpts = null;
  return {
    ui: () => uiOpts,
    deps: {
      core, store: { open: () => Promise.resolve(s) },
      ui: { mount: (el, o) => { uiOpts = o; return { destroy() {}, render() {} }; } },
      voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
      now: (() => { let t = 0; return () => (t += 100); })(),
    },
  };
}
function framed(f) {
  const listeners = {};
  const posted = [];
  const win = { location: { origin: 'https://p.test' }, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  win.parent = { postMessage: (m) => posted.push(m) };
  f.deps.win = win;
  f.deps.sync = { create: () => ({ flush: async () => ({ state: 'synced' }), poke() {}, status: () => ({}), stop() {} }) };
  return { listeners, posted, send: (data) => listeners.message({ origin: 'https://p.test', data }) };
}
const tap = (id, n) => ({ id, mode: 'tap', items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, target: 'a', options: ['a', 'b'] })) });
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('end_test (ui.end_test_restart)', () => {
  for (const [manual, mode] of [[false, 'auto'], [true, 'coach_led']]) {
    test(`ON (${mode}): the coach's End test leaves one end_test event on the running task, then sa:done coach_end`, async () => {
      const s = await storeMod.open({ idb: null });
      const f = fakes(s);
      const w = framed(f);
      const b = { battery_id: 'et', ui: { end_test_restart: true }, tasks: [tap('ur.a', 2), tap('ur.b', 1)] };
      const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', embed: true, manual, session_id: 's-et', sink: {}, audio_check: false, warmup: false }, f.deps);
      e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a');
      w.send({ type: 'sa:coach_end', s: 's-et' });
      await settle();
      const ev = (await s.events('s-et')).filter((x) => x.type === 'end_test');
      expect(ev).toEqual([expect.objectContaining({ task_id: 'ur.a', value: { by: 'coach', mode } })]);
      expect(w.posted).toEqual([expect.objectContaining({ type: 'sa:done', reason: 'coach_end' })]);
    });
  }
  test('OFF: no end_test event', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const w = framed(f);
    const b = { battery_id: 'et0', tasks: [tap('ur.a', 2)] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', embed: true, session_id: 's-et0', sink: {}, audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    w.send({ type: 'sa:coach_end', s: 's-et0' });
    await settle();
    expect((await s.events('s-et0')).map((x) => x.type)).not.toContain('end_test');
  });
});

describe('end_section (ui.end_section, RDF manual)', () => {
  test('ON: sa:end_section from the coach page ends the section; another session, another origin or RDF auto: nothing', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const w = framed(f);
    const b = { battery_id: 'es', ui: { end_section: true }, tasks: [tap('ur.a', 2), tap('ur.b', 1), tap('en.c', 1)] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', embed: true, manual: true, session_id: 's-es', sink: {}, audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    w.send({ type: 'sa:end_section', s: 'other' });
    w.listeners.message({ origin: 'https://evil.test', data: { type: 'sa:end_section', s: 's-es' } });
    expect(e.runner.results()).toEqual([]);
    w.send({ type: 'sa:end_section', s: 's-es' });
    expect(e.runner.results().map((r) => r.stop_reason)).toEqual(['end_section', 'skipped_end_section']);
    e.runner.next();
    expect(e.runner.view().task.id).toBe('en.c');
  });
  test('OFF (no ui flag): nothing', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const w = framed(f);
    const e = await start({ mount: {}, battery: { battery_id: 'es0', tasks: [tap('ur.a', 2), tap('ur.b', 1)] }, mode: 'proctored', lang: 'ur', embed: true, manual: true, session_id: 's-es0', sink: {}, audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    w.send({ type: 'sa:end_section', s: 's-es0' });
    expect(e.runner.results()).toEqual([]);
  });
});

describe('silence_repeat + under20 (RDF auto)', () => {
  const CELLS = { id: 'ur.w', mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60, items: [{ id: 'c1', target: 'x', show: 'x' }] };
  function recFake() {
    const calls = { start: 0, stop: 0, discard: 0, onVoice: 0 };
    return { calls, rec: { create: () => ({
      ready: async () => true, start: () => { calls.start++; return true; }, stop: async () => { calls.stop++; return { parts: 1, duration_ms: 1 }; },
      discard: async () => { calls.discard++; return null; }, release() {}, recording: () => false,
      onVoice: () => { calls.onVoice++; return () => {}; }, onSilence: () => () => {},
    }) } };
  }
  test('ON: the voice watch runs on the read-aloud part; the silent attempt is discarded, not stopped', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const r = recFake();
    f.deps.rec = r.rec;
    f.deps.micState = () => 'ok';
    const b = { battery_id: 'sr', ui: { silence_repeat: true }, tasks: [CELLS, tap('ur.b', 1)] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', session_id: 's-sr', audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    f.ui().onRecordStart(e.runner.view().task);
    await settle(0);
    expect(r.calls.onVoice).toBe(1);
    e.runner.nextCell('tap');
    expect(e.runner.view().phase).toBe('silence_reminder');
    await f.ui().onRecordStop(CELLS);
    expect(r.calls).toMatchObject({ discard: 1, stop: 0 });
  });
  test('OFF: no voice watch on a plain part, and the recording stops as before', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const r = recFake();
    f.deps.rec = r.rec;
    f.deps.micState = () => 'ok';
    const e = await start({ mount: {}, battery: { battery_id: 'sr0', tasks: [CELLS] }, mode: 'proctored', lang: 'ur', session_id: 's-sr0', audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    f.ui().onRecordStart(e.runner.view().task);
    await settle(0);
    e.runner.nextCell('tap');
    await f.ui().onRecordStop(CELLS);
    expect(r.calls).toMatchObject({ onVoice: 0, discard: 0, stop: 1 });
  });
  test('ui.under20_move_on reaches the runner (RDF auto)', async () => {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const e = await start({ mount: {}, battery: { battery_id: 'u20', ui: { under20_move_on: true }, tasks: [tap('ur.a', 10), tap('ur.b', 1), tap('en.c', 1)] }, mode: 'proctored', lang: 'ur', session_id: 's-u20', audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    for (let i = 0; i < 10; i++) e.runner.answer('b');
    expect(e.runner.results().map((x) => x.stop_reason)).toEqual(['complete', 'skipped_under20']);
  });
});
