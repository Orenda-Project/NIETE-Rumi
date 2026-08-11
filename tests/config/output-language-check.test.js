/**
 * Did we actually generate what we asked for?
 *
 * Everything the model writes for a teacher — lesson plans, coaching reports,
 * quizzes, debriefs, voice scripts — is asked for in a language and then sent
 * without anyone checking that it came back in that language. Models drift. The
 * audit found NO output-language verification anywhere in the codebase, which
 * means a wrong-language artifact is delivered and we learn about it from a
 * teacher's screenshot, if at all.
 *
 * This is cheap here specifically because Urdu and English do not share a script.
 * A script-ratio test is near-perfectly reliable for this market in a way it would
 * not be for, say, distinguishing Urdu from Sindhi.
 *
 * THE HARD PART is not detecting Urdu. It is NOT crying wolf:
 *   - A correct Urdu reply routinely contains English technical terms — the Urdu
 *     TTS guidance in this repo explicitly requires "lesson plan", "PDF", "quiz"
 *     to stay in ASCII, and Western numerals to stay Western. An Urdu artifact can
 *     legitimately be 30% Latin characters.
 *   - A correct English reply should contain essentially no Perso-Arabic.
 * So the two directions need DIFFERENT thresholds, and a checker that treats them
 * symmetrically would flag correct Urdu as a drift on every single send.
 */

const {
  verifyOutputLanguage,
  detectScriptLanguage,
} = require('../../bot/shared/utils/output-language-check');

const URDU_REPLY = 'آپ کا سبق کا منصوبہ تیار ہے۔ میں نے اس میں سرگرمیاں شامل کی ہیں۔';
const URDU_WITH_TERMS =
  'آپ کا lesson plan تیار ہے۔ PDF میں 5 سرگرمیاں ہیں اور quiz بھی شامل ہے۔ براہ کرم دیکھیں۔';
const ENGLISH_REPLY =
  'Your lesson plan is ready. I have included five activities and a short quiz for Grade 5.';

describe('verifyOutputLanguage — the happy paths do NOT fire', () => {
  it('accepts an Urdu artifact when Urdu was requested', () => {
    expect(verifyOutputLanguage(URDU_REPLY, 'ur').ok).toBe(true);
  });

  it('accepts Urdu that carries English technical terms — the common real case', () => {
    // This is the assertion that stops the checker becoming noise. The repo's own
    // Urdu voice guidance REQUIRES English terms to stay in ASCII, so a checker
    // that flagged this would fire on nearly every correct Urdu send.
    const result = verifyOutputLanguage(URDU_WITH_TERMS, 'ur');
    expect(result.ok).toBe(true);
  });

  it('accepts an English artifact when English was requested', () => {
    expect(verifyOutputLanguage(ENGLISH_REPLY, 'en').ok).toBe(true);
  });

  it('accepts English containing digits, punctuation and emoji', () => {
    expect(verifyOutputLanguage('✅ Done! Grade 5 — 3 activities, 20 min.', 'en').ok).toBe(true);
  });
});

describe('verifyOutputLanguage — real drift IS caught', () => {
  it('catches an English artifact when Urdu was requested', () => {
    const result = verifyOutputLanguage(ENGLISH_REPLY, 'ur');
    expect(result.ok).toBe(false);
    expect(result.expected).toBe('ur');
    expect(result.detected).toBe('en');
  });

  it('catches an Urdu artifact when English was requested', () => {
    const result = verifyOutputLanguage(URDU_REPLY, 'en');
    expect(result.ok).toBe(false);
    expect(result.detected).toBe('ur');
  });

  it('catches the mostly-English-with-a-token-Urdu-greeting case', () => {
    // The realistic drift shape: the model opens in Urdu and then writes the whole
    // artifact in English.
    const drifted =
      'السلام علیکم! Here is your lesson plan for Grade 5 mathematics. ' +
      'Start with a warm-up activity, then introduce fractions using paper folding. ' +
      'Give students ten minutes of pair work, then review the answers together as a class.';
    expect(verifyOutputLanguage(drifted, 'ur').ok).toBe(false);
  });
});

describe('verifyOutputLanguage — it must never be the thing that breaks a send', () => {
  it('passes when there is not enough text to judge', () => {
    // A bare "✅" or a number is not evidence of drift. Guessing here would block
    // correct sends, and this check runs in front of teacher-facing delivery.
    for (const thin of ['✅', 'OK', '5', '', '   ', '👍🏽']) {
      expect(verifyOutputLanguage(thin, 'ur').ok).toBe(true);
    }
  });

  it('passes on a non-string rather than throwing', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(verifyOutputLanguage(bad, 'ur').ok).toBe(true);
    }
  });

  it('passes when the expected language is not one we can check', () => {
    // Only en/ur are script-separable here. An unexpected code must not produce a
    // confident verdict.
    expect(verifyOutputLanguage(URDU_REPLY, 'sw').ok).toBe(true);
    expect(verifyOutputLanguage(URDU_REPLY, null).ok).toBe(true);
  });

  it('always reports WHY, so a log line is actionable', () => {
    const r = verifyOutputLanguage(ENGLISH_REPLY, 'ur');
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
    expect(typeof r.urduRatio).toBe('number');
  });
});

describe('detectScriptLanguage — the primitive underneath', () => {
  it('reads Perso-Arabic as Urdu and Latin as English', () => {
    expect(detectScriptLanguage(URDU_REPLY)).toBe('ur');
    expect(detectScriptLanguage(ENGLISH_REPLY)).toBe('en');
  });

  it('returns null when there is nothing to judge', () => {
    expect(detectScriptLanguage('12345 !!! ✅')).toBeNull();
    expect(detectScriptLanguage('')).toBeNull();
  });

  it('counts letters, not bytes — digits and punctuation must not sway it', () => {
    // '2026-08-07 ✅ 15/20' alongside a short Urdu phrase should still read Urdu.
    expect(detectScriptLanguage('2026-08-07 ✅ 15/20 نتیجہ اچھا ہے')).toBe('ur');
  });
});
