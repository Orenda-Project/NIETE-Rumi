'use strict';
/**
 * Round 7 (the pilot's tester: "the practice should emulate the actual way the students will fill it out"):
 *   - a tap practice screen carries the same question tag as the real items ("Which is bigger"), next to "Practice";
 *   - a mental sum's chip says "Say the answer" (RULING W3-12 4c), not "Read aloud": the runtime task kept no chip, so
 *     the screen fell back to "Read aloud" and the child was told to read the sum out instead of answering it.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

describe('the runner keeps a task\'s chip', () => {
  test('taskOf keeps chip ("Say the answer" on a mental sum)', () => {
    const core = require('../sa/sa-core');
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [{ id: 'ma.add2i', response: 'record', present: 'one_at_a_time', lang: null, chip: 'جواب بتائیں',
      items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19 }], practice: [] }] }, mic: () => 'ok' });
    r.start();
    expect(r.view().task.chip).toBe('جواب بتائیں');
  });
});

maybe('practice looks like the real items (sa-ui)', () => {
  let dom; let views = []; const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  function mount(battery) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const runner = core.createRunner({ battery, now: () => t, mic: () => 'ok', onEvent: () => {} });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'proctored', speak: () => Promise.resolve() });
    views.push(view);
    return { runner, el, view };
  }
  test('a tap practice screen shows the task\'s question tag, as its real items do', async () => {
    const battery = { battery_id: 'b', tasks: [{ id: 'ma.discrimination2', response: 'tap', lang: null, title: { en: 'Which is bigger', ur: 'کون سا بڑا ہے' }, script: {},
      items: [{ id: 'ma.discrimination2.01', target: 24, options: [11, 24] }], practice: [{ id: 'ma.discrimination2.p1', target: 8, options: [8, 4] }] }] };
    const { runner, el, view } = mount(battery);
    runner.start(); runner.instructionDone();
    view.render(); await flush();
    expect(runner.view().phase).toBe('practice');
    const tag = el.querySelector('.sae-task-tag');
    expect(tag && tag.textContent).toBe('کون سا بڑا ہے');
    expect(el.querySelector('.sae-chip').textContent).toBeTruthy();
  });
  test('a mental sum\'s item screen says "Say the answer", not "Read aloud"', async () => {
    const battery = { battery_id: 'b', ui: { one_at_a_time: true }, tasks: [{ id: 'ma.add2i', response: 'record', present: 'one_at_a_time', lang: null, chip: 'جواب بتائیں',
      title: { en: 'Addition', ur: 'جمع' }, script: {}, advance_after_s: null, next_at_s: 15,
      items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19 }, { id: 'ma.add2i.02', show: '12 + 5', target: 17 }], practice: [] }] };
    const { runner, el, view } = mount(battery);
    runner.start(); runner.instructionDone(); runner.begin();
    view.render(); await flush();
    const chip = el.querySelector('.sae-chip-rec');
    expect(chip && chip.textContent).toBe('جواب بتائیں');
  });
});
