'use strict';
/**
 * Round 8, item 28 (the content owner: "say something, press Next"): with sa_r8_comp_wait_next ON a story or listening
 * question's button reads «آگے» / Next, so its say-then-press hint must name that button. The served battery carries a
 * second hint, lines.r7_say_next_q, only when sa_say_then_next AND sa_r8_comp_wait_next are both ON; r7_say_done stays
 * for the other spoken screens (the maths sums), whose button reads «ہو گیا» / Done. Each line has its clip in every set.
 */
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const R7A = require('../routes/sa-r7a-content');

const DASH = path.join(__dirname, '..');
const B = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G1.A.${lang}.json`), 'utf8'));
const ON = { rdfW3Forms: true, sayThenNext: true };

test('both switches ON: the question hint names Next / «آگے», in the battery\'s language, with its clip key', () => {
  for (const lang of ['en', 'ur']) {
    const out = applySwitches(B(lang), { ...ON, r8CompWaitNext: true });
    const q = out.lines.r7_say_next_q;
    expect(q).toEqual({ text: R7A.LINES.r7_say_next_q[lang], audio: R7A.keyOf(lang, R7A.LINES.r7_say_next_q[lang]) });
    expect(q.text).toContain(lang === 'ur' ? '«آگے»' : 'Next');
    expect(q.text).not.toMatch(/ہو گیا|Done/);
    expect(out.lines.r7_say_done.text).toBe(R7A.LINES.r7_say_done[lang]);
  }
});

test('either switch OFF: no question hint, the battery as before', () => {
  for (const lang of ['en', 'ur']) {
    expect(applySwitches(B(lang), ON).lines.r7_say_next_q).toBeUndefined();
    expect(applySwitches(B(lang), { rdfW3Forms: true, r8CompWaitNext: true }).lines.r7_say_next_q).toBeUndefined();
  }
});

test('the Done hint keeps «ہو گیا» with the space before «بٹن»', () => {
  expect(R7A.LINES.r7_say_done.ur).toContain('«ہو گیا» کا بٹن');
  expect(R7A.LINES.r7_say_done.ur).not.toContain('کابٹن');
});

// The reviewed set (sa/v4) ships with its own change; where it is on disk, these lines must be in it too.
const V4 = fs.existsSync(path.join(DASH, 'sa', 'v4', 'ur'));
// Word timings (round 8 item 32) ship separately; checked where that set carries them.
const TIMED = V4 && fs.readdirSync(path.join(DASH, 'sa', 'v4', 'ur')).some((f) => f.endsWith('.json'));

test('every hint line has its clip in v1, v2 (and v4, with word timings where that set has them)', () => {
  const missing = [];
  for (const [k, both] of Object.entries(R7A.LINES)) {
    for (const lang of ['en', 'ur']) {
      const key = R7A.keyOf(lang, both[lang]);
      for (const set of V4 ? ['v1', 'v2', 'v4'] : ['v1', 'v2']) {
        const f = path.join(DASH, key.replace(/^sa\/v1\//, `sa/${set}/`));
        if (!fs.existsSync(f) || fs.statSync(f).size < 500) missing.push(`${k} ${set} ${lang}`);
      }
      if (TIMED && !fs.existsSync(path.join(DASH, key.replace(/^sa\/v1\//, 'sa/v4/').replace(/\.mp3$/, '.json')))) missing.push(`${k} v4 ${lang} timings`);
    }
  }
  expect(missing).toEqual([]);
});

// The screen side: sa-ui's hintOf picks the question hint where the button reads Next (compWait), and the Done hint
// everywhere else. Mounts the real UI on a jsdom page with a real runner and records what Jugnu says.
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui: the spoken hint on a story question names the button it shows', () => {
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
  afterEach(() => {
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    jest.useRealTimers();
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const textOf = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text != null ? x.text : (x.en || x.ur || ''));
  const LINES = (lang, q) => Object.assign({
    r7_say_done: { text: R7A.LINES.r7_say_done[lang], audio: R7A.keyOf(lang, R7A.LINES.r7_say_done[lang]) },
  }, q ? { r7_say_next_q: { text: R7A.LINES.r7_say_next_q[lang], audio: R7A.keyOf(lang, R7A.LINES.r7_say_next_q[lang]) } } : {});
  const battery = (ui, lines, subtask) => ({
    battery_id: 'b', ui, lines,
    tasks: [{ id: 'x.task', subtask, mode: 'oral', question_timeout_s: 10, intro: { en: 'Listen.', ur: 'سنیں۔' },
      items: [{ id: 'q1', say: 'Who sat?' }, { id: 'q2', say: 'Where?' }] }],
  });
  async function toQuestion(b, lang) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const runner = core.createRunner({ battery: b, onEvent: () => {}, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery: b, lang, mode: 'game', speak: (t, a) => { said.push(t || a); return Promise.resolve(); } });
    views.push(view);
    runner.start(); view.render();
    await jest.advanceTimersByTimeAsync(2000);
    runner.instructionDone(); runner.begin(); view.render();
    await jest.advanceTimersByTimeAsync(50);
    const hint = el.querySelector('.sae-r7-hint');
    return { said: said.map(textOf), hint: hint ? hint.textContent : null };
  }
  const ON = { say_then_next: true, r8_comp_wait_next: true };

  for (const lang of ['en', 'ur']) {
    test(`${lang}: a story question (button Next) says and shows the Next hint, never the Done one`, async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      for (const sub of ['reading_comprehension', 'listening_comprehension']) {
        const x = await toQuestion(battery(ON, LINES(lang, true), sub), lang);
        expect(x.said).toContain(R7A.LINES.r7_say_next_q[lang]);
        expect(x.said).not.toContain(R7A.LINES.r7_say_done[lang]);
        expect(x.hint).toBe(R7A.LINES.r7_say_next_q[lang]);
        views.splice(0).forEach((v) => v.destroy());
      }
    });
    test(`${lang}: a spoken sum (button Done) keeps the Done hint`, async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const x = await toQuestion(battery(ON, LINES(lang, true), 'mental_addition'), lang);
      expect(x.said).toContain(R7A.LINES.r7_say_done[lang]);
      expect(x.said).not.toContain(R7A.LINES.r7_say_next_q[lang]);
    });
    test(`${lang}: comp_wait OFF, or no question line in the battery: the Done hint, as before`, async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      let x = await toQuestion(battery({ say_then_next: true }, LINES(lang, true), 'reading_comprehension'), lang);
      expect(x.said).toContain(R7A.LINES.r7_say_done[lang]);
      views.splice(0).forEach((v) => v.destroy());
      x = await toQuestion(battery(ON, LINES(lang, false), 'reading_comprehension'), lang);
      expect(x.said).toContain(R7A.LINES.r7_say_done[lang]);
      expect(x.hint).toBe(R7A.LINES.r7_say_done[lang]);
    });
  }
});
