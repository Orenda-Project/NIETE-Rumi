'use strict';
/**
 * The board-pattern paper and its marking scheme.
 *
 * Only papers that carry `_layout` come here (the old renderer keeps every
 * other paper exactly as it was). Everything printed is decided by `_layout`,
 * the copy of the pattern made when the paper was generated: FDE's section
 * lines, its question lines with the counts recomputed from the questions
 * actually on the paper, its numbering, the student box, the teacher's
 * before-the-exam box and the legend.
 *
 * Three promises this file keeps:
 *   - No count is typed. Every count in a printed line is an atom in the
 *     pattern (`{w:eight}`, `{n:8}`, `{t:40}`) recomputed from the live items;
 *     the page total comes from Chromium's own footer, never the HTML.
 *   - No review text reaches paper. A string carrying a review mark or filler
 *     makes the render throw instead of print.
 *   - Urdu papers read right to left with Urdu digits, each number isolated so
 *     it keeps its own order, by one rule applied to every text node.
 *
 * Fonts are embedded (the printing Chromium has no system fonts) and the
 * footer repeats the page's @font-face rules exactly: a footer template font
 * loads only when the page declares the same face.
 *
 * Pure: strings in, strings out. `framePages` reads a finished PDF.
 */

const fs = require('fs');
const path = require('path');
const { clampLanguage } = require('../../config/ux-strings');
const Patterns = require('./patterns');
const { pictureBlock, bubbleBlock, PICTURE_CSS } = require('./fde-picture-block');
const { matchOrder, bankOrder, matchTable, matchAnswer, MATCH_CSS } = require('./fde-match-block');
const { oralSheet, ORAL_CSS } = require('./fde-oral-sheet');
const { answeredParts } = require('./fde-sub-answers');
const { letterOrder } = require('./fde-order-block');
const { urduNote } = require('./fde-urdu-notes');
const { frameBank } = require('./fde-frame-bank');
const { acceptText } = require('./fde-accept-line');
const Cover = require('./fde-scheme-cover');

// ── fonts ──────────────────────────────────────────────────────────────────

const FONT_FILES = {
  latin: 'Lexend-Regular.ttf',
  latinBold: 'Lexend-Bold.ttf',
  nastaliq: 'NotoNastaliqUrdu-Regular.ttf',
  nastaliqBold: 'NotoNastaliqUrdu-Bold.ttf',
};

/*
 * Noto Nastaliq Urdu's own ۰–۹ glyphs, reached through ASCII 0–9 (4 KB, OFL).
 * Chromium writes the footer's page number in ASCII; this face prints it as
 * Urdu digits. Made with fontTools from NotoNastaliqUrdu-Regular.ttf: subset to
 * U+06F0–06F9, then cmap 0x30+i → the glyph of U+06F0+i, family "FdeUrduDigits".
 */
const URDU_DIGITS_TTF = 'AAEAAAANAIAAAwBQR1BPU0R2THUAAA/oAAAAIEdTVUISdCKFAAAQCAAAADBPUy8yjWpnRgAAAVgAAABgY21hcA53AV4AAAHwAAAAZGdhc3AAAAAQAAAP4AAAAAhnbHlmo/WHFAAAAngAAAUuaGVhZCeF56cAAADcAAAANmhoZWEKywFSAAABFAAAACRobXR4G9MFNAAAAbgAAAA4bG9jYQ4iDM0AAAJUAAAAIm1heHAAFgBsAAABOAAAACBuYW1lwJznBQAAB6gAAAgYcG9zdP+fADIAAA/AAAAAIAABAAAAAwDFSN2utl8PPPUABwPoAAAAAN4ZH1kAAAAA5vaB/gAc//sDPQStAAAABgACAAAAAAAAAAEAAAdw/awAAAOEABwAFQM9AAEAAAAAAAAAAAAAAAAAAAAMAAEAAAAQADUAAgA1AAIAAQAAAAAAAAAAAAAAAAABAAEABAIsAZAABQAAAooCWAAAAEsCigJYAAABXgAyAUIAAAILBQIEBQQCAgQAACAAAAAAAAAAAAAAAAAAR09PRwFAADAG+Qdw/awAAAdwAlQAAAABAAAAAAIYAsoAAAAgAA8DhABHAjcA5QI3AHQCNwA/AjcAHAI3AGACNwA+AjcAUQI3AC4CNwAwAZkAaAI3AOUAdAA/ABwAYAAAAAIAAAADAAAAFAADAAEAAAAUAAQAUAAAAAYABAABAAIAOQb5//8AAAAwBvD//wAAAAAAAQAGABgAAAAKAAsADAANAAcABgAIAAkADgAPAAoACwAMAA0ABwAGAAgACQAOAA8AAAAUAEAAfgDNAQ8BUAGZAdwCFgJUAm8CdwJ/AocCjwKXAAAAAgBHAAADPQStAAMABwAAMxEhESUhESFHAvb9XgJO/bIErftTVAQFAAEA5f/+AUgCngAaAAAFJzY1NCYnJiYnJiYnNjY3NzMeAxUUDgIBGBQGBQQECQQDBQMEFBANCwUMCwcDChMCBCNVL1wrKkwfFSkVETMkHg5MZWwvP1xIQAABAHT//gHuAp4AJwAAFyc2NTQmJyYmJzY2NzY2NzMWFhcWFjMyNjcXDgIjIicWFhUUDgKvFQYTCwQGBAQMBwgPBAwFBgILPig8UxkWDC1XTCUWBAMDChMCBClPaKo/FCYTDiQSFCQKEh0THSE0TARQbzoHITIRRV1EPAAAAQA///4CIgKeADQAABcnNjU0JicmJic2NzczFhcWFhcWMzI2NxcGBgcWMzI2NjcXDgIjIicGIyIiJxYWFRQOAnkVBhEMBAYECA4bCwUDAwUCEDk0NBIWAwYFEDEZKiMNFgk7TSYrIiU+BgwGAgMDChMCBClPYa9BFCYTHiNFDhIKGxArOEgDHzASHBU3NAJgaikaIgERORREXkQ9AAABABwAAAILAp4AKgAAMy4CNT4DNzY2NzMWFhcWFhcOAgcjJiYnLgInIwYGBwYGBw4CBz0FEAwkMyciESInBxQNEQc8Wh8FFhkLCBQzGhQkGgYGBxQMDR8QFCUdBwooJAROclhOKlNaBxgwFKDiQRAwLhEpf0M2ZVIWEzYgJFAoM19HEAACAGD//wGrAp4AGgAoAAAFJyYmJwYjIiYmNTQ2NzY2MzIXFhYXFhYXBgYDMjY3NCYmIyIGBhUUFgF7DAoOBSdIIDwnIiAVNyA0HRoUAwIPCggZjhspEBwrFhgpGDcBAR6pjDQXNjAxbygaICYiglw2dkscQQFuCQc5PhccKRQkIQAAAgA+ABEB8gKZAB0AMAAANyImJjU0NjY3NCY1NDY2NxcWFhUUBgcGBiMiJicGJzI3FxYzMjY1NCYnJiYnBgYVFKwpMRQuTTABFR4NCVdqERQSNCUgJw0gLzonDRQ2ICBALA4eD0NSESY+JEmJhkECBAIIIycNAluuXCplKyYyDxEvfT0BMy4lM2kyECAPRpU4VgABAFH/+wILArkALQAAFyc2NDU0LgInJiY1ND4CMzIXMzY2NxcGBw4CByMuAyMiBxQWFxYWFRSWFAECBgsICwwUJzkmaCoHIUAfBxsWIy8hDw4EFSEuHTMCBwcLDAUCCAsHGisxRzZLXRAkTkMqkTVVHwVcMyY7NB8VQkEtMAkyKUF7PGsAAAEALv//Ab0ClwAlAAAFJy4DNTQ2NwYGIyImJyYmNTQ3NxYzMjY3FwYGFRQeAhcGBgGMCwcMCQQFBh1OHiJHGRoZEQk4dzJOFRUCAgEGDQwJGAEBGEdRTR1LdywUEgwLDBwXLDECPB4YBQs5Lj9aVGRIHEEAAQAwAA0B7AKCACUAACUiLgMnJz4DNzY2NxcHBgYHBgYHBgYHBgcVFhYXFhYXFwYBuBFOYmJNEQcEEylMPiFUMQgIAgcDHDYZKkEPHw4aYEVFVRABGg0IDg8OBQwYO1FyTytmOwI4ECALIEAdM1AUKB8EBQ4KCgsCDUAAAAEAaADEASQBhQAOAAA3JiYnNT4CNzMWFhUUB8EOLB8PKSMECSctWcQRKBgKFi0hAhkqGCVB//8A5f/+AUgCngIGAAEAAP//AHT//gHuAp4CBgACAAD//wA///4CIgKeAgYAAwAA//8AHAAAAgsCngIGAAQAAP//AGD//wGrAp4CBgAFAAAAAAAAAA8AugADAAEECQAAAGgAAAADAAEECQABABoAaAADAAEECQACAA4AggADAAEECQADAEYAkAADAAEECQAEABoAaAADAAEECQAFAKwA1gADAAEECQAGABoAaAADAAEECQAHAEQBggADAAEECQAIAEYBxgADAAEECQAJAPoCDAADAAEECQAKARQDBgADAAEECQALAD4EGgADAAEECQAMADwEWAADAAEECQANApYElAADAAEECQAOADQHKgBDAG8AcAB5AHIAaQBnAGgAdAAgADIAMAAxADcALQAyADAAMgAyACAARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAQQBsAGwAIABSAGkAZwBoAHQAcwAgAFIAZQBzAGUAcgB2AGUAZAAuAEYAZABlAFUAcgBkAHUARABpAGcAaQB0AHMAUgBlAGcAdQBsAGEAcgAzAC4AMAAwADIAOwBHAE8ATwBHADsATgBvAHQAbwBOAGEAcwB0AGEAbABpAHEAVQByAGQAdQAtAFIAZQBnAHUAbABhAHIAVgBlAHIAcwBpAG8AbgAgADMALgAwADAAMgA7ACAAdAB0AGYAYQB1AHQAbwBoAGkAbgB0ACAAKAB2ADEALgA4ACkAIAAtAGwAIAA4ACAALQByACAANQAwACAALQBHACAAMgAwADAAIAAtAHgAIAAxADQAIAAtAEQAIABhAHIAYQBiACAALQBmACAAbgBvAG4AZQAgAC0AYQAgAHEAcwBxACAALQBYACAAIgAiAE4AbwB0AG8AIABpAHMAIABhACAAdAByAGEAZABlAG0AYQByAGsAIABvAGYAIABHAG8AbwBnAGwAZQAgAEkAbgBjAC4ATQBvAG4AbwB0AHkAcABlACAASQBtAGEAZwBpAG4AZwAgAEkAbgBjAC4ALAAgAFMAaQBtAG8AbgAgAEMAbwB6AGUAbgBzAE0AbwBuAG8AdAB5AHAAZQAgAEQAZQBzAGkAZwBuACAAVABlAGEAbQAgACgAUABhAHQAcgBpAGMAawAgAEcAaQBhAHMAcwBvAG4AOgAgAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAsACAASwBhAG0AYQBsACAATQBhAG4AcwBvAHUAcgA6ACAATwBwAGUAbgBUAHkAcABlACAAYwBvAGQAZQAsACAARwBsAGUAbgBkAGEAIABCAGUAbABsAGEAcgBvAHMAYQApAC4AIABVAHAAZABhAHQAZQBkACAAYgB5ACAAUwBpAG0AbwBuACAAQwBvAHoAZQBuAHMALgBEAGUAcwBpAGcAbgBlAGQAIABiAHkAIABNAG8AbgBvAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAgAHQAZQBhAG0AIAAgACgAUABhAHQAcgBpAGMAawAgAEcAaQBhAHMAcwBvAG4AOgAgAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAsACAASwBhAG0AYQBsACAATQBhAG4AcwBvAHUAcgA6ACAATwBwAGUAbgBUAHkAcABlACAAYwBvAGQAZQAsACAARwBsAGUAbgBkAGEAIABCAGUAbABsAGEAcgBvAHMAYQApAC4AIABVAHAAZABhAHQAZQBkACAAYgB5ACAAUwBpAG0AbwBuACAAQwBvAHoAZQBuAHMALgBoAHQAdABwADoALwAvAHcAdwB3AC4AZwBvAG8AZwBsAGUALgBjAG8AbQAvAGcAZQB0AC8AbgBvAHQAbwAvAGgAdAB0AHAAOgAvAC8AdwB3AHcALgBtAG8AbgBvAHQAeQBwAGUALgBjAG8AbQAvAHMAdAB1AGQAaQBvAFQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlACAAaQBzACAAbABpAGMAZQBuAHMAZQBkACAAdQBuAGQAZQByACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAsACAAVgBlAHIAcwBpAG8AbgAgADEALgAxAC4AIABUAGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAgAGkAcwAgAGQAaQBzAHQAcgBpAGIAdQB0AGUAZAAgAG8AbgAgAGEAbgAgACIAQQBTACAASQBTACIAIABCAEEAUwBJAFMALAAgAFcASQBUAEgATwBVAFQAIABXAEEAUgBSAEEATgBUAEkARQBTACAATwBSACAAQwBPAE4ARABJAFQASQBPAE4AUwAgAE8ARgAgAEEATgBZACAASwBJAE4ARAAsACAAZQBpAHQAaABlAHIAIABlAHgAcAByAGUAcwBzACAAbwByACAAaQBtAHAAbABpAGUAZAAuACAAUwBlAGUAIAB0AGgAZQAgAFMASQBMACAATwBwAGUAbgAgAEYAbwBuAHQAIABMAGkAYwBlAG4AcwBlACAAZgBvAHIAIAB0AGgAZQAgAHMAcABlAGMAaQBmAGkAYwAgAGwAYQBuAGcAdQBhAGcAZQAsACAAcABlAHIAbQBpAHMAcwBpAG8AbgBzACAAYQBuAGQAIABsAGkAbQBpAHQAYQB0AGkAbwBuAHMAIABnAG8AdgBlAHIAbgBpAG4AZwAgAHkAbwB1AHIAIAB1AHMAZQAgAG8AZgAgAHQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlAC4AaAB0AHQAcAA6AC8ALwBzAGMAcgBpAHAAdABzAC4AcwBpAGwALgBvAHIAZwAvAE8ARgBMAAMAAAAAAAD/nAAyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAB//8ADwABAAAACgAcAB4AAURGTFQACAAEAAAAAP//AAAAAAAAAAEAAAAKACwALgADREZMVAAUYXJhYgAebGF0bgAeAAQAAAAA//8AAAAAAAAAAAAA';

