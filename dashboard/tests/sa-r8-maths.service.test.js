'use strict';
/**
 * Round 8, the maths screens (the reviewer's 28 Oct list), each behind its own switch (default OFF):
 *   r8_latin_digits     items 29 / 3 / 34: every number SHOWN is in 0-9 on the Urdu page too, in every task (titles,
 *                       instructions, practice feedback, the coach's lines, the demo card); a sum reads as a blank to
 *                       fill ("1 + 3 = ___"), never a bare "1 + 3" the child repeats. What Jugnu says is unchanged.
 *   r8_missing_number   item 30: the number row large, the choices beneath it smaller; a tapped choice floats into the
 *                       blank and stays there; a typed number (the keypad form) fills the blank itself.
 * Round 7's maths-only digits (sa-r7-maths-latin-digits) keep working with both switches OFF.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;
const URDU_DIGITS = /[۰-۹٠-٩]/;

maybe('round 8 maths screens (sa-ui)', () => {
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
  function mount(battery, uiOpts) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const events = [];
    const runner = c.createRunner({ battery, now: () => 0, mic: () => 'ok', manual: !!(uiOpts && uiOpts.manual), onEvent: (e) => events.push(e) });
    const said = [];
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'ur', mode: 'game', speak: (x) => { said.push(x && (x.text || x.ur || x.en)); return Promise.resolve(); } }, uiOpts || {}));
    views.push(view);
    return { runner, el, view, said, events };
  }
  const toRunning = (x) => { x.runner.start(); x.runner.instructionDone(); x.runner.begin(); x.view.render(); };
  const toPractice = (x) => { x.runner.start(); x.runner.instructionDone(); x.view.render(); expect(x.runner.view().phase).toBe('practice'); };
  const B = (ui, task) => Object.assign({ battery_id: 'b', tasks: [task] }, ui ? { ui } : {});
  const DIG = { r8_latin_digits: true };
  const MN = { r8_missing_number: true };

  // ---------- items 29 / 3: every number shown in 0-9 ----------
  // as the batteries carry it: read aloud one sum at a time (a record task), the sum said only on replay
  const MENTAL = (ui) => B(ui, { id: 'ma.add2i', subtask: 'mental_addition', response: 'record', present: 'one_at_a_time', say_on: 'replay', lang: null, title: { en: 'Adding 2', ur: 'جمع ۲' },
    script: { intro: { text: 'یہ ۲ جمع کے سوال ہیں۔' } },
    items: [{ id: 'ma.add2i.01', target: 19, say: '۱۳ جمع ۶', show: '13 + 6' }, { id: 'ma.add2i.02', target: 12, say: '۳ ضرب ۴', show: '3 × 4' }] });

  test('ON: a task\'s title and instruction show 2, not ۲ (a reading task\'s title too)', () => {
    const x = mount(MENTAL(DIG));
    x.runner.start(); x.view.render();
    expect(x.el.querySelector('.sae-h1').textContent).toBe('جمع 2');
    expect(x.el.querySelector('.sae-say').textContent).toContain('یہ 2 جمع');
    const r = mount(B(DIG, { id: 'ur.listening', subtask: 'listening_comprehension', response: 'tap', lang: 'ur', title: { ur: 'سن کر سمجھنا ۲' },
      script: {}, items: [{ id: 'l1', target: 'الف', options: ['الف', 'ب'] }] }));
    toRunning(r);
    expect(r.el.querySelector('.sae-task-tag').textContent).toBe('سن کر سمجھنا 2');
  });

  test('ON: a reading practice\'s feedback line is in 0-9 too; Jugnu still says it as written', async () => {
    const x = mount(B(DIG, { id: 'ur.vocabulary', subtask: 'vocabulary', response: 'tap', lang: 'ur', script: {},
      items: [{ id: 'v1', target: 'الف', options: ['الف', 'ب'] }],
      practice: [{ id: 'v.p1', target: 'الف', options: ['الف', 'ب'], feedback: { correct: { text: 'بالکل ٹھیک، ۸ بڑا ہے۔' } } }] }));
    toPractice(x);
    x.said.length = 0;
    x.el.querySelector('[data-value="الف"]').click();
    await flush(50);
    expect(x.el.querySelector('.sae-fb').textContent).toBe('بالکل ٹھیک، 8 بڑا ہے۔');
    expect(x.said[0]).toBe('بالکل ٹھیک، ۸ بڑا ہے۔');
  });

  test('ON: the demo card\'s question shows 25, not ۲۵', () => {
    const x = mount(B(DIG, { id: 'ma.number_repr', subtask: 'number_representation', response: 'keypad', lang: null,
      script: { intro: { text: 'سوال' }, demo_item: { say: '۲۵ میں کتنی دہائیاں ہیں؟' } }, items: [{ id: 'n1', target: '2', say: '۲۵ میں کتنی دہائیاں ہیں؟' }] }));
    x.runner.start(); x.view.render();
    expect(x.el.querySelector('.sae-demo').textContent).toContain('25 میں');
    expect(x.el.querySelector('.sae-demo').textContent).not.toMatch(URDU_DIGITS);
  });

  test('ON, RDF manual: the coach\'s whole brief has no Urdu digit', () => {
    const x = mount(MENTAL(DIG), { manual: true, mode: 'proctored' });
    x.runner.start(); x.view.render();
    for (let i = 0; i < 3 && !x.el.querySelector('.sae-coach-brief'); i += 1) { const b = x.el.querySelector('.sae-primary'); if (b) b.click(); }
    const brief = x.el.querySelector('.sae-coach-brief');
    expect(brief).not.toBeNull();
    expect(brief.textContent).toContain('13 جمع 6');
    expect(brief.textContent).not.toMatch(URDU_DIGITS);
  });

  // ---------- item 34: a sum reads as a blank to fill ----------
  test('ON: a spoken sum shows "13 + 6 = ___" (an = and a blank), left to right; Jugnu says it as before', async () => {
    const x = mount(MENTAL(DIG));
    toRunning(x);
    const lab = x.el.querySelector('.sae-run-cell .sae-onecell');
    expect(lab.textContent.replace(/\s+/g, ' ').trim()).toBe('13 + 6 = ___');
    expect(lab.getAttribute('dir')).toBe('ltr');
    expect(lab.querySelector('.sae-sum-blank')).not.toBeNull();
    x.said.length = 0;
    x.el.querySelector('.sae-replay').click();
    await flush();
    expect(x.said).toContain('۱۳ جمع ۶');
  });

  test('ON: a spoken practice sum shows "13 + 4 = ___"', () => {
    const b = MENTAL(DIG);
    b.tasks[0].practice = [{ id: 'ma.add2i.p1', show: '13 + 4', target: 17, answer: 17, role: 'practice', say: '۱۳ جمع ۴' }];
    const x = mount(b);
    toPractice(x);
    const cell = x.el.querySelector('.sae-onecell');
    expect(cell.textContent.replace(/\s+/g, ' ').trim()).toBe('13 + 4 = ___');
    expect(cell.getAttribute('dir')).toBe('ltr');
  });

  test('ON: a typed sum keeps one = before its box; a sum without one gains it', () => {
    for (const [shown, want] of [['1 + 3 =', '1 + 3 ='], ['19 − 6', '19 − 6 =']]) {
      const x = mount(B(DIG, { id: 'ma.add1', subtask: 'addition_level_1', response: 'keypad', lang: null, script: {}, items: [{ id: 'a1', target: 4, shown }] }));
      toRunning(x);
      expect(x.el.querySelector('.sae-sumrow .sae-sum').textContent).toBe(want);
      expect(x.el.querySelector('.sae-sumrow .sae-typed')).not.toBeNull();
      x.view.destroy();
    }
  });

  test('OFF: today\'s screens (the bare sum, the title\'s own digits, round 7 maths digits)', async () => {
    const x = mount(MENTAL(null));
    x.runner.start(); x.view.render();
    expect(x.el.querySelector('.sae-h1').textContent).toBe('جمع ۲');
    x.runner.instructionDone(); x.runner.begin(); x.view.render();
    const lab = x.el.querySelector('.sae-run-cell .sae-onecell');
    expect(lab.textContent).toBe('13 + 6');
    expect(lab.querySelector('.sae-sum-blank')).toBeNull();
    const k = mount(B(null, { id: 'ma.add1', subtask: 'addition_level_1', response: 'keypad', lang: null, script: {}, items: [{ id: 'a1', target: 4, shown: '19 − 6' }] }));
    toRunning(k);
    expect(k.el.querySelector('.sae-sumrow .sae-sum').textContent).toBe('19 − 6');
    expect(document.querySelector('.is-r8-digits')).toBeNull();
  });

  // ---------- item 30: the missing number ----------
  const MISS_TAP = (ui, withPractice) => B(ui, { id: 'ma.missing', subtask: 'missing_number', response: 'tap', lang: null, title: { ur: 'غائب نمبر' }, script: {},
    items: [{ id: 'm1', target: 8, options: [10, 8, 9, 7], shown: [5, 6, 7, null] }, { id: 'm2', target: 30, options: [40, 30, 50, 20], shown: [20, null, 40, 50] }],
    practice: !withPractice ? [] : [{ id: 'm.p1', target: 3, options: [5, 4, 3, 2], shown: [1, 2, null, 4], feedback: { correct: { text: 'بالکل ٹھیک، ۳۔' }, wrong: { text: 'یہاں ۳ آئے گا۔' } } }] });
  const MISS_KP = (ui) => B(ui, { id: 'ma.missing', subtask: 'missing_number', response: 'keypad', lang: null, script: {},
    items: [{ id: 'm1', target: 8, shown: [5, 6, 7, null] }, { id: 'm2', target: 30, shown: [20, null, 40, 50] }] });

  test('ON, choices: the row is large, the choices sit beneath it; a tap floats the number into the blank and it stays', async () => {
    const x = mount(MISS_TAP(MN));
    toRunning(x);
    const scr = x.el.querySelector('.sae-run-tap');
    expect(scr.classList.contains('sae-r8-mn')).toBe(true);
    const row = scr.querySelector('.sae-seq');
    expect(row.classList.contains('is-r8-mn')).toBe(true);
    // the row comes before the choices
    const opts = scr.querySelector('.sae-opts');
    expect(row.compareDocumentPosition(opts) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const gap = row.querySelector('.sae-gap');
    expect(gap.textContent).toBe('__');
    x.el.querySelector('[data-value="8"]').click();
    // the answer is given at once (as today); the blank shows the tapped number while the screen waits
    expect(x.events.filter((e) => e.type === 'tap').length).toBe(1);
    const filled = x.el.querySelector('.sae-seq .sae-gap');
    expect(filled.classList.contains('is-filled')).toBe(true);
    expect(filled.textContent).toBe('8');
    await flush(800);
    // the next item: an empty blank again
    expect(x.runner.view().item_index).toBe(1);
    expect(x.el.querySelector('.sae-seq .sae-gap').textContent).toBe('__');
  });

  test('ON, choices: the float animates by transform; reduced motion lands it at once', () => {
    for (const reduce of [false, true]) {
      dom.window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), media: q, addListener() {}, removeListener() {} });
      const x = mount(MISS_TAP(MN));
      toRunning(x);
      x.el.querySelector('[data-value="8"]').click();
      const ink = x.el.querySelector('.sae-seq .sae-gap .sae-mn-ink');
      expect(ink).not.toBeNull();
      if (reduce) expect(ink.style.transition || '').toBe('');
      else expect(ink.style.transition).toMatch(/transform/);
      x.view.destroy();
    }
  });

  test('ON, practice: the tapped number stays in the blank with the feedback; a retry\'s new tap replaces it', async () => {
    const x = mount(MISS_TAP(MN, true));
    toPractice(x);
    x.el.querySelector('[data-value="5"]').click();
    let gap = x.el.querySelector('.sae-seq .sae-gap');
    expect(gap.textContent).toBe('5');
    expect(gap.classList.contains('is-filled')).toBe(true);
    await flush(1500);
    if (x.runner.view().phase === 'practice') {
      gap = x.el.querySelector('.sae-seq .sae-gap');
      expect(gap.textContent).toBe('__');
      x.el.querySelector('[data-value="3"]').click();
      expect(x.el.querySelector('.sae-seq .sae-gap').textContent).toBe('3');
    }
  });

  test('ON, keypad form: the typed number fills the blank itself; the keypad stays below; ✓ answers as before', () => {
    const x = mount(MISS_KP(MN));
    toRunning(x);
    const area = x.el.querySelector('.sae-keyarea');
    expect(area.querySelector(':scope > .sae-typed')).toBeNull();
    const gap = area.querySelector('.sae-seq .sae-gap');
    expect(gap.textContent).toBe('__');
    expect(gap.compareDocumentPosition(area.querySelector('.sae-keypad')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    x.el.querySelector('[data-key="8"]').click();
    expect(area.querySelector('.sae-seq .sae-gap').textContent).toBe('8');
    expect(area.querySelector('.sae-seq .sae-gap').classList.contains('is-filled')).toBe(true);
    x.el.querySelector('[data-key="del"]').click();
    expect(area.querySelector('.sae-seq .sae-gap').textContent).toBe('__');
    x.el.querySelector('[data-key="8"]').click();
    x.el.querySelector('[data-key="ok"]').click();
    const ans = x.events.filter((e) => e.type === 'keypad_submit');
    expect(ans.length).toBe(1);
    expect(String(ans[0].value)).toBe('8');
  });

  test('OFF: the missing number is today\'s (small row, separate box, no float)', () => {
    const x = mount(MISS_TAP(null));
    toRunning(x);
    const row = x.el.querySelector('.sae-seq');
    expect(row.className).toBe('sae-label sa-label sae-seq');
    expect(x.el.querySelector('.sae-r8-mn')).toBeNull();
    x.el.querySelector('[data-value="8"]').click();
    expect(x.el.querySelector('.sae-seq .sae-gap').textContent).toBe('__');
    const k = mount(MISS_KP(null));
    toRunning(k);
    expect(k.el.querySelector('.sae-keyarea > .sae-typed')).not.toBeNull();
  });

  test('the events of a missing-number answer are the same ON and OFF', async () => {
    const strip = (es) => es.map((e) => ({ type: e.type, task_id: e.task_id, item_id: e.item_id, value: e.value, correct: e.correct }));
    const runs = [];
    for (const ui of [null, MN]) {
      const x = mount(MISS_TAP(ui));
      toRunning(x);
      x.el.querySelector('[data-value="8"]').click();
      await flush(800);
      x.el.querySelector('[data-value="30"]').click();
      await flush(800);
      runs.push(strip(x.events));
      x.view.destroy();
    }
    expect(runs[1]).toEqual(runs[0]);
  });
});
