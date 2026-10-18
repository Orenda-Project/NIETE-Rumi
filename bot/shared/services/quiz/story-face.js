'use strict';
/**
 * Which Urdu characters the child pages' Urdu face draws (wq-nastaliq-6 and the light wq-nastaliq-7 have the same
 * characters): RANGE is the unicode-range both faces are declared with (dashboard/public/wq/wq.css and the light face's
 * head style in dashboard/routes/web-quiz.routes.js; dashboard/tests/web-quiz-face-lite-storybooks.service.test.js keeps
 * them equal and checks -7 has a glyph for every one).
 *
 * holes(texts): the Urdu-script code points (Arabic blocks and the joiners) in the texts that the face does NOT draw, as
 * sorted 'U+XXXX'. Latin letters, digits and punctuation are not counted: the next font in the stack draws them, as today.
 * story-load.js names a book's holes in its plan so a new Urdu book with a new letter is caught at load, not on a phone.
 */
const RANGE = 'U+0020,U+00A0,U+00AB,U+00BB,U+060C,U+061B,U+061F,U+0621-063A,U+0640-0656,U+0658,U+0660-066D,U+0670,U+0679,U+067E,U+0686,U+0688,U+0691,U+0698,U+06A9,U+06AF,U+06BA,U+06BE,U+06C0-06C3,U+06CC,U+06D2-06D4,U+06F0-06F9,U+200C-200F,U+25CC,U+0021';
const SPANS = RANGE.split(',').map((s) => s.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16)));
const drawn = (c) => SPANS.some(([lo, hi = lo]) => c >= lo && c <= hi);
const urdu = (c) => (c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0x08a0 && c <= 0x08ff)
  || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff) || (c >= 0x200c && c <= 0x200f);
const hex = (c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

function holes(texts) {
  const out = new Set();
  for (const t of texts || []) {
    if (typeof t !== 'string') continue;
    for (const ch of t) { const c = ch.codePointAt(0); if (urdu(c) && !drawn(c)) out.add(c); }
  }
  return [...out].sort((a, b) => a - b).map(hex);
}

module.exports = { RANGE, holes };
