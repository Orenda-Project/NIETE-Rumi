'use strict';
/**
 * Round 20 (the Urdu reviewer, 13 Nov: "if a child ... stays silent through a section, Jugnu should end that part and move
 * the child to the next subject"; the coach can end a section in RDF auto too). Each behind its own switch, OFF = today.
 *
 *   sa_r20_silence_stop      N (1 to 3, a number or its string): battery.ui.r20_silence_stop = N. RDF auto: an Urdu or
 *                            English letter/word part shown one cell at a time (the parts that wait for Next) is SILENT when
 *                            its recording ran with the ear listening and no voice was heard on any cell. A silent part gets
 *                            the one reminder and repeat as today (sa_silence_repeat); silent again, it counts. N silent
 *                            parts in a row of one subject end that subject (incomplete_move_on { reason: 'silence',
 *                            in_a_row: N }); a part with any voice starts the count again. The story's 20 s watch also runs
 *                            on these parts, and ends a part where no voice was heard at all. Time-up is not silence: a part
 *                            where a voice was heard is never touched.
 *   sa_r20_auto_end_section  battery.ui.r20_auto_end_section = true: the coach's End this section (sa_end_section) works in
 *                            RDF auto too.
 */
const express = require('express');
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');
const { applySwitches, MATCH } = require('../routes/sa-battery-switches');
const { createBrotliFlag } = require('../routes/web-quiz-brotli-flag');

const cells = (id, n = 2) => ({ id, mode: 'record', present: 'one_at_a_time', time_limit_s: 60,
  items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, target: 'x', show: 'x' })) });
const tap = (id, n = 1) => ({ id, mode: 'tap', items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, target: 'a', options: ['a', 'b'] })) });
// the RDF auto switches live today that these parts run under
const AUTO = { one_at_a_time: true, cell_next_only: true, silence_repeat: true, incomplete: true };

/** A runner over `tasks` with the round 20 rule at N (null: OFF); the clock moves 100 ms per read. */
function runner(tasks, n, extra = {}) {
  let t = 0;
  const events = [];
  const r = core.createRunner({ battery: { battery_id: 'r20', tasks }, now: () => (t += 100), onEvent: (e) => events.push(e),
    ...AUTO, ...(n == null ? {} : { silence_in_a_row: n }), ...extra });
  return { r, events, moves: () => events.filter((e) => e.type === 'incomplete_move_on').map((e) => e.value) };
}
/** The part on show, run once: the recorder opens, the ear listens, `voice` says whether the child spoke, Next on each cell. */
function once(r, { voice = false, ear = 'running' } = {}) {
  if (r.view().phase === 'instruction') r.instructionDone();
  if (r.view().phase === 'ready') r.begin();
  const t = r.view().task;
  r.log('record_start', { task_id: t.id });
  r.voiceWatch(() => ear);
  if (ear === 'unavailable') r.earUnavailable();
  for (let i = 0; i < t.items.length && r.view().phase === 'running'; i++) {
    if (voice && i === 0) r.voice();
    r.nextCell('tap');
  }
}
/** The part on show to its end: a silent first run gets the reminder and runs again (as the child would). */
function part(r, how = {}) {
  once(r, how);
  if (r.view().phase === 'silence_reminder') { r.silenceRepeatDone(); once(r, how); }
}
const stops = (r) => r.results().map((x) => [x.task_id, x.stop_reason]);
const go = (r) => { if (r.view().phase === 'task_end') r.next(); };

