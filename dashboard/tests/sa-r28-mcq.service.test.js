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

  // The practice feedback after a tap (try again; after the second wrong answer the shown line) is spoken by Jugnu in
  // coach-led as in RDF auto: the question and its answers already play in both modes, and a young child cannot read
  // the feedback line. The line still shows on the screen.
  for (const manual of [true, false]) {
    test(`practice (${manual ? 'coach-led' : 'RDF auto'}): Jugnu says the feedback after each wrong answer; the line is on the screen too`, async () => {
      setup();
      const p = { id: 'ur.story_mcq_w3.p1', passage: { text: 'practice story' }, prompt: { text: 'practice q', audio: 'sa/v5/ur/syn_pq.mp3' },
        options: ['w', 'x', 'y', 'z'], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_p_o${k}.mp3`), target_index: 1, key: 2,
        feedback: { wrong: { text: 'the answer was x', audio: 'sa/v5/ur/syn_p_wrong.mp3', lang: 'ur' } } };
      const extra = manual ? { runner: { manual: true }, ui: { manual: true } } : {};
      const { el, voice, runner } = mountMcq(Object.assign({ practice: true, task: { practice: [p] } }, extra));
      await wait(20);
      expect(runner.view().phase).toBe('practice');
      for (let k = 0; k < 5; k++) await voice.speakNext(40);
      const before = voice.lines.length;
      cards(el)[3].click();
      await wait(1100);
      const fbText = el.querySelector('.sae-fb').textContent;
      expect(fbText).not.toBe(' ');
      const tryAgain = voice.lines.slice(before).map((l) => l.textObj);
      expect(tryAgain).toHaveLength(1);
      expect(tryAgain[0] && (tryAgain[0].text || tryAgain[0].ur)).toBe(fbText);
      await voice.speakNext(40); // the try-again line
      await wait(1400);
      for (let k = 0; k < 5; k++) await voice.speakNext(40);
      const mid = voice.lines.length;
      cards(el)[2].click();
      await wait(1100);
      expect(voice.lines.slice(mid).map((l) => l.textObj && l.textObj.text)).toEqual(['the answer was x']);
      expect(el.querySelector('.sae-fb').textContent).toBe('the answer was x');
      expect(cards(el)[1].classList.contains('is-shown')).toBe(true);
      await voice.speakNext(40);
    }, 30000);
  }

  // The MCQ's instruction (how the question and its four answers are read) is said by Jugnu in coach-led too, as in RDF
  // auto, and the ready screen's lines with it; the coach's own line stays drawn on the coach's screen.
  for (const manual of [true, false]) {
    test(`instruction (${manual ? 'coach-led' : 'RDF auto'}): Jugnu says the MCQ's instruction, then the ready lines`, async () => {
      setup();
      const core2 = require('../sa/sa-core');
      const ui = require('../sa/sa-ui');
      const INTRO = { text: 'mcq instruction line', audio: 'sa/v5/ur/mcq_intro.mp3', lang: 'ur' };
      const script = { intro: INTRO, test_intro: { text: 'your turn line', lang: 'ur' }, begin: { text: 'begin line', lang: 'ur' } };
      const tasks = [mcqTask(QS.slice(0, 2), { depends_on: null, script, coach_text: { text: 'coach line' } })];
      const battery = { battery_id: 'b', tasks, ui: { r28_mcq: true }, lines: { coach_will_instruct: { text: 'coach will instruct line', lang: 'ur' } } };
      const runner = core2.createRunner({ battery, onEvent: () => {}, manual });
      const speak = jest.fn(() => Promise.resolve());
      const said = () => speak.mock.calls.map((x) => (x[0] && x[0].text) || x[1]);
      const el = document.getElementById('m');
      const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'proctored', handover: false, speak, manual, r28: { letter_pick: false, mcq: true, ceiling: false } });
      views.push(view);
      runner.start(); view.render();
      await wait(60);
      expect(runner.view().phase).toBe('instruction');
      expect(said()).toContain('mcq instruction line');
      if (manual) expect(el.querySelector('.sae-coach-brief .sae-coach-text').textContent).toBe('coach line');
      runner.instructionDone(); view.render();
      await wait(60);
      expect(runner.view().phase).toBe('ready');
      expect(said().filter((x) => x === 'your turn line' || x === 'begin line')).toEqual(['your turn line', 'begin line']);
    });
  }

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

  test('both modes: the offered Next is in the head row beside the replay, never the foot (B.3 fit; RDF auto the same since the foot button hid the options on a phone)', async () => {
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
      expect({ coach, head: !!head, foot: !!foot }).toEqual({ coach, head: true, foot: false });
      // after the replay, Jugnu and the replay keep their order; the Next is the row's last child, in both modes
      const row = Array.from(m.el.querySelector('.sae-mcq-head').children);
      expect(row[row.length - 1]).toBe(head);
      expect(row.indexOf(m.el.querySelector('.sae-mcq-replay'))).toBeLessThan(row.indexOf(head));
      expect(m.el.querySelector('.sae-foot')).toBeNull(); // no foot at all: nothing below the cards to come and go
      head.click();
      expect(m.runner.view().item_index).toBe(1); // Next moves on (a skip), as the foot's did
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
    // every close carries the card key (null when no card was under the tap), the summary's too: a JSON line keeps it
    const closes = events.filter((e) => e.type === 'fold_close'); // the raw logged events, not the test's projection
    expect(closes.map((e) => [e.by, e.card])).toEqual([['tap', 2], ['summary', null]]);
    expect(closes.map((e) => JSON.parse(JSON.stringify(e)).hasOwnProperty('card'))).toEqual([true, true]);
  }, 20000);

  test('since_fold_ms: the fold closed on the question, the standing tap ~400 ms later → since_fold_ms ≈ 400 on the stored answer; the next question, no fold closed on it → null', async () => {
    setup();
    const { el, voice, answers, runner } = mountMcq({ runner: { manual: true }, ui: { manual: true } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    setFold(el, true);
    cards(el)[2].click(); // closes the fold only
    await wait(400);
    cards(el)[2].click();
    await wait(1100);
    expect(answers).toHaveLength(1);
    const s0 = answers[0].meta.since_fold_ms;
    expect(s0).toBeGreaterThanOrEqual(390);
    expect(s0).toBeLessThan(700);
    const stored = () => { const sn = runner.snapshot(); return sn.current ? sn.current.answers : (sn.results[sn.results.length - 1] || {}).answers || []; };
    expect(stored()[0].since_fold_ms).toBe(s0);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(100);
    cards(el)[1].click();
    await wait(1100);
    expect(answers).toHaveLength(2);
    expect(answers[1].meta).toHaveProperty('since_fold_ms', null);
    expect(stored()[1]).toHaveProperty('since_fold_ms', null);
  }, 20000);

  test('the sandbox Jump row (dev tools on): not drawn on the MCQ\'s question or practice screens', async () => {
    setup();
    const dev = { runner: { manual: true, dev_tools: true }, ui: { manual: true, devJump: () => {} } };
    const q = mountMcq(dev);
    await wait(20);
    expect(q.runner.view().phase).toBe('running');
    expect(!!q.el.querySelector('.sae-mcq')).toBe(true);
    expect(q.el.querySelector('.sae-devjump-row')).toBeNull();
  });

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
      { type: 'fold_close', task_id: 'ur.letter_pick10', item_id: 'ur.letter_pick10.01', by: 'summary', card: null },
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

  // ---- round 9 (row 31, SPEC B-7 in the practice): the practice passage is its own step, then the question draws as
  // the scored screen does; the guard for a passage without a clip key ----
  const PP_CLIP = 'sa/v5/ur/syn_pp.mp3';
  const pItem = (passage) => ({ id: 'ur.story_mcq_w3.p1', passage, prompt: { text: 'practice q', audio: 'sa/v5/ur/syn_pq.mp3' },
    options: ['w', 'x', 'y', 'z'], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_p_o${k}.mp3`), target_index: 1, key: 2 });
  const coachLed = { runner: { manual: true }, ui: { manual: true } };
  const pp = (events) => events.filter((e) => e.type === 'practice_passage');
  const clipOf = (l) => (l.audioObj && (l.audioObj.audio || l.audioObj)) || null;
  const passageOn = (el) => !!el.querySelector('.sae-mcq-passage');

  for (const [mode, extra] of [['coach-led', coachLed], ['RDF auto', {}]]) {
    test(`row 31 (${mode}): the passage step: the passage whole, its clip playing, NO cards; a tap on the text never ends it; it ends at the clip's end + 600 ms; then the question with no passage, read as the scored one; practice_passage once; the retry never repeats the step`, async () => {
      setup();
      const { el, voice, runner, events } = mountMcq(Object.assign({ practice: true, task: { practice: [pItem({ text: 'practice story', audio: PP_CLIP })] } }, extra));
      await wait(30);
      expect(runner.view().phase).toBe('practice');
      expect({ passage: passageOn(el), text: el.querySelector('.sae-mcq-passage') && el.querySelector('.sae-mcq-passage').textContent, cards: cards(el).length,
        stem: !!el.querySelector('.sae-mcq-q') }).toEqual({ passage: true, text: 'practice story', cards: 0, stem: false });
      // the first clip asked is the passage's, and the replay waits while it plays
      for (let i = 0; i < 50 && !voice.lines.length; i++) await wait(10);
      expect(clipOf(voice.lines[0])).toBe(PP_CLIP);
      voice.play(voice.lines[0]);
      expect(el.querySelector('.sae-mcq-replay').disabled).toBe(true);
      el.querySelector('.sae-mcq-passage').click(); // a child's tap on the passage: nothing
      await wait(60);
      expect({ passage: passageOn(el), cards: cards(el).length, logged: pp(events).length }).toEqual({ passage: true, cards: 0, logged: 0 });
      voice.end(voice.lines[0]);
      await wait(300); // inside the 600 ms settle: still the passage step
      expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: true, cards: 0 });
      await wait(450);
      // the question: as the scored screen (no passage element), the fold = prompt + options only
      expect({ passage: passageOn(el), cards: cards(el).length, stem: el.querySelector('.sae-mcq-q').textContent }).toEqual({ passage: false, cards: 4, stem: 'practice q' });
      if (mode === 'coach-led') {
        const body = el.querySelector('.sae-mcq-coach-body');
        expect({ prompt: body.querySelector('.sae-coach-line').textContent, opts: Array.from(body.querySelectorAll('li')).map((x) => x.textContent), story: /practice story/.test(body.textContent) })
          .toEqual({ prompt: 'practice q', opts: ['w', 'x', 'y', 'z'], story: false });
      } else expect(el.querySelector('.sae-mcq-coach')).toBeNull();
      const log = pp(events);
      expect(log.map((e) => ({ task_id: e.task_id, item_id: e.item_id, audio: e.audio, by: e.by }))).toEqual([{ task_id: 'ur.story_mcq_w3', item_id: 'ur.story_mcq_w3.p1', audio: true, by: 'clip_end' }]);
      expect(log[0].ms).toBeGreaterThanOrEqual(600);
      // the read-out: the question's clip, then its four options (the scored behaviour)
      for (let k = 0; k < 5; k++) { const l = await voice.speakNext(40); expect(clipOf(l)).toBe(k === 0 ? 'sa/v5/ur/syn_pq.mp3' : `sa/v5/ur/syn_p_o${k}.mp3`); }
      cards(el)[3].click();
      await wait(1100);
      await voice.speakNext(40); // "try again": Jugnu says it in both modes (coach-led too, as the question's clips)
      await wait(1400);
      // the retry re-reads the question, never the passage
      for (let k = 0; k < 5; k++) { const l = await voice.speakNext(40); expect(clipOf(l)).toBe(k === 0 ? 'sa/v5/ur/syn_pq.mp3' : `sa/v5/ur/syn_p_o${k}.mp3`); }
      expect(passageOn(el)).toBe(false);
      cards(el)[2].click();
      await wait(1100);
      // target_index kept as the bank's (1): the right card shown is card 2
      expect({ right: cards(el)[1].classList.contains('is-right'), shown: cards(el)[1].classList.contains('is-shown'), passage: passageOn(el), logged: pp(events).length })
        .toEqual({ right: true, shown: true, passage: false, logged: 1 });
      expect(voice.lines.filter((l) => clipOf(l) === PP_CLIP)).toHaveLength(1);
    }, 30000);

    test(`row 31 guard (${mode}): a passage with NO clip key (an object without audio, or a bare string) has no step: the question draws at once with its own clips, never the passage; practice_passage {ms: 0, audio: false} once`, async () => {
      for (const passage of [{ text: 'practice story' }, 'practice story']) {
        setup();
        const { el, voice, runner, events } = mountMcq(Object.assign({ practice: true, task: { practice: [pItem(passage)] } }, extra));
        await wait(30);
        expect(runner.view().phase).toBe('practice');
        expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: false, cards: 4 });
        const l = await voice.speakNext(40);
        expect(clipOf(l)).toBe('sa/v5/ur/syn_pq.mp3');
        expect(pp(events).map((e) => ({ item_id: e.item_id, ms: e.ms, audio: e.audio }))).toEqual([{ item_id: 'ur.story_mcq_w3.p1', ms: 0, audio: false }]);
        for (let k = 0; k < 4; k++) await voice.speakNext(40);
        expect(voice.lines.some((x) => /practice story/.test(JSON.stringify(x.textObj || '')))).toBe(false);
        views.forEach((v) => v.destroy()); views = [];
        for (const k of Object.keys(keep)) global[k] = keep[k];
        dom.window.close();
      }
    }, 30000);

    test(`row 31 guard (${mode}): the passage clip lost at play time ends the step: the question draws, audio:false logged once, nothing stalls`, async () => {
      setup();
      const { el, voice, events } = mountMcq(Object.assign({ practice: true, lost: [PP_CLIP], task: { practice: [pItem({ text: 'practice story', audio: PP_CLIP })] } }, extra));
      await wait(200);
      expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: false, cards: 4 });
      expect(pp(events).map((e) => ({ audio: e.audio, by: e.by }))).toEqual([{ audio: false, by: 'clip_lost' }]);
      const l = await voice.speakNext(40);
      expect(clipOf(l)).toBe('sa/v5/ur/syn_pq.mp3');
    }, 20000);
  }

  test('row 31: the child\'s replay in the passage step (after its clip, inside the settle) replays the passage key and nothing else; the step then ends at that clip\'s end + 600 ms', async () => {
    setup();
    const { el, voice, events } = mountMcq({ practice: true, task: { practice: [pItem({ text: 'practice story', audio: PP_CLIP })] } });
    await voice.speakNext(40);
    await wait(100);
    const rb = el.querySelector('.sae-mcq-replay');
    expect(rb.disabled).toBe(false);
    rb.click();
    await wait(20);
    expect(clipOf(voice.lines[1])).toBe(PP_CLIP);
    expect(passageOn(el)).toBe(true);
    await wait(800); // the replayed clip still playing: the step does not end
    expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: true, cards: 0 });
    await voice.speakNext(40);
    await wait(750);
    expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: false, cards: 4 });
    expect(events.filter((e) => e.type === 'replay').map((e) => e.what)).toEqual(['passage']);
    expect(pp(events).map((e) => e.by)).toEqual(['clip_end']);
    const l = await voice.speakNext(40);
    expect(clipOf(l)).toBe('sa/v5/ur/syn_pq.mp3');
  }, 20000);

  test('row 31 (coach-led, no Skip drawn): the coach\'s Next is in the head row only once the passage clip has ended; it then ends the step (by: coach_next, audio: true); the question draws', async () => {
    setup();
    const { el, voice, events } = mountMcq(Object.assign({ practice: true, task: { practice: [pItem({ text: 'practice story', audio: PP_CLIP })] } }, coachLed));
    await wait(30);
    voice.play(voice.lines[0]);
    await wait(30);
    expect(el.querySelector('.sae-mcq-head > .sae-mcq-next')).toBeNull(); // while the clip plays: no Next
    voice.end(voice.lines[0]);
    await wait(50);
    const nx = el.querySelector('.sae-mcq-head > .sae-mcq-next');
    expect({ next: !!nx, passage: passageOn(el) }).toEqual({ next: true, passage: true });
    nx.click();
    await wait(30);
    expect({ passage: passageOn(el), cards: cards(el).length }).toEqual({ passage: false, cards: 4 });
    expect(pp(events).map((e) => ({ audio: e.audio, by: e.by }))).toEqual([{ audio: true, by: 'coach_next' }]);
    await wait(700); // the settle's own end does not log or draw again
    expect(pp(events)).toHaveLength(1);
  }, 20000);

  test('row 32 (coach-led, round 11): the coach\'s line is drawn above the fold on the passage step and the question frames, never in the fold\'s body (sa.css hides it on the Urdu phone\'s question frames); RDF auto draws neither', async () => {
    setup();
    const UR = 'جگنو سوال اور چاروں جواب خود پڑھے گا۔ آپ نہ پڑھیں، نہ ترجمہ کریں، نہ جواب بتائیں۔ بچے کو خود جواب دبانے دیں۔';
    const where = (el) => Array.from(el.querySelectorAll('.sae-mcq-coach-line')).map((x) => ({ in_fold: !!x.closest('.sae-mcq-coach-body'),
      first: !x.closest('.sae-mcq-coach-body') || x === x.parentNode.firstElementChild, text: x.textContent === UR }));
    const { el, voice } = mountMcq(Object.assign({ practice: true, task: { practice: [pItem({ text: 'practice story', audio: PP_CLIP })] } }, coachLed));
    await wait(30);
    expect(passageOn(el)).toBe(true);
    expect(where(el)).toEqual([{ in_fold: false, first: true, text: true }]); // the passage step: above only
    voice.play(voice.lines[0]); await wait(20); voice.end(voice.lines[0]); await wait(50);
    el.querySelector('.sae-mcq-head > .sae-mcq-next').click();
    await wait(30);
    expect(cards(el)).toHaveLength(4);
    expect(where(el)).toEqual([{ in_fold: false, first: true, text: true }]); // practice question: above only (round 11)
    expect(el.querySelector('.sae-mcq-coach-body').firstElementChild.matches('p.sae-say.sae-coach-line')).toBe(true); // the fold opens on the prompt
    views.forEach((v) => v.destroy()); views = [];
    const sc = mountMcq(coachLed);
    await wait(20);
    expect(where(sc.el)).toEqual([{ in_fold: false, first: true, text: true }]); // scored question: above only (round 11)
    expect(sc.el.querySelector('.sae-mcq-coach-body').firstElementChild.matches('p.sae-say.sae-coach-line')).toBe(true); // the fold = prompt + options
    views.forEach((v) => v.destroy()); views = [];
    const auto = mountMcq();
    await wait(20);
    expect(auto.el.querySelector('.sae-mcq-coach-line')).toBeNull();
  }, 20000);
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
// The production condition of a coach-led run (row 21 as amended, row 32): the coach page draws the run in its frame
// (mount opt `embed: true`, so `is-embed` with ur_fit: the 64 px under the coach page's corner buttons), a syncing
// session draws the sync dot (`.sae-sync`, as the engine's view.setSync does), and with r8_lang_switch the other
// language's battery on the phone draws the «اردو | English» toggle in the top bar (view.langBattery, as the page does:
// it holds a [lang=ur] span, so an English screen takes the 64 px too). Over the frame, during a task, the coach page
// draws its own row at top 8 / inline-start 8 (flex, gap 8): the end button and, coach-led with the end-section switch,
// a second one; each min 48 x 48, 12 px semibold labels, 12 px sides, 1 px border (the portal's assess slot). The
// stand-in draws that row with the served labels in the page's language at BOTH top corners (the portal's direction
// decides which is the start), on top of the frame, so a hit test under it fails and every rect is read against it.
// Mounts: 'prod' = all of it; 'prod_notoggle' =
// the frame without the other language; 'bare' = none (the page as rounds 4-9 read it). SA_MOUNTS picks others for a
// read ('sync' = the dot alone).
const MOUNTS = {
  prod: { frame: 'coach-iframe', embed: true, sync: true, lang_toggle: true },
  prod_notoggle: { frame: 'coach-iframe', embed: true, sync: true, lang_toggle: false },
  sync: { frame: 'bare', embed: false, sync: true, lang_toggle: false },
  bare: { frame: 'bare', embed: false, sync: false, lang_toggle: false },
};
const MOUNT_NAMES = (process.env.SA_MOUNTS || 'prod,prod_notoggle,bare').split(',').filter((k) => MOUNTS[k]);
const MOUNT_LANGS = MOUNT_NAMES.flatMap((m) => ['ur', 'en'].map((l) => [m, l]));
const COACH_HOLD = { top: 8, height: 48, inset: 8, gap: 8, font: '600 12px/16px sans-serif', padding: '4px 12px', border: 1,
  labels: { en: ['End test (coach)', 'End this section'], ur: ['جائزہ ختم (کوچ)', 'یہ حصہ ختم کریں'] } };
