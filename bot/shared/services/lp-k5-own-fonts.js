'use strict';
/**
 * bd-snkn32.4 — the fonts a grades 1–5 Make my own page prints with, embedded as base64 @font-face (the
 * playwrite-reports skill's rule): the Railway Chromium has NO system fonts, so a page that links a web font or
 * leans on what is installed prints Urdu as tofu boxes. Lexend for Latin, Noto Nastaliq Urdu for an Urdu book.
 * Read once per process; a missing file is an empty face (the page still prints), never a throw.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'fonts');
const FILES = {
  lexend: 'Lexend-Regular.ttf', lexendBold: 'Lexend-Bold.ttf',
  nastaliq: 'NotoNastaliqUrdu-Regular.ttf', nastaliqBold: 'NotoNastaliqUrdu-Bold.ttf',
};
let cache = null;
function base64s() {
  if (cache) return cache;
  cache = {};
  for (const [k, f] of Object.entries(FILES)) {
    try { cache[k] = fs.readFileSync(path.join(DIR, f)).toString('base64'); } catch (_) { cache[k] = ''; }
  }
  return cache;
}

const face = (family, b64, weight) => (b64
  ? `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${b64}) format("truetype");font-weight:${weight};font-display:block}`
  : '');

/** The @font-face rules for this page's language, plus the body font that uses them. */
function fontCss(lang) {
  const b = base64s();
  const latin = face('Lexend', b.lexend, 400) + face('Lexend', b.lexendBold, 700)
    + ':root{--body:"Lexend",system-ui,sans-serif}';
  if (lang !== 'ur') return latin;
  return latin + face('Noto Nastaliq Urdu', b.nastaliq, 400) + face('Noto Nastaliq Urdu', b.nastaliqBold, 700);
}

module.exports = { fontCss, FILES };
