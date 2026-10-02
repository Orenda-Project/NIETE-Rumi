'use strict';
/**
 * Child test (bd-s1oo0.5) — spoken numbers to integers.
 *
 * A child answers maths items aloud. Soniox, forced to Urdu, writes what it
 * heard as Urdu number words ("سینتالیس"), as digits ("47" / "۴۷"), or — when
 * the child code-switches — as English number words in Urdu script ("فورٹی
 * سیون"). With the language forced to English it writes "forty seven". This
 * module turns any of those into values, keeping the word index range so a
 * caller can find the answer's timestamp.
 *
 * Urdu 1–99 is irregular (every number has its own word), so it is a table, not
 * a rule. Keys and inputs go through the same normaliser (text-norm.clean), so
 * a spelling difference in ye/he/kaf or a diacritic never matters.
 */

const { clean } = require('./text-norm');

const URDU_1_TO_100 = [
  'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس',
  'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس',
  'اکیس', 'بائیس', 'تئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس', 'تیس',
  'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس', 'چالیس',
  'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس', 'پچاس',
  'اکاون', 'باون', 'تریپن', 'چوون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ', 'ساٹھ',
  'اکسٹھ', 'باسٹھ', 'تریسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر', 'ستر',
  'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچہتر', 'چھہتر', 'ستتر', 'اٹھہتر', 'اناسی', 'اسی',
  'اکیاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی', 'نوے',
  'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے',
];

// Common alternative spellings heard from Soniox and in print.
const URDU_VARIANTS = {
  'صفر': 0, 'زیرو': 0, 'چھے': 6, 'چھہ': 6, 'سولا': 16, 'تیتیس': 33, 'پیتیس': 35, 'تیتالیس': 43,
  'پیتالیس': 45, 'ترپن': 53, 'ترسٹھ': 63, 'ستسٹھ': 67, 'تیہتر': 73, 'پچھتر': 75, 'چھیہتر': 76,
  'اٹھتر': 78, 'تیراسی': 83, 'نینانوے': 99, 'سینتس': 37,
};

const ENGLISH_UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const ENGLISH_TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// English number words as Soniox writes them in Urdu script when the child code-switches.
const ENGLISH_IN_URDU_SCRIPT = {
  'ون': 1, 'ٹو': 2, 'تھری': 3, 'فور': 4, 'فائیو': 5, 'فایو': 5, 'سکس': 6, 'سیون': 7, 'ایٹ': 8, 'نائن': 9,
  'ٹین': 10, 'الیون': 11, 'ٹویلو': 12, 'ٹویلف': 12, 'تھرٹین': 13, 'فورٹین': 14, 'ففٹین': 15,
  'سکسٹین': 16, 'سیونٹین': 17, 'ایٹین': 18, 'نائنٹین': 19,
};
const ENGLISH_TENS_IN_URDU_SCRIPT = {
  'ٹوینٹی': 20, 'ٹونٹی': 20, 'تھرٹی': 30, 'فورٹی': 40, 'ففٹی': 50, 'سکسٹی': 60, 'سیونٹی': 70, 'ایٹی': 80, 'نائنٹی': 90,
};

const HUNDRED = new Set(['سو', 'hundred', 'ہنڈرڈ']);
const THOUSAND = new Set(['ہزار', 'thousand', 'تھاؤزنڈ']);
const JOINERS = new Set(['and', 'اور']);

const LEXICON = new Map(); // normalised word -> { value, kind: 'unit'|'tens' }
function add(word, value, kind) {
  const k = clean(word);
  if (k && !LEXICON.has(k)) LEXICON.set(k, { value, kind });
}
URDU_1_TO_100.forEach((w, i) => add(w, i + 1, 'unit'));
Object.entries(URDU_VARIANTS).forEach(([w, v]) => add(w, v, 'unit'));
Object.entries(ENGLISH_UNITS).forEach(([w, v]) => add(w, v, 'unit'));
Object.entries(ENGLISH_TENS).forEach(([w, v]) => add(w, v, 'tens'));
Object.entries(ENGLISH_IN_URDU_SCRIPT).forEach(([w, v]) => add(w, v, 'unit'));
Object.entries(ENGLISH_TENS_IN_URDU_SCRIPT).forEach(([w, v]) => add(w, v, 'tens'));

