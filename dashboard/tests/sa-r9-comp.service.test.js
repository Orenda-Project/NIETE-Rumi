'use strict';
/**
 * Round 9 item 6 (battery.ui.r9_comp_text): a question on the story the child has just read is shown in writing on the
 * child's screen AND said by Jugnu on arrival, Urdu and English, in RDF auto and RDF manual.
 *   - only the story's questions (subtask reading_comprehension); a listening question is never written, or the
 *     listening task would become a reading one;
 *   - the words in the task's own language (lang / dir), large, one copy on the screen: in RDF manual the coach's copy of
 *     the same words gives way to the child's (the coach keeps the "read this to the child" cue when the coach reads);
 *   - OFF: the screen is today's, byte for byte.
 * Mounts the real UI on a jsdom page with a real runner and the real batteries' question tasks.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
/** A task of a real battery, on its own (no depends_on, no practice: straight to its first question). */
function alone(f, id) {
  const t = JSON.parse(JSON.stringify(form(f).tasks.find((x) => x.id === id)));
  delete t.depends_on;
  t.practice = [];
  (t.items || []).forEach((it) => { delete it.gate; });
  return t;
}
// Every switch prod has ON (rounds 7b and 8), so the item is proven with them.
const PROD = {
  audio_gated_next: true, say_then_next: true, back_button: true, one_at_a_time: true, story_scroll: true, tick_prompt: true,
  r8_layout: true, r8_story_snap: true, r8_nudges: true, r8_highlight: true, r8_comp_wait_next: true, r8_reading_no_done: true,
  r8_practice_autoplay: true, r8_latin_digits: true, r8_missing_number: true,
};

