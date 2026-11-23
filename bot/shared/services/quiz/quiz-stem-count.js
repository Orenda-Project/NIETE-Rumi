'use strict';
/**
 * The count a question's stem STATES, for an item whose cards are the things counted (an order or match web item).
 *
 * In production an Urdu order item asked a child to put «the four steps» in order and gave three cards: the lesson's
 * four steps with one missing. A stem that names a count must have that many cards (web-quiz-items normaliseItem
 * rejects it otherwise, and the stored MCQ plays).
 *
 * The rule: a number WORD from two to seven, in English or Urdu, next to a counted noun, with at most one word between
 * ("four steps", "five main events", «چار قدموں», «پانچ اہم واقعات»). Digits are never counted: they are the maths in
 * the stem ("13.75 × 5.5"), not a count of cards. Pure; no I/O.
 */

/** Number words, two to seven: the count is the word's place in the list plus two. */
const EN_WORDS = ['two', 'three', 'four', 'five', 'six', 'seven'];
const UR_WORDS = ['دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات'];

/** The nouns a stem counts its cards in. */
const EN_NOUNS = ['steps?', 'stages?', 'events?', 'things', 'items', 'parts', 'sentences', 'words', 'numbers', 'actions', 'phases', 'cards'];
const UR_NOUNS = ['قدم', 'قدموں', 'مراحل', 'مرحلوں', 'مرحلے', 'چیزوں', 'چیزیں', 'واقعات', 'واقعوں', 'الفاظ', 'لفظوں', 'جملوں', 'جملے', 'حصوں', 'کاموں'];

// A word character as Python's str regex has it (letters, numbers, underscore), so "four" inside "fourteen" is no count.
const WORD = '[\\p{L}\\p{N}_]';
// The Arabic block: an Urdu number word inside a longer word («چھوٹے») is no count.
const ARABIC = '[\\u0600-\\u06FF]';

const EN_RULES = EN_WORDS.map((w, i) => [i + 2,
  new RegExp(`(?<!${WORD})${w}\\s+(?:${WORD}+\\s+)?(?:${EN_NOUNS.join('|')})(?!${WORD})`, 'iu')]);
const UR_RULES = UR_WORDS.map((w, i) => [i + 2,
  new RegExp(`(?<!${ARABIC})${w}\\s+(?:${ARABIC}+\\s+)?(?:${UR_NOUNS.join('|')})(?!${ARABIC})`, 'u')]);
const RULES = [...EN_RULES, ...UR_RULES];

/** The count the stem states (2-7), or null when it states none. */
function statedCount(stem) {
  const s = typeof stem === 'string' ? stem : '';
  const hit = RULES.find(([, rx]) => rx.test(s));
  return hit ? hit[0] : null;
}

/** True only when the stem states a count and it is not `n`. */
function mismatch(stem, n) {
  const stated = statedCount(stem);
  return stated !== null && stated !== n;
}

module.exports = { statedCount, mismatch };