let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  _fonts = {};
  for (const [key, file] of Object.entries(FONT_FILES)) {
    const abs = path.join(__dirname, '..', '..', 'fonts', file);
    try {
      _fonts[key] = fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
    } catch {
      _fonts[key] = '';
    }
  }
  return _fonts;
}

function face(family, weight, data) {
  return data
    ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${data}) format('truetype');}`
    : '';
}

// The page and its footer use these same strings, byte for byte.
function faces(medium) {
  const f = fonts();
  const list = [face('PaperLatin', 400, f.latin), face('PaperLatin', 700, f.latinBold)];
  if (medium === 'ur') {
    list.push(face('PaperUrdu', 400, f.nastaliq), face('PaperUrdu', 700, f.nastaliqBold),
      face('FdeUrduDigits', 400, URDU_DIGITS_TTF));
  }
  return list.filter(Boolean);
}

// ── text ───────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toUrduDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
}

// A number with its own punctuation (3,462,105 · 2.5 · 4/5 · 8×5=40) kept as one atom.
const NUMERIC_ATOM = /[0-9][0-9,.:/×x=+\-−–⁄]*[0-9]|[0-9]/g;

// Lexend and Noto Nastaliq have no glyph for these, and the printing container
// has no other font: each is drawn instead (16-unit box, stroke in the text colour).
const SYMBOL_PATHS = {
  '→': 'M1 8h12M9 4l4 4-4 4',
  '←': 'M15 8H3M7 4L3 8l4 4',
  '↑': 'M8 15V3M4 7l4-4 4 4',
  '↓': 'M8 1v12M4 9l4 4 4-4',
  '↔': 'M1 8h14M5 4L1 8l4 4M11 4l4 4-4 4',
  '✓': 'M2 8.5l4 4L14 3.5',
  '✔': 'M2 8.5l4 4L14 3.5',
  '✗': 'M3 3l10 10M13 3L3 13',
  '✘': 'M3 3l10 10M13 3L3 13',
  '≤': 'M12 2L4 6l8 4M4 13h8',
  '≥': 'M4 2l8 4-8 4M4 13h8',
  '≠': 'M3 6h10M3 10h10M11 2L5 14',
  '≈': 'M2 6c2-2 4-2 6 0s4 2 6 0M2 11c2-2 4-2 6 0s4 2 6 0',
  '∠': 'M13 13H2L11 3',
  '√': 'M1 9l2-1 3 6L10 2h5',
  '∞': 'M8 8c-2-3-6-3-6 0s4 3 6 0 6-3 6 0-4 3-6 0',
  'π': 'M2 4h12M6 4v9M11 4v7c0 1 1 2 2 1',
  '∴': 'M8 3.5h.01M3.5 12.5h.01M12.5 12.5h.01',
};
const SYMBOLS = new RegExp(`[${Object.keys(SYMBOL_PATHS).join('')}]`, 'g');

function drawSymbols(html) {
  return html.replace(SYMBOLS, (ch) => {
    const dots = ch === '∴';
    return `<svg class="sym" viewBox="0 0 16 16" role="img" aria-label="${ch}"><path d="${SYMBOL_PATHS[ch]}" fill="none" stroke="currentColor" stroke-width="${dots ? 3 : 1.6}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  });
}

const VULGAR = { '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5],
  '⅘': [4, 5], '⅙': [1, 6], '⅚': [5, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8] };
const VULGAR_RE = new RegExp(`[${Object.keys(VULGAR).join('')}]`, 'g');

/**
 * One text node, escaped. Fractions are typeset (maths, and any vulgar
 * fraction anywhere); an Urdu-medium paper turns every number into an
 * isolated run of Urdu digits; symbols no embedded font has are drawn last,
 * so the digit rule never touches a drawing.
 */
function textOf(value, ctx) {
  let out = esc(value);
  out = out.replace(VULGAR_RE, (ch) => `<span class="frac"><sup>${VULGAR[ch][0]}</sup><sub>${VULGAR[ch][1]}</sub></span>`);
  if (ctx.maths) out = typesetFractions(out);
  if (ctx.medium === 'ur') {
    out = out.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, text) => (tag ? tag : urduText(text)));
  }
  return drawSymbols(out).replace(/\n/g, '<br>');
}

/*
 * A Latin-script token that carries digits (K-2, COVID-19, A4, 3D) is one word
 * in another script: it keeps its Western digits and prints as a left-to-right
 * isolate. Converting its digits alone printed «K-2» as «۲-K». A digit run
 * between letters and a multiplication x (8x5) is a number, not a token.
 */
const LATIN_DIGIT_TOKEN = /(?<![0-9A-Za-z])(?:[A-Za-z]+(?:[-–]?[0-9]+)+[A-Za-z]*|[0-9]+[-–]?[A-Za-z]+)(?![0-9A-Za-z])/g;

// A number glued to a unit (5kg, 10cm) is a number: Urdu digits, the unit isolated after it.
const GLUED_UNIT = /^([0-9]+)(kg|g|mg|km|m|cm|mm|L|l|mL|ml|s|min|h|hr|hrs)$/;

function urduText(text) {
  const run = (t) => urduSeparators(t).replace(NUMERIC_ATOM, (n) => `<span class="num">${pinSeparators(toUrduDigits(n))}</span>`);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(LATIN_DIGIT_TOKEN)) {
    const unit = GLUED_UNIT.exec(m[0]);
    out += unit
      ? `${run(text.slice(last, m.index) + unit[1])}<bdi class="ltr" dir="ltr">${unit[2]}</bdi>`
      : `${run(text.slice(last, m.index))}<bdi class="ltr" dir="ltr">${m[0]}</bdi>`;
    last = m.index + m[0].length;
  }
  return out + run(text.slice(last));
}

// A · beside an Urdu digit reads as ۰ (the Urdu zero is a dot): there it becomes an Urdu comma.
function urduSeparators(text) {
  return text.replace(/\s*·\s*(?=[0-9])/g, '، ').replace(/([0-9])\s*·\s*/g, '$1، ');
}

// Urdu digits are bidi class AN, so even inside an LTR isolate a dash, slash or
// sign between two of them resolves right-to-left («2026–27» printed «27–2026»).
// An LRM each side pins it; the decimal point and the thousands comma need none.
function pinSeparators(atom) {
  return atom.replace(/[^\u06F0-\u06F9.,]/g, (c) => `\u200E${c}\u200E`);
}

// "8 2/5" → 8 + a stacked 2⁄5; "3/4" alone → a stacked fraction. Escaped input.
function typesetFractions(html) {
  return html
    .replace(/⁄/g, '/')
    .replace(/(^|[^\d/])(\d+) (\d+)\/(\d+)(?![\d/])/g, '$1$2<span class="frac"><sup>$3</sup><sub>$4</sub></span>')
    .replace(/(^|[^\d/>])(\d+)\/(\d+)(?![\d/])/g, '$1<span class="frac"><sup>$2</sup><sub>$3</sub></span>');
}

// ── refusals ───────────────────────────────────────────────────────────────

/*
 * Two lists. Our own chrome (the `_layout` block: header, notes, legend, the
 * before-the-exam box) is refused for every marker. The model's item text is
 * refused only for the English review markers: «اسی طرح» and «مسودہ» are
 * ordinary Urdu words a real instruction or distractor uses.
 */
const REFUSED_ITEM = [/needs review/i, /\bfiller\b/i, /⚠/, /Islamabad Model School/i, /MODEL PAPER FOR/i];
const REFUSED_CHROME = [...REFUSED_ITEM, /مسودہ/, /اسی طرح/];

function refuseIn(node, where, list, name) {
  if (typeof node === 'string') {
    for (const re of list) {
      if (re.test(node)) {
        const err = new Error(`REVIEW_TEXT[${name}]: the ${where} carries text that must never print (${re})`);
        err.code = 'REVIEW_TEXT';
        err.list = name;
        err.where = where;
        throw err;
      }
    }
  } else if (Array.isArray(node)) {
    node.forEach((n) => refuseIn(n, where, list, name));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((n) => refuseIn(n, where, list, name));
  }
}

function refuseReviewText(examJson, where = 'paper') {
  if (!examJson || typeof examJson !== 'object') return refuseIn(examJson, where, REFUSED_CHROME, 'chrome');
  const { _layout: layout, ...items } = examJson;
  // `_layout.reader` is the reader's record (model text quoting the paper); it never prints.
  const { reader, ...chrome } = layout || {};
  refuseIn(layout ? chrome : layout, where, REFUSED_CHROME, 'chrome');
  refuseIn(items, where, REFUSED_ITEM, 'item');
}

// ── counts ─────────────────────────────────────────────────────────────────

const WORDS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
// needs fluent-Urdu review
const WORDS_UR = ['صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس',
  'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس'];

function numberWord(n, lang, like) {
  const list = lang === 'ur' ? WORDS_UR : WORDS_EN;
  const word = list[n] !== undefined ? list[n] : String(n);
  if (lang !== 'ur' && like && like === like.toUpperCase() && /[A-Z]/.test(like)) return word.toUpperCase();
  return word;
}

