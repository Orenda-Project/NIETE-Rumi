'use strict';
/**
 * Round 8, the child's flow (dashboard/sa/sa-ui.js, sa-core.js), each behind its battery.ui switch, OFF = as before:
 *   r8_reading_no_done    item 14: entering a reading screen, Jugnu says nothing about "done"; the recorder still opens.
 *   r8_comp_wait_next     item 28: a story / listening question never moves on by itself; the child presses Next, and a
 *                         quiet line says a stuck child can press it (spoken once after ~6 s when its clip is there).
 *   r8_practice_autoplay  item 11: a spoken practice says its answer on arrival, no button press; Next goes on.
 * Mounts the real UI on a jsdom page with a real runner and records what Jugnu says.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const DONE = { text: 'Done', audio: 'sa/v1/en/done.mp3' };
const DONE_UR = { text: 'ہو گیا', audio: 'sa/v1/ur/done.mp3' };

maybe('sa-ui round 8: the child\'s flow', () => {
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

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text != null ? x.text : (x.en || x.ur || ''));
  function mount(battery, o) {
    o = o || {};
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const recs = [];
    const runner = core.createRunner(Object.assign({ battery, onEvent: () => {}, mic: () => 'ok' }, o.runner || {}));
    const el = document.getElementById('m');
    const opts = Object.assign({
      runner, battery, lang: o.lang || 'en', mode: o.mode || 'game',
      speak: (t, a) => { said.push(t || a); return Promise.resolve(); },
      onRecordStart: (t, item) => recs.push({ t: t.id, item: item ? item.id : null, at: said.length }),
    }, o.ui || {});
    const view = ui.mount(el, opts);
    views.push(view);
    return { runner, el, view, said, recs };
  }
  const btnText = (el, rx) => [...el.querySelectorAll('button')].find((b) => rx.test(b.textContent));

  // ---------- item 14: the reading screen says nothing about "done" ----------
  describe('item 14, r8_reading_no_done', () => {
    const passage = (ui, lines) => ({
      battery_id: 'b', ui, lines: lines === undefined ? { done: DONE } : lines,
      tasks: [{ id: 'en.story', subtask: 'oral_reading_fluency', mode: 'record', time_limit_s: 60, passage: { text: 'a cat sat' },
        items: [{ id: 'w1', target: 'a' }, { id: 'w2', target: 'cat' }, { id: 'w3', target: 'sat' }] }],
    });
    function toReading(m) { m.runner.start(); m.runner.instructionDone(); m.runner.begin(); m.view.render(); }

    test('OFF: entering the passage, Jugnu says the Done line, then the recorder opens (today)', async () => {
      const m = mount(passage(undefined));
      toReading(m);
      await wait(20);
      expect(m.said.map(textOf)).toContain('Done');
      expect(m.recs).toEqual([{ t: 'en.story', item: null, at: 1 }]);
    });
    test('ON: nothing about "done" is said on entry; the recorder still opens after a short gap; the star keeps its label', async () => {
      const m = mount(passage({ r8_reading_no_done: true }));
      toReading(m);
      await wait(20);
      expect(m.said.map(textOf)).not.toContain('Done');
      expect(m.recs).toEqual([]); // the gap: not at once
      await wait(900);
      expect(m.said).toEqual([]);
      expect(m.recs).toEqual([{ t: 'en.story', item: null, at: 0 }]);
      const star = m.el.querySelector('.sae-star');
      expect(star.getAttribute('aria-label')).toBe('Done');
      expect(star.textContent).toContain('Done');
    });
    test('UR, no battery line: OFF says the page\'s «ہو گیا»; ON says nothing; the star still reads «ہو گیا»', async () => {
      const off = mount(passage(undefined, {}), { lang: 'ur' });
      toReading(off);
      await wait(20);
      expect(off.said.map((x) => x.ur || textOf(x))).toContain('ہو گیا');
      off.view.destroy();
      const on = mount(passage({ r8_reading_no_done: true }, { done: DONE_UR }), { lang: 'ur' });
      toReading(on);
      await wait(900);
      expect(on.said).toEqual([]);
      expect(on.recs.length).toBe(1);
      expect(on.el.querySelector('.sae-star').textContent).toContain('ہو گیا');
    });
    test('coach-led with Jugnu asking (app_asks): OFF says the Done line, ON does not', async () => {
      const off = mount(passage(undefined), { mode: 'proctored', runner: { manual: true }, ui: { manual: true, app_asks: true } });
      toReading(off);
      await wait(20);
      expect(off.said.map(textOf)).toContain('Done');
      off.view.destroy();
      const on = mount(passage({ r8_reading_no_done: true }), { mode: 'proctored', runner: { manual: true }, ui: { manual: true, app_asks: true } });
      toReading(on);
      await wait(900);
      expect(on.said.map(textOf)).not.toContain('Done');
      expect(on.recs.length).toBe(1);
    });
    test('one cell at a time: no "done" either way (no star line on that path)', async () => {
      const cells = (ui) => ({ battery_id: 'b', ui, lines: { done: DONE }, tasks: [{ id: 'en.w', mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60, items: [{ id: 'c1', target: 'x', show: 'x' }] }] });
      for (const ui of [undefined, { r8_reading_no_done: true }]) {
        const m = mount(cells(ui));
        toReading(m);
        await wait(20);
        expect(m.said.map(textOf)).not.toContain('Done');
        expect(m.recs.length).toBe(1);
        m.view.destroy();
      }
    });
  });

});
