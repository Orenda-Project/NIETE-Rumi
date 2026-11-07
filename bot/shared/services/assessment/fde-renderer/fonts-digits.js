'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
// The directory the original file lived in: paths below resolve as they did there.
const PARENT_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');

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
const URDU_DIGITS_TTF = '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OwI4ECALIEAdM1AUKB8EBQ4KCgsCDUAAAAEAaADEASQBhQAOAAA3JiYnNT4CNzMWFhUUB8EOLB8PKSMECSctWcQRKBgKFi0hAhkqGCVB//8A5f/+AUgCngIGAAEAAP//AHT//gHuAp4CBgACAAD//wA///4CIgKeAgYAAwAA//8AHAAAAgsCngIGAAQAAP//AGD//wGrAp4CBgAFAAAAAAAAAA8AugADAAEECQAAAGgAAAADAAEECQABABoAaAADAAEECQACAA4AggADAAEECQADAEYAkAADAAEECQAEABoAaAADAAEECQAFAKwA1gADAAEECQAGABoAaAADAAEECQAHAEQBggADAAEECQAIAEYBxgADAAEECQAJAPoCDAADAAEECQAKARQDBgADAAEECQALAD4EGgADAAEECQAMADwEWAADAAEECQANApYElAADAAEECQAOADQHKgBDAG8AcAB5AHIAaQBnAGgAdAAgADIAMAAxADcALQAyADAAMgAyACAARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAQQBsAGwAIABSAGkAZwBoAHQAcwAgAFIAZQBzAGUAcgB2AGUAZAAuAEYAZABlAFUAcgBkAHUARABpAGcAaQB0AHMAUgBlAGcAdQBsAGEAcgAzAC4AMAAwADIAOwBHAE8ATwBHADsATgBvAHQAbwBOAGEAcwB0AGEAbABpAHEAVQByAGQAdQAtAFIAZQBnAHUAbABhAHIAVgBlAHIAcwBpAG8AbgAgADMALgAwADAAMgA7ACAAdAB0AGYAYQB1AHQAbwBoAGkAbgB0ACAAKAB2ADEALgA4ACkAIAAtAGwAIAA4ACAALQByACAANQAwACAALQBHACAAMgAwADAAIAAtAHgAIAAxADQAIAAtAEQAIABhAHIAYQBiACAALQBmACAAbgBvAG4AZQAgAC0AYQAgAHEAcwBxACAALQBYACAAIgAiAE4AbwB0AG8AIABpAHMAIABhACAAdAByAGEAZABlAG0AYQByAGsAIABvAGYAIABHAG8AbwBnAGwAZQAgAEkAbgBjAC4ATQBvAG4AbwB0AHkAcABlACAASQBtAGEAZwBpAG4AZwAgAEkAbgBjAC4ALAAgAFMAaQBtAG8AbgAgAEMAbwB6AGUAbgBzAE0AbwBuAG8AdAB5AHAAZQAgAEQAZQBzAGkAZwBuACAAVABlAGEAbQAgACgAUABhAHQAcgBpAGMAawAgAEcAaQBhAHMAcwBvAG4AOgAgAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAsACAASwBhAG0AYQBsACAATQBhAG4AcwBvAHUAcgA6ACAATwBwAGUAbgBUAHkAcABlACAAYwBvAGQAZQAsACAARwBsAGUAbgBkAGEAIABCAGUAbABsAGEAcgBvAHMAYQApAC4AIABVAHAAZABhAHQAZQBkACAAYgB5ACAAUwBpAG0AbwBuACAAQwBvAHoAZQBuAHMALgBEAGUAcwBpAGcAbgBlAGQAIABiAHkAIABNAG8AbgBvAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAgAHQAZQBhAG0AIAAgACgAUABhAHQAcgBpAGMAawAgAEcAaQBhAHMAcwBvAG4AOgAgAHQAeQBwAGUAIABkAGUAcwBpAGcAbgAsACAASwBhAG0AYQBsACAATQBhAG4AcwBvAHUAcgA6ACAATwBwAGUAbgBUAHkAcABlACAAYwBvAGQAZQAsACAARwBsAGUAbgBkAGEAIABCAGUAbABsAGEAcgBvAHMAYQApAC4AIABVAHAAZABhAHQAZQBkACAAYgB5ACAAUwBpAG0AbwBuACAAQwBvAHoAZQBuAHMALgBoAHQAdABwADoALwAvAHcAdwB3AC4AZwBvAG8AZwBsAGUALgBjAG8AbQAvAGcAZQB0AC8AbgBvAHQAbwAvAGgAdAB0AHAAOgAvAC8AdwB3AHcALgBtAG8AbgBvAHQAeQBwAGUALgBjAG8AbQAvAHMAdAB1AGQAaQBvAFQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlACAAaQBzACAAbABpAGMAZQBuAHMAZQBkACAAdQBuAGQAZQByACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAsACAAVgBlAHIAcwBpAG8AbgAgADEALgAxAC4AIABUAGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAgAGkAcwAgAGQAaQBzAHQAcgBpAGIAdQB0AGUAZAAgAG8AbgAgAGEAbgAgACIAQQBTACAASQBTACIAIABCAEEAUwBJAFMALAAgAFcASQBUAEgATwBVAFQAIABXAEEAUgBSAEEATgBUAEkARQBTACAATwBSACAAQwBPAE4ARABJAFQASQBPAE4AUwAgAE8ARgAgAEEATgBZACAASwBJAE4ARAAsACAAZQBpAHQAaABlAHIAIABlAHgAcAByAGUAcwBzACAAbwByACAAaQBtAHAAbABpAGUAZAAuACAAUwBlAGUAIAB0AGgAZQAgAFMASQBMACAATwBwAGUAbgAgAEYAbwBuAHQAIABMAGkAYwBlAG4AcwBlACAAZgBvAHIAIAB0AGgAZQAgAHMAcABlAGMAaQBmAGkAYwAgAGwAYQBuAGcAdQBhAGcAZQAsACAAcABlAHIAbQBpAHMAcwBpAG8AbgBzACAAYQBuAGQAIABsAGkAbQBpAHQAYQB0AGkAbwBuAHMAIABnAG8AdgBlAHIAbgBpAG4AZwAgAHkAbwB1AHIAIAB1AHMAZQAgAG8AZgAgAHQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlAC4AaAB0AHQAcAA6AC8ALwBzAGMAcgBpAHAAdABzAC4AcwBpAGwALgBvAHIAZwAvAE8ARgBMAAMAAAAAAAD/nAAyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAB//8ADwABAAAACgAcAB4AAURGTFQACAAEAAAAAP//AAAAAAAAAAEAAAAKACwALgADREZMVAAUYXJhYgAebGF0bgAeAAQAAAAA//8AAAAAAAAAAAAA';

