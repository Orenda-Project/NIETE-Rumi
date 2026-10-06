'use strict';
/**
 * What a child SEES of a question's picture — the only view of it a blind solver may get.
 *
 * A figure spec is the drawing's recipe, and a recipe can hold what the drawing hides.
 * `word_blank` is the case that shipped: `{word: "SKY", blanks: [1]}` draws the tiles
 * "S _ Y", and the solver that was handed the spec read "SKY" — so "What is the missing
 * letter in S_Y?" (P / C / K, keyed K) passed as clean, though SPY fits the tiles as well.
 *
 *   childView(figure, ctx)     the figure as drawn: a word_blank becomes its tiles and
 *                              the pictogram's name; any field that names an answer
 *                              (answer, solution, correct…, key) is left out of every kind
 *   hiddenLetters(figure, ctx) the letter(s) a word_blank hides, and their Urdu names —
 *                              what its key must be (quiz-author-gates-v2, WORD_BLANK_NOT_ASKED)
 *
 * The blanks are the ones the renderer will hide: the author's, or — when the author named
 * none — the ones transcript-quiz-word-blank infers from the stem, by the same rule.
 * Pure: no I/O.
 */

const { lettersOf, inferBlanks } = require('./transcript-quiz-word-blank');
const { has: hasPictogram } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');

const ANSWER_FIELD = /^(answer|answers|solution|solutions|correct\w*|key|keyed)$/i;

/** Urdu letter names a key may use for a hidden letter («کاف» for ک). */
const URDU_LETTER_NAMES = {
  'ا': ['الف'], 'ب': ['بے'], 'پ': ['پے'], 'ت': ['تے'], 'ٹ': ['ٹے'], 'ث': ['ثے'], 'ج': ['جیم'], 'چ': ['چے'],
  'ح': ['حے', 'بڑی حے'], 'خ': ['خے'], 'د': ['دال'], 'ڈ': ['ڈال'], 'ذ': ['ذال'], 'ر': ['رے'], 'ڑ': ['ڑے'],
  'ز': ['زے'], 'ژ': ['ژے'], 'س': ['سین'], 'ش': ['شین'], 'ص': ['صاد', 'صواد'], 'ض': ['ضاد', 'ضواد'],
  'ط': ['طوئے', 'طوے'], 'ظ': ['ظوئے', 'ظوے'], 'ع': ['عین'], 'غ': ['غین'], 'ف': ['فے'], 'ق': ['قاف'],
  'ک': ['کاف'], 'گ': ['گاف'], 'ل': ['لام'], 'م': ['میم'], 'ن': ['نون'], 'و': ['واؤ', 'واو'],
  'ہ': ['ہے', 'چھوٹی ہے', 'گول ہے'], 'ھ': ['دو چشمی ہے', 'دوچشمی ہے', 'دو چشمی ہ'], 'ء': ['ہمزہ'],
  'ی': ['یے', 'چھوٹی یے'], 'ے': ['بڑی یے'],
};
const MARKS = /[ً-ٰٟۖ-ۭؐ-ؚ]/g;

const isWordBlank = (f) => Boolean(f && typeof f === 'object' && !Array.isArray(f)
  && String(f.type || '').toLowerCase() === 'word_blank' && String(f.word || '').trim());

/** The indices the renderer will hide, or [] when it would hide none. */
function blanksOf(spec, { stem = '', language = 'en' } = {}) {
  const letters = lettersOf(spec);
  const named = (Array.isArray(spec.blanks) ? spec.blanks : [spec.blanks])
    .map(Number).filter((b) => Number.isInteger(b) && b >= 0 && b < letters.length);
  if (named.length) return [...new Set(named)].sort((a, b) => a - b);
  const guess = inferBlanks(letters, { stem, language, word: spec.word });
  return guess ? guess.blanks : [];
}

/**
 * The figure as the child sees it, for the blind solve. Never mutates its argument.
 * @returns {object|null}
 */
function childView(figure, ctx = {}) {
  if (!figure || typeof figure !== 'object' || Array.isArray(figure)) return null;
  if (isWordBlank(figure)) {
    const letters = lettersOf(figure);
    const hide = new Set(blanksOf(figure, ctx));
    const picto = figure.picto && hasPictogram(String(figure.picto)) ? String(figure.picto) : 'none';
    return { type: 'word_blank', shows: letters.map((l, i) => (hide.has(i) ? '_' : l)).join(' '), picture: picto };
  }
  return Object.fromEntries(Object.entries(figure).filter(([k]) => !ANSWER_FIELD.test(k)));
}

/**
 * The letters a word_blank hides, and every way a key may name them: the letters
 * themselves (marks dropped), and for one hidden Urdu letter its spoken name.
 * @returns {{hidden:string, forms:string[]}|null} null for any other figure
 */
function hiddenLetters(figure, ctx = {}) {
  if (!isWordBlank(figure)) return null;
  const letters = lettersOf(figure);
  const blanks = blanksOf(figure, ctx);
  if (!blanks.length) return null;
  const hidden = blanks.map((b) => letters[b]).join('');
  const forms = [hidden];
  if (blanks.length === 1) forms.push(...(URDU_LETTER_NAMES[hidden.replace(MARKS, '')] || []));
  return { hidden, forms };
}

module.exports = { childView, hiddenLetters, blanksOf, URDU_LETTER_NAMES };
