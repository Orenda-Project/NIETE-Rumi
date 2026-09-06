'use strict';
/**
 * Transcript quiz — `word_blank` spec normalisation.
 *
 * `word_blank` is the phonics instrument: a pictogram of the thing, and its
 * word with a letter hidden — a road, and "_ o a d". It is the type the author
 * reaches for on a grade 1-2 English lesson, and on the first two real ones it
 * met it failed every attempt, both lessons, on the same missing key:
 *
 *   q6: FIGURE_RENDER — the word_blank figure could not be drawn:
 *       word_blank: `blanks` must name at least one letter index to hide
 *
 * The contract defines `blanks` (required, 0-based, never empty, never all) and
 * shows it worked out in two scripts, and the model still left it out twice and
 * then repeated itself on the retry. So the key is not asked for again here —
 * it is DERIVED, because the question the author already wrote determines it:
 * "what is the beginning sound of the word 'road'?" can only mean the first
 * letter, and "the ending sound of 'park'" can only mean the last. A key a
 * question decides for itself is not a key worth losing the question over.
 *
 * Three things live here, all of them deterministic, none of them in the
 * engine — the engine's contract stays strict on purpose, so the lesson-plan
 * lane still hears about a spec it wrote wrong:
 *
 *   normaliseWordBlank()  fill in `blanks` (and pick the drawable style)
 *                         before the render, on the spec that is then STORED
 *   wordBlankFixHint()    the complete, renderable spec, appended to the one
 *                         error line the model's single retry gets to read
 *   inferBlanks()         the rule table, exported for the tests
 */

const { splitLetters } = require('../../../vendor/lp-v9/diagrams/types/word_blank');
const { has: hasPictogram } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
const { logEvent } = require('../../utils/structured-logger');

/**
 * The two cues a phonics stem carries. English and Urdu both, because the quiz
 * language and the teacher's language are decided separately and an Urdu quiz
 * asks the same question ("لفظ کا پہلا حرف کون سا ہے؟").
 *
 * `sound` is deliberately absent from both: "which sound do you hear in the
 * middle" is a real question and names neither end.
 */
const CUES = [
  { rule: 'stem-beginning', at: 'first', re: /\b(beginning|begins|begin|beginnings|first|starts?|starting|initial|onset)\b/i },
  { rule: 'stem-ending', at: 'last', re: /\b(ending|endings|ends?|last|final|finishes|finishing)\b/i },
  { rule: 'stem-beginning', at: 'first', re: /(پہلا|پہلے|پہلی|شروع|ابتدا|ابتدائی|اوّل|اول)/ },
  { rule: 'stem-ending', at: 'last', re: /(آخری|آخر|اختتام|اختتامی|انت)/ },
];

const LATIN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Does this word need Nastaliq's letter-row treatment? */
function isUrduWord(word, language) {
  return language === 'ur' || /[؀-ۿ]/.test(String(word || ''));
}

/**
 * The letters the engine will lay out — the same split it makes, so an index
 * computed here addresses the tile the child actually sees. An explicit
 * `letters` (a digraph the author wants treated as one sound: "sh", "ch") wins,
 * exactly as it does in the engine.
 */
function lettersOf(spec) {
  if (Array.isArray(spec.letters) && spec.letters.length) return spec.letters.map((l) => String(l));
  return splitLetters(spec.word);
}

/** The indices the engine would accept from this spec — its own filter, copied. */
function validBlanks(blanks, n) {
  return (Array.isArray(blanks) ? blanks : [blanks])
    .map((b) => Number(b))
    .filter((b) => Number.isInteger(b) && b >= 0 && b < n);
}

/**
 * Which letter to hide, and why.
 *
 * Order matters. The stem is the authority when it names an end, because the
 * author wrote it and the child will read it; only when the stem names neither
 * does the shape of the word decide.
 *
 * @returns {{blanks: number[], rule: string}|null} null when there is nothing
 *          safe to hide (a one-letter word leaves the child nothing to read).
 */
function inferBlanks(letters, { stem = '', language = 'en', word = '' } = {}) {
  const n = letters.length;
  if (n < 2) return null;
  const text = String(stem || '');

  // A stem may name both ends ("not the ending — what is the BEGINNING sound").
  // The one it names FIRST is the one it is asking about.
  const hit = CUES
    .map((c) => ({ ...c, at_: text.search(c.re) }))
    .filter((c) => c.at_ >= 0)
    .sort((a, b) => a.at_ - b.at_)[0];
  if (hit) return { blanks: [hit.at === 'first' ? 0 : n - 1], rule: hit.rule };

  // Urdu: a word's INITIAL letter is the one a child is given to start from —
  // the qaida teaches the letter row left to right off that first shape — so
  // the blank is the next one along. There is no vowel to find: Urdu's short
  // vowels are marks that ride on a letter, not letters of their own, and
  // `splitLetters` has already folded them into the letter they sit on.
  if (isUrduWord(word, language)) return { blanks: [1], rule: 'urdu-non-initial' };

  // The vowel is the letter a phonics lesson is usually about ("c _ t"), and it
  // is the one the contract's own worked example hides.
  const vowel = letters.findIndex((l) => LATIN_VOWELS.has(String(l).toLowerCase()));
  if (vowel >= 0) return { blanks: [vowel], rule: 'first-vowel' };

  return { blanks: [1], rule: 'second-letter' };
}

