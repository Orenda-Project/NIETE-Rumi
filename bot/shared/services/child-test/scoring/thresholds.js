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

/** A bar above any confidence: the field always arrives empty and the coach marks it. */
const NEVER = 1.01;

/**
 * Bars set from run 3 on the L8 fixtures (golive/lanes/L5/EVAL.md, 2 Oct 2026): 53 real children
 * (May 2026 recordings, enumerator keys), 12 synthetic children, 50 strip photos. A bar is the lowest
 * confidence at which the AI's mark agreed with the key at least as often as the human floor; where no
 * confidence did, the field is NEVER pre-filled. Per-language where the two languages differed.
 */
const FIELD_BARS_BY_LANG = Object.freeze({
  'story.words_correct': Object.freeze({ urdu: NEVER, english: 0.7 }),
  questions: Object.freeze({ urdu: 0.9, english: 0.9 }),
  nonwords: Object.freeze({ urdu: 0.65, english: NEVER }),
});

const BAR_EVIDENCE = Object.freeze({
  'story.words_correct': 'Urdu real: confidence anti-calibrated (>=0.70: 56% within +-5, n 9; all: 71%). English real >=0.70: 88% within +-5 (n 16), synthetic 100% (n 6).',
  'story.flagged': 'Real per-word precision 0.25 at every bar (Urdu n 163, English n 159) vs study 0.48/0.31: chips are shown, never pre-ticked.',
  fallback: 'Letters r 0.19 MAE 3.9/10, words r 0.26 MAE 5.3/10 (n 30): coach marks.',
  questions: 'Urdu (L23, 185 real children): >=0.70 fills 98% at 73% right, only the 73% floor; >=0.90 fills 55% at 86% (n 92), 90% lower bound 79%. L5 run 3 >=0.70: 79% (n 67). English real >=0.70: 58% (n 19), >=0.90: 71% (n 7); L23 >=0.90: 82% (n 11). Synthetic 100%.',
  first_sounds: 'Hint only (coach marks); synthetic agreement 92% (n 60).',
  nonwords: 'English real 41-43% at any bar (n 304) vs floor 52%; synthetic English worse when confident (67% vs 78%). Urdu synthetic 97% (n 60), no real Urdu made-up words yet. Urdu confidence (L16): 0.85 where Gemini (>= 0.9) and the Soniox transcript heard the same word, 98% right (n 40); else capped at 0.6, 91% (n 80).',
  'maths.numbers': 'Synthetic >=0.65: 98% (n 48); real not keyed (May items were magnitude comparisons).',
  'maths.quick_sums': 'Confidence is a constant 0.7. After the alignment fix (714ebe70): real MAE 3.5, within +-3 62% (n 42), synthetic 50% (n 12) vs floor 90%.',
  'maths.written': 'Strips >=0.85: 98.3% (n 240) vs 97.2% at 0.75 (n 246); floor 88%.',
  'maths.word_problem': 'Strip misses were all unreadable at confidence 0; floor 87%.',
  // v2 oral maths (bd-s1oo0.46.3): 8 synthetic notes (ElevenLabs child voices, classroom noise, phone band; exact keys),
  // golive/lanes/L27/oral_results.json. Every miss was speech-to-text losing or mishearing the child, all at <= 0.6.
  'maths.oral.compare': 'Synthetic: all items 91% (n 32); >=0.70 100% (n 25). Floor (May identify items) 87%. Real recordings not yet measured.',
  'maths.oral.sums': 'Synthetic: all items 94% (n 32); >=0.70 100% (n 21). Floor (May computation) 88%. Real recordings not yet measured.',
  'maths.oral.word_problems': 'Synthetic: all items 88% (n 16); >=0.70 100% (n 11). Floor (May word problems) 87%. Real recordings not yet measured.',
});

const BASE_BARS = {
  'story.flagged': NEVER,
  fallback: NEVER,
  first_sounds: 0.7,     // hint-only: never pre-filled whatever its confidence (see prefill)
  'maths.numbers': 0.75,
  'maths.quick_sums': NEVER,
  'maths.written': 0.85,
  'maths.word_problem': 0.7,
  'maths.oral.compare': 0.7,
  'maths.oral.sums': 0.7,
  'maths.oral.word_problems': 0.7,
};
// Read without a language (L6's check Flow reads this flat), a field gets the strictest of its languages.
for (const [f, by] of Object.entries(FIELD_BARS_BY_LANG)) BASE_BARS[f] = Math.max(...Object.values(by));
const FIELD_BARS = Object.freeze(BASE_BARS);

/** The bar for a field, in a language when the bar differs by language. */
function barFor(field, lang) {
  const by = FIELD_BARS_BY_LANG[field];
  if (by && lang && by[lang] != null) return by[lang];
  return FIELD_BARS[field];
}

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
function prefill(field, confidence, { hint_only: hintOnly = false, lang = null } = {}) {
  if (hintOnly) return false;
  const bar = barFor(field, lang);
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

/** A per-word chip: confidence rises with the scorers that agree (HARNESS_RESULTS §8). Never pre-ticked for now (BAR_EVIDENCE). */
function chipConfidence({ gemini, alignment, speechace = null }) {
  const votes = [gemini, alignment, speechace].filter((v) => v === true).length;
  if (!gemini && votes === 0) return 0;
  if (votes >= 3) return 0.85;
  if (votes === 2) return 0.7;
  return 0.45;
}

module.exports = {
  FIELD_BARS, FIELD_BARS_BY_LANG, BAR_EVIDENCE, NEVER, barFor, HINT_CONFIDENCE_CAP, STUDY_AGREEMENT, EXPECTED_GEMINI_MINUS_ALIGNMENT, PROTOCOL_PENALTY,
  prefill, storyConfidence, chipConfidence, clamp01,
};
