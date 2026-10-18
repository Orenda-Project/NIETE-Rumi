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
 *   - open text (a child's name, a class, an item title): never this family; it gets the full face by its class
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
  RANGE,
  BYTES: META.bytes,
  STRINGS: META.strings,
  fontFace,
  get CSS() { return fontFace(); },
};
