'use strict';
/**
 * Oral mental-maths items with a number the question does not ask about (bd-5jmnfj.4.58.2).
 * v26 G1 Maths read «three flowers … four birds … count on from 4»: a Grade 1 child adds the
 * flowers and birds. The numbers an item names (digits or English number words; «one» is
 * ignored, it is also «one more») must all be ones it asks about: at most two, and when two,
 * the single numeric answer is one of them, their sum or difference, or between them.
 *
 * Pure: items in, offending asks out; never throws. An answer that is not one number is not judged.
 */

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TOKEN = /\d+|[a-z]+/gi;

/** The distinct number values in `text`. */
function numbersIn(text) {
  const out = new Set();
  (String(text).match(TOKEN) || []).forEach((t) => {
    const w = t.toLowerCase();
    if (/^\d+$/.test(w)) out.add(Number(w));
    else if (w !== 'one' && WORDS.includes(w)) out.add(WORDS.indexOf(w));
  });
  return [...out];
}

function offends(item) {
  if (!item || typeof item.ask !== 'string') return false;
  const nums = numbersIn(item.ask);
  if (nums.length > 2) return true;
  if (nums.length < 2) return false;
  const answer = String(item.answer == null ? '' : item.answer).match(/\d+/g);
  if (!answer || answer.length !== 1) return false;
  const [a, b] = nums;
  const k = Number(answer[0]);
  return ![a + b, Math.abs(a - b)].includes(k) && !(k >= Math.min(a, b) && k <= Math.max(a, b));
}

/** The asks that carry a number the question does not ask about. */
function extraNumbers(items) {
  return Array.isArray(items) ? items.filter(offends).map((it) => it.ask) : [];
}

module.exports = { extraNumbers };
