'use strict';
/**
 * Round 8 item 30 (battery.ui.r8_missing_number), the fit: on a 360x640 phone the number row and every choice must sit
 * above the foot (Back / Next), with the coach's and the sandbox's extra rows on top. The screen measures itself after
 * it is drawn and, while a choice is still under the foot, tightens step by step: Jugnu's picture goes, then the row's
 * type shrinks, then the choices (never below 56 px). Layout is faked here (jsdom has none): each box's place follows
 * the classes and sizes the screen has set, as a browser's would.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('round 8 item 30: the missing number fits above the foot (sa-ui)', () => {
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

  /** A fake layout: the foot's top at FOOT; the choices end at `base` less what each tightening step saved. */
  function fakeLayout(base) {
    const FOOT = 560;
    Object.defineProperty(dom.window, 'innerHeight', { value: 640, configurable: true }); // a 360x640 phone
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const scr = this.closest && this.closest('.sae-screen');
      const box = (top, h) => ({ top, bottom: top + h, left: 0, right: 360, width: 360, height: h, x: 0, y: top });
      if (this.classList.contains('sae-foot')) return box(FOOT, 80);
      if (this.classList.contains('sae-opts') || this.classList.contains('sae-keypad')) {
        let end = base;
        if (scr && scr.classList.contains('is-mn-tight')) end -= 90; // Jugnu's picture gone
        const row = scr && scr.querySelector('.sae-seq.is-r8-mn');
        const fs = row && parseFloat(row.style.getPropertyValue('--mn-fs') || '0');
        if (fs) end -= Math.max(0, 40 - fs) * 3; // a smaller row
        const oh = scr && parseFloat(scr.style.getPropertyValue('--mn-opt-h') || '0');
        if (oh) end -= (64 - oh) * 2; // two rows of choices
        return box(end - 200, 200);
      }
      return box(0, 0);
    };
  }
  function mount(battery) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = c.createRunner({ battery, now: () => 0, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'game', speak: () => Promise.resolve() });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    return { runner, el, view };
  }
  const TASK = { id: 'ma.missing', subtask: 'missing_number', response: 'tap', lang: null, title: { ur: 'گمشدہ نمبر' }, script: {},
    items: [{ id: 'm2', target: 30, options: [40, 30, 50, 20], shown: [20, null, 40, 50] }, { id: 'm3', target: 200, options: [100, 200, 300, 400], shown: [null, 300, 400, 500] }] };
  // back_button on: the second item has Back in its foot, as on the sandbox phone
  const B = (ui) => Object.assign({ battery_id: 'b', tasks: [TASK] }, ui ? { ui: Object.assign({ back_button: true }, ui) } : {});
  const bottomOf = (el) => el.querySelector('.sae-opts').getBoundingClientRect().bottom;
  // the first item has no foot (no Back yet): the screen's bottom is the limit
  const footTop = (el) => { const f = el.querySelector('.sae-foot'); return f ? f.getBoundingClientRect().top : window.innerHeight; };

  test('ON, the choices under the foot: the screen tightens until every choice ends above the foot', () => {
    fakeLayout(700);
    const x = mount(B({ r8_missing_number: true }));
    const scr = x.el.querySelector('.sae-screen');
    expect(scr.classList.contains('is-mn-tight')).toBe(true);
    expect(bottomOf(x.el)).toBeLessThanOrEqual(footTop(x.el));
    const oh = parseFloat(scr.style.getPropertyValue('--mn-opt-h') || '64');
    expect(oh).toBeGreaterThanOrEqual(56);
  });

  test('ON, already fitting: nothing is changed', () => {
    fakeLayout(500);
    const x = mount(B({ r8_missing_number: true }));
    const scr = x.el.querySelector('.sae-screen');
    expect(scr.classList.contains('is-mn-tight')).toBe(false);
    expect(scr.style.getPropertyValue('--mn-opt-h')).toBe('');
  });

  test('ON, the next item is fitted again from the start', async () => {
    fakeLayout(700);
    const x = mount(B({ r8_missing_number: true }));
    x.el.querySelector('[data-value="30"]').click();
    expect(x.el.querySelector('.sae-foot')).toBeNull();
    await new Promise((r) => setTimeout(r, 800));
    expect(x.runner.view().item_index).toBe(1);
    expect(x.el.querySelector('.sae-foot')).not.toBeNull();
    expect(x.el.querySelector('.sae-screen').classList.contains('is-mn-tight')).toBe(true);
    expect(bottomOf(x.el)).toBeLessThanOrEqual(footTop(x.el));
  });

  test('OFF: no fitting (today\'s screen)', () => {
    fakeLayout(700);
    const x = mount(B(null));
    const scr = x.el.querySelector('.sae-screen');
    expect(scr.classList.contains('is-mn-tight')).toBe(false);
    expect(scr.getAttribute('style')).toBeNull();
  });
});