let MOUNT = MOUNTS.prod;
/** The offline English twin (the frame, no other language on the phone): the frame's 64 px is keyed on a [lang=ur]
 *  element on the screen (sa.css, the sync and frame padding rules, outside the MCQ blocks), so an English screen
 *  without the toggle keeps 4 px and the coach page's row lies over its head row. Read and recorded, not asserted
 *  here: the online frame ('prod') is the claim. */
const offlineEn = (mnt, lang) => mnt === 'prod_notoggle' && lang === 'en';
/** A test page under the current mount: the frame flag in the mount opts; once the run is on screen the other
 *  language's battery (the toggle), the sync dot, and the coach page's stand-in band over the frame. */
function mounted(html) {
  const lang = (/lang: '(ur|en)', mode: 'proctored'/.exec(html) || [])[1];
  const other = lang === 'ur' ? 'en' : 'ur';
  const tail = [
    MOUNT.lang_toggle ? `  view.langBattery('${other}', SAE.core.normalize(JSON.parse(JSON.stringify(battery))), {});` : '',
    MOUNT.sync ? "  view.setSync({ state: 'syncing' });" : '',
    MOUNT.embed ? `  (function () { var H = ${JSON.stringify(COACH_HOLD)}; ['left', 'right'].forEach(function (side) {
    var row = document.createElement('div'); row.className = 'coach-hold-row'; row.dir = side === 'left' ? 'ltr' : 'rtl';
    row.style.cssText = 'position:fixed;top:' + H.top + 'px;' + side + ':' + H.inset + 'px;display:flex;gap:' + H.gap + 'px;z-index:1001';
    H.labels['${lang}'].forEach(function (t) { var b = document.createElement('button'); b.type = 'button'; b.className = 'coach-hold'; b.textContent = t;
      b.style.cssText = 'box-sizing:border-box;min-height:' + H.height + 'px;min-width:48px;height:' + H.height + 'px;padding:' + H.padding + ';border:' + H.border + 'px solid #cbd5e1;border-radius:12px;background:rgba(255,255,255,.9);font:' + H.font + ';color:#0f172a;white-space:nowrap';
      row.appendChild(b); });
    document.body.appendChild(row); }); })();` : '',
  ].filter(Boolean).join('\n');
  const out = html.replace(/handover: false,/g, `handover: false, embed: ${MOUNT.embed},`)
    .replace(/<\/script><\/body><\/html>$/, (tail ? tail + '\n' : '') + '</script></body></html>');
  if ((MOUNT.sync || MOUNT.embed) && (out === html || !lang)) throw new Error('mount not applied');
  return out;
}
/** A frame captured for a person (the shot dirs). The stand-in hold row above is drawn at BOTH top corners so every hit
 *  test reads against either; the served coach page draws one, at the portal's start. With SA_SHOT_ONE_HOLD=1 the
 *  far-side row (the one whose direction is not the page's: an Urdu/RTL page keeps the right-hand row, an English/LTR
 *  page the left) is hidden for the capture alone and put back at once, so no hit test ever runs without it. Without
 *  the flag this is page.screenshot(opts), unchanged. */
async function personShot(p, opts) {
  if (process.env.SA_SHOT_ONE_HOLD !== '1') return p.screenshot(opts);
  await p.evaluate(() => {
    const root = document.querySelector('.sae') || document.body; const dir = getComputedStyle(root).direction;
    document.querySelectorAll('.coach-hold-row').forEach((r) => { if (r.dir !== dir) { r.dataset.shotHidden = r.style.visibility || '-'; r.style.visibility = 'hidden'; } });
  });
  try { return await p.screenshot(opts); } finally {
    await p.evaluate(() => document.querySelectorAll('.coach-hold-row[data-shot-hidden]').forEach((r) => {
      r.style.visibility = r.dataset.shotHidden === '-' ? '' : r.dataset.shotHidden; delete r.dataset.shotHidden; }));
  }
}

/** Round 7: the coach's line, one line at a time (A6's per-line ink method). Its text is split at its line breaks
 *  into spans laid out exactly as before, every other element on the screen hidden, one line's text drawn at a time;
 *  a pixel is ink when its luminance < 120 with the line drawn and >= 120 with no text drawn (2x DPR). Returns the
 *  lines, the ink gap between each pair of consecutive lines, and how far the last line's ink runs below the
 *  element's padding box (> 0 = outside). The page is put back as it was. Round 10: the line as drawn (above, or in
 *  the open fold's body). */
async function coachLineInk(p) {
  const geo = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.sae-mcq-coach-line')).find((e) => e.checkVisibility({ visibilityProperty: true }) && e.getClientRects().length); const tn = el.firstChild; const s = tn.textContent;
    const before = el.getBoundingClientRect();
    const r = document.createRange(); const tops = []; const starts = [];
    for (let i = 0; i < s.length; i++) { r.setStart(tn, i); r.setEnd(tn, i + 1); const rc = r.getClientRects()[0]; if (!rc || !rc.width) continue;
      const t = Math.round(rc.top); if (!tops.length || Math.abs(t - tops[tops.length - 1]) > 4) { tops.push(t); starts.push(i); } }
    el.textContent = '';
    starts.forEach((st, k) => { const sp = document.createElement('span'); sp.className = 'b7-line'; sp.textContent = s.slice(st, k + 1 < starts.length ? starts[k + 1] : s.length); el.appendChild(sp); });
    const after = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const keep = new Set(); let n = el; while (n) { keep.add(n); n = n.parentElement; }
    window.__b7 = { el, s, hidden: [] };
    document.querySelectorAll('body *').forEach((x) => { if (!keep.has(x) && !el.contains(x) && x.style.visibility !== 'hidden') { x.style.visibility = 'hidden'; window.__b7.hidden.push(x); } });
    return { lines: starts.length, same_layout: Math.abs(before.height - after.height) < 0.5 && Math.abs(before.top - after.top) < 0.5,
      top: after.top, bottom: after.bottom, clip_bottom: after.bottom - parseFloat(cs.borderBottomWidth), clip_top: after.top + parseFloat(cs.borderTopWidth),
      font: cs.fontSize + '/' + cs.lineHeight, padding: cs.padding, margin: cs.margin };
  });
  const clip = { x: 0, y: Math.max(0, Math.floor(geo.top) - 30), width: 360 };
  clip.height = Math.min(640, Math.ceil(geo.bottom) + 40) - clip.y;
  const pixels = async () => p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, (await p.screenshot({ clip })).toString('base64'));
  const show = (k) => p.evaluate((k) => document.querySelectorAll('.b7-line').forEach((sp, i) => { sp.style.color = k === i ? '' : 'transparent'; }), k);
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  await show(-1); const none = await pixels();
  const ink = [];
  for (let k = 0; k < geo.lines; k++) {
    await show(k); const A = await pixels(); let top = null, bottom = null;
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const i = (y * A.w + x) * 4; if (L(A.d, i) < 120 && L(none.d, i) >= 120) { const cy = clip.y + y / 2; if (top == null) top = cy; bottom = cy; } }
    ink.push({ top, bottom });
  }
  await p.evaluate(() => { const b = window.__b7; b.hidden.forEach((x) => { x.style.visibility = ''; }); b.el.textContent = b.s; delete window.__b7; });
  const gaps = ink.slice(1).map((x, i) => +(x.top - ink[i].bottom).toFixed(1));
  const last = ink[ink.length - 1];
  return { lines: geo.lines, same_layout: geo.same_layout, font: geo.font, padding: geo.padding, margin: geo.margin, ink, gaps,
    gaps_min: gaps.length ? Math.min(...gaps) : null, below_box: +(last.bottom + 0.5 - geo.clip_bottom).toFixed(1),
    first_ink_above_box: +(geo.clip_top - ink[0].top).toFixed(1) };
}

/** Round 10: the frame as the page has it, and what the coach page's band and the sync dot overlap (any part of a rect,
 *  not a centre point): every tappable (the cards, the replay, the coach's Next, the toggle) and every head-row child;
 *  and where the coach's line is drawn ('above' the fold, in the open 'fold', or [] = folded away). */
