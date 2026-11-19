'use strict';
/**
 * A late "no voice" verdict never cuts a timed task short (dashboard/sa/sa-page.js voiceGate).
 *
 * The phone's preparation is not awaited by the start, so its verdict can land while the child is already inside a
 * timed task. When it is {voice:'none'}:
 *   - inside a timed task whose items need no clip (a grid shown cell by cell, the passage, a sum shown on screen),
 *     nothing is refused: voice_late_none { task, ms } is logged, the clock runs as with a voice, the task's result
 *     carries voice_deferred: true, and the refusal (voice_not_ready, the screen, Try again, the coach page told) comes
 *     at that task's end, before anything of the next task;
 *   - before any task, between tasks, in an untimed task, or in a task whose item prompt is a clip (the listen-and-tap
 *     grids, the picker, the spoken MCQ, the spoken questions, the listening story), it is refused at once, as before.
 * The engine, the runner and the phone's store are the real ones; the clock is the test's.
 */
const path = require('path');
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { start } = require('../sa/sa-engine');
const page = require('../sa/sa-page');

const DATA = path.join(__dirname, '../../bot/shared/data/child-test/sa');
const FULL = require(path.join(DATA, 'sa.coach.G3.A.ur.json'));

/** The served battery of a block, with sa_voice_gate_v2 on (the Try again refusal). */
function served(block) {
  const b = page.pick(FULL, block);
  return { ...b, ui: { voice_gate_v2: true } };
}

/** A deferred: the preparation's verdict, landed when the test says. */
function verdict() {
  let land;
  const p = new Promise((ok) => { land = ok; });
  return { p, land };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * One child's run: the real engine with a screen that records what it is asked to do. render() tells the engine the
 * state, as the real screens do on every frame.
 */
async function rig(block, o = {}) {
  const clock = { t: 0 };
  const s = o.store || await storeMod.open({ idb: null });
  const calls = { refuse: [], unrefuse: 0, posts: [] };
  let uiOpts = null;
  const view = {
    destroy() {},
    render() { if (uiOpts && uiOpts.onState) uiOpts.onState(uiOpts.runner.view()); },
    refuse(kind, x) {
      const r = uiOpts.runner;
      calls.refuse.push({ kind, retry: x && x.retry, at: clock.t, seq: r.snapshot().seq, results: JSON.parse(JSON.stringify(r.results())) });
    },
    unrefuse() { calls.unrefuse++; },
  };
  const battery = served(block);
  const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'ur', session_id: o.session_id || 'sess-late', audio_check: false, warmup: false }, {
    core,
    store: { open: () => Promise.resolve(s) },
    ui: { mount: (el, x) => { uiOpts = x; return view; } },
    voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
    now: () => clock.t,
    micState: () => 'ok',
  });
  const win = { location: { origin: 'https://p.test' } };
  win.parent = { postMessage: (m) => calls.posts.push(m.type) };
  const answers = o.again || [];
  const ctx = { win, embed: true, battery, again: () => Promise.resolve(answers.shift() || { voice: 'none' }) };
  return { e, s, r: e.runner, clock, calls, view, ctx, battery };
}

/** Through the instruction and practice to the task's Go. */
function toGo(r) {
  for (let i = 0; i < 20 && r.view().phase !== 'running'; i++) {
    const v = r.view();
    if (v.phase === 'instruction') r.instructionDone();
    else if (v.phase === 'practice') { if (!(r.practiceModelled && r.practiceModelled())) r.practiceAnswer(v.practice.target); }
    else if (v.phase === 'ready') r.begin();
    else if (v.phase === 'oral_practice') r.oralPracticeDone(true);
    else if (v.phase === 'keypad_warmup') r.keypadWarmupDone(3);
    else throw new Error(`stuck at ${v.phase}`);
  }
}

async function events(s, id = 'sess-late') { return (await s.events(id)).sort((a, b) => a.seq - b.seq); }

