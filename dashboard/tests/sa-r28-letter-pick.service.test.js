'use strict';
/**
 * Round 28 (switch sa_r28_letter_pick, engine flag battery.ui.r28_letter_pick): the letter-sound picker. Jugnu plays a
 * sound clip, five letter cards, the child taps one; scored on the phone. A task of kind 'pick' (response tap,
 * untimed, replay at 10 s, Next at 15 s). P1 is modelled (no tap), P2 is the engine's retry-once-then-show practice.
 * A clip that cannot play is never spoken by the browser voice: its item is unavailable (out of every count) and the
 * task goes on; a lost replay leaves the item open; under 6 items presented the task is unrated.
 * Fixtures are synthetic.
 */
const path = require('path');
const core = require('../sa/sa-core');

const { createRunner, validate } = core;

const UR = { pool: ['ب', 'پ', 'ت', 'ٹ', 'ث', 'ن', 'م', 'ک', 'س', 'ر', 'ج', 'د'], targets: ['ب', 'م', 'ک', 'س', 'ر', 'ج', 'د', 'ت', 'پ', 'ن'] };
const EN = { pool: ['b', 'd', 'p', 'q', 'm', 'n', 'w', 'u', 's', 'r', 'l', 'h'], targets: ['m', 's', 'b', 'r', 'l', 'h', 'd', 'p', 'n', 'w'] };

/** Five options with the target at position (i % 5), the rest from the pool in order. */
function optionsFor(set, target, i) {
  const rest = set.pool.filter((x) => x !== target).slice(i % 3, (i % 3) + 4);
  rest.splice(i % 5, 0, target);
  return rest;
}

function pickTask(lang, o) {
  o = o || {};
  const set = lang === 'ur' ? UR : EN;
  const id = `${lang}.letter_pick10`;
  const items = set.targets.map((target, i) => ({
    id: `${id}.${String(i + 1).padStart(2, '0')}`,
    options: optionsFor(set, target, i),
    target,
    prompt_audio: `sa/v5/${lang}/ls_${i + 1}.mp3`,
    prompt_text: lang === 'ur' ? `${target}َ` : `/${target}a/`,
    src: 'fixture',
  }));
  const practice = o.practice === false ? [] : [
    { id: `${id}.p1`, role: 'example', options: optionsFor(set, set.pool[11], 1), target: set.pool[11], prompt_audio: `sa/v5/${lang}/ls_p1.mp3`,
      prompt_text: 'p1', model: [{ text: 'model line', audio: `sa/v5/${lang}/lp_model.mp3`, lang }] },
    { id: `${id}.p2`, role: 'practice', options: optionsFor(set, set.pool[10], 2), target: set.pool[10], prompt_audio: `sa/v5/${lang}/ls_p2.mp3`,
      prompt_text: 'p2' },
  ];
  return {
    id, w3: true, r28: 'letter_pick', replaces: `${lang}.letter_sounds5`, kind: 'pick', response: 'tap',
    subtask: 'letter_sound_identification', lang, title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null,
    stop: {}, replay_at_s: 10, next_at_s: 15,
    instruction: { text: 'instruction', audio: `sa/v5/${lang}/lp_intro.mp3` }, script: {}, coach_text: { text: 'coach', src: 'fixture' },
    items, practice,
  };
}
const AFTER = { id: 'ma.after', mode: 'tap', items: [{ id: 'a1', target: '1', options: ['1', '2'] }] };
function battery(o) {
  o = o || {};
  return { battery_id: 'r28a', ui: Object.assign(o.flag === false ? {} : { r28_letter_pick: true }, o.ui || {}), tasks: [pickTask(o.lang || 'ur', o), JSON.parse(JSON.stringify(AFTER))] };
}

function runner(o) {
  o = o || {};
  const events = [];
  let clock = 0;
  const r = createRunner({ battery: battery(o), now: () => clock, onEvent: (e) => events.push(e), manual: !!o.manual });
  return { r, events, at: (ms) => { clock = ms; } };
}
function toItems(r) { r.start(); r.instructionDone(); }

