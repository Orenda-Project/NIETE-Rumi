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
    expect(r.view().offer_next).toBe(false); // RDF auto: Next at 30 s (SPEC A.4)
    c.add(14900); expect(r.view().offer_next).toBe(true);
  });
  test('Next per mode, r9_question_time ON: 15 s coach-led, 30 s RDF auto (SPEC A.4; never doubled)', () => {
    const ui = { r9_question_time: true };
    const coach = (() => {
      const c = clock();
      const r = core.createRunner({ battery: { battery_id: 'b', ui, tasks: [mcqTask(QS.slice(0, 2))] }, now: c.now, onEvent: () => {}, r28_mcq: true, manual: true });
      r.start(); r.instructionDone(); r.begin();
      return { r, c };
    })();
    coach.r.promptDone();
    coach.c.add(14999); expect(coach.r.view().offer_next).toBe(false);
    coach.c.add(1); expect(coach.r.view().offer_next).toBe(true);
    const auto = (() => {
      const c = clock();
      const r = core.createRunner({ battery: { battery_id: 'b', ui, tasks: [mcqTask(QS.slice(0, 2))] }, now: c.now, onEvent: () => {}, r28_mcq: true });
      r.start(); r.instructionDone(); r.begin();
      return { r, c };
    })();
    auto.r.promptDone();
    auto.c.add(29999); expect(auto.r.view().offer_next).toBe(false);
    auto.c.add(1); expect(auto.r.view().offer_next).toBe(true);
  });
  test('OFF (no r28_mcq): the same task keeps its next_at_s in RDF auto (15 s), as any untimed tap does today', () => {
    const { r, c } = solo({}, { r28_mcq: false });
    c.add(15000);
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

  test('?probe=1: console.debug(\'hl\', option, currentTime) on every light-on and light-off, the stem as option 0; without it nothing', async () => {
    setup('https://portal.test/sa/run.html?form=x&probe=1');
    const dbg = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const { voice } = mountMcq();
    await wait(20);
    await voice.speakNext(40);
    await voice.speakNext(40);
    const hl = dbg.mock.calls.filter((c) => c[0] === 'hl');
    expect(hl).toEqual([['hl', 0, 0.01], ['hl', 0, 1.5], ['hl', 1, 0.01], ['hl', 1, 1.5]]);
    expect(lit(document.getElementById('m'))).toEqual([]); // the stem has no card: nothing lights for it
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
    expect(hl).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]); // 0 = the stem
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

  test('coach line (coach-led only, text only): shown above the fold in Urdu and English, never spoken; not in RDF auto', async () => {
    // the MCQ's own line (B-14 amended): the child taps the answer, so it never sends the coach to a Next, and it
    // keeps «do not translate»
    const UR = 'جگنو سوال اور چاروں جواب خود پڑھے گا۔ آپ نہ پڑھیں، نہ ترجمہ کریں، نہ جواب بتائیں۔ بچے کو خود جواب دبانے دیں۔';
    const EN = 'Jugnu reads the question and all four answers. Do not read, translate or give the answer. Let the child tap the answer.';
    setup();
    const said = (v) => v.lines.map((l) => JSON.stringify([l.textObj, l.audioObj])).join('|');
    const ur = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    const line = ur.el.querySelector('.sae-mcq-coach-line');
    expect(line).not.toBeNull();
    expect(line.textContent).toBe(UR);
    expect(line.classList.contains('sae-coach-says')).toBe(true);
    expect(line.compareDocumentPosition(ur.el.querySelector('details.sae-mcq-coach')) & 4).toBeTruthy(); // the fold after it
    for (let i = 0; i < 5; i++) await ur.voice.speakNext(30);
    expect(said(ur.voice)).not.toContain('Jugnu reads the question');
    expect(said(ur.voice)).not.toContain('جگنو سوال اور');
    expect(UR).not.toMatch(/آگے/);
    expect(EN).not.toMatch(/Next/);
    views.forEach((v) => v.destroy()); views = [];
    const en = mountMcq({ runner: { manual: true }, ui: { manual: true, lang: 'en' } });
    await wait(20);
    expect(en.el.querySelector('.sae-mcq-coach-line').textContent).toBe(EN);
    views.forEach((v) => v.destroy()); views = [];
    const auto = mountMcq();
    await wait(20);
    expect(auto.el.querySelector('.sae-mcq-coach-line')).toBeNull();
    views.forEach((v) => v.destroy()); views = [];
    // OFF (no r28_mcq): the spoken comprehension task, coach-led, carries neither the new line nor the old one
    const OLD_UR = 'جگنو سوال خود پڑھے گا۔';
    const OLD_EN = 'Jugnu reads the question. Do not tell the child the answer';
    for (const lang of ['ur', 'en']) {
      const core2 = require('../sa/sa-core');
      const ui = require('../sa/sa-ui');
      const oral = Object.assign(oralTwin(), { response: 'oral', lang, title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null, depends_on: null });
      const battery = { battery_id: 'b', tasks: [oral], ui: {} };
      const runner = core2.createRunner({ battery, manual: true, onEvent: () => {} });
      const view = ui.mount(document.getElementById('m'), { runner, battery, lang, mode: 'proctored', manual: true, speak: () => Promise.resolve() });
      views.push(view);
      runner.start(); runner.instructionDone(); runner.begin(); view.render();
      await wait(20);
      const text = document.getElementById('m').textContent;
      expect(document.getElementById('m').querySelector('.sae-mcq-coach-line')).toBeNull();
      for (const str of [UR, EN, OLD_UR, OLD_EN]) expect({ lang, has: text.includes(str) }).toEqual({ lang, has: false });
      views.forEach((v) => v.destroy()); views = [];
    }
  }, 20000);

  test('coach-led: the offered Next is in the head row beside the replay, never the foot; RDF auto keeps it in the foot (B.3 coach-led fit)', async () => {
    setup();
    for (const coach of [true, false]) {
      let T = 0;
      const now = () => T;
      const task = { replay_at_s: null }; // no auto replay in this test: the clock runs straight to the Next
      const m = coach
        ? mountMcq({ task, runner: { manual: true, now }, ui: { manual: true } })
        : mountMcq({ task, runner: { now } });
      for (let i = 0; i < 5; i++) await m.voice.speakNext(30);
      await wait(700);
      expect(m.el.querySelector('.sa-next')).toBeNull();
      T += (coach ? 15 : 30) * 1000 + 500;
      m.view.render();
      await wait(20);
      const head = m.el.querySelector('.sae-mcq-head .sa-next');
      const foot = m.el.querySelector('.sae-foot .sa-next');
      expect({ coach, head: !!head, foot: !!foot }).toEqual({ coach, head: coach, foot: !coach });
      if (coach) {
        // after the replay, Jugnu and the replay keep their order; the Next is the row's last child
        const row = Array.from(m.el.querySelector('.sae-mcq-head').children);
        expect(row[row.length - 1]).toBe(head);
        expect(row.indexOf(m.el.querySelector('.sae-mcq-replay'))).toBeLessThan(row.indexOf(head));
        expect(m.el.querySelector('.sae-foot')).toBeNull(); // no foot at all: nothing below the cards to come and go
        head.click();
        expect(m.runner.view().item_index).toBe(1); // the coach's Next moves on (a skip), as the foot's did
      }
      views.forEach((v) => v.destroy()); views = [];
    }
  }, 20000);

  test('coach line on the practice screen too (coach-led)', async () => {
    setup();
    const p = { id: 'ur.story_mcq_w3.p1', passage: { text: 'practice story' }, prompt: { text: 'practice q', audio: 'sa/v5/ur/syn_pq.mp3' },
      options: ['w', 'x', 'y', 'z'], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_p_o${k}.mp3`), target_index: 1, key: 2 };
    const { el, runner } = mountMcq({ practice: true, task: { practice: [p] }, runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    expect(runner.view().phase).toBe('practice');
    expect(el.querySelector('.sae-mcq-coach-line')).not.toBeNull();
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

  // SPEC B.3 (lead ruling, round 28): after the first full read-out the cards never lock. Only the FIRST read of the
  // question (before option 1 starts) keeps them grey; during a replay the highlight follows the reading, the held
  // choice stays and can be changed, and a tap during the replay's question is a provisional choice like any other.
  test('replay: a tap 1 s into the replayed question is recorded (held, stands 600 ms after the re-read); the cards are never grey', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq();
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40); // the first full read-out, no choice
    await wait(100);
    el.querySelector('.sae-mcq-replay').click();
    const stem = await voice.speakNext(2200, async () => { // 1.1 s into the replayed question
      cards(el)[2].click();
      expect(has(el, 'is-chosen')).toEqual([false, false, true, false]);
      expect(el.querySelector('.sae-mcq').classList.contains('sae-mcq-listening')).toBe(false);
      expect(has(el, 'is-waiting')).toEqual([false, false, false, false]);
    });
    expect(stem.audioObj).toBe('sa/v5/ur/syn_q1.mp3');
    await wait(200); // the swallow after the question: a tap moves the choice
    cards(el)[0].click();
    expect(has(el, 'is-chosen')).toEqual([true, false, false, false]);
    for (let k = 0; k < 4; k++) {
      await voice.speakNext(40, async () => { expect(lit(el)).toEqual([k]); expect(has(el, 'is-chosen')[0]).toBe(true); });
    }
    expect(answers).toHaveLength(0); // the choice stands only after the re-read
    await wait(750);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(0);
    expect(answers[0].meta.replays).toBe(1);
    expect(answers[0].meta.changes).toBe(1);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'child')).toHaveLength(1);
  }, 20000);

  test('the first read of the question still keeps the cards grey and ignores taps (only the first)', async () => {
    setup();
    const { el, voice } = mountMcq();
    await wait(20);
    await voice.speakNext(200, async () => {
      expect(el.querySelector('.sae-mcq').classList.contains('sae-mcq-listening')).toBe(true);
      cards(el)[1].click();
      expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    });
  }, 20000);

  test('replay resets both clocks: no Next and no auto replay while the question is re-read; Next comes next_at_s after the re-read ends', async () => {
    setup();
    const c = clock();
    const { el, voice, runner, events } = mountMcq({ runner: { now: c.now } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(30); // promptDone() at c = 0
    await wait(100);
    // the wait is per mode (A-11 / B-13, worker A3): this mount is RDF auto (no manual), so 30 s, not the bank's 15 s
    const nextMs = 30 * 1000;
    expect(runner.view().task.next_at_s).toBe(15); // the bank's value stays; the engine reads the mode
    c.add(nextMs - 6000);
    expect(runner.view().offer_next).toBe(false);
    el.querySelector('.sae-mcq-replay').click();
    await voice.speakNext(200, async () => { // the replay runs past the first read-out's Next time
      c.add(9000);
      expect(runner.view().offer_next).toBe(false);
      expect(runner.tick()).toBeNull();
    });
    for (let k = 0; k < 4; k++) await voice.speakNext(30); // the re-read ends: both clocks start again here
    await wait(100);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'auto')).toHaveLength(0);
    c.add(nextMs - 1000);
    expect(runner.view().offer_next).toBe(false);
    c.add(1500);
    expect(runner.view().offer_next).toBe(true);
  }, 20000);

  // ---------------- B.3 (lead ruling, round 5): the open coach fold is MODAL, and its opening/closing is logged ----------------
  const fold = (el) => el.querySelector('details.sae-mcq-coach');
  const setFold = (el, open) => { const d = fold(el); d.open = open; d.dispatchEvent(new dom.window.Event('toggle')); };
  const foldEvents = (events) => events.filter((e) => e.type === 'fold_open' || e.type === 'fold_close')
    .map((e) => Object.assign({ type: e.type, task_id: e.task_id, item_id: e.item_id }, e.type === 'fold_close' ? { by: e.by, card: e.card } : {}));

  test('modal fold (coach-led): after the read-out, fold open → a tap on card 4 only closes it (no answer, no choice); the next tap answers; fold_open / fold_close logged once each', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    setFold(el, true);
    await wait(20);
    expect(fold(el).open).toBe(true);
    cards(el)[3].click();
    expect(answers).toHaveLength(0);
    expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    expect(fold(el).open).toBe(false);
    await wait(1100);
    expect(answers).toHaveLength(0); // nothing was held: nothing stands
    expect(foldEvents(events)).toEqual([
      { type: 'fold_open', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_w3.q1' },
      { type: 'fold_close', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_w3.q1', by: 'tap', card: 3 },
    ]);
    cards(el)[3].click();
    expect(has(el, 'is-chosen')).toEqual([false, false, false, true]);
    await wait(1100);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(3);
    expect(foldEvents(events)).toHaveLength(2); // a tap with the fold closed logs nothing
  }, 20000);

  test('modal fold during the read-out (option 2 lit): a tap closes the fold only, the read-out goes on, no choice held; a fold left open stays open (and modal) across the redraw at the read-out\'s end', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    await voice.speakNext(40); // the question
    await wait(650); // the swallow
    await voice.speakNext(40); // option 1
    await voice.speakNext(80, async () => {
      expect(lit(el)).toEqual([1]);
      setFold(el, true);
      cards(el)[0].click();
      expect(fold(el).open).toBe(false);
      expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    });
    const o3 = await voice.speakNext(80, async () => { expect(lit(el)).toEqual([2]); setFold(el, true); }); // the next card still lights
    expect(o3.audioObj).toBe('sa/v5/ur/syn_q1_o3.mp3');
    const o4 = await voice.speakNext(60);
    expect(o4.audioObj).toBe('sa/v5/ur/syn_q1_o4.mp3');
    await wait(100); // the read-out's end redraws the screen
    expect(fold(el).open).toBe(true);
    cards(el)[1].click();
    expect(fold(el).open).toBe(false);
    expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    await wait(1100);
    expect(answers).toHaveLength(0);
    expect(foldEvents(events).map((e) => [e.type, e.by, e.card])).toEqual([['fold_open', undefined, undefined], ['fold_close', 'tap', 0], ['fold_open', undefined, undefined], ['fold_close', 'tap', 1]]);
  }, 20000);

  test('modal fold: a tap on the replay (or Jugnu) with the fold open only closes it (no replay); the next tap replays', async () => {
    setup();
    const { el, voice, events } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    const n0 = voice.lines.length;
    setFold(el, true);
    el.querySelector('.sae-mcq-jugnu').click();
    expect(fold(el).open).toBe(false);
    setFold(el, true);
    el.querySelector('.sae-mcq-replay').click();
    expect(fold(el).open).toBe(false);
    await wait(50);
    expect(events.filter((e) => e.type === 'replay')).toHaveLength(0);
    expect(voice.lines.length).toBe(n0);
    expect(foldEvents(events).filter((e) => e.type === 'fold_close').map((e) => [e.by, e.card])).toEqual([['tap', null], ['tap', null]]);
    await wait(350); // past the ghost-click guard
    el.querySelector('.sae-mcq-replay').click();
    await wait(50);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'child')).toHaveLength(1);
    expect(voice.lines.length).toBe(n0 + 1);
  }, 20000);

  test('modal fold: the offered Next (15 s, coach-led) with the fold open: the first tap closes it and the item stays; the second skips', async () => {
    setup();
    let T = 0;
    const now = () => T;
    const m = mountMcq({ task: { replay_at_s: null }, runner: { manual: true, now }, ui: { manual: true } });
    for (let i = 0; i < 5; i++) await m.voice.speakNext(30);
    await wait(700);
    T += 15500;
    m.view.render();
    await wait(20);
    setFold(m.el, true);
    m.el.querySelector('.sae-mcq-head .sa-next').click();
    expect(fold(m.el).open).toBe(false);
    expect(m.runner.view().item_index).toBe(0);
    await wait(350); // past the ghost-click guard
    m.el.querySelector('.sae-mcq-head .sa-next').click();
    expect(m.runner.view().item_index).toBe(1);
  }, 20000);

  test('modal fold on the practice item too: the first tap closes the fold (logged with the practice id), the next tap answers', async () => {
    setup();
    const p = { id: 'ur.story_mcq_w3.p1', passage: { text: 'practice story' }, prompt: { text: 'practice q', audio: 'sa/v5/ur/syn_pq.mp3' },
      options: ['w', 'x', 'y', 'z'], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_p_o${k}.mp3`), target_index: 1, key: 2 };
    const { el, voice, runner, events } = mountMcq({ practice: true, task: { practice: [p] }, runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    expect(runner.view().phase).toBe('practice');
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    setFold(el, true);
    cards(el)[3].click();
    expect(fold(el).open).toBe(false);
    expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    await wait(1100);
    expect(cards(el)[3].classList.contains('is-tried')).toBe(false);
    cards(el)[3].click();
    await wait(1100);
    expect(cards(el)[3].classList.contains('is-tried')).toBe(true);
    expect(foldEvents(events)).toEqual([
      { type: 'fold_open', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_mcq_w3.p1' },
      { type: 'fold_close', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_mcq_w3.p1', by: 'tap', card: 3 },
    ]);
  }, 30000);

  test('modal fold: a double tap cannot close and answer in one go (a tap within 300 ms of the close is ignored, logged ghost_tap, never scored); the summary closes it as by: summary', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    setFold(el, true);
    cards(el)[2].click();
    await wait(120);
    cards(el)[2].click(); // the second half of a double tap, +120 ms
    expect(has(el, 'is-chosen')).toEqual([false, false, false, false]);
    const ghosts = events.filter((e) => e.type === 'ghost_tap');
    expect(ghosts.map((e) => ({ task_id: e.task_id, item_id: e.item_id, card: e.card }))).toEqual([{ task_id: 'ur.story_mcq_w3', item_id: 'ur.story_w3.q1', card: 2 }]);
    expect(ghosts[0].ms_after_close).toBeGreaterThanOrEqual(100);
    expect(ghosts[0].ms_after_close).toBeLessThan(300);
    expect(events.filter((e) => e.type === 'tap')).toHaveLength(0); // never scored
    await wait(1100);
    expect(answers).toHaveLength(0);
    // the coach folds it with the summary: by summary, and the summary's own tap is not swallowed
    setFold(el, true);
    const sum = fold(el).querySelector('summary');
    sum.click();
    if (fold(el).open) setFold(el, false); // a DOM without the summary's activation: the toggle the browser would fire
    expect(fold(el).open).toBe(false);
    await wait(350);
    cards(el)[2].click();
    await wait(1100);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(2);
    expect(events.filter((e) => e.type === 'ghost_tap')).toHaveLength(1); // the tap at +350 ms answered: no ghost
    expect(foldEvents(events).filter((e) => e.type === 'fold_close').map((e) => [e.by, e.card])).toEqual([['tap', 2], ['summary', undefined]]);
  }, 20000);

  test('modal fold: a fold opened in the 400 ms press window is closed by the item change: one fold_close by item for the old item, the next item drawn folded', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    cards(el)[1].click();
    await wait(700); // the settle (600 ms) has ended: the card is pressed, the next item is 400 ms away
    expect(answers).toHaveLength(1);
    setFold(el, true);
    await wait(600);
    expect(el.querySelector('.sae-mcq-q').textContent).toBe('question 2');
    expect(fold(el).open).toBe(false);
    expect(foldEvents(events)).toEqual([
      { type: 'fold_open', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_w3.q1' },
      { type: 'fold_close', task_id: 'ur.story_mcq_w3', item_id: 'ur.story_w3.q1', by: 'item', card: null },
    ]);
    // the new item is not under an orphaned modal: its first tap after the read-out answers
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    cards(el)[2].click();
    await wait(1100);
    expect(answers).toHaveLength(2);
  }, 30000);

  test('chosen_at_option 0 = the stem: a tap during a replayed stem, and a tap after the swallow before option 1 lights; the first read\'s grey stem still ignores taps', async () => {
    setup();
    // (1) the first read's stem: ignored
    let m = mountMcq();
    await wait(20);
    await m.voice.speakNext(80, async () => { cards(m.el)[1].click(); });
    expect(has(m.el, 'is-chosen')).toEqual([false, false, false, false]);
    // (2) after the swallow, option 1's clip asked but not yet playing: the choice is held at option 0
    await wait(800);
    cards(m.el)[1].click();
    expect(has(m.el, 'is-chosen')).toEqual([false, true, false, false]);
    for (let k = 0; k < 4; k++) await m.voice.speakNext(40);
    await wait(1100);
    expect(m.answers).toHaveLength(1);
    expect(m.answers[0].meta.chosen_at_option).toBe(0);
    views.forEach((v) => v.destroy()); views = [];
    // (3) a replayed stem: the tap counts and is held at option 0
    m = mountMcq();
    await wait(20);
    for (let k = 0; k < 5; k++) await m.voice.speakNext(40);
    await wait(100);
    m.el.querySelector('.sae-mcq-replay').click();
    await m.voice.speakNext(80, async () => { cards(m.el)[3].click(); });
    expect(has(m.el, 'is-chosen')).toEqual([false, false, false, true]);
    for (let k = 0; k < 4; k++) await m.voice.speakNext(40);
    await wait(1100);
    expect(m.answers).toHaveLength(1);
    expect(m.answers[0].meta.chosen_at_option).toBe(0);
    expect(m.answers[0].meta.replays).toBe(1);
  }, 30000);

  test('RDF auto (no manual): no fold on the screen, and a card tap after the read-out answers at once (unchanged)', async () => {
    setup();
    const { el, voice, answers, events } = mountMcq();
    await wait(20);
    expect(fold(el)).toBeNull();
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    cards(el)[3].click();
    expect(has(el, 'is-chosen')).toEqual([false, false, false, true]);
    await wait(1100);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(3);
    expect(foldEvents(events)).toHaveLength(0);
  }, 20000);

  test('the picker\'s coach fold logs fold_open / fold_close too (once each, kept across a redraw), with the task and item ids', async () => {
    setup();
    const core2 = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const opts5 = ['ت', 'ب', 'پ', 'ٹ', 'ن'];
    const items = [1, 2].map((n) => ({ id: `ur.letter_pick10.0${n}`, options: opts5, target: 'ب', prompt_audio: `sa/v5/ur/ls_${n}.mp3`, prompt_text: 'بَ', src: 'synthetic' }));
    const task = { id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
      subtask: 'letter_sound_identification', lang: 'ur', title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null, stop: {},
      replay_at_s: 10, next_at_s: 15, instruction: { text: 'instruction', audio: 'sa/v5/ur/lp_intro.mp3' }, script: {}, items, practice: [] };
    const battery = { battery_id: 'b', ui: { r28_letter_pick: true }, tasks: [task] };
    const events = [];
    const runner = core2.createRunner({ battery, manual: true, onEvent: (e) => events.push(e) });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'proctored', manual: true, speak: () => new Promise(() => {}), r28: { letter_pick: true } });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    const pf = () => el.querySelector('details.sae-pick-coach');
    pf().open = true; pf().dispatchEvent(new dom.window.Event('toggle'));
    view.render();
    await wait(20);
    expect(pf().open).toBe(true);
    pf().open = false; pf().dispatchEvent(new dom.window.Event('toggle'));
    await wait(20);
    expect(foldEvents(events)).toEqual([
      { type: 'fold_open', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.01' },
      { type: 'fold_close', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.01', by: 'summary', card: undefined },
    ]);
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

// ------------------------------------------------------------------------------------------------------------------
// B.3 amended: the held choice is the brightest state. idle (dimmed); speaking = an outline ring only (no fill, no
// glow); chosen = the battery's accent FILL; speaking + chosen = the fill with the ring. Pinned on sa.css itself
// (jsdom cannot compute a glow), the exact declarations shipped.
// ------------------------------------------------------------------------------------------------------------------
describe('sa_r28_mcq CSS: the chosen card is the brightest state (B.3 amended)', () => {
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '../sa/sa.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** The declarations of the rule whose selector is exactly `sel` (top level, the last one wins as in the cascade). */
  function decls(sel) {
    const out = {};
    let found = false;
    css.split('}').forEach((chunk) => {
      const at = chunk.lastIndexOf('{');
      if (at < 0) return;
      const head = chunk.slice(0, at).split('{').pop().trim();
      if (head !== sel) return;
      found = true;
      chunk.slice(at + 1).split(';').forEach((d) => {
        const i = d.indexOf(':');
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      });
    });
    return found ? out : null;
  }
  /** Each box-shadow layer's blur radius (the third length); a ring has blur 0. */
  function blurs(shadow) {
    if (!shadow || shadow === 'none') return [];
    return shadow.split(/,(?![^(]*\))/).map((layer) => {
      const lens = layer.trim().split(/\s+/).filter((x) => /^-?\d/.test(x));
      return parseFloat(lens[2] || '0');
    });
  }
  /** How many blocks (an @media, …) are open where the rule with exactly this selector starts; 0 = applies everywhere. */
  function depthOf(sel) {
    let depth = 0; let i = 0;
    while (i < css.length) {
      const ch = css[i];
      if (ch === '{') {
        const head = css.slice(0, i).split(/[{};]/).pop().trim();
        if (head === sel) return depth;
        depth += 1;
      } else if (ch === '}') depth -= 1;
      i += 1;
    }
    return null;
  }
  test('sa.css closes every block, and the MCQ card rules apply at every width (not inside a tablet @media)', () => {
    expect((css.match(/{/g) || []).length - (css.match(/}/g) || []).length).toBe(0);
    for (const sel of ['.sae-mcq-opt', '.sae-mcq-q', '.sae-mcq-opt.is-speaking', '.sae-mcq-opt.is-chosen', '.sae-mcq-opt.is-chosen.is-speaking', '.sae-mcq-opt.is-waiting']) {
      expect({ sel, depth: depthOf(sel) }).toEqual({ sel, depth: 0 });
    }
  });
  test('speaking = an outline ring only: accent border and a 3 px accent ring, no fill, no glow', () => {
    const s = decls('.sae-mcq-opt.is-speaking');
    expect(s).not.toBeNull();
    expect(s.background).toBeUndefined();
    expect(s['background-color']).toBeUndefined();
    expect(s['border-color']).toBe('var(--sae-accent)');
    expect(s['box-shadow']).toBe('0 0 0 3px var(--sae-accent)');
    expect(blurs(s['box-shadow']).every((b) => b === 0)).toBe(true);
  });
  test('chosen = the battery\'s accent fill, ink border and ink ring, no glow', () => {
    const c = decls('.sae-mcq-opt.is-chosen');
    expect(c.background).toBe('var(--sae-accent)');
    expect(c['border-color']).toBe('var(--sae-ink)');
    expect(c['box-shadow']).toBe('0 0 0 3px var(--sae-ink)');
    expect(blurs(c['box-shadow']).every((b) => b === 0)).toBe(true);
  });
  test('speaking + chosen = the fill with the ring (the ink ring, then the accent ring outside it), no glow', () => {
    const b = decls('.sae-mcq-opt.is-chosen.is-speaking');
    expect(b.background).toBe('var(--sae-accent)');
    expect(b['box-shadow']).toBe('0 0 0 3px var(--sae-ink),0 0 0 7px var(--sae-accent)');
    expect(blurs(b['box-shadow']).every((x) => x === 0)).toBe(true);
  });
  test('no MCQ card state carries a glow (a blurred shadow) brighter than the held choice', () => {
    for (const sel of ['.sae-mcq-opt.is-speaking', '.sae-mcq-opt.is-chosen', '.sae-mcq-opt.is-chosen.is-speaking', '.sae-mcq-opt.is-ready']) {
      const d = decls(sel) || {};
      expect({ sel, glow: blurs(d['box-shadow']).some((x) => x > 0) }).toEqual({ sel, glow: false });
    }
    // the idle (waiting) card stays dimmed as today
    expect(decls('.sae-mcq-opt.is-waiting')).toEqual({ opacity: '.55', 'border-color': 'transparent', 'box-shadow': 'none' });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// variant on 100 % of story / MCQ results: the passage and its MCQ record the rotation variant this phone ran
// (sa-page.js rotate), the same id for both; without rotation the key is there and null, never absent.
// ------------------------------------------------------------------------------------------------------------------
describe('sa_r28_mcq: every story and MCQ result records its variant', () => {
  const { rotate } = require('../sa/sa-page');
  const vq = (vid) => QS.map((x) => Object.assign({}, x, { id: `${x.id}.${vid}` }));
  const passage = (extra) => Object.assign({
    id: 'ur.story_w3', kind: 'passage', subtask: 'oral_reading_fluency', response: 'record', time_limit_s: 60,
    passage: { text: 'x' }, items: words,
  }, extra || {});
  const VARIANTS = ['rwp2026', 'select2024'];
  const rotating = () => ({
    battery_id: 'b', ui: { r28_mcq: true },
    tasks: [
      passage({ variants: VARIANTS.map((id) => ({ id, passage: { text: id }, items: words })) }),
      mcqTask(QS, { depends_on: null, variants: VARIANTS.map((id) => ({ id, items: vq(id) })) }),
    ],
  });
  function runStory(battery) {
    const c = clock();
    const b = { battery_id: battery.battery_id, ui: battery.ui, tasks: battery.tasks.filter((t) => t.id === 'ur.story_w3') };
    const r = core.createRunner({ battery: b, now: c.now, onEvent: () => {} });
    r.start(); r.instructionDone(); r.begin();
    c.add(10 * 60 * 1000); r.tick();
    if (r.view().phase === 'last_word') r.lastWord(12);
    return r.results().find((x) => x.task_id === 'ur.story_w3');
  }
  function runMcq(battery) {
    const c = clock();
    const b = { battery_id: battery.battery_id, ui: battery.ui, tasks: battery.tasks.filter((t) => t.kind === 'mcq') };
    const r = core.createRunner({ battery: b, now: c.now, onEvent: () => {} });
    r.start(); r.instructionDone(); r.begin();
    for (let i = 0; i < 10 && r.view().phase === 'running'; i += 1) { r.promptDone(); r.answer(0); }
    return r.results().find((x) => x.task_id === 'ur.story_mcq_w3');
  }
  test('rotated to each variant in turn: the MCQ result carries variant = that id, and the story the same id', () => {
    const seen = new Set();
    for (let i = 0; i < 200 && seen.size < VARIANTS.length; i += 1) {
      const b = rotate(rotating(), `seed-${i}`);
      const vid = b.tasks[1].variant.id;
      expect(b.tasks[0].variant.id).toBe(vid); // the passage and its questions stay together
      const m = runMcq(b);
      const s = runStory(b);
      expect(m).toHaveProperty('variant', vid);
      expect(s).toHaveProperty('variant', vid);
      expect(m.answers[0].item_id).toBe(`ur.story_w3.q1.${vid}`); // the variant's own questions were asked
      seen.add(vid);
    }
    expect([...seen].sort()).toEqual([...VARIANTS].sort());
  });
  test('no rotation: the MCQ and the story results carry variant null (the key present, never undefined)', () => {
    const plain = { battery_id: 'b', ui: { r28_mcq: true }, tasks: [passage(), mcqTask(QS, { depends_on: null })] };
    const m = runMcq(rotate(plain, 'seed-0'));
    const s = runStory(rotate(plain, 'seed-0'));
    expect(m).toHaveProperty('variant', null);
    expect(s).toHaveProperty('variant', null);
  });
  test('OFF (no r28_mcq): the mcq-kind task result is as today (no variant key)', () => {
    const b = rotate(Object.assign(rotating(), { ui: {} }), 'seed-1');
    const m = runMcq(b);
    expect(m).not.toHaveProperty('variant');
  });
});

describe('sa_r28_mcq core: a replay pauses both clocks until its read-out ends (lead ruling: count from the end of the last play)', () => {
  test('replayStart(): no Next, no auto replay, no answer while the re-read runs; the clocks restart at its promptDone()', () => {
    const { r, c, events } = solo();
    r.promptDone();
    const nextMs = 30 * 1000; // RDF auto (solo() mounts without manual): the per-mode wait, not the bank's 15 s
    c.add(nextMs - 6000);
    expect(r.replayStart()).toBe(true);
    c.add(9000);
    expect(r.tick()).toBeNull();
    expect(r.view().offer_next).toBe(false);
    r.promptDone();
    c.add(nextMs - 1000);
    expect(r.view().offer_next).toBe(false);
    c.add(1500);
    expect(r.view().offer_next).toBe(true);
    expect(events.filter((e) => e.type === 'replay' && e.value === 'auto')).toHaveLength(0);
  });
  test('OFF (no r28_mcq) or another task kind: replayStart() does nothing', () => {
    const { r, c } = solo({}, { r28_mcq: false });
    r.promptDone();
    c.add(16000);
    expect(r.replayStart()).toBe(false);
    expect(r.view().offer_next).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// B.3 coach-led fit: on a 360×640 phone, coach-led, the four answer cards are on screen WHOLE (ring and fill) and the
// Next offered at 15 s is on screen, without scrolling, on the bank's longest question and longest answer set (UR, EN).
// A real browser lays the screen out (jsdom has no layout); skipped without playwright-core (PWCORE=<path>).
// ------------------------------------------------------------------------------------------------------------------
let chromium = null;
try { ({ chromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const PWEXEC = process.env.PWCHROME_EXE || (chromium ? (() => { try { return chromium.executablePath(); } catch (_) { return null; } })() : null);
const maybeBrowser = chromium && PWEXEC && require("fs").existsSync(PWEXEC) ? describe : describe.skip; // no browser here: skipped, never red

/** The bank's longest question (code points) and longest four-answer set, per language: the worst case for the fit. */
function longestOf(lang) {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test');
  const qs = JSON.parse(fs.readFileSync(path.join(dir, 'item-bank.sa-r28.v1.json'), 'utf8')).mcq.questions;
  const prompts = {};
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && qs[o.id] && o.prompt != null && !(o.id in prompts)) prompts[o.id] = typeof o.prompt === 'string' ? o.prompt : String(o.prompt.text || '');
    Object.keys(o).forEach((k) => walk(o[k]));
  })(JSON.parse(fs.readFileSync(path.join(dir, 'item-bank.sa.v1.json'), 'utf8')));
  const cp = (s) => Array.from(String(s)).length;
  const ids = Object.keys(qs).filter((k) => k.startsWith(lang + '.'));
  const q = ids.filter((k) => prompts[k]).map((k) => prompts[k]).sort((a, b) => cp(b) - cp(a))[0];
  const sum = (o) => o.reduce((s, x) => s + cp(x), 0);
  const options = ids.map((k) => qs[k].options).sort((a, b) => sum(b) - sum(a))[0];
  return { q, options };
}

maybeBrowser('sa_r28_mcq coach-led on a 360×640 phone: four whole cards, the replay and the coach\'s Next on screen in every coach state (B.3, coach-led fit)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  /** The page: the MCQ task alone, coach-led, with a voice whose lines end only when the test says (window.__end()). */
  function page(lang, ui, urFit) {
    const w = longestOf(lang);
    const item = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: w.q, audio: `sa/v5/${lang}/syn_q${n}.mp3` }, options: w.options,
      option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
    const task = mcqTask([item(1), item(2)], { id: `${lang}.story_mcq_w3`, lang, depends_on: null });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0;
  var cur = null;
  function speak() {
    var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5;
    var line = { a: a };
    cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; });
  }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(Object.assign({ r28_mcq: true }, ui))}, tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: true, onEvent: function () {} });
  var el = document.getElementById('m');
  var view = SAE.ui.mount(el, { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: true, handover: false, ur_fit: ${urFit},
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
  window.__view = view; window.__runner = runner;
</script></body></html>`;
  }
  const measure = () => document.fonts.ready.then(() => {
    const vh = window.innerHeight;
    const R = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), h: Math.round(b.height) }; };
    const seen = (e) => { const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + Math.min(10, b.width / 2), (b.top + b.bottom) / 2); return !!hit && e.contains(hit); };
    // a card is whole when its ring (box-shadow ≤ 7 px) is inside the viewport and nothing covers its top or bottom
    const cards = Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => {
      const b = c.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const hitTop = document.elementFromPoint(x, b.top + 3);
      const hitBottom = document.elementFromPoint(x, Math.min(vh - 1, b.bottom - 3));
      return Object.assign(R(c), { ring_bottom: Math.round(b.bottom + 7), shown: !!(hitTop && c.contains(hitTop)) && !!(hitBottom && c.contains(hitBottom)), cls: c.className });
    });
    const next = document.querySelector('.sa-next');
    const rb = document.querySelector('.sae-mcq-replay');
    const body = document.querySelector('.sae-mcq .sae-body');
    const screen = document.querySelector('.sae-screen');
    const qEl = document.querySelector('.sae-mcq-q');
    const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
    return {
      vh, page_h: document.documentElement.scrollHeight, inner_scroll: over(screen) + over(body),
      nastaliq: document.documentElement.lang !== 'ur' || document.fonts.check(getComputedStyle(qEl).font, qEl.textContent),
      cards, replay: rb ? R(rb) : null,
      next: next ? Object.assign(R(next), { shown: seen(next), in_head: !!next.closest('.sae-mcq-head') }) : null,
      foot_next: !!document.querySelector('.sae-foot .sa-next'),
      fold_open: !!document.querySelector('details.sae-mcq-coach[open]'),
      coach_line: !!document.querySelector('.sae-mcq-coach-line'),
      q_font: qEl ? parseFloat(getComputedStyle(qEl).fontSize) : 0,
    };
  });
  /** Every coach state of one question: listening (the question being read), speaking (answer 2 lit), chosen (answer 4
   *  held while answer 3 is read), then on a fresh page the offered Next and the coach's fold open over it. */
  async function states(lang, ui, urFit, shots) {
    const out = {};
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: shots ? 2 : 1 });
      const p = await ctx.newPage();
      const html = page(lang, ui, urFit);
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
        if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
        if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(400);
      return { ctx, p };
    };
    const snap = async (p, name) => {
      await p.waitForTimeout(250);
      out[name] = await p.evaluate(measure);
      if (shots) await p.screenshot({ path: path.join(shots, `${name}_${lang}${urFit ? '' : '_plain'}.png`) });
    };
    const endLine = async (p, gapMs) => { await p.evaluate(() => window.__end()); await p.waitForTimeout(gapMs); };
    let { ctx, p } = await open();
    await snap(p, 'listening');
    await endLine(p, 900); // the question ends; 600 ms swallow, then answer 1 is read
    await endLine(p, 600); // answer 1 ends; 400 ms gap, then answer 2 is read
    await snap(p, 'speaking');
    await endLine(p, 600); // answer 3 is read
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-opt')[3].click());
    await snap(p, 'chosen');
    await ctx.close();
    ({ ctx, p } = await open());
    for (let k = 0; k < 5; k++) await endLine(p, k === 0 ? 900 : 600); // the whole read-out, no choice
    for (let k = 0; k < 6; k++) { // past the coach-led wait (15 s); an auto replay in between restarts it
      await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
      await p.waitForTimeout(300);
      while (await p.evaluate(() => window.__end())) await p.waitForTimeout(700);
      const drawn = await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sa-next'); });
      if (drawn) break;
    }
    await snap(p, 'offernext');
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); if (d) { d.open = true; d.dispatchEvent(new Event('toggle')); } });
    await snap(p, 'foldopen');
    await ctx.close();
    if (process.env.SA_FIT_DEBUG) process.stdout.write(`MCQFIT ${lang} ${urFit ? 'layout' : 'plain'} ${JSON.stringify(out)}\n`);
    return out;
  }
  // the layout switches the coach-led battery carries (ur_fit, r8_layout, r8_lang_switch, r9_comp_text, r9_scroll_cue,
  // r10_urdu_fit): the Urdu body scrolls by itself there and the Urdu labels are padded to their ink
  const LAYOUT = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true };
  for (const lang of ['ur', 'en']) {
    for (const [name, ui, urFit] of [['the plain page', {}, false], ['the layout switches on (ur_fit, r8, r9, r10)', LAYOUT, true]]) {
      test(`${lang}, ${name}, the longest question and answers: listening, speaking, chosen, Next offered, fold open — nothing scrolls, nothing moves`, async () => {
        const shots = process.env.SA_FIT_SHOTS || null;
        const r = await states(lang, ui, urFit, shots);
        const at = r.listening;
        expect(r.speaking.cards.map((c) => /is-speaking/.test(c.cls))).toEqual([false, true, false, false]);
        expect(/is-chosen/.test(r.chosen.cards[3].cls)).toBe(true);
        expect(r.offernext.next).not.toBeNull();
        expect(r.foldopen.fold_open).toBe(true);
        for (const [state, m] of Object.entries(r)) {
          expect({ state, coach_line: m.coach_line, nastaliq: m.nastaliq }).toEqual({ state, coach_line: true, nastaliq: true });
          expect({ state, page_h: m.page_h, inner_scroll: m.inner_scroll }).toEqual({ state, page_h: m.vh, inner_scroll: 0 });
          expect(m.cards).toHaveLength(4);
          m.cards.forEach((c, i) => {
            // whole and seen (an open fold may lie over them as an overlay, but never pushes them: positions below)
            if (state !== 'foldopen') expect({ state, card: i + 1, whole: c.ring_bottom <= m.vh && c.top >= 0 && c.shown }).toEqual({ state, card: i + 1, whole: true });
            expect({ state, card: i + 1, inside: c.ring_bottom <= m.vh && c.top >= 0 }).toEqual({ state, card: i + 1, inside: true });
            expect(c.h).toBeGreaterThanOrEqual(56); // B.3: the cards never shrink below their minimum
            // the cards stay where they are in every coach state
            expect({ state, card: i + 1, top: c.top, h: c.h }).toEqual({ state, card: i + 1, top: at.cards[i].top, h: at.cards[i].h });
          });
          expect({ state, replay: m.replay }).toEqual({ state, replay: at.replay });
          expect(m.q_font).toBeGreaterThanOrEqual(lang === 'ur' ? 22 : 20);
        }
        // the coach's Next: in the head row beside the replay, never in the foot, on screen
        const n = r.offernext.next;
        expect({ in_head: n.in_head, foot: r.offernext.foot_next, shown: n.shown, inside: n.top >= 0 && n.bottom <= r.offernext.vh })
          .toEqual({ in_head: true, foot: false, shown: true, inside: true });
      }, 120000);
    }
  }
});

// ------------------------------------------------------------------------------------------------------------------
// B.3 round 5, coach-led on a 360×640 phone with the production layout switches and the house Nastaliq: whole glyphs
// on every served question and answer set (the sweep), the coach's line clear of the fold, the coach's Next in the
// coach's register and away from the child's replay, and the modal fold's close at once. Ink is measured from pixels:
// one element shown at a time, a pixel is ink when its luminance < 120, at 2× DPR.
// ------------------------------------------------------------------------------------------------------------------
/** Every served question of a language and its own four answers (the bank's story questions with a prompt). */
function servedOf(lang) {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test');
  const qs = JSON.parse(fs.readFileSync(path.join(dir, 'item-bank.sa-r28.v1.json'), 'utf8')).mcq.questions;
  const prompts = {};
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && qs[o.id] && o.prompt != null && !(o.id in prompts)) prompts[o.id] = typeof o.prompt === 'string' ? o.prompt : String(o.prompt.text || '');
    Object.keys(o).forEach((k) => walk(o[k]));
  })(JSON.parse(fs.readFileSync(path.join(dir, 'item-bank.sa.v1.json'), 'utf8')));
  return Object.keys(qs).filter((k) => k.startsWith(lang + '.') && prompts[k]).map((k) => ({ id: k, q: prompts[k], options: qs[k].options }));
}

maybeBrowser('sa_r28_mcq coach-led phone, round 5: whole Nastaliq glyphs on every served question and answer set; the coach\'s Next; the fold closes at once (B.3)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });
  const LAYOUT = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true };
  const sizes = {};
  afterAll(() => { if (process.env.SA_FIT_SIZES) fs.writeFileSync(process.env.SA_FIT_SIZES, JSON.stringify(sizes, null, 1)); });

  function page(lang, qText, options) {
    const item = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: qText, audio: `sa/v5/${lang}/syn_q${n}.mp3` }, options,
      option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
    const task = mcqTask([item(1), item(2)], { id: `${lang}.story_mcq_w3`, lang, depends_on: null });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0; window.__ev = []; var cur = null;
  function speak() { var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; }); }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(Object.assign({ r28_mcq: true }, LAYOUT))}, tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: true, onEvent: function (e) { window.__ev.push(e); } });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: true, handover: false, ur_fit: true,
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); runner.begin(); view.render(); window.__view = view;
</script></body></html>`;
  }
  async function open(lang, qText, options) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const html = page(lang, qText, options);
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    return { ctx, p };
  }
  /** Ink rows (CSS px from the page top) of a clip of the page: luminance < 120 at 2× DPR. */
  async function ink(p, y0, y1, x0, x1) {
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(640, Math.ceil(y1));
    const png = await p.screenshot({ clip: { x: x0 || 0, y: y0, width: (x1 || 360) - (x0 || 0), height: y1 - y0 } });
    return p.evaluate(async ([b64, top]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; const rows = [];
      for (let y = 0; y < c.height; y++) { for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120) { rows.push(top + y / 2); break; } } }
      return rows;
    }, [png.toString('base64'), y0]);
  }
  const hide = (p, sels, on) => p.evaluate(([s, v]) => s.forEach((x) => document.querySelectorAll(x).forEach((e) => { e.style.visibility = v ? 'hidden' : ''; })), [sels, on]);
  /** The question card's ink against its clip box (overflow made visible, everything near it hidden), its line boxes,
   *  the coach's line's last ink against the fold's top, the cards, and the fit. */
  async function stemAndFit(p) {
    const g = await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); const cs = getComputedStyle(q); const r = q.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(q);
      const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
      const line = document.querySelector('.sae-mcq-coach-line').getBoundingClientRect();
      return { top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom - parseFloat(cs.borderBottomWidth),
        lines: new Set(Array.from(rg.getClientRects()).filter((x) => x.width || x.height).map((x) => Math.round(x.top))).size,
        line_top: line.top, line_bottom: line.bottom, fold_top: document.querySelector('details.sae-mcq-coach').getBoundingClientRect().top,
        cards: Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => { const b = c.getBoundingClientRect(); return { h: Math.round(b.height), ring_bottom: Math.round(b.bottom + 7) }; }),
        page_h: document.documentElement.scrollHeight, inner_scroll: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')) };
    });
    await hide(p, ['.sae-mcq-opts', 'details.sae-mcq-coach', '.sae-mcq-coach-line'], true);
    await p.evaluate(() => { document.querySelector('.sae-mcq-q').style.overflow = 'visible'; });
    const rows = await ink(p, g.top - 30, g.bottom + 30);
    await p.evaluate(() => { document.querySelector('.sae-mcq-q').style.overflow = ''; });
    await hide(p, ['.sae-mcq-q'], true);
    await hide(p, ['.sae-mcq-coach-line'], false);
    const lr = await ink(p, g.line_top - 4, g.line_bottom + 14);
    await hide(p, ['.sae-mcq-opts', 'details.sae-mcq-coach', '.sae-mcq-coach-line', '.sae-mcq-q'], false);
    return { lines: g.lines, ink_above_top: rows.length ? +Math.max(0, g.top - rows[0]).toFixed(1) : null, ink_below_bottom: rows.length ? +Math.max(0, rows[rows.length - 1] - g.bottom).toFixed(1) : null,
      coach_line_room: lr.length ? +(g.fold_top - lr[lr.length - 1]).toFixed(1) : null, card_h: g.cards.map((c) => c.h), ring_bottom: Math.max(...g.cards.map((c) => c.ring_bottom)),
      page_h: g.page_h, inner_scroll: g.inner_scroll };
  }
  /** The open fold's answer list: each line shown alone (the fold's question and summary hidden), inside the overlay. */
  async function foldList(p) {
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = true; d.dispatchEvent(new Event('toggle')); });
    await p.waitForTimeout(150);
    const g = await p.evaluate(() => { const b = document.querySelector('.sae-mcq-coach-body').getBoundingClientRect(); const ol = document.querySelector('.sae-mcq-coach-opts');
      return { top: b.top, bottom: b.bottom, n: ol.children.length, lh: getComputedStyle(ol).lineHeight, fs: getComputedStyle(ol).fontSize }; });
    await hide(p, ['.sae-mcq-coach-body>p', 'details.sae-mcq-coach>summary'], true);
    const lines = [];
    for (let k = 0; k < g.n; k++) {
      await p.evaluate((k) => document.querySelectorAll('.sae-mcq-coach-opts li').forEach((li, i) => { li.style.visibility = i === k ? '' : 'hidden'; }), k);
      const rows = await ink(p, g.top + 1, g.bottom - 4, 8, 352);
      lines.push(rows.length ? { top: rows[0], bottom: rows[rows.length - 1] } : null);
    }
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-coach-opts li').forEach((li) => { li.style.visibility = ''; }));
    await hide(p, ['.sae-mcq-coach-body>p', 'details.sae-mcq-coach>summary'], false);
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = false; d.dispatchEvent(new Event('toggle')); });
    const gaps = lines.slice(1).map((x, i) => +(x.top - lines[i].bottom).toFixed(1));
    return { line_height: g.lh, font: g.fs, gaps, min_gap: Math.min(...gaps), overlay_bottom: +g.bottom.toFixed(1) };
  }

  for (const lang of ['ur', 'en']) {
    test(`${lang}: every served question and answer set — the stem's ink inside both clip edges and at most ${lang === 'ur' ? 2 : 3} lines, the fold list's lines ≥ 2 px apart with the overlay on screen, the coach's line clear of the fold, every card 56 px and on screen`, async () => {
      const served = servedOf(lang);
      expect(served.length).toBeGreaterThanOrEqual(12);
      const rows = {};
      for (const it of served) {
        const { ctx, p } = await open(lang, it.q, it.options);
        const nastaliq = lang !== 'ur' || await p.evaluate(() => { const q = document.querySelector('.sae-mcq-q'); return document.fonts.check(getComputedStyle(q).font, q.textContent); });
        rows[it.id] = Object.assign({ nastaliq }, await stemAndFit(p), { fold: await foldList(p) });
        await ctx.close();
      }
      // the overlay on the bank's longest question with each set: the tallest
      const w = longestOf(lang);
      const { ctx, p } = await open(lang, w.q, w.options);
      const longest = await foldList(p);
      await ctx.close();
      sizes[lang] = { longest_question_with_longest_set: longest, per_question: rows };
      for (const [id, m] of Object.entries(rows)) {
        const r = m;
        expect({ id, nastaliq: r.nastaliq, page_h: r.page_h, inner_scroll: r.inner_scroll, ring_ok: r.ring_bottom <= 640, cards: r.card_h })
          .toEqual({ id, nastaliq: true, page_h: 640, inner_scroll: 0, ring_ok: true, cards: [56, 56, 56, 56] });
        expect({ id, lines_ok: r.lines >= 1 && r.lines <= (lang === 'ur' ? 2 : 3), below: r.ink_below_bottom }).toEqual({ id, lines_ok: true, below: 0 });
        // the first line's ascender: whole on every one-line question and in Latin; a two-line Urdu question has the
        // room the 640 px budget leaves (B5 report: ≤ 11 px of the tallest stroke still above the edge)
        expect({ id, above_ok: r.ink_above_top <= (lang === 'ur' && r.lines === 2 ? 11 : 0) }).toEqual({ id, above_ok: true });
        expect({ id, coach_line_room_ok: r.coach_line_room >= 0 }).toEqual({ id, coach_line_room_ok: true });
        expect({ id, fold_min_gap_ok: r.fold.min_gap >= 2, overlay_ok: r.fold.overlay_bottom <= 640 }).toEqual({ id, fold_min_gap_ok: true, overlay_ok: true });
      }
      expect(longest.overlay_bottom).toBeLessThanOrEqual(640);
      expect(longest.min_gap).toBeGreaterThanOrEqual(2);
      // the Latin list keeps its own line height (the Urdu rules are scoped [lang=ur])
      if (lang === 'en') expect(longest.line_height).toBe('normal');
      else expect(parseFloat(longest.font)).toBeGreaterThanOrEqual(15);
    }, 600000);

    test(`${lang}: the coach's Next is in the coach's register (a dashed box, no fill, no pill) and ≥ 48 px from the child's replay; the fold's close by a tap shows the cards at once (< 150 ms, no transition)`, async () => {
      const w = longestOf(lang);
      const { ctx, p } = await open(lang, w.q, w.options);
      for (let k = 0; k < 5; k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(k === 0 ? 900 : 600); }
      for (let k = 0; k < 6; k++) {
        await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
        await p.waitForTimeout(300);
        while (await p.evaluate(() => window.__end())) await p.waitForTimeout(700);
        if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sa-next'); })) break;
      }
      const nx = await p.evaluate(() => {
        const n = document.querySelector('.sae-mcq-head .sa-next'); const rb = document.querySelector('.sae-mcq-replay');
        const a = n.getBoundingClientRect(); const b = rb.getBoundingClientRect(); const cs = getComputedStyle(n);
        const gap = a.right <= b.left ? b.left - a.right : a.left - b.right;
        return { gap: +gap.toFixed(1), border: cs.borderTopStyle, bg: cs.backgroundColor, shadow: cs.boxShadow, clipped: n.scrollWidth > n.clientWidth + 1,
          next: { left: Math.round(a.left), right: Math.round(a.right) }, replay: { left: Math.round(b.left), right: Math.round(b.right) } };
      });
      // the close: a real tap on card 1 with the fold open
      await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = true; d.dispatchEvent(new Event('toggle')); });
      await p.waitForTimeout(200);
      // a tap at card 4's centre: the overlay may lie over it (then the tap is on the overlay: card null)
      const c1 = await p.evaluate(() => { const c = document.querySelectorAll('.sae-mcq-opt')[3]; const b = c.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
        const hit = document.elementFromPoint(x, y); return { x, y, card: hit && c.contains(hit) ? 3 : null }; });
      await p.evaluate(() => { window.__t0 = null; document.addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true, once: true }); });
      await p.mouse.click(c1.x, c1.y);
      const close = await p.evaluate(() => new Promise((res) => {
        const all = () => Array.from(document.querySelectorAll('.sae-mcq-opt')).every((c) => { const b = c.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit && c.contains(hit); });
        const tick = () => { if (all()) { const body = document.querySelector('.sae-mcq-coach-body'); const tr = (e) => (e ? getComputedStyle(e).transitionDuration.split(',').map((x) => parseFloat(x) * 1000) : [0]);
          res({ ms: +(performance.now() - window.__t0).toFixed(1), fold_open: document.querySelector('details.sae-mcq-coach').open, max_transition_ms: Math.max(...tr(body), ...tr(document.querySelector('details.sae-mcq-coach'))),
            chosen: document.querySelectorAll('.sae-mcq-opt.is-chosen').length,
            close: window.__ev.filter((e) => e.type === 'fold_close').map((e) => ({ by: e.by, card: e.card })) }); } else requestAnimationFrame(tick); };
        tick();
      }));
      await ctx.close();
      sizes[`${lang}_next_and_close`] = { next: nx, close };
      expect({ border: nx.border, bg: nx.bg, shadow: nx.shadow, clipped: nx.clipped }).toEqual({ border: 'dashed', bg: 'rgba(0, 0, 0, 0)', shadow: 'none', clipped: false });
      expect(nx.gap).toBeGreaterThanOrEqual(48);
      expect({ fold_open: close.fold_open, chosen: close.chosen, close: close.close }).toEqual({ fold_open: false, chosen: 0, close: [{ by: 'tap', card: c1.card }] });
      sizes[`${lang}_next_and_close`].tap_on_card = c1.card;
      expect(close.ms).toBeLessThan(150);
      expect(close.max_transition_ms).toBeLessThanOrEqual(150);
    }, 120000);
  }
});