describe('a late "none" inside a timed task that needs no clip waits for the task\'s end', () => {
  test('none at 20 s into a 60 s timed grid: no refusal before task_end; time used 60000, time_up, as with a voice', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    expect(x.r.view().task.id).toBe('ur.letter_names5');
    expect(x.r.view().task.time_limit_s).toBe(60);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 20000;
    v.land({ voice: 'none', ready: true, clips_total: 150, clips_cached: 40 });
    await flush();
    x.view.render();
    expect(x.calls.refuse).toHaveLength(0);
    expect(x.calls.posts).toEqual([]);
    x.clock.t = 59999;
    x.r.tick();
    x.view.render();
    expect(x.calls.refuse).toHaveLength(0);
    x.clock.t = 60000;
    x.r.tick();
    expect(x.calls.refuse).toHaveLength(1);
    expect(x.calls.refuse[0].at).toBe(60000);
    const res = x.r.results()[0];
    expect(res).toMatchObject({ task_id: 'ur.letter_names5', time_used_ms: 60000, time_left_ms: 0, stop_reason: 'time_up', voice_deferred: true });

    // the same run with a voice: the same clock, the same stop
    const y = await rig('rdf_auto', { session_id: 'sess-voice' });
    y.r.start();
    toGo(y.r);
    page.voiceGate(y.e, Promise.resolve({ voice: 'clips' }), y.ctx);
    await flush();
    y.clock.t = 59999;
    y.r.tick();
    y.clock.t = 60000;
    y.r.tick();
    const { voice_deferred: vd, ...rest } = res;
    expect(vd).toBe(true);
    expect(y.r.results()[0]).toEqual(rest);
  });

  test('none at 60 s (the verdict arrives with the task\'s last moment): still no refusal before task_end', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 59999;
    v.land({ voice: 'none' });
    await flush();
    x.view.render();
    expect(x.calls.refuse).toHaveLength(0);
    x.clock.t = 60000;
    x.r.tick();
    expect(x.calls.refuse).toHaveLength(1);
    expect(x.r.results()[0]).toMatchObject({ time_used_ms: 60000, stop_reason: 'time_up', voice_deferred: true });
  });

  test('voice_late_none { task, ms } is logged on the task; voice_not_ready follows the task\'s end, nothing of the next task between', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 20000;
    v.land({ voice: 'none' });
    await flush();
    x.clock.t = 60000;
    x.r.tick();
    await x.e.flushed();
    const ev = await events(x.s);
    const late = ev.find((q) => q.type === 'voice_late_none');
    expect(late).toMatchObject({ task_id: 'ur.letter_names5', value: { task: 'ur.letter_names5', ms: 20000 } });
    const types = ev.map((q) => q.type);
    const iEnd = types.indexOf('task_end');
    expect(types.slice(types.indexOf('device_ready'), types.indexOf('device_ready') + 2)).toEqual(['device_ready', 'voice_late_none']);
    expect(types[iEnd + 1]).toBe('voice_not_ready');
    // the refusal came at the task's end: no event of the next task before it
    expect(x.calls.refuse[0].seq).toBe(ev[iEnd + 1].seq);
    expect(ev.filter((q) => q.task_id === 'ur.letter_sounds5')).toEqual([]);
    expect(x.r.view()).toMatchObject({ phase: 'task_end', task: { id: 'ur.letter_names5' } });
    expect(x.calls.posts).toEqual(['sa:refused']);
  });

  test('voice_deferred: true is on the result as the phone keeps it and sends it', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 20000;
    v.land({ voice: 'none' });
    await flush();
    x.clock.t = 60000;
    x.r.tick();
    await x.e.flushed();
    const kept = await x.s.results('sess-late');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ task_id: 'ur.letter_names5', voice_deferred: true, stop_reason: 'time_up', time_used_ms: 60000 });
    const pend = await x.s.pending('sess-late');
    expect(pend.results[0].voice_deferred).toBe(true);
    const end = (await events(x.s)).find((q) => q.type === 'task_end');
    expect(end.value.voice_deferred).toBe(true);
  });

  test('Try again finds a voice: unrefused, the finished task\'s result unchanged, the next task runs; a reload keeps it too', async () => {
    const x = await rig('rdf_auto', { again: [{ voice: 'clips', clips_cached: 150 }] });
    x.r.start();
    toGo(x.r);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 20000;
    v.land({ voice: 'none' });
    await flush();
    x.clock.t = 60000;
    x.r.tick();
    const before = x.calls.refuse[0].results;
    expect(before).toHaveLength(1);
    expect(await x.calls.refuse[0].retry()).toBe(true);
    expect(x.calls.unrefuse).toBe(1);
    expect(x.calls.posts).toEqual(['sa:refused', 'sa:unrefused']);
    expect(JSON.parse(JSON.stringify(x.r.results()))).toEqual(before);
    x.r.next();
    expect(x.r.view().task.id).toBe('ur.letter_sounds5');
    await x.e.flushed();
    x.e.destroy();
    // the tab is reloaded: the session resumes after the finished task, its result as it was
    const y = await rig('rdf_auto', { store: x.s });
    expect(y.e.resumed).toBe(true);
    y.r.start();
    expect(y.r.view().task.id).toBe('ur.letter_sounds5');
    expect(JSON.parse(JSON.stringify(y.r.results()))).toEqual(before);
  });

  test('the task left without its end (the page hidden: a timed task runs again from its start): refused then, before it runs again', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    x.clock.t = 20000;
    v.land({ voice: 'none' });
    await flush();
    x.view.render();
    expect(x.calls.refuse).toHaveLength(0);
    x.r.visibilityLost();
    x.view.render();
    expect(x.calls.refuse).toHaveLength(1);
    expect(x.r.view().phase).toBe('instruction');
  });
});

