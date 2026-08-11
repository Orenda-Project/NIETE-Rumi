/**
 * Did we generate what we asked for?
 *
 * Everything a model writes for a teacher — lesson plans, coaching reports,
 * quizzes, debriefs, voice scripts — is requested in a language and then sent
 * without anyone checking it came back in that language. Models drift. The audit
 * found no output-language verification anywhere, so a wrong-language artifact is
 * delivered and we learn about it from a teacher's screenshot, if at all.
 *
 * This is cheap HERE specifically because Urdu and English do not share a script.
 * A script-ratio test is near-perfect for this market in a way it would not be for
 * separating Urdu from Sindhi, which share one.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN CONSTRAINT: not crying wolf
 *
 * The hard part is not detecting Urdu. It is staying quiet when nothing is wrong,
 * because a check that fires on correct output gets muted within a week and then
 * protects nothing.
 *
 *   A correct URDU artifact routinely contains English. This repo's own Urdu voice
 *   guidance REQUIRES it: technical terms ("lesson plan", "PDF", "quiz") stay in
 *   ASCII and numerals stay Western. Correct Urdu can be 30%+ Latin characters.
 *
 *   A correct ENGLISH artifact should contain essentially no Perso-Arabic.
 *
 * So the two directions get DIFFERENT thresholds. A symmetric checker would flag
 * correct Urdu on nearly every send.
 *
 * And it fails OPEN. This runs in front of teacher-facing delivery; a checker that
 * blocks a correct send is worse than the drift it was added to catch. Every
 * uncertain case — too little text, a non-string, an unexpected language code —
 * returns ok:true with a reason, and the caller decides what to do with a
 * genuine mismatch.
 * ---------------------------------------------------------------------------
 */

/** Perso-Arabic block, which Urdu shares with Arabic/Sindhi/Pashto. */
const PERSO_ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;

/**
 * Below this many letters there is nothing to judge. "✅", "OK", a bare number or
 * an emoji are not evidence of drift, and treating them as such would fire the
 * check on every acknowledgement message the bot sends.
 */
const MIN_LETTERS = 12;

/**
 * An Urdu artifact must be at least this much Perso-Arabic. Deliberately low:
 * English technical terms are expected, so the question is "is there substantial
 * Urdu here", not "is it purely Urdu".
 */
const URDU_MIN_RATIO = 0.25;

/**
 * An English artifact may carry a little Perso-Arabic — a quoted term, a name —
 * before it stops being English.
 */
const URDU_MAX_RATIO_FOR_EN = 0.15;

/** Languages whose scripts are separable, so a verdict means something. */
const CHECKABLE = new Set(['en', 'ur']);

function countLetters(text) {
  let urdu = 0;
  let latin = 0;
  for (const ch of text) {
    if (PERSO_ARABIC.test(ch)) urdu++;
    else if (LATIN.test(ch)) latin++;
  }
  return { urdu, latin, total: urdu + latin };
}

/**
 * Which language's script dominates this text, or null if there is nothing to go
 * on. Letters only — digits, punctuation and emoji carry no language signal and
 * must not sway the ratio.
 *
 * @param {string} text
 * @returns {'en'|'ur'|null}
 */
function detectScriptLanguage(text) {
  if (typeof text !== 'string') return null;
  const { urdu, total } = countLetters(text);
  if (total < 1) return null;
  return urdu / total >= 0.5 ? 'ur' : 'en';
}

/**
 * Verify a generated artifact is in the language it was requested in.
 *
 * Never throws and never blocks on uncertainty — see the header. A caller should
 * log a mismatch (and may choose to regenerate), but must not treat `ok:false` as
 * a reason to send nothing at all.
 *
 * @param {string} text the generated artifact
 * @param {string} expected the language it was requested in
 * @returns {{ok:boolean, expected:string|null, detected:'en'|'ur'|null,
 *            urduRatio:number, letters:number, reason:string}}
 */
function verifyOutputLanguage(text, expected) {
  const base = { expected: expected ?? null, detected: null, urduRatio: 0, letters: 0 };

  if (typeof text !== 'string' || !CHECKABLE.has(expected)) {
    return {
      ...base,
      ok: true,
      reason: typeof text !== 'string'
        ? 'not a string — nothing to check'
        : `language "${expected}" is not script-separable here — no verdict`,
    };
  }

  const { urdu, total } = countLetters(text);
  const urduRatio = total > 0 ? urdu / total : 0;

  if (total < MIN_LETTERS) {
    return {
      ...base,
      ok: true,
      urduRatio,
      letters: total,
      reason: `only ${total} letters — too little to judge`,
    };
  }

  const detected = urduRatio >= 0.5 ? 'ur' : 'en';

  // Asymmetric on purpose: see the header note on not crying wolf.
  const ok = expected === 'ur'
    ? urduRatio >= URDU_MIN_RATIO
    : urduRatio <= URDU_MAX_RATIO_FOR_EN;

  const pct = (urduRatio * 100).toFixed(0);
  return {
    ...base,
    ok,
    detected,
    urduRatio,
    letters: total,
    reason: ok
      ? `${pct}% Perso-Arabic of ${total} letters — consistent with "${expected}"`
      : expected === 'ur'
        ? `expected Urdu but only ${pct}% of ${total} letters are Perso-Arabic (min ${URDU_MIN_RATIO * 100}%)`
        : `expected English but ${pct}% of ${total} letters are Perso-Arabic (max ${URDU_MAX_RATIO_FOR_EN * 100}%)`,
  };
}

module.exports = {
  verifyOutputLanguage,
  detectScriptLanguage,
  MIN_LETTERS,
  URDU_MIN_RATIO,
  URDU_MAX_RATIO_FOR_EN,
};