describe('sa_r20_silence_stop: the runner', () => {
  const URDU = () => [cells('ur.names'), cells('ur.sounds'), cells('ur.words'), tap('ur.story'), tap('en.next')];

  test('N=2: two silent parts in a row end the subject; the child goes on to the next subject', () => {
    const { r, moves } = runner(URDU(), 2);
    r.start();
    part(r); go(r);
    expect(stops(r)).toEqual([['ur.names', 'complete']]);
    expect(r.results()[0].silent).toBe(true);
    part(r);
    expect(stops(r)).toEqual([['ur.names', 'complete'], ['ur.sounds', 'complete'], ['ur.words', 'skipped_incomplete'], ['ur.story', 'skipped_incomplete']]);
    expect(moves()).toEqual([{ by: 'app', section: 'ur', reason: 'silence', reached: 2, of: 2, in_a_row: 2 }]);
    go(r);
    expect(r.view().task.id).toBe('en.next');
  });

  test('N=1: one silent part (after its reminder and repeat) ends the subject', () => {
    const { r, moves } = runner(URDU(), 1);
    r.start();
    part(r);
    expect(stops(r).map((x) => x[1])).toEqual(['complete', 'skipped_incomplete', 'skipped_incomplete', 'skipped_incomplete']);
    expect(moves()[0]).toMatchObject({ reason: 'silence', in_a_row: 1 });
  });

  test('N=2: a voice on one cell is not silent and starts the count again (silent, voiced, silent: no stop)', () => {
    const { r, moves } = runner(URDU(), 2);
    r.start();
    part(r); go(r);
    part(r, { voice: true }); go(r);
    expect(r.results()[1].silent).toBeUndefined();
    part(r); go(r);
    expect(stops(r)).toEqual([['ur.names', 'complete'], ['ur.sounds', 'complete'], ['ur.words', 'complete']]);
    expect(moves()).toEqual([]);
    expect(r.view().task.id).toBe('ur.story');
  });

  test('the count is per subject: a silent last Urdu part and a silent first English part are not in a row', () => {
    const { r, moves } = runner([cells('ur.words'), cells('en.names'), cells('en.sounds'), tap('ma.x')], 2);
    r.start();
    part(r); go(r);
    part(r); go(r);
    expect(moves()).toEqual([]);
    expect(r.view().task.id).toBe('en.sounds');
  });

  test('an ear that could not listen is no evidence: never a stop', () => {
    const { r, moves } = runner(URDU(), 1);
    r.start();
    part(r, { ear: 'unavailable' }); go(r);
    part(r, { ear: 'unavailable' });
    expect(moves()).toEqual([]);
    expect(r.results().every((x) => !x.silent)).toBe(true);
  });

  test('time-up with a voice heard is finished: the subject goes on (r8_timeup_continue)', () => {
    let t = 0;
    const events = [];
    const r = core.createRunner({ battery: { battery_id: 'r20', tasks: [cells('ur.names', 5), cells('ur.sounds')] }, now: () => t,
      onEvent: (e) => events.push(e), ...AUTO, timeup_continue: true, silence_in_a_row: 1 });
    r.start(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'ur.names' }); r.voiceWatch(() => 'running');
    r.voice(); r.nextCell('tap');
    t += 61000; r.tick();
    expect(stops(r)).toEqual([['ur.names', 'time_up']]);
    expect(events.filter((e) => e.type === 'incomplete_move_on')).toEqual([]);
  });

  test('the 20 s watch: no voice at all ends the part (reminder first); a part with a voice ignores it', () => {
    const { r, moves } = runner(URDU(), 1);
    r.start(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'ur.names' }); r.voiceWatch(() => 'running');
    expect(r.silence(20)).toBe(true);
    expect(r.view().phase).toBe('silence_reminder');
    r.silenceRepeatDone(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'ur.names' }); r.voiceWatch(() => 'running');
    r.silence(20);
    expect(stops(r)[0]).toEqual(['ur.names', 'early_stop_silence']);
    expect(moves()).toEqual([{ by: 'app', section: 'ur', reason: 'silence', reached: 0, of: 2, in_a_row: 1 }]);
    const v = runner(URDU(), 1).r;
    v.start(); v.instructionDone(); v.begin();
    v.log('record_start', { task_id: 'ur.names' }); v.voiceWatch(() => 'running'); v.voice();
    expect(v.silence(20)).toBe(false);
    expect(v.view().phase).toBe('running');
  });

  test('N=2: a part the 20 s watch ended, below N, does not end the subject', () => {
    const { r, moves } = runner(URDU(), 2);
    r.start();
    for (let k = 0; k < 2; k++) {
      if (r.view().phase === 'silence_reminder') r.silenceRepeatDone();
      r.instructionDone(); r.begin();
      r.log('record_start', { task_id: 'ur.names' }); r.voiceWatch(() => 'running');
      r.silence(20);
    }
    expect(stops(r)).toEqual([['ur.names', 'early_stop_silence']]);
    expect(moves()).toEqual([]);
    go(r);
    expect(r.view().task.id).toBe('ur.sounds');
  });

  test('the count survives a reload (the snapshot carries it)', () => {
    const a = runner(URDU(), 2);
    a.r.start();
    part(a.r); go(a.r);
    const snap = a.r.snapshot();
    const b = runner(URDU(), 2, { resume: snap });
    b.r.start();
    part(b.r);
    expect(b.moves()).toEqual([expect.objectContaining({ reason: 'silence', in_a_row: 2 })]);
  });

  test('OFF: two silent parts are finished as today', () => {
    const { r, moves } = runner(URDU(), null);
    r.start();
    part(r); go(r); part(r); go(r);
    expect(stops(r)).toEqual([['ur.names', 'complete'], ['ur.sounds', 'complete']]);
    expect(r.results().every((x) => x.silent === undefined)).toBe(true);
    expect(moves()).toEqual([]);
    const o = runner(URDU(), null).r;
    o.start(); o.instructionDone(); o.begin();
    o.log('record_start', { task_id: 'ur.names' });
    o.silence(20);
    expect(o.view().phase).toBe('running');
  });

  test('RDF manual: never', () => {
    const { r, moves } = runner(URDU(), 1, { manual: true });
    r.start();
    part(r); go(r); part(r);
    expect(moves()).toEqual([]);
  });

  test('maths cells (not held for Next) keep their own silence stop: the rule leaves them alone', () => {
    const { r } = runner([cells('ma.num'), tap('ma.cmp')], 2);
    r.start(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'ma.num' }); r.voiceWatch(() => 'running');
    r.silence(20);
    expect(r.view().phase).toBe('silence_reminder');
    r.silenceRepeatDone(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'ma.num' }); r.voiceWatch(() => 'running');
    r.silence(20);
    expect(stops(r)).toEqual([['ma.num', 'early_stop_silence'], ['ma.cmp', 'skipped_incomplete']]);
  });
});