describe('everywhere else a "none" is refused at once, as before', () => {
  async function landsNow(x) {
    const v = verdict();
    page.voiceGate(x.e, v.p, x.ctx);
    v.land({ voice: 'none' });
    await flush();
    await x.e.flushed();
    const types = (await events(x.s)).map((q) => q.type);
    expect(x.calls.refuse).toHaveLength(1);
    expect(types).not.toContain('voice_late_none');
    expect(types.slice(-2)).toEqual(['device_ready', 'voice_not_ready']);
  }

  test('before any task has started', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    expect(x.r.view().phase).toBe('instruction');
    await landsNow(x);
  });

  test('between tasks (the timed task has ended)', async () => {
    const x = await rig('rdf_auto');
    x.r.start();
    toGo(x.r);
    x.clock.t = 60000;
    x.r.tick();
    expect(x.r.view().phase).toBe('task_end');
    await landsNow(x);
  });

  test('during an untimed listen task (the listening story)', async () => {
    const x = await rig('B3');
    x.r.start();
    toGo(x.r);
    expect(x.r.view().task).toMatchObject({ id: 'ur.listening', time_limit_s: null, mode: 'oral' });
    await landsNow(x);
  });

  test('during a timed task whose item prompt is a clip (the listen-and-tap letter grid)', async () => {
    const x = await rig('B1');
    x.r.start();
    toGo(x.r);
    expect(x.r.view().task).toMatchObject({ id: 'ur.letters', time_limit_s: 60, mode: 'tap' });
    await landsNow(x);
    expect(x.r.results()).toEqual([]);
  });
});