const ATOM = /\{([wntg]):([^}]*)\}/g;

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Every `{k:v}` atom replaced from ctx = { w, n, t, g } (numbers). */
function substitute(str, ctx, lang) {
  if (str === null || str === undefined) return null;
  return String(str).replace(ATOM, (m, k, v) => {
    if (k === 'w') return numberWord(ctx.w, lang, v);
    if (k === 'n') return fmt(ctx.n);
    if (k === 't') return fmt(ctx.t);
    if (k === 'g') return fmt(ctx.g);
    return v;
  });
}

const slotTotal = (slot, present) => Math.min(slot.attempt, present) * slot.marks_each;

/**
 * A slot's instruction and marks line for `present` items on the paper.
 * Unremoved, it is FDE's line exactly; after a removal only the count atoms
 * change, and a choice that still exists says how many it is now out of.
 */
function choiceLine(slot, present, lang, items) {
  const live = Math.min(slot.attempt, present);
  const ctx = { w: live, n: live, t: live * slot.marks_each, g: present };
  const raw = slot[`instruction_${lang}`];
  let instruction = substitute(raw, ctx, lang);
  if (instruction && present < slot.generate && live < present && /\{w:/.test(raw)) {
    instruction = addOutOf(raw, ctx, lang, present);
  }
  // "the poem “{q}”": a one-item slot names its item, on the paper and in the scheme alike.
  if (instruction && /\{q\}/.test(raw) && Array.isArray(items) && items.length === 1) {
    instruction = instruction.replace('{q}', String(items[0].question || '').trim());
  }
  const marksLine = substitute(slot[`marks_line_${lang}`], ctx, lang);
  const text = [instruction, marksLine].filter(Boolean).join(' ');
  return { instruction, marksLine, text };
}

// "any eight" → "any eight of the following eleven"; Urdu adds «(دیے گئے ۱۱ میں سے)».
function addOutOf(raw, ctx, lang, present) {
  if (lang === 'ur') {
    return substitute(raw.replace(/(\{w:[^}]*\})/, `$1 (دیے گئے ${present} میں سے)`), ctx, lang); // needs fluent-Urdu review
  }
  const word = numberWord(present, 'en');
  if (/of the following/.test(raw)) return substitute(raw.replace('of the following', `of the following ${word}`), ctx, lang);
  return substitute(raw.replace(/(\{w:[^}]*\})/, `$1 of the following ${word}`), ctx, lang);
}

// ── the paper's items, grouped by slot ─────────────────────────────────────

function layoutOf(examJson) {
  const L = examJson && examJson._layout;
  if (!L || typeof L !== 'object' || !Array.isArray(L.sections)) {
    const err = new Error('NO_LAYOUT: this renderer only prints board-pattern papers');
    err.code = 'NO_LAYOUT';
    throw err;
  }
  return L;
}

/** slot id → every item in tree order (removed ones flagged), and the live ones. */
function itemsBySlot(examJson, L) {
  const all = new Map();
  for (const sec of L.sections) for (const slot of sec.slots) all.set(slot.slot, []);
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (q && typeof q === 'object' && all.has(q.slot)) all.get(q.slot).push(q);
        });
      }
    }
  }
  const live = new Map();
  for (const [id, list] of all) live.set(id, list.filter((q) => q.removed !== true));
  return { all, live };
}

function assertCounts(L, all, opts) {
  if (opts && opts.allowShort) return;
  for (const sec of L.sections) {
    for (const slot of sec.slots) {
      if (all.get(slot.slot).length < slot.attempt) {
        const err = new Error(`PATTERN_SHORT_SLOT: ${slot.slot} holds ${all.get(slot.slot).length} of the ${slot.attempt} it must answer`);
        err.code = 'PATTERN_SHORT_SLOT';
        throw err;
      }
    }
  }
}

function sectionTotal(sec, live) {
  return sec.slots.reduce((sum, slot) => sum + slotTotal(slot, live.get(slot.slot).length), 0);
}

/** The paper's total: the pattern's, recomputed only when a removal took a slot below its count. */
function totalMarks(examJson) {
  const L = layoutOf(examJson);
  const { live } = itemsBySlot(examJson, L);
  const short = L.sections.some((sec) => sec.slots.some((slot) => live.get(slot.slot).length < slot.attempt));
  if (!short) return L.total_marks;
  return L.sections.reduce((sum, sec) => sum + sectionTotal(sec, live), 0);
}

function sectionCtx(sec, live) {
  const n = sec.slots.reduce((s, slot) => s + Math.min(slot.attempt, live.get(slot.slot).length), 0);
  const noteSlot = sec.note_slot ? sec.slots.find((s) => s.slot === sec.note_slot) : null;
  const w = noteSlot ? Math.min(noteSlot.attempt, live.get(noteSlot.slot).length) : n;
  return { w, n, t: sectionTotal(sec, live), g: n };
}

// ── numbering ──────────────────────────────────────────────────────────────

function roman(n) {
  const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let left = n;
  for (const [v, s] of map) while (left >= v) { out += s; left -= v; }
  return out;
}

const URDU_LETTERS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و'];

function itemNumber(slot, i, lang) {
  const k = i + 1;
  const style = slot.numbering || 'none';
  const cont = /^continue:(\d+)$/.exec(style);
  if (cont) return lang === 'ur' ? `سوال نمبر ${Number(cont[1]) + i}` : `Q${Number(cont[1]) + i}.`;
  switch (style) {
    case 'roman': return `${roman(k)})`;
    case 'roman_dot': return `${roman(k)}.`;
    case 'arabic': return `${k}.`;
    case 'urdu': return `${k}۔`;
    case 'paren_roman': return `(${roman(k)})`;
    case 'alpha_paren': return lang === 'ur' ? `(${URDU_LETTERS[i] || k})` : `(${String.fromCharCode(97 + i)})`;
    default: return '';
  }
}

function optionLabel(style, i) {
  if (style === 'A') return `${String.fromCharCode(65 + i)})`;
  if (style === 'ur') return `(${URDU_LETTERS[i]})`;
  if (style === 'ur_paren') return `${URDU_LETTERS[i]})`;
  return `(${String.fromCharCode(97 + i)})`;
}

// A model sometimes writes its own "a) " / "(b)" / «الف)» in front of an option.
function bareOption(text) {
  return String(text ?? '')
    .replace(/^\s*\(?[a-dA-D]\)?[.):]\s+/, '')
    .replace(/^\s*\(?(الف|ب|ج|د)\)?\s*[.):۔]\s*/, '')
    .trim();
}

const codePoints = (s) => [...String(s || '')].length;

// ── paper blocks ───────────────────────────────────────────────────────────

function optionsBlock(q, slot, ctx) {
  const opts = (q.options || []).map(bareOption);
  const long = opts.some((o) => codePoints(o) > 14);
  const cells = opts.map((o, i) => `<span class="opt"><span class="ol">${esc(optionLabel(slot.option_labels, i))}</span> ${textOf(o, ctx)}</span>`);
  return `<div class="opts ${long ? 'two' : 'four'}">${cells.join('')}</div>`;
}

function tableBlock(table, ctx) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return '';
  const head = `<tr>${table.headers.map((h) => `<th>${textOf(h, ctx)}</th>`).join('')}</tr>`;
  const rows = table.rows.map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${textOf(c, ctx)}</td>`).join('')}</tr>`).join('');
  return `<table class="data">${head}${rows}</table>`;
}

function workSpace(q, slot) {
  if (slot.work_mm && /^\s*draw\b/i.test(String(q.question || ''))) {
    return `<div class="work-square" style="width:${slot.work_mm}mm;height:${slot.work_mm}mm"></div>`;
  }
  // A Grade 1-2 child writes in a box under every written item (bd-5jmnfj.4.8); circling needs none.
  if (slotFlag(slot, 'answer_box')) {
    if (Array.isArray(q.options) && q.options.length) return '';
    // "34 ☐ 43": the child writes the sign in the drawn square (bd-5jmnfj.4.20).
    if (/☐/.test(String(q.question || ''))) return '';
    // A plant to label carries its own blank lines (bd-5jmnfj.4.33).
    if (q.picture && q.picture.kind === 'plant') return '';
    // Fill in the blank: the child writes on the ___ (bd-5jmnfj.4.39).
    if (/_{3,}/.test(String(q.question || ''))) return '';
    // A sentence under a picture gets two lines (bd-5jmnfj.4.57).
    const lines = slotFlag(slot, 'sentence_box') ? 2 : (slot.lines || 1);
    return `<div class="write-box" style="height:${12 + 8 * Math.max(0, lines - 1)}mm"></div>`;
  }
  if ((slot.lines || 0) >= 2) {
    const h = Math.max(16, slot.lines * 8);
    return `<div class="work-box" style="height:${h}mm"></div>`;
  }
  return '';
}

function wordList(words, ctx, boxed) {
  if (!Array.isArray(words) || !words.length) return '';
  const sep = ctx.medium === 'ur' ? ' – ' : ',  ';
  return `<div class="${boxed ? 'word-box' : 'word-line'}">${words.map((w) => textOf(w, ctx)).join(esc(sep))}</div>`;
}

/*
 * Whether a slot's `words` are printed for the child (a word list to work
 * from) or are the key. The layout copies `print_words` from the pattern; a
 * paper laid out before the flag existed takes it from the pattern by slot id.
 * Default: never print.
 */
function patternSlot(id) {
  for (const pid of Patterns.list()) {
    for (const S of Object.values(Patterns.get(pid).subjects)) {
      for (const sec of S.sections) {
        const found = sec.slots.find((s) => s.slot === id);
        if (found) return found;
      }
    }
  }
  return null;
}

/** A slot's own boolean flag, else its pattern's: a paper laid out before the flag still prints right. */
function slotFlag(slot, name) {
  if (typeof slot[name] === 'boolean') return slot[name];
  const p = patternSlot(slot.slot);
  return Boolean(p && p[name] === true);
}

function printsWords(slot) {
  return slotFlag(slot, 'print_words');
}

/*
 * The same opt-in for `topics`: printed only on a slot whose pattern names it
 * as a field in its prompt rule (English Q8). A `table` or `passage` always
 * prints: any data item may carry one, and an item without its data cannot be
 * answered.
 */
function printsField(slot, key) {
  const rule = typeof slot.prompt_rule === 'string' ? slot.prompt_rule : ((patternSlot(slot.slot) || {}).prompt_rule || '');
  return rule.includes(`\`${key}\``) && !rule.includes(`no \`${key}\``);
}

// `pic`: a drawn picture (G5 Urdu Q7, English Q10) prints inside the frame, in place of its "teacher adds" title.
function frameBlock(q, slot, ctx, pic) {
  const lang = ctx.medium;
  const title = String(slot.frame[`title_${lang}`] || '').replace('{q}', String(q.question || '').trim());
  const lines = Array.from({ length: slot.frame.lines || 0 }, (_, i) => `<div class="label-line"><span class="num-l">${textOf(String(i + 1), ctx)}.</span></div>`).join('');
  const id = `fde-frame-${slot.slot}`;
  // A frame that prints no `words` still prints the item's own instruction and bank (bd-5jmnfj.4.50.4).
  const own = slot.frame.word_bank ? { line: '', words: q.words } : frameBank(q, slot[`instruction_${lang}`]);
  const lead = own.line ? `<div class="frame-ins">${textOf(own.line, ctx)}</div>` : '';
  const bank = wordList(own.words, ctx, true);
  return `${lead}${bank}<div class="frame" id="${esc(id)}" style="height:${slot.frame.height_mm}mm">`
    + `<a class="frame-anchor" href="#${esc(id)}"></a>`
    + (pic || `<div class="frame-title">${textOf(title, ctx)}</div>`)
    + (lines ? `<div class="label-lines">${lines}</div>` : '')
    + '</div>';
}

