'use strict';
/**
 * The send sheet's message box shows the whole class message, the return line included, in English and in Urdu:
 * its rows come from msgRows (one source, inlined into the page's script), never fewer than the message's lines.
 */
const Page = require('../../shared/services/first-touch/teacher-home.page');
const { fill } = require('../../shared/services/first-touch/teacher-home.strings');

const LINK = 'https://wa.me/15550001111?text=quiz';
const MESSAGES = {
  en: `Assalam o Alaikum class! Your teacher sent you a quiz: Fractions.\nOpen it here: https://portal.example/q/ABCDEF\nPlay it at home and see your score.\n\n${fill('cm.return', 'en', { link: LINK })}`,
  ur: `السلام علیکم بچو! آپ کے استاد نے کوئز بھیجا ہے: کسر۔\nیہاں کھولیں: https://portal.example/q/ABCDEF\nگھر پر کھیلیں اور اپنا اسکور دیکھیں۔\n\n${fill('cm.return', 'ur', { link: LINK })}`,
};
const lines = (t) => t.split('\n').length;

test.each(['en', 'ur'])('%s: the rows cover every line of the message, the wrapped long lines too', (lang) => {
  const m = MESSAGES[lang];
  const rows = Page.msgRows(m, lang === 'ur');
  expect(rows).toBeGreaterThanOrEqual(lines(m));
  // a line longer than a phone's row (≈ 28 Latin / 22 Urdu letters at 360 px) counts for every row it wraps onto
  const longest = Math.max(...m.split('\n').map((l) => l.length));
  expect(rows).toBeGreaterThan(lines(m) + Math.floor(longest / 40));
});

test('an empty or missing message still gets a small box; a one-line message one row more than its line', () => {
  expect(Page.msgRows('', false)).toBeGreaterThanOrEqual(3);
  expect(Page.msgRows(undefined, true)).toBeGreaterThanOrEqual(3);
  expect(Page.msgRows('x'.repeat(10), false)).toBeGreaterThanOrEqual(2);
});

test('the page script sizes the box with the same msgRows, every time the sheet opens', () => {
  expect(Page.SCRIPT).toContain(Page.msgRows.toString());
  expect(Page.SCRIPT).toMatch(/function sheet\([^)]*\)\{[^\n]*m\.rows=msgRows\(x\.message,/);
});

test.each(['en', 'ur'])('%s shell: the message box is never capped to a fixed height', (lang) => {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: lang === 'en' ? 'ur' : 'en', asked: lang });
  const css = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(html) || [])[1] || '';
  const rule = css.split('}').filter((r) => /\.th-msg\{/.test(r)).join('}');
  expect(rule).not.toMatch(/max-height|overflow:hidden/);
  expect(html).toMatch(/<textarea class="th-msg" id="th-msg"[^>]* rows="\d+"/);
});
