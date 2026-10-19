/**
 * The adventure look (<html class="wq-adv">, app_settings web_quiz_adventure_look) on an Urdu child's screens that carry
 * English words, plus two small looks:
 *  - an English question on an Urdu page is marked Latin (`wq-qlat`, dir=ltr) so it sets in the Latin face at a Latin
 *    line height, not the airy Nastaliq one; an Urdu question and every page without the look are today's, byte for byte;
 *  - an English video title on the Urdu Videos grid clamps left to right, so its ellipsis is at the end of the words;
 *  - the empty Stories note has Jugnu above it and balanced lines (no lone word on line 2);
 *  - the grown-ups language button on an English page («اردو») is sized like the rest of the sheet, not tiny.
 * Invented content only.
 */
const fs = require('fs');
const path = require('path');
const WQI = require('../public/wq/wq.js');

// each rule sits in its own screen's sheet, scoped to html.wq-adv (inert without the look; the look's own sheet is at its cap)
const CSS = ['wq.css', 'wq-doors.css', 'wq-home.css'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const T = { check: 'Check', listenBig: 'Listen', listen: 'Listen' };
const q = (text) => ({ text, options: [{ slot: 'A', text: 'red' }, { slot: 'B', text: 'shirt' }] });
const qtext = (h) => (/<p class="wq-qtext[^>]*>/.exec(h) || [])[0];

function withHtml(classes, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'document');
  const prev = global.document;
  global.document = { documentElement: { classList: { contains: (c) => classes.indexOf(c) >= 0 } } };
  try { return fn(); } finally { if (had) global.document = prev; else delete global.document; }
}

describe('an English question on an Urdu page (the look on)', () => {
  test('is marked Latin, left to right', () => {
    const h = withHtml(['wq-adv'], () => WQI.itemHtml(q('Which word describes the shirt?'), T, 'ur'));
    expect(qtext(h)).toBe('<p class="wq-qtext wq-qlat" dir="ltr">');
  });
  test('an Urdu question stays as it is', () => {
    const h = withHtml(['wq-adv'], () => WQI.itemHtml(q('قمیض کا رنگ کیا ہے؟'), T, 'ur'));
    expect(qtext(h)).toBe('<p class="wq-qtext">');
  });
  test('an English page is today\'s', () => {
    const h = withHtml(['wq-adv'], () => WQI.itemHtml(q('Which word describes the shirt?'), T, 'en'));
    expect(qtext(h)).toBe('<p class="wq-qtext">');
  });
  test('switch off (no wq-adv): the Urdu page is today\'s, byte for byte', () => {
    const on = withHtml([], () => WQI.itemHtml(q('Which word describes the shirt?'), T, 'ur'));
    const none = WQI.itemHtml(q('Which word describes the shirt?'), T, 'ur');
    expect(on).toBe(none);
    expect(on).not.toContain('wq-qlat');
  });
  test('the look sets it in the Latin face at a Latin line height, beating the Urdu question rules', () => {
    expect(CSS).toMatch(/html\.wq-adv\[lang=ur\] \.wq-qtext\.wq-qlat,html\.wq-adv\.wq-ur2\[lang=ur\] \.wq-qtext\.wq-qlat\{[^}]*font-family:var\(--f\)[^}]*line-height:1\.3/);
  });
});

describe('the Urdu Videos grid: an English title', () => {
  test('clamps left to right, so the ellipsis ends the words', () => {
    expect(CSS).toMatch(/html\.wq-adv\[lang=ur\] \.wq-vct:has\(>bdi\.wq-lat\)\{[^}]*direction:ltr[^}]*text-align:right/);
  });
});

describe('the empty Stories note', () => {
  test('Jugnu above the note, balanced lines', () => {
    const rule = (/html\.wq-adv \.wq-dempty \.wq-soon\{([^}]*)\}/.exec(CSS) || [])[1] || '';
    expect(rule).toContain('text-wrap:balance');
    expect(rule).toContain('url(/wq/jugnu/hello.webp)');
  });
});

describe('the grown-ups sheet on an English page', () => {
  test('the «اردو» button is sized like the sheet, in the Urdu face', () => {
    const rule = (/html\.wq-adv:not\(\[lang=ur\]\) \.wq-gsheet a\[data-tap=lang\]\{([^}]*)\}/.exec(CSS) || [])[1] || '';
    expect(rule).toContain('font-family:var(--fu)');
    expect(rule).toMatch(/font-size:calc\(var\(--fs-4\) \+ 4px\)/);
  });
});