// A model sometimes letters or numbers a sub-question itself («a) Why…», «(ب) …», «1. Finally…»);
// the renderer letters it. A numeral counts only when a space follows, so «3.5 kg» stays.
function bareSub(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/^\s*\(?[a-cA-C]\)\s*/, '').replace(/^\s*\(?(الف|ب|ج)\)\s*/, '')
    .replace(/^\s*\(?[0-9۰-۹]{1,2}[.)۔]\s+/, '');
}

// A Latin roman label (iv) in an Urdu paper is isolated LTR, or its ')' mirrors to '(iv' (v25 item 2).
function labelHtml(num, ctx) {
  return ctx.medium === 'ur' && typeof num === 'string' && /[A-Za-z]/.test(num) ? `<bdi class="ltr" dir="ltr">${esc(num)}</bdi>` : textOf(num, ctx);
}

function subQuestions(list, numbering, ctx, slotLike, space) {
  if (!Array.isArray(list)) return '';
  return list.map((sub, i) => {
    const text = bareSub(typeof sub === 'string' ? sub : sub && sub.question);
    const num = itemNumber({ numbering }, i, ctx.medium) || `${String.fromCharCode(97 + i)})`;
    const opts = sub && Array.isArray(sub.options) && sub.options.length ? optionsBlock(sub, slotLike || {}, ctx) : '';
    // Its own writing space, sized by its own lines (bd-5jmnfj.4.51.8).
    const box = space && !opts ? `<div class="write-box" style="height:${12 + 8 * Math.max(0, ((sub && sub.lines) || 1) - 1)}mm"></div>` : '';
    return `<div class="sub"><span class="n">${labelHtml(num, ctx)}</span> ${textOf(text, ctx)}${opts}</div>${box}`;
  }).join('');
}

function comprehensionBlock(q, slot, ctx) {
  const lang = ctx.medium;
  const out = [`<div class="passage">${textOf(q.passage, ctx)}</div>`];
  const parts = Array.isArray(q.parts) ? q.parts : [];
  for (const spec of slot.parts_spec || []) {
    const part = parts.find((p) => p && p.key === spec.key) || {};
    // FDE groups some sub-parts under one lettered header (Urdu p.57 «ب: …»); the
    // sub-parts under it then print their own line and marks, without the letter.
    const g = spec.group_head;
    const groupHead = g ? `<div class="part-head"><span class="lab">${textOf(g.label, ctx)}</span> <span class="ins">${textOf(g[`instruction_${lang}`], ctx)}</span><span class="ml">${textOf(g[`marks_line_${lang}`], ctx)}</span></div>` : '';
    const lab = g ? '' : `<span class="lab">${textOf(spec.label, ctx)}</span> `;
    const head = `<div class="part-head">${lab}<span class="ins">${textOf(spec[`instruction_${lang}`], ctx)}</span><span class="ml">${textOf(spec[`marks_line_${lang}`], ctx)}</span></div>`;
    let body = '';
    if (spec.pick) {
      body = Object.entries(spec.pick).map(([kind, n]) => `<div class="pick-row"><span class="pick-k">${textOf(kind, ctx)}:</span>${Array.from({ length: n }, (_, i) => `<span class="blank">${textOf(String(i + 1), ctx)}</span>`).join('')}</div>`).join('');
    } else if (spec.key === 'antonyms') {
      body = (part.antonyms || []).map((pair) => `<span class="ant">${textOf(Array.isArray(pair) ? pair[0] : pair, ctx)} <span class="blank"></span></span>`).join('');
      body = `<div class="ant-row">${body}</div>`;
    } else {
      body = subQuestions(part.questions, spec.numbering || 'urdu', ctx, slot);
    }
    out.push(`<div class="part">${groupHead}${head}${body}</div>`);
  }
  return out.join('');
}

function situationBlock(q, slot, i, ctx) {
  const lang = ctx.medium;
  const ip = slot.item_parts || {};
  const head = `<div class="sit"><span class="n">${textOf(itemNumber(slot, i, lang), ctx)}</span> <b>Situation:</b> ${textOf(q.question, ctx)}</div>`;
  const lead = ip[`line_${lang}`] ? `<div class="part-head"><span class="ins">${textOf(ip[`line_${lang}`], ctx)}</span><span class="ml">${textOf(ip[`marks_line_${lang}`] || '', ctx)}</span></div>` : '';
  return head + lead + subQuestions(q.questions, 'alpha_paren', ctx).replace(/\((a|b|c)\)/g, '$1)');
}

/** The body of one item (its number and stem are added by the caller where they apply). */
function itemBody(q, slot, i, ctx, inlineQ) {
  const shape = slot.shape;
  // A Grade 1-2 picture (bd-5jmnfj.4.3) prints above the body, whatever its shape.
  const pic = pictureBlock(q);
  if (pic && slotFlag(slot, 'bubble')) return bubbleBlock(pic);
  if (shape === 'mcq') return pic + optionsBlock(q, slot, ctx);
  if (shape === 'frame') return frameBlock(q, slot, ctx, pic);
  if (shape === 'comprehension') return pic + comprehensionBlock(q, slot, ctx);
  const parts = pic ? [pic] : [];
  if (Array.isArray(q.options) && q.options.length) parts.push(optionsBlock(q, slot, ctx));
  if (q.table) parts.push(tableBlock(q.table, ctx));
  if (q.passage && shape !== 'comprehension') parts.push(`<div class="${shape === 'words' || shape === 'fixed' ? 'verse' : 'passage'}">${textOf(q.passage, ctx)}</div>`);
  if (Array.isArray(q.topics) && q.topics.length && printsField(slot, 'topics')) {
    parts.push(`<div class="topics">${q.topics.map((t, k) => `<span class="topic">${textOf(itemNumber({ numbering: 'alpha_paren' }, k, ctx.medium), ctx)} ${textOf(t, ctx)}</span>`).join('')}</div>`);
  }
  if (printsWords(slot) && !slotFlag(slot, 'answer_box') && Array.isArray(q.words) && q.words.length) parts.push(wordList(q.words, ctx, ctx.medium !== 'ur'));
  // A written answer under each sub-question of an answer-box slot (G2 reading): one box each, none after the set.
  const eachBox = ctx.answerLines !== false && slotFlag(slot, 'answer_box') && Array.isArray(q.questions) && q.questions.length > 0;
  if (Array.isArray(q.questions) && q.questions.length) parts.push(subQuestions(q.questions, slot.sub_numbering || 'alpha_paren', ctx, undefined, eachBox));
  if (ctx.answerLines !== false && !eachBox) parts.push(workSpace(q, slot));
  return parts.join('');
}

// A slot that letters its items (a), (b) prints the letter itself, so a letter the model wrote
// at the head of the item would print twice: «(a) (a) Write an application…». The stored item
// keeps its text; only the print drops it.
const OWN_LABEL = /^\(?[a-d]\)\s*/;
function withoutOwnLabel(text, slot) {
  return slot.numbering === 'alpha_paren' && typeof text === 'string' ? text.replace(OWN_LABEL, '') : text;
}

function stemOf(q, slot, inlineQ) {
  if (inlineQ) return '';
  // A picture-naming item is the picture and a box: the instruction above already asks (bd-5jmnfj.4.19).
  if (slotFlag(slot, 'picture_only')) return '';
  if (slot.shape === 'frame' || slot.shape === 'comprehension') return '';
  if (slot.shape === 'words' && !q.question) return '';
  return withoutOwnLabel(q.question || '', slot);
}

function slotBlock(slot, sec, list, ctx) {
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  const line = choiceLine(slot, live.length, lang, live);
  const inlineQ = /\{q\}/.test(slot[`instruction_${lang}`] || '') && live.length === 1;
  const instruction = line.instruction;
  const cont = /^continue:/.test(slot.numbering || '');
  const label = cont ? '' : slot[`label_${lang}`];
  const head = (label || instruction || line.marksLine)
    ? `<div class="slot-head">${label ? `<span class="lab">${textOf(label, ctx)}</span> ` : ''}${instruction ? `<span class="ins">${textOf(instruction, ctx)}</span>` : ''}${line.marksLine ? `<span class="ml">${textOf(line.marksLine, ctx)}</span>` : ''}</div>`
    : '';
  if (slot.shape === 'match') {
    // Two columns for the child to join with a line; Column B never follows the stems (bd-5jmnfj.4.23).
    const stems = live.map((q, i) => `<span class="n">${labelHtml(itemNumber(slot, i, lang), ctx)}</span> ${textOf(stemOf(q, slot, false), ctx)}`);
    const column = matchOrder(live.map(matchAnswer)).map((a) => textOf(a, ctx));
    return `<div class="slot">${head}<div class="q" data-slot="${esc(slot.slot)}">${matchTable(stems, column)}</div></div>`;
  }
  const body = [];
  const grid = slotFlag(slot, 'picture_only');
  const or = lang === 'ur' ? 'یا' : 'OR';
  live.forEach((q, i) => {
    if (slot.or && i > 0) body.push(`<div class="or">${textOf(or, ctx)}</div>`);
    const lead = Array.isArray(slot[`or_parts_${lang}`]) ? slot[`or_parts_${lang}`][list.indexOf(q)] : null;
    if (slot.shape === 'situation') {
      body.push(`<div class="q" data-slot="${esc(slot.slot)}">${situationBlock(q, slot, i, ctx)}</div>`);
      return;
    }
    if (slot.alternatives) {
      body.push(fixedAlternatives(slot, q, ctx));
      return;
    }
    const num = itemNumber(slot, i, lang);
    const stem = stemOf(q, slot, inlineQ);
    const numHtml = num ? `<span class="n">${labelHtml(num, ctx)}</span>` : '';
    const leadHtml = lead ? `<div class="or-lead">${textOf(lead, ctx)}</div>` : '';
    const stemHtml = stem ? ` ${textOf(stem, ctx).replace(/☐/g, '<span class="sq"></span>')}` : '';
    body.push(`<div class="q${cont ? ' qcont' : ''}${slot.shape === 'comprehension' ? ' comp' : ''}${grid ? ` pic-cell${slotFlag(slot, 'sentence_box') ? ' wide' : ''}` : ''}" data-slot="${esc(slot.slot)}">${numHtml}${leadHtml}${stemHtml}${itemBody(q, slot, i, ctx, inlineQ)}</div>`);
  });
  if (slot.alternatives && !live.length) body.push(fixedAlternatives(slot, null, ctx));
  // An either/or question is read as one choice: never split across a page.
  const either = slot.or || slot.alternatives ? ' either' : '';
  // A Grade 1-2 slot prints its words once, boxed, above its items (bd-5jmnfj.4.20). The bank is
  // dealt so no word sits at its own item: a model lists them as it wrote them (bd-5jmnfj.4.50.9).
  const words = bankOrder([...new Set(live.flatMap((q) => (Array.isArray(q.words) ? q.words : [])))], live.map(matchAnswer));
  const bank = printsWords(slot) && slotFlag(slot, 'answer_box') && words.length
    ? `<div class="word-box bank">${words.map((w) => `<span class="w">${textOf(w, ctx)}</span>`).join('')}</div>` : '';
  if (grid) return `<div class="slot${either}">${head}${bank}<div class="pic-grid">${body.join('')}</div></div>`;
  return `<div class="slot${either}">${head}${bank}${body.join('')}</div>`;
}

// Verses given from a lesson the paper does not cover name it under them, as English Q5 names its
// unit. A page range is written «۶۳ تا ۶۴»: a hyphen after an Urdu word prints the range reversed.
function verseSource(ctx) {
  const src = ctx.verseSource;
  if (!src || !src.lesson) return '';
  const pages = String(src.pages || '').split('-').map((n) => n.trim()).filter(Boolean);
  const line = ctx.medium === 'ur'
    ? `(سبق ${src.lesson}، ص ${pages.join(' تا ')})` // needs fluent-Urdu review
    : `(Lesson ${src.lesson}, ${pages.length > 1 ? 'pp.' : 'p.'} ${pages.join('–')})`;
  return `<div class="verse verse-src">${textOf(line, ctx)}</div>`;
}

