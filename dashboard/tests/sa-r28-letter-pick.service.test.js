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
    // round 28 (O-10): the skipped answer says how long the child had (the clock never moved here: 0)
    expect(res.answers[2]).toEqual({ item_id: items[2].id, value: 'skipped', ok: false, wait_ms: 0 });
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
    // a tap during the speech (after its start): scored, its meta kept. A tap_before_sound: true is never scored (below).
    r.answer(items[0].target, { replays: 0, tap_ms: -300, tap_before_sound: false, tap_ms_src: 'timings' });
    expect(r.snapshot().current.answers[0]).toEqual({ item_id: items[0].id, value: items[0].target, ok: true, replays: 0, tap_ms: -300, tap_before_sound: false, tap_ms_src: 'timings' });
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

describe('sa.css: the replay pill sits at least 32 px below the bottom card row (SPEC A.3)', () => {
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

// ---------- round 28, A4: the coach-led picker: the fold never sits under a card; the phone fits with the real font ----------
/** sa.css as [{ media, sels: [...], decls: {prop: value} }], comments removed; one level of @media. */
function cssRules() {
  const css = require('fs').readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0, media = null, depth = 0, buf = '';
  while (i < css.length) {
    const ch = css[i++];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@media')) { media = head; depth = 1; continue; }
      const end = css.indexOf('}', i);
      const decls = {};
      css.slice(i, end).split(';').forEach((d) => { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
      out.push({ media: depth ? media : null, sels: head.split(',').map((x) => x.trim()), decls });
      i = end + 1;
    } else if (ch === '}') { buf = ''; if (depth) { depth = 0; media = null; } } else buf += ch;
  }
  return out;
}
const PHONE_ONLY = /max-width:\s*699px/;
describe('sa.css: the coach-led picker (SPEC A.3, A.6)', () => {
  const rules = cssRules();
  test('a letter card\'s ink never takes a tap: Nastaliq\'s text box runs past the card (over the fold), so taps go to the card box only', () => {
    const r = rules.filter((x) => !x.media && x.sels.some((s) => /\.sae-pick-cards\b.*\.sae-opt\b.*\.sae-ink$/.test(s)));
    expect(r.some((x) => x.decls['pointer-events'] === 'none')).toBe(true);
  });
  test('tablet, coach-led: the fold keeps clear of the cards\' Nastaliq ink box (≥ 24 px below it)', () => {
    const r = rules.filter((x) => x.media && /min-width:\s*700px/.test(x.media) && x.sels.some((s) => /\.is-coach-led\b.*details\.sae-pick-coach$/.test(s)));
    expect(r.length).toBeGreaterThan(0);
    r.forEach((x) => expect(parseInt(x.decls['margin-bottom'], 10)).toBeGreaterThanOrEqual(24));
  });
  test('coach-led: the open fold never moves the cards: its revealed line is laid over the fold\'s own row (absolute), and passes a tap to the summary', () => {
    const r = rules.filter((x) => !x.media && x.sels.some((s) => /\.is-coach-led\b.*details\.sae-pick-coach\s*>\s*\.sae-coach-line$/.test(s)));
    expect(r.some((x) => x.decls.position === 'absolute' && x.decls['pointer-events'] === 'none')).toBe(true);
    const d = rules.filter((x) => !x.media && x.sels.some((s) => /\.is-coach-led\b.*details\.sae-pick-coach$/.test(s)));
    expect(d.some((x) => x.decls.position === 'relative')).toBe(true);
  });
  test('coach-led keeps the RDF auto letter cards and replay pill (A.3): no .is-coach-led rule sizes a card, its glyph or the pill', () => {
    rules.filter((x) => x.sels.some((s) => /\.is-coach-led\b.*\.sae-opt\b/.test(s))).forEach((x) => {
      ['height', 'min-height', 'width', 'font-size', 'padding'].forEach((k) => expect(x.decls[k]).toBeUndefined());
    });
    rules.filter((x) => x.sels.some((s) => /\.is-coach-led\b.*\.sae-pick-replay$/.test(s))).forEach((x) => {
      ['height', 'min-height', 'margin', 'margin-top', 'font-size'].forEach((k) => expect(x.decls[k]).toBeUndefined());
    });
  });
  test('phone, coach-led: the room comes from the head row and the gaps (Jugnu ≥ 64 px), never from the cards', () => {
    const j = rules.filter((x) => x.media && PHONE_ONLY.test(x.media) && x.sels.some((s) => /\.is-coach-led\b.*\.sae-jugnu-s$/.test(s)));
    expect(j.length).toBeGreaterThan(0);
    j.forEach((x) => expect(parseInt(x.decls.height, 10)).toBeGreaterThanOrEqual(64));
    const g = rules.filter((x) => x.media && PHONE_ONLY.test(x.media) && x.sels.some((s) => /\.is-coach-led\b.*\.sae-body$/.test(s)));
    expect(g.some((x) => parseInt(x.decls.gap, 10) >= 8)).toBe(true);
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
    const b = o.battery || battery(o);
    const events = [];
    const r = c.createRunner(Object.assign({ battery: b, onEvent: (e) => events.push(e), manual: !!o.manual }, o.now ? { now: o.now } : {}, o.runner || {}));
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

  test('the sandbox Jump row (dev tools on): not drawn on the picker\'s practice or item screens; drawn on a tap screen with the switch off', () => {
    const dev = { runner: { dev_tools: true }, ui: { devJump: () => {} } };
    const has = (m) => !!m.el.querySelector('.sae-devjump-row');
    const a = mount(Object.assign({ manual: true, instant: true }, dev));
    a.r.start(); a.r.instructionDone(); a.view.render();
    expect(a.r.view().phase).toBe('practice');
    expect(has(a)).toBe(false);
    const b = mount(Object.assign({ manual: true, practice: false, instant: true }, dev));
    toRunning(b);
    expect(b.r.view().phase).toBe('running');
    expect(has(b)).toBe(false);
    const c = mount(Object.assign({ manual: true, practice: false, instant: true, flag: false }, dev));
    toRunning(c);
    expect(c.r.view().phase).toBe('running');
    expect(has(c)).toBe(true);
  });

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
    await wait(360 + 500); // the clip is playing (never ended), past the no-map lead-in window (300 + 150 ms)
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
    await wait(360 + 600); // past the A.4 lead-in window (300 + 150 ms) the no-map rule keeps for the pre-sound tap
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
    await wait(500); // into the replay, past the no-map lead-in window (300 + 150 ms)
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
    const m = mount({ instant: true }); // each play ends at once: no tap here falls inside a sound's lead-in
    m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
    m.view.render();
    const p2 = m.r.view().practice;
    expect(m.el.querySelectorAll('.sae-pick-replay')).toHaveLength(1);
    await wait(360);
    const wrong = () => Array.from(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).find((b) => b.getAttribute('data-value') !== p2.target);
    wrong().click();
    await wait(1300);
    wrong().click();
    const right = Array.from(m.el.querySelectorAll('.sae-pick-cards .sae-opt')).find((b) => b.getAttribute('data-value') === p2.target);
    expect(right.classList.contains('is-right')).toBe(true);
    expect(right.classList.contains('is-shown')).toBe(true);
  });

  test('coach-led: the clip is still played by the app; the coach screen has the fold, never the target (lead ruling: no glyph on a live item)', async () => {
    const m = mount({ manual: true, practice: false });
    toRunning(m);
    const it = m.r.view().item;
    await wait(360);
    expect(clipCalls(m).map((x) => x[1])).toEqual([it.prompt_audio]);
    const fold = m.el.querySelector('details.sae-coach-says');
    expect(fold).not.toBeNull();
    expect(fold.textContent).not.toContain(it.target);
    expect(fold.textContent).not.toContain(it.prompt_text);
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
  describe('the pre-sound tap, the replay clock, the coach line and the fold (SPEC A.3–A.6)', () => {
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

    test('no timing map (offline, tap_ms_src file): speech start is the 0.30 s lead-in; + 200 ms is logged, never scored; + 600 ms answers', async () => {
      // Lead ruling (P3-1 ii): every v5 prompt is cut with a 0.30 s lead-in, so without the map a tap before 300 + 150 ms
      // is a tap before the sound. tap_ms stays the clip-end rule (0 while the clip plays), tap_ms_src 'file'.
      dom.window.fetch = jest.fn(() => Promise.reject(new Error('offline')));
      const m = mount({ practice: false });
      fake = F;
      toRunning(m);
      await wait(360);
      expect(clipCalls(m)).toHaveLength(1);
      const it = m.r.view().item;
      fake = F + 200;
      cards(m)[0].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(m.r.view().item.id).toBe(it.id);
      expect(m.events.filter((e) => e.type === 'tap_before_sound')).toEqual([expect.objectContaining({ item_id: it.id, value: it.options[0], tap_ms: 0 })]);
      expect(cards(m)[0].classList.contains('is-pressed')).toBe(false);
      fake = F + 600;
      cards(m)[1].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ item_id: it.id, value: it.options[1], tap_ms: 0, tap_ms_src: 'file', pre_taps: 1 });
      expect(a[0]).not.toHaveProperty('tap_before_sound');
    });

    test('no timing map: at exactly 300 + 150 ms the tap answers (the window is strict)', async () => {
      dom.window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
      const m = mount({ practice: false });
      fake = F;
      toRunning(m);
      await wait(360);
      fake = F + 450;
      cards(m)[0].click();
      expect(m.r.snapshot().current.answers).toHaveLength(1);
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
      await wait(360 + 500); // the clip asked for, then past the no-map lead-in window (300 + 150 ms)
      expect(clipCalls(m)).toHaveLength(0); // opened before the autoplay: the sound waits for the close
      cards(m)[0].click(); // the open fold is modal: this tap only closes it
      expect(m.r.view().item_index).toBe(0);
      await wait(500); // the sound starts after the close; then past its pre-sound window
      expect(clipCalls(m)).toHaveLength(1);
      cards(m)[0].click();
      await wait(450);
      expect(m.r.view().item_index).toBe(1);
      expect(fold().open).toBe(false);
    });
  });
  describe('round 28 A4: the coach-led screen is marked for its own fit (SPEC A.3, A.6)', () => {
    test('coach-led: P1, P2 and the items carry .is-coach-led; RDF auto never does', () => {
      const m = mount({ manual: true });
      m.r.start(); m.r.instructionDone();
      m.view.render();
      const scr = () => m.el.querySelector('.sae-screen.sae-pick');
      expect(scr().classList.contains('is-coach-led')).toBe(true); // P1
      m.r.practiceModelled(); m.view.render();
      expect(scr().classList.contains('is-coach-led')).toBe(true); // P2
      m.r.practiceAnswer(m.r.view().practice.target);
      m.r.begin(); m.view.render();
      expect(scr().classList.contains('is-coach-led')).toBe(true); // item 1
      const auto = mount({ practice: false });
      toRunning(auto);
      expect(auto.el.querySelector('.sae-screen.sae-pick')).not.toBeNull();
      expect(auto.el.querySelector('.is-coach-led')).toBeNull();
    });
    test('coach-led: the coach\'s Next sits in the head row (its place held before it is offered), never at the foot; RDF auto keeps it at the foot', async () => {
      const at = (m) => m.el.querySelector('.sa-next');
      for (const manual of [true, false]) {
        let clock = 1000;
        const m = mount({ manual, practice: false, instant: true, now: () => clock });
        toRunning(m);
        await wait(30); // the item's clip ended: the item clock starts
        m.view.render();
        expect(at(m)).toBeNull();
        if (manual) expect(m.el.querySelector('.sae-pick-head .sae-pick-next-slot')).not.toBeNull();
        clock += 31000; // past Next in both modes (15 s coach-led, 30 s RDF auto); the auto replay already played
        m.r.tick();
        await wait(30);
        clock += 31000;
        m.view.render();
        expect(m.r.view().offer_next).toBe(true);
        expect(at(m)).not.toBeNull();
        if (manual) {
          expect(at(m).closest('.sae-pick-head')).not.toBeNull();
          expect(m.el.querySelector('.sae-pick-head .sae-pick-next-slot')).toBeNull();
          expect(m.el.querySelector('.sae-foot')).toBeNull();
          at(m).click();
          expect(m.r.view().item_index).toBe(1);
        } else {
          expect(at(m).closest('.sae-foot')).not.toBeNull();
          expect(m.el.querySelector('.sae-pick-head .sae-pick-next-slot')).toBeNull();
        }
      }
    });
  });
  describe('round 28 A5: the coach fold on a live item never shows the target letter, is modal, and is logged (SPEC A.5, A.6)', () => {
    const cards = (m) => m.el.querySelectorAll('.sae-pick-cards .sae-opt');
    const fold = (m) => m.el.querySelector('details.sae-pick-coach');
    const ev = (m, type) => m.events.filter((e) => e.type === type);
    const open = (m) => { fold(m).open = true; fold(m).dispatchEvent(new dom.window.Event('toggle')); };
    const shut = (m) => { fold(m).open = false; fold(m).dispatchEvent(new dom.window.Event('toggle')); };
    /** A6: the ghost-click guard's clock (performance.now) moved 1 s on, so the next tap is past it. */
    const pastGuard = () => { const n = performance.now(); jest.spyOn(performance, 'now').mockImplementation(() => n + 1000); };
    afterEach(() => { jest.restoreAllMocks(); });
    /** Coach-led, the item on show, its first sound played and ended (instant clips), past the pre-sound window. */
    async function live(o) {
      const m = mount(Object.assign({ manual: true, practice: false, instant: true }, o || {}));
      toRunning(m);
      await wait(360 + 500);
      return m;
    }

    for (const lang of ['ur', 'en']) {
      test(`${lang}: the open fold on every live item carries no element and no text with the target letter; it carries a replay button`, async () => {
        const m = await live({ lang });
        const n = m.r.view().task.items.length;
        for (let i = 0; i < n; i++) {
          const it = m.r.view().item;
          open(m);
          m.view.render();
          const d = fold(m);
          expect(d.open).toBe(true);
          // the summary is the fold's constant label («کوچ» / "Coach", the same on every item, shown folded too): a word,
          // not a cue for the item. Everything else the open fold renders carries no target letter at all.
          const label = d.querySelector('summary');
          expect(label.textContent).toBe(lang === 'ur' ? 'کوچ' : 'Coach');
          const body = Array.from(d.querySelectorAll('*')).filter((x) => x !== label && !label.contains(x));
          expect(body.filter((x) => x.textContent.includes(it.target) || String(x.getAttribute('aria-label') || '').split(/\s+/).includes(it.target))).toEqual([]);
          expect(d.textContent.replace(label.textContent, '').includes(it.target)).toBe(false);
          expect(d.querySelector('button.sae-pick-coach-replay')).not.toBeNull();
          shut(m);
          await wait(20);
          cards(m)[0].click();
          await wait(450);
          m.view.render();
        }
      });
    }

    /** The served coach-led batteries (sa.coach.G3.A, UR and EN) through the route's applySwitches, r28 ON: each picker
     *  task alone, its practice set aside (the items are what is live). */
    function servedPick() {
      const { applySwitches } = require('../routes/sa-battery-switches');
      const on = { rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true, oneAtATime: true };
      const out = [];
      for (const lang of ['ur', 'en']) {
        const raw = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G3.A.${lang}.json`), 'utf8'));
        const b = applySwitches(raw, on);
        b.tasks.filter((t) => t.kind === 'pick').forEach((t) => out.push({ lang, battery: Object.assign({}, b, { tasks: [Object.assign({}, t, { practice: [] })] }) }));
      }
      return out;
    }
    test('served batteries (UR and EN, both picker tasks each): the open fold on every live item has no target letter', async () => {
      const served = servedPick();
      expect(served.length).toBeGreaterThanOrEqual(2);
      let seen = 0;
      for (const s of served) {
        const m = await live({ lang: s.lang, battery: s.battery });
        const n = s.battery.tasks[0].items.length;
        expect(n).toBe(10);
        for (let i = 0; i < n; i++) {
          const it = m.r.view().item;
          expect(it.id).toBe(s.battery.tasks[0].items[i].id);
          open(m);
          m.view.render();
          const d = fold(m);
          const label = d.querySelector('summary');
          const body = Array.from(d.querySelectorAll('*')).filter((x) => x !== label && !label.contains(x));
          expect({ item: it.id, hits: body.filter((x) => x.textContent.includes(it.target)).length, text: d.textContent.replace(label.textContent, '').includes(it.target) })
            .toEqual({ item: it.id, hits: 0, text: false });
          seen++;
          shut(m);
          await wait(20);
          m.r.answer(it.options[0]);
          m.view.render();
        }
        m.view.destroy(); // the next battery mounts on the same element
        m.el.innerHTML = '';
      }
      expect(seen).toBe(served.length * 10);
    }, 30000);

    test('practice P2: the glyph may show (the fold keeps the sound and the letter)', () => {
      const m = mount({ manual: true });
      m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
      m.view.render();
      const p2 = m.r.view().practice;
      expect(fold(m).textContent.includes(p2.target)).toBe(true);
    });

    test('modal: fold open, a tap on card 4 only closes it (no answer, no pressed card); the next tap answers; fold_open / fold_close {by: tap, card: 3} once each', async () => {
      const m = await live();
      const it = m.r.view().item;
      open(m);
      m.view.render(); // a redraw of the same item keeps it open and logs nothing more
      expect(ev(m, 'fold_open')).toEqual([expect.objectContaining({ task_id: 'ur.letter_pick10', item_id: it.id })]);
      cards(m)[3].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(cards(m)[3].classList.contains('is-pressed')).toBe(false);
      expect(fold(m).open).toBe(false);
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ task_id: 'ur.letter_pick10', item_id: it.id, by: 'tap', card: 3 })]);
      pastGuard(); // past the 300 ms ghost-click guard (A6): its clock (performance.now) moved on
      cards(m)[3].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ item_id: it.id, value: it.options[3] });
      expect(ev(m, 'fold_open')).toHaveLength(1);
      expect(ev(m, 'fold_close')).toHaveLength(1);
    });

    test('modal: the coach folds it with the summary → fold_close {by: summary, card: null}', async () => {
      const m = await live();
      const it = m.r.view().item;
      open(m);
      shut(m);
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ item_id: it.id, by: 'summary', card: null })]);
    });

    test('modal: a tap on the replay pill with the fold open only closes it (no sound, no replay event); the next tap replays', async () => {
      const m = await live();
      const before = clipCalls(m).length;
      open(m);
      m.el.querySelector('.sae-pick-replay').click();
      expect(fold(m).open).toBe(false);
      expect(clipCalls(m)).toHaveLength(before);
      expect(ev(m, 'replay')).toHaveLength(0);
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ by: 'tap', card: null })]);
      pastGuard(); // past the 300 ms ghost-click guard (A6): its clock (performance.now) moved on
      m.el.querySelector('.sae-pick-replay').click();
      expect(clipCalls(m)).toHaveLength(before + 1);
      expect(ev(m, 'replay')).toEqual([expect.objectContaining({ value: 'child' })]);
    });

    test('the fold\'s own replay button: the fold closes first (by replay, card null), then the sound plays', async () => {
      const m = await live();
      const before = clipCalls(m).length;
      open(m);
      fold(m).querySelector('button.sae-pick-coach-replay').click();
      expect(fold(m).open).toBe(false);
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ by: 'replay', card: null })]);
      expect(clipCalls(m)).toHaveLength(before + 1);
      expect(ev(m, 'replay')).toEqual([expect.objectContaining({ value: 'coach' })]);
    });

    test('the item\'s sound never starts while the fold is open: opened before the autoplay, the sound waits for the close', async () => {
      const m = mount({ manual: true, practice: false, instant: true });
      toRunning(m);
      open(m);
      await wait(500);
      expect(clipCalls(m)).toHaveLength(0);
      shut(m);
      await wait(20);
      expect(clipCalls(m)).toHaveLength(1);
    });

    test('modal: the offered Next with the fold open: the first tap closes it, the item stays; the second skips', async () => {
      let clock = 1000;
      const m = mount({ manual: true, practice: false, instant: true, now: () => clock });
      toRunning(m);
      await wait(30);
      clock += 31000; m.r.tick(); await wait(30); clock += 31000;
      m.view.render();
      expect(m.r.view().offer_next).toBe(true);
      open(m);
      m.el.querySelector('.sa-next').click();
      expect(m.r.view().item_index).toBe(0);
      expect(fold(m).open).toBe(false);
      pastGuard(); // past the 300 ms ghost-click guard (A6): its clock (performance.now) moved on
      m.el.querySelector('.sa-next').click();
      expect(m.r.view().item_index).toBe(1);
    });

    test('practice P2: modal too (the first tap closes the fold, no practice answer; the second answers)', async () => {
      const m = mount({ manual: true, instant: true });
      m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
      m.view.render();
      await wait(360 + 500);
      const pa = jest.spyOn(m.r, 'practiceAnswer');
      open(m);
      cards(m)[0].click();
      expect(pa).not.toHaveBeenCalled();
      expect(fold(m).open).toBe(false);
      pastGuard(); // past the 300 ms ghost-click guard (A6): its clock (performance.now) moved on
      cards(m)[0].click();
      expect(pa).toHaveBeenCalledTimes(1);
    });

    test('RDF auto: no fold, no fold events; a card tap answers at once', async () => {
      const m = mount({ practice: false, instant: true });
      toRunning(m);
      await wait(360 + 500);
      expect(fold(m)).toBeNull();
      cards(m)[2].click();
      expect(m.r.snapshot().current.answers).toHaveLength(1);
      expect(ev(m, 'fold_open').concat(ev(m, 'fold_close'))).toEqual([]);
    });
  });

  describe('round 28 A6: the ghost-click guard after the fold closes, the fold replay closes by replay, every fold_open has its close (SPEC A.6)', () => {
    const cards = (m) => m.el.querySelectorAll('.sae-pick-cards .sae-opt');
    const fold = (m) => m.el.querySelector('details.sae-pick-coach');
    const ev = (m, type) => m.events.filter((e) => e.type === type);
    const open = (m) => { fold(m).open = true; fold(m).dispatchEvent(new dom.window.Event('toggle')); };
    /** The guard's clock is performance.now(): held by the test, moved by hand. */
    let T = 0;
    let perf = null;
    beforeEach(() => { T = 100000; perf = jest.spyOn(performance, 'now').mockImplementation(() => T); });
    afterEach(() => { if (perf) perf.mockRestore(); });
    async function live(o) {
      const m = mount(Object.assign({ manual: true, practice: false, instant: true }, o || {}));
      toRunning(m);
      await wait(360 + 500);
      return m;
    }

    test('scored item: fold open → the first tap closes it → a tap on card 2 at +200 ms is a ghost (no answer, not pressed, one ghost_tap {ms_after_close 200, card 1}) → card 2 at +400 ms answers once', async () => {
      const m = await live();
      const it = m.r.view().item;
      open(m);
      cards(m)[3].click(); // the first tap: closes the fold only
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ item_id: it.id, by: 'tap', card: 3 })]);
      T += 200;
      cards(m)[1].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(Array.from(cards(m)).some((c) => c.classList.contains('is-pressed') || c.classList.contains('is-chosen'))).toBe(false);
      expect(ev(m, 'ghost_tap').map((e) => ({ task_id: e.task_id, item_id: e.item_id, ms_after_close: e.ms_after_close, card: e.card })))
        .toEqual([{ task_id: 'ur.letter_pick10', item_id: it.id, ms_after_close: 200, card: 1 }]);
      T += 200;
      cards(m)[1].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ item_id: it.id, value: it.options[1] });
      expect(ev(m, 'ghost_tap')).toHaveLength(1);
    });

    test('since_fold_ms: fold opened and closed on the item, the scored tap at +400 ms → 400; the next item, no fold closed on it → null; the ghost writes no answer', async () => {
      const m = await live();
      const it = m.r.view().item;
      open(m);
      fold(m).open = false; fold(m).dispatchEvent(new dom.window.Event('toggle')); // closed by the summary
      T += 200;
      cards(m)[1].click(); // a ghost: no answer, so no field
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      T += 200;
      cards(m)[1].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ item_id: it.id, since_fold_ms: 400 });
      await wait(450 + 360 + 500); // the press, the next item, its sound
      const it2 = m.r.view().item;
      expect(it2.id).not.toBe(it.id);
      T += 5000;
      cards(m)[0].click();
      const b = m.r.snapshot().current.answers;
      expect(b).toHaveLength(2);
      expect(b[1]).toMatchObject({ item_id: it2.id, since_fold_ms: null });
      expect(Object.prototype.hasOwnProperty.call(b[1], 'since_fold_ms')).toBe(true);
    });

    test('since_fold_ms: RDF auto (no fold) → null on every scored answer', async () => {
      const m = await live({ manual: false });
      cards(m)[2].click();
      const a = m.r.snapshot().current.answers;
      expect(a).toHaveLength(1);
      expect(a[0].since_fold_ms).toBeNull();
    });

    test('the summary close arms the guard too; a tap at +299 ms is a ghost, at +300 ms it answers', async () => {
      const m = await live();
      open(m);
      fold(m).open = false; fold(m).dispatchEvent(new dom.window.Event('toggle')); // the coach folds it (by summary)
      T += 299;
      cards(m)[0].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(ev(m, 'ghost_tap')).toEqual([expect.objectContaining({ ms_after_close: 299, card: 0 })]);
      T += 1;
      cards(m)[0].click();
      expect(m.r.snapshot().current.answers).toHaveLength(1);
    });

    test('practice P2: the same guard (no practice answer at +200 ms, one ghost_tap; one at +400 ms)', async () => {
      const m = mount({ manual: true, instant: true });
      m.r.start(); m.r.instructionDone(); m.r.practiceModelled();
      m.view.render();
      await wait(360 + 500);
      const p2 = m.r.view().practice;
      const pa = jest.spyOn(m.r, 'practiceAnswer');
      open(m);
      cards(m)[0].click();
      T += 200;
      cards(m)[1].click();
      expect(pa).not.toHaveBeenCalled();
      expect(ev(m, 'ghost_tap')).toEqual([expect.objectContaining({ item_id: p2.id, ms_after_close: 200, card: 1 })]);
      T += 200;
      cards(m)[1].click();
      expect(pa).toHaveBeenCalledTimes(1);
    });

    /** Coach-led, the item's first clip played and ended; then the fold's own replay re-plays the clip (held playing). */
    async function replayed() {
      const m = mount({ manual: true, practice: false });
      toRunning(m);
      await wait(360);
      m.end(); // the item's own clip ended
      await wait(500);
      T += 1000;
      open(m);
      fold(m).querySelector('button.sae-pick-coach-replay').click(); // fold_close by replay; the clip re-plays (still sounding)
      T += 1000;
      return m;
    }
    test('a tap within 300 ms of a fold close while a replayed clip still sounds is a ghost (ghost_tap, never tap_before_sound, no answer)', async () => {
      const m = await replayed();
      open(m);
      cards(m)[3].click(); // the first tap: closes the fold only
      expect(ev(m, 'fold_close').map((e) => e.by)).toEqual(['replay', 'tap']);
      T += 200;
      cards(m)[1].click(); // the double tap's second half, the clip sounding (in its pre-sound window)
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(Array.from(cards(m)).some((c) => c.classList.contains('is-pressed') || c.classList.contains('is-chosen'))).toBe(false);
      expect(ev(m, 'ghost_tap')).toEqual([expect.objectContaining({ ms_after_close: 200, card: 1 })]);
      expect(ev(m, 'tap_before_sound')).toEqual([]);
      m.end();
    });
    test('control: the same sequence with no clip sounding: +200 ms is a ghost, no answer', async () => {
      const m = await replayed();
      m.end(); // the replayed clip ended
      await wait(20);
      open(m);
      cards(m)[3].click();
      T += 200;
      cards(m)[1].click();
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(ev(m, 'ghost_tap')).toHaveLength(1);
      expect(ev(m, 'tap_before_sound')).toEqual([]);
    });
    test('outside the window (+400 ms) while the replayed clip is still in its lead-in: tap_before_sound (logged, never scored), no ghost_tap', async () => {
      const m = await replayed();
      open(m);
      cards(m)[3].click();
      T += 400;
      cards(m)[1].click();
      expect(ev(m, 'ghost_tap')).toEqual([]);
      expect(ev(m, 'tap_before_sound')).toHaveLength(1);
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      m.end();
    });

    test('RDF auto (no fold): two fast taps never log ghost_tap', async () => {
      const m = mount({ practice: false, instant: true });
      toRunning(m);
      await wait(360 + 500);
      cards(m)[1].click();
      T += 100;
      cards(m)[2].click();
      expect(ev(m, 'ghost_tap')).toEqual([]);
      expect(m.r.snapshot().current.answers).toHaveLength(1);
    });

    test('the fold\'s own replay: fold_close {by: replay, card: null} then the replay event; the child\'s pill under an open fold: fold_close {by: tap}, no replay, no sound', async () => {
      const m = await live();
      const before = clipCalls(m).length;
      open(m);
      fold(m).querySelector('button.sae-pick-coach-replay').click();
      const seq = m.events.filter((e) => e.type === 'fold_close' || e.type === 'replay').map((e) => [e.type, e.by === undefined ? e.value : e.by, e.card === undefined ? '-' : e.card]);
      expect(seq).toEqual([['fold_close', 'replay', null], ['replay', 'coach', '-']]);
      expect(clipCalls(m)).toHaveLength(before + 1);
      T += 1000;
      open(m);
      m.el.querySelector('.sae-pick-replay').click();
      expect(ev(m, 'fold_close').slice(1)).toEqual([expect.objectContaining({ by: 'tap', card: null })]);
      expect(ev(m, 'replay')).toHaveLength(1);
      expect(clipCalls(m)).toHaveLength(before + 1);
    });

    test('a fold opened in the 400 ms press window: the item change logs one fold_close {by: item, card: null} for the old item; the new item is drawn folded, no fold_open for it', async () => {
      const m = await live();
      const old = m.r.view().item;
      cards(m)[0].click(); // answered: the pressed card, the next item 400 ms away
      expect(m.r.snapshot().current.answers).toHaveLength(1);
      open(m); // the coach opens the fold inside the press window
      await wait(450);
      m.view.render();
      const now = m.r.view().item;
      expect(now.id).not.toBe(old.id);
      expect(fold(m).open).toBe(false);
      expect(ev(m, 'fold_open').map((e) => e.item_id)).toEqual([old.id]);
      expect(ev(m, 'fold_close').map((e) => ({ task_id: e.task_id, item_id: e.item_id, by: e.by, card: e.card })))
        .toEqual([{ task_id: 'ur.letter_pick10', item_id: old.id, by: 'item', card: null }]);
      // the new item is not under an orphaned modal: its sound plays and a tap answers
      await wait(360 + 500);
      T += 1000;
      cards(m)[2].click();
      expect(m.r.snapshot().current.answers).toHaveLength(2);
    });

    test('the modal reads the fold\'s live state: a summary click and a card click in the same tick → no answer, one fold_close (by tap)', async () => {
      const m = await live();
      fold(m).querySelector('summary').click(); // the browser opens it at once; its toggle event comes later
      cards(m)[1].click();                      // the second finger, before that toggle
      expect(m.r.snapshot().current.answers).toHaveLength(0);
      expect(Array.from(cards(m)).some((c) => c.classList.contains('is-pressed'))).toBe(false);
      await wait(20); // the queued toggle (now closed) changes nothing
      expect(ev(m, 'fold_close')).toEqual([expect.objectContaining({ by: 'tap', card: 1 })]);
      expect(ev(m, 'fold_open')).toHaveLength(1);
      expect(fold(m).open).toBe(false);
      expect(m.r.snapshot().current.answers).toHaveLength(0);
    });

    test('a fold no longer on the screen (redrawn before its toggle arrived) changes nothing: no fold_open, the next tap answers', async () => {
      const m = await live();
      fold(m).querySelector('summary').click(); // opened at once, its toggle event queued
      m.view.render();                          // a redraw replaces the fold before that toggle arrives
      await wait(20);
      expect(fold(m).open).toBe(false);
      expect(ev(m, 'fold_open')).toEqual([]);
      cards(m)[2].click();
      expect(m.r.snapshot().current.answers).toHaveLength(1);
    });
  });
});

// Psychometrics (P1-3a): the pre-sound rule holds in the engine too, not only in the screens. A direct
// runner.answer(v, { tap_before_sound: true }) is logged (the event the screens write) and never scored.
describe('core: answer() with meta.tap_before_sound is logged, never scored', () => {
  test('a direct answer(0, { tap_before_sound: true }) on a pick item: answers unchanged, the item stays open, one log event', () => {
    const { r, events } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    expect(r.answer(items[0].target, { tap_before_sound: true, tap_ms: -400, replays: 0, tap_ms_src: 'timings' })).toBeUndefined();
    expect(r.snapshot().current.answers).toEqual([]);
    expect(r.view().item_index).toBe(0);
    expect(events.filter((e) => e.type === 'tap' || /^item_/.test(e.type))).toHaveLength(0);
    const logged = events.filter((e) => e.type === 'tap_before_sound');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ task_id: items[0].id.replace(/\.\d+$/, ''), item_id: items[0].id, value: items[0].target, tap_ms: -400 });
  });
  test('without the flag (or with it false) it answers as today', () => {
    const { r } = runner({ practice: false });
    toItems(r); r.begin();
    const items = r.view().task.items;
    expect(r.answer(items[0].target, { tap_before_sound: false, tap_ms: 300 })).toBe(true);
    expect(r.answer(items[1].target)).toBe(true);
    expect(r.view().item_index).toBe(2);
    expect(r.snapshot().current.answers).toHaveLength(2);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Coach-led fit on a 360×640 phone (SPEC A.3, A.6; the MCQ's layout-height test, for the picker): the SERVED coach
// batteries (sa.coach.G3.A, UR and EN) through the route's applySwitches with the r28 switches ON, the production layout
// switches, the house Nastaliq. Every coach state — listening, after the sound, chosen, Next offered (≥ 15 s), fold
// open — fits without scrolling, the five cards whole and hit-testable, the cards and the replay pill never move; the
// open fold carries no target letter; each letter's ink lies inside its card (U2, the ink-row method: luminance < 120
// at 2× DPR, the card's ink shown vs hidden). A real browser lays the screen out (jsdom has none): skipped, never red,
// where there is no playwright-core (PWCORE=<path>) or no chromium.
// ------------------------------------------------------------------------------------------------------------------
let pwChromium = null;
try { ({ chromium: pwChromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const PW_EXE = process.env.PWCHROME_EXE || (pwChromium ? (() => { try { return pwChromium.executablePath(); } catch (_) { return null; } })() : null);
const maybePickBrowser = pwChromium && PW_EXE && require('fs').existsSync(PW_EXE) ? describe : describe.skip;

maybePickBrowser('the picker, coach-led on a 360×640 phone: every coach state fits, nothing moves, no target letter in the open fold, each letter\'s ink inside its card (SPEC A.3, A.6, U2)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  // the WHOLE switch set the coach-led battery runs with on the tier (fixtures/sa-served-ui.sandbox.json: the `ui` block a
  // sandbox page was served, verbatim), never a hand-picked subset: a row that needs a switch OFF or ON says so in `more`
  // (a switch key, as the route reads it), and the bare frame runs without the coach's Skip (its definition)
  const LAYOUT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sa-served-ui.sandbox.json'), 'utf8'));
  // the switch keys a row may lay over the served set, and the `ui` flag each one is (sa-battery-switches UI map)
  const FLAG_OF = { r9SkipInstructions: 'r9_skip_instructions', r28ToggleFit: 'r28_toggle_fit', r28CueGuard: 'r28_cue_guard' };
  /** The served set with the row's own switches laid over it (true adds the flag, false removes it); any other key throws. */
  function servedUi(baseUi, more) {
    const ui = Object.assign({}, baseUi, LAYOUT);
    for (const [k, v] of Object.entries(more || {})) {
      if (!FLAG_OF[k]) throw new Error('servedUi: no ui flag mapped for switch ' + k);
      if (v === true) ui[FLAG_OF[k]] = true; else delete ui[FLAG_OF[k]];
    }
    return ui;
  }
  // A9: the production frame of the coach-led phone is the coach page's iframe (embed=1 -> is-embed -> 64 px top room)
  // with the sync dot drawn, the seven layout switches ON (r9_skip_instructions among them); `bare` is the old harness
  // frame (no embed, no dot, no Skip) kept as the twin.
  // `embed` = online: the other language's battery is on the phone, so r8_lang_switch draws «اردو | English» in the top
  // bar (a [lang=ur] element: an English screen takes the 64 px too); `embed_offline` = the same frame without it.
  const FRAMES = [{ name: 'embed', embed: true, toggle: true }, { name: 'embed_offline', embed: true, toggle: false }, { name: 'bare', embed: false, toggle: false }];
  const frMore = (fr, more) => Object.assign({ r9SkipInstructions: !!(fr && fr.embed) }, more || {});
  const frSuffix = (fr) => (!fr ? '' : !fr.embed ? '_noembed' : fr.toggle ? '' : '_offline');
  /** The child's gated tappables under the coach page's hold-end row (cards, the replay pill, the practice Next): ⛔ if any. */
  const gatedHits = (m) => m.hold_hits.filter((x) => /(^| )(sae-opt|sae-pick-replay|sae-pick-next)( |$)/.test(x.cls)).map((x) => x.cls);
  /** The online bar (every frame): the replay pill and the practice Next hit at their centres, their feet ≤ 632 (8 px
   *  clear of the edge), the round-9 scroll cue not drawn, the top bar's height as read. */
  const bar = (m) => ({ pill_foot_ok: !m.pill || m.pill.bottom <= m.vh - 8, pill_hit: m.pill ? m.pill_hit : true,
    next_foot_ok: !m.next || !m.next.foot || m.next.bottom <= m.vh - 8, next_hit: m.next_hit == null ? true : m.next_hit, cue: m.cue, toggle_over_cards: m.toggle ? m.toggle.over_cards : 0 });
  const BAR = { pill_foot_ok: true, pill_hit: true, next_foot_ok: true, next_hit: true, cue: null, toggle_over_cards: 0 };
  const frName = (fr) => (fr && fr.embed ? { frame: 'coach-iframe', embed: true, sync: true, lang_toggle: !!fr.toggle } : { frame: 'bare', embed: false, sync: false, lang_toggle: false });
  /** The other language's served battery (the page's langAltLoad hands it to view.langBattery, normalised). */
  function otherBattery(lang, more) {
    const { applySwitches } = require('../routes/sa-battery-switches');
    const on = Object.assign({ rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true, oneAtATime: true }, more || {});
    const o = lang === 'ur' ? 'en' : 'ur';
    const b = applySwitches(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G3.A.${o}.json`), 'utf8')), on);
    return Object.assign({}, b, { ui: servedUi(b.ui, more) });
  }
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  /** The served battery of `lang`, its own picker task alone (practice set aside: the items are what is measured). */
  function served(lang, keepPractice, more) {
    const { applySwitches } = require('../routes/sa-battery-switches');
    const on = Object.assign({ rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true, oneAtATime: true }, more || {});
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G3.A.${lang}.json`), 'utf8'));
    const b = applySwitches(raw, on);
    const t = b.tasks.find((x) => x.id === `${lang}.letter_pick10`);
    const bat = Object.assign({}, b, { ui: servedUi(b.ui, more), tasks: [keepPractice ? t : Object.assign({}, t, { practice: [] })] });
    delete bat.rdf_auto; delete bat.rdf_manual;
    return bat;
  }
  /** The page: coach-led, a voice whose clip lines end only when the test says (window.__end()), a clock it moves. */
  function page(lang, keepPractice, more, fr) {
    const bat = served(lang, keepPractice, more);
    const embed = !!(fr && fr.embed);
    return { bat, html: `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0;
  var cur = null;
  // Jugnu's clip lines end only when the test says (window.__end()); a spoken line is instant unless the test holds
  // lines (window.__holdLines = true): then it ends on __end() too, as on a device, where the served r10_practice_next
  // keeps the last practice feedback on screen exactly while Jugnu's line is said
  function speak(text, audio, vo) {
    if (!(vo && vo.clip_only) && !window.__holdLines) return Promise.resolve();
    var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; a.duration = 1;
    var line = { a: a };
    cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; });
  }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  window.__holdLines = false;
  window.__events = [];
  var battery = ${JSON.stringify(bat)};
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: ${!(fr && fr.auto)}, one_at_a_time: true, onEvent: function (e) { window.__events.push(e); } });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${!(fr && fr.auto)}, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: ${embed} });
  runner.start(); ${fr && fr.brief ? '' : 'runner.instructionDone(); '}${keepPractice ? '' : 'runner.begin(); '}view.render();
  ${embed ? "view.setSync({ state: 'synced' });" : ''}
  ${fr && fr.toggle ? `view.langBattery('${lang === 'ur' ? 'en' : 'ur'}', SAE.core.normalize(${JSON.stringify(otherBattery(lang, more))}), {});` : ''}
  ${embed ? `(function () {
    // the coach page's own hold-end buttons, drawn OVER the frame by the parent document (AssessEngineSlot: fixed top-2
    // start-2, gap-2, min-h 48, px-3 py-1, text-xs semibold): a stand-in of the same box, End test + End this section
    var hb = document.createElement('div'); hb.id = 'a9-hold'; hb.setAttribute('dir', '${lang === 'ur' ? 'rtl' : 'ltr'}');
    hb.style.cssText = 'position:fixed;top:8px;inset-inline-start:8px;display:flex;gap:8px;z-index:1001;font:600 12px/16px system-ui,sans-serif';
    ${JSON.stringify(lang === 'ur' ? ['جائزہ ختم (کوچ)', 'یہ حصہ ختم کریں'] : ['End test (coach)', 'End this section'])}.forEach(function (t) { var b = document.createElement('button'); b.textContent = t; b.style.cssText = 'min-height:48px;min-width:48px;padding:4px 12px;border:1px solid #cbd5e1;border-radius:12px;background:rgba(255,255,255,.9);font:inherit'; hb.appendChild(b); });
    document.body.appendChild(hb);
  }());` : ''}
  window.__view = view; window.__runner = runner;