/**
 * The spec that is rendered and stored.
 *
 * Never mutates its argument, and returns the SAME object when there is nothing
 * to do, so a caller can tell a normalised spec from an untouched one.
 *
 * @param {object} spec           the figure as the author emitted it
 * @param {object} ctx            {stem, language, quizId, index}
 * @returns {{spec: object, blanks: number[]|null, rule: string|null}}
 */
function normaliseWordBlank(spec, { stem = '', language = 'en', quizId = null, index = null } = {}) {
  const untouched = { spec, blanks: null, rule: null };
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return untouched;
  if (String(spec.type || '').toLowerCase() !== 'word_blank') return untouched;
  if (!String(spec.word || '').trim()) return untouched; // `word` is the author's to write

  const letters = lettersOf(spec);
  const already = validBlanks(spec.blanks, letters.length);
  const out = { ...spec };
  let blanks = null;
  let rule = null;

  // An author who named real indices keeps them — including the all-blank spec
  // the engine refuses, which is a question about the whole word and not ours
  // to rewrite. Inference fires only where the engine would have thrown for
  // want of a single usable index.
  if (!already.length) {
    const guess = inferBlanks(letters, { stem, language, word: spec.word });
    if (!guess) return untouched;
    blanks = guess.blanks;
    rule = guess.rule;
    out.blanks = blanks;
    logEvent('transcript_quiz.figure_blanks_inferred', {
      quizId, index, word: String(spec.word), blanks, rule, letters: letters.length,
    });
  }

  // A word the pictogram set cannot picture is still a phonics question — the
  // letters ARE the content. But the engine's Latin default is `inline`, one
  // run of text, and with no picture beside it that SVG paints two elements,
  // which the lane's own `svgInkCount(svg) < 3` gate reads as a drawing that
  // paints almost nothing and throws the question away. Tiles is the same
  // instrument with a box per letter (it is what Urdu always gets), so the
  // blank is a box a child can see rather than an underscore lost in a 1080px
  // header. Only when the author has not chosen a style of their own.
  if (!out.picto && !out.style) out.style = 'tiles';

  return { spec: out, blanks, rule };
}

/**
 * The complete spec that would have worked, as one short clause to append to
 * the error the model's single retry quotes back.
 *
 * A message a retry quotes verbatim is prompt real estate (lane D, T28): this
 * one is ~60 characters and carries the whole answer, where the engine's own
 * complaint names the rule and leaves the model to guess the value — which, on
 * two real lessons, it did not.
 *
 * An unknown pictogram is DROPPED rather than replaced. The engine checks
 * `blanks` before `picto`, so a model told only about the blanks would have
 * spent its second attempt discovering that "park" is not in the set either;
 * and resolving a missing noun to the nearest glyph draws the wrong thing under
 * the right word (lane D, T26). Letters alone is the honest suggestion.
 *
 * @returns {string|null} `use {…}`, or null when no spec can be suggested
 */
function wordBlankFixHint(spec, { stem = '', language = 'en' } = {}) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  if (String(spec.type || '').toLowerCase() !== 'word_blank') return null;
  const word = String(spec.word || '').trim();
  if (!word) return null;

  const letters = lettersOf(spec);
  const already = validBlanks(spec.blanks, letters.length);
  // An all-blank spec is "valid indices" to the filter and still refused by the
  // engine, so the hint has to name a legal subset — the inferred one.
  const usable = already.length && already.length < letters.length
    ? [...new Set(already)].sort((a, b) => a - b)
    : (inferBlanks(letters, { stem, language, word }) || {}).blanks;
  if (!usable || !usable.length) return null;

  const suggestion = { type: 'word_blank', word };
  if (spec.picto && hasPictogram(spec.picto)) suggestion.picto = String(spec.picto);
  if (Array.isArray(spec.letters) && spec.letters.length) suggestion.letters = spec.letters.map((l) => String(l));
  suggestion.blanks = usable;
  return `use ${JSON.stringify(suggestion)}`;
}

module.exports = {
  normaliseWordBlank,
  wordBlankFixHint,
  inferBlanks,
  lettersOf,
  CUES,
};
