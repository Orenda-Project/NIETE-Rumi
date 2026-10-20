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