describe('core: a pick task runs as an untimed tap task', () => {
  test('validates with 5 options; untimed; replay 10 s; scored by target; skip is wrong; options_n 5', () => {
    expect(validate(battery())).toBe(true);
    const { r, events } = runner({ practice: false });
    toItems(r);
    expect(r.view().phase).toBe('ready');
    r.begin();
    const v = r.view();
    expect(v.task.kind).toBe('pick');
    expect(v.task.mode).toBe('tap');
    expect(v.task.time_limit_s).toBeNull();
    expect(v.task.replay_at_s).toBe(10);
    expect(v.task.next_at_s).toBe(15);
    const items = v.task.items;
    expect(r.answer(items[0].target)).toBe(true);
    expect(r.answer(items[1].options.find((x) => x !== items[1].target))).toBe(false);
    expect(r.skip()).toBe(false);
    const kinds = events.filter((e) => /^item_/.test(e.type)).map((e) => e.type);
    expect(kinds).toEqual(['item_correct', 'item_incorrect', 'item_incorrect']);
    for (let i = 3; i < 10; i++) r.answer(items[i].target);
    const res = r.results()[0];
    expect(res).toMatchObject({ task_id: 'ur.letter_pick10', stop_reason: 'complete', attempted: 10, correct: 8, options_n: 5, scored_on: 'phone', per_minute: null });
    expect(res.answers[2]).toEqual({ item_id: items[2].id, value: 'skipped', ok: false });
  });

  test('answer(value, meta) keeps replays and tap_ms on the answer; answer(value) keeps today\'s shape', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    r.answer(items[0].target, { replays: 2, tap_ms: 850 });
    r.answer(items[1].target);
    r.answer(items[2].target, { replays: 0, tap_ms: 0 });
    const a = r.snapshot().current.answers;
    expect(a[0]).toEqual({ item_id: items[0].id, value: items[0].target, ok: true, replays: 2, tap_ms: 850 });
    expect(Object.keys(a[1]).sort()).toEqual(['item_id', 'ok', 'value']);
    expect(a[2]).toMatchObject({ replays: 0, tap_ms: 0 });
  });

  test('answer meta keeps tap_before_sound and tap_ms_src (timed against the prompt\'s speech)', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    r.answer(items[0].target, { replays: 0, tap_ms: -900, tap_before_sound: true, tap_ms_src: 'timings' });
    expect(r.snapshot().current.answers[0]).toEqual({ item_id: items[0].id, value: items[0].target, ok: true, replays: 0, tap_ms: -900, tap_before_sound: true, tap_ms_src: 'timings' });
  });

  test('tick() says replay once at 10 s; RDF auto offers Next at 30 s (ruling: 15 s coach-led, 30 s auto)', () => {
    const { r, at, events } = runner({ practice: false });
    toItems(r); r.begin();
    at(9999); expect(r.tick()).toBeNull();
    at(10000); expect(r.tick()).toBe('replay');
    at(12000); expect(r.tick()).toBeNull();
    expect(events.filter((e) => e.type === 'replay')).toEqual([expect.objectContaining({ value: 'auto', item_id: 'ur.letter_pick10.01' })]);
    at(29999); expect(r.view().offer_next).toBe(false);
    at(30000); expect(r.view().offer_next).toBe(true);
    at(60000); expect(r.tick()).toBeNull();
    expect(r.view().phase).toBe('running'); // no time-out on an item (A-11)
  });

  test('practiceModelled(): the example is modelled (one practice_model event, no score); P2 is retry-once-then-show', () => {
    const { r, events } = runner();
    r.start();
    expect(r.practiceModelled()).toBe(false); // not in practice
    r.instructionDone();
    const t = r.view().task;
    expect(r.view().practice.id).toBe(t.practice[0].id);
    expect(r.practiceModelled()).toBe(true);
    expect(events.filter((e) => e.type === 'practice_model')).toEqual([expect.objectContaining({ task_id: t.id, item_id: t.practice[0].id })]);
    expect(events.filter((e) => e.type === 'practice_answer')).toHaveLength(0);
    expect(r.view().practice.id).toBe(t.practice[1].id);
    expect(r.practiceModelled()).toBe(false); // P2 is the child's try
    const p2 = t.practice[1];
    const wrong = p2.options.find((x) => x !== p2.target);
    expect(r.practiceAnswer(wrong)).toMatchObject({ ok: false, retry: true, shown: null });
    expect(r.practiceAnswer(wrong)).toMatchObject({ ok: false, retry: false, shown: p2.target });
    expect(r.view().phase).toBe('ready');
  });

  test('practiceModelled() on the last practice item moves to ready', () => {
    const b = battery();
    b.tasks[0].practice = [b.tasks[0].practice[0]];
    const r = createRunner({ battery: b, now: () => 0 });
    r.start(); r.instructionDone();
    expect(r.practiceModelled()).toBe(true);
    expect(r.view().phase).toBe('ready');
  });

  test('clipLost(item, \'prompt\') on item 8: seven answers kept, item 8 unavailable, the task goes on; presented 9 of 10', () => {
    const { r, events } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    for (let i = 0; i < 7; i++) r.answer(items[i].target);
    expect(r.clipLost(items[7].id, 'prompt')).toBe(true);
    expect(r.view().phase).toBe('running');
    expect(r.view().item.id).toBe(items[8].id);
    expect(r.snapshot().current.answers).toHaveLength(8);
    expect(r.snapshot().current.answers[7]).toEqual({ item_id: items[7].id, value: null, unavailable: 'clip' });
    expect(events.find((e) => e.type === 'item_unavailable')).toMatchObject({ task_id: 'ur.letter_pick10', item_id: items[7].id, value: { why: 'clip' } });
    expect(events.filter((e) => e.type === 'image_unavailable')).toHaveLength(0);
    r.answer(items[8].target); r.answer(items[9].target);
    const res = r.results()[0];
    expect(res).toMatchObject({ stop_reason: 'complete', attempted: 9, correct: 9, presented: 9, unavailable: 1, of_all: 10, scored_on: 'phone' });
    expect(res).not.toHaveProperty('unrated');
  });

  test('five items unavailable: the task runs to its end and is unrated', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    items.forEach((it, i) => { if (i % 2) r.clipLost(it.id, 'prompt'); else r.answer(it.target); });
    expect(r.results()[0]).toMatchObject({ stop_reason: 'complete', attempted: 5, presented: 5, unavailable: 5, of_all: 10, unrated: true, scored_on: 'phone' });
  });

  test('clipLost(item, \'replay\'): logged lost, the item stays open, no auto replay for it', () => {
    const { r, at, events } = runner({ practice: false });
    toItems(r); r.begin();
    const it = r.view().item;
    at(4000);
    expect(r.clipLost(it.id, 'replay')).toBe(true);
    expect(events.filter((e) => e.type === 'replay')).toEqual([expect.objectContaining({ item_id: it.id, value: 'lost' })]);
    at(11000); expect(r.tick()).toBeNull();
    expect(r.view().item.id).toBe(it.id);
    expect(r.answer(it.target)).toBe(true);
  });

  test('clipLost for an item not on show, or on a task that is not a picker, does nothing', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    expect(r.clipLost('ur.letter_pick10.05', 'prompt')).toBe(false);
    expect(r.snapshot().current.answers).toHaveLength(0);
    const b = { battery_id: 'x', tasks: [JSON.parse(JSON.stringify(AFTER))] };
    const r2 = createRunner({ battery: b, now: () => 0 });
    r2.start(); r2.instructionDone(); r2.begin();
    expect(r2.clipLost('a1', 'prompt')).toBe(false);
  });

  test('a picker reloaded after an unavailable item counts only what was answered', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    r.answer(items[0].target);
    r.clipLost(items[1].id, 'prompt');
    const snap = r.snapshot();
    const r2 = createRunner({ battery: battery({ practice: false }), now: () => 0, resume: snap });
    r2.start(); r2.instructionDone(); r2.begin();
    for (let i = 2; i < 10; i++) r2.answer(items[i].target);
    expect(r2.results()[0]).toMatchObject({ attempted: 9, correct: 9, presented: 9, unavailable: 1 });
  });
});