// Urdu Q6: the lesson-7 lines, after a fixed instruction-only alternative when the pattern has one.
function fixedAlternatives(slot, q, ctx) {
  const lang = ctx.medium;
  const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
  const seen = slot.alternatives.find((a) => a.kind === 'seen_verses');
  const out = [];
  if (fixed) out.push(`<div class="alt">${textOf(fixed[`instruction_${lang}`] || fixed.instruction_ur, ctx)}</div>`);
  if (q && seen) {
    if (fixed) out.push(`<div class="or">${textOf(lang === 'ur' ? 'یا' : 'OR', ctx)}</div>`);
    out.push(`<div class="q" data-slot="${esc(slot.slot)}"><div class="alt">${textOf(seen[`instruction_${lang}`] || seen.instruction_ur, ctx)}</div><div class="verse">${textOf(q.passage, ctx)}</div>${verseSource(ctx)}</div>`);
  }
  return out.join('');
}

function sectionHead(sec, live, ctx) {
  const lang = ctx.medium;
  const sctx = sectionCtx(sec, live);
  const cell = (k, cls) => {
    const v = substitute(sec[`${k}_${lang}`], sctx, lang);
    return `<span class="${cls}">${v ? textOf(v, ctx) : ''}</span>`;
  };
  const note = sec[`note_${lang}`] ? `<div class="sec-note">${textOf(substitute(sec[`note_${lang}`], sctx, lang), ctx)}</div>` : '';
  return `<div class="sec-head">${cell('time', 't')}${cell('label', 'l')}${cell('marks', 'm')}</div>${note}`;
}

// ── shared page chrome ─────────────────────────────────────────────────────

function css(medium, kind) {
  const ur = medium === 'ur';
  const start = ur ? 'right' : 'left';
  const end = ur ? 'left' : 'right';
  return `
  @page { size: A4; }
  ${faces(medium).join('\n')}
  html, body { margin: 0; padding: 0; }
  body { font-family: ${ur ? "'PaperUrdu','PaperLatin',serif" : "'PaperLatin',Arial,sans-serif"};
    font-size: ${ur ? '12.5pt' : '10.5pt'}; line-height: ${ur ? 2.0 : 1.45}; color: #000; }
  .num, .ascii, .ltr { direction: ltr; unicode-bidi: isolate; }
  .ascii, .ltr { font-family: 'PaperLatin', Arial, sans-serif; }
  .school { text-align: center; font-weight: 700; }
  .title { text-align: center; font-weight: 700; font-size: ${ur ? '13.5pt' : '12.5pt'}; margin-top: 2px; }
  .atoms { display: flex; justify-content: space-between; font-weight: 700; margin: 4px 0; }
  .note { border: 1px solid #000; padding: 4px 8px; font-size: ${ur ? '11pt' : '9.5pt'}; margin: 4px 0 8px; break-inside: avoid; }
  table.student { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: ${ur ? '11pt' : '9.5pt'}; }
  table.student td { border: 1px solid #000; padding: 3px 6px; height: 7mm; }
  table.student td.k { background: #f0f0f0; font-weight: 700; white-space: nowrap; width: 22%; }
  section.sec { break-inside: auto; }
  .sec-head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000; padding: 2px 0; margin: 10px 0 4px; break-after: avoid; font-weight: 700; }
  .sec-head .t { text-align: ${start}; font-weight: 400; }
  .sec-head .l { text-align: center; padding: 0 8px; }
  .sec-head .m { text-align: ${end}; font-weight: 400; }
  .sec-note { font-weight: 700; margin: 2px 0 6px; break-after: avoid; break-inside: avoid; }
  .slot { margin: 6px 0 4px; }
  .slot-head { display: flex; gap: 6px; align-items: baseline; font-weight: 700; margin: 6px 0 3px; break-after: avoid; break-inside: avoid; }
  .slot-head .ml { margin-${start}: auto; white-space: nowrap; font-weight: 700; }
  .slot-head .ins { font-weight: 700; }
  .q { margin: 3px 0 5px; padding-${start}: 6mm; break-inside: avoid; }
  /* A slot's last item never sits alone at the top of a page. */
  .slot > .q:last-child { break-before: avoid; }
  .q .n { display: inline-block; min-width: 6mm; margin-${start}: -6mm;${ur ? ' box-sizing: border-box; padding-left: 1.2mm;' : ''} }
  .q.qcont { padding-${start}: 0; }
  .q.qcont .n { margin-${start}: 0; font-weight: 700; min-width: 0; margin-${end}: 4px; }
  .opts { display: grid; gap: 1px 10px; margin: 2px 0 0; }
  .opts.four { grid-template-columns: repeat(4, 1fr); }
  .opts.two { grid-template-columns: repeat(2, 1fr); }
  .opt .ol { margin-${end}: 3px; }
  .work-box { border: 1px solid #555; margin: 3px 0 2px;
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 7.5mm, #bbb 7.5mm, #bbb 7.8mm); }
  .work-square { border: 1px solid #555; margin: 3px 0 2px; }
  /* Inset from the end: a border on the content edge is clipped from the PDF (bd-5jmnfj.4.20). */
  .write-box { border: 1.2px solid #000; margin: 2mm 0 1mm; margin-${end}: 0.5mm; }
  .sq { display: inline-block; width: 9mm; height: 7mm; border: 1.2px solid #000; vertical-align: middle; margin: 0 2mm; }
  .word-box.bank { display: flex; flex-wrap: wrap; justify-content: center; gap: 2mm 8mm; padding: 2mm 4mm; font-size: 13pt; break-after: avoid; }
  /* Picture cells sit in lines, not a flex grid (bd-5jmnfj.4.50.6): Chromium starts a flex grid on
     its heading's page and pushes only the cells, so v22 left headings alone at a page foot. As
     lines, the first row moves with its heading; one row is enough on either side of a break. */
  .pic-grid { orphans: 1; widows: 1; }
  .q.pic-cell { display: inline-block; vertical-align: top; width: 30%; margin: 0 0 4mm; margin-inline-end: 4mm; break-inside: avoid; }
  .q.pic-cell.wide { display: block; width: 100%; margin-inline-end: 0; }
  table.data { border-collapse: collapse; margin: 4px 0; }
  table.data th, table.data td { border: 1px solid #000; padding: 2px 10px; text-align: center; }
  table.data th { background: #f0f0f0; }
  svg.sym { width: .95em; height: .95em; vertical-align: -0.12em; margin: 0 .05em; }
  .frac { display: inline-flex; flex-direction: column; vertical-align: middle; font-size: 0.8em; line-height: 1; text-align: center; margin: 0 1px; }
  .frac sup, .frac sub { font-size: 1em; vertical-align: baseline; line-height: 1; }
  .frac sup { border-bottom: 1px solid #000; }
  .frame { position: relative; border: 1.2px solid #000; margin: 4px 0; break-inside: avoid; }
  .frame-anchor { position: absolute; inset: 0; }
  .frame-title { position: absolute; top: 2mm; ${start}: 3mm; font-size: ${ur ? '10pt' : '8.5pt'}; color: #555; }
  .label-lines { position: absolute; ${end}: 3mm; top: 8mm; bottom: 3mm; display: flex; flex-direction: column; justify-content: space-around; width: 45mm; }
  .label-line { border-bottom: 1px solid #000; height: 6mm; }
  .label-line .num-l { font-size: 8pt; color: #555; }
  .word-box { border: 1px solid #000; padding: 2px 8px; margin: 3px 0; text-align: center; }
  .word-line { margin: 3px 0; }
  .passage { border: 1px solid #888; padding: 4px 8px; margin: 3px 0 5px; text-align: justify; break-inside: avoid; }
  /* A passage and its parts are too tall to move as one block: the page may break between parts. */
  .q.comp { break-inside: auto; }
  .verse { text-align: center; margin: 3px 0 5px; }
  .part { margin: 4px 0; break-inside: avoid; }
  .part-head { display: flex; gap: 6px; align-items: baseline; font-weight: 700; }
  .part-head .ml { margin-${start}: auto; }
  .sub { margin: 2px 0 2px 0; padding-${start}: 6mm; }
  .sub .n { display: inline-block; min-width: 6mm; margin-${start}: -6mm;${ur ? ' box-sizing: border-box; padding-left: 1.2mm;' : ''} }
  .pick-row { display: flex; gap: 8px; align-items: baseline; margin: 2px 0; }
  .pick-k { min-width: 22mm; font-weight: 700; }
  .blank { display: inline-block; min-width: 28mm; border-bottom: 1px dashed #000; margin: 0 4px; font-size: 7pt; color: #777; }
  .ant-row { display: flex; gap: 14mm; margin: 2px 0; }
  .or { text-align: center; font-weight: 700; margin: 2px 0; break-before: avoid; break-after: avoid; }
  .slot.either { break-inside: avoid; }
  .or-lead, .alt { font-weight: 700; }
  .sit { margin-top: 3px; }
  ${ur ? `/* Nastaliq ascenders rise above the line box; without room above, a block
     that starts a page paints the tops of its letters at the foot of the page before. */
  .sec-head, .slot-head, .part-head, .q, .alt, .or-lead, .s-head, table.rows td { padding-top: .45em; }` : ''}
  .topics { display: flex; gap: 10mm; flex-wrap: wrap; }
  ${PICTURE_CSS}
  ${MATCH_CSS}
  ${kind === 'scheme' ? schemeCss(medium) + ORAL_CSS : ''}`;
}

function schemeCss(medium) {
  const ur = medium === 'ur';
  const start = ur ? 'right' : 'left';
  return `
  .band { background: #000; color: #fff; text-align: center; font-weight: 700; padding: 3px 0; letter-spacing: ${ur ? '0' : '.06em'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .scheme-title { text-align: center; font-weight: 700; font-size: ${ur ? '13pt' : '12pt'}; letter-spacing: ${ur ? '0' : '.04em'}; }
  .covers { text-align: center; font-size: ${ur ? '10pt' : '9pt'}; margin-bottom: 6px; }
  .box { border: 1.5px solid #000; padding: 4px 8px; margin: 6px 0; break-inside: avoid; font-size: ${ur ? '11pt' : '9.5pt'}; }
  .box .bt { font-weight: 700; margin-bottom: 2px; }
  ${medium === 'ur' ? `@counter-style urdu-steps { system: numeric; symbols: '۰' '۱' '۲' '۳' '۴' '۵' '۶' '۷' '۸' '۹'; suffix: '۔ '; }
  .box ol { margin: 0; padding-${start}: 16px; list-style-type: urdu-steps; }` : `.box ol { margin: 0; padding-${start}: 16px; }`}
  .box ul { margin: 0; padding-${start}: 14px; }
  .s-head { font-weight: 700; border-bottom: 1.5px solid #000; margin: 8px 0 3px; break-after: avoid; }
  .strip { font-size: ${ur ? '11pt' : '9.5pt'}; margin: 2px 0 6px; break-inside: avoid; }
  .strip .sl { font-weight: 700; }
  .strip .sc { white-space: nowrap; }
  table.rows { width: 100%; border-collapse: collapse; font-size: ${ur ? '10.5pt' : '9pt'}; }
  table.rows td { border-bottom: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
  table.rows tr { break-inside: avoid; }
  table.rows tr.slot-row { break-after: avoid; }
  table.rows tr.slot-row td { border-bottom: 1px solid #000; padding-top: 6px; }
  td.n { width: 8%; font-weight: 700; white-space: nowrap; }
  td.ans { width: 42%; }
  td.pts { width: 50%; }
  .q-line { color: #444; font-size: .92em; }
  .pt { display: block; }
  .chip { display: inline-block; border: 1px solid #000; border-radius: 3px; padding: 0 3px; font-weight: 700; margin-${ur ? 'left' : 'right'}: 3px; font-family: 'PaperLatin', Arial, sans-serif; direction: ltr; unicode-bidi: isolate; }
  .acc, .err { display: block; color: #333; }
  .err { unicode-bidi: isolate; }
  .q-line .sq { width: 5mm; height: 4mm; margin: 0 1mm; }
  .crit { display: block; }
  .crit-m { font-weight: 700; }
  section.record { break-before: page; }
  .rec-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  table.rec { width: 100%; border-collapse: collapse; font-size: 8pt; line-height: 1.1; }
  table.rec th, table.rec td { border: 1px solid #000; height: 9mm; padding: 0 2px; text-align: center; }
  table.rec td.name { width: 32%; }
  .notes { margin-top: 8px; break-inside: avoid; }`;
}

