'use strict';
/**
 * Round 8, the child's flow (dashboard/sa/sa-ui.js, sa-core.js), each behind its battery.ui switch, OFF = as before:
 *   r8_reading_no_done    item 14: entering a reading screen, Jugnu says nothing about "done"; the recorder still opens.
 *   r8_comp_wait_next     item 28: a story / listening question never moves on by itself; the child presses Next, and a
 *                         quiet line says a stuck child can press it (shown only: Jugnu's voice would land in the child's recorded answer).
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

  // ---------- item 28: story questions wait for Next ----------
  describe('item 28, r8_comp_wait_next', () => {
    const STUCK = { en: 'If you are stuck, press the button to go on.', ur: 'اگر آپ کو جواب نہ آئے تو آگے جانے کے لیے بٹن دبائیں۔' };
    const comp = (ui, lines, subtask) => ({
      battery_id: 'b', ui, lines: lines || {},
      tasks: [{ id: 'en.story_comp', subtask: subtask || 'reading_comprehension', mode: 'oral', question_timeout_s: 10,
        items: [{ id: 'q1', say: 'Who sat?' }, { id: 'q2', say: 'Where?' }] }],
    });
    function toQuestion(m) { m.runner.start(); m.runner.instructionDone(); m.runner.begin(); m.view.render(); }

    test('core, OFF: a question left 10 s moves on by itself (today)', () => {
      let t = 0;
      const core = require('../sa/sa-core');
      const runner = core.createRunner({ battery: comp(undefined), now: () => t, onEvent: () => {} });
      runner.start(); runner.instructionDone(); runner.begin(); runner.promptDone();
      t = 10500; runner.tick();
      expect(runner.view().item.id).toBe('q2');
    });
    test('core, ON: a story or listening question never moves on by itself, however long', () => {
      for (const sub of ['reading_comprehension', 'listening_comprehension']) {
        let t = 0;
        const core = require('../sa/sa-core');
        const runner = core.createRunner({ battery: comp({ r8_comp_wait_next: true }, null, sub), now: () => t, onEvent: () => {} });
        runner.start(); runner.instructionDone(); runner.begin(); runner.promptDone();
        t = 600000; runner.tick();
        expect(runner.view().phase).toBe('running');
        expect(runner.view().item.id).toBe('q1');
        runner.answer('spoken');
        expect(runner.view().item.id).toBe('q2');
      }
    });
    test('core, ON: a spoken sum (not a story question) keeps its own timeout', () => {
      let t = 0;
      const core = require('../sa/sa-core');
      const runner = core.createRunner({ battery: comp({ r8_comp_wait_next: true }, null, 'mental_addition'), now: () => t, onEvent: () => {} });
      runner.start(); runner.instructionDone(); runner.begin(); runner.promptDone();
      t = 10500; runner.tick();
      expect(runner.view().item.id).toBe('q2');
    });

    test('UI, OFF: the question screen is as today (Done, no stuck line) and moves on by itself', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const m = mount(comp(undefined));
      toQuestion(m);
      await jest.advanceTimersByTimeAsync(50);
      expect(m.el.querySelector('.sae-r8-stuck')).toBeNull();
      expect(btnText(m.el, /^Done$/)).toBeTruthy();
      await jest.advanceTimersByTimeAsync(10600);
      expect(m.runner.view().item.id).toBe('q2');
    });
    test('UI, ON (EN, no battery line): Next, the quiet stuck line, never moves on; Next moves on; no clip = not spoken', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const m = mount(comp({ r8_comp_wait_next: true }));
      toQuestion(m);
      await jest.advanceTimersByTimeAsync(50);
      const stuck = m.el.querySelector('.sae-r8-stuck');
      expect(stuck).not.toBeNull();
      expect(stuck.textContent).toBe(STUCK.en);
      // in the foot just above Next: always in view, never over the question
      expect(stuck.closest('.sae-foot')).not.toBeNull();
      expect(stuck.nextElementSibling.textContent).toBe('Next');
      const next = btnText(m.el, /^Next$/);
      expect(next).toBeTruthy();
      expect(next.disabled).toBe(false);
      await jest.advanceTimersByTimeAsync(30000);
      expect(m.runner.view().item.id).toBe('q1');
      expect(m.said.map(textOf)).not.toContain(STUCK.en);
      btnText(m.el, /^Next$/).click();
      await jest.advanceTimersByTimeAsync(300);
      expect(m.runner.view().item.id).toBe('q2');
    });
    test('UI, ON (UR, the battery line with its clip): shown, never spoken over the child\'s recorded answer', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const line = { text: 'اگر آپ اٹک جائیں تو بٹن دبائیں۔', audio: 'sa/v1/ur/stuck.mp3' };
      const m = mount(comp({ r8_comp_wait_next: true }, { stuck_press_next: line }), { lang: 'ur' });
      toQuestion(m);
      await jest.advanceTimersByTimeAsync(50);
      expect(m.el.querySelector('.sae-r8-stuck').textContent).toBe(line.text);
      expect(btnText(m.el, /^آگے$/)).toBeTruthy();
      await jest.advanceTimersByTimeAsync(30000);
      expect(m.said).not.toContainEqual(line);
    });
    test('UI, ON (UR, no battery line): the page\'s Urdu fallback, text only', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const m = mount(comp({ r8_comp_wait_next: true }), { lang: 'ur' });
      toQuestion(m);
      await jest.advanceTimersByTimeAsync(7000);
      expect(m.el.querySelector('.sae-r8-stuck').textContent).toBe(STUCK.ur);
      expect(m.said.map((x) => x.ur || textOf(x))).not.toContain(STUCK.ur);
    });
  });

});