async function frameRead(p) {
  return p.evaluate(() => {
    const R = (e) => { const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
    // drawn = laid out and shown (a closed fold's body is not: checkVisibility reads content-visibility too)
    const vis = (e) => { const b = e.getBoundingClientRect(); return e.checkVisibility({ visibilityProperty: true }) && b.width > 0 && b.height > 0; };
    const ov = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const holds = Array.from(document.querySelectorAll('.coach-hold')).map(R); const dot = document.querySelector('.sae-sync'); const scr = document.querySelector('.sae-screen');
    const taps = Array.from(document.querySelectorAll('.sae-mcq-opt, .sae-mcq-replay, .sae-mcq-head > *, .sae-mcq-next, .sae-top > *, .sae-r8-lang, .sae-mute, .sae-mcq .sae-fb, details.sae-mcq-coach > summary')).filter(vis);
    const d = dot ? R(dot) : null;
    const underHold = (e) => holds.some((h) => ov(R(e), h));
    const name = (e) => String(e.className).split(' ').filter((c) => /^sae-/.test(c)).pop() || e.tagName.toLowerCase();
    return { embed: !!document.querySelector('.sae.is-embed'), sync: !!dot, lang_toggle: !!document.querySelector('.sae-r8-lang'),
      screen_pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null, hold: holds, sync_dot: d,
      hold_hits: taps.filter(underHold).map(name), dot_hits: d ? taps.filter((e) => ov(R(e), d)).map(name) : [],
      dot_vs_hold: !!(d && holds.some((h) => ov(h, d))),
      // the language toggle against the first answer card and every head-row child: the px gap (negative = overlap)
      toggle: (() => {
        const tg = document.querySelector('.sae-r8-lang'); if (!tg || !vis(tg)) return null; const t = R(tg);
        const gap = (a, b) => +Math.max(Math.max(a.left, b.left) - Math.min(a.right, b.right), Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)).toFixed(1);
        const first = document.querySelector('.sae-mcq-opt');
        return { rect: t, vs_cards_px: first && vis(first) ? Math.min(...Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => gap(t, R(c)))) : null,
          vs_head_px: Object.fromEntries(Array.from(document.querySelectorAll('.sae-mcq-head > *, .sae-mcq .sae-fb')).filter(vis).map((e) => [name(e), gap(t, R(e))])) };
      })(),
      line: Array.from(document.querySelectorAll('.sae-mcq-coach-line')).filter(vis).map((e) => (e.closest('.sae-mcq-coach-body') ? 'fold' : 'above')) };
  });
}
/** Round 10 sizes (SA_B10_SIZES): per describe, mount, language and frame. */
const B10 = {};
afterAll(() => { if (process.env.SA_B10_SIZES) require('fs').writeFileSync(process.env.SA_B10_SIZES, JSON.stringify({ mounts: MOUNTS, coach_hold_standin: COACH_HOLD, cells: B10 }, null, 1)); });
/** The B10 shot of a frame under the production mount (SA_B10_SHOTS). */
async function b10Shot(p, what, lang) {
  if (!process.env.SA_B10_SHOTS || MOUNT !== MOUNTS.prod) return;
  await personShot(p, { path: require('path').join(process.env.SA_B10_SHOTS, `b10_${what}_${lang}_phone_coach.png`) });
}

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
      overlay_bottom: (() => { const b = document.querySelector('details.sae-mcq-coach[open] .sae-mcq-coach-body'); return b ? +b.getBoundingClientRect().bottom.toFixed(1) : null; })(),
      fold_open: !!document.querySelector('details.sae-mcq-coach[open]'),
      coach_line: !!document.querySelector('.sae-mcq-coach-line'),
      q_font: qEl ? parseFloat(getComputedStyle(qEl).fontSize) : 0,
      title_display: (() => { const t = document.querySelector('.sae-mcq .sae-task-tag'); return t ? getComputedStyle(t).display : null; })(),
    };
  });
  /** Every coach state of one question: listening (the question being read), speaking (answer 2 lit), chosen (answer 4
   *  held while answer 3 is read), then on a fresh page the offered Next and the coach's fold open over it. */
  const B10SHOT = { listening: 'question', chosen: 'chosen', offernext: 'offernext', foldopen: 'foldopen' };
  async function states(lang, ui, urFit, shots, inkLine) {
    const out = {};
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: shots || inkLine ? 2 : 1 });
      const p = await ctx.newPage();
      const html = mounted(page(lang, ui, urFit));
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
      out[name].frame = await frameRead(p);
      if (inkLine) out[name].coach_ink = out[name].frame.line.length ? await coachLineInk(p) : null;
      if (shots) await personShot(p, { path: path.join(shots, `${name}_${lang}${urFit ? '' : '_plain'}.png`) });
      if (urFit && !inkLine && B10SHOT[name]) await b10Shot(p, B10SHOT[name], lang);
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
  const LAYOUT = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true, r9_skip_instructions: true }; // + the Skip (row 21: the seven)
  for (const [mnt, lang] of MOUNT_LANGS) {
    for (const [name, ui, urFit] of [['the plain page', {}, false], ['the layout switches on (ur_fit, r8, r9, r10)', LAYOUT, true]]) {
      test(`[${mnt}] ${lang}, ${name}, the longest question and answers: listening, speaking, chosen, Next offered, fold open — nothing scrolls, nothing moves`, async () => { MOUNT = MOUNTS[mnt];
        const shots = process.env.SA_FIT_SHOTS || null;
        const r = await states(lang, ui, urFit, shots);
        B10[`scored_${mnt}_${lang}_${urFit ? 'layout' : 'plain'}`] = Object.assign({ frame: urFit ? MOUNTS[mnt].frame : 'bare (no ur_fit)' }, MOUNTS[mnt], { states: Object.fromEntries(Object.entries(r).map(([k, m]) => [k, {
          inner: m.inner_scroll, page_h: m.page_h, cards_hit: m.cards.filter((c) => c.shown).length, cards_top: m.cards.map((c) => c.top), ring_bottom: Math.max(...m.cards.map((c) => c.ring_bottom)),
          ring_margin: m.vh - Math.max(...m.cards.map((c) => c.ring_bottom)), replay: m.replay, next: m.next, overlay_bottom: m.overlay_bottom, screen_pad_top: m.frame.screen_pad_top,
          coach_line: m.frame.line, toggle: m.frame.toggle, toggle_vs_cards_px: m.frame.toggle && m.frame.toggle.vs_cards_px, hold: m.frame.hold, sync_dot: m.frame.sync_dot, hold_hits: m.frame.hold_hits, dot_hits: m.frame.dot_hits, dot_vs_hold: m.frame.dot_vs_hold }])) });
        const at = r.listening;
        expect(r.speaking.cards.map((c) => /is-speaking/.test(c.cls))).toEqual([false, true, false, false]);
        expect(/is-chosen/.test(r.chosen.cards[3].cls)).toBe(true);
        expect(r.offernext.next).not.toBeNull();
        expect(r.foldopen.fold_open).toBe(true);
        for (const [state, m] of Object.entries(r)) {
          expect({ state, coach_line: m.coach_line, nastaliq: m.nastaliq }).toEqual({ state, coach_line: true, nastaliq: true });
          // round 10 (row 32): the mount is the one named; nothing tappable or in the head row under the coach page's
          // band or the sync dot; round 11: the coach's line not drawn on the Urdu phone's question frame (the fold's
          // summary carries "do not read this"), above in English
          const f = m.frame;
          expect({ state, embed: f.embed, sync: f.sync, lang_toggle: f.lang_toggle, hold_hits: f.hold_hits, dot_hits: f.dot_hits })
            .toEqual({ state, embed: MOUNT.embed && urFit, sync: MOUNT.sync, lang_toggle: MOUNT.lang_toggle && urFit, hold_hits: urFit && !offlineEn(mnt, lang) ? [] : f.hold_hits, dot_hits: [] });
          // the toggle never meets an answer card (a stray tap would switch the language mid-item) nor a head-row child
          if (f.toggle) expect({ state, cards_clear: f.toggle.vs_cards_px > 0, head_clear: Object.values(f.toggle.vs_head_px).every((g) => g >= 0) }).toEqual({ state, cards_clear: true, head_clear: true });
          expect({ state, line: f.line }).toEqual({ state, line: lang === 'ur' ? [] : ['above'] });
          if (state === 'foldopen') expect({ state, overlay_bottom_ok: m.overlay_bottom != null && m.overlay_bottom <= m.vh }).toEqual({ state, overlay_bottom_ok: true });
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
          // round 6: no task title on the coach-led phone screen (the coach's line names the task, Jugnu says it), and
          // the lowest card's ring (the chosen card's, bottom + 7 px) ends at least 8 px above the screen's bottom edge
          expect({ state, title_display: m.title_display }).toEqual({ state, title_display: 'none' });
          expect({ state, ring_margin_ok: m.vh - Math.max(...m.cards.map((c) => c.ring_bottom)) >= 8, ring_bottom: Math.max(...m.cards.map((c) => c.ring_bottom)) })
            .toEqual({ state, ring_margin_ok: true, ring_bottom: Math.max(...m.cards.map((c) => c.ring_bottom)) });
        }
        // the coach's Next: in the head row beside the replay, never in the foot, on screen
        const n = r.offernext.next;
        expect({ in_head: n.in_head, foot: r.offernext.foot_next, shown: n.shown, inside: n.top >= 0 && n.bottom <= r.offernext.vh })
          .toEqual({ in_head: true, foot: false, shown: true, inside: true });
      }, 120000);
    }
  }
  // round 7: the coach's line on the coach-led phone with the production layout switches and the house Nastaliq, read
  // one line at a time in every coach state: ≥ 2 px of ink between every pair of consecutive lines, and the last line's
  // ink inside the element's padding box (the top edge is outside the bar; its number is reported, not asserted).
  // Every served question shows the same line, so one question per language is enough. Latin passes as it was.
  for (const [mnt, lang] of MOUNT_LANGS) {
    test(`[${mnt}] ${lang}, the layout switches on: the coach's line keeps ≥ 2 px of ink between its lines and its last line's ink inside its box, in every coach state`, async () => { MOUNT = MOUNTS[mnt];
      const r = await states(lang, LAYOUT, true, null, true);
      // round 10: on the Urdu phone the line is read where it is drawn on a question frame, in the open fold's body
      // (folded away otherwise); English keeps it above the fold in every state
      expect(Object.entries(r).filter(([, m]) => m.coach_ink).map(([state, m]) => [state, m.frame.line[0]]))
        .toEqual(lang === 'ur' ? [] : ['listening', 'speaking', 'chosen', 'offernext', 'foldopen'].map((x) => [x, 'above']));
      B10[`coach_line_ink_${mnt}_${lang}`] = Object.fromEntries(Object.entries(r).filter(([, m]) => m.coach_ink).map(([state, m]) => [state, Object.assign({ where: m.frame.line[0] }, m.coach_ink)]));
      const rows = Object.entries(r).filter(([, m]) => m.coach_ink).map(([state, m]) => ({ state, lines: m.coach_ink.lines, same_layout: m.coach_ink.same_layout, gaps: m.coach_ink.gaps,
        gaps_min: m.coach_ink.gaps_min, below_box: m.coach_ink.below_box, above_box: m.coach_ink.first_ink_above_box, font: m.coach_ink.font,
        ring_margin: m.vh - Math.max(...m.cards.map((c) => c.ring_bottom)) }));
      if (process.env.SA_FIT_DEBUG) process.stdout.write(`MCQCOACHINK ${lang} ${JSON.stringify(rows)}\n`);
      expect(Object.keys(r)).toEqual(['listening', 'speaking', 'chosen', 'offernext', 'foldopen']);
      for (const x of rows) {
        expect({ state: x.state, same_layout: x.same_layout, lines_ok: x.lines >= 2 }).toEqual({ state: x.state, same_layout: true, lines_ok: true });
        expect({ state: x.state, gaps: x.gaps, gaps_min_ok: x.gaps_min >= 2, below_box: x.below_box, inside_box: x.below_box <= 0 })
          .toEqual({ state: x.state, gaps: x.gaps, gaps_min_ok: true, below_box: x.below_box, inside_box: true });
        expect(parseFloat(x.font)).toBeGreaterThanOrEqual(13); // never below the coach's 13 px
        expect({ state: x.state, ring_margin_ok: x.ring_margin >= 8 }).toEqual({ state: x.state, ring_margin_ok: true });
      }
    }, 180000);
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
  const LAYOUT = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true, r9_skip_instructions: true }; // + the Skip (row 21: the seven)
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
    const html = mounted(page(lang, qText, options));
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
      // the line above the fold where it is drawn there (round 11: the Urdu phone's question frame does not draw it)
      const le = Array.from(document.querySelectorAll('.sae-mcq-coach-line')).find((e) => getComputedStyle(e).display !== 'none' && !e.closest('.sae-mcq-coach-body'));
      const line = le ? le.getBoundingClientRect() : null;
      return { top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom - parseFloat(cs.borderBottomWidth),
        lines: new Set(Array.from(rg.getClientRects()).filter((x) => x.width || x.height).map((x) => Math.round(x.top))).size,
        line_top: line ? line.top : null, line_bottom: line ? line.bottom : null, fold_top: document.querySelector('details.sae-mcq-coach').getBoundingClientRect().top,
        cards: Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => { const b = c.getBoundingClientRect(); return { h: Math.round(b.height), ring_bottom: Math.round(b.bottom + 7) }; }),
        page_h: document.documentElement.scrollHeight, inner_scroll: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')) };
    });
    await hide(p, ['.sae-mcq-opts', 'details.sae-mcq-coach', '.sae-mcq-coach-line'], true);
    await p.evaluate(() => { document.querySelector('.sae-mcq-q').style.overflow = 'visible'; });
    const rows = await ink(p, g.top - 30, g.bottom + 30);
    await p.evaluate(() => { document.querySelector('.sae-mcq-q').style.overflow = ''; });
    await hide(p, ['.sae-mcq-q'], true);
    await hide(p, ['.sae-mcq-coach-line'], false);
    const lr = g.line_top == null ? [] : await ink(p, g.line_top - 4, g.line_bottom + 14);
    await hide(p, ['.sae-mcq-opts', 'details.sae-mcq-coach', '.sae-mcq-coach-line', '.sae-mcq-q'], false);
    return { lines: g.lines, ink_above_top: rows.length ? +Math.max(0, g.top - rows[0]).toFixed(1) : null, ink_below_bottom: rows.length ? +Math.max(0, rows[rows.length - 1] - g.bottom).toFixed(1) : null,
      coach_line_room: g.line_top == null ? 'not drawn' : lr.length ? +(g.fold_top - lr[lr.length - 1]).toFixed(1) : null, card_h: g.cards.map((c) => c.h), ring_bottom: Math.max(...g.cards.map((c) => c.ring_bottom)),
      page_h: g.page_h, inner_scroll: g.inner_scroll };
  }
  /** Round 11 (B26 ⛔ condition): the fold's summary, the coach's "do not read this" on a scored frame: its text, and
   *  whether it is whole (no clipped width or height, inside the viewport, topmost at its centre). */
  const summaryRead = (p) => p.evaluate(() => { const s = document.querySelector('details.sae-mcq-coach > summary'); const b = s.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { text: s.textContent, whole: s.scrollWidth <= s.clientWidth + 0.5 && s.scrollHeight <= s.clientHeight + 0.5 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth && !!hit && s.contains(hit),
      rect: { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) } }; });
  /** The open fold's answer list: each line shown alone (the fold's question and summary hidden), inside the overlay. */
  async function foldList(p) {
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = true; d.dispatchEvent(new Event('toggle')); });
    await p.waitForTimeout(150);
    const summary_open = await summaryRead(p);
    const g = await p.evaluate(() => { const b = document.querySelector('.sae-mcq-coach-body').getBoundingClientRect(); const ol = document.querySelector('.sae-mcq-coach-opts');
      const bd = document.querySelector('.sae-mcq-coach-body');
      // round 11: the first child the fold's body shows (the prompt on a scored frame) and any scroller set on it
      const first = Array.from(bd.children).find((k) => getComputedStyle(k).display !== 'none');
      return { top: b.top, bottom: b.bottom, n: ol.children.length, lh: getComputedStyle(ol).lineHeight, fs: getComputedStyle(ol).fontSize, scrolls: bd.scrollHeight > bd.clientHeight + 0.5, sh: bd.scrollHeight, ch: bd.clientHeight,
        first_is_prompt: !!first && first.matches('p.sae-say.sae-coach-line'), max_height: bd.style.maxHeight || getComputedStyle(bd).maxHeight, overflow_y: getComputedStyle(bd).overflowY }; });
    await hide(p, ['.sae-mcq-coach-body>p', 'details.sae-mcq-coach>summary'], true);
    const lines = [];
    for (let k = 0; k < g.n; k++) {
      // round 10: where the fold's body scrolls inside itself, the line is brought into view first and its ink read in
      // the body's own coordinates (+ its scrollTop), so lines read at different scroll offsets compare
      const st = await p.evaluate((k) => { const lis = document.querySelectorAll('.sae-mcq-coach-opts li'); lis.forEach((li, i) => { li.style.visibility = i === k ? '' : 'hidden'; });
        const bd = document.querySelector('.sae-mcq-coach-body'); if (bd.scrollHeight > bd.clientHeight + 0.5) lis[k].scrollIntoView({ block: 'nearest' }); return bd.scrollTop; }, k);
      const rows = await ink(p, g.top + 1, g.bottom - 4, 8, 352);
      lines.push(rows.length ? { top: rows[0] + st, bottom: rows[rows.length - 1] + st } : null);
    }
    await p.evaluate(() => { document.querySelectorAll('.sae-mcq-coach-opts li').forEach((li) => { li.style.visibility = ''; }); document.querySelector('.sae-mcq-coach-body').scrollTop = 0; });
    await hide(p, ['.sae-mcq-coach-body>p', 'details.sae-mcq-coach>summary'], false);
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = false; d.dispatchEvent(new Event('toggle')); });
    const gaps = lines.slice(1).map((x, i) => +(x.top - lines[i].bottom).toFixed(1));
    return { line_height: g.lh, font: g.fs, gaps, min_gap: Math.min(...gaps), overlay_bottom: +g.bottom.toFixed(1), body_scrolls: g.scrolls, body_sh: g.sh, body_ch: g.ch,
      first_is_prompt: g.first_is_prompt, max_height: g.max_height, overflow_y: g.overflow_y, summary_open };
  }

  for (const [mnt, lang] of MOUNT_LANGS) {
    test(`[${mnt}] ${lang}: every served question and answer set — the stem's ink inside both clip edges and at most ${lang === 'ur' ? 2 : 3} lines, the fold list's lines ≥ 2 px apart with the overlay on screen, the coach's line clear of the fold, every card 56 px and on screen`, async () => { MOUNT = MOUNTS[mnt];
      const served = servedOf(lang);
      expect(served.length).toBeGreaterThanOrEqual(12);
      const rows = {};
      for (const it of served) {
        const { ctx, p } = await open(lang, it.q, it.options);
        const nastaliq = lang !== 'ur' || await p.evaluate(() => { const q = document.querySelector('.sae-mcq-q'); return document.fonts.check(getComputedStyle(q).font, q.textContent); });
        const summary_closed = await summaryRead(p);
        rows[it.id] = Object.assign({ nastaliq }, await stemAndFit(p), { summary_closed, fold: await foldList(p) });
        await ctx.close();
      }
      // the overlay on the bank's longest question with each set: the tallest
      const w = longestOf(lang);
      const { ctx, p } = await open(lang, w.q, w.options);
      const longest = await foldList(p);
      await ctx.close();
      sizes[`${mnt}_${lang}`] = { longest_question_with_longest_set: longest, per_question: rows };
      B10[`sweep_${mnt}_${lang}`] = Object.assign({}, MOUNTS[mnt], { longest_question_with_longest_set: longest, per_question: Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, {
        lines: r.lines, ink_above: r.ink_above_top, ink_below: r.ink_below_bottom, ring_bottom: r.ring_bottom, inner: r.inner_scroll, coach_line_room: r.coach_line_room,
        overlay_bottom: r.fold.overlay_bottom, fold_body_scrolls: r.fold.body_scrolls, fold_body_sh: r.fold.body_sh, fold_body_ch: r.fold.body_ch, fold_first_is_prompt: r.fold.first_is_prompt,
        summary_closed: r.summary_closed, summary_open: r.fold.summary_open, fold_list_min_gap: r.fold.min_gap }])) });
      // round 11 (RUBRIC B26 ⛔, lead ruling): the open fold never scrolls: on every served question its body's
      // scrollHeight − clientHeight is 0, no max-height or scroller is set on it, its overlay ends on screen, and its
      // first child is the prompt (the coach's line is not in the scored fold); the summary, the coach's "do not read
      // this", is drawn whole with the fold closed and open
      const SUMMARY = lang === 'ur' ? 'جگنو پوچھے گا — یہ آپ نہ پڑھیں:' : 'Jugnu asks — do not read these:';
      expect(Object.entries(rows).map(([id, r]) => ({ id, body_over: r.fold.body_sh - r.fold.body_ch, max_height: r.fold.max_height, overflow_y: r.fold.overflow_y, overlay_ok: r.fold.overlay_bottom <= 640, first_is_prompt: r.fold.first_is_prompt })))
        .toEqual(Object.keys(rows).map((id) => ({ id, body_over: 0, max_height: 'none', overflow_y: 'visible', overlay_ok: true, first_is_prompt: true })));
      expect(Object.entries(rows).map(([id, r]) => ({ id, closed: [r.summary_closed.text, r.summary_closed.whole], open: [r.fold.summary_open.text, r.fold.summary_open.whole] })))
        .toEqual(Object.keys(rows).map((id) => ({ id, closed: [SUMMARY, true], open: [SUMMARY, true] })));
      expect({ longest_over: longest.body_sh - longest.body_ch, longest_first_is_prompt: longest.first_is_prompt }).toEqual({ longest_over: 0, longest_first_is_prompt: true });
      // round 6, all questions at once (so a failure lists every one): no ink above the stem card's clip top, and the
      // lowest card's ring ≥ 8 px above the screen's bottom edge
      expect(Object.entries(rows).map(([id, r]) => ({ id, lines: r.lines, above: r.ink_above_top, ring_margin: 640 - r.ring_bottom }))
        .filter((x) => x.above !== 0 || x.ring_margin < 8)).toEqual([]);
      for (const [id, m] of Object.entries(rows)) {
        const r = m;
        expect({ id, nastaliq: r.nastaliq, page_h: r.page_h, inner_scroll: r.inner_scroll, ring_ok: r.ring_bottom <= 640, cards: r.card_h })
          .toEqual({ id, nastaliq: true, page_h: 640, inner_scroll: 0, ring_ok: true, cards: [56, 56, 56, 56] });
        // round 6: the lowest card's ring ends ≥ 8 px above the screen's bottom edge on every question
        expect({ id, ring_margin: 640 - r.ring_bottom >= 8 ? 'ok' : 640 - r.ring_bottom }).toEqual({ id, ring_margin: 'ok' });
        expect({ id, lines_ok: r.lines >= 1 && r.lines <= (lang === 'ur' ? 2 : 3), below: r.ink_below_bottom }).toEqual({ id, lines_ok: true, below: 0 });
        // the first line's ascender: whole on every served question, one line or two, Urdu and Latin (round 6: the
        // task title's room pays for it on the coach-led phone)
        expect({ id, lines: r.lines, above: r.ink_above_top }).toEqual({ id, lines: r.lines, above: 0 });
        expect({ id, coach_line_room_ok: lang === 'ur' ? r.coach_line_room === 'not drawn' : r.coach_line_room >= 0 }).toEqual({ id, coach_line_room_ok: true });
        expect({ id, fold_min_gap_ok: r.fold.min_gap >= 2, overlay_ok: r.fold.overlay_bottom <= 640 }).toEqual({ id, fold_min_gap_ok: true, overlay_ok: true });
      }
      expect(longest.overlay_bottom).toBeLessThanOrEqual(640);
      expect(longest.min_gap).toBeGreaterThanOrEqual(2);
      // the Latin list keeps its own line height (the Urdu rules are scoped [lang=ur])
      if (lang === 'en') expect(longest.line_height).toBe('normal');
      else expect(parseFloat(longest.font)).toBeGreaterThanOrEqual(15);
    }, 600000);

    test(`[${mnt}] ${lang}: the coach's Next is in the coach's register (a dashed box, no fill, no pill) and ≥ 48 px from the child's replay; the fold's close by a tap shows the cards at once (< 150 ms, no transition)`, async () => { MOUNT = MOUNTS[mnt];
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
      sizes[`${mnt}_${lang}_next_and_close`] = { next: nx, close };
      expect({ border: nx.border, bg: nx.bg, shadow: nx.shadow, clipped: nx.clipped }).toEqual({ border: 'dashed', bg: 'rgba(0, 0, 0, 0)', shadow: 'none', clipped: false });
      expect(nx.gap).toBeGreaterThanOrEqual(48);
      expect({ fold_open: close.fold_open, chosen: close.chosen, close: close.close }).toEqual({ fold_open: false, chosen: 0, close: [{ by: 'tap', card: c1.card }] });
      sizes[`${mnt}_${lang}_next_and_close`].tap_on_card = c1.card;
      expect(close.ms).toBeLessThan(150);
      expect(close.max_transition_ms).toBeLessThanOrEqual(150);
    }, 120000);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// B.3 round 6: the task title is hidden on the coach-led PHONE MCQ screen only (the coach's line names the task and Jugnu
