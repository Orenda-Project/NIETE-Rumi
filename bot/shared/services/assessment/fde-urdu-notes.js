'use strict';
/**
 * Urdu marking notes (bd-5jmnfj.4.51.5). The writer sometimes returns an English marking note
 * (point text, common error) on an Urdu paper, and the key then mixes English words with Urdu
 * letters and the bidi algorithm scatters them. When an Urdu paper's note has Latin letters the
 * key prints the bank's short Urdu note for the slot type instead. Pure: strings in, string out.
 * Wording is plain standard Urdu: needs fluent-Urdu review.
 */

const BANK = {
  'Name the Picture': { point: ['درست نام، درست املا'], error: 'لفظ میں غلط حروف لکھ دینا' },
  'Fill in the Blanks': { point: ['خالی جگہ میں درست لفظ'], error: 'ایسا لفظ لکھ دینا جو جملے میں نہ بیٹھے' },
  'Singular Plural': { point: ['جمع کی درست شکل'], error: 'ے کی جگہ ا ہی لکھ دینا' },
  'Masculine Feminine': { point: ['مؤنث کی درست شکل'], error: 'وہی مذکر لفظ دوبارہ لکھ دینا' },
  Opposites: { point: ['درست الٹ لفظ'], error: 'دیا ہوا لفظ دوبارہ لکھ دینا' },
  'Make Sentences': { point: ['دیے گئے لفظ سے درست جملہ، درست املا'], error: 'جملے میں دیا ہوا لفظ نہ ہونا' },
  'Picture Sentences': { point: ['تصویر کے مطابق جملہ', 'الفاظ درست جڑے ہوں، املا درست ہو، آخر میں ۔ ہو'], error: 'الفاظ کا مل کر جملہ نہ بننا' },
};
const GENERIC = { point: ['درست جواب'], error: 'غلط جواب لکھ دینا' };

const URDU_LETTER = /[\u0600-\u06FF]/;
const ENGLISH_WORDS = /[A-Za-z]{3,}/g;

// English, not an Urdu note that quotes a Latin token (K-2, COVID-19): no Urdu letter at all, or
// two or more English words.
const isEnglish = (t) => /[A-Za-z]/.test(t) && (!URDU_LETTER.test(t) || (t.match(ENGLISH_WORDS) || []).length >= 2);

/** `kind` is 'point' or 'error'; `index` picks among a type's point notes (the last one repeats). */
function urduNote(text, kind, type, index = 0) {
  const t = String(text ?? '');
  if (!isEnglish(t)) return text;
  // «English — Urdu»: the Urdu half carries the bands, so print it rather than the bank note (v37r6 g2 Q9).
  const urduHalf = t.split(/\s[—–]\s/).find((part) => URDU_LETTER.test(part) && !isEnglish(part));
  if (urduHalf) return urduHalf.trim();
  const note = BANK[type] || GENERIC;
  if (kind === 'error') return note.error;
  return note.point[Math.min(index, note.point.length - 1)];
}

module.exports = { urduNote, BANK };