function headerBlock(L, ctx, total) {
  const lang = ctx.medium;
  const H = L.header;
  const box = H[`student_box_${lang}`] || H.student_box_en;
  const atoms = `<div class="atoms"><span>${textOf(H[`time_line_${lang}`] || '', ctx)}</span><span>${textOf(substitute(H[`total_line_${lang}`] || '', { w: total, n: total, t: total, g: total }, lang), ctx)}</span></div>`;
  return `<div class="school">${textOf(H[`school_line_${lang}`], ctx)}</div>
<div class="title">${textOf(H[`title_${lang}`], ctx)}</div>
${atoms}
${H[`note_${lang}`] ? `<div class="note">${textOf(H[`note_${lang}`], ctx)}</div>` : ''}
<table class="student">
  <tr><td class="k">${textOf(box[0], ctx)}</td><td colspan="3"></td></tr>
  <tr><td class="k">${textOf(box[1], ctx)}</td><td></td><td class="k">${textOf(box[2], ctx)}</td><td></td></tr>
  <tr><td class="k">${textOf(box[3], ctx)}</td><td>${textOf(String(total), ctx)}</td><td class="k">${textOf(box[4], ctx)}</td><td></td></tr>
</table>`;
}

function contextFor(L, subject, answerLines) {
  const key = String(L.subject || subject || '').toLowerCase();
  return {
    medium: clampLanguage(L.medium), maths: key === 'maths' || key === 'math' || key === 'mathematics', answerLines,
    ...(L.verse_source ? { verseSource: L.verse_source } : {}),
  };
}

/**
 * renderPaper({ examJson, grade, subject, answerLines }) → HTML.
 * Throws NO_LAYOUT, REVIEW_TEXT or PATTERN_SHORT_SLOT rather than print a wrong paper.
 */
function renderPaper({ examJson, grade, subject, answerLines = true, allowShort = false }) {
  const L = layoutOf(examJson);
  refuseReviewText(examJson, 'paper');
  const { all, live } = itemsBySlot(examJson, L);
  assertCounts(L, all, { allowShort });
  const ctx = contextFor(L, subject, answerLines);
  const total = totalMarks(examJson);
  const sections = L.sections.map((sec) => `<section class="sec" data-section="${esc(sec.id)}">${sectionHead(sec, live, ctx)}${sec.slots.map((slot) => slotBlock(slot, sec, all.get(slot.slot), ctx)).join('')}</section>`).join('\n');
  const lang = ctx.medium;
  return `<!DOCTYPE html>
<html lang="${lang}"${lang === 'ur' ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><title>${esc(L.header[`title_${lang}`] || '')}</title>
<style>${css(lang, 'paper')}</style></head>
<body data-grade="${esc(grade)}">
${headerBlock(L, ctx, total)}
${sections}
</body></html>`;
}

// ── the marking scheme ─────────────────────────────────────────────────────


function fill(template, values) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined || values[k] === null ? m : String(values[k])));
}