// says it); RDF auto at phone width and both modes on a tablet keep it, shown and on one line.
// ------------------------------------------------------------------------------------------------------------------
maybeBrowser('sa_r28_mcq round 6: the task title on the MCQ screen per mode and width (B.3)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });
  const LAYOUT = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true, r9_skip_instructions: true }; // + the Skip (row 21: the seven)
  function page(lang, manual) {
    const w = longestOf(lang);
    const item = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: w.q, audio: `sa/v5/${lang}/syn_q${n}.mp3` }, options: w.options,
      option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
    const task = mcqTask([item(1), item(2)], { id: `${lang}.story_mcq_w3`, lang, depends_on: null });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  function speak() { return new Promise(function () {}); }
  speak.audio = function () { return null; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(Object.assign({ r28_mcq: true }, LAYOUT))}, tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return 0; }, manual: ${manual}, onEvent: function () {} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${manual}, handover: false, ur_fit: true,
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
</script></body></html>`;
  }
  for (const lang of ['ur', 'en']) {
    for (const [name, vw, vh, manual, shown] of [['coach-led phone', 360, 640, true, false], ['RDF auto phone', 360, 640, false, true],
      ['coach-led tablet', 800, 1280, true, true], ['RDF auto tablet', 800, 1280, false, true]]) {
      test(`${lang}, ${name}: the task title is ${shown ? 'shown' : 'hidden'}`, async () => { MOUNT = MOUNTS.prod;
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
        const p = await ctx.newPage();
        const html = mounted(page(lang, manual));
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
          if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
          if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
          return route.fulfill({ status: 404, body: '' });
        });
        await p.goto('http://sa.test/');
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(300);
        const t = await p.evaluate(() => {
          const e = document.querySelector('.sae-mcq .sae-task-tag'); const b = e ? e.getBoundingClientRect() : null;
          return { mcq: !!document.querySelector('.sae-mcq'), coach: !!document.querySelector('details.sae-mcq-coach'), present: !!e,
            display: e ? getComputedStyle(e).display : null, h: b ? Math.round(b.height) : 0, on_screen: !!b && b.top >= 0 && b.bottom <= window.innerHeight };
        });
        await ctx.close();
        expect({ mcq: t.mcq, coach: t.coach, present: t.present }).toEqual({ mcq: true, coach: manual, present: true });
        if (shown) expect({ display: t.display !== 'none', h: t.h > 0, on_screen: t.on_screen }).toEqual({ display: true, h: true, on_screen: true });
        else expect({ display: t.display, h: t.h }).toEqual({ display: 'none', h: 0 });
      }, 60000);
    }
  }
  // round 10: the coach-led tablet re-read once under the production mount (the frame, the sync dot, the toggle):
  // the coach's line stays above the fold (the fold's copy is a phone rule), the cards whole and hit with the fold
  // closed, and again after it opens and closes
  for (const lang of ['ur', 'en']) {
    test(`${lang}, coach-led tablet under the production mount: the line above the fold, four cards hit before and after the fold`, async () => { MOUNT = MOUNTS.prod;
      const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 } });
      const p = await ctx.newPage();
      const html = mounted(page(lang, true));
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
        if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
        if (u.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
        return route.fulfill({ status: 404, body: '' });
      });
      await p.goto('http://sa.test/');
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const read = () => p.evaluate(() => {
        const hit = (e) => { const b = e.getBoundingClientRect(); const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!x && e.contains(x); };
        const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
        const cs = Array.from(document.querySelectorAll('.sae-mcq-opt'));
        const ov = document.querySelector('details.sae-mcq-coach[open] .sae-mcq-coach-body');
        return { page_h: document.documentElement.scrollHeight, vh: window.innerHeight, inner: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')),
          hit: cs.filter(hit).length, cards_bottom: +Math.max(...cs.map((c) => c.getBoundingClientRect().bottom)).toFixed(1), overlay_bottom: ov ? +ov.getBoundingClientRect().bottom.toFixed(1) : null };
      });
      const toggle = (open) => p.evaluate((o) => { const d = document.querySelector('details.sae-mcq-coach'); d.open = o; d.dispatchEvent(new Event('toggle')); }, open);
      const before = Object.assign(await read(), { frame: await frameRead(p) });
      await toggle(true); await p.waitForTimeout(150);
      const open = Object.assign(await read(), { frame: await frameRead(p) });
      await toggle(false); await p.waitForTimeout(150);
      const after = await read();
      await ctx.close();
      B10[`tablet_prod_${lang}`] = Object.assign({}, MOUNTS.prod, { before, fold_open: open, after_close: after });
      expect({ embed: before.frame.embed, sync: before.frame.sync, toggle: before.frame.lang_toggle, line: before.frame.line, open_line: open.frame.line, hold_hits: before.frame.hold_hits })
        .toEqual({ embed: true, sync: true, toggle: true, line: ['above'], open_line: ['above'], hold_hits: [] });
      for (const [nm, m] of [['before', before], ['after', after]]) expect({ nm, inner: m.inner, hit: m.hit, inside: m.cards_bottom <= m.vh }).toEqual({ nm, inner: 0, hit: 4, inside: true });
    }, 60000);
  }
});

// RDF auto and the tablet keep their layout: every coach-fit rule sits in the one phone @media block and only matches
// the coach-led MCQ screen (the one that carries the coach's fold, which RDF auto never draws).
// ------------------------------------------------------------------------------------------------------------------
// Round 9 (row 31, SPEC B-7 in the practice): the coach-led 360×640 phone, the production switches (seven), the bank's
// served practice question with its passage clip key ({ text, audio }). The passage is its own step (the passage whole,
// no cards, its clip playing; a tap on the text does not end it; it ends at the clip's end + 600 ms); then every
// practice question state draws as the scored screen: page 640, inner 0, 4 of 4 cards hit at their centres, ring ≥ 8,
// stem above 0, the cards' pitch 60, NO passage element, the fold = prompt + options with its overlay on screen, and
// the head 56 px on all eleven frames with the stem and the cards unmoved. Both languages, with and without the Skip.
// ------------------------------------------------------------------------------------------------------------------
maybeBrowser('sa_r28_mcq round 9: the coach-led phone MCQ practice fits: the passage step, then the scored screen (row 31)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });
  const SERVED = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true, r9_skip_instructions: true };
  const sizes = {};
  afterAll(() => { if (process.env.SA_B9_SIZES) fs.writeFileSync(process.env.SA_B9_SIZES, JSON.stringify(sizes, null, 1)); });
  const withClip = (lang) => { const it = practiceOf(lang); it.passage = { text: it.passage.text, audio: `sa/v5/${lang}/syn_pp.mp3` }; return it; };

  function page(lang, ui) {
    const w = longestOf(lang);
    const item = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: w.q, audio: `sa/v5/${lang}/syn_q${n}.mp3` }, options: w.options,
      option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
    const task = mcqTask([item(1), item(2)], { id: `${lang}.story_mcq_w3`, lang, depends_on: null, practice: [withClip(lang)] });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0; window.__ev = []; window.__speaks = []; var cur = null;
  function speak(t, a0) { window.__speaks.push({ at: Date.now(), clip: a0 && (a0.audio || a0) }); var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; }); }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(Object.assign({ r28_mcq: true }, ui))}, tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: true, onEvent: function (e) { window.__ev.push(e); } });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: true, handover: false, ur_fit: true,
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); view.render(); window.__view = view; window.__runner = runner;
</script></body></html>`;
  }
  async function open(lang, ui) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const html = mounted(page(lang, ui));
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
  const measure = () => document.fonts.ready.then(() => {
    const vh = window.innerHeight;
    const R = (e) => { const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const hitAt = (e) => { const b = e.getBoundingClientRect(); const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!x && e.contains(x); };
    const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
    const head = document.querySelector('.sae-mcq-head');
    const q = document.querySelector('.sae-mcq-q');
    const cardEls = Array.from(document.querySelectorAll('.sae-mcq-opt'));
    const cards = cardEls.map((c) => { const b = c.getBoundingClientRect(); return { top: +b.top.toFixed(1), h: +b.height.toFixed(1), ring_bottom: +(b.bottom + 7).toFixed(1), cls: c.className, hit: hitAt(c) }; });
    const ps = document.querySelector('.sae-mcq-passage');
    const fold = document.querySelector('details.sae-mcq-coach');
    const fb = document.querySelector('.sae-mcq-coach-body');
    const sk = head ? head.querySelector('.sae-r9-skip') : null;
    const chip = head ? head.querySelector('.sae-chip') : null;
    const rb = head ? head.querySelector('.sae-mcq-replay') : null;
    return {
      vh, page_h: document.documentElement.scrollHeight, inner_scroll: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')),
      phase: window.__runner.view().phase,
      pstate: ps && !cardEls.length ? 'passage' : ps ? 'mixed' : 'question',
      passage: ps ? Object.assign(R(ps), { sh: ps.scrollHeight, ch: ps.clientHeight, whole: ps.scrollHeight <= ps.clientHeight + 0.5 }) : null,
      head: head ? R(head) : null, skip: sk ? R(sk) : null, chip: chip ? R(chip) : null,
      replay: rb ? Object.assign(R(rb), { disabled: rb.disabled }) : null,
      stem: q ? R(q) : null, cards, cards_hit: cards.filter((c) => c.hit).length,
      pitch: cards.length > 1 ? +(cards[1].top - cards[0].top).toFixed(1) : null,
      ring_margin: cards.length ? +(vh - Math.max(...cards.map((c) => c.ring_bottom))).toFixed(1) : null,
      fold_open: !!(fold && fold.open),
      // the coach's Next in the head (the passage step, no Skip): its box, its label unclipped, hit at its centre, and
      // its overlap with every other head child (Jugnu's animated box included)
      next: (() => {
        const n = head ? head.querySelector('.sae-mcq-next') : null; if (!n) return null;
        const r = R(n); const kids = Array.from(head.children).filter((k) => k !== n).map((k) => Object.assign(R(k), { cls: String(k.className).split(' ')[0] }));
        const ov = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return Object.assign(r, { text: n.textContent, sw: n.scrollWidth, cw: n.clientWidth, unclipped: n.scrollWidth <= n.clientWidth + 0.5, hit: hitAt(n),
          inside: r.left >= 0 && r.right <= 360, overlaps: kids.filter((k) => ov(r, k) > 0).map((k) => k.cls), kids });
      })(),
      jugnu_talking: !!document.querySelector('.sae-mcq-jugnu.is-talking'),
      fb: (() => { const f = document.querySelector('.sae-mcq .sae-fb'); if (!f) return null; const b = f.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), h: +b.height.toFixed(1), text: f.textContent.trim(), sh: f.scrollHeight, ch: f.clientHeight, sw: f.scrollWidth, cw: f.clientWidth }; })(),
      scroll_cue: !!document.querySelector('.sae-r9-scroll:not([hidden])'),
      // round 10: the children the fold's body draws (a copy sa.css does not show is not drawn)
      fold_body: fb && fold && fold.open ? Object.assign(R(fb), { kids: Array.from(fb.children).filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.tagName.toLowerCase() + '.' + String(k.className).split(' ').pop()), text: fb.textContent, sh: fb.scrollHeight, ch: fb.clientHeight }) : null,
    };
  });
  /** The stem's ink above its clip top (as round 8 measures it). */
  async function stemAbove(p) {
    const g = await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); if (!q) return null; const cs = getComputedStyle(q); const r = q.getBoundingClientRect();
      window.__b9h = [];
      document.querySelectorAll('.sae-mcq-opts, details.sae-mcq-coach, .sae-mcq-coach-line, .sae-mcq-passage, .sae-mcq-head, .sae-fb').forEach((e) => { window.__b9h.push(e); e.style.visibility = 'hidden'; });
      q.style.overflow = 'visible';
      return { top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom };
    });
    if (!g) return null;
    const y0 = Math.max(0, Math.floor(g.top - 30)); const y1 = Math.min(640, Math.ceil(g.bottom));
    const png = await p.screenshot({ clip: { x: 0, y: y0, width: 360, height: y1 - y0 } });
    const first = await p.evaluate(async ([b64, top]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const gg = c.getContext('2d'); gg.drawImage(img, 0, 0);
      const d = gg.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120) return top + y / 2; }
      return null;
    }, [png.toString('base64'), y0]);
    await p.evaluate(() => { window.__b9h.forEach((e) => { e.style.visibility = ''; }); document.querySelector('.sae-mcq-q').style.overflow = ''; });
    return first == null ? null : +Math.max(0, g.top - first).toFixed(1);
  }
  const endLine = async (p, gapMs) => { await p.evaluate(() => window.__end()); await p.waitForTimeout(gapMs); };
  const SHOT = { passage: 'passage', passage_next: 'passagenext', listening: 'listening', option2: 'speaking', chosen: 'chosen', feedback: 'feedback', foldopen: 'foldopen', feedback_shown: 'feedbackshown' };
  const B10SHOT = { passage: 'practice_passage', listening: 'practice_listening', foldopen: 'practice_foldopen', feedback: 'practice_feedback' };
  async function walk(lang, ui) {
    const out = {}; const step = {};
    const shots = process.env.SA_B9_SHOTS && ui.r9_skip_instructions ? process.env.SA_B9_SHOTS : null;
    const snap = async (p, name, wait) => {
      await p.waitForTimeout(wait == null ? 200 : wait);
      out[name] = await p.evaluate(measure);
      out[name].frame = await frameRead(p);
      out[name].stem_above = await stemAbove(p);
      if (shots && SHOT[name]) await personShot(p, { path: path.join(shots, `b9_practice_${SHOT[name]}_${lang}_phone_coach.png`) });
      if (ui.r9_skip_instructions && B10SHOT[name]) await b10Shot(p, B10SHOT[name], lang);
      // round 10: the coach's line on the passage step (above, the step that precedes every question), one line at a time
      if (name === 'passage' && out[name].frame.line.length) out[name].coach_ink = await coachLineInk(p);
      if (name === 'foldopen' && out[name].frame.line.length) out[name].coach_ink = await coachLineInk(p);
      // the coach's Next exists only without the Skip: that frame is shot from the no-Skip walk
      if (process.env.SA_B9_SHOTS && !ui.r9_skip_instructions && name === 'passage_next') await personShot(p, { path: path.join(process.env.SA_B9_SHOTS, `b9_practice_passagenext_noskip_${lang}_phone_coach.png`) });
    };
    const { ctx, p } = await open(lang, ui);
    // the passage step (the first clip asked is the passage's), then a tap on its text at +1 s: the step goes on
    await snap(p, 'passage');
    step.first_clip = await p.evaluate(() => (window.__speaks[0] || {}).clip || null);
    if (out.passage.pstate === 'passage') {
      const r = out.passage.passage;
      await p.waitForTimeout(800);
      await p.mouse.click(r.left + r.w / 2, r.top + r.h / 2);
      await p.waitForTimeout(200);
      step.after_tap = await p.evaluate(() => ({ pstate: document.querySelector('.sae-mcq-passage') ? 'passage' : 'question', logged: window.__ev.filter((e) => e.type === 'practice_passage').length }));
      // the clip ends: inside the 600 ms settle the coach's Next appears (no Skip only); the child's replay plays the
      // passage again (Jugnu talking, the widest head), and the step waits for that clip's end
      await endLine(p, 150);
      out.passage_heard = await p.evaluate(measure);
      const rb = out.passage_heard.replay;
      await p.mouse.click(rb.left + rb.w / 2, rb.top + rb.h / 2);
      await snap(p, 'passage_next', 300);
      step.replayed_clip = await p.evaluate(() => (window.__speaks[window.__speaks.length - 1] || {}).clip || null);
      await endLine(p, 900); // the replayed passage clip ends; the 600 ms settle; the question draws and its read-out begins
    }
    step.log = await p.evaluate(() => window.__ev.filter((e) => e.type === 'practice_passage').map((e) => ({ audio: e.audio, by: e.by, ms_pos: e.ms > 0 })));
    await snap(p, 'listening');
    await endLine(p, 900);
    for (let k = 1; k <= 4; k++) { await snap(p, `option${k}`); await endLine(p, k < 4 ? 600 : 300); }
    await snap(p, 'open');
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = true; d.dispatchEvent(new Event('toggle')); });
    await snap(p, 'foldopen');
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = false; d.dispatchEvent(new Event('toggle')); });
    await p.waitForTimeout(400);
    await snap(p, 'foldclosed');
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-opt')[3].click()); // a wrong card, held
    await snap(p, 'chosen');
    await snap(p, 'feedback', 900); // settle + press: the practice's feedback
    // coach-led, Jugnu says the practice feedback (try again) since round 28: that line ends first, then the retry reads
    // the same question again
    await endLine(p, 1600);
    for (let k = 0; k < 5; k++) await endLine(p, k === 0 ? 900 : 600);
    await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-opt')[2].click()); // wrong again: the right card shown
    await snap(p, 'feedback_shown', 1150);
    step.passage_clips = await p.evaluate(() => window.__speaks.filter((x) => /syn_pp/.test(String(x.clip))).length);
    await ctx.close();
    return { out, step };
  }
  const FRAMES = ['listening', 'option1', 'option2', 'option3', 'option4', 'open', 'foldopen', 'foldclosed', 'chosen', 'feedback', 'feedback_shown'];

  for (const [mnt, lang] of MOUNT_LANGS) {
    for (const withSkip of [true, false]) {
      test(`[${mnt}] ${lang}, ${withSkip ? 'with' : 'without'} the Skip: the passage step whole with no cards, then all eleven practice question frames at the scored bar (640 / inner 0 / 4 of 4 hit / ring ≥ 8 / stem above 0 / pitch 60 / no passage), the fold = prompt + options on screen, head 56 and nothing moving`, async () => { MOUNT = MOUNTS[mnt];
        const ui = Object.assign({}, SERVED, { r9_skip_instructions: withSkip });
        const { out, step } = await walk(lang, ui);
        const tag = `${mnt}_${lang}_${withSkip ? 'skip' : 'noskip'}`;
        sizes[tag] = { step, states: Object.fromEntries(Object.entries(out).map(([k, m]) => [k, { phase: m.phase, pstate: m.pstate, page_h: m.page_h, inner: m.inner_scroll, head_h: m.head && m.head.h,
          skip: m.skip, chip: m.chip, stem_top: m.stem && m.stem.top, stem_above: m.stem_above, cards_top: m.cards.map((c) => c.top), cards_hit: m.cards_hit, pitch: m.pitch, ring_margin: m.ring_margin,
          fb: m.fb, scroll_cue: m.scroll_cue, next: m.next, jugnu_talking: m.jugnu_talking, passage: m.passage, fold_overlay_bottom: m.fold_body ? m.fold_body.bottom : null, fold_kids: m.fold_body ? m.fold_body.kids : null }])) };
        // (i) the passage step
        const ps = out.passage;
        expect({ pstate: ps.pstate, first_clip: step.first_clip, page_h: ps.page_h, inner: ps.inner_scroll, cards: ps.cards.length })
          .toEqual({ pstate: 'passage', first_clip: `sa/v5/${lang}/syn_pp.mp3`, page_h: 640, inner: 0, cards: 0 });
        expect({ whole: ps.passage.whole, inside: ps.passage.top >= 0 && ps.passage.bottom <= 640 && ps.passage.left >= 0 && ps.passage.right <= 360, replay_disabled: ps.replay.disabled })
          .toEqual({ whole: true, inside: true, replay_disabled: true });
        expect({ head_h: ps.head.h, skip: !!ps.skip }).toEqual({ head_h: 56, skip: withSkip });
        expect(step.after_tap).toEqual({ pstate: 'passage', logged: 0 });
        expect(step.log).toEqual([{ audio: true, by: 'clip_end', ms_pos: true }]);
        expect({ replayed: step.replayed_clip, passage_clips: step.passage_clips }).toEqual({ replayed: `sa/v5/${lang}/syn_pp.mp3`, passage_clips: 2 });
        // the coach's Next: never while the clip first plays; with the Skip drawn never; without it, once the clip has
        // ended, inside the row with no overlap, label whole and hit at its centre, Jugnu talking
        expect({ next_first: ps.next }).toEqual({ next_first: null });
        const pn = out.passage_next;
        expect({ pstate: pn.pstate, talking: pn.jugnu_talking, page_h: pn.page_h, inner: pn.inner_scroll, head_h: pn.head.h }).toEqual({ pstate: 'passage', talking: true, page_h: 640, inner: 0, head_h: 56 });
        if (withSkip) expect({ heard: out.passage_heard.next, replaying: pn.next }).toEqual({ heard: null, replaying: null });
        else {
          for (const [nm, m] of [['heard', out.passage_heard], ['replaying', pn]]) {
            expect({ nm, next: !!m.next }).toEqual({ nm, next: true });
            expect({ nm, inside: m.next.inside, unclipped: m.next.unclipped, hit: m.next.hit, overlaps: m.next.overlaps }).toEqual({ nm, inside: true, unclipped: true, hit: true, overlaps: [] });
          }
        }
        // (ii) + (vi) the question frames
        const at = out.listening;
        for (const s of FRAMES) {
          const m = out[s];
          expect({ s, phase: m.phase }).toEqual({ s, phase: s === 'feedback_shown' ? 'ready' : 'practice' });
          // fold open: the coach's overlay is modal over the cards (B.3, a tap only closes it): their positions are asserted, the hit after the close
          expect({ s, pstate: m.pstate, page_h: m.page_h, inner: m.inner_scroll, cards_hit: s === 'foldopen' ? 4 : m.cards_hit, ring_ok: m.ring_margin >= (lang === 'en' ? 51.2 : 8), stem_above: m.stem_above, pitch: m.pitch })
            .toEqual({ s, pstate: 'question', page_h: 640, inner: 0, cards_hit: 4, ring_ok: true, stem_above: 0, pitch: 60 });
          expect({ s, head_h: m.head.h, stem_top: m.stem.top, cards_top: m.cards.map((c) => c.top) }).toEqual({ s, head_h: 56, stem_top: at.stem.top, cards_top: at.cards.map((c) => c.top) });
        }
        // the feedback line names it on screen, whole, below the lowest ring; no scroll cue on any frame
        for (const s of ['feedback', 'feedback_shown']) {
          const m = out[s];
          expect({ s, fb_unclipped: m.fb.sw <= m.fb.cw + 0.5 }).toEqual({ s, fb_unclipped: true });
          expect({ s, text: m.fb.text.length > 0, on_screen: m.fb.bottom <= 640, below_ring: m.fb.top >= Math.max(...m.cards.map((c) => c.ring_bottom)) - 0.5 }).toEqual({ s, text: true, on_screen: true, below_ring: true });
        }
        FRAMES.concat('passage').forEach((s) => expect({ s, scroll_cue: out[s].scroll_cue }).toEqual({ s, scroll_cue: false }));
        // the Skip as row 30 left it (drawn while the runner is on the practice; the frame naming the right card has none)
        if (withSkip) FRAMES.filter((s) => s !== 'feedback_shown').forEach((s) => expect({ s, skip: !!out[s].skip, chip: !!out[s].chip }).toEqual({ s, skip: true, chip: false }));
        expect({ skip: out.feedback_shown.skip, chip: !!out.feedback_shown.chip }).toEqual({ skip: null, chip: true });
        // the fold = the scored fold (prompt + options, no passage), its overlay on screen
        const f = out.foldopen.fold_body;
        // round 11 (row 32): the fold = prompt + options in both languages (the coach's line is not in it)
        expect({ kids: f.kids, story: f.text.indexOf(practiceOf(lang).passage.text) >= 0, on_screen: f.bottom <= 640 })
          .toEqual({ kids: ['p.sae-coach-line', 'ol.sae-mcq-coach-opts'], story: false, on_screen: true });
        // round 11 (RUBRIC B26 ⛔): the open practice fold never scrolls either: its body's scrollHeight − clientHeight is 0
        // and its overlay ends on screen
        expect({ body_over: f.sh - f.ch, on_screen: f.bottom <= 640 }).toEqual({ body_over: 0, on_screen: true });
        B10[`b11_fold_${tag}`] = { bottom: f.bottom, sh: f.sh, ch: f.ch, kids: f.kids };
        // the mount named; nothing tappable or in the head row under the coach page's band or the sync dot; the coach's
        // line above on the passage step (both languages), not drawn on the Urdu question frames (round 11), above in English
        const steps = ['passage', 'passage_next'].concat(FRAMES);
        for (const s of steps) {
          const fr = out[s].frame;
          expect({ s, embed: fr.embed, sync: fr.sync, lang_toggle: fr.lang_toggle, hold_hits: fr.hold_hits, dot_hits: fr.dot_hits })
            .toEqual({ s, embed: MOUNT.embed, sync: MOUNT.sync, lang_toggle: MOUNT.lang_toggle, hold_hits: offlineEn(mnt, lang) ? fr.hold_hits : [], dot_hits: [] });
          if (fr.toggle) expect({ s, cards_clear: fr.toggle.vs_cards_px == null || fr.toggle.vs_cards_px > 0, head_clear: Object.values(fr.toggle.vs_head_px).every((g) => g >= 0) }).toEqual({ s, cards_clear: true, head_clear: true });
          const want = s.startsWith('passage') || lang === 'en' ? ['above'] : [];
          expect({ s, line: fr.line }).toEqual({ s, line: want });
        }
        // B7's ink bar on the line wherever it is drawn: the passage step (above; round 11: no fold copy)
        for (const s of ['passage']) {
          const k = out[s].coach_ink;
          expect({ s, lines_ok: k.lines >= 2, same_layout: k.same_layout, gaps_min_ok: k.gaps_min >= 2, inside_box: k.below_box <= 0, font_ok: parseFloat(k.font) >= 13 })
            .toEqual({ s, lines_ok: true, same_layout: true, gaps_min_ok: true, inside_box: true, font_ok: true });
        }
        B10[`practice_${tag}`] = Object.assign({ frame: MOUNTS[mnt].frame, skip: withSkip }, MOUNTS[mnt], { states: Object.fromEntries(Object.entries(out).map(([k, m]) => [k, {
          pstate: m.pstate, inner: m.inner_scroll, page_h: m.page_h, cards_hit: m.cards_hit, cards_top: m.cards.map((c) => c.top), ring_margin: m.ring_margin,
          ring_bottom: m.cards.length ? +(640 - m.ring_margin).toFixed(1) : null, head: m.head, skip: m.skip, chip: m.chip, next: m.next && { left: m.next.left, right: m.next.right, top: m.next.top, bottom: m.next.bottom, hit: m.next.hit },
          fb: m.fb, scroll_cue: m.scroll_cue, stem_above: m.stem_above, jugnu_talking: m.jugnu_talking,
          overlay: m.fold_body ? { bottom: m.fold_body.bottom, kids: m.fold_body.kids, scrolls: m.fold_body.sh > m.fold_body.ch + 0.5 } : null,
          coach_line: m.frame && m.frame.line, toggle: m.frame && m.frame.toggle, toggle_vs_cards_px: m.frame && m.frame.toggle && m.frame.toggle.vs_cards_px, coach_ink: m.coach_ink || null, screen_pad_top: m.frame && m.frame.screen_pad_top,
          hold: m.frame && m.frame.hold, sync_dot: m.frame && m.frame.sync_dot, hold_hits: m.frame && m.frame.hold_hits, dot_hits: m.frame && m.frame.dot_hits, dot_vs_hold: m.frame && m.frame.dot_vs_hold }])) });
        // the practice's key is the bank's
        expect(withClip(lang).target_index).toBe(1);
        expect(/is-right/.test(out.feedback_shown.cards[1].cls)).toBe(true);
      }, 240000);
    }
  }
});

