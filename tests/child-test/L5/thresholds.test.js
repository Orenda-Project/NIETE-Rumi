'use strict';
const th = require('../../../bot/shared/services/child-test/scoring/thresholds');

describe('child-test thresholds (exported for L6)', () => {
  test('every ai_marks field has a bar in (0, 1]', () => {
    for (const f of ['story.words_correct', 'story.flagged', 'fallback', 'questions', 'first_sounds', 'nonwords',
      'maths.numbers', 'maths.quick_sums', 'maths.written', 'maths.word_problem']) {
      expect(th.FIELD_BARS[f]).toBeGreaterThan(0);
      expect(th.FIELD_BARS[f]).toBeLessThanOrEqual(1);
    }
  });

  test('prefill() decides by the per-field bar; hint-only fields never prefill', () => {
    expect(th.prefill('questions', 0.9)).toBe(true);
    expect(th.prefill('questions', 0.2)).toBe(false);
    expect(th.prefill('first_sounds', 1, { hint_only: true })).toBe(false);
    expect(th.prefill('nope', 0.99)).toBe(false);
  });

  test('storyConfidence: high when Gemini and the STT alignment agree after the study bias, lower with protocol flags', () => {
    const agree = th.storyConfidence({ lang: 'urdu', geminiCorrect: 40, alignCorrect: 27, flags: [] });
    const disagree = th.storyConfidence({ lang: 'urdu', geminiCorrect: 40, alignCorrect: 0, flags: [] });
    const flagged = th.storyConfidence({ lang: 'urdu', geminiCorrect: 40, alignCorrect: 27, flags: ['prompting_during_timed_minute'] });
    expect(agree).toBeGreaterThanOrEqual(th.FIELD_BARS['story.words_correct']);
    expect(disagree).toBeLessThan(th.FIELD_BARS['story.words_correct']);
    expect(flagged).toBeLessThan(agree);
  });

  test('chipConfidence: a word both scorers flagged clears the chip bar; one scorer alone does not', () => {
    expect(th.chipConfidence({ gemini: true, alignment: true })).toBeGreaterThanOrEqual(th.FIELD_BARS['story.flagged']);
    expect(th.chipConfidence({ gemini: true, alignment: false })).toBeLessThan(th.FIELD_BARS['story.flagged']);
    expect(th.chipConfidence({ gemini: true, alignment: false, speechace: true })).toBeGreaterThanOrEqual(th.FIELD_BARS['story.flagged']);
  });
});