const DIGIT_MAP = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9, '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
function asciiDigits(s) {
  return String(s).replace(/[۰-۹٠-٩]/g, (d) => String(DIGIT_MAP[d]));
}

/**
 * One word → { value, kind } where kind is unit | tens | digits | hundred | thousand | joiner,
 * or null for a word that is not part of a number.
 */
function parseNumberWord(word) {
  const raw = asciiDigits(String(word || '')).trim().replace(/^[.,،۔!?؟:;"'()]+|[.,،۔!?؟:;"'()]+$/g, '');
  if (/^\d+$/.test(raw)) return { value: parseInt(raw, 10), kind: 'digits' };
  const k = clean(raw);
  if (!k) return null;
  if (HUNDRED.has(k)) return { value: 100, kind: 'hundred' };
  if (THOUSAND.has(k)) return { value: 1000, kind: 'thousand' };
  if (JOINERS.has(k)) return { value: null, kind: 'joiner' };
  return LEXICON.get(k) || null;
}

/** Split hyphenated English ("forty-seven") into words, keep the source index. */
function explode(words) {
  const out = [];
  words.forEach((w, i) => {
    String(w || '').split(/[-‐–]/).filter(Boolean).forEach((p) => out.push({ w: p, i }));
  });
  return out;
}

/**
 * Words → the numbers they contain, in order: [{ value, from, to, raw }].
 * from/to are indices into the input array (inclusive).
 */
function wordsToNumbers(words) {
  const src = Array.isArray(words) ? words : String(words || '').split(/\s+/);
  const parts = explode(src);
  const out = [];
  let cur = null; // { total, chunk, from, to, lastKind }

  const emit = () => {
    if (cur) {
      out.push({ value: cur.total + cur.chunk, from: cur.from, to: cur.to, raw: src.slice(cur.from, cur.to + 1).join(' ') });
    }
    cur = null;
  };

  for (const { w, i } of parts) {
    const p = parseNumberWord(w);
    if (!p) { emit(); continue; }
    if (p.kind === 'joiner') {
      // "one hundred AND forty" — only meaningful straight after a multiplier
      if (!(cur && (cur.lastKind === 'hundred' || cur.lastKind === 'thousand'))) emit();
      continue;
    }
    if (p.kind === 'digits') { emit(); out.push({ value: p.value, from: i, to: i, raw: src[i] }); continue; }
    if (p.kind === 'hundred') {
      if (!cur) cur = { total: 0, chunk: 100, from: i, to: i };
      else if (cur.chunk > 0 && cur.chunk < 100) cur.chunk *= 100;
      else if (cur.chunk === 0) cur.chunk = 100;
      else { emit(); cur = { total: 0, chunk: 100, from: i, to: i }; }
      cur.to = i; cur.lastKind = 'hundred';
      continue;
    }
    if (p.kind === 'thousand') {
      if (!cur) cur = { total: 0, chunk: 1, from: i, to: i };
      cur.total += (cur.chunk || 1) * 1000; cur.chunk = 0; cur.to = i; cur.lastKind = 'thousand';
      continue;
    }
    // unit or tens
    if (!cur) {
      cur = { total: 0, chunk: p.value, from: i, to: i, lastKind: p.kind };
      continue;
    }
    const afterMultiplier = cur.lastKind === 'hundred' || cur.lastKind === 'thousand';
    const englishTensThenUnit = cur.lastKind === 'tens' && p.kind === 'unit' && p.value < 10;
    if (afterMultiplier && (cur.chunk % 100 === 0) && p.value < 100) {
      cur.chunk += p.value; cur.to = i; cur.lastKind = p.kind;
    } else if (englishTensThenUnit) {
      cur.chunk += p.value; cur.to = i; cur.lastKind = 'unit';
    } else {
      emit();
      cur = { total: 0, chunk: p.value, from: i, to: i, lastKind: p.kind };
    }
  }
  emit();
  return out;
}

module.exports = { wordsToNumbers, parseNumberWord, asciiDigits, URDU_1_TO_100 };
