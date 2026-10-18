'use strict';
/**
 * The shared link landing's own small Urdu face: ONE @font-face line, the face inline (a data: URL), for a page that
 * has no script and makes one request.
 *
 * It is the app's Urdu face (wq-nastaliq-6.woff2) cut down to the landing's FIXED words: the card's words, the
 * activity marks and the landing's own lines (dashboard/scripts/landing-urdu-face/strings.js). Every one of those
 * words, and every run of whole words in them, shapes exactly as with the full face. Any other text would draw
 * wrongly, so it has its own family name, and the page gives it only to the fixed words:
 *
 *   - fixed words (the mark, the deed line, the invite line, the button, the hint): font-family "WQ Nastaliq Landing"
 *   - open text (a child's name, an item title): never this family; it gets the app's full face, lazily: FULL_FAMILY,
 *     declared by fullFace() with the immutable /wq/fonts/wq-nastaliq-6.woff2 URL, swap, -6's range, no preload, so
 *     it is fetched only when such an element holds Urdu letters. faces() gives both lines.
 *
 * `font-display:swap`: the first paint never waits for it. One weight (400), as the app's Urdu.
 * The face and its record (.woff2, .json) are made by dashboard/scripts/landing-urdu-face/build.py; after a word
 * changes, run it again (the guard test, dashboard/tests/web-quiz-landing-face.service.test.js, is red until then).
 */
const fs = require('fs');
const path = require('path');

const FAMILY = 'WQ Nastaliq Landing';
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-landing-face.json'), 'utf8'));

const hex = (c) => c.toString(16).toUpperCase().padStart(4, '0');
// The face's own characters, as ranges: U+0020,U+0627-0628,...
function rangeOf(cps) {
  const out = [];
  for (let i = 0; i < cps.length;) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j += 1;
    out.push(j > i ? `U+${hex(cps[i])}-${hex(cps[j])}` : `U+${hex(cps[i])}`);
    i = j + 1;
  }
  return out.join(',');
}
const RANGE = rangeOf(META.codepoints);
// The exact characters the face draws (its unicode-range, as code points). Latin letters, ASCII digits and ':' are not
// in it (the app face has none either): on an Urdu page they fall to the next font, as today.
const CODEPOINTS = Object.freeze([...META.codepoints]);
const HAVE = new Set(CODEPOINTS);
/** true when every character of `text` is one this face draws. Necessary, not sufficient: only the built strings
 *  (STRINGS) are checked to shape like the full face, so it is for fixed copy only, never open text. */
function covers(text) {
  for (const ch of String(text)) if (!HAVE.has(ch.codePointAt(0))) return false;
  return true;
}

// The app's full Urdu face, the rule wq.css declares for "WQ Nastaliq 2", with the page-absolute URL (the landing has
// no stylesheet of its own). Read from wq.css so the range can never drift from the app's.
const FULL_FAMILY = 'WQ Nastaliq 2';
const FULL_URL = '/wq/fonts/wq-nastaliq-6.woff2';
let full = null;
function fullFace() {
  if (full) return full;
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
  const m = /@font-face\{font-family:"WQ Nastaliq 2";src:url\(fonts\/wq-nastaliq-6\.woff2\)[^}]*\}/.exec(sheet);
  if (!m) throw new Error('wq.css no longer declares "WQ Nastaliq 2" with wq-nastaliq-6.woff2');
  full = m[0].replace('url(fonts/wq-nastaliq-6.woff2)', `url(${FULL_URL})`);
  return full;
}
/** Both lines, for the landing's <style>: the small face for the fixed words, then the lazy full face for open text. */
function faces() {
  return fontFace() + fullFace();
}

let css = null;
/** The one @font-face line (no newline, no markup), for the landing's <style>. */
function fontFace() {
  if (css) return css;
  const b64 = fs.readFileSync(path.join(__dirname, 'web-quiz-landing-face.woff2')).toString('base64');
  css = `@font-face{font-family:"${FAMILY}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:400;font-display:swap;unicode-range:${RANGE}}`;
  return css;
}

module.exports = {
  FAMILY,
  FULL_FAMILY,
  FULL_URL,
  fullFace,
  faces,
  RANGE,
  CODEPOINTS,
  covers,
  BYTES: META.bytes,
  STRINGS: META.strings,
  fontFace,
  get CSS() { return fontFace(); },
};
