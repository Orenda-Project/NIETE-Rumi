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

  // ---------- item 11: a practice says its answer on arrival ----------
  describe('item 11, r8_practice_autoplay', () => {
    const M = (n) => [{ text: 'The sound is:', audio: 'sa/v1/en/is.mp3' }, { text: n, audio: 'sa/v1/en/' + n + '.mp3' }];
    const spoken = (ui, extra) => ({
      battery_id: 'b', ui,
      tasks: [Object.assign({ id: 'en.sounds5', mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
        practice: [{ id: 'p1', role: 'practice', model: M('mmm'), show: 'M', target: 'M' }, { id: 'p2', role: 'practice', model: M('sss'), show: 'S', target: 'S' }],
        items: [{ id: 'c1', target: 'x', show: 'x' }] }, extra || {})],
    });
    function toPractice(m) { m.runner.start(); m.runner.instructionDone(); m.view.render(); }
    const texts = (m) => m.said.map(textOf);

    test('OFF: arriving says no answer; Next says it, then the next practice (today)', async () => {
      const m = mount(spoken(undefined));
      toPractice(m);
      await wait(20);
      expect(texts(m)).not.toContain('mmm');
      btnText(m.el, /^Next$/).click();
      await wait(20);
      expect(texts(m)).toEqual(['The sound is:', 'mmm']);
      expect(m.runner.view().practice.id).toBe('p2');
      expect(texts(m)).not.toContain('sss');
    });
    test('ON: each practice says its answer on arrival; Next goes on without saying it again; the replay chip says it again', async () => {
      const m = mount(spoken({ r8_practice_autoplay: true }));
      toPractice(m);
      await wait(20);
      expect(texts(m)).toEqual(['The sound is:', 'mmm']);
      const chip = m.el.querySelector('.sae-practice .sae-replay');
      expect(chip).not.toBeNull();
      chip.click();
      await wait(20);
      expect(texts(m)).toEqual(['The sound is:', 'mmm', 'The sound is:', 'mmm']);
      btnText(m.el, /^Next$/).click();
      await wait(20);
      expect(m.runner.view().practice.id).toBe('p2');
      expect(texts(m).slice(4)).toEqual(['The sound is:', 'sss']);
      btnText(m.el, /^Next$/).click();
      await wait(20);
      expect(m.runner.view().phase).toBe('ready');
      expect(texts(m).filter((x) => x === 'sss').length).toBe(1);
    });
    test('ON, a sum read only on replay: the answer (not the sum) on arrival; the chip says the sum, then the answer', async () => {
      const b = spoken({ r8_practice_autoplay: true }, { id: 'ma.add2i', say_on: 'replay',
        practice: [{ id: 'p1', role: 'practice', say: '13 plus 4', prompt_audio: 'sa/v1/en/s.mp3', model: [{ text: 'The answer is:' }, { text: '17' }], show: '13 + 4', target: 17 }] });
      const m = mount(b);
      toPractice(m);
      await wait(20);
      expect(texts(m)).toEqual(['The answer is:', '17']);
      m.el.querySelector('.sae-practice .sae-replay').click();
      await wait(20);
      expect(texts(m).slice(2)).toEqual(['13 plus 4', 'The answer is:', '17']);
    });
    test('ON, with audio_gated_next: Next waits until the answer has been said', async () => {
      let end;
      const m = mount(spoken({ r8_practice_autoplay: true, audio_gated_next: true }), { ui: { speak: (t) => { m2.said.push(t); return new Promise((r) => { end = r; }); } } });
      const m2 = m;
      toPractice(m);
      await wait(20);
      expect(btnText(m.el, /^Next$/).disabled).toBe(true);
      end(); await wait(10); // "The sound is:"
      end(); await wait(10); // "mmm"
      expect(texts(m)).toEqual(['The sound is:', 'mmm']);
      expect(btnText(m.el, /^Next$/).disabled).toBe(false);
    });
    test('ON, coach-led (the coach models it): Jugnu stays quiet as before', async () => {
      const m = mount(spoken({ r8_practice_autoplay: true }), { mode: 'proctored', runner: { manual: true }, ui: { manual: true } });
      m.runner.start(); m.runner.instructionDone(); m.view.render();
      await wait(20);
      expect(texts(m)).not.toContain('mmm');
    });
  });
});
