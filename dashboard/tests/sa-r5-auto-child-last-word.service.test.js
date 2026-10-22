'use strict';
/**
 * Round 5: in RDF auto the CHILD taps the last word read, as before round 4; only RDF manual has the coach's screen.
 * Switch sa_auto_child_last_word (default OFF), with sa_coach_last_word ON, coach mode:
 *   - RDF auto: the child's screen ("Tap the last word you read"), Jugnu asks the child to tap, no coach wording, no
 *     word pre-selected, no hint asked; the tap ends it at once with no last_word_how (the scorer's contract: with
 *     sa_coach_last_word on, it then takes the words read from the recording, and the child's tap is the check);
 *   - RDF manual: the coach's screen stays (suggested from the recording, the tap confirms).
 * OFF: as round 4 (the coach's screen in both).
 */
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const words = ['Ali', 'went', 'to', 'the', 'shop.', 'He', 'bought', 'milk.'].map((w, i) => ({ id: 'w' + (i + 1), target: w.replace(/\.$/, ''), line: 1 }));
const PASSAGE = { battery_id: 'b', tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
  passage: { text: 'Ali went to the shop. He bought milk.' }, items: words }] };
const UR_PASSAGE = { battery_id: 'b', tasks: [{ id: 'ur.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'ur', time_limit_s: 60,
  passage: { text: 'علی دکان گیا۔ اس نے دودھ لیا۔' }, items: ['علی', 'دکان', 'گیا', 'اس', 'نے', 'دودھ', 'لیا'].map((w, i) => ({ id: 'u' + (i + 1), target: w, line: 1 })) }] };

maybe('RDF auto: the child taps the last word (sa-ui)', () => {
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
  function mount(uiOpts, battery) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const b = battery || PASSAGE;
    let t = 0;
    const runner = c.createRunner({ battery: b, now: () => t, mic: () => 'ok', manual: !!uiOpts.manual });
    const said = [];
    let asked = 0;
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: b, lang: b.tasks[0].lang, mode: 'proctored', coach_last_word: true,
      lastWordHint: () => { asked++; return Promise.resolve(6); }, speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); t += 20000; runner.done();
    return { runner, el, view, said, asked: () => asked };
  }
  const wordBtn = (el, i) => el.querySelector('.sae-word[data-i="' + i + '"]');
  const lines = (x) => x.said.map((s) => (s && (s.en || s.text)) || '');

  test('ON, auto: the child\'s screen, no coach wording, nothing pre-selected, no hint asked', async () => {
    const x = mount({ auto_child_last_word: true });
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword')).not.toBeNull();
    expect(x.el.querySelector('.sae-lastword.is-coach')).toBeNull();
    expect(x.el.querySelector('.sa-lw-confirm')).toBeNull();
    expect(x.el.querySelector('.sae-h1').textContent).not.toMatch(/coach/i);
    expect(x.el.querySelector('.sae-word.is-picked')).toBeNull();
    expect(x.asked()).toBe(0);
    expect(lines(x)).not.toContain('Give the phone back to the coach.');
  });
  test('ON, auto: Jugnu asks the child to tap the last word', async () => {
    const x = mount({ auto_child_last_word: true });
    x.view.render(); await flush();
    expect(lines(x).some((l) => /last word/i.test(l))).toBe(true);
  });
  test('ON, auto: the child\'s tap ends it at once, with no last_word_how (the scorer reads the recording)', async () => {
    const x = mount({ auto_child_last_word: true });
    x.view.render(); await flush();
    wordBtn(x.el, 3).click(); await flush();
    const res = x.runner.view().result;
    expect(res.last_word_index).toBe(3);
    expect(res.last_word_how).toBeUndefined();
    expect(res.last_word_suggested).toBeUndefined();
  });
  test('ON, auto, Urdu: the child\'s screen in Urdu, no coach wording', async () => {
    const x = mount({ auto_child_last_word: true }, UR_PASSAGE);
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword.is-coach')).toBeNull();
    expect(x.el.querySelector('.sae-h1').textContent).not.toMatch(/کوچ/);
    wordBtn(x.el, 2).click(); await flush();
    expect(x.runner.view().result.last_word_how).toBeUndefined();
  });
  test('ON, manual: the coach\'s screen stays (suggested, the tap confirms)', async () => {
    const x = mount({ auto_child_last_word: true, manual: true });
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword.is-coach')).not.toBeNull();
    expect(x.asked()).toBe(1);
    expect(wordBtn(x.el, 6).classList.contains('is-picked')).toBe(true);
    x.el.querySelector('.sa-lw-confirm').click(); await flush();
    expect(x.runner.view().result.last_word_how).toBe('confirm');
  });
  test('OFF: round 4 as it is (the coach\'s screen in auto)', async () => {
    const x = mount({});
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-lastword.is-coach')).not.toBeNull();
  });
});

describe('the switch reaches the battery as ui.auto_child_last_word, and the engine passes it to the page', () => {
  test('named sa_auto_child_last_word; ON adds ui.auto_child_last_word; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.autoChildLastWord).toBe('sa_auto_child_last_word');
    expect(applySwitches(b, { autoChildLastWord: true, rdfW3Forms: true }).ui).toEqual({ auto_child_last_word: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
  test('engine: battery.ui.auto_child_last_word → the page\'s auto_child_last_word', async () => {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    const store = await storeMod.open({ idb: null });
    let got = null;
    await start({ mount: {}, battery: Object.assign({ ui: { coach_last_word: true, auto_child_last_word: true } }, PASSAGE), mode: 'proctored', lang: 'en', session_id: 's-lw', audio_check: false, warmup: false }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { got = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
    });
    expect(got.auto_child_last_word).toBe(true);
  });
});

describe('the route reads the switch', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  async function serve(on) {
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, autoChildLastWord: () => on, env: {} }));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  test('ON: the served battery carries ui.auto_child_last_word; OFF: it does not', async () => {
    for (const on of [true, false]) {
      const x = await serve(on);
      try {
        const b = await (await fetch(`${x.base}/sa/batteries/sa.coach.G3.A.en.json`)).json();
        expect([on, !!(b.ui && b.ui.auto_child_last_word)]).toEqual([on, on]);
      } finally { x.srv.close(); }
    }
  });
});
