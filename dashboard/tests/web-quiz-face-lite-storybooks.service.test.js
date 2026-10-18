/**
 * The light Urdu face (wq-nastaliq-7, app_settings web_quiz_face_lite) has no hole in a book.
 *
 * The storybooks are the largest Urdu text a child sees, and they use letters and marks the quiz bank rarely has
 * (ۂ, ئ, ؤ, the izafat zer, ، ۔ ؟, the Urdu digits). A character missing from the face falls back to the system font
 * mid-word and the joins break. So every code point of the 36 Urdu storybooks (titles, authors, page text, questions
 * and options) and of the child pages' own Urdu words must be in the light face's character map AND inside the
 * unicode-range the page head declares for it.
 *
 * The book code points are frozen in fixtures/face-lite-child-codepoints.json (code points only, no text). The child
 * pages' words are also read live from the sources, so a new Urdu word with a new letter is checked the day it lands.
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const R = require('../routes/web-quiz.routes');
const { QUIZ, ORIGIN, ASSET_V } = require('./fixtures/one-urdu-face-cases');
const CP = require('./fixtures/face-lite-child-codepoints.json');

const FONTS = path.join(__dirname, '..', 'public', 'wq', 'fonts');
const REPO = path.join(__dirname, '..', '..');
const hex = (c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
// Arabic, Arabic Supplement, Presentation Forms A and B
const urduScript = (c) => (c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);

// the light face's unicode-range, as the head of a page with the switch on declares it
function liteRange() {
  const html = R.renderQuizPage({ payload: QUIZ('ur', { ui: { ur2: true, fl: true } }), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ASSET_V });
  const m = /<style id="wq-fl">@font-face\{[^}]*src:url\(\/wq\/fonts\/wq-nastaliq-7\.woff2\)[^}]*unicode-range:([^;}]+)/.exec(html);
  if (!m) throw new Error('the head declares no light face');
  const spans = m[1].split(',').map((s) => s.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16)));
  return (c) => spans.some(([lo, hi = lo]) => c >= lo && c <= hi);
}

// The Urdu words of the child pages (hub, shelf, reader, quiz, challenge): runs of two or more Urdu letters in their
// sources. A run holding a block's first or last code point is a regex range (e.g. [؀-ۿ] written raw), not text.
const UI_SOURCES = [
  ...fs.readdirSync(path.join(REPO, 'dashboard', 'public', 'wq')).filter((f) => f.endsWith('.js')).map((f) => path.join('dashboard', 'public', 'wq', f)),
  path.join('dashboard', 'routes', 'web-quiz.routes.js'),
  ...fs.readdirSync(path.join(REPO, 'bot', 'shared', 'services', 'quiz')).filter((f) => /^(web-quiz|story).*\.js$/.test(f)).map((f) => path.join('bot', 'shared', 'services', 'quiz', f)),
];
const BLOCK_ENDS = new Set([0x0600, 0x06ff, 0x0750, 0x077f, 0xfb50, 0xfdff, 0xfe70, 0xfeff]);
function uiCodepoints() {
  const out = new Map();
  for (const rel of UI_SOURCES) {
    const runs = fs.readFileSync(path.join(REPO, rel), 'utf8').match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿‌-‏«»]+/g) || [];
    for (const run of runs) {
      const cps = [...run].map((ch) => ch.codePointAt(0));
      if (cps.some((c) => BLOCK_ENDS.has(c)) || cps.filter((c) => /\p{Lo}/u.test(String.fromCodePoint(c))).length < 2) continue;
      for (const c of cps) if (!out.has(c)) out.set(c, rel);
    }
  }
  return out;
}

describe('the light face draws every Urdu character of the storybooks and the child pages', () => {
  const lite = fontkit.openSync(path.join(FONTS, 'wq-nastaliq-7.woff2'));
  const six = fontkit.openSync(path.join(FONTS, 'wq-nastaliq-6.woff2'));
  let inRange;
  beforeAll(() => { inRange = liteRange(); });
  const holes = (cps) => cps.filter((c) => !lite.hasGlyphForCodePoint(c) || !inRange(c)).map(hex);

  it('the frozen set is the 36 Urdu books and holds the letters the books are known for', () => {
    expect(CP.storybooks.books).toBe(36);
    // ۂ ئ ؤ ، ۔ ؟ the zer of «نظامِ شمسی», and the Urdu digits ۰ and ۹
    for (const c of [0x06c2, 0x0626, 0x0624, 0x060c, 0x06d4, 0x061f, 0x0650, 0x06f0, 0x06f9]) expect(CP.storybooks.urdu).toContain(c);
  });

  it('every Urdu code point of the 36 Urdu storybooks is in -7 and in its declared range', () => {
    expect(holes(CP.storybooks.urdu)).toEqual([]);
  });

  it('the rest of the book text is no Urdu letter or mark, and the full face lacks it too (the light face loses nothing)', () => {
    for (const c of CP.storybooks.not_in_either_face) {
      expect([hex(c), urduScript(c)]).toEqual([hex(c), false]);
      expect([hex(c), six.hasGlyphForCodePoint(c), lite.hasGlyphForCodePoint(c)]).toEqual([hex(c), false, false]);
    }
    for (const c of [...CP.storybooks.urdu, ...CP.storybooks.not_in_either_face]) {
      expect([hex(c), lite.hasGlyphForCodePoint(c)]).toEqual([hex(c), six.hasGlyphForCodePoint(c)]);
    }
  });

  it('every Urdu code point of the child pages\' own words is in -7 and in its declared range (frozen and live)', () => {
    expect(holes(CP.ui.urdu)).toEqual([]);
    const live = uiCodepoints();
    expect(live.size).toBeGreaterThan(40);
    expect([...live.keys()].filter((c) => holes([c]).length).map((c) => `${hex(c)} ${live.get(c)}`)).toEqual([]);
  });

  it('ژ, which no book has yet, is in -7 too', () => {
    expect(holes([0x0698])).toEqual([]);
  });
});
