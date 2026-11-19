'use strict';
/**
 * Round 28 (data only): the story question's FIRST choice. The spoken MCQ scores the choice that stands (the last card
 * tapped); the answer now also carries first_choice, the first card the child tapped on that question, so a changed
 * mind can be read afterwards. No switch, no behaviour change: the score stays the last tap. Fixtures are synthetic.
 * UI (jsdom, NODE_PATH=../portal/node_modules or the portal's own copy).
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
maybe('the story question keeps its first choice', () => {
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

  test('core: answer(0, { first_choice: 2 }) keeps first_choice on the answer; the score is the value', () => {
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [mcqTask(QS.slice(0, 2))] }, now: () => 0, r28_mcq: true });
    r.start(); r.instructionDone(); r.begin(); r.promptDone();
    r.answer(0, { first_choice: 2, changes: 1 });
    expect(r.snapshot().current.answers[0]).toEqual({ item_id: 'ur.story_w3.q1', value: 0, ok: false, first_choice: 2, changes: 1 });
  });

  test.each([[true, 'coach-led'], [false, 'RDF auto']])('%s %s: taps on option 2 then option 0: the answer is 0, first_choice 2', async (manual) => {
    setup();
    const { el, voice, answers, runner } = mountMcq({ runner: { manual }, ui: { manual } });
    await wait(20);
    await voice.speakNext(40); // the question
    await voice.speakNext(40); // option 1
    await voice.speakNext(80, async () => { cards(el)[2].click(); }); // option 2 playing: held on card 2
    await voice.speakNext(80, async () => { cards(el)[0].click(); }); // moved to card 0
    await voice.speakNext(40); // option 4
    await wait(1200);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(0);
    expect(answers[0].meta.first_choice).toBe(2);
    const a = runner.snapshot().current.answers[0]; // the row's answer (sa-store putResults keeps it whole)
    expect(a).toMatchObject({ value: 0, first_choice: 2, changes: 1 });
  }, 20000);

  test.each([[true, 'coach-led'], [false, 'RDF auto']])('%s %s: a single tap: first_choice is the answer', async (manual) => {
    setup();
    const { el, voice, answers } = mountMcq({ runner: { manual }, ui: { manual } });
    await wait(20);
    for (let k = 0; k < 5; k++) await voice.speakNext(40);
    await wait(300);
    cards(el)[3].click();
    await wait(900);
    expect(answers).toHaveLength(1);
    expect(answers[0].v).toBe(3);
    expect(answers[0].meta.first_choice).toBe(3);
    expect(answers[0].meta.changes).toBe(0);
  }, 20000);
});
