'use strict';
/**
 * Round 10 layout 1 (battery.ui.r10_urdu_fit; app_settings sa_r10_urdu_fit): "Urdu words don't sit in the middle of
 * their button or bubble ... centre them and make sure the full Nastaliq word fits inside." ON: the mount carries
 * .is-r10-urfit and, after every draw (and on a resize or a late change), each Urdu label (buttons, chips, the story
 * question, Jugnu's words, ...) is measured by its ink (a canvas reads the drawn word's height above and below the line)
 * and its top and bottom padding are set so the ink sits in the middle with room on both sides; a one-line pill is
 * centred side to side as well. Labels with no Urdu letter (numbers) and English labels are left alone.
 * OFF: the page as before (no class, no padding written).
 * jsdom lays nothing out: the boxes below stand in for the browser (an element grows with its own padding, a letter
 * moves down with it), so the test proves the code path; the geometry itself is proven in a real browser.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const TAP = { id: 'ur.letters', mode: 'tap', lang: 'ur', title: 'حروف', instruction: { text: 'جو حرف سنیں اسے دبائیں۔' }, script: {},
  items: [{ id: 'q1', target: 'ب', options: ['ب', 'پ'] }, { id: 'q2', target: 'پ', options: ['ب', 'پ'] }] };

maybe('round 10 layout 1: Urdu ink centred in its box (r10_urdu_fit)', () => {
  let dom; let views = []; const keep = {};
  // Stand-in layout: every element is 300 x 90 at (0, 0) plus its own inline padding; each letter is a 10 px cell whose
  // line top is 30 px below the element's top (plus its padding), so its baseline is at 30 + 40 (the font's ascent).
  // The canvas says the ink reaches 20 px above the baseline and 15 below: as drawn, 50..85 in a 0..90 box (low).
  let G;
  beforeEach(() => {
    views = [];
    G = { asc: 20, desc: 15 };
    // no padding of jsdom's own on a button: the stand-in boxes grow with the padding sa-ui writes, nothing else
    dom = new JSDOM('<!doctype html><style>button{padding:0}</style><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'NodeFilter']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    document.fonts = { load: () => Promise.resolve([]), ready: Promise.resolve() };
    const px = (v) => parseFloat(v) || 0;
    const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const s = this.style;
      return rect(0, 0, 300 + px(s.paddingLeft) + px(s.paddingRight), 90 + px(s.paddingTop) + px(s.paddingBottom));
    };
    dom.window.Range.prototype.getBoundingClientRect = function () {
      const t = this.startContainer; const p = t.parentElement || t.parentNode;
      const s = (p && p.style) || {};
      // the label's letters sit side by side, centred at x = 150 (+ half the padding difference)
      const n = t.data.length; const i = this.startOffset;
      const x0 = 150 - n * 5 + (px(s.paddingLeft) - px(s.paddingRight)) / 2;
      return rect(x0 + i * 10, 30 + px(s.paddingTop), 10, 50);
    };
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
      measureText: (t) => ({ width: t.length * 10, actualBoundingBoxAscent: G.asc, actualBoundingBoxDescent: G.desc, actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: t.length * 10, fontBoundingBoxAscent: 40, fontBoundingBoxDescent: 10 }),
    });
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function mount({ on = true, lang = 'ur', tasks = [TAP] } = {}) {
    const core = require('../sa/sa-core');
    const sa = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks, ui: { ur_fit: true, r8_layout: true } };
    if (on) battery.ui.r10_urdu_fit = true;
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    runner.start();
    const el = document.getElementById('m');
    const view = sa.mount(el, { runner, battery, lang, mode: 'game', ur_fit: true, speak: () => Promise.resolve() });
    views.push(view);
    view.render();
    return { el, runner, view };
  }
  const next = (el) => el.querySelector('.sae-btn.sae-primary');

  test('OFF: no .is-r10-urfit, and no padding is written on any element (the page as today)', async () => {
    const x = mount({ on: false });
    await flush();
    expect(x.el.classList.contains('is-r10-urfit')).toBe(false);
    expect(next(x.el)).not.toBeNull();
    expect(x.el.querySelectorAll('[style*="padding"]')).toHaveLength(0);
  });

  test('ON: the mount carries .is-r10-urfit; the low «آگے» is centred on its ink with the whole word inside', async () => {
    const x = mount();
    expect(x.el.classList.contains('is-r10-urfit')).toBe(true);
    await flush();
    const b = next(x.el);
    expect(b.textContent).toBe('آگے');
    // ink 50..85 in 0..90: 50 above, 5 below. Balanced without shrinking the button: 45 px more below than above
    expect(parseFloat(b.style.paddingTop)).toBeCloseTo(0, 0);
    expect(parseFloat(b.style.paddingBottom)).toBeCloseTo(45, 0);
    // centred side to side already (the letters are centred): nothing written there
    expect(b.style.paddingLeft).toBe('');
    const r = b.getBoundingClientRect();
    const top = 30 + 40 - G.asc + parseFloat(b.style.paddingTop); const bot = 30 + 40 + G.desc + parseFloat(b.style.paddingTop);
    expect(Math.abs((top - r.top) - (r.bottom - bot))).toBeLessThan(1.01);
  });

  test('ON: ink that runs out of the top gets room above it (the tall letters inside), centred', async () => {
    G.asc = 80; G.desc = 10; // ink 10 px above the box's top, 10 below the baseline: -10..80 in 0..90
    const x = mount();
    await flush();
    const b = next(x.el);
    const pt = parseFloat(b.style.paddingTop); const pb = parseFloat(b.style.paddingBottom);
    const r = b.getBoundingClientRect();
    const top = 70 - 80 + pt - r.top; const bot = r.bottom - (80 + pt);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(bot).toBeGreaterThanOrEqual(4);
    expect(Math.abs(top - bot)).toBeLessThan(1.01);
  });

  test('ON: a label with no Urdu letter (a number) is never touched, nor an English page', async () => {
    const x = mount();
    await flush();
    const n = document.createElement('span'); n.className = 'sae-chip'; n.textContent = '125';
    x.el.querySelector('.sae-body').appendChild(n);
    await flush();
    expect(n.getAttribute('style')).toBeNull();
    const y = mount({ lang: 'en', tasks: [Object.assign({}, TAP, { lang: 'en', title: 'Letters', instruction: { text: 'Tap the letter.' } })] });
    await flush();
    expect(y.el.classList.contains('is-r10-urfit')).toBe(true);
    expect(next(y.el).textContent).toBe('Next');
    expect(next(y.el).style.paddingTop).toBe('');
  });

  test('ON: a label shown after the draw (a late change) and a resize are fitted again', async () => {
    const x = mount();
    await flush();
    const c = document.createElement('p'); c.className = 'sae-chip'; c.textContent = 'مشق';
    x.el.querySelector('.sae-body').appendChild(c);
    await flush(60);
    expect(parseFloat(c.style.paddingBottom)).toBeCloseTo(45, 0);
    G.asc = 30; G.desc = 30; // the font changed size: ink 40..100 of 0..135
    window.dispatchEvent(new window.Event('resize'));
    await flush(200);
    const b = next(x.el); const pt = parseFloat(b.style.paddingTop);
    const r = b.getBoundingClientRect();
    expect(Math.abs((70 - 30 + pt - r.top) - (r.bottom - (100 + pt)))).toBeLessThan(1.01);
  });
});
