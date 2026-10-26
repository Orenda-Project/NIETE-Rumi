'use strict';
/**
 * Round 7: RDF auto has no "tap the last word you read" step (the pilot's tester: it confuses the children). Switch
 * sa_auto_no_last_word (default OFF), coach mode:
 *   - RDF auto: "I'm done" (or time up) ends the passage at once, no last-word screen and no line asking for it; the
 *     result says last_word_skipped, with no last word, so the scorer takes the words read from the recording;
 *   - the passage's questions are all asked (there is no tapped line to gate them on), unless the passage stopped
 *     on its first line;
 *   - RDF manual keeps the coach's last-word screen.
 * OFF: unchanged.
 */
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const words = ['Ali', 'went', 'to', 'the', 'shop.', 'He', 'bought', 'milk.'].map((w, i) => ({ id: 'w' + (i + 1), target: w.replace(/\.$/, ''), line: 1 }));
const STORY = { id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
  passage: { text: 'Ali went to the shop. He bought milk.' }, items: words };
const PASSAGE = { battery_id: 'b', tasks: [STORY] };
const QUESTIONS = [1, 2, 3].map((n) => ({ id: 'q' + n, needs_line: n, prompt: { en: 'Question ' + n }, accept: ['x'] }));
const WITH_COMP = { battery_id: 'b', tasks: [STORY,
  { id: 'en.story_comp_w3', subtask: 'reading_comprehension', response: 'oral', lang: 'en', items: QUESTIONS,
    depends_on: { task: 'en.story_w3', upto_item: true } }] };

describe('the runner (sa-core): skip_last_word', () => {
  const core = require('../sa/sa-core');
  function run(battery, runnerOpts) {
    let t = 0;
    const r = core.createRunner(Object.assign({ battery, now: () => t, mic: () => 'ok' }, runnerOpts));
    r.start(); r.instructionDone(); r.begin();
    return { r, tick: (ms) => { t += ms; return r.tick(); } };
  }
  test('ON: "I\'m done" ends the passage at once (no last_word phase), last_word_skipped, no last word', () => {
    const x = run(PASSAGE, { skip_last_word: true });
    x.tick(20000); x.r.done();
    const v = x.r.view();
    expect(v.phase).toBe('task_end');
    expect(v.result.stop_reason).toBe('complete');
    expect(v.result.last_word_skipped).toBe(true);
    expect(v.result.last_word_index).toBeNull();
    expect(v.result.last_word_how).toBeUndefined();
  });
  test('ON: time up ends it as time_up, last_word_skipped', () => {
    const x = run(PASSAGE, { skip_last_word: true });
    x.tick(61000);
    const v = x.r.view();
    expect(v.phase).toBe('task_end');
    expect(v.result.stop_reason).toBe('time_up');
    expect(v.result.last_word_skipped).toBe(true);
  });
  test('OFF, no tap: the questions are skipped as before (no line read)', () => {
    const x = run(WITH_COMP, {});
    x.tick(20000); x.r.done(); x.r.lastWord(null); x.r.next();
    expect(x.r.view().phase).toBe('task_end');
    expect(x.r.view().result.stop_reason).toBe('skipped_no_first_line');
  });
  test('OFF: the last_word phase as before, no last_word_skipped', () => {
    const x = run(PASSAGE, {});
    x.tick(20000); x.r.done();
    expect(x.r.view().phase).toBe('last_word');
    x.r.lastWord(3);
    expect(x.r.view().result.last_word_skipped).toBeUndefined();
  });
  test('ON, manual (RDF manual): the last_word phase stays', () => {
    const x = run(PASSAGE, { skip_last_word: true, manual: true });
    x.tick(20000); x.r.done();
    expect(x.r.view().phase).toBe('last_word');
  });
  for (const compAll of [false, true]) {
    test(`ON: the passage's questions are all asked (comp_all_questions ${compAll})`, () => {
      const x = run(WITH_COMP, { skip_last_word: true, comp_all_questions: compAll });
      x.tick(20000); x.r.done(); x.r.next();
      const v = x.r.view();
      expect(v.task && v.task.id).toBe('en.story_comp_w3');
      expect(v.phase).not.toBe('task_end');
      x.r.instructionDone(); x.r.begin();
      expect(x.r.view().items_n).toBe(3);
    });
  }
});

maybe('RDF auto: no last-word screen (sa-ui)', () => {
  let dom; const keep = {}; const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms) => new Promise((res) => setTimeout(res, ms || 20));
  function mount(uiOpts) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const manual = !!uiOpts.manual;
    const runner = c.createRunner({ battery: PASSAGE, now: () => t, mic: () => 'ok', manual, skip_last_word: !!uiOpts.auto_no_last_word && !manual });
    const said = [];
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: PASSAGE, lang: 'en', mode: 'proctored', coach_last_word: true, auto_child_last_word: true,
      lastWordHint: () => Promise.resolve(6), speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); t += 20000; runner.done();
    return { runner, el, view, said };
  }
  const lines = (x) => x.said.map((s) => (s && (s.en || s.text)) || '');
  test('ON, auto: no last-word screen, no line asking for the last word', async () => {
    const x = mount({ auto_no_last_word: true });
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword')).toBeNull();
    expect(lines(x).some((l) => /last word/i.test(l))).toBe(false);
  });
  test('ON, manual: the coach\'s last-word screen stays', async () => {
    const x = mount({ auto_no_last_word: true, manual: true });
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword.is-coach')).not.toBeNull();
  });
});

describe('the switch reaches the battery as ui.auto_no_last_word, and the engine passes it to the runner (auto only)', () => {
  test('named sa_auto_no_last_word; ON adds ui.auto_no_last_word; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.autoNoLastWord).toBe('sa_auto_no_last_word');
    expect(applySwitches(b, { autoNoLastWord: true, rdfW3Forms: true }).ui).toEqual({ auto_no_last_word: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
  async function started(manual) {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    const store = await storeMod.open({ idb: null });
    let runnerOpts = null;
    const wrapped = Object.assign({}, core, { createRunner: (o) => { runnerOpts = o; return core.createRunner(o); } });
    await start({ mount: {}, battery: Object.assign({ ui: { auto_no_last_word: true } }, PASSAGE), mode: 'proctored', lang: 'en', manual,
      session_id: 's-nlw-' + manual, audio_check: false, warmup: false }, {
      core: wrapped, store: { open: async () => store }, ui: { mount: () => ({}) },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
    });
    return runnerOpts;
  }
  test('engine, RDF auto: the runner skips the last word', async () => {
    expect((await started(false)).skip_last_word).toBe(true);
  });
  test('engine, RDF manual: the runner keeps it', async () => {
    expect((await started(true)).skip_last_word).toBe(false);
  });
});

describe('the route reads the switch', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  async function serve(on) {
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, autoNoLastWord: () => on, env: {} }));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  test('ON: the served battery carries ui.auto_no_last_word; OFF: it does not', async () => {
    for (const on of [true, false]) {
      const x = await serve(on);
      try {
        const b = await (await fetch(`${x.base}/sa/batteries/sa.coach.G3.A.en.json`)).json();
        expect([on, !!(b.ui && b.ui.auto_no_last_word)]).toEqual([on, on]);
      } finally { x.srv.close(); }
    }
  });
});
