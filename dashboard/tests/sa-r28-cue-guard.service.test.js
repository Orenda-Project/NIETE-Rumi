'use strict';
/**
 * Round 28 (sa_r28_cue_guard; the engine reads battery.ui.r28_cue_guard): the round-9 scroll cue never keeps itself
 * shown. The cue decides while hidden (the screen's true overflow); once shown, its own box (height, margins and the gap
 * its parent adds) is part of what scrolls, so today a true overflow of 12 px shows the cue and the cue stays until about
 * 75 px have been scrolled, and a screen that grew back to fit keeps a cue drawn over nothing. ON: scrollCheck takes the
 * shown cue's own box off the height it measures, so the cue goes after the screen's own 12 px, a true 50 still shows
 * it, a true 0 never does, and a screen that shrinks to fit loses it. The thresholds (> 4, within 8 of the bottom) are
 * unchanged. OFF (absent): today's behaviour, the self-held cue included.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const CUE_H = { en: 36, ur: 61.1 }; // the cue's box on a phone (sa.css: min-height 36, Urdu at line-height 1.9 = 61.1)
const GAP = 10; // .sae-foot's gap (sa.css)

const TAP = (id, lang) => ({ id, mode: 'tap', lang, title: 'Letters', instruction: { text: 'Tap the letter you hear.' }, script: {},
  items: [{ id: id + '.01', target: 'b', options: ['b', 'p'] }, { id: id + '.02', target: 'p', options: ['b', 'p'] }] });

maybe('round 28: the scroll cue never holds itself (sa_r28_cue_guard)', () => {
  let dom; let views = []; const keep = {};
  let content; let lang; // the screen's own height (the page's scrollHeight with the cue hidden)
  const VH = 640;
  const tops = new WeakMap();
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><style>.sae-foot{display:flex;flex-direction:column;gap:' + GAP + 'px}</style><main id="m"></main>',
      { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const doc = dom.window.document;
    const P = dom.window.HTMLElement.prototype;
    const cueShown = () => { const c = doc.querySelector('.sae-r9-scroll'); return !!c && !c.hidden; };
    // Layout stand-in (jsdom lays nothing out): the page scrolls; the shown cue adds its box + the foot's gap.
    const pageSh = () => content + (cueShown() ? CUE_H[lang] + GAP : 0);
    Object.defineProperty(P, 'scrollHeight', { configurable: true, get() { return this === doc.documentElement ? pageSh() : 0; } });
    Object.defineProperty(P, 'clientHeight', { configurable: true, get() { return this === doc.documentElement ? VH : 0; } });
    Object.defineProperty(P, 'offsetHeight', { configurable: true, get() { return this.classList && this.classList.contains('sae-r9-scroll') && !this.hidden ? CUE_H[lang] : 0; } });
    Object.defineProperty(P, 'scrollTop', { configurable: true, get() { return tops.get(this) || 0; }, set(v) { tops.set(this, Math.max(0, Math.min(v, pageSh() - VH))); } });
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function mount({ guard = true, l = 'en' } = {}) {
    lang = l;
    const core = require('../sa/sa-core');
    const sa = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks: [TAP(l + '.a', l)], ui: Object.assign({ r9_scroll_cue: true }, guard ? { r28_cue_guard: true } : {}) };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    runner.start();
    const el = document.getElementById('m');
    const view = sa.mount(el, { runner, battery, lang: l, mode: 'game', speak: () => Promise.resolve() });
    views.push(view);
    return { el, view, cue: () => el.querySelector('.sae-r9-scroll') };
  }
  const scrollPage = (top) => { document.documentElement.scrollTop = top; window.dispatchEvent(new window.Event('scroll')); };
  const resize = () => window.dispatchEvent(new window.Event('resize'));
  const shown = (c) => !!c && !c.hidden;

  ['en', 'ur'].forEach((l) => {
    describe(l, () => {
      test('(i) a true overflow of 12 px: the cue shows, and goes after a 12 px scroll (OFF: it stays until ~' + Math.round(12 + CUE_H[l] + GAP - 8) + ' px)', async () => {
        content = VH + 12;
        const x = mount({ l });
        await flush();
        expect(x.el.classList.contains('is-r9-scroll')).toBe(true);
        expect(shown(x.cue())).toBe(true);
        scrollPage(12); await flush();
        expect(shown(x.cue())).toBe(false);
        resize(); await flush(); // the box gone and the check run again: it stays hidden (no snap-back)
        expect(shown(x.cue())).toBe(false);
      });

      test('(ii) a true overflow of 50 px: the cue shows, and stays until the 50 px are in view', async () => {
        content = VH + 50;
        const x = mount({ l });
        await flush();
        expect(shown(x.cue())).toBe(true);
        scrollPage(20); await flush();
        expect(shown(x.cue())).toBe(true);
        scrollPage(50); await flush();
        expect(shown(x.cue())).toBe(false);
      });

      test('(iii) a true overflow of 0: no cue', async () => {
        content = VH;
        const x = mount({ l });
        await flush();
        expect(shown(x.cue())).toBe(false);
      });

      test('(iv) a screen that grew past the bottom, then fits again (a late font): the cue goes, it never holds itself', async () => {
        content = VH + 40;
        const x = mount({ l });
        await flush();
        expect(shown(x.cue())).toBe(true);
        content = VH; // the screen's own content now fits; only the cue's box is below
        resize(); await flush();
        expect(shown(x.cue())).toBe(false);
      });

      test('OFF (switch absent): today\'s cue, which holds itself on its own box', async () => {
        content = VH + 40;
        const x = mount({ l, guard: false });
        await flush();
        expect(shown(x.cue())).toBe(true);
        content = VH;
        resize(); await flush();
        expect(shown(x.cue())).toBe(true);
        expect(x.el.classList.contains('is-r28-toggle-fit')).toBe(false);
      });
    });
  });
});

describe('the two A11 switches on the battery route (sa-battery-switches.js), both OFF by default', () => {
  const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
  const plain = { battery_id: 'b', lang: 'ur', tasks: [{ id: 'ur.a', mode: 'tap', items: [] }] };
  test('sa_r28_cue_guard → battery.ui.r28_cue_guard; sa_r28_toggle_fit → battery.ui.r28_toggle_fit', () => {
    expect(SWITCHES.r28CueGuard).toBe('sa_r28_cue_guard');
    expect(SWITCHES.r28ToggleFit).toBe('sa_r28_toggle_fit');
    expect(applySwitches(plain, { rdfW3Forms: true, r28CueGuard: true }).ui).toEqual({ r28_cue_guard: true });
    expect(applySwitches(plain, { rdfW3Forms: true, r28ToggleFit: true }).ui).toEqual({ r28_toggle_fit: true });
  });
  test('OFF (absent or false): the battery as before, no ui key', () => {
    expect(applySwitches(plain, { rdfW3Forms: true })).toEqual(plain);
    expect(applySwitches(plain, { rdfW3Forms: true, r28CueGuard: false, r28ToggleFit: false })).toEqual(plain);
  });
});
