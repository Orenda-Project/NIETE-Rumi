'use strict';
/**
 * Round 28 (switch sa_r28_mcq, engine flag r28_mcq): the story's questions as a spoken multiple choice. A `tap` task of
 * kind 'mcq': Jugnu reads the question, then the four answers one by one, each card lit while its own clip plays. A tap
 * during the question is ignored; a tap during the answers is a held choice (the read-out is never cut); 600 ms after
 * the last answer ends the choice stands and is scored on the phone by target_index.
 *
 * Core: the answer window (answer()/skip() ignored before promptDone()), the per-answer meta, asked[], the gate.
 * UI (jsdom, NODE_PATH=../portal/node_modules or the portal's own copy): the read-out sequencer, the held choice, the
 * settle, the replay, coach-led, the ?probe=1 debug line. Fixtures are synthetic.
 */
const path = require('path');
const core = require('../sa/sa-core');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  try { ({ JSDOM } = require(path.join(__dirname, '../../portal/node_modules/jsdom'))); } catch (__) { /* not installed here */ }
}
const maybe = JSDOM ? describe : describe.skip;

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const q = (n, key, extra) => Object.assign({
  id: `ur.story_w3.q${n}`,
  prompt: { text: `question ${n}`, audio: `sa/v5/ur/syn_q${n}.mp3` },
  options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
  option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_q${n}_o${k}.mp3`),
  target_index: key - 1, key, src: 'synthetic',
}, extra || {});
const QS = [q(1, 2, { needs_line: 1 }), q(2, 3, { gate: { min_words: 12 } }), q(3, 1, { gate: { min_words: 20 } }),
  q(4, 4, { gate: { min_words: 40 } }), q(5, 2, { gate: { min_words: 50 } }), q(6, 3, { gate: { min_words: 60 } })];
const words = Array.from({ length: 60 }, (_, i) => ({ id: 'w' + (i + 1), target: 'w' + (i + 1), line: i < 10 ? 1 : 2 }));
const story = { id: 'ur.story_w3', subtask: 'oral_reading_fluency', response: 'record', time_limit_s: 60, passage: { text: 'x' }, items: words };
function mcqTask(items, extra) {
  return Object.assign({
    id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', replaces: 'ur.story_comp_w3', kind: 'mcq', response: 'tap',
    subtask: 'reading_comprehension', lang: 'ur', title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null, stop: {},
    replay_at_s: 10, next_at_s: 15, depends_on: { task: 'ur.story_w3', upto_item: 'last_word_tap' }, items: items || QS,
  }, extra || {});
}
const oralTwin = () => ({ id: 'ur.story_comp_w3', subtask: 'reading_comprehension', depends_on: { task: 'ur.story_w3', upto_item: 'last_word_tap' }, items: QS });

/** A runner on the MCQ task alone (no story in the run: every question is asked). */
function solo(extra, opts) {
  const c = clock();
  const events = [];
  const battery = { battery_id: 'b', tasks: [mcqTask(QS.slice(0, 2), extra)] };
  const r = core.createRunner(Object.assign({ battery, now: c.now, onEvent: (e) => events.push(e), r28_mcq: true }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  return { r, c, events };
}

describe('sa_r28_mcq core: validation', () => {
  test('a 4-option item with target_index 0..3 validates, and the result says options_n 4', () => {
    expect(core.validate({ tasks: [mcqTask()] })).toBe(true);
    const { r } = solo();
    r.promptDone(); r.answer(1);
    r.promptDone(); r.answer(0);
    const res = r.results()[0];
    expect(res.options_n).toBe(4);
    expect(res.scored_on).toBe('phone');
  });
});

describe('sa_r28_mcq core: the answer window opens at promptDone()', () => {
  test('answer() before promptDone() is ignored: undefined, no tap event, nothing scored', () => {
    const { r, events } = solo();
    expect(r.answer(1)).toBeUndefined();
    expect(events.filter((e) => e.type === 'tap' || /^item_/.test(e.type))).toHaveLength(0);
    expect(r.view().item_index).toBe(0);
  });
  test('after promptDone() the tap is scored by target_index (key 2 → index 1)', () => {
    const { r, events } = solo();
    r.promptDone();
    expect(r.answer(1)).toBe(true);
    expect(events.filter((e) => e.type === 'tap')).toHaveLength(1);
    r.promptDone();
    expect(r.answer(1)).toBe(false); // q2's key is 3 (index 2)
    const res = r.results()[0];
    expect(res.correct).toBe(1);
    expect(res.attempted).toBe(2);
  });
  test('skip() before promptDone() is ignored; after it, skip is wrong', () => {
    const { r } = solo();
    expect(r.skip()).toBeUndefined();
    expect(r.view().item_index).toBe(0);
    r.promptDone();
    expect(r.skip()).toBe(false);
    expect(r.view().item_index).toBe(1);
  });
  test('no auto replay and no Next before the read-out ends; both count from promptDone()', () => {
    const { r, c } = solo();
    c.add(20000);
    expect(r.tick()).toBeNull();
    expect(r.view().offer_next).toBe(false);
    r.promptDone();
    c.add(9900); expect(r.tick()).toBeNull();
    c.add(200); expect(r.tick()).toBe('replay');
    c.add(5000); r.tick();
    expect(r.view().offer_next).toBe(true);
  });
  test('OFF (no r28_mcq): the same task answers before promptDone() as any untimed tap does today', () => {
    const { r } = solo({}, { r28_mcq: false });
    expect(r.answer(1)).toBe(true);
  });
});

describe('sa_r28_mcq core: the answer meta and asked[]', () => {
  test('answer(1, meta) stores tap_ms, chosen_at_option, changes and replays', () => {
    const { r } = solo();
    r.promptDone();
    r.answer(1, { tap_ms: -1200, chosen_at_option: 2, changes: 1, replays: 0 });
    r.promptDone();
    r.answer(2);
    const a = r.results()[0].answers;
    expect(a[0]).toEqual({ item_id: 'ur.story_w3.q1', value: 1, ok: true, tap_ms: -1200, chosen_at_option: 2, changes: 1, replays: 0 });
    expect(a[1]).toEqual({ item_id: 'ur.story_w3.q2', value: 2, ok: true }); // without meta: today's shape
  });
  test('the result carries asked[] (the questions the gate allowed)', () => {
    const { r } = solo();
    r.promptDone(); r.answer(1); r.promptDone(); r.answer(2);
    expect(r.results()[0].asked).toEqual(['ur.story_w3.q1', 'ur.story_w3.q2']);
  });
});

describe('sa_r28_mcq core: a lost clip never scores a question (B-17)', () => {
  function six() {
    const c = clock();
    const battery = { battery_id: 'b', tasks: [mcqTask(QS, { depends_on: null })], ui: { r28_mcq: true } };
    const events = [];
    const r = core.createRunner({ battery, now: c.now, onEvent: (e) => events.push(e) });
    r.start(); r.instructionDone(); r.begin();
    return { r, events };
  }
  const ans = (r, v) => { r.promptDone(); return r.answer(v); };
  test('clipLost(q2, prompt): q2 unavailable (not asked, not wrong), the next question shows, the rest scored', () => {
    const { r, events } = six();
    ans(r, 1); // q1 right
    expect(r.clipLost('ur.story_w3.q2', 'prompt')).toBe(true);
    expect(r.view().item.id).toBe('ur.story_w3.q3');
    ans(r, 0); ans(r, 3); ans(r, 1); ans(r, 2);
    const res = r.results()[0];
    expect(res.stop_reason).toBe('complete');
    expect(res.attempted).toBe(5);
    expect(res.correct).toBe(5);
    expect(res.incorrect).toBe(0);
    expect(res.asked).not.toContain('ur.story_w3.q2');
    expect(res.asked).toHaveLength(5);
    expect(res.presented).toBe(res.asked.length);
    expect(res.answers[1]).toEqual({ item_id: 'ur.story_w3.q2', value: null, unavailable: 'clip' });
    expect(res.unrated).toBeUndefined();
    expect(events.filter((e) => e.type === 'item_unavailable')).toHaveLength(1);
  });
  test('three questions lost: the task still runs to the end, answers kept, unrated', () => {
    const { r } = six();
    ans(r, 1);
    r.clipLost('ur.story_w3.q2', 'prompt'); r.clipLost('ur.story_w3.q3', 'prompt');
    ans(r, 3);
    r.clipLost('ur.story_w3.q5', 'prompt');
    ans(r, 2);
    const res = r.results()[0];
    expect(res.stop_reason).toBe('complete');
    expect(res.asked).toEqual(['ur.story_w3.q1', 'ur.story_w3.q4', 'ur.story_w3.q6']);
    expect(res.presented).toBe(3);
    expect(res.unrated).toBe(true);
    expect(res.answers.filter((a) => a.unavailable)).toHaveLength(3);
  });
  test('a lost replay keeps the question open and stops its auto replay', () => {
    const { r, events } = six();
    r.promptDone();
    expect(r.clipLost('ur.story_w3.q1', 'replay')).toBe(true);
    expect(r.view().item.id).toBe('ur.story_w3.q1');
    expect(events.filter((e) => e.type === 'replay' && e.value === 'lost')).toHaveLength(1);
  });
  test('OFF: clipLost does nothing to an mcq task without the switch', () => {
    const c = clock();
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [mcqTask(QS, { depends_on: null })] }, now: c.now });
    r.start(); r.instructionDone(); r.begin();
    expect(r.clipLost ? r.clipLost('ur.story_w3.q1', 'prompt') : false).toBe(false);
  });
});

describe('sa_r28_mcq core: the gate is the oral task\'s (B.7 #4)', () => {
  /** The MCQ task (or its oral twin) after a story result; → { stop_reason, asked }. */
  function after(storyRes, task, opts) {
    const battery = { battery_id: 'b', tasks: [story, task] };
    const res = Object.assign({ task_id: 'ur.story_w3', mode: 'record', attempted: 0, answers: [] }, storyRes);
    const r = core.createRunner(Object.assign({ battery, now: clock().now, mic: () => 'ok', r28_mcq: true, resume: { task_index: 1, results: [res] } }, opts || {}));
    r.start();
    if (r.view().phase !== 'task_end') { r.coachEnd(); }
    const out = r.results().find((x) => x.task_id === task.id);
    return { stop_reason: out.stop_reason, asked: out.asked || [] };
  }
  const ids = QS.map((x) => x.id);
  test('story with last_word_skipped and complete: every question is asked', () => {
    const g = after({ last_word_skipped: true, stop_reason: 'complete' }, mcqTask());
    expect(g.asked).toEqual(ids);
  });
  test('story stopped on its first line: none asked (skipped_no_first_line)', () => {
    const g = after({ last_word_skipped: true, stop_reason: 'early_stop_first_line' }, mcqTask());
    expect(g.stop_reason).toBe('skipped_no_first_line');
    expect(g.asked).toEqual([]);
  });
  test('comp_all_questions and 12 words read: all six, the same asked[] as the oral task', () => {
    const story12 = { stop_reason: 'complete', last_word_index: 11, last_word_line: 2 };
    const m = after(story12, mcqTask(), { comp_all_questions: true });
    const o = after(story12, oralTwin(), { comp_all_questions: true });
    expect(m.asked).toEqual(ids);
    expect(m.asked).toEqual(o.asked);
  });
  // SPEC E-6: the RWP gate holds on the MCQ in RDF auto and coach-led, with and without comp_all_questions
  const nineWords = { stop_reason: 'complete', last_word_index: 8, last_word_line: 1 };
  const lineOneStop = { stop_reason: 'early_stop_first_line', last_word_index: 3, last_word_line: 1 };
  [false, true].forEach((manual) => {
    const who = manual ? 'coach-led' : 'RDF auto';
    test(`E-6 ${who}, comp_all_questions: 9 words read → no MCQ question (as the oral task)`, () => {
      const m = after(nineWords, mcqTask(), { comp_all_questions: true, manual });
      expect(m.stop_reason).toBe('skipped_no_first_line');
      expect(m.asked).toEqual([]);
      expect(after(nineWords, oralTwin(), { comp_all_questions: true, manual }).asked).toEqual([]);
    });
    test(`E-6 ${who}: a line-1 stop → no MCQ question, with or without comp_all_questions`, () => {
      [true, false].forEach((comp) => {
        const m = after(lineOneStop, mcqTask(), { comp_all_questions: comp, manual });
        expect(m.asked).toEqual([]);
      });
      expect(after({ last_word_skipped: true, stop_reason: 'early_stop_first_line' }, mcqTask(), { manual }).asked).toEqual([]);
    });
    test(`E-6 ${who}, per-question gate (no comp_all): 9 words read → no MCQ question (the oral task would ask q1)`, () => {
      const m = after(nineWords, mcqTask(), { manual });
      expect(m.stop_reason).toBe('skipped_no_first_line');
      expect(m.asked).toEqual([]);
      // the path that asks: today's per-question gate (needs_line 1) on the oral task, left as it is
      expect(after(nineWords, oralTwin(), { manual }).asked).toEqual(['ur.story_w3.q1']);
    });
  });
  test('per-question gate (no comp_all): 12 words read → the same subset as the oral task', () => {
    const story12 = { stop_reason: 'complete', last_word_index: 11, last_word_line: 2 };
    const m = after(story12, mcqTask());
    const o = after(story12, oralTwin());
    expect(m.asked).toEqual(['ur.story_w3.q1', 'ur.story_w3.q2']);
    expect(m.asked).toEqual(o.asked);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// UI (jsdom)
// ------------------------------------------------------------------------------------------------------------------
maybe('sa_r28_mcq UI: the read-out, the held choice, the settle, the replay', () => {
  let dom;
  const keep = {};
  let views = [];
  function setup(url) {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: url || 'https://portal.test/sa/run.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  }
  afterEach(() => {
    views.forEach((v) => v.destroy()); views = [];
    for (const k of Object.keys(keep)) global[k] = keep[k];
    if (dom) dom.window.close();
    jest.restoreAllMocks();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A voice whose lines end only when the test says so; speak.audio() is the line's stub <audio>. */
  function fakeVoice() {
    const lines = [];
    let cur = null;
    const lost = new Set();
    const speak = (textObj, audioObj, vo) => {
      if (cur) cur.resolve();
      if (lost.has(audioObj)) {
        const l = { textObj, audioObj, vo, a: null, done: true, lost: true };
        lines.push(l); cur = null;
        return new Promise((_, rej) => setTimeout(() => rej(new Error('clip_unavailable')), 30));
      }
      const a = new dom.window.EventTarget();
      a.paused = true; a.currentTime = 0; a.ended = false;
      a.src = typeof audioObj === 'string' ? audioObj : (textObj && textObj.audio) || '';
      const line = { textObj, audioObj, vo, a, resolve: null, done: false };
      const p = new Promise((res) => { line.resolve = () => { if (!line.done) { line.done = true; if (cur === line) cur = null; res(); } }; });
      lines.push(line); cur = line;
      return p;
    };
    speak.audio = () => (cur ? cur.a : null);
    const play = (line) => { line.a.paused = false; line.a.currentTime = 0.01; line.at_play = Date.now(); line.a.dispatchEvent(new dom.window.Event('playing')); };
    const end = (line) => { line.a.currentTime = 1.5; line.a.paused = true; line.a.ended = true; line.at_end = Date.now(); line.a.dispatchEvent(new dom.window.Event('ended')); line.resolve(); };
    /** Play then end the next unspoken line: waits for it to be asked, then plays it ms long. */
    async function speakNext(ms, during) {
      for (let i = 0; i < 200 && !lines.find((l) => !l.done && !l.at_play); i++) await wait(10);
      const l = lines.find((x) => !x.done && !x.at_play);
      if (!l) throw new Error('no line asked');
      play(l);
      await wait(Math.floor((ms || 60) / 2));
      if (during) await during(l);
      await wait(Math.ceil((ms || 60) / 2));
      end(l);
      return l;
    }
    return { speak, lines, play, end, speakNext, lost };
  }

  function mountMcq(extra) {
    extra = extra || {};
    const core2 = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const events = [];
    const tasks = [mcqTask(extra.items || QS.slice(0, 2), Object.assign({ depends_on: null }, extra.task || {}))];
    const battery = { battery_id: 'b', tasks, ui: { r28_mcq: true } }; // as the served battery carries it
    const runner = core2.createRunner(Object.assign({ battery, onEvent: (e) => events.push(e) }, extra.runner || {})); // the flag from battery.ui
    const voice = fakeVoice();
    (extra.lost || []).forEach((k) => voice.lost.add(k));
    const el = document.getElementById('m');
    const answers = [];
    const ans0 = runner.answer;
    runner.answer = function (v, meta) { answers.push({ v, meta, at: Date.now() }); return ans0.call(runner, v, meta); };
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'ur', mode: 'proctored', speak: voice.speak, r28: { letter_pick: false, mcq: true, ceiling: false } }, extra.ui || {}));
    views.push(view);
    runner.start();
    if (extra.practice) { runner.instructionDone(); view.render(); } else { runner.instructionDone(); runner.begin(); view.render(); }
    return { runner, el, view, voice, events, answers };
  }
  const cards = (el) => Array.from(el.querySelectorAll('.sae-mcq-opt'));
  const lit = (el) => cards(el).map((c, i) => (c.classList.contains('is-speaking') ? i : -1)).filter((i) => i >= 0);
  const has = (el, cls) => cards(el).map((c) => c.classList.contains(cls));

  test('the cards light 1→4 in step with each clip\'s own playing/ended events; nothing lit after the read-out', async () => {
    setup();
    const { el, voice, runner } = mountMcq({ ui: { handover: false } });
    // proctored: past the handover screen
    await wait(20);
    expect(el.querySelector('.sae-mcq-q').textContent).toBe('question 1');
    expect(el.querySelector('.sae-mcq').classList.contains('sae-mcq-listening')).toBe(true);
    expect(has(el, 'is-waiting')).toEqual([true, true, true, true]);
    expect(el.querySelector('.sae-mcq-replay').disabled).toBe(true);
    const qLine = await voice.speakNext(60);
    expect(qLine.audioObj).toBe('sa/v5/ur/syn_q1.mp3');
    expect(lit(el)).toEqual([]);
    // when each card's is-speaking turned on and off, against its clip's playing / ended
    const marks = [];
    const was = new Map();
    new dom.window.MutationObserver((recs) => recs.forEach((r) => {
      const c = r.target;
      if (!c.classList || !c.classList.contains('sae-mcq-opt')) return;
      const on = c.classList.contains('is-speaking');
      if (was.get(c) === on) return;
      was.set(c, on);
      marks.push({ i: cards(el).indexOf(c), on, t: Date.now() });
    })).observe(el, { subtree: true, attributes: true, attributeFilter: ['class'] });
    const optLines = [];
    for (let k = 0; k < 4; k++) {
      const l = await voice.speakNext(80, async (x) => {
        expect(x.audioObj).toBe(`sa/v5/ur/syn_q1_o${k + 1}.mp3`);
        expect(lit(el)).toEqual([k]);
      });
      optLines.push(l);
      expect(lit(el)).toEqual([]); // off at ended
    }
    await wait(5);
    const offsets = optLines.map((l, k) => {
      const on = marks.find((m) => m.i === k && m.on);
      const off = marks.find((m) => m.i === k && !m.on && m.t >= on.t);
      return { option: k + 1, on_ms: on.t - l.at_play, off_ms: off.t - l.at_end };
    });
    offsets.forEach((o) => { expect(Math.abs(o.on_ms)).toBeLessThanOrEqual(250); expect(Math.abs(o.off_ms)).toBeLessThanOrEqual(250); });
    await wait(30);
    expect(has(el, 'is-ready')).toEqual([true, true, true, true]);
    expect(lit(el)).toEqual([]);
    expect(el.querySelector('.sae-mcq-replay').disabled).toBe(false);
    expect(runner.view().item_wait_ms).toBeLessThan(500); // promptDone() at the end of option 4
    // eslint-disable-next-line no-console
    if (process.env.SA_R28_OFFSETS) console.log('hl offsets', JSON.stringify(offsets));
  }, 20000);

  test('a tap during the question changes nothing; during option 2 it is held and the read-out goes on; a second tap moves it; 600 ms after the last clip the runner gets answer(index, meta)', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq();
    await wait(20);
    await voice.speakNext(80, async () => {
      cards(el)[1].click();
      expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    });
    // the 600 ms swallow after the question: still ignored
    await wait(100);
    cards(el)[2].click();
    expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    await voice.speakNext(60); // option 1
    await voice.speakNext(80, async () => { cards(el)[1].click(); }); // option 2 playing: held
    expect(has(el, 'is-chosen')).toEqual([false, true, false, false]);
    await voice.speakNext(80, async (l) => { // option 3 still read and lit
      expect(lit(el)).toEqual([2]);
      expect(l.audioObj).toBe('sa/v5/ur/syn_q1_o3.mp3');
      cards(el)[3].click(); // moves the choice
    });
    expect(has(el, 'is-chosen')).toEqual([false, false, false, true]);
    const last = await voice.speakNext(60); // option 4: read even though a choice is held
    expect(last.audioObj).toBe('sa/v5/ur/syn_q1_o4.mp3');
    expect(answers).toHaveLength(0);
    await wait(450);
    expect(answers).toHaveLength(0); // not before the settle ends
    await wait(700);
    expect(answers).toHaveLength(1);
    const a = answers[0];
    expect(a.v).toBe(3);
    expect(a.at - last.at_end).toBeGreaterThanOrEqual(600);
    expect(a.meta.chosen_at_option).toBe(2);
    expect(a.meta.changes).toBe(1);
    expect(a.meta.replays).toBe(0);
    expect(a.meta.tap_ms).toBeLessThan(0);
    expect(events.filter((e) => e.type === 'tap')).toHaveLength(1);
  }, 20000);

  test('a tap on another card during the settle moves the choice (changes + 1)', async () => {
    setup();
    const { el, voice, answers } = mountMcq();
    await wait(20);
    await voice.speakNext(40);
    await voice.speakNext(40, async () => { cards(el)[0].click(); });
    for (let k = 1; k < 4; k++) await voice.speakNext(40);
    await wait(300);
    cards(el)[2].click();
    expect(has(el, 'is-chosen')).toEqual([false, false, true, false]);
    await wait(900);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(2);
    expect(answers[0].meta.changes).toBe(1);
    expect(answers[0].meta.chosen_at_option).toBe(1);
  }, 20000);

  test('with no choice: a tap after the read-out selects, stands after 600 ms (pressed), tap_ms positive', async () => {
    setup();
    const { el, voice, answers } = mountMcq();
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(1000);
    expect(answers).toHaveLength(0);
    cards(el)[1].click();
    const at = Date.now();
    await wait(450);
    expect(answers).toHaveLength(0); // not before the settle ends
    await wait(250);
    expect(has(el, 'is-pressed')).toEqual([false, true, false, false]); // pressed 400 ms, recorded as it stood
    expect(answers).toHaveLength(1);
    await wait(500);
    expect(el.querySelector('.sae-mcq-q').textContent).toBe('question 2');
    expect(answers[0].v).toBe(1);
    expect(answers[0].at - at).toBeGreaterThanOrEqual(600);
    expect(answers[0].meta.tap_ms).toBeGreaterThanOrEqual(900);
    expect(answers[0].meta.chosen_at_option).toBeNull();
    expect(answers[0].meta.changes).toBe(0);
  }, 20000);

  test('replay re-reads the question and all four options, keeps the held choice, the button disabled meanwhile', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq();
    await wait(20);
    await voice.speakNext(40);
    await voice.speakNext(40);
    await voice.speakNext(40, async () => { cards(el)[1].click(); });
    await voice.speakNext(40);
    await voice.speakNext(40);
    // the settle runs; replay before it ends
    await wait(100);
    const rb = el.querySelector('.sae-mcq-replay');
    expect(rb.disabled).toBe(false);
    const n0 = voice.lines.length;
    rb.click();
    await wait(20);
    expect(el.querySelector('.sae-mcq-replay').disabled).toBe(true);
    expect(has(el, 'is-chosen')).toEqual([false, true, false, false]);
    const qAgain = await voice.speakNext(40);
    expect(qAgain.audioObj).toBe('sa/v5/ur/syn_q1.mp3');
    for (let k = 0; k < 4; k++) {
      const l = await voice.speakNext(40, async () => { expect(lit(el)).toEqual([k]); expect(has(el, 'is-chosen')[1]).toBe(true); });
      expect(l.audioObj).toBe(`sa/v5/ur/syn_q1_o${k + 1}.mp3`);
    }
    expect(voice.lines.length - n0).toBe(5);
    expect(answers).toHaveLength(0); // the settle was held back by the replay
    await wait(750);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(1);
    expect(answers[0].meta.replays).toBe(1);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'child')).toHaveLength(1);
  }, 20000);

  test('coach-led (manual): Jugnu still reads question and options; the coach fold lists them, the key not marked', async () => {
    setup();
    const { el, voice } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    const fold = el.querySelector('details.sae-mcq-coach');
    expect(fold).not.toBeNull();
    expect(fold.open).toBeFalsy();
    const t = fold.textContent;
    ['question 1', 'a1', 'b1', 'c1', 'd1'].forEach((s) => expect(t).toContain(s));
    expect(fold.querySelector('.is-key, [data-key="1"]')).toBeNull();
    const q1 = await voice.speakNext(40);
    expect(q1.audioObj).toBe('sa/v5/ur/syn_q1.mp3');
    const o1 = await voice.speakNext(40);
    expect(o1.audioObj).toBe('sa/v5/ur/syn_q1_o1.mp3');
  }, 20000);

  test('?probe=1: console.debug(\'hl\', option, currentTime) on every light-on and light-off; without it nothing', async () => {
    setup('https://portal.test/sa/run.html?form=x&probe=1');
    const dbg = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const { voice } = mountMcq();
    await wait(20);
    await voice.speakNext(40);
    await voice.speakNext(40);
    const hl = dbg.mock.calls.filter((c) => c[0] === 'hl');
    expect(hl).toEqual([['hl', 1, 0.01], ['hl', 1, 1.5]]);
    views.forEach((v) => v.destroy()); views = [];
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
    dbg.mockClear();
    setup('https://portal.test/sa/run.html?form=x');
    const m2 = mountMcq();
    await wait(20);
    await m2.voice.speakNext(40);
    await m2.voice.speakNext(40);
    expect(dbg.mock.calls.filter((c) => c[0] === 'hl')).toHaveLength(0);
  }, 20000);

  test('practice: the same read-out, then the engine\'s retry-once; after the second wrong answer the right card is shown', async () => {
    setup();
    const p = { id: 'ur.story_mcq_w3.p1', passage: { text: 'practice story' }, prompt: { text: 'practice q', audio: 'sa/v5/ur/syn_pq.mp3' },
      options: ['w', 'x', 'y', 'z'], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_p_o${k}.mp3`), target_index: 1, key: 2 };
    const { el, voice, runner } = mountMcq({ practice: true, task: { practice: [p] } });
    await wait(20);
    expect(runner.view().phase).toBe('practice');
    expect(el.querySelectorAll('.sae-mcq-opt')).toHaveLength(4);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    cards(el)[3].click();
    await wait(1100);
    // first wrong: try again (Jugnu says so, then the same item is read again)
    expect(runner.view().phase).toBe('practice');
    expect(cards(el)[3].classList.contains('is-tried')).toBe(true);
    await voice.speakNext(40); // "try again"
    await wait(1400);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    cards(el)[2].click();
    await wait(1100);
    expect(cards(el)[1].classList.contains('is-right')).toBe(true);
    expect(cards(el)[1].classList.contains('is-shown')).toBe(true);
  }, 30000);

  test('B-17: o3 of question 2 lost → question 2 unavailable, the others scored; answers, asked and the hl log agree', async () => {
    setup('https://portal.test/sa/run.html?probe=1');
    const dbg = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const { el, voice, runner } = mountMcq({ items: QS.slice(0, 3), lost: ['sa/v5/ur/syn_q2_o3.mp3'] });
    await wait(20);
    const answerAll = async (k) => {
      for (let i = 0; i < 5; i++) await voice.speakNext(30);
      await wait(30); cards(el)[k].click(); await wait(1100);
    };
    await answerAll(1); // q1 right
    await voice.speakNext(30); await voice.speakNext(30); await voice.speakNext(30); // q2: question, o1, o2
    for (let i = 0; i < 100 && el.querySelector('.sae-mcq-q').textContent !== 'question 3'; i++) await wait(20);
    expect(el.querySelector('.sae-mcq-q').textContent).toBe('question 3');
    await answerAll(0); // q3 right
    const res = runner.results()[0];
    expect(res.asked).toEqual(['ur.story_w3.q1', 'ur.story_w3.q3']);
    expect(res.answers.map((a) => a.unavailable || a.ok)).toEqual([true, 'clip', true]);
    expect(voice.lines.every((l) => l.vo && l.vo.clip_only === true)).toBe(true);
    const hl = dbg.mock.calls.filter((c) => c[0] === 'hl').map((c) => c[1]);
    // q1: 4 options on+off; q2: options 1 and 2 only (never 3: its clip never played); q3: 4 options on+off
    expect(hl).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4]);
  }, 30000);

  test('B-17: a card never lights when its clip did not reach playing', async () => {
    setup();
    const { el, voice } = mountMcq({ lost: ['sa/v5/ur/syn_q1_o1.mp3'] });
    await wait(20);
    const seen = [];
    new dom.window.MutationObserver(() => { seen.push(...lit(el)); }).observe(el, { subtree: true, attributes: true, attributeFilter: ['class'] });
    await voice.speakNext(30);
    await wait(800);
    expect(seen).toEqual([]);
  }, 20000);

  test('B-17: the five clips are warmed (preload) before the read-out begins, at most 5 s', async () => {
    setup();
    let release;
    const asked = [];
    const preload = (list, ms) => { asked.push({ list, ms }); return new Promise((r) => { release = r; }); };
    const { voice } = mountMcq({ ui: { preload } });
    await wait(200);
    expect(asked).toHaveLength(1);
    expect(asked[0].list).toEqual(['sa/v5/ur/syn_q1.mp3', 'sa/v5/ur/syn_q1_o1.mp3', 'sa/v5/ur/syn_q1_o2.mp3', 'sa/v5/ur/syn_q1_o3.mp3', 'sa/v5/ur/syn_q1_o4.mp3']);
    expect(asked[0].ms).toBe(5000);
    expect(voice.lines).toHaveLength(0); // not before the clips are ready
    release({ ready: 5, of: 5 });
    await wait(50);
    expect(voice.lines).toHaveLength(1);
  }, 20000);

  test('B-17: a lost replay keeps the question open (cards ready, the replay logged lost)', async () => {
    setup();
    const { el, voice, events } = mountMcq();
    await wait(20);
    for (let i = 0; i < 5; i++) await voice.speakNext(30);
    await wait(50);
    voice.lost.add('sa/v5/ur/syn_q1.mp3');
    el.querySelector('.sae-mcq-replay').click();
    await wait(200);
    expect(el.querySelector('.sae-mcq-q').textContent).toBe('question 1');
    expect(has(el, 'is-ready')).toEqual([true, true, true, true]);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'lost')).toHaveLength(1);
  }, 20000);

  test('B-18: the old oral keys (accept, reject, rubric, accept_rule, card_src) are never on any screen', async () => {
    setup();
    const leaky = QS.slice(0, 1).map((x) => Object.assign({}, x, { accept: ['secret-a'], reject: ['secret-r'], rubric: 'secret-rubric', accept_rule: 'secret-rule', card_src: 'secret-src' }));
    const auto = mountMcq({ items: leaky });
    await wait(20);
    expect(auto.el.innerHTML).not.toMatch(/secret/);
    views.forEach((v) => v.destroy()); views = [];
    const coach = mountMcq({ items: leaky, runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    coach.el.querySelectorAll('details').forEach((d) => { d.open = true; });
    expect(coach.el.innerHTML).not.toMatch(/secret/);
    expect(coach.el.textContent).toContain('a1');
  }, 20000);

  test('OFF (no r28_mcq on the mount): the task draws as today\'s tap screen, no MCQ cards', async () => {
    setup();
    const core2 = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks: [mcqTask(QS.slice(0, 1), { depends_on: null })] };
    const runner = core2.createRunner({ battery });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'game', speak: () => Promise.resolve() });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    await wait(20);
    expect(el.querySelector('.sae-mcq')).toBeNull();
  });
});