// ---------- sa-voice: clip_only ----------
const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');
function fakeAudio(behaviour, log) {
  return class FakeAudio {
    constructor(src) { this.src = src; log.push(['audio', src]); }
    play() {
      setTimeout(() => {
        if (behaviour === 'error' && this.onerror) this.onerror(new Error('404'));
        if (behaviour === 'ok') { if (this.onplaying) this.onplaying(); setTimeout(() => { if (this.onended) this.onended(); }, 5); }
      }, 5);
      return Promise.resolve();
    }
    pause() {}
  };
}
function fakeSpeech(log) {
  class Utter { constructor(text) { this.text = text; } }
  const synth = { getVoices: () => [{ lang: 'ur-PK' }, { lang: 'en-US' }], cancel() {}, speak(u) { log.push(['tts', u.text]); setTimeout(() => u.onend && u.onend(), 5); } };
  return { Utter, synth };
}
function voiceWith(behaviour, log) {
  const sp = fakeSpeech(log);
  jest.resetModules();
  return require(VOICE).create({ lang: 'ur', base: '/', retry_ms: 5, load_ms: 50, pause_ms: 5, Audio: behaviour ? fakeAudio(behaviour, log) : null, speechSynthesis: sp.synth, SpeechSynthesisUtterance: sp.Utter });
}

