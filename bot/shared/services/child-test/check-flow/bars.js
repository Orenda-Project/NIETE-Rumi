'use strict';

/**
 * Child test check Flow — the per-field confidence bars, read from L5's
 * scoring/thresholds.js. Until that module is on the branch, the default bars here are used; once it
 * lands, its prefill() decides (per language, hint-only marks never pre-filled).
 */

const DEFAULT_BARS = Object.freeze({
  'story.words_correct': 0.7,
  'story.flagged': 0.6,
  fallback: 0.7,
  questions: 0.7,
  first_sounds: 0.7,
  nonwords: 0.65,
  'maths.numbers': 0.75,
  'maths.quick_sums': 0.7,
  'maths.written': 0.75,
  'maths.word_problem': 0.7,
});

function loadL5() {
  try {
    // eslint-disable-next-line global-require
    return require('../scoring/thresholds');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return null;
  }
}

const L5 = loadL5();
const BARS = L5 && L5.FIELD_BARS ? { ...DEFAULT_BARS, ...L5.FIELD_BARS } : DEFAULT_BARS;

/**
 * Does this mark arrive filled in? Below the bar it arrives empty and the coach marks it.
 * With L5's thresholds on the branch, its prefill() decides, in the block's language (its bars differ
 * by language, and a hint-only mark is never pre-filled). Without it, the default bars here apply.
 * @param {string} field  e.g. 'story.words_correct', 'questions', 'maths.written'
 * @param {number} confidence
 * @param {{lang?: 'urdu'|'english'|null, hintOnly?: boolean}} [o]
 */
function confident(field, confidence, { lang = null, hintOnly = false } = {}) {
  if (L5 && typeof L5.prefill === 'function') return Boolean(L5.prefill(field, confidence, { hint_only: Boolean(hintOnly), lang }));
  const bar = BARS[field];
  if (bar == null) return false;
  const c = Number(confidence);
  return Number.isFinite(c) && c >= bar;
}

module.exports = { confident, BARS, DEFAULT_BARS };