function shortLabel(label) {
  return String(label || '').replace(/^Q\.\s?/, 'Q').replace(/^(Q\d+)\.\s*\(/, '$1 (').replace(/[.:]\s*$/, '').trim();
}

/*
 * A frame the teacher fills from the book when no book page is confirmed
 * (the Social Studies map, a Science diagram whose page the item does not give): the scheme names the book's own map and prints no
 * page, rather than a page nobody has checked.
 */
const BOOK_SOURCE = {
  map: { en: "the book's outline map", ur: 'کتاب کا خاکہ نقشہ' }, // ur: needs fluent-Urdu review
  diagram: { en: "the book's diagram", ur: 'کتاب کا خاکہ' }, // ur: needs fluent-Urdu review
};

// Rows the scheme pass wrote in code (an answer with no points), counted in the box,
// in words a teacher acts on.
const FILLED_BY_CODE = {
  en: (n) => (n === 1
    ? '1 marking row was written from the answer. Check it before marking.'
    : `${n} marking rows were written from the answer. Check them before marking.`),
  ur: (n) => (n === 1 // needs fluent-Urdu review
    ? 'مارکنگ اسکیم کی 1 سطر جواب سے بنائی گئی ہے۔ نمبر دینے سے پہلے اسے جانچ لیں۔'
    : `مارکنگ اسکیم کی ${n} سطریں جواب سے بنائی گئی ہیں۔ نمبر دینے سے پہلے انہیں جانچ لیں۔`),
};

// `item` is the index in the model's own type list (seen/unseen → category →
// type), as marking-scheme.js writes it; an entry whose item was removed is not counted.
function filledByCode(L, examJson) {
  const list = Array.isArray(L.scheme_shortfall) ? L.scheme_shortfall : [];
  const removed = (e) => ['seen', 'unseen'].some((branch) => Object.values(examJson[branch] || {})
    .some((types) => types && typeof types === 'object' && Object.values(types)
      .some((items) => Array.isArray(items) && items[e.item] && items[e.item].slot === e.slot && items[e.item].removed === true)));
  const seen = new Set();
  return list.filter((e) => {
    if (!e || typeof e !== 'object') return false;
    const key = `${e.slot}|${e.item}|${e.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !removed(e);
  }).length;
}

// A supply whose item already prints a drawn picture: nothing for the teacher to add.
function pictured(live, supply) {
  const list = (live && live.get && live.get(supply.slot)) || [];
  return list.some((q) => q && q.picture && q.picture.src);
}

function beforeExamBox(L, live, ctx, examJson) {
  const lang = ctx.medium;
  const B = L.before_exam;
  const lines = [...B[`lines_${lang}`]];
  const pages = L.pages && Number.isInteger(L.pages.paper) ? L.pages.paper : null;
  if (pages === null) {
    lines[0] = lines[0].replace(lang === 'ur' ? ' ({n} صفحات)' : ' ({n} pages)', '');
    lines[1] = lang === 'ur' ? lines[1].replace('تمام {n} صفحات', 'تمام صفحات') : lines[1].replace('all {n} pages', 'every page');
  }
  // The box names the paper, never a file (bd-5jmnfj.4.50.5).
  lines[0] = fill(lines[0], { file: Cover.PAPER_NAME[lang], n: pages });
  lines[1] = fill(lines[1], { n: pages });
  // You add.
  const frameSupply = (L.supplies || []).find((s) => s.kind !== 'naat' && !pictured(live, s));
  if (frameSupply) {
    const slot = L.sections.flatMap((s) => s.slots).find((s) => s.slot === frameSupply.slot);
    const p = L.frame_pages && L.frame_pages[frameSupply.slot];
    const source = !frameSupply.book_page && BOOK_SOURCE[frameSupply.kind];
    const duty = source ? source[lang] : slot.frame[`duty_${lang}`];
    let line = fill(lines[2], { duty, p: p || B[`unknown_pages_${lang}`], b: frameSupply.book_page });
    if (!frameSupply.book_page) line = line.replace(lang === 'ur' ? / \(کتاب ص \{b\}\)/ : / \(book p\. \{b\}\)/, '');
    // An unknown page sends the teacher to the paper; Urdu then names the paper once.
    if (!p) line = line.replace(lang === 'ur' ? 'سوالیہ پرچہ صفحہ ' : 'page ', '');
    lines[2] = line;
  } else {
    lines[2] = null; // Nothing to add: no line (bd-5jmnfj.4.50.5).
  }
  // The teacher adds the picture BEFORE photocopying, so that step comes first (v24 review).
  if (lines[2] !== null) [lines[1], lines[2]] = [lines[2], lines[1]];
  // Tell the class: the parts by the names the paper prints.
  const onPaper = L.sections.filter((s) => s.answer_on === 'question_paper');
  const onSheet = L.sections.filter((s) => s.answer_on !== 'question_paper');
  const where = [
    onPaper.length ? fill(B[`on_paper_${lang}`], { sections: Cover.joinParts(onPaper, lang) }) : null,
    onSheet.length ? fill(B[`on_sheet_${lang}`], { sections: Cover.joinParts(onSheet, lang) }) : null,
  ].filter(Boolean).join(lang === 'ur' ? '؛ ' : '; ');
  // Every choice the paper offers, in paper order: between items (attempt < generate),
  // inside one item (seven words, any five), or between two alternatives (Urdu Q6).
  const attempts = L.sections.flatMap((s) => s.slots).map((slot) => {
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    if (slot.alternatives && slot.alternatives.some((a) => a.kind === 'fixed')) return fill(B[`either_${lang}`], { label });
    if (slot.attempt < slot.generate) {
      const n = live.get(slot.slot).length;
      // A group cut to its attempt count (or emptied) offers no choice: nothing to tell.
      return n > slot.attempt ? fill(B[`attempt_${lang}`], { label, n: slot.attempt, g: n }) : null;
    }
    if (slot.in_item_choice) return fill(B[`attempt_${lang}`], { label, n: slot.in_item_choice.n, g: slot.in_item_choice.g });
    return null;
  }).filter(Boolean);
  if (!attempts.length) lines[3] = lines[3].replace(lang === 'ur' ? '؛ {attempts}' : '; {attempts}', '');
  lines[3] = fill(lines[3], { sections: where, attempts: attempts.join(lang === 'ur' ? '؛ ' : '; ') });
  lines[4] = fill(lines[4], { t: L[`total_time_${lang}`] || (lang === 'ur' ? '3 گھنٹے' : '3 hrs') });
  const filled = examJson ? filledByCode(L, examJson) : 0;
  if (filled > 0) lines.push(FILLED_BY_CODE[lang](filled));
  return `<div class="box before"><div class="bt">${textOf(B[`title_${lang}`], ctx)}</div><ol>${lines.filter((l) => l !== null).map((l) => `<li>${textOf(l, ctx)}</li>`).join('')}</ol></div>`;
}

/*
 * The subject's legend. A paper laid out before legends were per subject
 * carries the shared one (no `subject`): it takes its subject's from the pattern.
 */
function legendOf(L) {
  const G = L.legend || {};
  if (G.subject) return G;
  const S = Patterns.subjectOf(L.preset_id || 'fde_g5_2027', L.subject);
  return (S && S.legend) || G;
}

const CHIP_ORDER = ['M', 'A', 'U', 'K', 'L'];

// `kinds`: the chip letters the scheme prints (a Set). Outside Maths the key lists only those.
function legendBox(L, ctx, kinds) {
  const lang = ctx.medium;
  const G = legendOf(L);
  const lines = G[`lines_${lang}`].map((l, i) => {
    if (lang === 'ur' && i === G.bands_line) {
      return `<li>${textOf(G.bands_lead_ur, ctx)}: <span class="ascii">${esc(l)}</span></li>`;
    }
    if (G.key_from_chips && i === G.key_line) {
      const names = G[`key_names_${lang}`] || {};
      const keyed = CHIP_ORDER.filter((k) => kinds.has(k) && names[k]).map((k) => `${k} = ${names[k]}`);
      if (!keyed.length) return '';
      return `<li>${textOf(lang === 'ur' ? keyed.join('، ') : `${keyed.join(' · ')}.`, ctx)}</li>`;
    }
    if (!L.oral && /oral|زبانی/i.test(l)) return ''; // a frozen legend can still name an oral part the paper lacks
    return `<li>${textOf(l, ctx)}</li>`;
  });
  return `<div class="box legend"><div class="bt">${textOf(G[`title_${lang}`], ctx)}</div><ul>${lines.join('')}</ul></div>`;
}

function suppliesBox(L, ctx, live) {
  const lang = ctx.medium;
  const supplies = (Array.isArray(L.supplies) ? L.supplies : []).filter((s) => !pictured(live, s));
  if (!supplies.length) return '';
  const title = lang === 'ur' ? 'استاد مہیا کریں' : 'Teacher supplies'; // ur: needs fluent-Urdu review
  const lineOf = (s) => {
    const source = !s.book_page && BOOK_SOURCE[s.kind];
    return source ? `${s[`line_${lang}`]} (${source[lang]})` : s[`line_${lang}`];
  };
  return `<div class="box supplies"><div class="bt">${textOf(title, ctx)}</div><ul>${supplies.map((s) => `<li>${textOf(lineOf(s), ctx)}</li>`).join('')}</ul></div>`;
}

/*
 * The letter a key names. A key that IS an option's text («a dog», «A bird»,
 * «بکری») is that option, read first: only then is a leading letter a letter,
 * and only when punctuation or the end follows it, or the rest is that
 * option's own text («b garden»).
 */
function answerLetter(q, slot) {
  const a = String(q.answer ?? '').trim();
  const opts = (q.options || []).map(bareOption);
  const letters = slot.option_labels === 'ur' || slot.option_labels === 'ur_paren' ? URDU_LETTERS : ['a', 'b', 'c', 'd'];
  const byText = a ? opts.findIndex((o) => o && o === a) : -1;
  if (byText >= 0) return letters[byText];
  const at = (i, rest) => i >= 0 && (rest === null || (rest && opts[i] === rest));
  const m = /^\(?([a-dA-D])(?:\)?[.):](?:\s|$)|\)?$|\s+(.+)$)/.exec(a);
  if (m) {
    const i = m[1].toLowerCase().charCodeAt(0) - 97;
    if (at(i, m[2] === undefined ? null : m[2].trim())) return letters[i];
  }
  const u = /^\(?(الف|ب|ج|د)(?:\)?\s*[.):۔]|\)?\s*$|\s+(.+)$)/.exec(a);
  if (u) {
    const i = URDU_LETTERS.indexOf(u[1]);
    if (at(i, u[2] === undefined ? null : u[2].trim())) return u[1];
  }
  const idx = opts.findIndex((o) => o && (o === bareOption(a)));
  return idx >= 0 ? letters[idx] : '—';
}

function mcqStrip(slot, list, ctx) {
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  const sep = lang === 'ur' ? '، ' : ' · ';
  const key = (q) => (slot.shape === 'match' ? matchAnswer(q) : answerLetter(q, slot));
  const cells = live.map((q, i) => `${itemNumber(slot, i, lang).replace(/[)۔.]$/, '')} ${key(q)}`);
  const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
  // A line may break only between answers, and a separator never starts or ends a line alone.
  const last = cells.length - 1;
  const strip = cells.map((c, i) => `<span class="sc">${textOf(i < last ? `${c}${sep.trimEnd()}` : c, ctx)}</span>`).join(' ');
  return `<div class="strip" data-row="${esc(slot.slot)}"><span class="sl">${textOf(label, ctx)}</span> ${strip}</div>`;
}

function pointsHtml(q, ctx, Criteria, slot, idx, marks = null) {
  const lang = ctx.medium;
  const out = [];
  const s = q.scheme && typeof q.scheme === 'object' ? q.scheme : null;
  if (slot.shape === 'composition' || (slot.shape === 'frame' && slot.frame && slot.frame.kind === 'picture')) {
    const kind = Criteria.kindFor(slot, idx);
    const rows = kind ? Criteria.criteriaFor(kind, slot.marks_each, lang) : [];
    rows.forEach((r) => out.push(`<span class="crit"><span class="crit-m">${textOf(fmt(r.marks), ctx)}</span> ${textOf(r.name, ctx)}${r.look_for ? ` — ${textOf(r.look_for, ctx)}` : ''}</span>`));
  }
  if (s && Array.isArray(s.points) && !out.length) {
    s.points.forEach((p, k) => out.push(`<span class="pt"><span class="chip">${esc(`${p.kind || ''}${fmt(Number(p.marks))}`)}</span> ${textOf(lang === 'ur' ? urduNote(p.text, 'point', slot.type, k) : p.text, ctx)}</span>`));
  }
  // No points from the model: the row still says what it is worth (DESIGN §5 rule 3).
  if (!out.length && Number.isFinite(marks) && marks > 0) out.push(`<span class="chip">${textOf(fmt(marks), ctx)}</span>`);
  const accepts = s && Array.isArray(s.accept) ? acceptText(q.answer, s.accept.map((a) => (lang === 'en' ? letterOrder(q, a) : a)), lang) : '';
  if (accepts) out.push(`<span class="acc">${textOf(`${lang === 'ur' ? 'یہ بھی درست:' : 'accept:'} ${accepts}`, ctx)}</span>`); // ur: needs fluent-Urdu review
  if (s && typeof s.common_error === 'string' && s.common_error) out.push(`<span class="err">${textOf(`${lang === 'ur' ? 'عام غلطی:' : 'common error:'} ${lang === 'ur' ? urduNote(s.common_error, 'error', slot.type, 0) : s.common_error}`, ctx)}</span>`); // ur: needs fluent-Urdu review
  return out.join('');
}

// The "checked" badge was an internal state (bd-5jmnfj.4.51.6): a teacher marking the key has no use for it.
function checkedChip() {
  return '';
}

function writtenRows(slot, list, ctx, Criteria) {
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  const rows = [];
  live.forEach((q, i) => {
    const n = itemNumber(slot, i, lang) || (lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en));
    if (slot.shape === 'comprehension') {
      rows.push(...comprehensionRows(slot, q, ctx));
      return;
    }
    if (slot.shape === 'situation') {
      const subs = q.questions || [];
      let anyOwn = false;
      subs.forEach((sub, k) => {
        const each = sub && Number(sub.marks) > 0 ? Number(sub.marks) : (slot.item_parts && slot.item_parts.marks_each) || slot.marks_each / (subs.length || 1);
        const own = sub && sub.answer !== undefined && sub.answer !== null && String(sub.answer).trim() !== '' ? sub.answer : partOfAnswer(q.answer, k);
        if (own !== null && own !== undefined && String(own).trim() !== '') anyOwn = true;
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(`${n} ${String.fromCharCode(97 + k)})`, ctx)}</td><td class="ans"><b>${textOf(own, ctx)}</b></td><td class="pts">${pointsHtml(sub || {}, ctx, Criteria, slot, i, each)}</td></tr>`);
      });
      // The situation's own scheme (points, accept, common error) once, under its parts;
      // a parent answer no part could take (no a)/b)/c) letters) prints there too.
      const parentAnswer = !anyOwn && q.answer !== undefined && q.answer !== null && String(q.answer).trim() !== ''
        ? `<b>${textOf(q.answer, ctx)}</b>` : '';
      if (hasScheme(q.scheme) || parentAnswer) {
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n"></td><td class="ans">${parentAnswer}</td><td class="pts">${pointsHtml(q, ctx, Criteria, slot, i, null)}</td></tr>`);
      }
      return;
    }
    // A passage's answers sit on its parts: a row per part, lettered as the paper letters them (bd-5jmnfj.4.50.2).
    const parts = answeredParts(q);
    if (parts) {
      parts.forEach((sub, k) => {
        const label = `${n} ${itemNumber({ numbering: slot.sub_numbering || 'alpha_paren' }, k, lang)}`;
        const stem = sub && sub.question ? `<div class="q-line">${textOf(cutAtWord(bareSub(sub.question), 110), ctx)}</div>` : '';
        const each = sub && Number(sub.marks) > 0 ? Number(sub.marks) : slot.marks_each / parts.length;
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(label, ctx)}</td><td class="ans"><b>${textOf(sub && sub.answer, ctx)}</b>${stem}</td><td class="pts">${pointsHtml(sub || {}, ctx, { kindFor: () => null, criteriaFor: () => [] }, slot, k, each)}</td></tr>`);
      });
      return;
    }
    const answer = q.answer !== undefined && q.answer !== null ? `<b>${textOf(lang === 'en' ? letterOrder(q, q.answer) : q.answer, ctx)}</b>` : '';
    // An English key names a picture the answer is not (bd-5jmnfj.4.48): v21 Q6 keyed "mat" for a bat.
    const pic = lang === 'en' && q.picture && q.picture.name && String(q.picture.name).trim().toLowerCase() !== String(q.answer ?? '').trim().toLowerCase()
      ? `Picture: ${String(q.picture.name).trim()}. ` : '';
    const qText = cutAtWord(withoutOwnLabel(q.question || '', slot), 110);
    // The question is often just the picture's name: say it once (bd-5jmnfj.4.51.2).
    const sameAsPic = pic && qText.trim().toLowerCase() === String(q.picture.name).trim().toLowerCase();
    const stemHtml = textOf(sameAsPic ? pic.replace(/\.\s*$/, '') : pic + qText, ctx).replace(/☐/g, '<span class="sq"></span>');
    const stem = q.question || pic ? `<div class="q-line">${stemHtml}</div>` : '';
    rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(n, ctx)}</td><td class="ans">${answer}${checkedChip(q, ctx)}${stem}</td><td class="pts">${pointsHtml(q, ctx, Criteria, slot, list.indexOf(q), Number(q.marks) || slot.marks_each)}</td></tr>`);
  });
  if (slot.alternatives) {
    const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
    if (fixed) {
      const split = (fixed.split || []).join('، ');
      const text = lang === 'ur'
        ? `نعت (سبق ${fixed.book_lesson}، ص ${fixed.book_page}): استاد کتاب سے جانچیں — تقسیم ${split}` // needs fluent-Urdu review
        : `Naat (lesson ${fixed.book_lesson}, p. ${fixed.book_page}): mark from the textbook — split ${(fixed.split || []).join(', ')}`;
      rows.unshift(`<tr data-row="${esc(slot.slot)}-fixed"><td class="n">${textOf(lang === 'ur' ? '(الف)' : '(a)', ctx)}</td><td class="ans" colspan="2">${textOf(text, ctx)}</td></tr>`);
    }
  }
  // The slot's own head first, so a marker can tell which question a row answers.
  if (rows.length) {
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    const ins = choiceLine(slot, live.length, lang, live).instruction;
    rows.unshift(`<tr class="slot-row" data-slot-head="${esc(slot.slot)}"><td colspan="3"><b>${textOf(label, ctx)}</b>${ins ? ` ${textOf(ins, ctx)}` : ''}</td></tr>`);
  }
  return rows;
}

function hasScheme(s) {
  return Boolean(s && typeof s === 'object' && ((Array.isArray(s.points) && s.points.length)
    || (Array.isArray(s.accept) && s.accept.length) || (typeof s.common_error === 'string' && s.common_error)));
}

/**
 * Part k of an answer the model wrote on the parent as «a) … b) … c) …»
 * (or «(a) …»): the text after letter k up to the next letter. null when the
 * answer carries no such letter.
 */
function partOfAnswer(answer, k) {
  const text = String(answer ?? '');
  const re = /(^|[\s;.])\(?([a-cA-C])\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ letter: m[2].toLowerCase(), start: m.index + m[1].length, body: m.index + m[0].length });
  const at = marks.findIndex((x) => x.letter === String.fromCharCode(97 + k));
  if (at < 0) return null;
  const end = at + 1 < marks.length ? marks[at + 1].start : text.length;
  return text.slice(marks[at].body, end).trim() || null;
}

