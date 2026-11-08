'use strict';
/**
 * Round 10, layout 2 (battery.ui.r10_number_fit; app_settings sa_r10_number_fit): a maths number is sized to the space
 * it has. Today a card holding one or two characters is drawn large (.is-short) and anything longer, a 3-digit number
 * included, at about half that size. ON: a number card (a number or a sum) is drawn as large as a 2-digit number is
 * today and shrunk only as far as its box makes it; the numbers on one screen's choices (which is bigger, the missing
 * number's choices) share ONE size, the largest that fits every tile; the missing number's row fills its width.
 * OFF: none of it, the screens as before.
 *
 * jsdom has no layout, so the boxes are stood in for: a card is 300 x 300 px, a choice tile 150 x 90 px, and a piece
 * of text is 0.55 em wide per character and 1.2 em tall at the font size set on it. The real sizes are measured in a
 * browser (the round's evidence); this proves the code path that sets them.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const CARDS = (ui, shows) => ({ battery_id: 'b', ui, tasks: [{ id: 'ma.number_id8', subtask: 'number_identification', response: 'record', present: 'one_at_a_time', time_limit_s: 60,
  items: shows.map((x, i) => ({ id: 'n' + (i + 1), target: x, answer: x, show: x })) }] });
const PAIRS = (ui, pairs) => ({ battery_id: 'b', ui, tasks: [{ id: 'ma.discrimination2', subtask: 'quantity_discrimination', response: 'tap',
  items: pairs.map((o, i) => ({ id: 'q' + (i + 1), target: o[0], options: o })) }] });
const MISSING = (ui, items) => ({ battery_id: 'b', ui, tasks: [{ id: 'ma.missing4', subtask: 'missing_number', response: 'tap',
  items: items.map((x, i) => ({ id: 'm' + (i + 1), target: x[1][0], shown: x[0], options: x[1] })) }] });
const WORDS = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'en.letters', subtask: 'letter_name_identification', response: 'tap', lang: 'en',
  items: [{ id: 'q1', target: 'b', options: ['b', 'g', 'y', 'k'] }] }] });

maybe('r10_number_fit on a DOM (sa-ui.js)', () => {
  let dom;
  const keep = {};
  const views = [];
  let cardW = 300;
  let tileW = 150;
  beforeEach(() => {
    cardW = 300; tileW = 150;
    // (a tile's padding is none here: jsdom's own button padding is not the page's)
    dom = new JSDOM('<!doctype html><style>.sae-opt{padding:0}</style><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const W = dom.window;
    const size = (n) => {
      if (n.classList.contains('sae-onecell')) return [cardW, 300];
      if (n.classList.contains('sae-opt')) return [tileW, 90];
      return [360, 640];
    };
    Object.defineProperty(W.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return size(this)[0]; } });
    Object.defineProperty(W.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return size(this)[1]; } });
    const box = (w, h) => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 });
    // text: 0.55 em a character, 1.2 em tall, at the font size on the element or its nearest parent that has one
    W.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('sae-ink')) {
        let n = this, fs = 0;
        while (n && n.style && !(fs = parseFloat(n.style.fontSize))) n = n.parentNode;
        fs = fs || 40;
        return box(Array.from(this.textContent).length * 0.55 * fs, 1.2 * fs);
      }
      // the missing number's row, measured on its hidden copy: each tile its text and padding (at least 1.4 em), 0.2 em apart
      if (this.classList.contains('sae-seq') && this.style.position === 'absolute') {
        const fs = parseFloat(this.style.fontSize);
        const tiles = [...this.querySelectorAll('.sae-seq-tile')];
        const em = tiles.reduce((t, n) => t + Math.max(1.4, Array.from(n.textContent.trim()).length * 0.55 + 0.36), 0) + 0.2 * (tiles.length - 1);
        return box(em * fs, 1.5 * fs);
      }
      const [w, h] = size(this);
      return box(w, h);
    };
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function mount(battery) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery, now: () => 0, mic: () => 'ok', one_at_a_time: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve() });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    return { el, runner, view };
  }
  function remount() {
    views.splice(0).forEach((v) => v.destroy());
    document.getElementById('m').replaceWith(Object.assign(document.createElement('main'), { id: 'm' }));
  }
  const px = (n) => parseFloat(n.style.fontSize);
  const card = (el) => el.querySelector('.sae-onecell > .sae-ink');
  const next = (x) => { x.el.querySelector('.sa-next').click(); };

  test('ON: a 3-digit number card is drawn as large as a 2-digit one when the card has the room', () => {
    const x = mount(CARDS({ r10_number_fit: true }, ['12', '245', '7']));
    expect(x.el.classList.contains('is-r10-numfit')).toBe(true);
    expect(x.el.querySelector('.sae-onecell').classList.contains('is-r10-num')).toBe(true);
    const two = px(card(x.el));
    expect(two).toBeGreaterThan(0);
    next(x);
    expect(card(x.el).textContent).toBe('245');
    const three = px(card(x.el));
    expect(three).toBe(two);
    // a 1-digit number is not drawn bigger than a 2-digit one (the cap)
    next(x);
    expect(px(card(x.el))).toBe(two);
  });

  test('ON: a card too narrow for the 3-digit number at that size shrinks it just enough to fit (and no further)', () => {
    cardW = 200;
    const x = mount(CARDS({ r10_number_fit: true }, ['12', '245']));
    const two = px(card(x.el));
    next(x);
    const three = px(card(x.el));
    expect(three).toBeLessThan(two);
    // fits: 3 characters at 0.55 em within 92% of the card's width, and within one px of the largest that does
    expect(3 * 0.55 * three).toBeLessThanOrEqual(200 * 0.92 + 0.01);
    expect(3 * 0.55 * (three + 1)).toBeGreaterThan(200 * 0.92);
    // bigger than today's size for a longer card (54 px on a 360 px phone)
    expect(three).toBeGreaterThan(54);
  });

  test('ON: a sum on a card is fitted to the card the same way', () => {
    const x = mount(CARDS({ r10_number_fit: true }, ['38 + 26']));
    const s = px(card(x.el));
    expect(Array.from(card(x.el).textContent).length * 0.55 * s).toBeLessThanOrEqual(300 * 0.92 + 0.01);
    expect(s).toBeGreaterThan(54);
  });

  test('ON: the two numbers of "which is bigger" share one size, the largest that fits both tiles', () => {
    tileW = 100;
    const x = mount(PAIRS({ r10_number_fit: true }, [['1234', '5']]));
    expect(x.el.querySelector('.sae-opts').classList.contains('is-r10-num')).toBe(true);
    const inks = [...x.el.querySelectorAll('.sae-opt > .sae-ink')];
    expect(inks).toHaveLength(2);
    const [a, b] = inks.map(px);
    expect(a).toBe(b);
    // the long one decides: 4 characters within 92% of a 100 px tile
    expect(4 * 0.55 * a).toBeLessThanOrEqual(100 * 0.92 + 0.01);
    expect(4 * 0.55 * (a + 1)).toBeGreaterThan(100 * 0.92);
  });

  test('ON: a pair with room grows to the tile height, both numbers at one size', () => {
    const x = mount(PAIRS({ r10_number_fit: true }, [['94', '78']]));
    const [a, b] = [...x.el.querySelectorAll('.sae-opt > .sae-ink')].map(px);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(44); // today's size on a phone
    expect(1.2 * a).toBeLessThanOrEqual(90 * 0.8 + 0.01);
  });

  test('ON: the missing number\'s row is one size, the largest at which it fits its width with the blank holding the longest choice', () => {
    const x = mount(MISSING({ r8_missing_number: true, r10_number_fit: true }, [[[null, 300, 400, 500], [200, 300, 100, 400]], [[5, 6, 7, null], [8, 10, 9, 7]]]));
    const row = () => x.el.querySelector('.sae-seq.is-r8-mn');
    const fsOf = () => Number((row().style.fontSize.match(/var\(--mn-fs,\s*([\d.]+)px\)/) || [])[1]);
    // four 3-digit tiles (the blank sized for "000") at 2.01 em, 0.2 em apart: 8.64 em within 96% of the 360 px row
    expect(fsOf()).toBe(Math.floor(360 * 0.96 / 8.64));
    // today's estimate gave this row 33 px on a 360 px phone
    expect(fsOf()).toBeGreaterThan(33);
    // the probe is gone
    expect(x.el.querySelectorAll('.sae-seq.is-r8-mn')).toHaveLength(1);
    x.runner.answer(200); x.view.render();
  });

  test('ON: a reading task\'s tiles and letter cards are untouched (maths numbers only)', () => {
    const x = mount(WORDS({ r10_number_fit: true }));
    expect(x.el.querySelector('.sae-opts').classList.contains('is-r10-num')).toBe(false);
    [...x.el.querySelectorAll('.sae-opt > .sae-ink')].forEach((i) => expect(i.style.fontSize).toBe(''));
  });

  test('ON: a resize fits the card again to its new width', async () => {
    const x = mount(CARDS({ r10_number_fit: true }, ['245']));
    const wide = px(card(x.el));
    cardW = 150;
    window.dispatchEvent(new window.Event('resize'));
    await new Promise((r) => setTimeout(r, 250));
    const narrow = px(card(x.el));
    expect(narrow).toBeLessThan(wide);
    expect(3 * 0.55 * narrow).toBeLessThanOrEqual(150 * 0.92 + 0.01);
  });

  test('OFF: no round 10 class, no size set on any number; the 3-digit card keeps today\'s classes', () => {
    for (const ui of [undefined, {}, { r10_number_fit: false }]) {
      const x = mount(CARDS(ui, ['12', '245']));
      expect(x.el.classList.contains('is-r10-numfit')).toBe(false);
      expect(x.el.querySelector('[class*="r10"]')).toBeNull();
      expect(card(x.el).getAttribute('style')).toBeNull();
      expect(x.el.querySelector('.sae-onecell').className).toBe('sae-onecell sa-onecell is-short');
      next(x);
      expect(x.el.querySelector('.sae-onecell').className).toBe('sae-onecell sa-onecell');
      expect(card(x.el).getAttribute('style')).toBeNull();
      remount();
      const y = mount(PAIRS(ui, [['94', '78']]));
      expect(y.el.querySelector('[class*="r10"]')).toBeNull();
      [...y.el.querySelectorAll('.sae-opt > .sae-ink')].forEach((i) => expect(i.getAttribute('style')).toBeNull());
      remount();
      const z = mount(MISSING(Object.assign({ r8_missing_number: true }, ui || {}), [[[null, 300, 400, 500], [200, 300, 100, 400]]]));
      expect(z.el.querySelector('.sae-seq.is-r8-mn').getAttribute('style')).toMatch(/^font-size:\s*var\(--mn-fs, min\(96px, calc\(/);
      expect(z.el.querySelector('[class*="r10"]')).toBeNull();
      remount();
    }
  });
});

describe('r10_number_fit in sa.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const at = css.indexOf('/* Round 10 layout 2');
  const block = at < 0 ? '' : css.slice(at, css.indexOf('/* end round 10 layout 2 */', at));
  test('the block exists and every rule in it is under .is-r10-numfit (OFF = none of it applies)', () => {
    expect(block.length).toBeGreaterThan(0);
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    const sel = [];
    for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => sel.push(s));
    expect(sel.length).toBeGreaterThan(0);
    sel.forEach((s) => expect(s).toMatch(/\.is-r10-numfit/));
  });
});
