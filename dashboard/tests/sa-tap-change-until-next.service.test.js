'use strict';
/**
 * Self-corrections on untimed tap questions (EGMA: the last answer the child settles on is the answer).
 * Switch sa_tap_change_until_next (default OFF, fail closed). ON, on a tap task WITHOUT time_limit_s (comparison,
 * missing number, initial sound, vocabulary, the print-orientation passage tap …):
 *   - a tap selects the tile (highlighted), nothing is scored, the item stays;
 *   - another tap changes the choice; the child can change it as often as they like;
 *   - Next scores the FINAL choice, and the answer records how many times it was changed (changed: n);
 * timed grids (letters, words, number ID) keep first-tap-counts. OFF: every tap answers at once, as before, and no
 * answer carries `changed`.
 */
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

// comparison (untimed): which is bigger? 7 vs 5, then 3 vs 9
const UNTIMED = { battery_id: 'b', tasks: [{ id: 'ma.discrimination', subtask: 'quantity_discrimination', mode: 'tap', lang: 'en',
  items: [{ id: 'd1', target: 7, options: [7, 5] }, { id: 'd2', target: 9, options: [3, 9] }] }] };
// a timed grid: letters, 60 s
const TIMED = { battery_id: 'b', tasks: [{ id: 'en.letters', subtask: 'letter_name_identification', mode: 'tap', lang: 'en', time_limit_s: 60,
  items: [{ id: 'l1', target: 'L', options: ['h', 'L', 'M'] }, { id: 'l2', target: 'o', options: ['o', 'N', 'r'] }] }] };
// the print-orientation tap on the passage's words (untimed)
const PASSAGE_TAP = { battery_id: 'b', tasks: [{ id: 'en.print_orientation', subtask: 'orientation_to_print', mode: 'tap', lang: 'en', tap_on: 'passage',
  passage: { text: 'Imran woke up early.', words: [{ target: 'Imran', line: 1 }, { target: 'woke', line: 1 }, { target: 'up', line: 1 }, { target: 'early', line: 1 }] },
  items: [{ id: 'p1', target: 'Imran', target_index: 0, options: ['Imran', 'woke', 'up', 'early'] }] }] };

