'use strict';
/**
 * The external tester's screen findings (dashboard/sa/sa-ui.js), on a real DOM and the forms as the server serves them:
 * - a number sequence shows its blank as a tile reading "__", wherever the gap is (tap and keypad);
 * - the keypad takes as many digits as the task's longest answer (a 4-digit answer fits);
 * - a part's closing line is said once and awaited, and a part skipped for want of a microphone says no "good effort",
 *   only its own line ("No microphone, so we skip this part", RULING #38b), once per part, 3 s each.
 * Runs where jsdom resolves (a portal dev dependency, not a dashboard one); skipped otherwise.
 */
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => require(path.join(FORMS, name));
const taskOf = (name, id) => JSON.parse(JSON.stringify(form(name).tasks.find((t) => t.id === id)));

maybe('sa-ui: the tester\'s screen findings', () => {
  let dom;
  const keep = {};
  const views = [];
  const keepView = (v) => { views.push(v); return v; };
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); jest.useRealTimers(); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const flush = () => new Promise((r) => setTimeout(r, 20));
  function mount(battery, extra) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const calls = [];
    const runner = core.createRunner(Object.assign({ battery, onEvent: (e) => calls.push(e) }, extra.runner));
    const el = document.getElementById('m');
    const view = keepView(ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve() }, extra.ui)));
    return { runner, el, view, calls };
  }
  /** Straight to the first scored item (the practice answered right). */
  function toRunning(runner) {
    runner.start(); runner.instructionDone();
    let guard = 10;
    while (runner.view().phase === 'practice' && guard--) runner.practiceAnswer(runner.view().practice.target);
    runner.begin();
  }
  const seqText = (el) => [...el.querySelectorAll('.sae-seq .sae-seq-tile')].map((x) => x.textContent);

  describe('A10: the blank in a number sequence', () => {
    test('tap (Grade 3 missing number, gap last: 5 6 7 __): a bordered gap tile reads "__"', async () => {
      const t = taskOf('sa.coach.G3.A.en.json', 'ma.missing');
      expect(t.items[0].shown).toEqual([5, 6, 7, null]);
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {} });
      toRunning(runner);
      view.render();
      await flush();
      expect(el.querySelector('.sae-gap')).not.toBeNull();
      expect(seqText(el)).toEqual(['5', '6', '7', '__']);
      expect(el.textContent).not.toContain('5,6,7,');
    });

    test('tap, gap in the middle (10 12 __ 16) and in a "what comes next" row', async () => {
      const mid = { id: 'seq', mode: 'tap', items: [{ id: 's1', target: 14, options: [14, 13, 15, 11], shown: [10, 12, null, 16] }] };
      const a = mount({ battery_id: 'b', tasks: [mid] }, { runner: {} });
      toRunning(a.runner); a.view.render(); await flush();
      expect(seqText(a.el)).toEqual(['10', '12', '__', '16']);
      a.view.destroy();
      const next = taskOf('sa.coach.G5.A.en.json', 'ma.ordering');
      next.items = next.items.filter((it) => Array.isArray(it.shown) && it.shown[it.shown.length - 1] === null).slice(0, 1);
      const b = mount({ battery_id: 'b', tasks: [next] }, { runner: {} });
      toRunning(b.runner); b.view.render(); await flush();
      expect(seqText(b.el).slice(-1)).toEqual(['__']);
    });

    test('keypad (Grade 5 missing number: 5 6 7 __ and __ 900 910 920): the gap tile, and the practice row too', async () => {
      const t = taskOf('sa.coach.G5.A.en.json', 'ma.missing');
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {} });
      runner.start(); runner.instructionDone();
      view.render(); await flush();
      expect(runner.view().phase).toBe('practice');
      expect(seqText(el)).toEqual(['1', '2', '__', '4']);
      while (runner.view().phase === 'practice') runner.practiceAnswer(runner.view().practice.target);
      runner.begin();
      view.render(); await flush();
      expect(el.getAttribute('data-phase')).toBe('running');
      expect(seqText(el)).toEqual(['5', '6', '7', '__']);
      expect(el.querySelector('.sae-sum')).toBeNull();
      for (let i = 0; i < 9; i++) runner.answer(String(runner.view().item.target));
      view.render(); await flush();
      expect(seqText(el)).toEqual(['__', '900', '910', '920']);
    });

    test('a sum keeps its one-line label (no tiles)', async () => {
      const add = taskOf('sa.coach.G5.A.en.json', 'ma.add1');
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [add] }, { runner: {} });
      toRunning(runner); view.render(); await flush();
      expect(el.querySelector('.sae-seq')).toBeNull();
      expect(el.querySelector('.sae-sum').textContent).toMatch(/\d+ \+ \d+ =/);
    });
  });

  describe('A12: a 4-digit answer fits the keypad', () => {
    test('Tens and hundreds, "1,000 + 300 + 80 + 3": 1383 can be typed and is scored right', async () => {
      const t = taskOf('sa.coach.G5.A.en.json', 'ma.number_repr');
      const at = t.items.findIndex((it) => it.target === '1383');
      expect(at).toBeGreaterThan(0);
      const { runner, el, view, calls } = mount({ battery_id: 'b', tasks: [t] }, { runner: {} });
      toRunning(runner);
      for (let i = 0; i < at; i++) runner.answer(String(runner.view().item.target));
      view.render(); await flush();
      expect(runner.view().item.target).toBe('1383');
      for (const k of ['1', '3', '8', '3']) el.querySelector(`[data-key="${k}"]`).click();
      expect(el.querySelector('.sae-typed').textContent).toBe('1383');
      el.querySelector('[data-key="ok"]').click();
      const sent = calls.filter((e) => e.type === 'keypad_submit' && e.item_id === t.items[at].id);
      expect(sent.map((e) => e.value)).toEqual(['1383']);
      expect(runner.view().item.id).toBe(t.items[at + 1].id);
    });

    test('a task whose answers are all short keeps the 3-digit cap', async () => {
      const t = { id: 'k', mode: 'keypad', items: [{ id: 'k1', target: '12' }, { id: 'k2', target: '7' }] };
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {} });
      toRunning(runner); view.render(); await flush();
      for (const k of ['1', '2', '3', '4']) el.querySelector(`[data-key="${k}"]`).click();
      expect(el.querySelector('.sae-typed').textContent).toBe('123');
    });
  });

  describe('A13: a picture pattern offers picture options', () => {
    test.each(['en', 'ur'])('page %s: 1a, 2a, 2b show 4 picture tiles captioned in the page language; 1b numerals only; a tap answers the word', async (lang) => {
      const t = taskOf(`sa.coach.G5.A.${lang}.json`, 'ma.patterns');
      const { runner, el, view, calls } = mount({ battery_id: 'b', tasks: [t] }, { runner: {}, ui: { lang } });
      toRunning(runner);
      const seen = {};
      for (let i = 0; i < t.items.length && runner.view().phase === 'running'; i++) {
        const it = runner.view().item;
        view.render(); await flush();
        const opts = [...el.querySelectorAll('.sae-opts .sae-opt')];
        seen[it.id] = opts.map((b) => {
          const g = b.querySelector('.sae-glyph');
          return g ? `${g.textContent}|${b.querySelector('.sae-cap').textContent}` : b.textContent;
        });
        if (it.glyphs && it.glyphs.some(Boolean)) {
          opts[it.options.indexOf(it.target)].click();
          expect(calls.filter((e) => e.type === 'tap').pop().value).toBe(it.target);
        } else runner.answer(it.target);
        await new Promise((r) => setTimeout(r, 220)); // the tap's press-and-release
      }
      const it1a = t.items.find((x) => x.id === 'ma.patterns.1a');
      expect(seen['ma.patterns.1a']).toEqual(it1a.glyphs.map((g, i) => `${g}|${it1a.options[i]}`));
      expect(seen['ma.patterns.2a'].every((x) => /^[★●▲■]\|/.test(x))).toBe(true);
      expect(seen['ma.patterns.2b']).toHaveLength(4);
      expect(seen['ma.patterns.2b'].every((x) => x.includes('|'))).toBe(true);
      expect(seen['ma.patterns.1b'].some((x) => x.includes('|'))).toBe(false);
    });
  });

  describe('A13: a picture sequence reads in the page\'s direction; numbers always left to right', () => {
    const rowOf = (el) => el.querySelector('.sae-seq');
    const withBlank = (t) => { t.items.forEach((it) => { if (Array.isArray(it.shown) && it.shown[it.shown.length - 1] !== null) it.shown.push(null); }); return t; };

    test('Urdu page: the picture row is right-to-left and its blank is the last tile; a numeral pattern stays left-to-right', async () => {
      const t = withBlank(taskOf('sa.coach.G5.A.ur.json', 'ma.patterns'));
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {}, ui: { lang: 'ur' } });
      toRunning(runner);
      view.render(); await flush();
      expect(runner.view().item.id).toBe('ma.patterns.1a');
      expect(rowOf(el).getAttribute('dir')).toBe('rtl');
      expect(rowOf(el).lastElementChild.classList.contains('sae-gap')).toBe(true);
      runner.answer(runner.view().item.target); view.render(); await flush();
      expect(runner.view().item.id).toBe('ma.patterns.1b');
      expect(rowOf(el).getAttribute('dir')).toBe('ltr');
    });

    test('a gap printed as "___" in the source (pattern 4a: 40 30 ___ 10 0) is the same blank tile, and the row stays left-to-right on the Urdu page', async () => {
      const t = taskOf('sa.coach.G5.A.ur.json', 'ma.patterns_hi');
      const at = t.items.findIndex((it) => it.id === 'ma.patterns.4a');
      // the bank now emits null here; a form built before that (or another source) may still carry the printed "___"
      t.items[at].shown = t.items[at].shown.map((x) => (x == null ? '___' : x));
      expect(t.items[at].shown).toEqual(['40', '30', '___', '10', '0']);
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {}, ui: { lang: 'ur' } });
      toRunning(runner);
      for (let i = 0; i < at; i++) runner.answer(String(runner.view().item.target));
      view.render(); await flush();
      expect(seqText(el)).toEqual(['40', '30', '__', '10', '0']);
      expect(el.querySelectorAll('.sae-seq .sae-gap')).toHaveLength(1);
      expect(rowOf(el).getAttribute('dir')).toBe('ltr');
    });

    test('English page: the picture row is left-to-right', async () => {
      const t = withBlank(taskOf('sa.coach.G5.A.en.json', 'ma.patterns'));
      const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {}, ui: { lang: 'en' } });
      toRunning(runner); view.render(); await flush();
      expect(rowOf(el).getAttribute('dir')).toBe('ltr');
    });

    test.each(['en', 'ur'])('page %s: a missing-number row is left-to-right (tap and keypad)', async (lang) => {
      for (const f of [`sa.coach.G3.A.${lang}.json`, `sa.coach.G5.A.${lang}.json`]) {
        const t = taskOf(f, 'ma.missing');
        const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { runner: {}, ui: { lang } });
        toRunning(runner); view.render(); await flush();
        expect(rowOf(el).getAttribute('dir')).toBe('ltr');
        view.destroy();
      }
    });
  });

  describe('A07: the closing line of a part', () => {
    const after = { text: 'Good effort! Let us go on to the next part.' };
    const rec = (id) => ({ id, mode: 'record', time_limit_s: 60, passage: { text: 'a b' }, items: [{ id: id + '.w', target: 'a', line: 1 }], script: { after } });
    const tap = { id: 'tap', mode: 'tap', items: [{ id: 't1', target: 'a', options: ['a', 'b'] }], script: { after } };

    test('no microphone: the record parts skipped one after another never say "good effort", only the skip line', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const said = [];
      const { runner, view } = mount({ battery_id: 'b', tasks: [rec('r1'), rec('r2'), rec('r3'), tap] }, {
        runner: { mic: () => 'no' },
        ui: { speak: (x) => { said.push(x && (x.text || x.en)); return Promise.resolve(); } },
      });
      runner.start();
      view.render();
      await jest.advanceTimersByTimeAsync(9500);
      expect(runner.view().task.id).toBe('tap');
      expect(said.filter((s) => s === after.text)).toEqual([]);
      expect(said.filter((s) => s === 'No microphone, so we skip this part')).toHaveLength(3);
    });

    test('a finished part: the line is said once and awaited to its end (7 s), then the next part', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const said = [];
      const { runner, view } = mount({ battery_id: 'b', tasks: [tap, Object.assign({}, tap, { id: 'tap2' })] }, {
        runner: {},
        ui: { speak: (x) => { said.push(x && (x.text || x.en)); return x && x.text === after.text ? new Promise((r) => setTimeout(r, 7000)) : Promise.resolve(); } },
      });
      toRunning(runner); runner.answer('a');
      view.render();
      expect(runner.view().phase).toBe('task_end');
      await jest.advanceTimersByTimeAsync(6500);
      expect(runner.view().phase).toBe('task_end');       // still speaking: not cut at 6 s
      await jest.advanceTimersByTimeAsync(700);
      expect(runner.view().task.id).toBe('tap2');
      expect(said.filter((s) => s === after.text)).toHaveLength(1);
    });

    test('a line that never ends is cut at 8 s, once', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const said = [];
      const { runner, view } = mount({ battery_id: 'b', tasks: [tap, Object.assign({}, tap, { id: 'tap2' })] }, {
        runner: {},
        ui: { speak: (x) => { said.push(x && (x.text || x.en)); return x && x.text === after.text ? new Promise(() => {}) : Promise.resolve(); } },
      });
      toRunning(runner); runner.answer('a');
      view.render();
      await jest.advanceTimersByTimeAsync(7900);
      expect(runner.view().phase).toBe('task_end');
      await jest.advanceTimersByTimeAsync(200);
      expect(runner.view().task.id).toBe('tap2');
      expect(said.filter((s) => s === after.text)).toHaveLength(1);
    });

    test('with the real voice: a clip that errors at 1 s gives one utterance of the line, not two', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      const voice = require('../sa/sa-voice');
      const heard = [];
      function Audio(src) { const a = this; a.src = src; a.pause = () => {}; a.play = () => { setTimeout(() => a.onerror && a.onerror(), 1000); return new Promise(() => {}); }; }
      const synth = { getVoices: () => [{ lang: 'en-IN' }, { lang: 'en-US' }], cancel: () => {}, speak: (u) => { heard.push(u.text); setTimeout(() => u.onend && u.onend(), 2500); } };
      function U(text) { this.text = text; }
      const v = voice.create({ lang: 'en', Audio, speechSynthesis: synth, SpeechSynthesisUtterance: U });
      const a2 = Object.assign({ audio: 'sa/v1/en/after.mp3' }, after);
      const t1 = Object.assign({}, tap, { script: { after: a2 } });
      const { runner, view } = mount({ battery_id: 'b', tasks: [t1, Object.assign({}, t1, { id: 'tap2' })] }, { runner: {}, ui: { speak: v.speak } });
      toRunning(runner); runner.answer('a');
      view.render();
      await jest.advanceTimersByTimeAsync(9000);
      // A line that has a clip is never said by the phone's voice (RULING #31c): the clip is retried, then silent.
      expect(heard).toEqual([]);
      expect(runner.view().task.id).toBe('tap2');
    });
  });
});