// ---------- the engine: the switch reaches the runner, the 20 s watch runs on the held cells ----------
function fakes(s) {
  let uiOpts = null;
  return {
    ui: () => uiOpts,
    deps: {
      core, store: { open: () => Promise.resolve(s) },
      ui: { mount: (el, o) => { uiOpts = o; return { destroy() {}, render() {}, mercy() { uiOpts.mercies = (uiOpts.mercies || 0) + 1; } }; } },
      voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
      now: (() => { let t = 0; return () => (t += 100); })(),
      micState: () => 'ok',
    },
  };
}
function recFake() {
  const h = { voice: null, silence: null, silenceArmed: 0, calls: { stop: 0, discard: 0 } };
  h.rec = { create: () => ({
    ready: async () => true, start: () => true, stop: async () => { h.calls.stop++; return { parts: 1, duration_ms: 1 }; },
    discard: async () => { h.calls.discard++; return null; }, release() {}, recording: () => false, ear: () => 'running',
    onVoice: (cb) => { h.voice = cb; return () => { h.voice = null; }; },
    onSilence: (o, cb) => { h.silenceArmed++; h.silence = cb; return () => { h.silence = null; }; },
  }) };
  return h;
}
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('sa_r20_silence_stop: the engine', () => {
  async function run(ui, sid) {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const h = recFake();
    f.deps.rec = h.rec;
    const b = { battery_id: sid, ui: { one_at_a_time: true, cell_next_only: true, silence_repeat: true, incomplete_move_on: true, ...ui },
      tasks: [cells('ur.names'), cells('ur.sounds'), tap('en.x')] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', session_id: sid, audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    f.ui().onRecordStart(e.runner.view().task);
    await settle();
    return { e, f, h };
  }
  test('ON: the 20 s watch runs on a held letter part; its silence ends the part (the reminder first), mercy never shows', async () => {
    const { e, f, h } = await run({ r20_silence_stop: 1 }, 's-r20a');
    expect(h.silenceArmed).toBe(1);
    h.silence({ kind: 'mercy' });
    expect(f.ui().mercies || 0).toBe(0);
    h.silence({ kind: 'early_stop_silence', silence_s: 20 });
    expect(e.runner.view().phase).toBe('silence_reminder');
    await settle();
    expect(h.calls.discard).toBe(1);
  });
  test('ON: a voice heard first, the watch firing leaves the part running and the recording open', async () => {
    const { e, h } = await run({ r20_silence_stop: 1 }, 's-r20b');
    h.voice();
    h.silence({ kind: 'early_stop_silence', silence_s: 20 });
    await settle();
    expect(e.runner.view().phase).toBe('running');
    expect(h.calls).toEqual({ stop: 0, discard: 0 });
  });
  test('ON: ui.r20_silence_stop reaches the runner (one silent part, N=1, ends the subject)', async () => {
    const { e, f } = await run({ r20_silence_stop: 1 }, 's-r20c');
    e.runner.nextCell('tap'); e.runner.nextCell('tap');
    expect(e.runner.view().phase).toBe('silence_reminder');
    e.runner.silenceRepeatDone(); e.runner.instructionDone(); e.runner.begin();
    f.ui().onRecordStart(e.runner.view().task);
    await settle();
    e.runner.nextCell('tap'); e.runner.nextCell('tap');
    expect(e.runner.results().map((r) => r.stop_reason)).toEqual(['complete', 'skipped_incomplete']);
  });
  test('OFF: no watch on a held letter part (today)', async () => {
    const { h } = await run({}, 's-r20d');
    expect(h.silenceArmed).toBe(0);
  });
});

// ---------- sa_r20_auto_end_section: the coach's End this section in RDF auto ----------
describe('sa_r20_auto_end_section: the engine', () => {
  function framed(f) {
    const listeners = {};
    const win = { location: { origin: 'https://p.test' }, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
    win.parent = { postMessage() {} };
    f.deps.win = win;
    f.deps.sync = { create: () => ({ flush: async () => ({ state: 'synced' }), poke() {}, status: () => ({}), stop() {} }) };
    return { listeners, send: (data) => listeners.message({ origin: 'https://p.test', data }) };
  }
  async function run(ui, sid) {
    const s = await storeMod.open({ idb: null });
    const f = fakes(s);
    const w = framed(f);
    const b = { battery_id: sid, ui, tasks: [tap('ur.a', 2), tap('ur.b', 1), tap('en.c', 1)] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', embed: true, session_id: sid, sink: {}, audio_check: false, warmup: false }, f.deps);
    e.runner.start(); e.runner.instructionDone(); e.runner.begin();
    return { e, w, s };
  }
  test('ON (RDF auto): sa:end_section ends the section; one end_section event { by: coach }; the test goes on', async () => {
    const { e, w, s } = await run({ end_section: true, r20_auto_end_section: true }, 's-aes');
    w.send({ type: 'sa:end_section', s: 'other' });
    expect(e.runner.results()).toEqual([]);
    w.send({ type: 'sa:end_section', s: 's-aes' });
    expect(e.runner.results().map((r) => r.stop_reason)).toEqual(['end_section', 'skipped_end_section']);
    await settle(10); // the phone's store writes in order, after the call returns
    expect((await s.events('s-aes')).filter((x) => x.type === 'end_section').map((x) => x.value)).toEqual([{ by: 'coach', section: 'ur' }]);
    e.runner.next();
    expect(e.runner.view().task.id).toBe('en.c');
  });
  test('OFF (RDF auto, only sa_end_section): nothing, as today', async () => {
    const { e, w } = await run({ end_section: true }, 's-aes0');
    w.send({ type: 'sa:end_section', s: 's-aes0' });
    expect(e.runner.results()).toEqual([]);
  });
  test('ON without sa_end_section: nothing (round 20 widens that switch, never replaces it)', async () => {
    const { e, w } = await run({ r20_auto_end_section: true }, 's-aes1');
    w.send({ type: 'sa:end_section', s: 's-aes1' });
    expect(e.runner.results()).toEqual([]);
  });
});

// ---------- the served battery and the stored value ----------
describe('round 20: the served battery', () => {
  const b = { battery_id: 'x', lang: 'ur', tasks: [cells('ur.names')] };
  test('sa_r20_silence_stop N → ui.r20_silence_stop = N; OFF: nothing; the tasks untouched', () => {
    expect(applySwitches(b, { r20SilenceStop1: true }).ui).toEqual({ r20_silence_stop: 1 });
    expect(applySwitches(b, { r20SilenceStop2: true }).ui).toEqual({ r20_silence_stop: 2 });
    expect(applySwitches(b, { r20SilenceStop3: true }).ui).toEqual({ r20_silence_stop: 3 });
    expect(applySwitches(b, {}).ui).toBeUndefined();
    expect(applySwitches(b, { r20SilenceStop2: true }).tasks).toEqual(applySwitches(b, {}).tasks);
  });
  test('sa_r20_auto_end_section → ui.r20_auto_end_section = true', () => {
    expect(applySwitches(b, { r20AutoEndSection: true }).ui).toEqual({ r20_auto_end_section: true });
  });
  const reader = (value, match) => createBrotliFlag({ key: 'sa_r20_silence_stop', match,
    db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) }) });
  const read = async (value, match) => { const f = reader(value, match); f(); await f.ready(); return f(); };
  const all = async (v) => [await read(v, MATCH.r20SilenceStop1), await read(v, MATCH.r20SilenceStop2), await read(v, MATCH.r20SilenceStop3)];
  test('the stored value: 1, 2, 3 (or their strings) read as themselves', async () => {
    expect(await all(1)).toEqual([true, false, false]);
    expect(await all('2')).toEqual([false, true, false]);
    expect(await all(3)).toEqual([false, false, true]);
  });
  test('no row, 0, 4, true, "yes", 1.5: OFF', async () => {
    for (const v of [undefined, 0, '0', 4, true, false, 'yes', 1.5, null]) expect([v, await all(v)]).toEqual([v, [false, false, false]]);
  });
  test('the engine route reads both', async () => {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off,
      r20SilenceStop2: () => true, r20AutoEndSection: () => true }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G4.A.ur.json`);
      const ui = (await r.json()).ui;
      expect(ui).toMatchObject({ r20_silence_stop: 2, r20_auto_end_section: true });
    } finally { srv.close(); }
  });
});
