'use strict';
/**
 * Child test (bd-s1oo0.5) — per-field confidence bars, exported for L6.
 *
 * Every AI mark is stored with its confidence. L6's check Flow pre-fills a field
 * only when its confidence clears the bar for that field; below the bar it
 * arrives empty and the coach marks it. The bars start from what the May 2026
 * study measured against the enumerator (harness/HARNESS_RESULTS.md), so a
 * confidence of 0.74 means "this kind of mark agreed with a human about 74% of
 * the time in the study", not a model's self-report.
 */

/** What the study measured, by field (agreement with the enumerator). */
const STUDY_AGREEMENT = Object.freeze({
  // §3b Gemini 3.8 Flash on 60-s windows: share within ±5 words of the enumerator
  story_within5: { urdu: 0.74, english: 0.74 },
  // §3b per-word precision of Gemini 3.8 Flash wrong-flags (Urdu 0.48, English 0.31);
  // §7 SpeechAce per-word precision on English 0.45
  chip_precision: { gemini_urdu: 0.48, gemini_english: 0.31, speechace_english: 0.45 },
  // §4 Gemini 3 Flash comprehension: within one answer of the enumerator
  comprehension_within1: 0.79,
  // §2 human floor (reviewer agreed with enumerator)
  human_floor: { orf_urd: 0.54, orf_eng: 0.62, rdcomp_urd: 0.73, letterid_urd: 0.89, numrep: 0.87, computation: 0.88, word_problems: 0.87 },
});

/** Bias of each counter against the enumerator on the same windows (§3b): Gemini minus STT alignment. */
const EXPECTED_GEMINI_MINUS_ALIGNMENT = Object.freeze({ urdu: 13.8, english: 8.0 });

const FIELD_BARS = Object.freeze({
  'story.words_correct': 0.7,
  'story.flagged': 0.6,
  fallback: 0.7,
  questions: 0.7,
  first_sounds: 0.7,     // hint-only: never pre-filled whatever its confidence (see prefill)
  nonwords: 0.65,
  'maths.numbers': 0.75,
  'maths.quick_sums': 0.7,
  'maths.written': 0.75,
  'maths.word_problem': 0.7,
});

/** Letters and first sounds are marked by the coach; the AI verdict is a hint only. */
const HINT_CONFIDENCE_CAP = 0.4;

const PROTOCOL_PENALTY = Object.freeze({
  no_cue_phrase: 0.1,
  prompting_during_timed_minute: 0.15,
  timer_problem: 0.15,
  story_read_once: 0,
});

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** Should L6 pre-fill this field? */
function prefill(field, confidence, { hint_only: hintOnly = false } = {}) {
  if (hintOnly) return false;
  const bar = FIELD_BARS[field];
  if (bar == null) return false;
  return clamp01(confidence) >= bar;
}

/**
 * Story count confidence. Starts at the study's within-±5 rate; rises when
 * Gemini and the STT alignment agree once the alignment's known harshness is
 * allowed for, falls when they disagree or the minute was not clean.
 */
function storyConfidence({ lang, geminiCorrect, alignCorrect, flags = [], speechaceCorrect = null }) {
  const base = STUDY_AGREEMENT.story_within5[lang] || 0.7;
  let c = base;
  if (Number.isFinite(geminiCorrect) && Number.isFinite(alignCorrect)) {
    const gap = Math.abs((geminiCorrect - alignCorrect) - (EXPECTED_GEMINI_MINUS_ALIGNMENT[lang] || 0));
    if (gap <= 8) c += 0.15;
    else if (gap > 20) c -= 0.25;
    else c -= 0.05;
  }
  if (Number.isFinite(speechaceCorrect) && Number.isFinite(geminiCorrect)) {
    c += Math.abs(speechaceCorrect - geminiCorrect) <= 5 ? 0.05 : -0.05;
  }
  for (const f of flags) c -= PROTOCOL_PENALTY[f] || 0;
  return Math.round(clamp01(c) * 100) / 100;
}

/** A per-word chip: shown pre-ticked only where two scorers agree (HARNESS_RESULTS §8). */
function chipConfidence({ gemini, alignment, speechace = null }) {
  const votes = [gemini, alignment, speechace].filter((v) => v === true).length;
  if (!gemini && votes === 0) return 0;
  if (votes >= 3) return 0.85;
  if (votes === 2) return 0.7;
  return 0.45;
}

module.exports = {
  FIELD_BARS, HINT_CONFIDENCE_CAP, STUDY_AGREEMENT, EXPECTED_GEMINI_MINUS_ALIGNMENT, PROTOCOL_PENALTY,
  prefill, storyConfidence, chipConfidence, clamp01,
};