describe('core: Next per mode and the clocks from the end of the last play (lead ruling: A.4, A-11, P3 Q4)', () => {
  test('r9 ON, coach-led: Next at 15 s (never doubled)', () => {
    const { r, at } = runner({ practice: false, manual: true, ui: { r9_question_time: true } });
    toItems(r); r.begin();
    at(14999); expect(r.view().offer_next).toBe(false);
    at(15000); expect(r.view().offer_next).toBe(true);
  });
  test('r9 ON, RDF auto: Next at 30 s (one number, not 60)', () => {
    const { r, at } = runner({ practice: false, ui: { r9_question_time: true } });
    toItems(r); r.begin();
    at(29999); expect(r.view().offer_next).toBe(false);
    at(30000); expect(r.view().offer_next).toBe(true);
  });
  test('a pick task is exempt from the r9 doubling of its waits (an item_timeout_s of 20 s stays 20 s)', () => {
    const b = battery({ practice: false, ui: { r9_question_time: true } });
    b.tasks[0].item_timeout_s = 20;
    let clock = 0;
    const r = createRunner({ battery: b, now: () => clock, onEvent: () => {} });
    toItems(r); r.begin();
    clock = 20000; r.tick();
    expect(r.view().item_index).toBe(1);
  });
  test('today\'s maths tap task is unchanged under r9: its Next at its next_at_s, a word problem\'s timeout doubled', () => {
    const run = (task) => {
      let clock = 0;
      const r = createRunner({ battery: { battery_id: 'm', ui: { r9_question_time: true, r28_letter_pick: true }, tasks: [task] }, now: () => clock, onEvent: () => {} });
      r.start(); r.instructionDone(); r.begin();
      return { r, at: (ms) => { clock = ms; } };
    };
    const a = run(JSON.parse(JSON.stringify(AFTER)));
    a.at(14999); expect(a.r.view().offer_next).toBe(false);
    a.at(15000); expect(a.r.view().offer_next).toBe(true);
    const wp = run({ id: 'ma.wp', mode: 'tap', subtask: 'word_problems', items: [{ id: 'w1', target: '1', options: ['1', '2'] }, { id: 'w2', target: '1', options: ['1', '2'] }] });
    wp.at(60000); wp.r.tick(); expect(wp.r.view().item_index).toBe(0);
    wp.at(120000); wp.r.tick(); expect(wp.r.view().item_index).toBe(1);
  });
  test('a child replay at 8 s: the auto replay and Next count from the END of that play', () => {
    const { r, at, events } = runner({ practice: false });
    toItems(r); r.begin();
    const id = r.view().item.id;
    at(1000); r.promptDone();          // the first play ended at 1 s
    at(9000); r.clipPlaying(id, true); // the child's replay, 8 s later
    at(11000); expect(r.tick()).toBeNull(); // the old clock's 10 s: nothing while the sound plays
    at(12000); r.clipPlaying(id, false);  // it ended (3 s clip)
    at(21999); expect(r.tick()).toBeNull();
    at(22000); expect(r.tick()).toBe('replay');
    expect(events.filter((e) => e.type === 'replay' && e.value === 'auto')).toHaveLength(1);
    r.clipPlaying(id, true);
    at(25000); r.clipPlaying(id, false); // the auto replay ended at 25 s
    at(54999); expect(r.view().offer_next).toBe(false);
    at(55000); expect(r.view().offer_next).toBe(true);
  });
  test('coach-led: no Next while the sound plays; Next 15 s after its end', () => {
    const { r, at } = runner({ practice: false, manual: true });
    toItems(r); r.begin();
    const id = r.view().item.id;
    at(1000); r.promptDone();
    at(15500); r.clipPlaying(id, true);
    at(16100); expect(r.view().offer_next).toBe(false);
    at(17000); r.clipPlaying(id, false);
    at(31999); expect(r.view().offer_next).toBe(false);
    at(32000); expect(r.view().offer_next).toBe(true);
  });
  test('clipPlaying for another item, or a non-pick task, changes nothing', () => {
    const { r, at } = runner({ practice: false, manual: true });
    toItems(r); r.begin();
    at(1000); r.promptDone();
    at(5000); r.clipPlaying('not.this.one', true);
    at(16000); expect(r.view().offer_next).toBe(true);
  });
  test('answer meta keeps pre_taps (taps before the sound, ignored)', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    r.answer(items[0].target, { replays: 0, tap_ms: -700, tap_ms_src: 'timings', pre_taps: 2 });
    expect(r.snapshot().current.answers[0]).toEqual({ item_id: items[0].id, value: items[0].target, ok: true, replays: 0, tap_ms: -700, tap_ms_src: 'timings', pre_taps: 2 });
  });
});

describe('sa.css: the replay pill sits at least 32 px below the bottom card row (lead 170131Z item 5)', () => {
  test('every .sae-pick-replay rule that sets a margin puts ≥ 32 px above the pill', () => {
    const css = require('fs').readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sels = m[1].split(',').map((x) => x.trim());
      if (sels.includes('.sae-pick-replay')) rules.push(m[2]);
    }
    expect(rules.length).toBeGreaterThan(0);
    const tops = [];
    rules.forEach((body) => {
      body.split(';').forEach((decl) => {
        const [k, v] = decl.split(':').map((x) => (x || '').trim());
        if (k === 'margin') tops.push(v.split(/\s+/)[0]);
        if (k === 'margin-top') tops.push(v);
      });
    });
    expect(tops.length).toBeGreaterThan(0);
    tops.forEach((v) => {
      expect(v).toMatch(/^\d+px$/);
      expect(parseInt(v, 10)).toBeGreaterThanOrEqual(32);
    });
  });
});

describe('sa-voice speak(text, audio, { clip_only })', () => {
  test('a clip that fails twice rejects; the phone voice is never used', async () => {
    const log = [];
    const v = voiceWith('error', log);
    await expect(v.speak({ ur: 'بَ' }, 'sa/v5/ur/ls_1.mp3', { clip_only: true })).rejects.toBeTruthy();
    expect(log.filter((x) => x[0] === 'tts')).toHaveLength(0);
    expect(log.filter((x) => x[0] === 'audio')).toHaveLength(2);
  });
  test('no clip at all rejects at once, never the phone voice', async () => {
    const log = [];
    const v = voiceWith('ok', log);
    await expect(v.speak({ ur: 'بَ' }, null, { clip_only: true })).rejects.toBeTruthy();
    expect(log).toEqual([]);
  });
  test('a clip that plays resolves', async () => {
    const log = [];
    const v = voiceWith('ok', log);
    await expect(v.speak(null, 'sa/v5/ur/ls_1.mp3', { clip_only: true })).resolves.toBeUndefined();
  });
  test('without the option a failed clip still falls back as today', async () => {
    const log = [];
    const v = voiceWith('error', log);
    await v.speak({ ur: 'بَ' }, 'sa/v5/ur/ls_1.mp3');
    expect(log.filter((x) => x[0] === 'tts')).toHaveLength(1);
  });
});