// A question shown beside its answer: whole, or cut at the last word that fits.
function cutAtWord(text, max) {
  const chars = [...String(text || '')];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`;
}

function comprehensionRows(slot, q, ctx) {
  const lang = ctx.medium;
  const rows = [];
  const parts = Array.isArray(q.parts) ? q.parts : [];
  for (const spec of slot.parts_spec || []) {
    const part = parts.find((p) => p && p.key === spec.key) || {};
    if (spec.pick) {
      for (const kind of Object.keys(spec.pick)) {
        const words = (part.pick && part.pick[kind]) || [];
        const tail = lang === 'ur' ? `، یا پیراگراف کا کوئی اور ${kind}` : `, or any other ${kind.toLowerCase().replace(/s$/, '')} in the passage`; // ur: needs fluent-Urdu review
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(spec.label, ctx)}</td><td class="ans"><b>${textOf(kind, ctx)}:</b> ${textOf(words.join(lang === 'ur' ? '، ' : ', ') + tail, ctx)}</td><td class="pts"><span class="chip">${esc(`K${fmt(spec.marks_each)}`)}</span> ${textOf(lang === 'ur' ? 'ہر درست لفظ' : 'each correct word', ctx)}</td></tr>`); // ur: needs fluent-Urdu review
      }
    } else if (spec.key === 'antonyms') {
      // «جلدی: دیر», as the model writes the pair; v22 printed «جلدی ← دیر» (bd-5jmnfj.4.50.1).
      (part.antonyms || []).forEach((pair) => {
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n"></td><td class="ans"><b>${textOf(Array.isArray(pair) ? `${pair[0]}: ${pair[1]}` : pair, ctx)}</b></td><td class="pts"><span class="chip">${esc(`A${fmt(spec.marks_each)}`)}</span></td></tr>`);
      });
    } else {
      (part.questions || []).forEach((sub, k) => {
        const n = itemNumber({ numbering: spec.numbering || 'urdu' }, k, lang);
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(`${spec.label} ${n}`, ctx)}</td><td class="ans"><b>${textOf(sub && sub.answer, ctx)}</b></td><td class="pts">${pointsHtml(sub || {}, ctx, { kindFor: () => null, criteriaFor: () => [] }, slot, k)}</td></tr>`);
      });
    }
  }
  return rows;
}

function renderMarkingScheme({ examJson, grade, subject, allowShort = false }) {
  const L = layoutOf(examJson);
  refuseReviewText(examJson, 'marking scheme');
  const { all, live } = itemsBySlot(examJson, L);
  assertCounts(L, all, { allowShort });
  const ctx = contextFor(L, subject, false);
  const lang = ctx.medium;
  const Criteria = require('./composition-criteria');
  const H = L.header;
  const ur = lang === 'ur';

  // One bracket deep, one full stop (bd-5jmnfj.4.50.5).
  const coversScope = Cover.coversLine(L.scope || {}, H[`covers_${lang}`], lang);

  // Sections flow one after another (rows never split, a head never ends a
  // page): a forced break per section left near-empty pages in the proof render.
  const sections = L.sections.map((sec) => {
    const parts = [];
    const total = sectionTotal(sec, live);
    const head = `${sec[`label_${lang}`] ? substitute(sec[`label_${lang}`], sectionCtx(sec, live), lang) : `Section ${sec.id}`} (${fmt(total)})`;
    parts.push(`<div class="s-head">${textOf(head, ctx)}</div>`);
    const rows = [];
    for (const slot of sec.slots) {
      const list = all.get(slot.slot);
      // A strip prints in its question's place: the rows above it close first (bd-5jmnfj.4.49).
      if (slot.shape === 'mcq' || slot.shape === 'match') {
        if (rows.length) parts.push(`<table class="rows">${rows.splice(0).join('')}</table>`);
        parts.push(mcqStrip(slot, list, ctx));
      } else rows.push(...writtenRows(slot, list, ctx, Criteria));
    }
    if (rows.length) parts.push(`<table class="rows">${rows.join('')}</table>`);
    return `<section class="s-sec" data-section="${esc(sec.id)}">${parts.join('')}</section>`;
  }).join('\n');
  // The chip letters the rows above print: the legend keys those and no others.
  const kinds = new Set([...sections.matchAll(/<span class="chip">([MAUKL])/g)].map((m) => m[1]));

  const top = `<div class="band">${textOf(H[`band_${lang}`], ctx)}</div>
<div class="school">${textOf(H[`school_line_${lang}`], ctx)}</div>
<div class="title">${textOf(H[`title_${lang}`], ctx)}</div>
<div class="scheme-title">${textOf(H[`scheme_title_${lang}`], ctx)}</div>
<div class="covers">${textOf(coversScope, ctx)}</div>
${beforeExamBox(L, live, ctx, examJson)}
${legendBox(L, ctx, kinds)}
${suppliesBox(L, ctx, live)}`;

  const notes = notesBlock(L, all, ctx);
  const record = recordPage(L, live, ctx);
  // The Grade 1-2 oral teacher sheet (bd-5jmnfj.4.4); '' for a paper with no oral part.
  const oral = oralSheet(L.oral, { medium: lang, text: (s) => textOf(s, ctx) });
  return `<!DOCTYPE html>
<html lang="${lang}"${ur ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><title>${esc(H[`scheme_title_${lang}`])}</title>
<style>${css(lang, 'scheme')}</style></head>
<body data-grade="${esc(grade)}">
${top}
${sections}
${notes}
${oral}
${record}
</body></html>`;
}

function notesBlock(L, all, ctx) {
  const lang = ctx.medium;
  const notes = Array.isArray(L.notes) ? L.notes : [];
  const lines = [];
  for (const note of notes) {
    const slot = L.sections.flatMap((s) => s.slots).find((s) => s.slot === note.slot);
    if (!slot) continue;
    const list = all.get(slot.slot) || [];
    const q = Number.isInteger(note.index) ? list[note.index] : null;
    if (q && q.removed === true) continue;
    const pos = q ? list.filter((x) => x.removed !== true).indexOf(q) : -1;
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    const num = pos >= 0 ? itemNumber(slot, pos, lang).replace(/[)۔.]$/, '') : '';
    const n = num ? `${label} (${num})` : label;
    const template = lang === 'ur' ? L.header.note_replaced_ur : L.header.note_replaced_en;
    lines.push(`<li>${textOf(fill(template, { n, value: note.model }), ctx)}</li>`);
  }
  if (!lines.length) return '';
  return `<div class="notes"><div class="bt"><b>${textOf(L.header[`notes_title_${lang}`], ctx)}</b></div><ul>${lines.join('')}</ul></div>`;
}

// 40 rows do not fit one A4 page at a writable height with a header, so the
// record is two tables of 20 side by side: one page, rows 9 mm.
function recordPage(L, live, ctx) {
  const lang = ctx.medium;
  const H = L.header;
  const cols = [...H[`record_cols_${lang}`]];
  // Each part as the paper names it, then the oral part, so the total is the paper's whole (bd-5jmnfj.4.50.5).
  const marks = Cover.recordColumns(L, lang, (sec) => sectionTotal(sec, live));
  const secCols = marks.map((c) => `${c.head} /${fmt(c.marks)}`);
  const total = marks.reduce((s, c) => s + c.marks, 0);
  const head = [...cols, ...secCols, `${H[`record_total_${lang}`]} /${fmt(total)}`, H[`record_grade_${lang}`]];
  const table = (from) => {
    const rows = Array.from({ length: 20 }, (_, i) => `<tr class="rec-row"><td>${textOf(String(from + i), ctx)}</td><td class="name"></td>${secCols.map(() => '<td></td>').join('')}<td></td><td></td></tr>`).join('');
    return `<table class="rec"><tr>${head.map((h) => `<th>${textOf(h, ctx)}</th>`).join('')}</tr>${rows}</table>`;
  };
  return `<section class="record" style="break-before:page"><div class="s-head">${textOf(H[`record_title_${lang}`], ctx)}</div><div class="rec-pair">${table(1)}${table(21)}</div></section>`;
}

// ── PDF options and the frame pages ────────────────────────────────────────

/**
 * Playwright page.pdf() options: A4, backgrounds, and a footer with
 * Chromium's own page number and total. The footer's <style> repeats the
 * page's @font-face rules so its fonts load (see the module comment).
 */
function pdfOptions(examJson, kind = 'paper') {
  const L = layoutOf(examJson);
  const ur = L.medium === 'ur';
  const H = L.header;
  const style = `<style>${faces(L.medium).join('')}</style>`;
  let body;
  if (ur) {
    const digits = "font-family:'FdeUrduDigits'";
    const page = esc(H.footer_page_ur)
      .replace('{n}', `<span class="pageNumber" style="${digits}"></span>`)
      .replace('{N}', `<span class="totalPages" style="${digits}"></span>`);
    const prefix = kind === 'scheme' ? `${esc(H.scheme_title_ur)} · ` : '';
    body = `<div dir="rtl" style="width:100%;font-family:'PaperUrdu';font-size:8.5pt;line-height:1.7;text-align:center;color:#333;padding:0 12mm">`
      + `<div>${prefix}${page}</div></div>`;
  } else {
    const prefix = kind === 'scheme' ? `${esc(H.scheme_title_en)} · ` : '';
    const page = esc(H.footer_page_en)
      .replace('{n}', '<span class="pageNumber"></span>')
      .replace('{N}', '<span class="totalPages"></span>');
    body = `<div style="width:100%;font-family:'PaperLatin';font-size:7.5pt;text-align:center;color:#333;padding:0 12mm">${prefix}${page}</div>`;
  }
  return {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: style + body,
    margin: { top: '12mm', right: '12mm', bottom: ur ? '22mm' : '18mm', left: '12mm' },
  };
}

/**
 * The paper page each frame landed on, read from the finished PDF: every frame
 * is a named destination `fde-frame-<slot>`. Returns { [slot]: page } (1-based);
 * a frame it cannot find is left out.
 */
async function framePages(pdfBuffer) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRef } = require('pdf-lib');
  const out = {};
  try {
    const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
    const pageRefs = doc.getPages().map((p) => p.ref.toString());
    const pageOf = (dest) => {
      let arr = dest;
      if (arr instanceof PDFRef) arr = doc.context.lookup(arr);
      if (arr instanceof PDFDict) arr = arr.lookup(PDFName.of('D'));
      if (!(arr instanceof PDFArray)) return null;
      const first = arr.get(0);
      const idx = first ? pageRefs.indexOf(first.toString()) : -1;
      return idx >= 0 ? idx + 1 : null;
    };
    const decode = (k) => {
      if (k instanceof PDFName) return k.decodeText ? k.decodeText() : k.asString().replace(/^\//, '');
      if (k instanceof PDFString || k instanceof PDFHexString) return k.decodeText();
      return String(k);
    };
    const record = (name, dest) => {
      const m = /^fde-frame-(.+)$/.exec(name);
      if (!m) return;
      const page = pageOf(dest);
      if (page) out[m[1]] = page;
    };
    const catalog = doc.catalog;
    const dests = catalog.lookup(PDFName.of('Dests'));
    if (dests instanceof PDFDict) {
      for (const [k, v] of dests.entries()) record(decode(k).replace(/^\//, ''), v);
    }
    const names = catalog.lookup(PDFName.of('Names'));
    const tree = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : null;
    const walk = (node) => {
      if (!(node instanceof PDFDict)) return;
      const leaf = node.lookup(PDFName.of('Names'));
      if (leaf instanceof PDFArray) {
        for (let i = 0; i + 1 < leaf.size(); i += 2) record(decode(leaf.lookup(i)), leaf.lookup(i + 1));
      }
      const kids = node.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) walk(kids.lookup(i));
    };
    walk(tree);
  } catch {
    return out;
  }
  return out;
}

module.exports = {
  renderPaper,
  renderMarkingScheme,
  totalMarks,
  choiceLine,
  pdfOptions,
  toUrduDigits,
  framePages,
  // the generation service re-asks a section whose item text hits this list
  REFUSED_ITEM,
  // for tests and the paper view
  substitute,
  itemNumber,
  bareOption,
};
