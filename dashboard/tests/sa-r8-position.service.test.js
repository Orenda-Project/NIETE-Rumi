'use strict';
/**
 * Round 8 items 17/19/20 and the time-up rule, RDF auto (no last-word step, the move-on rule on), two switches:
 *
 * battery.ui.r8_reading_position (sa_r8_reading_position): the story's questions follow how much the child read aloud,
 * as EGRA's discontinue rule. The recorder's ear (sa-rec.js onVoice: ten level reads a second, a voice = three loud
 * reads in a row) feeds runner.voice(); the runner counts the voiced seconds of the passage the way the research
 * prototype's ear emulation does (a run's first report is its three loud reads, 0.3 s; every further report 0.1 s).
 *   under 1.0 s voiced, Done or time up → the questions are skipped (skipped_no_voice) with one no_reading_skip event
 *   1.0 s or more → the questions are asked, Done or time up; a time-up no longer skips them (nor the rest of the subject)
 *   no evidence (the ear was not listening, or it was unavailable) → the questions are asked, never skipped
 * battery.ui.r8_timeup_continue (sa_r8_timeup_continue): a part's own clock running out ends that part only; the rest
 * of its subject goes on. A part the child did not finish for another reason (the early-stop rule, the silence stop,
 * "I'm done" before the last cell, a spoken question left unanswered) still skips the rest of the subject.
 * OFF (each): the runner exactly as before.
 */
const core = require('../sa/sa-core');

const PASSAGE = (id, n = 20) => ({ id, mode: 'record', subtask: 'oral_reading_fluency', time_limit_s: 60, passage: { text: 'x' },
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, target: `w${i + 1}`, line: 1 + Math.floor(i / 5) })) });
const QUESTIONS = (id, story) => ({ id, mode: 'oral', subtask: 'reading_comprehension', question_timeout_s: 10, depends_on: { task: story, upto_item: 'last_word_tap' },
  items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });
const CELLS = (id, n = 8) => ({ id, mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
  items: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, target: `w${i + 1}`, show: `w${i + 1}` })) });
const TAP = (id, n = 4, extra = {}) => ({ id, mode: 'tap', items: Array.from({ length: n }, (_, i) => ({ id: `${id.replace(/\W/g, '')}${i + 1}`, target: 'a', options: ['a', 'b'] })), ...extra });
const ORAL = (id) => ({ id, mode: 'oral', question_timeout_s: 10, items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });

// RDF auto as the engine starts it in prod: no last-word step, the move-on rule on.
const AUTO = { skip_last_word: true, incomplete: true };

function run(tasks, ui, o = {}) {
  let t = 0;
  const events = [];
  const battery = { battery_id: 'b', tasks, ...(ui ? { ui } : {}) };
  const r = core.createRunner({ battery, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e), ...AUTO, ...o });
  r.start();
  const enter = () => { if (r.view().phase === 'instruction') r.instructionDone(); if (r.view().phase === 'ready') r.begin(); };
  enter();
  const x = {
    r, events, enter,
    clock: (ms) => { t += ms; },
    tick: (ms) => { t += ms; return r.tick(); },
    // the recorder opened for the part on show (the engine logs it), and its ear listens for a voice
    recording: (watch = true) => { r.log('record_start', { task_id: r.view().task.id }); if (watch) r.voiceWatch(); },
    // one voice run of n reports, 100 ms apart (as sa-rec.js onVoice calls back), then a pause
    voiceRun: (n) => { for (let i = 0; i < n; i++) { t += 100; r.voice(); } t += 1000; },
    ids: () => r.results().map((res) => [res.task_id, res.stop_reason]),
    of: (type) => events.filter((e) => e.type === type),
  };
  return x;
}
const ON = { r8_reading_position: true };
const LANGS = ['ur', 'en'];
const next = (x) => { x.r.next(); return x.r.view().task && x.r.view().task.id; };