let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  _fonts = {};
  for (const [key, file] of Object.entries(FONT_FILES)) {
    const abs = path.join(PARENT_DIR, '..', '..', 'fonts', file);
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

/*
 * A Latin-script token that carries digits (K-2, COVID-19, A4, 3D) is one word
 * in another script: it keeps its Western digits and prints as a left-to-right
 * isolate. Converting its digits alone printed «K-2» as «۲-K». A digit run
 * between letters and a multiplication x (8x5) is a number, not a token.
 */
const LATIN_DIGIT_TOKEN = /(?<![0-9A-Za-z])(?:[A-Za-z]+(?:[-–]?[0-9]+)+[A-Za-z]*|[0-9]+[-–]?[A-Za-z]+)(?![0-9A-Za-z])/g;

// A number glued to a unit (5kg, 10cm) is a number: Urdu digits, the unit isolated after it.
const GLUED_UNIT = /^([0-9]+)(kg|g|mg|km|m|cm|mm|L|l|mL|ml|s|min|h|hr|hrs)$/;

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

// "8 2/5" → 8 + a stacked 2⁄5; "3/4" alone → a stacked fraction. Escaped input.
function typesetFractions(html) {
  return html
    .replace(/⁄/g, '/')
    .replace(/(^|[^\d/])(\d+) (\d+)\/(\d+)(?![\d/])/g, '$1$2<span class="frac"><sup>$3</sup><sub>$4</sub></span>')
    .replace(/(^|[^\d/>])(\d+)\/(\d+)(?![\d/])/g, '$1<span class="frac"><sup>$2</sup><sub>$3</sub></span>');
}

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

// "any eight" → "any eight of the following eleven"; Urdu adds «(دیے گئے ۱۱ میں سے)».
function addOutOf(raw, ctx, lang, present) {
  if (lang === 'ur') {
    return substitute(raw.replace(/(\{w:[^}]*\})/, `$1 (دیے گئے ${present} میں سے)`), ctx, lang); // needs fluent-Urdu review
  }
  const word = numberWord(present, 'en');
  if (/of the following/.test(raw)) return substitute(raw.replace('of the following', `of the following ${word}`), ctx, lang);
  return substitute(raw.replace(/(\{w:[^}]*\})/, `$1 of the following ${word}`), ctx, lang);
}

module.exports = {
  REFUSED_ITEM, addOutOf, esc, faces, fmt, refuseReviewText, slotTotal, substitute, textOf, toUrduDigits,
};
