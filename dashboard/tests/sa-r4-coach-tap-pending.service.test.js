'use strict';
/**
 * Round 4 re-walk (sa_coach_last_word): while the recording hint is still on its way, the coach's taps were dropped and
 * the "Finding it in the recording…" note never showed. The tap must always work:
 *   - before the hint lands, the note shows and the coach's tap is the answer (how: 'tap');
 *   - a hint that lands after the tap never moves it;
 *   - a hint that lands after Confirm changes nothing.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const words = ['Ali', 'went', 'to', 'the', 'shop.', 'He', 'bought', 'milk.'].map((w, i) => ({ id: 'w' + (i + 1), target: w.replace(/\.$/, ''), line: 1 }));
const PASSAGE = { battery_id: 'b', tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
  passage: { text: 'Ali went to the shop. He bought milk.' }, items: words }] };

maybe('the coach taps while the hint is pending (sa-ui)', () => {
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
  /** A hint the test lands by hand: hint.land(i). */
  function lateHint() {
    let land;
    const p = new Promise((res) => { land = res; });
    return { fn: () => p, land: (i) => { land(i); return flush(); } };
  }
  function mount(hint) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const runner = core.createRunner({ battery: PASSAGE, now: () => t, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery: PASSAGE, lang: 'en', mode: 'proctored', speak: () => Promise.resolve(), coach_last_word: true, lastWordHint: hint });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); t += 20000; runner.done();
    return { runner, el, view };
  }
  const wordBtn = (el, i) => el.querySelector('.sae-word[data-i="' + i + '"]');
  const confirmBtn = (el) => el.querySelector('.sa-lw-confirm');
  const note = (el) => el.querySelector('.sa-lw-note').textContent;

  test('pending: the note says it is finding the word in the recording', async () => {
    const h = lateHint();
    const x = mount(h.fn);
    x.view.render(); await flush();
    expect(note(x.el)).toBe('Finding it in the recording…');
    expect(confirmBtn(x.el).disabled).toBe(true);
  });

  test('pending: the coach\'s tap marks the word and Confirm records it as the coach\'s', async () => {
    const h = lateHint();
    const x = mount(h.fn);
    x.view.render(); await flush();
    wordBtn(x.el, 4).click(); await flush();
    expect(wordBtn(x.el, 4).classList.contains('is-picked')).toBe(true);
    expect(note(x.el)).toBe('Finding it in the recording…');
    expect(confirmBtn(x.el).disabled).toBe(false);
    confirmBtn(x.el).click(); await flush();
    const res = x.runner.view().result;
    expect(res.last_word_index).toBe(4);
    expect(res.last_word_how).toBe('tap');
    expect(res.last_word_suggested).toBeNull();
  });

  test('a hint that lands after the tap does not move it', async () => {
    const h = lateHint();
    const x = mount(h.fn);
    x.view.render(); await flush();
    wordBtn(x.el, 2).click(); await flush();
    await h.land(6);
    expect(wordBtn(x.el, 2).classList.contains('is-picked')).toBe(true);
    expect(wordBtn(x.el, 6).classList.contains('is-picked')).toBe(false);
    confirmBtn(x.el).click(); await flush();
    const res = x.runner.view().result;
    expect(res.last_word_index).toBe(2);
    expect(res.last_word_how).toBe('tap');
    expect(res.last_word_suggested).toBe(6);
  });

  test('a hint that lands after Confirm changes nothing', async () => {
    const h = lateHint();
    const x = mount(h.fn);
    x.view.render(); await flush();
    wordBtn(x.el, 3).click(); await flush();
    confirmBtn(x.el).click(); await flush();
    await h.land(7);
    const res = x.runner.view().result;
    expect(res.last_word_index).toBe(3);
    expect(res.last_word_how).toBe('tap');
  });
});