describe('sa-voice preload(list, ms)', () => {
  function loader(ok, log) {
    return class A {
      constructor() { this.listeners = {}; }
      set src(u) { this._src = u; log.push(u); }
      get src() { return this._src; }
      load() { setTimeout(() => { if (ok(this._src)) { if (this.oncanplaythrough) this.oncanplaythrough(); } else if (this.onerror) this.onerror(); }, 5); }
      play() { return Promise.resolve(); }
      pause() {}
    };
  }
  test('loads every clip once and resolves when all are ready or failed', async () => {
    jest.resetModules();
    const log = [];
    const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: loader((u) => !/bad/.test(u), log) });
    const got = await v.preload(['sa/v5/ur/a.mp3', 'sa/v5/ur/bad.mp3', 'sa/v5/ur/a.mp3'], 1000);
    expect(got).toEqual({ ready: 1, of: 2 });
    expect(log).toEqual(['/sa/v5/ur/a.mp3', '/sa/v5/ur/bad.mp3']);
  });
  test('resolves after ms when a clip never answers', async () => {
    jest.resetModules();
    const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: class { load() {} } });
    const t0 = Date.now();
    await expect(v.preload(['x.mp3'], 60)).resolves.toEqual({ ready: 0, of: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });
});

// ---------- sa-ui on a DOM ----------
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui: the letter-sound picker screens', () => {
  let dom;
  const keep = {};
  let views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); views = []; for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** speak: a spy; clip lines wait for the test (ctl.end() / ctl.fail()), every other line ends at once. */
  function mount(o) {
    o = o || {};
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const b = battery(o);
    const events = [];
    const r = c.createRunner({ battery: b, onEvent: (e) => events.push(e), manual: !!o.manual });
    const pending = [];
    const speak = jest.fn((text, audio, vo) => {
      if (vo && vo.clip_only) {
        if (o.fail === true || (typeof o.fail === 'function' && o.fail(audio))) return Promise.reject(new Error('clip'));
        if (o.instant) return Promise.resolve();
        return new Promise((ok) => pending.push(ok));
      }
      return Promise.resolve();
    });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner: r, battery: b, lang: o.lang || 'ur', mode: 'proctored', speak, manual: !!o.manual, r28: { letter_pick: o.flag !== false }, preload: o.preload }, o.ui || {}));
    views.push(view);
    return { r, el, view, speak, events, end: () => { while (pending.length) pending.shift()(); } };
  }
  /** The task's items (a battery mounted with practice: false goes from the instruction straight to ready). */
  function toRunning(m) {
    m.r.start(); m.r.instructionDone();
    m.r.begin();
    m.view.render();
  }
  const clipCalls = (m) => m.speak.mock.calls.filter((x) => x[2] && x[2].clip_only === true);

  test('running: five cards in .sae-pick-cards, one big replay; the clip autoplays clip-only', async () => {
    const m = mount({ practice: false });
    toRunning(m);
    const it = m.r.view().item;
    expect(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).toHaveLength(5);
    expect(m.el.querySelectorAll('.sae-pick-replay')).toHaveLength(1);
    expect(m.el.querySelector('.sae-pick-replay').getAttribute('aria-label')).toBe('دوبارہ سنیں');
    await wait(360);
    expect(clipCalls(m).map((x) => [x[0], x[1]])).toEqual([[null, it.prompt_audio]]);
  });

  test('a tap during the clip counts, tap_ms 0; a second fast tap is not counted', async () => {
    const m = mount({ practice: false });
    toRunning(m);
    const it = m.r.view().item;
    await wait(360); // the clip is playing (never ended)
    const cards = m.el.querySelectorAll('.sae-pick-cards .sae-opt');
    cards[0].click();
    cards[1].click();
    const a = m.r.snapshot().current.answers;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ item_id: it.id, value: it.options[0], replays: 0, tap_ms: 0 });
    expect(cards[0].classList.contains('is-pressed')).toBe(true);
  });

  /** The audio lane's prompt timing map, served at v5/prompt_timings.json (stubbed fetch). */
  function timingsFetch(map) {
    const f = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(map) }));
    dom.window.fetch = f;
    return f;
  }

  test('timings: a tap 2 s after the clip began, speech ending at 1.2 s: tap_ms 800, src timings; the map is fetched once per task', async () => {
    const its = battery({ practice: false }).tasks[0].items;
    const map = {};
    its.forEach((x) => { map[x.prompt_audio] = { speech_start_ms: 300, speech_end_ms: 1200 }; });
    const f = timingsFetch(map);
    const m = mount({ practice: false });
    toRunning(m);
    await wait(300 + 2000);
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    const a = m.r.snapshot().current.answers[0];
    expect(a.tap_ms_src).toBe('timings');
    expect(a).not.toHaveProperty('tap_before_sound');
    expect(a.tap_ms).toBeGreaterThanOrEqual(760);
    expect(a.tap_ms).toBeLessThan(900);
    await wait(450 + 300 + 600); // the next item, 600 ms into its clip (past the pre-sound window)
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    expect(m.r.snapshot().current.answers[1].tap_ms_src).toBe('timings');
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('no timing map (404): today\'s rule, tap_ms_src file', async () => {
    dom.window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
    const m = mount({ practice: false });
    toRunning(m);
    await wait(360);
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    const a = m.r.snapshot().current.answers[0];
    expect(a).toMatchObject({ tap_ms: 0, tap_ms_src: 'file' });
    expect(a).not.toHaveProperty('tap_before_sound');
  });

  test('a tap after the clip ended: tap_ms is the time since its end', async () => {
    const m = mount({ practice: false });
    toRunning(m);
    await wait(360);
    m.end();
    await wait(80);
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    const a = m.r.snapshot().current.answers[0];
    expect(a.tap_ms).toBeGreaterThanOrEqual(60);
  });

  test('the replay button plays the clip only, logs replay by the child and counts it on the answer', async () => {
    const m = mount({ practice: false });
    toRunning(m);
    const it = m.r.view().item;
    await wait(360);
    m.end();
    await wait(10);
    m.el.querySelector('.sae-pick-replay').click();
    expect(clipCalls(m)).toHaveLength(2);
    expect(clipCalls(m)[1].slice(0, 2)).toEqual([null, it.prompt_audio]);
    expect(m.events.filter((e) => e.type === 'replay')).toEqual([expect.objectContaining({ item_id: it.id, value: 'child' })]);
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    expect(m.r.snapshot().current.answers[0]).toMatchObject({ replays: 1, tap_ms: 0 });
  });

  test('the first clip of an item that will not play: that item is unavailable, the next item shows, nothing ends', async () => {
    const m = mount({ practice: false, fail: (a) => /ls_1\.mp3$/.test(a) });
    toRunning(m);
    const items = m.r.view().task.items;
    await wait(380);
    expect(m.r.view().phase).toBe('running');
    expect(m.r.view().item.id).toBe(items[1].id);
    expect(m.r.snapshot().current.answers).toEqual([{ item_id: items[0].id, value: null, unavailable: 'clip' }]);
    expect(m.events.find((e) => e.type === 'item_unavailable')).toMatchObject({ item_id: items[0].id, value: { why: 'clip' } });
    expect(m.events.filter((e) => e.type === 'image_unavailable')).toHaveLength(0);
    expect(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).toHaveLength(5);
  });

  test('every clip lost: the task runs to its end, unrated, nothing scored', async () => {
    const m = mount({ practice: false, fail: true });
    toRunning(m);
    await wait(10 * 330 + 300);
    expect(m.r.results()[0]).toMatchObject({ task_id: 'ur.letter_pick10', stop_reason: 'complete', attempted: 0, presented: 0, unavailable: 10, unrated: true });
  });

  test('a replay that will not play leaves the item open: the cards still answer, the replay is logged lost', async () => {
    let n = 0;
    const m = mount({ practice: false, instant: true, fail: (a) => /ls_1\.mp3$/.test(a) && ++n > 1 });
    toRunning(m);
    const it = m.r.view().item;
    await wait(360); // the first play went through
    m.el.querySelector('.sae-pick-replay').click();
    await wait(20);
    expect(m.events.filter((e) => e.type === 'replay').map((e) => e.value)).toEqual(['child', 'lost']);
    expect(m.r.view().item.id).toBe(it.id);
    m.el.querySelector('.sae-pick-cards .sae-opt').click();
    expect(m.r.snapshot().current.answers[0]).toMatchObject({ item_id: it.id, value: it.options[0], replays: 1 });
  });

  test('P1 waits for the task\'s clips to load (opts.preload) before its sound', async () => {
    let loaded;
    const asked = [];
    const m = mount({ manual: true, preload: (list, ms) => { asked.push([list.length, ms]); return new Promise((ok) => { loaded = ok; }); } });
    m.r.start(); m.r.instructionDone();
    m.view.render();
    await wait(50);
    expect(asked).toEqual([[12, 5000]]);
    expect(clipCalls(m)).toHaveLength(0);
    loaded({ ready: 12, of: 12 });
    await wait(20);
    expect(clipCalls(m).map((x) => x[1])).toEqual([m.r.view().practice.prompt_audio]);
  });

  test('P1 (modelled): every card disabled, the target lit; Next after the model line; Next → P2', async () => {
    const m = mount({ manual: true });
    m.r.start(); m.r.instructionDone();
    m.view.render();
    const p1 = m.r.view().practice;
    const cards = Array.from(m.el.querySelectorAll('.sae-pick-cards .sae-opt'));
    expect(cards).toHaveLength(5);
    expect(cards.every((b) => b.disabled)).toBe(true);
    expect(cards.filter((b) => b.classList.contains('is-model')).map((b) => b.getAttribute('data-value'))).toEqual([p1.target]);
    expect(m.el.querySelector('.sae-pick-next')).toBeNull();
    await wait(30);
    m.end(); // the clip ends; then the model line (ends at once)
    await wait(30);
    expect(m.speak.mock.calls.some((x) => x[1] === p1.model[0].audio)).toBe(true);
    const next = m.el.querySelector('.sae-pick-next');
    expect(next).not.toBeNull();
    next.click();
    expect(m.r.view().practice.id).toBe(m.r.view().task.practice[1].id);
    expect(m.events.filter((e) => e.type === 'practice_model')).toHaveLength(1);
  });

  test('P1 in RDF auto moves on by itself 2 s after the model line', async () => {
    const m = mount();
    m.r.start(); m.r.instructionDone();
    m.view.render();
    await wait(30);
    m.end();
    await wait(2150);
    expect(m.r.view().practice.id).toBe(m.r.view().task.practice[1].id);
  });

  test('P2: retry once, then the right card shown', async () => {
    const m = mount();
    m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
    m.view.render();
    const p2 = m.r.view().practice;
    expect(m.el.querySelectorAll('.sae-pick-replay')).toHaveLength(1);
    const wrong = () => Array.from(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).find((b) => b.getAttribute('data-value') !== p2.target);
    wrong().click();
    await wait(1300);
    wrong().click();
    const right = Array.from(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).find((b) => b.getAttribute('data-value') === p2.target);
    expect(right.classList.contains('is-right')).toBe(true);
    expect(right.classList.contains('is-shown')).toBe(true);
  });

  test('coach-led: the clip is still played by the app; the coach screen folds the target', async () => {
    const m = mount({ manual: true, practice: false });
    toRunning(m);
    const it = m.r.view().item;
    await wait(360);
    expect(clipCalls(m).map((x) => x[1])).toEqual([it.prompt_audio]);
    const fold = m.el.querySelector('details.sae-coach-says');
    expect(fold).not.toBeNull();
    expect(fold.textContent).toContain(`${it.prompt_text} → ${it.target}`);
    expect(m.el.querySelectorAll('.sae-pick-replay')).toHaveLength(1);
  });

  test('flag off: a pick task is drawn as today\'s tap screen', () => {
    const m = mount({ flag: false, practice: false });
    toRunning(m);
    expect(m.el.querySelector('.sae-pick-cards')).toBeNull();
    expect(m.el.querySelectorAll('.sae-opts .sae-opt')).toHaveLength(5);
  });

  test('no speechSynthesis ever for a pick item, even with a phone voice there (the real voice, a clip that 404s)', async () => {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const log = [];
    const sp = fakeSpeech(log);
    const voice = require(VOICE).create({ lang: 'ur', base: '/', retry_ms: 5, load_ms: 50, pause_ms: 5, Audio: fakeAudio('error', log), speechSynthesis: sp.synth, SpeechSynthesisUtterance: sp.Utter });
    const b = battery({ practice: false });
    const r = c.createRunner({ battery: b, onEvent: () => {} });
    const el = document.getElementById('m');
    views.push(ui.mount(el, { runner: r, battery: b, lang: 'ur', mode: 'proctored', speak: voice.speak, r28: { letter_pick: true } }));
    r.start(); r.instructionDone(); r.begin();
    views[0].render();
    await wait(10 * 420 + 400);
    expect(log.filter((x) => x[0] === 'tts')).toHaveLength(0);
    expect(r.results()[0]).toMatchObject({ stop_reason: 'complete', attempted: 0, presented: 0, unrated: true });
  });
  // ---------- round 28, A3: a tap before the sound; Next per mode; the clocks; the coach line; the fold ----------
  describe('A3 (lead 165028Z item 1, 170131Z items 2, 4, 5)', () => {
    let fake = null;
    let spy = null;
    const realNow = Date.now.bind(Date);
    beforeEach(() => { fake = null; spy = jest.spyOn(Date, 'now').mockImplementation(() => (fake == null ? realNow() : fake)); });
    afterEach(() => { spy.mockRestore(); });
    const F = 5000000;
    const UR_LINE = 'آواز جگنو بولے گا۔ آپ آواز نہ بولیں۔ بچہ نہ سنے تو آواز والا بٹن دبائیں۔';
    const EN_LINE = 'Jugnu says the sound. Please do not say it. If the child did not hear it, press the sound button.';
    function allTimed(t) {
      const map = {};
      t.items.concat(t.practice || []).forEach((x) => { map[x.prompt_audio] = { speech_start_ms: 300, speech_end_ms: 1200 }; });
      return timingsFetch(map);
    }
    /** The item on show with its clip asked for at F (frozen clock), the timing map loaded. */
    async function atClip(o) {
      allTimed(battery(o).tasks[0]);
      const m = mount(o);
      fake = F;
      toRunning(m);
      await wait(360);
      expect(clipCalls(m)).toHaveLength(1);
      return m;
    }
    const cards = (m) => m.el.querySelectorAll('.sae-pick-cards .sae-opt');

    test('a tap at speech_start + 100 ms is logged (tap_before_sound), never scored; the item stays open and the sound plays on; + 200 ms answers with pre_taps 1', async () => {
      const m = await atClip({ practice: false });
      const it = m.r.view().item;
      fake = F + 400; // speech starts at 300 ms: + 100 ms
      cards(m)[0].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(m.r.view().item.id).toBe(it.id);
      expect(m.events.filter((e) => e.type === 'tap_before_sound')).toEqual([expect.objectContaining({ task_id: it.id.replace(/\.\d+$/, ''), item_id: it.id, value: it.options[0] })]);
      expect(cards(m)[0].classList.contains('is-pressed')).toBe(false); // no pressed lock to eat the real tap
      expect(clipCalls(m)).toHaveLength(1); // the clip is neither cut nor restarted
      fake = F + 500; // + 200 ms
      cards(m)[1].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ item_id: it.id, value: it.options[1], tap_ms: -700, tap_ms_src: 'timings', pre_taps: 1, replays: 0 });
      expect(a[0]).not.toHaveProperty('tap_before_sound');
    });

    test('two pre-sound taps then a real one: pre_taps 2, one answer', async () => {
      const m = await atClip({ practice: false });
      fake = F + 50; cards(m)[0].click();
      fake = F + 440; cards(m)[2].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      fake = F + 450; cards(m)[3].click(); // at speech_start + 150 ms exactly: the answer
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ pre_taps: 2, tap_ms: -750 });
      expect(m.events.filter((e) => e.type === 'tap_before_sound')).toHaveLength(2);
    });

    test('no timing entry (tap_ms_src file): no pre-sound window, the first tap answers as today', async () => {
      // Without speech_start_ms there is nothing to measure a lead-in against: the clip-end rule applies.
      dom.window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
      const m = mount({ practice: false });
      fake = F;
      toRunning(m);
      await wait(360);
      fake = F + 50;
      cards(m)[0].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ tap_ms: 0, tap_ms_src: 'file' });
      expect(a[0]).not.toHaveProperty('pre_taps');
      expect(m.events.filter((e) => e.type === 'tap_before_sound')).toHaveLength(0);
    });

    test('practice (P2): a pre-sound tap gives no feedback; the tap after the window does', async () => {
      allTimed(battery({}).tasks[0]);
      const m = mount();
      fake = F;
      m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
      m.view.render();
      await wait(60);
      const p2 = m.r.view().practice;
      expect(p2.role).toBe('practice');
      const pa = jest.spyOn(m.r, 'practiceAnswer');
      fake = F + 400;
      cards(m)[0].click();
      expect(pa).not.toHaveBeenCalled();
      expect(m.events.filter((e) => e.type === 'tap_before_sound')).toEqual([expect.objectContaining({ item_id: p2.id })]);
      fake = F + 500;
      cards(m)[0].click();
      expect(pa).toHaveBeenCalledTimes(1);
    });

    test('a child replay 8 s after the first play: the auto replay counts from the END of that replay', async () => {
      const m = await atClip({ practice: false });
      const it = m.r.view().item;
      m.end(); // the first play ends at F
      await wait(20);
      fake = F + 8000;
      m.el.querySelector('.sae-pick-replay').click();
      fake = F + 11000; // the old clock's 10 s, the replay still playing
      await wait(320);
      const autos = () => m.events.filter((e) => e.type === 'replay' && e.value === 'auto' && e.item_id === it.id);
      expect(autos()).toHaveLength(0);
      fake = F + 12000;
      m.end(); // the replay ends at F + 12 s
      await wait(20);
      fake = F + 21900;
      await wait(320);
      expect(autos()).toHaveLength(0);
      fake = F + 22100;
      await wait(320);
      expect(autos()).toHaveLength(1);
    });

    test('coach-led: the coach line above the folded target on items, P1 and P2 (text only, no clip)', async () => {
      const m = mount({ manual: true });
      m.r.start(); m.r.instructionDone();
      m.view.render();
      const check = () => {
        const line = m.el.querySelector('.sae-pick-coach-line');
        expect(line).not.toBeNull();
        expect(line.textContent).toBe(UR_LINE);
        const fold = m.el.querySelector('details.sae-pick-coach');
        expect(fold).not.toBeNull();
        expect(line.compareDocumentPosition(fold) & 4).toBe(4); // the line comes before the fold
      };
      check(); // P1
      m.r.practiceModelled(); m.view.render(); check(); // P2
      m.r.practiceAnswer(m.r.view().practice.target);
      m.r.begin(); m.view.render(); check(); // item 1
      expect(m.speak.mock.calls.some((c) => c[0] && (c[0] === UR_LINE || c[0].text === UR_LINE || c[0].ur === UR_LINE))).toBe(false);
    });

    test('coach line: English in an English run; RDF auto shows none; switch OFF shows none', () => {
      const en = mount({ manual: true, practice: false, lang: 'en' });
      toRunning(en);
      expect(en.el.querySelector('.sae-pick-coach-line').textContent).toBe(EN_LINE);
      const auto = mount({ practice: false });
      toRunning(auto);
      expect(auto.el.querySelector('.sae-pick-coach-line')).toBeNull();
      const off = mount({ manual: true, practice: false, flag: false });
      toRunning(off);
      expect(off.el.querySelector('.sae-pick-coach-line')).toBeNull();
    });

    test('the folded target: folded by default, stays open across a redraw once the coach opens it, folded again on the next item', async () => {
      const m = mount({ manual: true, practice: false });
      toRunning(m);
      const fold = () => m.el.querySelector('details.sae-pick-coach');
      expect(fold().open).toBe(false);
      fold().open = true;
      fold().dispatchEvent(new dom.window.Event('toggle'));
      m.view.render();
      expect(fold().open).toBe(true);
      cards(m)[0].click();
      await wait(450);
      expect(m.r.view().item_index).toBe(1);
      expect(fold().open).toBe(false);
    });
  });
});