maybe('sa-ui round 9 item 6: story questions written and said', () => {
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
  function battery(task, ui) { return { battery_id: 'b', ui, lines: {}, tasks: [task] }; }
  function mount(b, o) {
    o = o || {};
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const runner = core.createRunner({ battery: b, onEvent: () => {}, mic: () => 'ok', manual: !!o.manual });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({
      runner, battery: b, lang: o.lang || 'en', mode: o.manual ? 'proctored' : 'game', manual: !!o.manual, app_asks: !!o.asks,
      ur_fit: true, speak: (t, a) => { said.push([t, a]); return Promise.resolve(); },
    }, o.ui || {}));
    views.push(view);
    return { runner, el, view, said };
  }
  async function toQuestion(m) {
    m.runner.start(); m.runner.instructionDone(); m.runner.begin(); m.view.render();
    await jest.advanceTimersByTimeAsync(50);
  }
  const q = (el) => el.querySelector('.sae-r9-q');

  // RDF auto, both languages, on the page in either language (the English story's questions are in English on the Urdu page)
  const AUTO = [
    ['sa.coach.G1.A.ur.json', 'ur.story_comp_w3', 'ur', 'ur', 'rtl'],
    ['sa.coach.G1.A.ur.json', 'en.story_comp_w3', 'ur', 'en', 'ltr'],
    ['sa.coach.G3.A.en.json', 'en.story_comp_w3', 'en', 'en', 'ltr'],
    ['sa.coach.G3.A.en.json', 'ur.story_comp_w3', 'en', 'ur', 'rtl'],
    ['sa.game.G1.en.json', 'en.story2_comp', 'en', 'en', 'ltr'],
  ];
  test.each(AUTO)('ON, RDF auto (%s %s, page %s): the question is on the screen in its language and said on arrival', async (f, id, page, tl, dir) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const task = alone(f, id);
    const m = mount(battery(task, Object.assign({}, PROD, { r9_comp_text: true })), { lang: page });
    await toQuestion(m);
    const first = task.items[0];
    const shown = q(m.el);
    expect(shown).not.toBeNull();
    expect(shown.textContent).toBe(first.prompt.text);
    expect(shown.getAttribute('lang')).toBe(tl);
    expect(shown.getAttribute('dir')).toBe(dir);
    expect(m.el.classList.contains('is-r9-comp')).toBe(true);
    // said on arrival: the question's own clip
    expect(m.said.some(([t, a]) => textOf(t) === first.prompt.text && (a === first.prompt.audio || (t && t.audio === first.prompt.audio)))).toBe(true);
    // one copy of the words, above the mic; the mic and Next are still there
    expect([...m.el.querySelectorAll('.sae-screen *')].filter((n) => n.children.length === 0 && n.textContent === first.prompt.text)).toHaveLength(1);
    const mic = m.el.querySelector('.sae-mic');
    expect(mic).not.toBeNull();
    expect(shown.compareDocumentPosition(mic) & 4).toBeTruthy(); // the mic follows the question
    expect(m.el.querySelector('.sae-foot .sa-next')).not.toBeNull();
    // the next question replaces it, and is said too
    m.el.querySelector('.sae-foot .sa-next').click();
    await jest.advanceTimersByTimeAsync(400);
    expect(m.runner.view().item.id).toBe(task.items[1].id);
    expect(q(m.el).textContent).toBe(task.items[1].prompt.text);
    expect(m.said.some(([t]) => textOf(t) === task.items[1].prompt.text)).toBe(true);
  });

  test('ON: a listening question is never written (it would become a reading task); it is still said', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    for (const [id, page] of [['ur.listening', 'ur'], ['en.listening', 'en']]) {
      document.getElementById('m').innerHTML = '';
      const task = alone('sa.coach.G1.A.ur.json', id);
      const m = mount(battery(task, Object.assign({}, PROD, { r9_comp_text: true })), { lang: page });
      await toQuestion(m);
      expect(m.runner.view().item.id).toBe(task.items[0].id);
      expect(q(m.el)).toBeNull();
      expect(m.el.textContent).not.toContain(task.items[0].prompt.text);
      expect(m.said.some(([t]) => textOf(t) === task.items[0].prompt.text)).toBe(true);
      views.splice(0).forEach((v) => v.destroy());
    }
  });

  test('ON, RDF manual (the coach reads): the question large for the child, once; the coach keeps the read-aloud cue', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const task = alone('sa.coach.G1.A.ur.json', 'ur.story_comp_w3');
    const m = mount(battery(task, Object.assign({}, PROD, { r9_comp_text: true })), { lang: 'ur', manual: true });
    await toQuestion(m);
    const words = task.items[0].prompt.text;
    expect(q(m.el)).not.toBeNull();
    expect(q(m.el).textContent).toBe(words);
    expect(q(m.el).getAttribute('lang')).toBe('ur');
    expect([...m.el.querySelectorAll('.sae-screen *')].filter((n) => n.children.length === 0 && n.textContent === words)).toHaveLength(1);
    expect(m.el.querySelector('.sae-coach-line')).toBeNull();
    expect(m.el.textContent).toContain('یہ بچے کو پڑھ کر سنائیں:');
  });

  test('ON, RDF manual with the app asking: the question large and said by Jugnu; no folded second copy', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const task = alone('sa.coach.G3.A.en.json', 'en.story_comp_w3');
    const m = mount(battery(task, Object.assign({}, PROD, { r9_comp_text: true })), { lang: 'en', manual: true, asks: true });
    await toQuestion(m);
    const words = task.items[0].prompt.text;
    expect(q(m.el).textContent).toBe(words);
    expect(m.el.querySelector('details.sae-coach-says')).toBeNull();
    expect(m.said.some(([t]) => textOf(t) === words)).toBe(true);
  });

  // OFF: today's screen, byte for byte (absent, false, and every other switch ON)
  const OFF_CASES = [
    ['auto', {}],
    ['manual', { manual: true }],
    ['manual, app asks', { manual: true, asks: true }],
  ];
  test.each(OFF_CASES)('OFF (%s): the question screen is today\'s, byte for byte', async (_n, o) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const task = alone('sa.coach.G1.A.ur.json', 'ur.story_comp_w3');
    const html = [];
    const said = [];
    for (const ui of [PROD, Object.assign({}, PROD, { r9_comp_text: false })]) {
      document.getElementById('m').innerHTML = '';
      document.getElementById('m').className = '';
      const m = mount(battery(JSON.parse(JSON.stringify(task)), ui), Object.assign({ lang: 'ur' }, o));
      await toQuestion(m);
      html.push(m.el.outerHTML);
      said.push(JSON.stringify(m.said));
      expect(q(m.el)).toBeNull();
      expect(m.el.classList.contains('is-r9-comp')).toBe(false);
      // today: auto shows no words; manual shows the coach's copy (open, or folded when the app asks)
      const coachLine = m.el.querySelector('.sae-coach-line');
      if (!o.manual) expect(coachLine).toBeNull();
      else expect(coachLine.textContent).toBe(task.items[0].prompt.text);
      expect(!!m.el.querySelector('details.sae-coach-says')).toBe(!!o.asks);
      views.splice(0).forEach((v) => v.destroy());
    }
    expect(html[1]).toBe(html[0]);
    expect(said[1]).toBe(said[0]);
  });
});