// ------------------------------------------------------------------------------------------------------------------
// round 8 (row 30): the MCQ PRACTICE head on the coach-led 360×640 phone with the coach's served Skip instructions
// (r9_skip_instructions, on every tier) and the production layout switches. The head row holds Jugnu, the replay and
// the Skip, the Skip on one line at its served font, pinned in every practice state (the stem being read, each option
// lit, the read-out over with no choice, a choice held, feedback shown, the fold open and closed); the stem, the cards
// and the ring stay where they are without the Skip. In the fold-open state the tap at the Skip's centre only closes
// the modal fold; with the fold closed it skips to the part's Ready screen and nothing more is said or lit.
// ------------------------------------------------------------------------------------------------------------------
/** The bank's served practice question of a language (the contract's practice shape). */
function practiceOf(lang) {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test');
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'item-bank.sa-r28.v1.json'), 'utf8')).mcq.practice[lang];
  const text = typeof p.passage === 'string' ? p.passage : p.passage.text; // the bank's string, or { text, audio } once wired
  return { id: `${lang}.story_mcq_w3.p1`, passage: { text }, prompt: { text: p.question, audio: `sa/v5/${lang}/syn_pq.mp3` },
    options: p.options, option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_p_o${k}.mp3`), target_index: p.target_index, key: p.target_index + 1 };
}

maybeBrowser('sa_r28_mcq round 8: the coach-led phone practice head with the served Skip instructions (row 30)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });
  // the production switch set (seven): ur_fit (mount) + r8_layout, r8_lang_switch, r9_scroll_cue, r9_comp_text,
  // r10_urdu_fit, r9_skip_instructions
  const SERVED = { r8_layout: true, r8_lang_switch: true, r9_scroll_cue: true, r9_comp_text: true, r10_urdu_fit: true, r9_skip_instructions: true };
  const sizes = {};
  afterAll(() => { if (process.env.SA_B8_SIZES) fs.writeFileSync(process.env.SA_B8_SIZES, JSON.stringify(sizes, null, 1)); });

  function page(lang, ui) {
    const w = longestOf(lang);
    const item = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: w.q, audio: `sa/v5/${lang}/syn_q${n}.mp3` }, options: w.options,
      option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
    const task = mcqTask([item(1), item(2)], { id: `${lang}.story_mcq_w3`, lang, depends_on: null, practice: [practiceOf(lang)] });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0; window.__ev = []; window.__speaks = []; var cur = null;
  function speak(t, a0) { window.__speaks.push({ at: Date.now(), clip: a0 && (a0.audio || a0) }); var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; }); }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(Object.assign({ r28_mcq: true }, ui))}, tasks: [${JSON.stringify(task)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: true, onEvent: function (e) { window.__ev.push(e); } });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: true, handover: false, ur_fit: true,
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); view.render(); window.__view = view; window.__runner = runner;
</script></body></html>`;
  }
  async function open(lang, ui) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const html = mounted(page(lang, ui));
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
  const measure = () => document.fonts.ready.then(() => {
    const vh = window.innerHeight;
    const R = (e) => { const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const hitAt = (e) => { const b = e.getBoundingClientRect(); const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!x && e.contains(x); };
    const head = document.querySelector('.sae-mcq-head');
    const kids = Array.from(head.children).map((c) => Object.assign(R(c), { cls: c.className.replace(/\s+/g, ' ').trim(), sw: c.scrollWidth, cw: c.clientWidth, whole: c.scrollWidth <= c.clientWidth, hit: hitAt(c) }));
    const sk = head.querySelector('.sae-r9-skip');
    let skip = null;
    if (sk) {
      const cs = getComputedStyle(sk); const rg = document.createRange(); rg.selectNodeContents(sk);
      const lines = new Set(Array.from(rg.getClientRects()).filter((x) => x.width > 1).map((x) => Math.round(x.top))).size;
      skip = Object.assign(R(sk), { text: sk.textContent, cp: Array.from(sk.textContent).length, font: parseFloat(cs.fontSize), lines, ellipsis: cs.textOverflow === 'ellipsis' && sk.scrollWidth > sk.clientWidth,
        white_space: cs.whiteSpace, hit: hitAt(sk) });
    }
    const rb = head.querySelector('.sae-mcq-replay');
    const q = document.querySelector('.sae-mcq-q');
    const cards = Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => { const b = c.getBoundingClientRect(); return { top: +b.top.toFixed(1), h: +b.height.toFixed(1), ring_bottom: +(b.bottom + 7).toFixed(1), cls: c.className }; });
    const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
    const replay = rb ? R(rb) : null;
    return {
      vh, page_h: document.documentElement.scrollHeight, inner_scroll: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')),
      phase: window.__runner.view().phase, head: Object.assign(R(head), { sw: head.scrollWidth, cw: head.clientWidth }), kids, skip, replay,
      chip: !!head.querySelector('.sae-chip'),
      // the row's spare: its content width less the children's extent (gaps and the Skip's margin included)
      row_spare: +(head.clientWidth - (Math.max(...kids.map((k) => k.right)) - Math.min(...kids.map((k) => k.left)))).toFixed(1),
      replay_skip_edge: skip && replay ? +Math.max(replay.left - skip.right, skip.left - replay.right).toFixed(1) : null,
      stem: q ? R(q) : null, cards, ring_margin: +(vh - Math.max(...cards.map((c) => c.ring_bottom))).toFixed(1),
      fb: (() => { const f = document.querySelector('.sae-mcq .sae-fb:not(.is-empty)'); return f ? Object.assign(R(f), { text: f.textContent }) : null; })(),
      fold_open: !!document.querySelector('details.sae-mcq-coach[open]'),
      body_kids: Array.from(document.querySelectorAll('.sae-mcq .sae-body > *, .sae-mcq > *')).map((e) => Object.assign(R(e), { cls: String(e.className || e.tagName).split(' ')[0] })),
    };
  });
  /** The stem's ink above its clip top (everything around it hidden, its overflow shown): luminance < 120 at 2× DPR. */
  async function stemAbove(p) {
    const g = await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); const cs = getComputedStyle(q); const r = q.getBoundingClientRect();
      window.__b8h = [];
      document.querySelectorAll('.sae-mcq-opts, details.sae-mcq-coach, .sae-mcq-coach-line, .sae-mcq-passage, .sae-mcq-head, .sae-fb').forEach((e) => { window.__b8h.push(e); e.style.visibility = 'hidden'; });
      q.style.overflow = 'visible';
      return { top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom };
    });
    const y0 = Math.max(0, Math.floor(g.top - 30)); const y1 = Math.min(640, Math.ceil(g.bottom));
    const png = await p.screenshot({ clip: { x: 0, y: y0, width: 360, height: y1 - y0 } });
    const first = await p.evaluate(async ([b64, top]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const gg = c.getContext('2d'); gg.drawImage(img, 0, 0);
      const d = gg.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120) return top + y / 2; }
      return null;
    }, [png.toString('base64'), y0]);
    await p.evaluate(() => { window.__b8h.forEach((e) => { e.style.visibility = ''; }); document.querySelector('.sae-mcq-q').style.overflow = ''; });
    return first == null ? null : +Math.max(0, g.top - first).toFixed(1);
  }
  const endLine = async (p, gapMs) => { await p.evaluate(() => window.__end()); await p.waitForTimeout(gapMs); };
  const SHOT = { listening: 'listening', option2: 'speaking', chosen: 'chosen', feedback: 'feedback', foldopen: 'foldopen' };
  /** Every MCQ practice state of the served practice question, in one walk. */
  async function walk(lang, ui) {
    const out = {}; const taps = {};
    const shots = process.env.SA_B8_SHOTS || null;
    const snap = async (p, name) => {
      await p.waitForTimeout(200);
      out[name] = await p.evaluate(measure);
      out[name].stem_above = await stemAbove(p);
      if (shots && SHOT[name] && ui.r9_skip_instructions) await personShot(p, { path: path.join(shots, `b8_practice_${SHOT[name]}_${lang}_phone_coach.png`) });
    };
    let { ctx, p } = await open(lang, ui);
    await snap(p, 'listening');
    await endLine(p, 900); // the question ends; the swallow, then option 1 is read
    for (let k = 1; k <= 4; k++) { await snap(p, `option${k}`); await endLine(p, k < 4 ? 600 : 300); }
    await snap(p, 'open'); // the read-out over, no choice
    await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = true; d.dispatchEvent(new Event('toggle')); });
    await snap(p, 'foldopen');
    if (ui.r9_skip_instructions) {
      // the open fold is modal (B.3): the tap at the Skip's centre only closes it; the Skip does not fire
      const sk = out.foldopen.skip;
      const n0 = await p.evaluate(() => window.__ev.length);
      await p.mouse.click(sk.left + sk.w / 2, sk.top + sk.h / 2);
      await p.waitForTimeout(150);
      taps.foldopen = await p.evaluate((n) => ({ phase: window.__runner.view().phase, fold_open: !!document.querySelector('details.sae-mcq-coach[open]'),
        events: window.__ev.slice(n).map((e) => ({ type: e.type, by: e.by, card: e.card })) }), n0);
      await p.waitForTimeout(400); // past the ghost window
    } else {
      await p.evaluate(() => { const d = document.querySelector('details.sae-mcq-coach'); d.open = false; d.dispatchEvent(new Event('toggle')); });
      await p.waitForTimeout(400);
    }
    await snap(p, 'foldclosed');
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-opt')[3].click()); // a wrong card, held
    await snap(p, 'chosen');
    await p.waitForTimeout(900); // settle + press: the practice's feedback
    out.feedback = await p.evaluate(measure);
    out.feedback.stem_above = await stemAbove(p);
    if (shots && ui.r9_skip_instructions) await personShot(p, { path: path.join(shots, `b8_practice_feedback_${lang}_phone_coach.png`) });
    // coach-led, Jugnu says the practice feedback (try again) since round 28: that line ends first, then the retry reads
    // the same question again
    await endLine(p, 1600);
    for (let k = 0; k < 5; k++) await endLine(p, k === 0 ? 900 : 600);
    await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelectorAll('.sae-mcq-opt')[2].click()); // wrong again: the right card shown
    await p.waitForTimeout(1150);
    out.feedback_shown = await p.evaluate(measure);
    out.feedback_shown.stem_above = await stemAbove(p);
    await ctx.close();
    if (ui.r9_skip_instructions) {
      // the fold closed: the Skip's tap during option 2's clip lands on the Ready screen; nothing later is said or lit
      ({ ctx, p } = await open(lang, ui));
      await endLine(p, 900); await endLine(p, 600); // option 2 lit, its clip playing
      const before = await p.evaluate(measure);
      const sk = before.skip;
      const n0 = await p.evaluate(() => ({ ev: window.__ev.length, speaks: window.__speaks.length }));
      await p.mouse.click(sk.left + sk.w / 2, sk.top + sk.h / 2);
      const t0 = Date.now();
      await p.waitForTimeout(100);
      const after = await p.evaluate((n) => ({ phase: window.__runner.view().phase, ready_drawn: !!document.querySelector('.sae-ready'),
        events: window.__ev.slice(n.ev).map((e) => e.type) }), n0);
      await endLine(p, 1500); // the clip in flight ends; the read-out must not go on
      const later = await p.evaluate((n) => ({ speaks_after: window.__speaks.slice(n.speaks).map((s) => s.clip), lit: document.querySelectorAll('.sae-mcq-opt.is-speaking').length, phase: window.__runner.view().phase }), n0);
      taps.foldclosed = Object.assign({ lit_before: before.cards.map((c) => /is-speaking/.test(c.cls)), ms_to_check: Date.now() - t0 }, after, later);
      await ctx.close();
    }
    return { out, taps };
  }

  for (const [mnt, lang] of MOUNT_LANGS) {
    test(`[${mnt}] ${lang}: every practice state — the head row whole on the phone with the Skip on one line at its served font, pinned, ≥ 24 px from the replay; the stem, the cards and the ring as without the Skip`, async () => { MOUNT = MOUNTS[mnt];
      const base = (await walk(lang, Object.assign({}, SERVED, { r9_skip_instructions: false }))).out;
      const { out, taps } = await walk(lang, SERVED);
      const order = ['listening', 'option1', 'option2', 'option3', 'option4', 'open', 'foldopen', 'foldclosed', 'chosen', 'feedback'];
      expect(Object.keys(out).sort()).toEqual(order.concat('feedback_shown').sort());
      sizes[`${mnt}_${lang}`] = { states: out, taps, without_skip: Object.fromEntries(Object.entries(base).map(([k, m]) => [k, { head_h: m.head.h, chip: m.chip, cards_top: m.cards.map((c) => c.top), ring_margin: m.ring_margin, stem_top: m.stem.top }])) };
      const label = lang === 'ur' ? 'ہدایات چھوڑیں' : 'Skip instructions';
      const at = out.listening;
      for (const s of order) {
        const m = out[s];
        expect({ s, phase: m.phase }).toEqual({ s, phase: 'practice' });
        // (a) every head child inside 0–360, whole, hit at its centre; (b) the row does not overflow
        m.kids.forEach((k) => expect({ s, cls: k.cls, inside: k.left >= 0 && k.right <= 360, whole: k.whole, hit: k.hit }).toEqual({ s, cls: k.cls, inside: true, whole: true, hit: true }));
        expect({ s, row_over: m.head.sw > m.head.cw + 0.5 }).toEqual({ s, row_over: false });
        // (c) the Skip: present, one line at the served font, the label as served, ≥ 48 px tall, pinned in the head
        expect(m.skip).not.toBeNull();
        expect({ s, text: m.skip.text, lines: m.skip.lines, ellipsis: m.skip.ellipsis, font_ok: m.skip.font >= (lang === 'ur' ? 20 : 18), cp_ok: m.skip.cp <= 20, tall: m.skip.h >= 48 })
          .toEqual({ s, text: label, lines: 1, ellipsis: false, font_ok: true, cp_ok: true, tall: true });
        expect({ s, left: m.skip.left, w: m.skip.w, h: m.skip.h, off: +(m.skip.top - m.head.top).toFixed(1) })
          .toEqual({ s, left: at.skip.left, w: at.skip.w, h: at.skip.h, off: +(at.skip.top - at.head.top).toFixed(1) });
        // the chip yields to the Skip (means ii): the practice coach line says it is practice
        expect({ s, chip: m.chip }).toEqual({ s, chip: false });
        // (d′) the child's replay and the coach's Skip ≥ 24 px apart
        expect({ s, edge_ok: m.replay_skip_edge >= 24 }).toEqual({ s, edge_ok: true });
        // (d) the head's height kept and equal; the stem whole at its top; the cards and the ring where they are without the Skip
        expect({ s, head_h: m.head.h, head_ok: m.head.h >= 56 }).toEqual({ s, head_h: at.head.h, head_ok: true });
        expect({ s, stem_above: m.stem_above }).toEqual({ s, stem_above: 0 });
        // below the head nothing moves against the screen without the Skip: the stem and every card keep their distance
        // from the head's bottom, and the head is never taller (UR: the chip's 72 px row gives way to 56)
        const rel = (x) => ({ stem: +(x.stem.top - x.head.bottom).toFixed(1), cards: x.cards.map((c) => +(c.top - x.head.bottom).toFixed(1)) });
        expect({ s, rel: rel(m), head_not_taller: m.head.h <= base[s].head.h }).toEqual({ s, rel: rel(base[s]), head_not_taller: true });
        if (lang === 'en') {
          expect({ s, page_h: m.page_h, inner_scroll: m.inner_scroll }).toEqual({ s, page_h: m.vh, inner_scroll: 0 });
          expect({ s, ring_ok: m.ring_margin >= 8 }).toEqual({ s, ring_ok: true });
        } else {
          // the Urdu practice screen (passage + stem + four cards + the feedback line under them) does not fit 640 with
          // or without the Skip (reported for a ruling): the Skip never makes it worse
          expect({ s, inner_not_worse: m.inner_scroll <= base[s].inner_scroll, ring_not_worse: m.ring_margin >= base[s].ring_margin }).toEqual({ s, inner_not_worse: true, ring_not_worse: true });
        }
      }
      // the second wrong answer ends the practice (the runner is on its Ready screen while the feedback shows): no Skip
      expect({ phase: out.feedback_shown.phase, skip: out.feedback_shown.skip, fb: !!out.feedback_shown.fb }).toEqual({ phase: 'ready', skip: null, fb: true });
      expect(out.feedback.fb).not.toBeNull();
      expect(out.feedback_shown.fb).not.toBeNull();
      expect(/is-speaking/.test(out.option2.cards[1].cls)).toBe(true);
      expect(/is-chosen/.test(out.chosen.cards[3].cls)).toBe(true);
      expect(out.foldopen.fold_open).toBe(true);
      // the fold open: the tap at the Skip's centre closes the fold (modal), the Skip does not fire
      expect(taps.foldopen).toEqual({ phase: 'practice', fold_open: false, events: [{ type: 'fold_close', by: 'tap', card: null }] });
      // the fold closed: the same tap skips to the part's Ready screen; nothing later is said or lit
      expect({ lit_before: taps.foldclosed.lit_before[1], phase: taps.foldclosed.phase, ready: taps.foldclosed.ready_drawn, skipped: taps.foldclosed.events.includes('skip_instructions'),
        speaks_after: taps.foldclosed.speaks_after, lit: taps.foldclosed.lit })
        .toEqual({ lit_before: true, phase: 'ready', ready: true, skipped: true, speaks_after: [], lit: 0 });
    }, 240000);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// RDF auto (no coach box) on a 360×640 Urdu phone: the question card holds both lines of the served battery's two-line
// question (G2 Set A Q1). Read at DPR 3 and 2, in three states (the question being read, the answers open after the
// read-out, the Next offered), with the layout switches each tier serves on this battery, in every mount. Per state:
// the card does not scroll inside itself, the last line box of a Range over its text ends inside its padding box, the
// first answer card sits below it, and the question's ink (overflow made visible, everything else hidden) stays inside
// the card: none above its top, none below its bottom, none in the gap over answer 1. Ink = luminance < 120.
// ------------------------------------------------------------------------------------------------------------------
/** The served battery's MCQ question 1 of a language (sa.coach.G2.A.ur, the RDF auto list) and its four answers. */
function servedG2Q1(lang) {
  const fs = require('fs');
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', 'sa.coach.G2.A.ur.json'), 'utf8'));
  const t = b.tasks.find((x) => x.kind === 'mcq' && x.lang === (lang || 'ur') && (b.rdf_auto || []).includes(x.replaces));
  return { task: t, item: t.items[0] };
}
/** The layout switches each tier serves on that battery (its battery.ui, read from /sa/batteries/), MCQ on. */
const SERVED_UI = {
  sandbox: ['audio_gated_next', 'auto_child_last_word', 'auto_no_last_word', 'back_button', 'cell_next_only', 'cell_pace', 'coach_last_word', 'comp_all_questions', 'end_section',
    'end_test_restart', 'incomplete_move_on', 'one_at_a_time', 'passage_punct', 'r10_bigger_audio', 'r10_hint_once', 'r10_number_fit', 'r10_practice_gap', 'r10_practice_next',
    'r10_urdu_fit', 'r12_intro_once', 'r28_ceiling', 'r28_letter_pick', 'r28_mcq', 'r28_story_clock', 'r8_comp_wait_next', 'r8_counts', 'r8_highlight', 'r8_lang_switch',
    'r8_latin_digits', 'r8_layout', 'r8_missing_number', 'r8_nudges', 'r8_practice_autoplay', 'r8_reading_no_done', 'r8_reading_position', 'r8_story_snap', 'r8_timeup_continue',
    'r9_audio', 'r9_comp_text', 'r9_question_time', 'r9_scroll_cue', 'r9_skip_instructions', 'rdf_manual', 'say_then_next', 'section_recording', 'silence_repeat', 'story_scroll',
    't_sound_ta', 'tick_prompt', 'ur_fit', 'voice_gate_v2'],
  staging: ['audio_gated_next', 'auto_child_last_word', 'auto_no_last_word', 'back_button', 'cell_next_only', 'cell_pace', 'coach_last_word', 'comp_all_questions', 'end_section',
    'end_test_restart', 'incomplete_move_on', 'one_at_a_time', 'passage_punct', 'r10_bigger_audio', 'r10_hint_once', 'r10_number_fit', 'r10_practice_gap', 'r10_practice_next',
    'r10_urdu_fit', 'r12_intro_once', 'r20_auto_end_section', 'r28_mcq', 'r8_comp_wait_next', 'r8_counts', 'r8_highlight', 'r8_ios_mic', 'r8_lang_switch', 'r8_latin_digits',
    'r8_layout', 'r8_missing_number', 'r8_nudges', 'r8_practice_autoplay', 'r8_reading_no_done', 'r8_reading_position', 'r8_story_snap', 'r8_timeup_continue', 'r9_audio',
    'r9_comp_text', 'r9_question_time', 'r9_scroll_cue', 'r9_skip_instructions', 'rdf_manual', 'say_then_next', 'section_recording', 'silence_repeat', 'story_scroll', 't_sound_ta',
    'tick_prompt', 'ur_fit', 'voice_gate_v2'],
};
const RDF_Q_SIZES = {};
afterAll(() => { if (process.env.SA_RDF_Q_SIZES) require('fs').writeFileSync(process.env.SA_RDF_Q_SIZES, JSON.stringify(RDF_Q_SIZES, null, 1)); });

maybeBrowser('sa_r28_mcq RDF auto on a 360×640 Urdu phone: the two-line question card holds its ink (served G2 Set A Q1)', () => {
  const fs = require('fs');
  const SA = path.join(__dirname, '..', 'sa');
  const PUB = path.join(__dirname, '..', 'public', 'wq');
  let browser;
  beforeAll(async () => { browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  function page(set, manual, lang, swap) {
    const { task, item } = servedG2Q1(lang);
    const ui = Object.fromEntries(SERVED_UI[set].map((k) => [k, true]));
    // swap: another served question's text and answers in question 1's place (the sweep below)
    const first = swap ? Object.assign({}, item, { prompt: Object.assign({}, item.prompt, { text: swap.q }), options: swap.options }) : item;
    const t = Object.assign({}, task, { depends_on: null, items: [first, task.items[1]], practice: [] });
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0; var cur = null;
  function speak() { var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; }); }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = { battery_id: 'b', ui: ${JSON.stringify(ui)}, tasks: [${JSON.stringify(t)}] };
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: ${manual}, onEvent: function () {} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${manual}, handover: false, ur_fit: true,
    r28: { letter_pick: false, mcq: true, ceiling: false }, speak: speak });
  runner.start(); runner.instructionDone(); runner.begin(); view.render(); window.__view = view;
</script></body></html>`;
  }
  async function open(set, dpr, manual, lang, vw, swap) {
    const ctx = await browser.newContext({ viewport: vw || { width: 360, height: 640 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const html = mounted(page(set, manual, lang || 'ur', swap));
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
  /** Rows of ink (CSS px) in a band of the page with only the question card's text drawn (its overflow visible). */
  async function qInk(p, dpr, y0, y1, vh) {
    await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); const keep = new Set(); let n = q; while (n) { keep.add(n); n = n.parentElement; }
      window.__qi = { hidden: [], ov: q.style.overflow }; q.style.overflow = 'visible';
      document.querySelectorAll('body *').forEach((x) => { if (!keep.has(x) && !q.contains(x) && x.style.visibility !== 'hidden') { x.style.visibility = 'hidden'; window.__qi.hidden.push(x); } });
    });
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(vh ? vh.height : 640, Math.ceil(y1));
    const png = await p.screenshot({ clip: { x: 0, y: y0, width: vh ? vh.width : 360, height: y1 - y0 } });
    const rows = await p.evaluate(async ([b64, top, d]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data; const out = [];
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 120) { out.push(+(top + y / d).toFixed(2)); break; } }
      return out;
    }, [png.toString('base64'), y0, dpr]);
    await p.evaluate(() => { const q = document.querySelector('.sae-mcq-q'); window.__qi.hidden.forEach((x) => { x.style.visibility = ''; }); q.style.overflow = window.__qi.ov; delete window.__qi; });
    return rows;
  }
  async function read(p, dpr, vh) {
    await p.waitForTimeout(250);
    const g = await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); const cs = getComputedStyle(q); const r = q.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(q); const rects = Array.from(rg.getClientRects()).filter((x) => x.width || x.height);
      const o1 = document.querySelector('.sae-mcq-opt').getBoundingClientRect();
      const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
      const cards = Array.from(document.querySelectorAll('.sae-mcq-opt')).map((c) => c.getBoundingClientRect());
      return { top: r.top, bottom: r.bottom, h: +r.height.toFixed(2), pad_top: parseFloat(cs.paddingTop), pad_bottom: parseFloat(cs.paddingBottom), border_bottom: parseFloat(cs.borderBottomWidth), font: cs.fontSize + '/' + cs.lineHeight,
        sh_minus_ch: q.scrollHeight - q.clientHeight, lines: new Set(rects.map((x) => Math.round(x.top))).size,
        range_first_top: rects.length ? rects[0].top : null, range_last_bottom: rects.length ? rects[rects.length - 1].bottom : null,
        opt1_top: o1.top, clamp: !!document.querySelector('.sae-mcq.is-clamp'), coach: !!document.querySelector('.sae-mcq-coach'),
        nastaliq: document.fonts.check(cs.font, q.textContent), text: q.textContent,
        cards_top: cards.map((c) => +c.top.toFixed(1)), cards_h: cards.map((c) => Math.round(c.height)), ring_bottom: +(Math.max(...cards.map((c) => c.bottom)) + 7).toFixed(1),
        page_h: document.documentElement.scrollHeight, inner_scroll: over(document.querySelector('.sae-screen')) + over(document.querySelector('.sae-mcq .sae-body')),
        next: !!document.querySelector('.sa-next'), listening: !!document.querySelector('.sae-mcq.sae-mcq-listening'),
        // where the screen's room goes (top, bottom per part), for the record
        layout: Object.fromEntries([['top_bar', '.sae-mcq > .sae-top'], ['body', '.sae-mcq .sae-body'], ['title', '.sae-mcq .sae-task-tag'], ['head', '.sae-mcq-head'], ['card', '.sae-mcq-q'],
          ['opts', '.sae-mcq-opts'], ['foot', '.sae-mcq > .sae-foot'], ['next', '.sa-next']].map(([k, sel]) => { const e = document.querySelector(sel); if (!e) return [k, null];
          const b = e.getBoundingClientRect(); return [k, [+b.top.toFixed(1), +b.bottom.toFixed(1)]]; })) };
    });
    const rows = await qInk(p, dpr, g.top - 40, g.opt1_top + 20, vh);
    const R = (x) => +x.toFixed(2);
    return Object.assign(g, {
      top: R(g.top), bottom: R(g.bottom), opt1_top: R(g.opt1_top), range_first_top: R(g.range_first_top), range_last_bottom: R(g.range_last_bottom),
      // the last line's box (the Range's last client rect: the face's ascent + descent) against the card's padding box
      // (≤ 0: inside), and, for the record, against its content box (the line boxes alone)
      range_last_vs_padbox: R(g.range_last_bottom - (g.bottom - g.border_bottom)), range_last_vs_content: R(g.range_last_bottom - (g.bottom - g.border_bottom - g.pad_bottom)),
      gap_to_opt1: R(g.opt1_top - g.bottom),
      ink_top: rows.length ? rows[0] : null, ink_bottom: rows.length ? rows[rows.length - 1] : null,
      ink_above_card: rows.length ? R(Math.max(0, g.top - rows[0])) : null, ink_below_card: rows.length ? R(Math.max(0, rows[rows.length - 1] - (g.bottom - 1 / dpr))) : null,
      ink_rows_in_gap: rows.filter((y) => y >= g.bottom && y < g.opt1_top).length,
      // the room left between the ink and the card's edges (record)
      ink_clear_top: rows.length ? R(rows[0] - g.top) : null, ink_clear_bottom: rows.length ? R(g.bottom - rows[rows.length - 1]) : null,
    });
  }
  /** The three RDF auto states of question 1: listening (Jugnu reading the question), open (after the read-out), and
   *  the Next offered (past the per-mode wait; an auto replay in between is read to its end). */
  async function states(set, dpr, manual, lang, vw) {
    const out = {};
    const { ctx, p } = await open(set, dpr, manual, lang, vw);
    out.listening = await read(p, dpr, vw);
    for (let k = 0; k < 5; k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(k === 0 ? 900 : 600); }
    out.open = await read(p, dpr, vw);
    for (let k = 0; k < 8; k++) {
      await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
      await p.waitForTimeout(300);
      while (await p.evaluate(() => window.__end())) await p.waitForTimeout(700);
      if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sa-next'); })) break;
    }
    out.offernext = await read(p, dpr, vw);
    if (process.env.SA_RDF_Q_SHOTS && MOUNT === MOUNTS.prod && !vw) await personShot(p, { path: path.join(process.env.SA_RDF_Q_SHOTS, `q_${set}_${lang || 'ur'}_${manual ? 'coach' : 'auto'}_dpr${dpr}_offernext.png`) });
    await ctx.close();
    if (process.env.SA_RDF_Q_SHOTS && MOUNT === MOUNTS.prod && !vw) {
      // the three states, shot again on a fresh page at this DPR (the read above restores the page after its ink read)
      const s = await open(set, dpr, manual, lang);
      await personShot(s.p, { path: path.join(process.env.SA_RDF_Q_SHOTS, `q_${set}_${lang || 'ur'}_${manual ? 'coach' : 'auto'}_dpr${dpr}_listening.png`) });
      for (let k = 0; k < 5; k++) { await s.p.evaluate(() => window.__end()); await s.p.waitForTimeout(k === 0 ? 900 : 600); }
      await s.p.waitForTimeout(250);
      await personShot(s.p, { path: path.join(process.env.SA_RDF_Q_SHOTS, `q_${set}_${lang || 'ur'}_${manual ? 'coach' : 'auto'}_dpr${dpr}_open.png`) });
      await s.ctx.close();
    }
    return out;
  }

  for (const mnt of MOUNT_NAMES) {
    for (const set of Object.keys(SERVED_UI)) {
      for (const dpr of [3, 2]) {
        test(`[${mnt}] ${set}'s switches, DPR ${dpr}: question 1 in RDF auto — listening, open, Next offered: no scroll in the card, its last line inside the padding box, its ink inside the card and none over answer 1`, async () => { MOUNT = MOUNTS[mnt];
          const r = await states(set, dpr, false);
          RDF_Q_SIZES[`${mnt}|${set}|ur|auto|dpr${dpr}`] = r;
          if (process.env.SA_FIT_DEBUG) process.stdout.write(`RDFQ ${mnt} ${set} dpr${dpr} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, m]) => [k, { h: m.h, font: m.font, pad: [m.pad_top, m.pad_bottom], sh_ch: m.sh_minus_ch, range_last_vs_padbox: m.range_last_vs_padbox, range_last_vs_content: m.range_last_vs_content, gap: m.gap_to_opt1, ink_above: m.ink_above_card, ink_below: m.ink_below_card, ink_gap: m.ink_rows_in_gap, clamp: m.clamp, ring: m.ring_bottom, inner: m.inner_scroll, page_h: m.page_h }])))}\n`);
          expect({ listening: r.listening.listening, open: r.open.listening, next: r.offernext.next }).toEqual({ listening: true, open: false, next: true });
          for (const [state, m] of Object.entries(r)) {
            expect({ state, text: m.text, coach: m.coach, nastaliq: m.nastaliq, lines: m.lines }).toEqual({ state, text: servedG2Q1('ur').item.prompt.text, coach: false, nastaliq: true, lines: 2 });
            expect({ state, sh_minus_ch: m.sh_minus_ch, last_line_inside: m.range_last_vs_padbox <= 0, range_last_vs_padbox: m.range_last_vs_padbox, gap_ok: m.gap_to_opt1 >= 0, ink_rows_in_gap: m.ink_rows_in_gap,
              ink_above_card: m.ink_above_card, ink_below_card: m.ink_below_card })
              .toEqual({ state, sh_minus_ch: 0, last_line_inside: true, range_last_vs_padbox: m.range_last_vs_padbox, gap_ok: true, ink_rows_in_gap: 0, ink_above_card: 0, ink_below_card: 0 });
            expect({ state, cards_h: m.cards_h }).toEqual({ state, cards_h: [56, 56, 56, 56] });
            // the room the card takes never scrolls the cards: before the Next is offered nothing scrolls and the lowest
            // card's ring ends inside the body (the Next offered in the foot is read, not asserted here)
            if (state !== 'offernext') expect({ state, page_h: m.page_h, inner_scroll: m.inner_scroll, ring_in_body: m.ring_bottom <= m.layout.body[1] })
              .toEqual({ state, page_h: 640, inner_scroll: 0, ring_in_body: true });
          }
        }, 180000);
      }
    }
  }
  /** The question card's ink line by line: its text split at its line breaks into spans (the layout checked unchanged),
   *  everything else hidden, overflow visible, one line drawn at a time; a pixel is ink when its luminance < 120 with
   *  that line drawn and >= 120 with no text drawn. Per line its ink top and bottom (CSS px), and per pair of
   *  consecutive lines the gap between line N's ink bottom and line N+1's ink top (< 0: the lines' ink overlaps). */
  async function qLineInk(p, dpr) {
    const geo = await p.evaluate(() => {
      const q = document.querySelector('.sae-mcq-q'); const before = q.getBoundingClientRect();
      const tw = document.createTreeWalker(q, NodeFilter.SHOW_TEXT); const nodes = []; let n; while ((n = tw.nextNode())) nodes.push(n);
      const r = document.createRange(); const tops = []; const segs = [];
      nodes.forEach((tn) => { const s = tn.textContent; let cur = null;
        for (let i = 0; i < s.length; i++) { r.setStart(tn, i); r.setEnd(tn, i + 1); const rc = r.getClientRects()[0]; let line = cur ? cur.line : 0;
          if (rc && rc.width) { const t = Math.round(rc.top); let k = tops.findIndex((x) => Math.abs(x - t) <= 4); if (k < 0) { tops.push(t); k = tops.length - 1; } line = k; }
          if (!cur || cur.line !== line) { cur = { tn, start: i, end: i + 1, line }; segs.push(cur); } else cur.end = i + 1; } });
      const order = tops.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      window.__ql = { q, html: q.innerHTML, hidden: [], css: q.style.cssText };
      for (let k = segs.length - 1; k >= 0; k--) { const sg = segs[k]; const sp = document.createElement('span'); sp.className = 'ql-line'; sp.dataset.l = String(order.indexOf(sg.line));
        sp.textContent = sg.tn.textContent.slice(sg.start, sg.end); const after = sg.tn.splitText(sg.start); after.textContent = after.textContent.slice(sg.end - sg.start); sg.tn.parentNode.insertBefore(sp, after); }
      q.style.overflow = 'visible'; q.style.webkitLineClamp = 'none'; q.style.display = 'block';
      const aft = q.getBoundingClientRect(); const keep = new Set(); let e = q; while (e) { keep.add(e); e = e.parentElement; }
      document.querySelectorAll('body *').forEach((x) => { if (!keep.has(x) && !q.contains(x) && x.style.visibility !== 'hidden') { x.style.visibility = 'hidden'; window.__ql.hidden.push(x); } });
      return { lines: tops.length, same_layout: Math.abs(before.height - aft.height) < 0.5 && Math.abs(before.top - aft.top) < 0.5, top: aft.top, bottom: aft.bottom };
    });
    const y0 = Math.max(0, Math.floor(geo.top) - 60); const clip = { x: 0, y: y0, width: 360, height: Math.min(640, Math.ceil(geo.bottom) + 60) - y0 };
    const mask = async () => p.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let s = '';
      for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 120 ? '1' : '0';
      return { w: c.width, m: s }; }, (await p.screenshot({ clip })).toString('base64'));
    const show = (k) => p.evaluate((k) => document.querySelectorAll('.ql-line').forEach((sp) => { sp.style.color = String(k) === sp.dataset.l ? '' : 'transparent'; }), k);
    await show(-1); const none = await mask();
    const ink = [];
    for (let k = 0; k < geo.lines; k++) {
      await show(k); const A = await mask(); let top = null, bottom = null;
      for (let i = 0; i < A.m.length; i++) if (A.m[i] === '1' && none.m[i] === '0') { const y = y0 + Math.floor(i / A.w) / dpr; if (top == null) top = y; bottom = y + 1 / dpr; }
      ink.push({ top: +top.toFixed(2), bottom: +bottom.toFixed(2) });
    }
    await p.evaluate(() => { const o = window.__ql; o.hidden.forEach((x) => { x.style.visibility = ''; }); o.q.innerHTML = o.html; o.q.style.cssText = o.css; delete window.__ql; });
    return { lines: geo.lines, same_layout: geo.same_layout, ink, gaps: ink.slice(1).map((x, i) => +(x.top - ink[i].bottom).toFixed(2)) };
  }
  /** Reach on the screen as drawn: every answer card whole and hit at its centre, the offered Next whole and hit at its
   *  centre, the body's and the screen's scroll overflow, the page's, and a drawn scroll cue. */
  const reach = (p) => p.evaluate(() => {
    const vh = window.innerHeight; const vw = window.innerWidth;
    const ok = (k) => { const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= vw && !!e && (e === k || k.contains(e)); };
    const over = (n) => (n ? Math.max(0, Math.round(n.scrollHeight - n.clientHeight)) : 0);
    const scr = document.querySelector('.sae-screen'); const nx = document.querySelector('.sae-screen .sa-next');
    return { options_ok: Array.from(document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt')).filter(ok).length, next_ok: !!nx && ok(nx),
      body_over: over(scr.querySelector('.sae-body')), screen_over: over(scr), page_over: Math.max(0, document.documentElement.scrollHeight - vh),
      cue: Array.from(document.querySelectorAll('.sae-r9-scroll')).some((c) => !c.hidden && getComputedStyle(c).display !== 'none') };
  });
  // a two-line Urdu question in RDF auto on a 360×640 phone: line 2's ink starts below line 1's ink (they never draw
  // into each other), and the card that holds them still leaves all four answers, the offered Next and the replay in
  // reach with nothing scrolling — the served G2 Set A Q1 and the longest served Urdu question, both tiers' switches
  const LONGEST_UR = 'ur.story2.q5'; // 43 characters; after Q1, the tallest ink of the served Urdu questions
  for (const set of Object.keys(SERVED_UI)) for (const dpr of [3, 2]) {
    test(`[prod] ${set}'s switches, DPR ${dpr}: Q1 and the longest Urdu question in RDF auto — the two lines' ink apart, four answers and the offered Next in reach, nothing scrolls`, async () => { MOUNT = MOUNTS.prod;
      const longest = servedOf('ur').find((x) => x.id === LONGEST_UR);
      expect(longest).toBeTruthy();
      const rows = {};
      for (const [id, swap] of [['q1', null], [LONGEST_UR, longest]]) {
        const { ctx, p } = await open(set, dpr, false, 'ur', null, swap);
        for (let k = 0; k < 5; k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(k === 0 ? 900 : 600); }
        await p.waitForTimeout(250);
        const read_ink = await qLineInk(p, dpr); const read_reach = await reach(p);
        for (let k = 0; k < 8; k++) {
          await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
          await p.waitForTimeout(300);
          while (await p.evaluate(() => window.__end())) await p.waitForTimeout(700);
          if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sa-next'); })) break;
        }
        await p.waitForTimeout(250);
        const offer_ink = await qLineInk(p, dpr); const offer_reach = await reach(p);
        if (process.env.SA_RDF_Q_SHOTS) await personShot(p, { path: path.join(process.env.SA_RDF_Q_SHOTS, `lines_${set}_${id}_dpr${dpr}_offernext.png`) });
        await ctx.close();
        rows[id] = { read_ink, read_reach, offer_ink, offer_reach };
      }
      RDF_Q_SIZES[`prod|${set}|ur|auto|dpr${dpr}|lines_apart`] = rows;
      for (const [id, r] of Object.entries(rows)) {
        for (const st of ['read', 'offer']) {
          const i = r[`${st}_ink`];
          expect({ id, st, lines: i.lines, same_layout: i.same_layout, apart: i.gaps.every((g) => g >= 0), gaps: i.gaps })
            .toEqual({ id, st, lines: 2, same_layout: true, apart: true, gaps: i.gaps });
        }
        expect({ id, read: r.read_reach, offer: r.offer_reach }).toEqual({ id,
          read: { options_ok: 4, next_ok: false, body_over: 0, screen_over: 0, page_over: 0, cue: false },
          offer: { options_ok: 4, next_ok: true, body_over: 0, screen_over: 0, page_over: 0, cue: false } });
      }
    }, 240000);
  }
  // every served Urdu question with its own answers, the question being read (sandbox's switches, DPR 2): the same
  // card rules hold one line or two, and the room the card takes never scrolls the cards
  test(`[${MOUNT_NAMES[0]}] every served Urdu question in RDF auto: its ink inside the card, nothing scrolls`, async () => { MOUNT = MOUNTS[MOUNT_NAMES[0]];
    const rows = {};
    for (const it of servedOf('ur')) {
      const { ctx, p } = await open('sandbox', 2, false, 'ur', null, it);
      const m = await read(p, 2);
      await ctx.close();
      rows[it.id] = { lines: m.lines, h: m.h, sh_minus_ch: m.sh_minus_ch, ink_above_card: m.ink_above_card, ink_below_card: m.ink_below_card, ink_rows_in_gap: m.ink_rows_in_gap,
        ink_clear_top: m.ink_clear_top, ink_clear_bottom: m.ink_clear_bottom, ring_bottom: m.ring_bottom, body_bottom: m.layout.body[1], inner_scroll: m.inner_scroll, page_h: m.page_h };
    }
    RDF_Q_SIZES[`${MOUNT_NAMES[0]}|sandbox|ur|auto|dpr2|served_sweep`] = rows;
    expect(Object.keys(rows).length).toBeGreaterThanOrEqual(12);
    expect(Object.entries(rows).map(([id, r]) => ({ id, sh_minus_ch: r.sh_minus_ch, ink_above_card: r.ink_above_card, ink_below_card: r.ink_below_card, ink_rows_in_gap: r.ink_rows_in_gap, inner_scroll: r.inner_scroll, page_h: r.page_h, ring_in_body: r.ring_bottom <= r.body_bottom }))
      .filter((x) => x.sh_minus_ch !== 0 || x.ink_above_card !== 0 || x.ink_below_card !== 0 || x.ink_rows_in_gap !== 0 || x.inner_scroll !== 0 || x.page_h !== 640 || !x.ring_in_body)).toEqual([]);
  }, 600000);
  // the frames this rule must leave as they are, read for the record (sizes only; the claim is the before/after
  // compare): the coach-led phone (its own padding 25/13, asserted by the round-5 sweep), English RDF auto, the tablet
  test('[prod] the coach-led phone, English RDF auto and the 800×1280 tablet, read for the record', async () => { MOUNT = MOUNTS.prod;
    const TAB = { width: 800, height: 1280 };
    for (const set of Object.keys(SERVED_UI)) for (const dpr of [3, 2]) {
      RDF_Q_SIZES[`prod|${set}|ur|coach|dpr${dpr}`] = await states(set, dpr, true, 'ur');
      RDF_Q_SIZES[`prod|${set}|en|auto|dpr${dpr}`] = await states(set, dpr, false, 'en');
    }
    for (const set of Object.keys(SERVED_UI)) for (const [lang, manual] of [['ur', false], ['ur', true], ['en', false]]) {
      RDF_Q_SIZES[`prod|${set}|${lang}|${manual ? 'coach' : 'auto'}|tablet|dpr2`] = await states(set, 2, manual, lang, TAB);
    }
    expect(Object.keys(RDF_Q_SIZES).filter((k) => /^prod\|/.test(k) && /\|(coach|en\|auto|tablet)\|/.test(k)).length).toBeGreaterThanOrEqual(14);
  }, 900000);
});

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
    // round 7: the Urdu coach's line takes a 2.81 line pitch and 22 px sides (its lines apart, its ink inside its box);
    // the fold's row meets it on the empty leading below its last line
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-coach-line[lang=ur]').margin).toBe('-1px 0 -2px');
    expect(decl('.sae .sae-mcq:has(.sae-mcq-coach) .sae-mcq-coach-line[lang=ur]')['line-height']).toBe('2.81');
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