</script></body></html>` };
  }
  const measure = () => document.fonts.ready.then(() => {
    const vh = window.innerHeight;
    const R = (e) => { const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    // a card is whole and hit-testable when it is inside the viewport and five points well inside it hit it
    const cards = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt')).map((c) => {
      const b = c.getBoundingClientRect();
      const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.8], [0.75, 0.8]].map(([fx, fy]) => document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy));
      return Object.assign(R(c), { hit: pts.every((e) => !!e && e.closest('.sae-opt') === c), cls: c.className });
    });
    const pill = document.querySelector('.sae-pick-replay');
    const next = document.querySelector('.sa-next');
    const title = document.querySelector('.sae-pick-head .sae-task-tag');
    const d = document.querySelector('details.sae-pick-coach');
    const sm = d && d.querySelector('summary');
    const it = window.__runner.view().item;
    const body = document.querySelector('.sae-pick .sae-body');
    const screen = document.querySelector('.sae-screen');
    const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
    const range = document.createRange(); if (title) range.selectNodeContents(title);
    const foldReplay = d && d.querySelector('.sae-pick-coach-replay');
    return {
      vh, page_h: document.documentElement.scrollHeight, inner_scroll: over(screen) + over(body), item: it && it.id,
      nastaliq: document.documentElement.lang !== 'ur' || !document.querySelector('.sae-pick-cards .sae-opt') || document.fonts.check(getComputedStyle(document.querySelector('.sae-pick-cards .sae-opt')).font, 'ب'),
      title: title && { text: title.textContent, lines: new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top))).size, h: +title.getBoundingClientRect().height.toFixed(1) },
      cards, pill: pill && R(pill), cards_bottom: Math.max.apply(null, cards.map((c) => c.bottom)),
      next: next ? Object.assign(R(next), { in_head: !!next.closest('.sae-pick-head'), foot: !!next.closest('.sae-foot') }) : null,
      fold: d ? Object.assign(R(d), { open: d.open, target_in_fold: !!it && Array.from(d.querySelectorAll('*')).some((x) => x !== sm && !sm.contains(x) && x.textContent.includes(it.target)),
        replay: foldReplay && d.open ? Object.assign(R(foldReplay), { hit: document.elementFromPoint((foldReplay.getBoundingClientRect().left + foldReplay.getBoundingClientRect().right) / 2, (foldReplay.getBoundingClientRect().top + foldReplay.getBoundingClientRect().bottom) / 2) === foldReplay || foldReplay.contains(document.elementFromPoint((foldReplay.getBoundingClientRect().left + foldReplay.getBoundingClientRect().right) / 2, (foldReplay.getBoundingClientRect().top + foldReplay.getBoundingClientRect().bottom) / 2)) }) : null }) : null,
      coach_line: !!document.querySelector('.sae-pick-coach-line'),
      // the coach page's hold-end stand-in, and every head-row child and every tappable that meets it
      hold: (() => { const hb = document.getElementById('a9-hold'); return hb ? Object.assign(R(hb), { buttons: Array.from(hb.children).map(R) }) : null; })(),
      // online frame reads: the pill's and the practice Next's centre hit, the r9 scroll cue, the top bar, what overflows
      pill_hit: (() => { const k = document.querySelector('.sae-pick-replay'); if (!k) return null; const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); })(),
      next_hit: (() => { const k = document.querySelector('.sae-pick-next'); if (!k) return null; const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); })(),
      cue: (() => { const c = document.querySelector('.sae-r9-scroll'); if (!c) return null; const b = c.getBoundingClientRect(); if (!b.height || getComputedStyle(c).display === 'none' || getComputedStyle(c).visibility === 'hidden') return null; return R(c); })(),
      top_h: (() => { const t = document.querySelector('.sae-screen > .sae-top'); return t ? +t.getBoundingClientRect().height.toFixed(1) : null; })(),
      toggle: (() => {
        const t = document.querySelector('.sae-screen .sae-r8-lang'); if (!t) return null;
        const b = t.getBoundingClientRect();
        const ov = (k) => { const c = k.getBoundingClientRect(); const x = Math.min(b.right, c.right) - Math.max(b.left, c.left), y = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top); return x > 0 && y > 0 ? { x: +x.toFixed(1), y: +y.toFixed(1) } : null; };
        const cards = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt'));
        const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        return Object.assign(R(t), { hit: !!e && (e === t || t.contains(e)),
          gap_to_cards: cards.length ? +(Math.min.apply(null, cards.map((c) => c.getBoundingClientRect().top)) - b.bottom).toFixed(1) : null,
          over_cards: cards.filter(ov).length,
          over_head: Array.from(document.querySelectorAll('.sae-pick-head > *')).map((k) => ({ k: String(k.className).split(' ')[0], o: ov(k) })).filter((x) => x.o),
          gap_to_head: (() => { const hd = document.querySelector('.sae-pick-head'); return hd ? +(hd.getBoundingClientRect().top - b.bottom).toFixed(1) : null; })(),
          over_sync: document.querySelector('.sae-sync') ? ov(document.querySelector('.sae-sync')) : null,
          over_hold: document.getElementById('a9-hold') ? ov(document.getElementById('a9-hold')) : null });
      })(),
      boxes: (() => { const scr = document.querySelector('.sae-screen'); const bd = scr && scr.querySelector('.sae-body'); const ft = scr && scr.querySelector('.sae-foot'); const cs = scr && getComputedStyle(scr);
        return scr ? { screen: { sh: scr.scrollHeight, ch: scr.clientHeight, pb: parseFloat(cs.paddingBottom), gap: parseFloat(cs.rowGap) }, body: bd ? { sh: bd.scrollHeight, ch: bd.clientHeight, top: +bd.getBoundingClientRect().top.toFixed(1), pt: parseFloat(getComputedStyle(bd).paddingTop), pb: parseFloat(getComputedStyle(bd).paddingBottom), gap: parseFloat(getComputedStyle(bd).rowGap) } : null, foot: ft ? R(ft) : null,
          past: Array.from(scr.querySelectorAll('*')).filter((n) => { const b = n.getBoundingClientRect(); return b.height > 0 && b.bottom > window.innerHeight + 0.5; }).slice(0, 12).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.'), top: +n.getBoundingClientRect().top.toFixed(1), bottom: +n.getBoundingClientRect().bottom.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) } : null; })(),
      sync_dot: (() => { const d = document.querySelector('.sae-sync'); return d ? R(d) : null; })(),
      hold_hits: (() => {
        const hb = document.getElementById('a9-hold'); if (!hb) return [];
        const a = hb.getBoundingClientRect();
        const els = Array.from(document.querySelectorAll('.sae-pick-head > *, .sae-pick-cards .sae-opt, .sae-pick-replay, .sa-next, .sae-pick-next, details.sae-pick-coach > summary, .sae-pick-coach-replay, .sae-r9-skip, .sae-r8-lang'))
          .filter((k) => getComputedStyle(k).display !== 'none' && getComputedStyle(k).visibility !== 'hidden');
        return els.filter((k) => { const b = k.getBoundingClientRect(); return b.width > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; })
          .map((k) => { const b = k.getBoundingClientRect(); return { cls: String(k.className), px_x: +(Math.min(b.right, a.right) - Math.max(b.left, a.left)).toFixed(1), px_y: +(Math.min(b.bottom, a.bottom) - Math.max(b.top, a.top)).toFixed(1) }; });
      })(),
      frame: { toggle: !!document.querySelector('.sae-screen .sae-r8-lang'), embed: document.querySelector('.sae').classList.contains('is-embed'), sync: !!document.querySelector('.sae-sync'), pad_top: screen ? parseFloat(getComputedStyle(screen).paddingTop) : null, ur_el: !!document.querySelector('.sae-screen [lang=ur]') },
      // A9: the coach line above the fold (or inside it)
      coach_line_at: (() => { const cl = document.querySelector('.sae-pick-coach-line'); return cl ? (cl.closest('details.sae-pick-coach') ? 'fold' : 'above') : null; })(),
      fold_line: (() => { const fl = d && d.open ? d.querySelector('.sae-coach-line') : null; if (!fl) return null; const b = fl.getBoundingClientRect(); return { text: fl.textContent, font_px: parseFloat(getComputedStyle(fl).fontSize), visible: b.width > 0 && b.height > 0 }; })(),
      view: (() => { const v = window.__runner.view(); return { phase: v.phase, practice: v.practice ? v.practice.id : null }; })(),
      fb: (() => { const f = document.querySelector('.sae-pick .sae-fb:not(.is-empty)'); return f ? Object.assign(R(f), { text: f.textContent, whole: f.scrollWidth <= f.clientWidth + 0.5 && f.scrollHeight <= f.clientHeight + 0.5, font_px: parseFloat(getComputedStyle(f).fontSize), in_head: !!f.closest('.sae-pick-head') }) : null; })(),
      // A8: the head row's children (Jugnu, the chip, the feedback line, the coach's Skip): each one's box, clipped or not
      head: (() => {
        const hd = document.querySelector('.sae-pick-head'); if (!hd) return null;
        const kids = Array.from(hd.children).filter((k) => getComputedStyle(k).display !== 'none').map((k) => {
          const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
          return Object.assign(R(k), { cls: String(k.className).split(' ').slice(0, 2).join('.'), text: k.textContent.trim(),
            clip: k.tagName !== 'IMG' && (k.scrollWidth > k.clientWidth + 0.5 || k.scrollHeight > k.clientHeight + 0.5), hit: !!e && (e === k || k.contains(e)) });
        });
        return Object.assign(R(hd), { over_x: Math.max(0, hd.scrollWidth - hd.clientWidth), kids });
      })(),
      // A8: the coach's Skip instructions (r9_skip_instructions): where it is, and whether a tap at its centre reaches it
      skip: (() => {
        const k = document.querySelector('.sae-r9-skip'); if (!k) return null;
        const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        return Object.assign(R(k), { text: k.textContent.trim(), cp: Array.from(k.textContent.trim()).length, hit: !!e && (e === k || k.contains(e)),
          font_px: parseFloat(getComputedStyle(k).fontSize), lines: new Set(Array.from((() => { const rg = document.createRange(); rg.selectNodeContents(k); return rg.getClientRects(); })()).map((x) => Math.round(x.top))).size, ellipsis: getComputedStyle(k).textOverflow === 'ellipsis',
          in_head: !!k.closest('.sae-pick-head'), foot: !!k.closest('.sae-foot'), clip: k.scrollWidth > k.clientWidth + 0.5 || k.scrollHeight > k.clientHeight + 0.5 });
      })(),
      // A11 (sa_r28_toggle_fit): the toggle's hit rect (its button's box) against the top bar, every head-row tappable
      // (Jugnu and the title are not tappables) and the first card row: edge-to-edge px, -1 = the rects share pixels
      a11: (() => {
        const t = document.querySelector('.sae-screen .sae-r8-lang'); const tb = document.querySelector('.sae-screen > .sae-top');
        if (!t || !tb) return null;
        const b = t.getBoundingClientRect(); const bb = tb.getBoundingClientRect();
        const vis = (k) => { const st = getComputedStyle(k); const c = k.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && c.width > 0 && c.height > 0; };
        const gap = (k) => { const c = k.getBoundingClientRect(); const ov = Math.min(b.right, c.right) > Math.max(b.left, c.left) && Math.min(b.bottom, c.bottom) > Math.max(b.top, c.top); if (ov) return -1; return +Math.hypot(Math.max(0, c.left - b.right, b.left - c.right), Math.max(0, c.top - b.bottom, b.top - c.bottom)).toFixed(1); };
        const taps = Array.from(document.querySelectorAll('.sae-pick-head > *, .sae-pick-head .sa-next, .sae-pick-replay, .sae-pick-next, details.sae-pick-coach > summary'))
          .filter((k, i, all) => all.indexOf(k) === i && vis(k) && !/sae-jugnu|sae-task-tag|sae-pick-next-slot/.test(String(k.className)))
          .map((k) => ({ cls: String(k.className).split(' ')[0] || k.tagName.toLowerCase(), in_head: !!k.closest('.sae-pick-head'), top: +k.getBoundingClientRect().top.toFixed(1), gap: gap(k) }));
        const cards = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt')).filter(vis);
        return { top_h: +bb.height.toFixed(1), toggle: [+b.top.toFixed(1), +b.bottom.toFixed(1), +b.left.toFixed(1), +b.right.toFixed(1)], toggle_h: +b.height.toFixed(1),
          over_below: +(b.bottom - bb.bottom).toFixed(1), over_above: +(bb.top - b.top).toFixed(1), taps,
          min_head: taps.some((x) => x.in_head) ? Math.min.apply(null, taps.filter((x) => x.in_head).map((x) => x.gap)) : null,
          min_tap: taps.length ? Math.min.apply(null, taps.map((x) => x.gap)) : null,
          min_cards: cards.length ? Math.min.apply(null, cards.map(gap)) : null,
          g: parseFloat(getComputedStyle(document.querySelector('.sae-screen')).getPropertyValue('--sae-a11-g')) || 0 };
      })(),
      // the screen's blocks top to bottom (where the height goes)
      layout: screen ? [screen].concat(Array.from(screen.children), body ? Array.from(body.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 3).join('.'), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
    };
  });
  /** U2: each card's letter ink (pixels dark with its ink shown, not dark with it hidden), against the card's clip box. */
  async function inkOf(p) {
    const n = await p.evaluate(() => document.querySelectorAll('.sae-pick-cards .sae-opt').length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const box = await p.evaluate((k) => {
        const c = document.querySelectorAll('.sae-pick-cards .sae-opt')[k]; const b = c.getBoundingClientRect(); const cs = getComputedStyle(c);
        return { top: b.top + parseFloat(cs.borderTopWidth), bottom: b.bottom - parseFloat(cs.borderBottomWidth), left: b.left + parseFloat(cs.borderLeftWidth), right: b.right - parseFloat(cs.borderRightWidth), text: c.textContent };
      }, i);
      const clip = { x: Math.max(0, Math.floor(box.left) - 24), y: Math.max(0, Math.floor(box.top) - 24), width: 0, height: 0 };
      clip.width = Math.min(360, Math.ceil(box.right) + 24) - clip.x; clip.height = Math.min(640, Math.ceil(box.bottom) + 24) - clip.y;
      const shown = await p.screenshot({ clip });
      await p.evaluate((k) => { const s = document.querySelectorAll('.sae-pick-cards .sae-opt')[k].querySelector('.sae-ink') || document.querySelectorAll('.sae-pick-cards .sae-opt')[k]; s.style.color = 'transparent'; }, i);
      const hidden = await p.screenshot({ clip });
      await p.evaluate((k) => { const s = document.querySelectorAll('.sae-pick-cards .sae-opt')[k].querySelector('.sae-ink') || document.querySelectorAll('.sae-pick-cards .sae-opt')[k]; s.style.color = ''; }, i);
      const ink = await p.evaluate(async ([a, b, x0, y0]) => {
        const px = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
        const A = await px(a), B = await px(b);
        const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let top = null, bottom = null, left = null, right = null;
        for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
          const i = (y * A.w + x) * 4;
          if (L(A.d, i) < 120 && L(B.d, i) >= 120) { const cx = x0 + x / 2, cy = y0 + y / 2; top = top == null ? cy : Math.min(top, cy); bottom = bottom == null ? cy : Math.max(bottom, cy); left = left == null ? cx : Math.min(left, cx); right = right == null ? cx : Math.max(right, cx); }
        }
        return { top, bottom, left, right };
      }, [shown.toString('base64'), hidden.toString('base64'), clip.x, clip.y]);
      out.push({ card: i, letter: box.text, clip_box: { top: +box.top.toFixed(1), bottom: +box.bottom.toFixed(1), left: +box.left.toFixed(1), right: +box.right.toFixed(1) }, ink,
        inside: ink.top != null && ink.top >= box.top && ink.bottom <= box.bottom && ink.left >= box.left && ink.right <= box.right,
        room: ink.top == null ? null : +Math.min(ink.top - box.top, box.bottom - ink.bottom - 0.5, ink.left - box.left, box.right - ink.right - 0.5).toFixed(1) });
    }
    return out;
  }
  async function states(lang, shots, fr, more) {
    const out = {};
    const { bat, html } = page(lang, false, frMore(fr, more), fr);
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
        if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
        if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(500); // the item's sound starts 300 ms after it shows
      return { ctx, p };
    };
    const snap = async (p, name, wait) => {
      if (wait !== 0) await p.waitForTimeout(wait || 250);
      out[name] = await p.evaluate(measure);
      if (shots) await p.screenshot({ path: path.join(shots, `${process.env.SA_PICK_SHOT_TAG || 'a5'}_${name}${frSuffix(fr)}_${lang}_phone_coach.png`) });
    };
    let { ctx, p } = await open();
    await snap(p, 'listening');
    await p.evaluate(() => window.__end());
    await snap(p, 'aftersound');
    out.ink = { [out.aftersound.item]: await inkOf(p) };
    // every served item: the letters' ink (the item answered through the runner, the next drawn, its sound ended)
    for (let k = 1; k < bat.tasks[0].items.length; k++) {
      await p.evaluate(() => { const v = window.__runner.view(); window.__runner.answer(v.item.options[0]); window.__view.render(); });
      await p.waitForTimeout(450);
      await p.evaluate(() => window.__end());
      await p.waitForTimeout(150);
      const id = await p.evaluate(() => window.__runner.view().item.id);
      out.ink[id] = await inkOf(p);
    }
    await ctx.close();
    ({ ctx, p } = await open());
    await p.evaluate(() => window.__end());
    await p.waitForTimeout(250);
    await p.evaluate(() => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[3]; const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); });
    await snap(p, 'chosen', 0); // the pressed card, before the next item (400 ms)
    await ctx.close();
    ({ ctx, p } = await open());
    await p.evaluate(() => window.__end());
    for (let k = 0; k < 6; k++) { // past the coach-led wait (15 s); the auto replay at 10 s restarts it at its end
      await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
      await p.waitForTimeout(300);
      while (await p.evaluate(() => window.__end())) await p.waitForTimeout(400);
      const drawn = await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sa-next'); });
      if (drawn) break;
    }
    await snap(p, 'offernext');
    const s = out.offernext.fold;
    await p.mouse.click(lang === 'ur' ? s.right - 30 : s.left + 30, (s.top + s.bottom) / 2); // the coach's finger on the label
    await snap(p, 'foldopen', 350);
    out.foldopen_events = await p.evaluate(() => window.__events.filter((e) => /^fold_/.test(e.type)));
    await ctx.close();
    return out;
  }
  /**
   * A6 (U2 for the coach's own line, the MCQ coach line's bar): the picker's coach line (C.pick_coach_line) shown alone
   * (every other element hidden), its text split at its line breaks into spans laid out exactly as before, one line's
   * text drawn at a time; ink = luminance < 120 with that line drawn and >= 120 with no text drawn, 2x DPR. → each
   * line's ink rows, the gaps between them, and the last ink against the line's clip box (inside its border) and the
   * fold's box top.
   */
  async function coachInk(lang, fr) {
    const { html } = page(lang, false, frMore(fr), fr);
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    await p.evaluate(() => window.__end());
    await p.waitForTimeout(250);
    const geo = await p.evaluate(() => {
      const el = document.querySelector('.sae-pick-coach-line'); const tn = el.firstChild; const s = tn.textContent;
      const h0 = el.getBoundingClientRect().height;
      const r = document.createRange(); const tops = []; const starts = [];
      for (let i = 0; i < s.length; i++) {
        r.setStart(tn, i); r.setEnd(tn, i + 1);
        const rc = r.getClientRects()[0];
        if (!rc || !rc.width) continue;
        const t = Math.round(rc.top);
        if (!tops.length || Math.abs(t - tops[tops.length - 1]) > 4) { tops.push(t); starts.push(i); }
      }
      el.textContent = '';
      starts.forEach((st, k) => { const sp = document.createElement('span'); sp.className = 'a6-line'; sp.textContent = s.slice(st, k + 1 < starts.length ? starts[k + 1] : s.length); el.appendChild(sp); });
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      const keep = new Set(); let n = el; while (n) { keep.add(n); n = n.parentElement; }
      const fold = document.querySelector('details.sae-pick-coach').getBoundingClientRect();
      document.querySelectorAll('body *').forEach((x) => { if (!keep.has(x) && !el.contains(x)) x.style.visibility = 'hidden'; });
      return { in_fold: !!el.closest('details.sae-pick-coach'),
        lines: starts.length, same_layout: Math.abs(b.height - h0) < 0.5, top: b.top, bottom: b.bottom,
        clip_bottom: b.bottom - parseFloat(cs.borderBottomWidth), clip_top: b.top + parseFloat(cs.borderTopWidth), fold_top: fold.top,
        nastaliq: document.documentElement.lang !== 'ur' || document.fonts.check(cs.font, s) };
    });
    const clip = { x: 0, y: Math.max(0, Math.floor(geo.top) - 30), width: 360, height: 0 };
    clip.height = Math.min(640, Math.ceil(geo.bottom) + 40) - clip.y;
    const draw = (k) => p.evaluate((k) => document.querySelectorAll('.a6-line').forEach((sp, i) => { sp.style.color = k === i ? '' : 'transparent'; }), k);
    await draw(-1);
    const none = (await p.screenshot({ clip })).toString('base64');
    const ink = [];
    for (let k = 0; k < geo.lines; k++) {
      await draw(k);
      const one = (await p.screenshot({ clip })).toString('base64');
      ink.push(await p.evaluate(async ([a, b, y0]) => {
        const px = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
        const A = await px(a), B = await px(b);
        const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let top = null, bottom = null;
        for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const i = (y * A.w + x) * 4; if (L(A.d, i) < 120 && L(B.d, i) >= 120) { const cy = y0 + y / 2; if (top == null) top = cy; bottom = cy; } }
        return { top, bottom };
      }, [one, none, clip.y]));
    }
    await ctx.close();
    const last = ink[ink.length - 1];
    const gaps = ink.slice(1).map((x, i) => +(x.top - ink[i].bottom).toFixed(1));
    return Object.assign(geo, { ink, gaps, min_gap: gaps.length ? Math.min.apply(null, gaps) : null,
      below_clip_px: +Math.max(0, last.bottom + 0.5 - geo.clip_bottom).toFixed(1), below_fold_top_px: +Math.max(0, last.bottom + 0.5 - geo.fold_top).toFixed(1),
      first_ink_above_clip_px: +Math.max(0, geo.clip_top - ink[0].top).toFixed(1) });
  }
  const coachInkOf = {};
  const coachInkFor = (lang, fr) => (coachInkOf[lang + fr.name] = coachInkOf[lang + fr.name] || coachInk(lang, fr));
  for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`${lang} [${fr.name}], the coach line (A6): its last line's ink is inside its clip box and nothing of it lies under the fold's box (above the fold, every frame)`, async () => {
      const c = await coachInkFor(lang, fr);
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a5'}_coachline${frSuffix(fr)}_${lang}.json`), JSON.stringify(c, null, 1));
      expect({ in_fold: c.in_fold }).toEqual({ in_fold: false });
      expect({ same_layout: c.same_layout, nastaliq: c.nastaliq, lines_ge_1: c.lines >= 1 }).toEqual({ same_layout: true, nastaliq: true, lines_ge_1: true });
      expect({ below_clip_px: c.below_clip_px, below_fold_top_px: c.below_fold_top_px }).toEqual({ below_clip_px: 0, below_fold_top_px: 0 });
    }, 120000);
    test(`${lang} [${fr.name}], the coach line (A6): at least 2 px of ink between each line and the next`, async () => {
      const c = await coachInkFor(lang, fr);
      c.gaps.forEach((g, i) => expect({ between: [i + 1, i + 2], gap_ge_2: g >= 2, gap: g }).toEqual({ between: [i + 1, i + 2], gap_ge_2: true, gap: g }));
    }, 120000);
  }
  for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`${lang} [${fr.name}], the served battery: listening, after the sound, chosen, Next offered, fold open — nothing scrolls, nothing moves; the letters' ink inside their cards; the coach page's hold-end row meets no tappable`, async () => {
      const r = await states(lang, process.env.SA_PICK_SHOTS || null, fr);
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a5'}_sizes${frSuffix(fr)}_${lang}.json`), JSON.stringify(r, null, 1));
      const at = r.listening;
      // the frame measured is the frame named (A9: the coach page's iframe, the sync dot drawn)
      r.frame = frName(fr);
      expect({ embed: at.frame.embed, sync: at.frame.sync, toggle: at.frame.toggle }).toEqual({ embed: !!fr.embed, sync: !!fr.embed, toggle: !!fr.toggle });
      // the coach page's hold-end row (drawn over the frame) meets no head-row child and no tappable, in any state
      for (const state of ['listening', 'aftersound', 'chosen', 'offernext', 'foldopen']) expect({ state, gated_under_hold: gatedHits(r[state]) }).toEqual({ state, gated_under_hold: [] });
      for (const state of ['listening', 'aftersound', 'chosen', 'offernext', 'foldopen']) expect(Object.assign({ state }, bar(r[state]))).toEqual(Object.assign({ state }, BAR));
      // the coach line stays above the fold on every scored frame; the picker keeps its own top in every frame (the coach
      // page's 64 px rule is scoped off it), never the frame's 64
      for (const state of ['listening', 'aftersound', 'chosen', 'offernext', 'foldopen']) {
        expect({ state, coach_line_at: r[state].coach_line_at }).toEqual({ state, coach_line_at: 'above' });
        expect({ state, pad_top_lt_64: r[state].frame.pad_top < 64 }).toEqual({ state, pad_top_lt_64: true });
        if (lang === 'ur') expect({ state, pad_top: r[state].frame.pad_top }).toEqual({ state, pad_top: 6 });
      }
      expect(/is-pressed/.test(r.chosen.cards[3].cls)).toBe(true);
      expect(r.offernext.next).not.toBeNull();
      expect(r.foldopen.fold.open).toBe(true);
      expect(r.foldopen_events.map((e) => e.type)).toEqual(['fold_open']);
      for (const state of ['listening', 'aftersound', 'chosen', 'offernext', 'foldopen']) {
        const m = r[state];
        expect({ state, coach_line: m.coach_line, nastaliq: m.nastaliq }).toEqual({ state, coach_line: true, nastaliq: true });
        expect({ state, page_h: m.page_h, inner_scroll: m.inner_scroll }).toEqual({ state, page_h: m.vh, inner_scroll: 0 });
        expect(m.cards).toHaveLength(5);
        m.cards.forEach((c, i) => {
          expect({ state, card: i + 1, whole: c.top >= 0 && c.bottom <= m.vh, hit: c.hit }).toEqual({ state, card: i + 1, whole: true, hit: true });
          expect(Math.min(c.w, c.h)).toBeGreaterThanOrEqual(96); // A.3
          // the cards stay where they are (the pressed card's own 3 px press is a transform, not a move)
          const press = state === 'chosen' && i === 3 ? 3 : 0;
          // (sub-pixel: ≤ 0.5 px, the body's centring rounds differently once Next is in the head)
          expect({ state, card: i + 1, moved: Math.abs(c.top - press - at.cards[i].top) > 0.5 || Math.abs(c.left - at.cards[i].left) > 0.5 }).toEqual({ state, card: i + 1, moved: false });
        });
        // the replay pill (A.3: ≥ 64 px tall, ≥ 32 px below the cards) on screen and where it was
        expect({ state, pill_moved: ['top', 'left', 'w', 'h'].some((k) => Math.abs(m.pill[k] - at.pill[k]) > 0.5) }).toEqual({ state, pill_moved: false });
        expect(m.pill.h).toBeGreaterThanOrEqual(64);
        expect(m.pill.top - m.cards_bottom).toBeGreaterThanOrEqual(32);
        expect(m.pill.bottom).toBeLessThanOrEqual(m.vh);
        // no target letter in the fold, open or folded (lead ruling: never on the screen while the item is live)
        expect({ state, target_in_fold: m.fold.target_in_fold }).toEqual({ state, target_in_fold: false });
      }
      // the coach's Next: in the head row, never in the foot, on screen
      const n = r.offernext.next;
      expect({ in_head: n.in_head, foot: n.foot, inside: n.top >= 0 && n.bottom <= r.offernext.vh }).toEqual({ in_head: true, foot: false, inside: true });
      // the open fold: its replay on screen and hit-testable; the fold itself on screen
      expect(r.foldopen.fold.replay).not.toBeNull();
      expect(r.foldopen.fold.replay.hit).toBe(true);
      expect(r.foldopen.fold.bottom).toBeLessThanOrEqual(r.foldopen.cards[0].top);
      // U2: every letter's ink inside its card's clip box, on every served item
      const ink = Object.entries(r.ink);
      expect(ink).toHaveLength(10);
      ink.forEach(([item, cs]) => cs.forEach((c) => expect({ item, card: c.card, letter: c.letter, inside: c.inside }).toEqual({ item, card: c.card, letter: c.letter, inside: true })));
    }, 180000);
  }

  // A9: the English online scored picker (listening), one settled read (fonts ready, two animation frames) at the phone
  // (360×640, dpr 2) and the small phone (320×568, dpr 3): the screen's and the body's own overflow, their scrollTop, the
  // tallest tappable's foot and the scroll cue. The phone is the bar (0 and 0, the cue hidden, every foot inside); the
  // small phone is printed.
  test('en [embed], the scored picker listening: one settled read at 360×640 and 320×568', async () => {
    const fr = FRAMES[0];
    const { html } = page('en', false, frMore(fr), fr);
    const reads = {};
    for (const vp of [{ width: 360, height: 640, dpr: 2 }, { width: 320, height: 568, dpr: 3 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
      const p = await ctx.newPage();
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
        if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
        if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      await p.waitForTimeout(500);
      reads[`${vp.width}x${vp.height}@${vp.dpr}`] = await p.evaluate(() => document.fonts.ready
        .then(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))
        .then(() => {
          const scr = document.querySelector('.sae-screen'); const bd = scr.querySelector('.sae-body');
          const taps = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt, .sae-pick-replay, .sae-pick-next, .sa-next, details.sae-pick-coach > summary, .sae-r8-lang'))
            .filter((k) => k.getBoundingClientRect().height > 0);
          const foot = Math.max.apply(null, taps.map((k) => k.getBoundingClientRect().bottom));
          const c = document.querySelector('.sae-r9-scroll');
          const cue = !!c && c.getBoundingClientRect().height > 0 && getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden';
          return { screen_over: scr.scrollHeight - scr.clientHeight, screen_scrollTop: scr.scrollTop, body_over: bd.scrollHeight - bd.clientHeight, body_scrollTop: bd.scrollTop,
            foot: +foot.toFixed(1), innerHeight: window.innerHeight, cue };
        }));
      await ctx.close();
    }
    if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, 'a9_settled_en_online.json'), JSON.stringify(reads, null, 1));
    const ph = reads['360x640@2'];
    expect({ screen_over: ph.screen_over, body_over: ph.body_over, screen_scrollTop: ph.screen_scrollTop, body_scrollTop: ph.body_scrollTop, cue: ph.cue, foot_inside: ph.foot <= ph.innerHeight - 8 })
      .toEqual({ screen_over: 0, body_over: 0, screen_scrollTop: 0, body_scrollTop: 0, cue: false, foot_inside: true });
  }, 120000);

  /**
   * A7: the practice screens, coach-led, with the production layout switches (S2: the Urdu example had 73 px of inner
   * scroll and 2 of 5 cards hit-testable, on the MODELLED example). P1 (role example): before the model (its sound
   * playing), then `model` — modelled, Jugnu's hand on the model letter, its own Next pill (sae-pick-next) present —
   * with the fold closed, open (the sound and the letter «لَ → ل» on it) and closed again. P2 (role practice): its
   * sound, after it, a wrong tap's feedback, the retry (the same item again), the fold open and closed, the second
   * wrong tap's feedback (the right card shown); `right` (a second walk): wrong, the retry, then the right card.
   * The served practice of the served battery, as the coach meets it.
   */
  async function practiceStates(lang, shots, right, more, vp, fr) {
    const out = {};
    more = frMore(fr, more);
    const { html } = page(lang, true, more, fr);
    const ctx = await browser.newContext({ viewport: vp || { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const tag = process.env.SA_PICK_SHOT_TAG || 'a7';
    const snap = async (name, wait) => {
      if (wait !== 0) await p.waitForTimeout(wait || 250);
      out[name] = await p.evaluate(measure);
      if (shots) await p.screenshot({ path: path.join(shots, `${tag}_practice_${name}${more && more.r9SkipInstructions ? '_skip' : ''}${frSuffix(fr)}_${lang}_${vp ? 'tablet' : 'phone'}_coach.png`) });
    };
    const endAll = async () => { for (let k = 0; k < 8 && (await p.evaluate(() => window.__end())); k++) await p.waitForTimeout(150); };
    const label = async () => { const s = await p.evaluate(() => { const b = document.querySelector('details.sae-pick-coach > summary').getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }); await p.mouse.click(lang === 'ur' ? s.r - 30 : s.l + 30, (s.t + s.b) / 2); };
    const card = async (k) => { const c = await p.evaluate((k) => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[k].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, k); await p.mouse.click(c.x, c.y); };
    const wrong = () => p.evaluate(() => { const v = window.__runner.view(); return v.practice.options.findIndex((o) => String(o) !== String(v.practice.target)); });
    if (!right) await snap('p1_listening', 0);
    for (let k = 0; k < 10 && !(await p.evaluate(() => !!document.querySelector('.sae-pick-next'))); k++) { await endAll(); await p.waitForTimeout(300); }
    if (!right) {
      await snap('model');
      await label();
      await snap('model_foldopen', 350);
      await label();
      await snap('model_foldclosed', 450); // past the ghost guard
    }
    await p.click('.sae-pick-next');
    await p.waitForTimeout(500);
    // the served r10_practice_next holds the LAST feedback only while Jugnu's line is said, then the Ready screen
    // follows: the two last states are read with that line held open (window.__holdLines), as a child sees them
    const holdLines = () => p.evaluate(() => { window.__holdLines = true; });
    if (right) {
      await endAll(); await p.waitForTimeout(250);
      await card(await wrong()); await p.waitForTimeout(1600); await endAll(); await p.waitForTimeout(250);
      await holdLines();
      await card(await p.evaluate(() => { const v = window.__runner.view(); return v.practice.options.findIndex((o) => String(o) === String(v.practice.target)); }));
      await snap('p2_feedback_right', 150);
      await ctx.close();
      return out;
    }
    await snap('p2_listening', 0);
    await endAll();
    await snap('p2_aftersound');
    await card(await wrong());
    await snap('p2_feedback', 150); // the feedback line (try again), inside FEEDBACK_MS
    await p.waitForTimeout(1600);
    await endAll();
    await snap('p2_retry');
    await label();
    await snap('p2_foldopen', 350);
    await label();
    await snap('p2_foldclosed', 450);
    await holdLines();
    await card(await wrong());
    await snap('p2_feedback_shown', 150); // the second wrong tap: the right card shown, while Jugnu's line is said
    await ctx.close();
    return out;
  }
  for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`${lang} [${fr.name}], the served practice (A7): P1 and P2, the feedback, the retry, the fold open and closed — nothing scrolls, all five cards hit-testable, nothing moves; the coach page's hold-end row meets no tappable`, async () => {
      const r = await practiceStates(lang, process.env.SA_PICK_SHOTS || null, false, null, null, fr);
      Object.assign(r, await practiceStates(lang, process.env.SA_PICK_SHOTS || null, true, null, null, fr));
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a7'}_practice_sizes${frSuffix(fr)}_${lang}.json`), JSON.stringify(r, null, 1));
      r.frame = frName(fr);
      expect({ embed: r.p1_listening.frame.embed, sync: r.p1_listening.frame.sync, toggle: r.p1_listening.frame.toggle }).toEqual({ embed: !!fr.embed, sync: !!fr.embed, toggle: !!fr.toggle });
      // the last feedback (the right card shown; the right tap): under the served r10_practice_next the last answer waits
      // for Jugnu's line only, and coach-led Jugnu says nothing, so the Ready screen follows at once and the picker is
      // gone — that screen is read for its own fit; where the picker is held, it is read as every other state
      const SHOWN = ['p2_feedback_shown', 'p2_feedback_right'];
      const held = (s) => r[s].cards.length > 0;
      const LIVE = ['p1_listening', 'model', 'model_foldopen', 'model_foldclosed', 'p2_listening', 'p2_aftersound', 'p2_feedback', 'p2_retry', 'p2_foldopen', 'p2_foldclosed'].concat(SHOWN.filter(held));
      // A9: the coach line above the fold on every practice frame; the picker's own top on every frame
      const ALL9 = LIVE;
      expect(ALL9.map((s) => ({ s, gated_under_hold: gatedHits(r[s]) }))).toEqual(ALL9.map((s) => ({ s, gated_under_hold: [] })));
      expect(ALL9.map((s) => Object.assign({ s }, bar(r[s])))).toEqual(ALL9.map((s) => Object.assign({ s }, BAR)));
      expect(ALL9.map((s) => ({ s, at: r[s].coach_line_at, pad_top_lt_64: r[s].frame.pad_top < 64 }))).toEqual(ALL9.map((s) => ({ s, at: 'above', pad_top_lt_64: true })));
      if (lang === 'ur') expect(ALL9.map((s) => ({ s, pad_top: r[s].frame.pad_top }))).toEqual(ALL9.map((s) => ({ s, pad_top: 6 })));
      // the Ready screen that took the last feedback's place: the phone itself never scrolls, nothing of it under the hold
      SHOWN.filter((s) => !held(s)).forEach((s) => expect({ s, phase: r[s].view.phase, page_h: r[s].page_h, inner_scroll: r[s].inner_scroll, hold_hits: r[s].hold_hits.map((x) => x.cls) }).toEqual({ s, phase: 'ready', page_h: 640, inner_scroll: 0, hold_hits: [] }));
      const P0 = ['p1_listening'];
      const P1 = ['model', 'model_foldopen', 'model_foldclosed'];
      const P2 = ['p2_listening', 'p2_aftersound', 'p2_feedback', 'p2_retry', 'p2_foldopen', 'p2_foldclosed'].concat(SHOWN.filter(held));
      // the walk reached every state it names
      P0.concat(P1).forEach((s) => expect({ s, practice: r[s].view.practice }).toEqual({ s, practice: `${lang}.letter_pick10.p1` }));
      P2.forEach((s) => expect({ s, practice: r[s].view.practice || r[s].view.phase }).toEqual({ s, practice: /^p2_feedback_(shown|right)$/.test(s) ? 'ready' : `${lang}.letter_pick10.p2` }));
      SHOWN.forEach((s) => expect({ s, phase: r[s].view.phase }).toEqual({ s, phase: 'ready' }));
      // the modelled example: its own Next pill (the practice's Next, in the child's register) present, in every fold state
      P1.forEach((s) => expect({ s, next_pill: !!r[s].next && r[s].next.foot }).toEqual({ s, next_pill: true }));
      expect({ p1: r.model_foldopen.fold.open, p2: r.p2_foldopen.fold.open, p1c: r.model_foldclosed.fold.open, p2c: r.p2_foldclosed.fold.open }).toEqual({ p1: true, p2: true, p1c: false, p2c: false });
      expect(r.p2_feedback.fb).not.toBeNull();
      SHOWN.filter(held).forEach((s) => expect({ s, fb: r[s].fb }).not.toEqual({ s, fb: null }));
      // the practice fold keeps the sound and the letter (ruled), readable
      for (const s of ['model_foldopen', 'p2_foldopen']) {
        const f = r[s].fold_line;
        expect({ s, line: f && f.visible, arrow: !!f && f.text.includes('→') }).toEqual({ s, line: true, arrow: true });
        expect(f.font_px).toBeGreaterThanOrEqual(22); // as A4 laid it (22 px); never smaller
      }
      // every state at a glance (S2's failing cell first: the modelled example, 73 px of inner scroll, 2 of 5 cards)
      const glance = (m) => ({ page_h: m.page_h, inner_scroll: m.inner_scroll, cards_hit: m.cards.filter((c) => c.hit && c.top >= 0 && c.bottom <= m.vh).length });
      const all = P1.concat(P0, P2);
      SHOWN.filter((s) => !held(s)).forEach((s) => expect({ s, page_h: r[s].page_h, inner_scroll: r[s].inner_scroll }).toEqual({ s, page_h: 640, inner_scroll: 0 }));
      expect(all.map((s) => Object.assign({ s }, glance(r[s])))).toEqual(all.map((s) => ({ s, page_h: 640, inner_scroll: 0, cards_hit: 5 })));
      for (const [set, at] of [[P1, r.model], [P0, r.p1_listening], [P2, r.p2_listening]]) {
        for (const state of set) {
          const m = r[state];
          expect({ state, page_h: m.page_h, inner_scroll: m.inner_scroll }).toEqual({ state, page_h: m.vh, inner_scroll: 0 });
          expect(m.cards).toHaveLength(5);
          m.cards.forEach((c, i) => {
            expect({ state, card: i + 1, whole: c.top >= 0 && c.bottom <= m.vh, hit: c.hit }).toEqual({ state, card: i + 1, whole: true, hit: true });
            expect({ state, card: i + 1, w: c.w, h: c.h }).toEqual({ state, card: i + 1, w: at.cards[i].w, h: at.cards[i].h });
            expect(Math.min(c.w, c.h)).toBeGreaterThanOrEqual(96);
            expect({ state, card: i + 1, moved: Math.abs(c.top - at.cards[i].top) > 0.5 || Math.abs(c.left - at.cards[i].left) > 0.5 }).toEqual({ state, card: i + 1, moved: false });
          });
          if (m.next) expect({ state, next_inside: m.next.top >= 0 && m.next.bottom <= m.vh }).toEqual({ state, next_inside: true });
          // the feedback line on screen, its words whole inside its own box (one line, nothing spilling past its pill)
          if (m.fb) expect({ state, fb_inside: m.fb.top >= 0 && m.fb.bottom <= m.vh && m.fb.left >= 0 && m.fb.right <= 360, fb_whole: m.fb.whole }).toEqual({ state, fb_inside: true, fb_whole: true });
          if (set === P2) {
            // the replay pill (A.3: ≥ 64 px tall, ≥ 32 px below the cards) on screen and where it was
            expect({ state, pill_moved: ['top', 'left', 'w', 'h'].some((k) => Math.abs(m.pill[k] - at.pill[k]) > 0.5) }).toEqual({ state, pill_moved: false });
            expect(m.pill.h).toBeGreaterThanOrEqual(64);
            expect(m.pill.top - m.cards_bottom).toBeGreaterThanOrEqual(32);
            expect({ state, pill_inside: m.pill.bottom <= m.vh }).toEqual({ state, pill_inside: true });
          }
        }
      }
    }, 180000);
  }

  /**
   * A8: the coach's Skip instructions (sa_r9_skip_instructions, ON on every tier) is served on the coach-led practice
   * screens, in the head row beside Jugnu and the chip; A7's feedback line joins that row while it shows. With it in the
   * served set, in every practice state: every head-row child inside 0–360, whole (its own scroll box) and hit-testable
   * at its centre, inside the 64 px row; the row's own scrollWidth ≤ clientWidth; the Skip at ONE rect on every screen it
   * is drawn on, ≤ 20 code points, ≥ 48 px tall, one line at its served font; in the try-again window (practice going on, the feedback showing) the Skip
   * is not drawn and the feedback line takes the chip's slot; the feedback line whole at ≥ 15 px; the cards, the replay
   * pill, the Next pill and the fold where the same walk without the Skip puts them; 640 / 0 / 5 of 5.
   */
  const A8_STATES = ['p1_listening', 'model', 'model_foldopen', 'model_foldclosed', 'p2_listening', 'p2_aftersound', 'p2_feedback', 'p2_retry', 'p2_foldopen', 'p2_foldclosed', 'p2_feedback_shown', 'p2_feedback_right'];
  const a8TryAgain = (m) => m.view.phase === 'practice' && !!m.fb;
  for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`${lang} [${fr.name}], the served practice with the coach's Skip (A8): every head-row child inside the phone and hit-testable, the Skip in one place, the feedback line whole, nothing below moves`, async () => {
      const more = { r9SkipInstructions: true };
      const r = await practiceStates(lang, process.env.SA_PICK_SHOTS || null, false, more, null, fr);
      Object.assign(r, await practiceStates(lang, process.env.SA_PICK_SHOTS || null, true, more, null, fr));
      const base = await practiceStates(lang, null, false, { r9SkipInstructions: false }, null, fr);
      Object.assign(base, await practiceStates(lang, null, true, { r9SkipInstructions: false }, null, fr));
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a8'}_practice_skip_sizes${frSuffix(fr)}_${lang}.json`), JSON.stringify({ skip: r, no_skip: base }, null, 1));
      // the last feedback states: the picker where the served set holds it, else the Ready screen that follows at once
      // (the served r10_practice_next, coach-led: no line to wait for), read for its own fit only
      const heldA8 = (s) => r[s].cards.length > 0;
      const all = A8_STATES.filter((s) => !/^p2_feedback_(shown|right)$/.test(s) || heldA8(s));
      A8_STATES.filter((s) => !all.includes(s)).forEach((s) => expect({ s, phase: r[s].view.phase, page_h: r[s].page_h, inner_scroll: r[s].inner_scroll, hold_hits: r[s].hold_hits.map((x) => x.cls), skip: !!r[s].skip }).toEqual({ s, phase: 'ready', page_h: 640, inner_scroll: 0, hold_hits: [], skip: false }));
      // the Skip: drawn on every practice screen but the try-again window; never on the held last feedback (phase ready)
      const want = (m) => (m.view.phase === 'practice' && !a8TryAgain(m) ? 'drawn' : 'absent');
      const row = (m) => ({
        head_h: m.head && Math.round(m.head.h), over_x: m.head && m.head.over_x,
        out: m.head ? m.head.kids.filter((k) => k.left < -0.5 || k.right > 360.5 || k.left < m.head.left - 0.5 || k.right > m.head.right + 0.5 || k.top < m.head.top - 0.5 || k.bottom > m.head.bottom + 0.5).map((k) => k.cls) : null,
        clipped: m.head ? m.head.kids.filter((k) => k.clip).map((k) => k.cls) : null,
        not_hit: m.head ? m.head.kids.filter((k) => !k.hit).map((k) => k.cls) : null,
        jugnu: m.head ? m.head.kids.filter((k) => /jugnu/.test(k.cls)).map((k) => `${Math.round(k.w)}x${Math.round(k.h)}`).join() : null,
        skip: m.skip ? (m.skip.in_head && m.skip.hit && !m.skip.clip ? 'drawn' : 'drawn-broken') : 'absent',
        chip_with_fb: a8TryAgain(m) ? m.head.kids.some((k) => k.cls === 'sae-chip') : 'n/a',
        fb: m.fb ? m.fb.whole && m.fb.top >= 0 && m.fb.bottom <= m.vh && m.fb.left >= 0 && m.fb.right <= 360 && m.fb.font_px >= 15 : 'none',
        page_h: m.page_h, inner_scroll: m.inner_scroll, cards_hit: m.cards.filter((c) => c.hit && c.top >= 0 && c.bottom <= m.vh).length,
      });
      expect(all.map((s) => Object.assign({ s }, row(r[s])))).toEqual(all.map((s) => ({
        s, head_h: 64, over_x: 0, out: [], clipped: [], not_hit: [], jugnu: '64x64', skip: want(r[s]), chip_with_fb: a8TryAgain(r[s]) ? false : 'n/a', fb: r[s].fb ? true : 'none', page_h: 640, inner_scroll: 0, cards_hit: 5,
      })));
      // the Skip at ONE rect on every screen it is drawn on (the coach's thumb learns it once)
      const drawn = all.filter((s) => want(r[s]) === 'drawn');
      expect(all.map((s) => ({ s, gated_under_hold: gatedHits(r[s]) }))).toEqual(all.map((s) => ({ s, gated_under_hold: [] })));
      expect(all.map((s) => Object.assign({ s }, bar(r[s])))).toEqual(all.map((s) => Object.assign({ s }, BAR)));
      expect(drawn).toEqual(['p1_listening', 'model', 'model_foldopen', 'model_foldclosed', 'p2_listening', 'p2_aftersound', 'p2_retry', 'p2_foldopen', 'p2_foldclosed']);
      // its place in the row (left, width, height, offset from the row's top) is one; the row itself moves only with the
      // body's ruled re-centring (the cards' own once-per-group shift, A7 / O-32), so within each group its rect is one
      const at = (s) => [r[s].skip.left, r[s].skip.w, r[s].skip.h, r[s].skip.top - r[s].head.top].map((x) => x.toFixed(1)).join();
      expect(drawn.map((s) => ({ s, at: at(s) }))).toEqual(drawn.map((s) => ({ s, at: at(drawn[0]) })));
      for (const g of [['p1_listening'], ['model', 'model_foldopen', 'model_foldclosed'], ['p2_listening', 'p2_aftersound', 'p2_retry', 'p2_foldopen', 'p2_foldclosed']]) {
        const rect = (s) => [r[s].skip.top, r[s].skip.left, r[s].skip.w, r[s].skip.h].map((x) => x.toFixed(1)).join();
        expect(g.map((s) => ({ s, rect: rect(s) }))).toEqual(g.map((s) => ({ s, rect: rect(g[0]) })));
        // the row moves exactly as the cards do between groups (never on its own)
        const dy = (s) => +(r[s].head.top - r[s].cards[0].top).toFixed(1);
        expect(drawn.map((s) => ({ s, head_to_cards: dy(s) }))).toEqual(drawn.map((s) => ({ s, head_to_cards: dy(drawn[0]) })));
      }
      // one line, the served label and font (UR 20 px / EN 18 px), no ellipsis, no clip, ≥ 48 px tall, whole and hit
      drawn.forEach((s) => {
        const k = r[s].skip;
        expect({ s, text: k.text, lines: k.lines, font_px: k.font_px, ellipsis: k.ellipsis, clip: k.clip, tall: k.h >= 48, hit: k.hit })
          .toEqual({ s, text: lang === 'ur' ? 'ہدایات چھوڑیں' : 'Skip instructions', lines: 1, font_px: lang === 'ur' ? 20 : 18, ellipsis: false, clip: false, tall: true, hit: true });
        expect(k.cp).toBeLessThanOrEqual(20);
      });
      for (const s of all) {
        const m = r[s], b = base[s];
        expect({ s, view: m.view }).toEqual({ s, view: b.view }); // the same walk
        // nothing below the head moves for the Skip: the cards, the replay pill, the Next pill, the fold
        const pos = (x) => x && { top: x.top, left: x.left, w: x.w, h: x.h };
        const near = (a, c) => (a == null || c == null ? a === c : ['top', 'left', 'w', 'h'].every((k) => Math.abs(a[k] - c[k]) <= 0.5));
        m.cards.forEach((c, i) => expect({ s, card: i + 1, same: near(pos(c), pos(b.cards[i])) }).toEqual({ s, card: i + 1, same: true }));
        expect({ s, pill: near(pos(m.pill), pos(b.pill)), next: near(pos(m.next), pos(b.next)), fold: near(pos(m.fold), pos(b.fold)) }).toEqual({ s, pill: true, next: true, fold: true });
        if (b.fb) expect({ s, text: m.fb && m.fb.text, font_ok: !!m.fb && m.fb.font_px >= 15 }).toEqual({ s, text: b.fb.text, font_ok: true });
      }
    }, 300000);
  }
  // A11 (sa_r28_toggle_fit, lead rulings 022259Z / 021932Z): online (the coach page's frame, the toggle drawn), the toggle's
  // 56 px button in a 44 px top bar, 6 px over it above and below; every head-row tappable and the first card row clear
  // of the toggle's hit rect by the measured gap (never sharing a pixel: ⛔), and every A9 bar unchanged (the pill and
  // the practice Next whole and hit, nothing scrolls, five cards hit, no cue). The floors are the measured gaps at the
  // chosen g (A11_FLOOR, px edge to edge); under 24 = ⚠ with the number (the fit bars hold no more room).
  const A11_ON = { r28ToggleFit: true };
  const A11_FLOOR = { ur: { scored: 11.5, practice: 22 }, en: { scored: 16, practice: 22 } }; // g: UR 1 / 16, EN 8 / 20 (⚠: 24 is past the bars)
  for (const lang of ['ur', 'en']) {
    test(`${lang} [toggle, no frame + sa_r28_toggle_fit] (A11): the toggle in a 44 px bar, its 56 px hit centred; no head-row tappable meets it; the picker's bars hold`, async () => {
      // A12: inside the coach page's frame the coach-led picker draws no toggle, so the toggle's fit is read where it is
      // drawn: the same screen with the other language's battery on the phone and no frame (the picker's own top, as A9)
      const fr = { name: 'toggle_bare', embed: false, toggle: true };
      const shots = process.env.SA_PICK_SHOTS || null;
      const sc = await states(lang, shots, fr, A11_ON);
      const pr = await practiceStates(lang, shots, false, A11_ON, null, fr);
      Object.assign(pr, await practiceStates(lang, shots, true, A11_ON, null, fr));
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `a11_sizes_${lang}.json`), JSON.stringify({ scored: sc, practice: pr }, null, 1));
      const cells = [].concat(['listening', 'aftersound', 'chosen', 'offernext', 'foldopen'].map((s) => ['scored', s, sc[s]]), A8_STATES.filter((s) => pr[s].cards.length > 0).map((s) => ['practice', s, pr[s]]));
      // the Ready screen that takes the last feedback's place (served r10_practice_next, coach-led) is not the picker's: read for its own fit
      A8_STATES.filter((s) => !pr[s].cards.length).forEach((s) => expect({ s, phase: pr[s].view.phase, page_h: pr[s].page_h, inner_scroll: pr[s].inner_scroll }).toEqual({ s, phase: 'ready', page_h: 640, inner_scroll: 0 }));
      const row = ([cls, s, m]) => ({ s: cls + '.' + s, top_h: m.a11.top_h, toggle_h: m.a11.toggle_h, over_below: m.a11.over_below, over_above: m.a11.over_above,
        overlap: m.a11.taps.filter((x) => x.gap < 0).map((x) => x.cls), cards_clear: m.a11.min_cards > 0, floor: m.a11.min_tap >= A11_FLOOR[lang][cls],
        inner_scroll: m.inner_scroll, cards_hit: m.cards.filter((c) => c.hit && c.top >= 0 && c.bottom <= m.vh).length, bar: bar(m) });
      expect(cells.map(row)).toEqual(cells.map(([cls, s]) => ({ s: cls + '.' + s, top_h: 44, toggle_h: 56, over_below: 6, over_above: 6, overlap: [], cards_clear: true, floor: true,
        inner_scroll: 0, cards_hit: 5, bar: BAR })));
    }, 400000);
  }
  // A12 (lead/panel 0508Z: form (b)): inside the coach page's frame the coach page draws TWO buttons at its top start
  // corner (End test + End this section, 8 + 48 px); the picker keeps its own top (A9), so its language toggle sat under
  // the second one (UR 48.8 × 48, EN 69 × 48 px, the real coach page). The toggle at the top bar's end side cannot clear
  // the row's full width (UR 154.7 / EN 159.1 px wide; free beside the row ≈ 106 / 98), so the coach-led picker draws no
  // toggle inside the frame (the coach switches language before the task); every A9 bar unchanged.
  for (const lang of ['ur', 'en']) {
    test(`${lang} [embed] (A12): the coach-led picker draws no language toggle under the coach page's two buttons, scored and practice; the picker's bars hold`, async () => {
      const fr = FRAMES[0];
      const sc = await states(lang, null, fr);
      const pr = await practiceStates(lang, null, false, null, null, fr);
      Object.assign(pr, await practiceStates(lang, null, true, null, null, fr));
      const cells = [].concat(['listening', 'aftersound', 'chosen', 'offernext', 'foldopen'].map((s) => ['scored', s, sc[s]]), A8_STATES.map((s) => ['practice', s, pr[s]]));
      // any-rect overlap of the toggle's box with each of the coach's buttons (the hold stand-in's children), px x px
      const over = (t, b) => { const x = Math.min(t.right, b.right) - Math.max(t.left, b.left), y = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top); return x > 0 && y > 0 ? +(x * y).toFixed(1) : 0; };
      const row = ([cls, s, m]) => ({ s: cls + '.' + s, buttons: m.hold ? m.hold.buttons.length : 0,
        toggle_drawn: !!m.toggle && m.toggle.w > 0 && m.toggle.h > 0,
        toggle_under_buttons: m.toggle && m.hold ? m.hold.buttons.map((b) => over(m.toggle, b)) : [0, 0],
        top_h: m.top_h, inner_scroll: m.inner_scroll, cards_hit: m.cards.filter((c) => c.hit && c.top >= 0 && c.bottom <= m.vh).length, bar: bar(m) });
      expect(cells.map(row)).toEqual(cells.map(([cls, s]) => ({ s: cls + '.' + s, buttons: 2, toggle_drawn: false, toggle_under_buttons: [0, 0],
        top_h: 44, inner_scroll: 0, cards_hit: 5, bar: BAR })));
    }, 400000);
  }
  // A12 fixup (lead 053757Z): RDF auto (no coach-led marker) draws the toggle too whenever the other language's battery
  // is on the phone, and the coach page draws End this section there as well (sa_r20_auto_end_section): the picker's
  // practice and item screens draw no toggle inside the frame in either mode; its intro screen keeps it.
  for (const lang of ['ur', 'en']) {
    test(`${lang} [embed, RDF auto] (A12): the child's picker draws no language toggle under the coach page's two buttons on its practice and item screens; the intro screen keeps it`, async () => {
      const over = (t, b) => { const x = Math.min(t.right, b.right) - Math.max(t.left, b.left), y = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top); return x > 0 && y > 0 ? +(x * y).toFixed(1) : 0; };
      const read = async (keepPractice, brief) => {
        const fr = { name: 'embed_auto', embed: true, toggle: true, auto: true, brief };
        const { html } = page(lang, keepPractice, frMore(fr), fr);
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
        const p = await ctx.newPage();
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
          if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
          if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
          return route.fulfill({ status: 404, body: '' });
        });
        await p.goto('http://sa.test/');
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(500);
        const m = await p.evaluate(() => {
          const t = document.querySelector('.sae-screen .sae-r8-lang'); const hb = document.getElementById('a9-hold'); const scr = document.querySelector('.sae-screen');
          const R = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
          const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
          const cards = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt')).map((c) => { const b = c.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && e.closest('.sae-opt') === c && b.bottom <= innerHeight; });
          return { pick: !!document.querySelector('.sae-screen.sae-pick'), coach_led: !!document.querySelector('.sae-screen.is-coach-led'), toggle: t ? R(t) : null,
            buttons: hb ? Array.from(hb.children).map(R) : [], inner: over(scr) + over(scr && scr.querySelector('.sae-body')), cards_hit: cards.filter(Boolean).length, cards: cards.length };
        });
        await ctx.close();
        return { pick: m.pick, coach_led: m.coach_led, toggle_drawn: !!m.toggle && m.toggle.w > 0 && m.toggle.h > 0,
          under: m.toggle ? m.buttons.map((b) => over(m.toggle, b)) : [], inner: m.inner, cards_hit: m.cards_hit + '/' + m.cards };
      };
      const item = await read(false, false);
      const practice = await read(true, false);
      const intro = await read(true, true);
      // the RDF-auto practice screen's own fit (inner UR 11 / EN 17 px, the same with the toggle drawn) is not this row's:
      // printed, not asserted
      console.log('A12 RDF auto', lang, JSON.stringify({ item, practice, intro }));
      delete practice.inner;
      expect({ item, practice }).toEqual({ item: { pick: true, coach_led: false, toggle_drawn: false, under: [0, 0], inner: 0, cards_hit: '5/5' },
        practice: { pick: true, coach_led: false, toggle_drawn: false, under: [0, 0], cards_hit: '5/5' } });
      expect({ intro_pick: intro.pick, intro_toggle_drawn: intro.toggle_drawn }).toEqual({ intro_pick: false, intro_toggle_drawn: true });
    }, 120000);
  }
  test('ur and en, the tablet (800×1280), with the coach\'s Skip (A8): the practice feedback state holds the cards, nothing scrolls, the feedback line whole; the Skip served before it', async () => {
    const out = {};
    for (const lang of ['ur', 'en']) {
      const st = await practiceStates(lang, process.env.SA_PICK_SHOTS || null, false, { r9SkipInstructions: true }, { width: 800, height: 1280 });
      const m = st.p2_feedback, a = st.p2_aftersound;
      out[lang] = { p2_aftersound: a, p2_feedback: m };
      // A9: the tablet keeps the coach line above the fold (means (a) is the coach-led PHONE's)
      expect({ lang, coach_line_at: m.coach_line_at }).toEqual({ lang, coach_line_at: 'above' });
      expect({ lang, cards_bottom_ok: m.cards_bottom <= 1280, inner_scroll: m.inner_scroll, page_h: m.page_h, cards_hit: m.cards.filter((c) => c.hit && c.top >= 0 && c.bottom <= m.vh).length, fb_whole: !!m.fb && m.fb.whole, skip_before: !!a.skip && a.skip.hit })
        .toEqual({ lang, cards_bottom_ok: true, inner_scroll: 0, page_h: 1280, cards_hit: 5, fb_whole: true, skip_before: true });
    }
    if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a8'}_practice_skip_tablet.json`), JSON.stringify(out, null, 1));
  }, 300000);

  /**
   * A9: the coach brief (the instruction screen, coach-led) on the phone: its body may scroll by design under ur_fit; its
   * foot must not: both foot buttons (hand over, the coach's Skip) whole inside the phone and hit at their centre.
   */
  async function briefState(lang, fr) {
    const { html } = page(lang, true, frMore(fr), Object.assign({}, fr, { brief: true }));
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const scr = document.querySelector('.sae-coach-brief'); const body = scr && scr.querySelector('.sae-body');
      const btns = Array.from(document.querySelectorAll('.sae-coach-brief .sae-foot button')).map((k) => {
        const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        return Object.assign(R(k), { text: k.textContent.trim(), hit: !!e && (e === k || k.contains(e)), whole: b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth });
      });
      const hb = document.getElementById('a9-hold'); const a = hb && hb.getBoundingClientRect();
      const meets = (k) => { const b = k.getBoundingClientRect(); return !!a && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; };
      return { vh: window.innerHeight, page_h: document.documentElement.scrollHeight, brief: !!scr, hold: hb ? R(hb) : null,
        hold_hits: Array.from(document.querySelectorAll('.sae-coach-brief button, .sae-coach-brief .sae-chip, .sae-coach-brief .sae-h1')).filter(meets).map((k) => k.textContent.trim()),
        foot_under_hold: Array.from(document.querySelectorAll('.sae-coach-brief .sae-foot button')).filter(meets).map((k) => k.textContent.trim()),
        frame: { toggle: !!document.querySelector('.sae-screen .sae-r8-lang'), embed: document.querySelector('.sae').classList.contains('is-embed'), sync: !!document.querySelector('.sae-sync'), pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null },
        screen: scr && R(scr), body_scroll: body ? Math.max(0, body.scrollHeight - body.clientHeight) : null, foot: scr && scr.querySelector('.sae-foot') ? R(scr.querySelector('.sae-foot')) : null, buttons: btns };
    });
    if (process.env.SA_PICK_SHOTS) await p.screenshot({ path: path.join(process.env.SA_PICK_SHOTS, `${process.env.SA_PICK_SHOT_TAG || 'a9'}_brief${frSuffix(fr)}_${lang}_phone_coach.png`) });
    await ctx.close();
    return m;
  }
  for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`${lang} [${fr.name}], the coach brief (A9): both foot buttons whole inside the phone and hit at their centre; the page itself never scrolls`, async () => {
      const m = await briefState(lang, fr);
      if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a9'}_brief${frSuffix(fr)}_${lang}.json`), JSON.stringify(m, null, 1));
      m.frame_name = frName(fr);
      expect({ brief: m.brief, embed: m.frame.embed, sync: m.frame.sync, page_h: m.page_h, foot_under_hold: m.foot_under_hold }).toEqual({ brief: true, embed: !!fr.embed, sync: !!fr.embed, page_h: m.vh, foot_under_hold: [] });
      if (fr.embed) expect({ lang, pad_top: m.frame.pad_top }).toEqual({ lang, pad_top: 64 }); // the frame's room reaches the picker's brief (its r28 marker), either language
      expect(m.buttons.length).toBe(fr.embed ? 2 : 1); // hand over (+ the coach's Skip, r9_skip_instructions, in the production set)
      m.buttons.forEach((b) => expect({ text: b.text, whole: b.whole, hit: b.hit }).toEqual({ text: b.text, whole: true, hit: true }));
    }, 120000);
  }

  /**
   * A9: the coach page's frame room per screen class per frame (computed padding-top, 360 px wide): the letter picker
   * keeps its own top in every frame; round 28's other coach-led screens (the spoken MCQ, the coach brief) take the
   * frame's room by the frame alone, either language (24 under the sync dot, 64 in the iframe); the child's instruction
   * screen stays under the language-keyed rules (its numbers are as today).
   */
  test('ur and en, every frame: the frame room per screen class (picker its own; MCQ and brief 24 / 64 by the frame; the instruction screen as before)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const p = await ctx.newPage();
    await p.setContent(`<!doctype html><html><head><style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body></body></html>`);
    const got = await p.evaluate(() => {
      const SCREENS = { picker: 'sae-screen sae-run sae-run-tap sae-pick is-coach-led', picker_practice: 'sae-screen sae-practice sae-pick is-coach-led', mcq: 'sae-screen sae-mcq', brief: 'sae-screen sae-coach-brief is-coach is-r28-brief', brief_pre: 'sae-screen sae-coach-brief is-coach', instr: 'sae-screen sae-instr' };
      const FR = { online: { embed: true, sync: true, toggle: true }, offline: { embed: true, sync: true, toggle: false }, sync_only: { embed: false, sync: true, toggle: false }, bare: { embed: false, sync: false, toggle: false } };
      const out = {};
      for (const lang of ['ur', 'en']) for (const [f, o] of Object.entries(FR)) for (const [k, cls] of Object.entries(SCREENS)) {
        const root = document.createElement('div');
        root.className = 'sae is-ur-fit is-r8-lang' + (o.embed ? ' is-embed' : ''); root.setAttribute('lang', lang);
        root.innerHTML = (o.sync ? '<span class="sae-sync"></span>' : '') + `<div class="${cls}"><div class="sae-top">${o.toggle ? '<button class="sae-r8-lang"><span lang="ur">اردو</span></button>' : ''}</div><div class="sae-body">${k === 'mcq' ? '<div class="sae-mcq-coach"></div>' : ''}</div></div>`;
        document.body.appendChild(root);
        out[`${lang}.${f}.${k}`] = parseFloat(getComputedStyle(root.querySelector('.sae-screen')).paddingTop);
        root.remove();
      }
      return out;
    });
    await ctx.close();
    if (process.env.SA_PICK_SIZES) fs.writeFileSync(path.join(process.env.SA_PICK_SIZES, `${process.env.SA_PICK_SHOT_TAG || 'a9'}_frame_room.json`), JSON.stringify(got, null, 1));
    for (const lang of ['ur', 'en']) {
      const own = got[`${lang}.bare.picker`], ownP = got[`${lang}.bare.picker_practice`];
      for (const f of ['online', 'offline', 'sync_only']) {
        expect({ lang, f, picker: got[`${lang}.${f}.picker`], picker_practice: got[`${lang}.${f}.picker_practice`] }).toEqual({ lang, f, picker: own, picker_practice: ownP });
        const room = f === 'sync_only' ? 24 : 64;
        expect({ lang, f, mcq: got[`${lang}.${f}.mcq`], brief: got[`${lang}.${f}.brief`] }).toEqual({ lang, f, mcq: room, brief: room });
      }
    }
    if (got['ur.bare.picker'] !== 6) throw new Error('the Urdu picker keeps 6 px: ' + got['ur.bare.picker']);
    // the pre-round-28 coach brief (every coach-led task's brief, no r28 marker: the switches OFF) is not under round 28's
    // frame room: an English brief with no Urdu on it keeps its own top (the bare frame's) in the coach page's frame and
    // under the dot
    for (const f of ['offline', 'sync_only']) expect({ f, en_brief_pre: got[`en.${f}.brief_pre`] }).toEqual({ f, en_brief_pre: got['en.bare.brief_pre'] });
  }, 60000);
});