describe('the deferral never applies to a task whose item prompt is a clip', () => {
  const fs = require('fs');
  const files = fs.readdirSync(DATA).filter((f) => /^sa\..*\.json$/.test(f));
  const tasks = [];
  files.forEach((f) => core.normalize(JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'))).tasks.forEach((t) => tasks.push(t)));

  test('every served task: the picker, the spoken MCQ, spoken questions, listening, untimed and spoken-item tasks never defer', () => {
    expect(tasks.length).toBeGreaterThan(100);
    for (const t of tasks) {
      const ok = page.deferrable(t);
      if (t.kind === 'pick' || t.kind === 'mcq' || t.mode === 'oral' || /listen/.test(String(t.subtask || '')) || !t.time_limit_s) {
        expect([t.id, ok]).toEqual([t.id, false]);
      }
      const spoken = t.say_on !== 'replay' && (t.items || []).some((it) => it && (it.say || it.prompt || it.prompt_audio));
      if (spoken) expect([t.id, ok]).toEqual([t.id, false]);
    }
  });

  test('the grids shown cell by cell, the passage and the shown sums read on replay only do defer; the listen-and-tap grids do not', () => {
    const byId = {};
    tasks.forEach((t) => { byId[t.id] = t; });
    ['ur.letter_names5', 'ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story', 'en.letter_names5', 'ma.number_id8', 'ma.fluency1m']
      .forEach((id) => expect([id, page.deferrable(byId[id])]).toEqual([id, true]));
    ['ur.letters', 'ur.words', 'ur.nonwords', 'en.letter_sounds', 'ma.number_id', 'ma.add1', 'ur.letter_pick10', 'ur.story_mcq_w3', 'ur.listening', 'ur.story_comp_w3']
      .forEach((id) => expect([id, page.deferrable(byId[id])]).toEqual([id, false]));
    // a timed task that is ever given a clip prompt stops deferring
    expect(page.deferrable({ ...byId['ur.letter_names5'], kind: 'pick' })).toBe(false);
    expect(page.deferrable({ ...byId['ur.letter_names5'], items: [{ id: 'x', prompt_audio: 'sa/v1/ur/x.mp3' }] })).toBe(false);
  });
});

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
(JSDOM ? describe : describe.skip)('on the real screens: the refusal is a clean break between tasks', () => {
  let dom;
  const keep = {};
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) { keep[k] = global[k]; global[k] = k === 'window' ? dom.window : dom.window[k]; }
    jest.resetModules();
  });
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  test('the task-end screen does not move on to the next task behind the refusal; after Try again it does', async () => {
    const ui = require('../sa/sa-ui');
    const clock = { t: 0 };
    const s = await storeMod.open({ idb: null });
    const battery = served('rdf_auto');
    const el = document.getElementById('m');
    const e = await start({ mount: el, battery, mode: 'proctored', lang: 'ur', session_id: 'sess-dom', audio_check: false, warmup: false }, {
      core, store: { open: () => Promise.resolve(s) }, ui,
      voice: { create: () => ({ speak: () => Promise.resolve(), stop() {}, setMuted() {} }) },
      now: () => clock.t, micState: () => 'ok', win: dom.window, doc: document,
    });
    const r = e.runner;
    r.start();
    toGo(r);
    e.view.render();
    const answers = [{ voice: 'clips' }];
    const ctx = { win: dom.window, embed: false, battery, again: () => Promise.resolve(answers.shift()) };
    const v = verdict();
    page.voiceGate(e, v.p, ctx);
    clock.t = 20000;
    v.land({ voice: 'none' });
    await wait(10);
    e.view.render();
    expect(el.getAttribute('data-phase')).not.toBe('refused');
    clock.t = 60000;
    r.tick();
    e.view.render();
    expect(el.getAttribute('data-phase')).toBe('refused');
    await wait(2200); // longer than the task-end screen's own wait before the next task
    expect(r.view()).toMatchObject({ phase: 'task_end', task: { id: 'ur.letter_names5' } });
    const types = (await s.events('sess-dom')).map((q) => q.type);
    expect(types.filter((t) => t === 'task_intro')).toHaveLength(1);
    const retry = [...el.querySelectorAll('button')].find((b) => /sa-retry/.test(b.className));
    expect(retry).toBeTruthy();
    retry.click();
    await wait(2200);
    expect(el.getAttribute('data-phase')).not.toBe('refused');
    expect(r.view().task.id).toBe('ur.letter_sounds5');
    expect(r.results()[0]).toMatchObject({ task_id: 'ur.letter_names5', time_used_ms: 60000, stop_reason: 'time_up', voice_deferred: true });
    e.destroy();
  }, 15000);
});
