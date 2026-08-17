/**
 * bd-6fdy3 (+ bd-k2aaz) — reflection-question redesign.
 *
 * Research (Slack C0AU5BWCHF0): the reflection is the product; the single question must (1) surface
 * an IMPASSE between two distant moments, (2) close with a light forward if-then tied to a real cue,
 * (3) stay warm/non-accusatory (no "advice with a question mark"), and (4) keep English technical
 * terms in English (bd-k2aaz). A deterministic word-filter (quote-aware) catches any judgemental
 * label that slips through and triggers a rewrite.
 */

const { buildQuestionPrompt } = require('../../bot/shared/services/coaching/reflective-questions/question-prompt');
const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');
const { validateQuestion } = require('../../bot/shared/services/coaching/reflective-questions/guardrails');

const corpus = { lesson_throughline_en: 'place value', significant_moments: [{ approx_time_phrase: 'early', named_student: null }], collective_moments: [] };
const prof = resolveProfile('ur');

describe('bd-6fdy3 — single question carries the research moves', () => {
  const p = buildQuestionPrompt(1, corpus, prof, 'Afshan');
  it('is the ONE question, built on the impasse (two distant moments)', () => {
    expect(p).toMatch(/ONE REFLECTIVE QUESTION/);
    expect(p).toMatch(/IMPASSE/);
    expect(p).toMatch(/TWO distant moments/);
  });
  it('closes with a light forward if-then tied to a cue', () => {
    expect(p).toMatch(/FORWARD/);
    expect(p.toLowerCase()).toMatch(/one small thing/);
  });
  it('forbids advice-with-a-question-mark and stays warm/non-accusatory', () => {
    expect(p).toMatch(/ADVICE WITH A QUESTION MARK/);
    expect(p).toMatch(/NEVER ACCUSATORY/);
  });
  it('keeps English technical terms in English (bd-k2aaz folded in)', () => {
    expect(p).toMatch(/ENGLISH TERMS ALWAYS STAY IN ENGLISH/);
    expect(p).toMatch(/dead organism/);
  });
});

describe('bd-6fdy3 — judgemental_language word-filter (quote-aware, no over-fire)', () => {
  it('flags a judgemental label used in Rumi\'s own framing (غلط outside quotes)', () => {
    const q = 'جب بچوں نے ایک ہی غلط جواب دیا تو آپ کی سوچ میں کیا تھا؟';
    expect(validateQuestion(q, corpus, 'Afshan', prof)).toContain('judgemental_language');
  });
  it('does NOT flag a word that only appears inside a quote of what was said', () => {
    const q = "جب آپ نے پوچھا تو ایک بچے نے 'wrong' کہا، اس لمحے بچوں کی سوچ میں کیا فرق آیا؟";
    expect(validateQuestion(q, corpus, 'Afshan', prof)).not.toContain('judgemental_language');
  });
  it('does NOT over-fire on a real warm neutral question', () => {
    // a real tightened single question (Javeria, times table) — neutral, no labels
    const q = "شروع میں جب آپ نے تھری کا سوال پوچھا تو ایک بچے نے 'ایک' کہا۔ پھر بعد میں ایک بچہ 'نائن' سے 'ٹوئنٹی فور' تک پہنچا۔ ان دونوں لمحوں میں بچوں کی سوچ میں کیا فرق آیا؟ اور کل جب کوئی بچہ مختصر جواب دے تو آپ کیا چھوٹی سی چیز آزمانا چاہیں گی؟";
    expect(validateQuestion(q, corpus, 'Afshan', prof)).not.toContain('judgemental_language');
  });
});