describe('r8_reading_position: the story questions follow the voice heard while the child read', () => {
  for (const L of LANGS) {
    const tasks = () => [PASSAGE(`${L}.story_w3`), QUESTIONS(`${L}.story_comp_w3`, `${L}.story_w3`), TAP(L === 'ur' ? 'en.letters' : 'ma.number')];
    test(`${L}: Done with 0.9 s voiced → skipped_no_voice, one no_reading_skip event, then the next subject`, () => {
      const x = run(tasks(), ON);
      x.recording();
      x.voiceRun(7); // 0.3 + 6 × 0.1 = 0.9 s
      x.clock(3000); x.r.done();
      expect(x.r.results()[0]).toMatchObject({ stop_reason: 'complete', voiced_s: 0.9, position_source: 'voice' });
      x.r.next(); // the questions: skipped at once, their own (silent) end screen
      expect(x.r.view().phase).toBe('task_end');
      expect(x.ids()).toEqual([[`${L}.story_w3`, 'complete'], [`${L}.story_comp_w3`, 'skipped_no_voice']]);
      expect(x.of('no_reading_skip')).toHaveLength(1);
      expect(x.of('no_reading_skip')[0]).toMatchObject({ task_id: `${L}.story_comp_w3`, value: { by: 'app', story: `${L}.story_w3`, voiced_s: 0.9, min_s: 1 } });
      // as every other skipped question set (skipped_no_first_line): nothing answered, nothing recorded
      expect(x.r.results()[1]).toMatchObject({ attempted: 0, recorded: false, asked: [] });
      expect(next(x)).toBe(L === 'ur' ? 'en.letters' : 'ma.number');
    });
    test(`${L}: Done with 1.0 s voiced → the questions are asked`, () => {
      const x = run(tasks(), ON);
      x.recording();
      x.voiceRun(8); // 0.3 + 7 × 0.1 = 1.0 s
      x.clock(3000); x.r.done();
      expect(x.r.results()[0]).toMatchObject({ voiced_s: 1, position_source: 'voice' });
      expect(next(x)).toBe(`${L}.story_comp_w3`);
      expect(x.r.view().phase).toBe('instruction');
      expect(x.of('no_reading_skip')).toHaveLength(0);
    });
    test(`${L}: time up after reading (25 s voiced) → no move-on; the questions are asked`, () => {
      const x = run(tasks(), ON);
      x.recording();
      for (let k = 0; k < 10; k++) x.voiceRun(23);
      x.tick(60000);
      expect(x.ids()).toEqual([[`${L}.story_w3`, 'time_up']]);
      expect(x.r.results()[0].voiced_s).toBeGreaterThanOrEqual(1);
      expect(x.of('incomplete_move_on')).toHaveLength(0);
      expect(next(x)).toBe(`${L}.story_comp_w3`);
      x.enter();
      x.r.answer('spoken'); x.r.answer('spoken');
      expect(x.ids()[1]).toEqual([`${L}.story_comp_w3`, 'complete']);
    });
    test(`${L}: time up with no voice heard → the questions skipped as skipped_no_voice, the next subject goes on`, () => {
      const x = run(tasks(), ON);
      x.recording();
      x.tick(61000);
      expect(x.of('incomplete_move_on')).toHaveLength(0);
      next(x);
      expect(x.ids()).toEqual([[`${L}.story_w3`, 'time_up'], [`${L}.story_comp_w3`, 'skipped_no_voice']]);
      expect(next(x)).toBe(L === 'ur' ? 'en.letters' : 'ma.number');
    });
  }
  test('no evidence: the ear was unavailable → the questions are asked (never skipped on missing evidence)', () => {
    const x = run([PASSAGE('ur.s'), QUESTIONS('ur.q', 'ur.s')], ON);
    x.recording();
    x.r.earUnavailable();
    x.clock(5000); x.r.done();
    expect(x.r.results()[0]).toMatchObject({ position_source: 'none', voiced_s: null });
    expect(next(x)).toBe('ur.q');
    expect(x.r.view().phase).toBe('instruction');
  });
  test('no evidence: the ear never listened for a voice (no voiceWatch) → the questions are asked', () => {
    const x = run([PASSAGE('en.s'), QUESTIONS('en.q', 'en.s')], ON);
    x.recording(false);
    x.clock(5000); x.r.done();
    expect(x.r.results()[0]).toMatchObject({ position_source: 'none', voiced_s: null });
    expect(next(x)).toBe('en.q');
  });
  test('no evidence: no recording opened → the questions are asked', () => {
    const x = run([PASSAGE('en.s'), QUESTIONS('en.q', 'en.s')], ON);
    x.r.voiceWatch();
    x.clock(5000); x.r.done();
    expect(x.r.results()[0].position_source).toBe('none');
    expect(next(x)).toBe('en.q');
  });
  test('the silence repeat\'s ear (sa_silence_repeat on) counts as listening', () => {
    const x = run([PASSAGE('ur.s'), QUESTIONS('ur.q', 'ur.s'), TAP('en.a')], ON, { silence_repeat: true });
    x.recording(false);
    x.voiceRun(3); // 0.3 + 0.1 + 0.1 = 0.5 s: heard, so no reminder
    x.clock(3000); x.r.done();
    expect(x.r.results()[0]).toMatchObject({ voiced_s: 0.5, position_source: 'voice' });
    next(x);
    expect(x.ids()[1]).toEqual(['ur.q', 'skipped_no_voice']);
  });
  test('a run counts once: reports 100 ms apart are one run, a gap starts a new one', () => {
    const x = run([PASSAGE('en.s'), QUESTIONS('en.q', 'en.s')], ON);
    x.recording();
    x.voiceRun(1); x.voiceRun(1); x.voiceRun(1); // three runs of one report → 0.9 s
    x.r.done();
    expect(x.r.results()[0].voiced_s).toBe(0.9);
  });
  test('the voice before the passage (the instructions, practice) is not counted', () => {
    const x = run([TAP('en.a', 1), PASSAGE('en.s'), QUESTIONS('en.q', 'en.s')], ON);
    x.r.voice(); x.r.voice();
    x.r.answer('a');
    next(x); x.enter();
    x.recording();
    x.voiceRun(2);
    x.r.done();
    expect(x.r.results()[1].voiced_s).toBe(0.4);
  });
  test('RDF manual (the coach marks the last word): the switch does nothing', () => {
    const x = run([PASSAGE('ur.s'), QUESTIONS('ur.q', 'ur.s')], ON, { manual: true, incomplete: false });
    x.recording();
    x.r.done();
    expect(x.r.view().phase).toBe('last_word');
    x.r.lastWord(7);
    expect(x.r.results()[0].voiced_s).toBeUndefined();
    expect(next(x)).toBe('ur.q');
  });
  test('OFF: today exactly — Done asks every question whatever was heard; time up skips them (skipped_incomplete)', () => {
    const done = run([PASSAGE('ur.s'), QUESTIONS('ur.q', 'ur.s'), TAP('en.a')], null);
    done.recording(); done.r.done();
    expect(done.r.results()[0]).not.toHaveProperty('voiced_s');
    expect(done.r.results()[0]).not.toHaveProperty('position_source');
    expect(next(done)).toBe('ur.q');
    const up = run([PASSAGE('en.s'), QUESTIONS('en.q', 'en.s'), TAP('ma.a')], null);
    up.recording();
    for (let k = 0; k < 5; k++) up.voiceRun(20);
    up.tick(60000);
    expect(up.ids()).toEqual([['en.s', 'time_up'], ['en.q', 'skipped_incomplete']]);
    expect(up.of('incomplete_move_on')).toHaveLength(1);
    expect(next(up)).toBe('ma.a');
  });
});

