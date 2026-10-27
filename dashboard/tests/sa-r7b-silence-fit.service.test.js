'use strict';
/**
 * Round 7b (sa_silence_repeat): the silence reminder fits the Urdu bar (round 6): every Urdu word whole, clear of the foot,
 * at the portal's Urdu rules (Nastaliq line-height 2 or more) and never under 16 px for a child. The stylesheet's own rules
 * for this screen, applied in a DOM: the reminder's title and Jugnu's line on an Urdu ur-fit page, and Jugnu leaves the
 * screen on a short phone so the line stays above Try again. English is unchanged. (The pixel fit at 320x568, 360x640,
 * 360x740, 390x844 and 130% is measured on the tier: round7/b/e2e/fit_reminder.js.)
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;
const CSS = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');

maybe('the silence reminder\'s Urdu fit (sa.css)', () => {
  function page(lang, fit = true) {
    const dom = new JSDOM(`<!doctype html><html><head><style>${CSS}</style></head><body>
      <main class="sae${fit ? ' is-ur-fit' : ''}" lang="${lang}"><div class="sae-screen sae-silence sa-silence"><div class="sae-body">
      <img class="sae-jugnu sa-jugnu sae-jugnu-s"><h1 class="sae-h1">t</h1><p class="sae-p">p</p></div>
      <div class="sae-foot"><button class="sae-btn sae-primary">b</button></div></div></main></body></html>`, { pretendToBeVisual: true });
    const w = dom.window;
    const q = (s) => w.getComputedStyle(w.document.querySelector(s));
    return { w, q };
  }
  const px = (v) => parseFloat(v);
  // a computed line height is "36px" in a browser and the declared "2.2" in a DOM without layout: either way, a ratio
  const ratio = (cs) => (/px$/.test(cs.lineHeight) ? px(cs.lineHeight) / px(cs.fontSize) : parseFloat(cs.lineHeight));
  test('Urdu, ur-fit: the line is at least 16 px with line height 2 or more; the title too', () => {
    const { q } = page('ur');
    const p = q('.sae-silence .sae-p');
    expect(px(p.fontSize)).toBeGreaterThanOrEqual(16);
    expect(ratio(p)).toBeGreaterThanOrEqual(2);
    const h = q('.sae-silence .sae-h1');
    expect(px(h.fontSize)).toBeGreaterThanOrEqual(16);
    expect(ratio(h)).toBeGreaterThanOrEqual(2);
    expect(px(h.fontSize)).toBeLessThan(30); // smaller than a task title, so the short title stays on one line
  });
  test('Urdu, ur-fit, a short phone: Jugnu leaves the reminder (a rule for heights of 700 px and under)', () => {
    expect(CSS).toMatch(/@media \(max-height:\s*700px\)\s*\{[^}]*\.is-ur-fit\[lang=ur\] \.sae-silence \.sae-jugnu\{display:none\}/);
  });
  test('English: the reminder keeps the page\'s own sizes (no silence rule applies)', () => {
    const en = page('en').q('.sae-silence .sae-h1');
    const base = page('en').q('.sae-h1');
    expect(en.fontSize).toBe(base.fontSize);
    expect(page('en').q('.sae-silence .sae-p').lineHeight).toBe(page('en', false).q('.sae-silence .sae-p').lineHeight);
  });
});
