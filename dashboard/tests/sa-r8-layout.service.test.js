'use strict';
/**
 * Round 8, items 6 / 12 / 21 (battery.ui.r8_layout; app_settings sa_r8_layout): the child's screens use the room they
 * have. ON: the mount carries .is-r8-layout and every rule for it in sa.css is scoped under that class (bigger pictures
 * and tap targets per phone / tablet, normal weight for large text, a fixed card box); a letter card's ink is centred
 * in every language (the Urdu-only ink fit extends to Latin cards and tiles) and is placed again when the screen
 * resizes. OFF: none of it, the screens as before.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const CARDS = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'en.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'en', present: 'one_at_a_time', time_limit_s: 60,
  items: ['i', 'y', 'E', 'O', 'A'].map((x, i) => ({ id: 'L' + (i + 1), target: x, show: x })) }] });
const TAP = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'en.letters', subtask: 'letter_name_identification', response: 'tap', lang: 'en',
  items: [{ id: 'q1', target: 'b', options: ['b', 'g', 'y', 'k'] }, { id: 'q2', target: 'p', options: ['p', 'q', 'd', 'j'] }] }] });

maybe('r8_layout on a DOM (sa-ui.js)', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    // The ink fit measures with a canvas and the font loader; jsdom has neither, so both are stood in for: every
    // glyph's ink is 40 x 80 px and sits 20 px below the middle of its line (a descender, like "y").
    document.fonts = { load: () => Promise.resolve() };
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
      measureText: () => ({ actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 50, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 40, fontBoundingBoxAscent: 60 }),
    });
    const box = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return box(0, 0, 300, 300); };
    dom.window.Range.prototype.getBoundingClientRect = () => box(130, 100, 40, 120);
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
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const inkOf = (el) => el.querySelector('.sae-onecell > .sae-ink');

  test('OFF: no .is-r8-layout anywhere; a Latin card keeps its plain line (no ink fit)', async () => {
    const x = mount(CARDS(undefined));
    await flush(); await flush();
    expect(x.el.classList.contains('is-r8-layout')).toBe(false);
    expect(x.el.querySelector('[class*="r8"]')).toBeNull();
    expect(inkOf(x.el).style.transform).toBe('');
  });

  test('ON: the mount carries .is-r8-layout; the screens keep their own parts', () => {
    const x = mount(TAP({ r8_layout: true }));
    expect(x.el.classList.contains('is-r8-layout')).toBe(true);
    expect(x.el.querySelectorAll('.sae-opt')).toHaveLength(4);
  });

  test('ON: a Latin letter card is centred on its ink (here 20 px up), on every card; again after a resize', async () => {
    const x = mount(CARDS({ r8_layout: true }));
    await flush(); await flush();
    const first = inkOf(x.el).style.transform;
    expect(first).toMatch(/^translate\(/);
    const [, dx, dy] = first.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/).map(Number);
    expect(dx).toBeCloseTo(0, 0);
    expect(dy).toBeCloseTo(-20, 0);
    // the next card: the same box, the same placement
    x.el.querySelector('.sa-next').click();
    await flush(); await flush();
    expect(inkOf(x.el).textContent).toBe('y');
    expect(inkOf(x.el).style.transform).toBe(first);
    // a resize (the phone turned, the address bar hid) places the ink again
    inkOf(x.el).style.transform = 'translate(9px,9px)';
    window.dispatchEvent(new window.Event('resize'));
    await new Promise((r) => setTimeout(r, 200));
    expect(inkOf(x.el).style.transform).toBe(first);
  });

  test('ON: a Latin text tile is centred on its ink too; OFF it is not', async () => {
    const on = mount(TAP({ r8_layout: true }));
    await flush(); await flush();
    const tiles = [...on.el.querySelectorAll('.sae-opt > .sae-ink')];
    expect(tiles).toHaveLength(4);
    tiles.forEach((t) => expect(t.style.transform).toMatch(/^translate\(/));
    views.splice(0).forEach((v) => v.destroy());
    document.getElementById('m').replaceWith(Object.assign(document.createElement('main'), { id: 'm' }));
    const off = mount(TAP(undefined));
    await flush(); await flush();
    [...off.el.querySelectorAll('.sae-opt > .sae-ink')].forEach((t) => expect(t.style.transform).toBe(''));
  });
});

describe('r8_layout in sa.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const at = css.indexOf('/* Round 8 (sa_r8_layout');
  const block = at < 0 ? '' : css.slice(at, css.indexOf('/* end round 8 layout */', at));
  const selectors = () => {
    const out = [];
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s));
    return out;
  };
  test('the block exists and every rule in it is under .is-r8-layout (OFF = none of it applies)', () => {
    expect(block.length).toBeGreaterThan(0);
    const sel = selectors();
    expect(sel.length).toBeGreaterThan(10);
    sel.forEach((s) => expect(s).toMatch(/\.is-r8-layout/));
  });
  test('phone and tablet are sized separately; tap targets at least 56 px; large text at normal weight', () => {
    expect(block).toMatch(/@media \(min-width:\s*600px\)/);
    expect(block).toMatch(/--sae-tap:\s*(6[4-9]|[7-9]\d)px/);
    expect(block).toMatch(/\.sae-more[^{]*\{[^}]*min-height:\s*(5[6-9]|[6-9]\d)px/);
    expect(block).toMatch(/\.sae-h1[^{]*\{[^}]*font-weight:\s*400/);
    expect(block).toMatch(/\.sae-opt[^{]*\{[^}]*font-weight:\s*400/);
    // a card is one fixed box, its ink placed in the middle of it
    expect(block).toMatch(/\.sae-onecell[^{]*\{[^}]*height:\s*clamp\(/);
  });
});
