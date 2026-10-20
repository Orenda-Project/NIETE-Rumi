'use strict';
/**
 * The engine's door (dashboard/sa/sa-engine.js): every event lands in the phone's store in order with the reload
 * snapshot and the task results; a reload with the same session id resumes where the tab died; the surface's hooks
 * fire; mute exists in game mode only. The screens and the voice are fakes (the DOM is not under test here).
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');

const battery = {
  battery_id: 'b1',
  tasks: [
    { id: 't1', mode: 'tap', time_limit_s: 60, items: [{ id: 'i1', target: 'a', options: ['a', 'b'] }, { id: 'i2', target: 'a', options: ['a', 'b'] }] },
    { id: 't2', mode: 'tap', items: [{ id: 'j1', target: 'a', options: ['a', 'b'] }] },
  ],
};

function fakes(shared) {
  const muted = [];
  let uiOpts = null;
  let voiceOpts = null;
  return {
    muted,
    voice: () => voiceOpts,
    ui: () => uiOpts,
    deps: {
      core,
      store: { open: () => Promise.resolve(shared) },
      ui: { mount: (el, o) => { uiOpts = o; return { destroy() {} }; } },
      voice: { create: (o) => { voiceOpts = o; return { speak: () => Promise.resolve(), stop() {}, setMuted: (b) => muted.push(b) }; } },
      now: (() => { let t = 0; return () => (t += 100); })(),
    },
  };
}

async function shared() { return storeMod.open({ idb: null }); }

test('events and results are on the phone in order, with the reload snapshot', async () => {
  const s = await shared();
  const f = fakes(s);
  const seen = { correct: 0, task_end: 0, battery_end: 0 };
  const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'ur', session_id: 'sess-1' }, f.deps);
  ['correct', 'task_end', 'battery_end'].forEach((k) => e.on(k, () => { seen[k]++; }));
  const r = e.runner;
  r.start(); r.audioCheck(true); r.warmupDone(10, 5000); r.instructionDone(); r.begin(); r.answer('a'); r.answer('a'); r.next();
  r.instructionDone(); r.begin(); r.answer('b'); r.next();
  await e.flushed();
  const ev = await s.events('sess-1');
  expect(ev.map((x) => x.seq)).toEqual(ev.map((_, i) => i + 1));
  expect(ev.map((x) => x.type)).toContain('battery_end');
  expect((await s.results('sess-1')).map((x) => [x.task_id, x.correct]).sort()).toEqual([['t1', 2], ['t2', 0]]);
  expect(await s.getSession('sess-1')).toMatchObject({ battery_id: 'b1', mode: 'proctored', ended: true });
  expect(seen).toEqual({ correct: 2, task_end: 2, battery_end: 1 });
});

test('a reload with the same session id resumes at the task the tab died in', async () => {
  const s = await shared();
  const a = await start({ mount: {}, battery, mode: 'game', lang: 'en', session_id: 'sess-2' }, fakes(s).deps);
  const r = a.runner;
  r.start(); r.audioCheck(true); r.warmupDone(10, 5000); r.instructionDone(); r.begin(); r.answer('a'); r.answer('a'); r.next(); r.instructionDone();
  await a.flushed();
  a.destroy();
  const b = await start({ mount: {}, battery, mode: 'game', lang: 'en', session_id: 'sess-2' }, fakes(s).deps);
  expect(b.resumed).toBe(true);
  b.runner.start();
  expect(b.runner.view()).toMatchObject({ phase: 'instruction', task: { id: 't2' } });
  await b.flushed();
  const types = (await s.events('sess-2')).map((x) => x.type);
  expect(types).toContain('reload_resume');
  expect(new Set((await s.events('sess-2')).map((x) => x.seq)).size).toBe(types.length);
});

test('a different battery under the same id starts fresh; an ended session is not resumed', async () => {
  const s = await shared();
  await s.putSession({ session_id: 'sess-3', battery_id: 'other', snapshot: { task_index: 1, results: [], seq: 5 } });
  const e = await start({ mount: {}, battery, mode: 'game', lang: 'en', session_id: 'sess-3' }, fakes(s).deps);
  expect(e.resumed).toBe(false);
});

test('mute only in game mode; the audio hook carries Jugnu speaking', async () => {
  const s = await shared();
  const g = fakes(s);
  const eg = await start({ mount: {}, battery, mode: 'game', lang: 'en' }, g.deps);
  eg.mute(true);
  expect(g.muted).toEqual([true]);
  expect(typeof g.ui().onMute).toBe('function');
  const p = fakes(s);
  const ep = await start({ mount: {}, battery, mode: 'proctored', lang: 'ur' }, p.deps);
  ep.mute(true);
  expect(p.muted).toEqual([]);
  expect(p.ui().onMute).toBeNull();
  const heard = [];
  eg.on('audio', (x) => heard.push(x));
  g.voice().onSpeak({ speaking: true, text: 'hi' });
  expect(heard).toEqual([{ speaking: true, text: 'hi' }]);
});

test('a malformed battery is refused before anything is drawn', async () => {
  const s = await shared();
  const f = fakes(s);
  expect(() => start({ mount: {}, battery: { tasks: [] }, mode: 'game' }, f.deps)).toThrow('no tasks');
  expect(f.ui()).toBeNull();
});

test('a battery with a passage asks for the microphone once and records it as one file, kept on the phone', async () => {
  const s = await shared();
  const f = fakes(s);
  const started = [];
  let readies = 0;
  f.deps.rec = { create: () => ({
    ready: async () => { readies++; return true; },
    start: (id) => { started.push(id); return true; },
    stop: async () => ({ parts: 2, duration_ms: 5000 }),
    release() {},
  }) };
  const b = { battery_id: 'b2', tasks: [{ id: 'story', mode: 'record', passage: { text: 'a b' }, items: [{ id: 'w1', label: 'a', line: 1 }], time_limit_s: 60 },
    { id: 'comp', mode: 'oral', items: [{ id: 'q1', needs_line: 1 }] }] };
  const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', session_id: 'sess-rec' }, f.deps);
  await e.micReady;
  f.ui().onRecordStart(e.runner.view().task || b.tasks[0]);
  f.ui().onRecordStart(b.tasks[1], b.tasks[1].items[0]);
  await new Promise((r) => setTimeout(r, 0));
  expect(readies).toBe(1);
  expect(started).toEqual(['story', 'comp/q1']);
  await f.ui().onRecordStop(b.tasks[1], b.tasks[1].items[0]);
  await new Promise((r) => setTimeout(r, 0));
  await e.flushed();
  const types = (await s.events('sess-rec')).map((x) => x.type);
  expect(types).toEqual(expect.arrayContaining(['record_start', 'record_stop']));
});

test('the hand-back: embedded → tells the coach page (sa:done); not embedded → goes to back', () => {
  const { done } = require('../sa/sa-engine');
  const posted = [];
  const runner = { results: () => [{ task_id: 'a', stop_reason: 'complete' }, { task_id: 'b', stop_reason: 'coach_end' }] };
  const win = { location: { origin: 'https://portal.test', assign: (u) => posted.push(['go', u]) } };
  win.parent = { postMessage: (m, o) => posted.push(['msg', m, o]) };
  expect(done(win, { embed: true, back: '/x' }, 's1', runner)).toBe('posted');
  expect(posted[0]).toEqual(['msg', { type: 'sa:done', s: 's1', reason: 'coach_end' }, 'https://portal.test']);
  const top = { location: win.location }; top.parent = top;
  expect(done(top, { embed: true, back: '/list' }, 's1', { results: () => [] })).toBe('navigated');
  expect(posted[1]).toEqual(['go', '/list']);
});

test('the microphone: proctored without the pre-flight skips recording tasks; a game mic check is kept for the phone', async () => {
  const s = await shared();
  const kept = [];
  const micStore = { v: 'unknown' };
  const mic = { state: () => micStore.v, remember: (ok, rms) => kept.push([ok, rms]), probe: async () => ({ ok: true, rms: 0.02 }), level: () => () => {} };
  const b = { battery_id: 'm', tasks: [{ id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a' }, items: [{ id: 'w', target: 'a', line: 1 }] }] };
  const p = fakes(s); p.deps.mic = mic;
  const ep = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', audio_check: false, warmup: false }, p.deps);
  ep.runner.start();
  expect(ep.runner.results()[0]).toMatchObject({ stop_reason: 'mic_unavailable' });
  const g = fakes(s); g.deps.mic = mic;
  const eg = await start({ mount: {}, battery: b, mode: 'game', lang: 'ur', audio_check: false, warmup: false }, g.deps);
  eg.runner.start();
  expect(eg.runner.view().phase).toBe('mic_check');
  expect(typeof g.ui().micProbe).toBe('function');
  eg.runner.micChecked(true, 0.02);
  await eg.flushed();
  expect(kept).toEqual([[true, 0.02]]);
});

test('the mercy rule: the recorder\'s silence watch offers the star at 12 s and ends the passage at 20 s', async () => {
  const s = await shared();
  const f = fakes(s);
  let watch = null;
  let cancelled = 0;
  f.deps.rec = { create: () => ({
    ready: async () => true, start: () => true, stop: async () => ({ parts: 1, duration_ms: 20000 }), release() {},
    onSilence: (o, cb) => { watch = { o, cb }; return () => { cancelled++; }; },
  }) };
  f.deps.micState = () => 'ok';
  const b = { battery_id: 'mr', tasks: [{ id: 'story', mode: 'record', time_limit_s: 60, mercy_after_s: 11, silence_stop_s: 19, passage: { text: 'a' }, items: [{ id: 'w', target: 'a', line: 1 }] }] };
  const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', audio_check: false, warmup: false }, f.deps);
  e.runner.start(); e.runner.instructionDone(); e.runner.begin();
  f.ui().onRecordStart(b.tasks[0] && e.runner.view().task);
  await new Promise((r) => setTimeout(r, 0));
  expect(watch.o).toEqual({ after_s: 11, total_s: 19 });
  watch.cb({ kind: 'mercy', silence_s: 12 });
  watch.cb({ kind: 'early_stop_silence', silence_s: 20 });
  expect(e.runner.results()[0]).toMatchObject({ stop_reason: 'early_stop_silence', mercy_offered: true, silence_s: 20 });
  expect(cancelled).toBe(1);
});

test('embedded: the coach page\'s hold (sa:coach_end) ends the running task as coach_end, flushes, then sa:done once', async () => {
  const s = await shared();
  const f = fakes(s);
  const listeners = {};
  const posted = [];
  const order = [];
  const win = { location: { origin: 'https://p.test' }, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  win.parent = { postMessage: (m, o) => { posted.push([m, o]); order.push('posted'); } };
  f.deps.win = win;
  f.deps.sync = { create: () => ({ flush: async () => { order.push('flushed'); return { state: 'synced' }; }, poke() {}, status: () => ({}), stop() {} }) };
  const b = { battery_id: 'ce', tasks: [{ id: 'letters', mode: 'tap', time_limit_s: 60, items: [{ id: 'i1', target: 'a', options: ['a', 'b'] }, { id: 'i2', target: 'a', options: ['a', 'b'] }] },
    { id: 'words', mode: 'tap', items: [{ id: 'w1', target: 'a', options: ['a', 'b'] }] }] };
  const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'en', embed: true, session_id: 'sess-ce', sink: {}, audio_check: false, warmup: false }, f.deps);
  e.runner.start(); e.runner.instructionDone(); e.runner.begin(); e.runner.answer('a');
  listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 'someone-else' } });
  listeners.message({ origin: 'https://evil.test', data: { type: 'sa:coach_end', s: 'sess-ce' } });
  await new Promise((r) => setTimeout(r, 0));
  expect(posted).toEqual([]);
  listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 'sess-ce' } });
  await new Promise((r) => setTimeout(r, 10));
  expect(e.runner.results()[0]).toMatchObject({ task_id: 'letters', stop_reason: 'coach_end', attempted: 1 });
  expect(posted).toEqual([[{ type: 'sa:done', s: 'sess-ce', reason: 'coach_end' }, 'https://p.test']]);
  expect(order).toEqual(['flushed', 'posted']);
  listeners.message({ origin: 'https://p.test', data: { type: 'sa:coach_end', s: 'sess-ce' } });
  await new Promise((r) => setTimeout(r, 10));
  expect(posted).toHaveLength(1);
  const types = (await s.events('sess-ce')).map((x) => x.type);
  expect(types).toEqual(expect.arrayContaining(['coach_unlock', 'coach_end_run', 'handover_out']));
});