// RDF auto and the tablet keep their layout: every coach-fit rule sits in the one phone @media block and only matches
// the coach-led MCQ screen (the one that carries the coach's fold, which RDF auto never draws).
describe('sa_r28_mcq CSS: the coach-led phone fit leaves RDF auto and the tablet as they were (B.3, coach-led fit)', () => {
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '../sa/sa.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every top-level rule and every rule inside an @media, with the @media it sits in ('' at the top level). */
  function rules() {
    const out = []; const stack = []; let buf = '';
    for (const ch of css) {
      if (ch === '{') { stack.push(buf.trim()); buf = ''; } else if (ch === '}') {
        const head = stack.pop();
        if (!/^@/.test(head)) out.push({ sel: head, media: stack.filter((x) => /^@media/.test(x)).join(' '), body: buf.trim() });
        buf = '';
      } else buf += ch;
    }
    return out;
  }
  test('the coach-fit rules: inside @media (max-width:699px) (bar the head row\'s Next placement), each scoped to the coach-led MCQ screen', () => {
    const fit = rules().filter((r) => /:has\(\.sae-mcq-coach\)/.test(r.sel));
    expect(fit.length).toBeGreaterThanOrEqual(8);
    fit.forEach((r) => {
      // every width: only the head row's relative box and the coach's Next placed on it (the Next exists only coach-led)
      const placement = r.media === '' && /\.sae-mcq-head(>\.sae-mcq-next)?$/.test(r.sel) && !/height|font|padding|margin|gap/.test(r.body);
      expect({ sel: r.sel, media: placement ? '@media (max-width:699px)' : r.media }).toEqual({ sel: r.sel, media: '@media (max-width:699px)' });
      r.sel.split(',').forEach((one) => expect({ one: one.trim(), scoped: /\.sae-mcq(\.sae-screen)?:has\(\.sae-mcq-coach\)/.test(one) }).toEqual({ one: one.trim(), scoped: true }));
    });
  });
  test('the coach boxes take the tightening (smaller type, one box), the question clamps to two lines, the cards keep 56 px', () => {
    const fit = rules().filter((r) => r.media === '@media (max-width:699px)');
    const decl = (sel) => { const r = fit.find((x) => x.sel === sel); return r ? Object.fromEntries(r.body.split(';').filter((d) => d.includes(':')).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])) : null; };
    const line = decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-coach-line');
    expect(line).not.toBeNull();
    expect(parseFloat(line['font-size'])).toBeLessThan(14);
    expect(line.margin).toBe('0 0 -6px');
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-q')['-webkit-line-clamp']).toBe('2');
    // no rule of the fit touches a card's height
    fit.filter((r) => /sae-mcq-opt\b/.test(r.sel)).forEach((r) => expect(r.body).not.toMatch(/height/));
  });
  test('round 5: the Urdu glyph rules are coach-led, phone-only and [lang=ur]; the Latin list keeps its line height; the coach\'s Next is a dashed box at every width', () => {
    const all = rules();
    const phone = all.filter((r) => r.media === '@media (max-width:699px)');
    const ur = all.filter((r) => /(coach-opts|sae-mcq-q|coach-line)\[lang=ur\]|\[lang=ur\] \.sae-mcq(\.sae-screen)?:has/.test(r.sel) && /:has\(\.sae-mcq-coach\)/.test(r.sel));
    expect(ur.length).toBeGreaterThanOrEqual(6);
    ur.forEach((r) => expect({ sel: r.sel, media: r.media }).toEqual({ sel: r.sel, media: '@media (max-width:699px)' }));
    const decl = (sel) => { const r = phone.filter((x) => x.sel === sel).pop(); return r ? Object.fromEntries(r.body.split(';').filter((d) => d.includes(':')).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])) : null; };
    expect(parseFloat(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-coach-opts[lang=ur]')['line-height'])).toBeGreaterThanOrEqual(3.3);
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-q[lang=ur]')['padding-bottom']).toBe('13px');
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-opts').gap).toBe('4px');
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-coach-line[lang=ur]').margin).toBe('0 0 2px');
    // no rule gives the Latin (or an unscoped) fold list a line height
    all.filter((r) => /sae-mcq-coach-opts/.test(r.sel) && !/\[lang=ur\]/.test(r.sel)).forEach((r) => expect(r.body).not.toMatch(/line-height/));
    const nx = all.filter((r) => r.media === '' && /\.sae-mcq-head>\.sae-mcq-next$/.test(r.sel)).map((r) => r.body).join(';');
    expect(nx).toMatch(/border:2px dashed/);
    expect(nx).toMatch(/background:transparent/);
    expect(nx).toMatch(/box-shadow:none/);
  });
});

