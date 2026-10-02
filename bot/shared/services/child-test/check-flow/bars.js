'use strict';

/**
 * Child test check Flow (bd-s1oo0.6) — the per-field confidence bars, read from L5's
 * scoring/thresholds.js. Until that module is on the branch, the same bars are used from here, so the
 * check behaves the same either way; once it lands, its values win.
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

function loadBars() {
  try {
    // eslint-disable-next-line global-require
    const t = require('../scoring/thresholds');
    if (t && t.FIELD_BARS) return { ...DEFAULT_BARS, ...t.FIELD_BARS };
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  return DEFAULT_BARS;
}

const BARS = loadBars();

/**
 * Does this mark arrive filled in? Below the bar it arrives empty and the coach marks it. First sounds
 * are a hint from the model: shown always, pre-selected only when they clear the bar too (L5 caps a
 * hint's confidence below it, so in practice the coach marks them).
 */
function confident(field, confidence) {
  const bar = BARS[field];
  if (bar == null) return false;
  const c = Number(confidence);
  return Number.isFinite(c) && c >= bar;
}

module.exports = { confident, BARS, DEFAULT_BARS };