describe('the recorder\'s ear feeds the count (sa-rec.js onVoice, the level faked)', () => {
  test('1.5 s of a loud level after the room\'s first quiet second → about 1.5 s voiced; the questions are asked', () => {
    const rec = require('../sa/sa-rec');
    let t = 0;
    let level = 128; // 8-bit silence
    const ticks = [];
    const analyser = { fftSize: 32, getByteTimeDomainData: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = i % 2 ? 128 + level - 128 : 128 - (level - 128); } };
    function AC() { this.state = 'running'; this.createAnalyser = () => analyser; this.createMediaStreamSource = () => ({ connect: () => {} }); }
    const r = rec.create({ store: {}, session_id: 's', MediaRecorder: { isTypeSupported: () => true }, getUserMedia: () => Promise.resolve({}),
      AudioContext: AC, now: () => t, localStorage: null, taps: false, interval: { set: (f) => { ticks.push(f); return 1; }, clear: () => {} } });
    return r.ready().then(() => {
      const x = run([PASSAGE('en.s'), QUESTIONS('en.q', 'en.s')], ON, { now: () => t });
      x.r.log('record_start', { task_id: 'en.s' });
      r.onVoice(() => x.r.voice());
      x.r.voiceWatch();
      const step = () => { t += 100; ticks.forEach((f) => f()); };
      for (let i = 0; i < 12; i++) step(); // the room's floor: quiet
      level = 128 + 40; // loud: rms ≈ 0.31, over the 0.06 ceiling
      for (let i = 0; i < 15; i++) step();
      level = 128;
      for (let i = 0; i < 10; i++) step();
      x.r.done();
      expect(x.r.results()[0].voiced_s).toBe(1.5);
      expect(next(x)).toBe('en.q');
    });
  });
});

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('on the child\'s page (sa-ui on a DOM): what follows the story', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  // The story read (voiced: reports of the ear, or none), then its end, as the page shows it; → the next screen's task.
  async function after(lang, ui, voiced, end) {
    const c = require('../sa/sa-core');
    const sui = require('../sa/sa-ui');
    let t = 0;
    const other = lang === 'ur' ? 'en.letters' : 'ma.number';
    const battery = { battery_id: 'b', ...(ui ? { ui } : {}), tasks: [PASSAGE(`${lang}.story_w3`), QUESTIONS(`${lang}.story_comp_w3`, `${lang}.story_w3`), TAP(other)] };
    const runner = c.createRunner({ battery, now: () => t, onEvent: () => {}, mic: () => 'ok', skip_last_word: true, incomplete: true });
    runner.start(); runner.instructionDone(); runner.begin();
    const el = document.getElementById('m');
    const view = sui.mount(el, { runner, battery, lang, mode: 'proctored', speak: () => Promise.resolve() });
    views.push(view);
    view.render();
    runner.log('record_start', { task_id: `${lang}.story_w3` });
    runner.voiceWatch();
    for (let i = 0; i < voiced; i++) { t += 100; runner.voice(); }
    if (end === 'time_up') { t += 60000; runner.tick(); } else { t += 1000; runner.done(); }
    view.render();
    expect(el.getAttribute('data-phase')).toBe('task_end');
    // the end screen's own wait (1.5 s), then a skipped part's (0.4 s)
    await new Promise((r) => setTimeout(r, 2300));
    return runner.view().task && runner.view().task.id;
  }
  for (const L of LANGS) {
    test(`${L} ON: time up after reading → the story questions are on screen`, async () => {
      expect(await after(L, ON, 40, 'time_up')).toBe(`${L}.story_comp_w3`);
      expect(document.getElementById('m').getAttribute('data-task-mode')).toBe('oral');
    }, 10000);
    test(`${L} ON: Done with no voice → the questions are passed over, the next subject is on screen`, async () => {
      expect(await after(L, ON, 0, 'done')).toBe(L === 'ur' ? 'en.letters' : 'ma.number');
    }, 10000);
    test(`${L} OFF: time up → the questions are passed over (today)`, async () => {
      expect(await after(L, null, 40, 'time_up')).toBe(L === 'ur' ? 'en.letters' : 'ma.number');
    }, 10000);
  }
});
