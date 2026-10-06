'use strict';
/**
 * Options that are nearly the same word — a TRIGGER for the blind solve, never a verdict.
 *
 * "Sky" beside "Spy", «سورج» beside «صورج», «کِتاب» beside «کتاب»: two options one
 * letter (or one same-sounding letter, or only a mark) apart are where a question
 * most often has two right answers — or a child cannot tell the options apart by ear.
 * But "cat" beside "bat" is also the commonest fair phonics distractor, so code does
 * NOT reject a pair. The blind solve is told about it ("check whether BOTH answer the
 * question") and the solver's verdict decides (transcript-quiz-key-verify).
 *
 *   same_letters  identical once case, marks (زبر زیر پیش, shadda) and spacing go
 *   same_sound    identical once Urdu letters that share a sound are folded
 *                 (س ص ث · ز ذ ض ظ · ت ط · ہ ح ھ · ا ع)
 *   one_letter    one insertion, deletion or substitution apart (Levenshtein 1)
 *
 * A pair needs both options at least 3 letters long: single letters ("P", "C", "K")
 * and short numbers always differ by one, and are not near-duplicates of each other.
 * Pure: no I/O.
 */

const MARKS = /[ً-ٰٟۖ-ۭؐ-ؚ̀-ͯ‌‍‎‏]/g;
const SAME_SOUND = {
  'ص': 'س', 'ث': 'س', 'ذ': 'ز', 'ض': 'ز', 'ظ': 'ز', 'ط': 'ت', 'ح': 'ہ', 'ھ': 'ہ', 'ه': 'ہ', 'ة': 'ہ', 'ۃ': 'ہ',
  'ع': 'ا', 'آ': 'ا', 'أ': 'ا', 'إ': 'ا', 'ك': 'ک', 'ي': 'ی', 'ى': 'ی', 'ے': 'ی',
};
const MIN_LETTERS = 3;

/** Letters only: lower case, no marks, no spaces or punctuation. */
function letters(text) {
  return String(text ?? '').normalize('NFC').toLowerCase().replace(MARKS, '').replace(/[^\p{L}\p{N}]/gu, '');
}
const folded = (s) => [...s].map((ch) => SAME_SOUND[ch] || ch).join('');

/** Levenshtein distance, capped: returns 2 for anything further than one edit. */
function withinOne(a, b) {
  const x = [...a]; const y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, k) => k);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[y.length] <= 1;
}

/**
 * Every near-duplicate pair among a question's options, by authored index.
 * @returns {{i:number, j:number, why:'same_letters'|'same_sound'|'one_letter'}[]}
 */
function nearPairs(options) {
  const opts = (Array.isArray(options) ? options : []).map(letters);
  const out = [];
  for (let i = 0; i < opts.length; i += 1) {
    for (let j = i + 1; j < opts.length; j += 1) {
      const a = opts[i]; const b = opts[j];
      if ([...a].length < MIN_LETTERS || [...b].length < MIN_LETTERS) continue;
      if (/^\p{N}+$/u.test(a) && /^\p{N}+$/u.test(b)) continue;
      let why = null;
      if (a === b) why = 'same_letters';
      else if (folded(a) === folded(b)) why = 'same_sound';
      else if (withinOne(a, b)) why = 'one_letter';
      if (why) out.push({ i, j, why });
    }
  }
  return out;
}

module.exports = { nearPairs, letters };
