'use strict';
/**
 * Round 28 C (sa_r28_ceiling; the engine reads it as opts.ceiling, from battery.ui.r28_ceiling): a timed
 * one-at-a-time task runs every cell of its grid until the clock ends. A final cell on show for under 500 ms at time
 * up is presented (it stays in result.cells with its ms, so graders see it) but not attempted: last_item_index (and
 * so last_word_index) points to the cell before it. Without the option the engine is as it was. Synthetic items only.
 */
const core = require('../sa/sa-core');

const pad = (n) => String(n).padStart(2, '0');
/** words4 as built with C: 4 base items then extension items (ext: true); the grid is every item's show. */
const WORDS = Array.from({ length: 12 }, (_, k) => `word${k + 1}`);
const task = () => ({
  id: 'en.words4', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3,
  base_n: 4, grid: WORDS.slice(),
  items: WORDS.map((w, k) => ({ id: `en.words4.${pad(k + 1)}`, show: w, target: w, answer: w, src: `fixture:words[${k}]`, ...(k >= 4 ? { ext: true } : {}) })),
});

describe('the extension runs past the base items', () => {
  test('a child who taps through the 4 base cells sees cell 5 (an ext item) and ends on time up', () => {
    let t = 0;
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [task()] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true, ceiling: true });
    r.start(); r.instructionDone(); r.begin();
    for (let k = 0; k < 4; k += 1) { t += 1000; r.nextCell('tap'); }
    expect(r.view().phase).toBe('running');
    t = 61000; r.tick();
    const res = r.view().result;
    expect(res.stop_reason).toBe('time_up');
    expect(res.cells.length).toBeGreaterThan(4);
    expect(res.cells[4].item_id).toBe('en.words4.05');
  });
});

describe('the 500 ms final cell (C-7, red team C9)', () => {
  // two cells tapped through, the third comes up `lastMs` before the clock ends
  function shortLast(lastMs, ceiling) {
    let t = 0;
    const opts = { battery: { battery_id: 'b', tasks: [task()] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true };
    if (ceiling !== undefined) opts.ceiling = ceiling;
    const r = core.createRunner(opts);
    r.start(); r.instructionDone(); r.begin();
    t = 50000; r.nextCell('tap'); // cell 1 closes, cell 2 up
    t = 60000 - lastMs; r.nextCell('tap'); // cell 2 closes, cell 3 up lastMs before time up
    t = 60000; r.tick();
    return r.view().result;
  }
  test('ON, 300 ms on show at time up: in cells with its ms, not in last_item_index / last_word_index', () => {
    const res = shortLast(300, true);
    expect(res.stop_reason).toBe('time_up');
    expect(res.cells.map((c) => [c.item_id, c.how])).toEqual([['en.words4.01', 'tap'], ['en.words4.02', 'tap'], ['en.words4.03', 'time_up']]);
    expect(res.cells[2].ms).toBe(300);
    expect(res.last_item_index).toBe(1);
    expect(res.last_word_index).toBe(1);
  });
  test('ON, 800 ms on show: attempted as today', () => {
    const res = shortLast(800, true);
    expect(res.cells[2].ms).toBe(800);
    expect(res.last_item_index).toBe(2);
  });
  test('ON, the first cell closed by the clock under 500 ms: last_item_index null, the cell still in cells', () => {
    let t = 0;
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [{ ...task(), time_limit_s: 0.3 }] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true, ceiling: true });
    r.start(); r.instructionDone(); r.begin();
    t = 300; r.tick();
    const res = r.view().result;
    expect(res.stop_reason).toBe('time_up');
    expect(res.cells.map((c) => [c.item_id, c.ms, c.how])).toEqual([['en.words4.01', 300, 'time_up']]);
    expect(res.last_item_index).toBeNull();
  });
  test('OFF (option absent or false): byte-identical, the 300 ms cell counts as today', () => {
    for (const c of [undefined, false]) {
      const res = shortLast(300, c);
      expect(res.last_item_index).toBe(2);
      expect(res.last_word_index).toBe(2);
      expect(res.cells).toHaveLength(3);
    }
  });
  test('a cell closed by the clock at under 500 ms on a task that ends complete is not touched', () => {
    let t = 0;
    const small = { ...task(), items: task().items.slice(0, 2), grid: WORDS.slice(0, 2) };
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [small] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true, ceiling: true });
    r.start(); r.instructionDone(); r.begin();
    t = 1000; r.nextCell('tap');
    t = 1200; r.nextCell('tap');
    const res = r.view().result;
    expect(res.stop_reason).toBe('complete');
    expect(res.last_item_index).toBe(1);
  });
});

// C.3: the clock is the only progress on a cell past today's items: no "6 of 12" (or «۱۲ میں سے ۶») anywhere.
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  try { ({ JSDOM } = require('../../portal/node_modules/jsdom')); } catch (__) { /* not installed here */ } // eslint-disable-line global-require
}
const maybe = JSDOM ? describe : describe.skip;
maybe('the cell screen past the base items (jsdom)', () => {
  let dom;
  const keep = {};
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  test.each([['ur', false], ['ur', true], ['en', false], ['en', true]])('%s (coach-led %s): cell 6 on show, the screen names no count', async (lang, manual) => {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const battery = { battery_id: 'b', tasks: [{ ...task(), lang }] };
    const runner = c.createRunner({ battery, now: () => t, mic: () => 'ok', one_at_a_time: true, manual, ceiling: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'proctored', manual, speak: () => Promise.resolve(), r28: { ceiling: true } });
    runner.start(); runner.instructionDone(); runner.begin();
    for (let k = 0; k < 5; k += 1) { t += 1000; runner.nextCell('tap'); }
    view.render();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.view().cell_index).toBe(5);
    const text = el.textContent;
    expect(text).toContain('word6');
    expect(text).not.toMatch(/\d+\s*of\s*\d+/i);
    expect(text).not.toMatch(/میں سے/);
    expect(text).not.toMatch(/[0-9۰-۹]+\s*\/\s*[0-9۰-۹]+/);
    view.destroy();
  });
});