describe('sa_r28_mcq: of_all is the served (rotated) variant\'s question count', () => {
  const { rotate } = require('../sa/sa-page');
  const vq = (vid, n) => QS.slice(0, n).map((x) => Object.assign({}, x, { id: `${x.id}.${vid}`, gate: undefined, needs_line: undefined }));
  const VARIANTS = [{ id: 'six', n: 6 }, { id: 'five', n: 5 }];
  const battery = () => ({
    battery_id: 'b', ui: { r28_mcq: true },
    tasks: [mcqTask(QS, { depends_on: null, variants: VARIANTS.map((v) => ({ id: v.id, items: vq(v.id, v.n) })) })],
  });
  function finished(b, lost) {
    const c = clock();
    const r = core.createRunner({ battery: b, now: c.now, onEvent: () => {} });
    r.start(); r.instructionDone(); r.begin();
    b.tasks[0].items.forEach((it, i) => {
      if (i < (lost || 0)) { r.clipLost(it.id, 'prompt'); return; }
      r.promptDone(); r.answer(0);
    });
    return r.results().find((x) => x.task_id === 'ur.story_mcq_w3');
  }
  test('every rotated variant: the finished result has of_all === that variant\'s items.length (5 stays 5)', () => {
    const seen = new Set();
    for (let i = 0; i < 200 && seen.size < VARIANTS.length; i += 1) {
      const b = rotate(battery(), `seed-${i}`);
      const res = finished(b);
      expect(res.of_all).toBe(b.tasks[0].items.length);
      seen.add(b.tasks[0].variant.id);
    }
    expect([...seen].sort()).toEqual(['five', 'six']);
  });
  test('of_all is taken before the lost-clip filter: presented = of_all − lost', () => {
    const b = rotate(battery(), 'seed-0');
    const res = finished(b, 1);
    expect(res.of_all).toBe(b.tasks[0].items.length);
    expect(res.presented).toBe(res.of_all - 1);
    expect(res.unavailable).toBe(1);
  });
  test('OFF (no r28_mcq): the mcq-kind task result has no of_all key (as today)', () => {
    const b = rotate(Object.assign(battery(), { ui: {} }), 'seed-0');
    expect(finished(b)).not.toHaveProperty('of_all');
  });
});