maybe('sa_tap_change_until_next (sa-ui)', () => {
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
  const flush = (ms) => new Promise((res) => setTimeout(res, ms || 250));
  function mount(uiOpts, battery) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const runner = c.createRunner({ battery, now: () => t, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak: () => Promise.resolve() }, uiOpts));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); t += 1000;
    view.render();
    return { runner, el, view };
  }
  const tile = (el, v) => el.querySelector(`.sae-opt[data-value="${v}"]`);
  const next = (el) => el.querySelector('.sa-tap-next');
  const answers = (x) => { const v = x.runner.view(); return v.result ? v.result.answers : x.runner.snapshot().current.answers; };

  test('ON, untimed: a tap selects (highlighted) and scores nothing; the item stays', async () => {
    const x = mount({ tap_change_until_next: true }, UNTIMED);
    await flush();
    tile(x.el, 5).click(); await flush();
    expect(answers(x)).toEqual([]);
    expect(x.runner.view().item.id).toBe('d1');
    expect(tile(x.el, 5).classList.contains('is-picked')).toBe(true);
    expect(tile(x.el, 5).getAttribute('aria-pressed')).toBe('true');
    expect(tile(x.el, 7).classList.contains('is-picked')).toBe(false);
    expect(next(x.el)).not.toBeNull();
  });

  test('ON, untimed, wrong-then-right: 5, then 7, then Next → correct, changed 1', async () => {
    const x = mount({ tap_change_until_next: true }, UNTIMED);
    await flush();
    tile(x.el, 5).click(); await flush();
    tile(x.el, 7).click(); await flush();
    expect(tile(x.el, 7).classList.contains('is-picked')).toBe(true);
    expect(tile(x.el, 5).classList.contains('is-picked')).toBe(false);
    next(x.el).click(); await flush();
    expect(answers(x)).toEqual([expect.objectContaining({ item_id: 'd1', value: 7, ok: true, changed: 1 })]);
    expect(x.runner.view().item.id).toBe('d2');
  });

  test('ON, untimed, right-then-wrong: 9, then 3, then Next → wrong, changed 1', async () => {
    const x = mount({ tap_change_until_next: true }, UNTIMED);
    await flush();
    tile(x.el, 7).click(); await flush(); next(x.el).click(); await flush();
    tile(x.el, 9).click(); await flush();
    tile(x.el, 3).click(); await flush();
    next(x.el).click(); await flush();
    const a = answers(x);
    expect(a[0]).toMatchObject({ item_id: 'd1', value: 7, ok: true, changed: 0 });
    expect(a[1]).toMatchObject({ item_id: 'd2', value: 3, ok: false, changed: 1 });
  });

  test('ON, untimed: no Next until something is picked (the skip Next is not offered at once)', async () => {
    const x = mount({ tap_change_until_next: true }, UNTIMED);
    await flush();
    expect(next(x.el)).toBeNull();
  });

  test('ON, the passage tap (print orientation): the word is picked, Next scores the final word', async () => {
    const x = mount({ tap_change_until_next: true }, PASSAGE_TAP);
    await flush();
    const word = (i) => x.el.querySelector(`.sae-word[data-i="${i}"]`);
    word(2).click(); await flush();
    expect(answers(x)).toEqual([]);
    expect(word(2).classList.contains('is-picked')).toBe(true);
    word(0).click(); await flush();
    next(x.el).click(); await flush();
    expect(answers(x)).toEqual([expect.objectContaining({ item_id: 'p1', value: 0, ok: true, changed: 1 })]);
  });

  test('ON, a timed grid keeps first-tap-counts (no select, no Next, no changed)', async () => {
    const x = mount({ tap_change_until_next: true }, TIMED);
    await flush();
    tile(x.el, 'h').click(); await flush();
    expect(x.runner.view().item.id).toBe('l2'); // the first tap answered: the next letter is on show
    expect(next(x.el)).toBeNull();
    tile(x.el, 'o').click(); await flush();
    const a = x.runner.view().result.answers;
    expect(a.map((y) => [y.item_id, y.value, y.ok])).toEqual([['l1', 'h', false], ['l2', 'o', true]]);
    expect(a.some((y) => 'changed' in y)).toBe(false);
  });

  test('OFF: an untimed tap answers at once, as before, with no changed', async () => {
    const x = mount({}, UNTIMED);
    await flush();
    tile(x.el, 5).click(); await flush();
    const a = answers(x);
    expect(a).toEqual([{ item_id: 'd1', value: 5, ok: false }]);
    expect(x.runner.view().item.id).toBe('d2');
  });
});

describe('the switch reaches the battery as ui.tap_change_until_next, and the engine passes it to the page', () => {
  test('named sa_tap_change_until_next; ON adds ui.tap_change_until_next; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.tapChangeUntilNext).toBe('sa_tap_change_until_next');
    expect(applySwitches(b, { tapChangeUntilNext: true, rdfW3Forms: true }).ui).toEqual({ tap_change_until_next: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
    expect(JSON.stringify(applySwitches(b, { tapChangeUntilNext: 'yes', rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
  test('engine: battery.ui.tap_change_until_next → the page\'s tap_change_until_next; absent → false', async () => {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    for (const on of [true, false]) {
      const store = await storeMod.open({ idb: null });
      let got = null;
      await start({ mount: {}, battery: Object.assign(on ? { ui: { tap_change_until_next: true } } : {}, UNTIMED), mode: 'proctored', lang: 'en', session_id: `s-tap-${on}`, audio_check: false, warmup: false }, {
        core, store: { open: async () => store }, ui: { mount: (el, o) => { got = o; return {}; } },
        voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
      });
      expect(got.tap_change_until_next).toBe(on);
    }
  });
});

describe('the route reads the switch (fail closed)', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  async function serve(reader) {
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, tapChangeUntilNext: reader, env: {} }));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  test('ON: the served battery carries ui.tap_change_until_next; OFF, or a failed read: it does not', async () => {
    const cases = [[() => true, true], [() => false, false], [() => { throw new Error('db down'); }, false]];
    for (const [reader, want] of cases) {
      const x = await serve(reader);
      try {
        const b = await (await fetch(`${x.base}/sa/batteries/sa.coach.G3.A.en.json`)).json();
        expect(!!(b.ui && b.ui.tap_change_until_next)).toBe(want);
      } finally { x.srv.close(); }
    }
  });
});
