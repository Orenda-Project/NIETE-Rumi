/**
 * Web quiz page colours read at WCAG AA (4.5:1 for normal text) in EVERY brand.
 * The page's semantic tokens (right / not yet) are the same in every brand, the brand
 * tokens come from bot/shared/config/web-quiz-brand.js; both are read from source, so a
 * colour change that breaks a pair fails here before a child squints at it.
 */
const fs = require('fs');
const path = require('path');
const Brand = require('../../bot/shared/config/web-quiz-brand');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const ROOT = CSS.slice(CSS.indexOf(':root{'), CSS.indexOf('}', CSS.indexOf(':root{')));
const tok = (name) => { const m = new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`).exec(ROOT); return m && m[1]; };
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const A = lum(a); const B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };

test('"not yet" text reads at AA on its own pale background (answer feedback, the practice banner)', () => {
  expect(ratio(tok('notyet'), tok('notyet-bg'))).toBeGreaterThanOrEqual(4.5);
});

test('"right" text reads at AA on its own pale background', () => {
  expect(ratio(tok('right'), tok('right-bg'))).toBeGreaterThanOrEqual(4.5);
});

test.each(Object.keys(Brand.BRANDS))('%s: the semantic colours read at AA on the brand ground and on cards', (key) => {
  const t = Brand.BRANDS[key].tokens;
  ['notyet', 'right'].forEach((s) => {
    expect([s, ratio(tok(s), t.ground) >= 4.5]).toEqual([s, true]);
    expect([s, ratio(tok(s), t.card) >= 4.5]).toEqual([s, true]);
  });
});
