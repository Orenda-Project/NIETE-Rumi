'use strict';
/**
 * Round 28 (switch sa_r28_letter_pick, engine flag battery.ui.r28_letter_pick): the letter-sound picker. Jugnu plays a
 * sound clip, five letter cards, the child taps one; scored on the phone. A task of kind 'pick' (response tap,
 * untimed, replay at 10 s, Next at 15 s). P1 is modelled (no tap), P2 is the engine's retry-once-then-show practice.
 * A clip that cannot play ends the task assets_unavailable and is never spoken by the browser voice.
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
  const r = createRunner({ battery: battery(o), now: () => clock, onEvent: (e) => events.push(e) });
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

  test('tick() says replay once at 10 s; Next is offered at next_at_s (15 s)', () => {
    const { r, at, events } = runner({ practice: false });
    toItems(r); r.begin();
    at(9999); expect(r.tick()).toBeNull();
    at(10000); expect(r.tick()).toBe('replay');
    at(12000); expect(r.tick()).toBeNull();
    expect(events.filter((e) => e.type === 'replay')).toEqual([expect.objectContaining({ value: 'auto', item_id: 'ur.letter_pick10.01' })]);
    at(14999); expect(r.view().offer_next).toBe(false);
    at(15000); expect(r.view().offer_next).toBe(true);
    at(60000); expect(r.tick()).toBeNull();
    expect(r.view().phase).toBe('running'); // no time-out on an item (A-11)
  });

  test('r9_question_time: offer_next stays at next_at_s for an untimed tap item (the engine as it is; not changed here)', () => {
    const { r, at } = runner({ practice: false, ui: { r9_question_time: true } });
    toItems(r); r.begin();
    at(15000);
    expect(r.view().offer_next).toBe(true);
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

  test('imageUnavailable(task, item, \'clip\'): assets_unavailable, nothing scored, the event says why', () => {
    const { r, events } = runner({ practice: false });
    toItems(r); r.begin();
    const it = r.view().item;
    r.imageUnavailable('ur.letter_pick10', it.id, 'clip');
    const res = r.results()[0];
    expect(res).toMatchObject({ stop_reason: 'assets_unavailable', attempted: 0, answers: [] });
    expect(events.find((e) => e.type === 'image_unavailable')).toMatchObject({ task_id: 'ur.letter_pick10', item_id: it.id, value: { why: 'clip' } });
  });

  test('imageUnavailable(task, item) without why logs today\'s event (no value)', () => {
    const { r, events } = runner({ practice: false });
    toItems(r); r.begin();
    r.imageUnavailable('ur.letter_pick10', r.view().item.id);
    expect(events.find((e) => e.type === 'image_unavailable')).not.toHaveProperty('value');
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
        if (o.fail) return Promise.reject(new Error('clip'));
        return new Promise((ok) => pending.push(ok));
      }
      return Promise.resolve();
    });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner: r, battery: b, lang: o.lang || 'ur', mode: 'proctored', speak, manual: !!o.manual, r28: { letter_pick: o.flag !== false } }, o.ui || {}));
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

  test('a clip that will not play ends the task assets_unavailable (why clip), nothing scored', async () => {
    const m = mount({ fail: true, practice: false });
    toRunning(m);
    await wait(360);
    const res = m.r.results()[0];
    expect(res).toMatchObject({ task_id: 'ur.letter_pick10', stop_reason: 'assets_unavailable', attempted: 0, answers: [] });
    expect(m.events.find((e) => e.type === 'image_unavailable')).toMatchObject({ value: { why: 'clip' } });
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
    await wait(600);
    expect(log.filter((x) => x[0] === 'tts')).toHaveLength(0);
    expect(r.results()[0]).toMatchObject({ stop_reason: 'assets_unavailable', attempted: 0 });
  });
});
