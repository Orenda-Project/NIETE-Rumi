'use strict';
const th = require('../../../bot/shared/services/child-test/scoring/thresholds');

const FIELDS = ['story.words_correct', 'story.flagged', 'fallback', 'questions', 'first_sounds', 'nonwords',
  'maths.numbers', 'maths.quick_sums', 'maths.written', 'maths.word_problem'];

describe('child-test thresholds (exported for L6)', () => {
  test('every ai_marks field has a bar: in (0, 1], or NEVER (above any confidence)', () => {
    for (const f of FIELDS) {
      expect(th.FIELD_BARS[f]).toBeGreaterThan(0);
      expect(th.FIELD_BARS[f] <= 1 || th.FIELD_BARS[f] === th.NEVER).toBe(true);
    }
    expect(th.NEVER).toBeGreaterThan(1);
  });

  test('prefill() decides by the per-field bar; hint-only fields never prefill', () => {
    expect(th.prefill('questions', 0.95)).toBe(true);
    expect(th.prefill('questions', 0.2)).toBe(false);
    expect(th.prefill('first_sounds', 1, { hint_only: true })).toBe(false);
    expect(th.prefill('nope', 0.99)).toBe(false);
  });

  describe('bars set from run 3 (EVAL.md)', () => {
    test('Urdu story count is never pre-filled: its confidence was anti-calibrated (≥ 0.70 → 56% within ±5, n 9)', () => {
      expect(th.barFor('story.words_correct', 'urdu')).toBe(th.NEVER);
      expect(th.prefill('story.words_correct', 1, { lang: 'urdu' })).toBe(false);
    });

    test('English story count pre-fills at 0.70 (real ≥ 0.70: 88% within ±5, n 16)', () => {
      expect(th.barFor('story.words_correct', 'english')).toBe(0.7);
      expect(th.prefill('story.words_correct', 0.72, { lang: 'english' })).toBe(true);
      expect(th.prefill('story.words_correct', 0.65, { lang: 'english' })).toBe(false);
    });

    test('a field read without a language gets the strictest bar of its languages (L6 reads FIELD_BARS flat)', () => {
      expect(th.FIELD_BARS['story.words_correct']).toBe(th.NEVER);
      expect(th.FIELD_BARS.questions).toBe(0.9);
      expect(th.FIELD_BARS.nonwords).toBe(th.NEVER);
      for (const f of Object.keys(th.FIELD_BARS_BY_LANG)) {
        expect(th.FIELD_BARS[f]).toBe(Math.max(...Object.values(th.FIELD_BARS_BY_LANG[f])));
      }
    });

    test('word chips are never pre-ticked (real precision 0.25 at every bar); fallback and quick sums never pre-fill', () => {
      for (const f of ['story.flagged', 'fallback', 'maths.quick_sums']) {
        expect(th.FIELD_BARS[f]).toBe(th.NEVER);
        expect(th.prefill(f, 1, { lang: 'urdu' })).toBe(false);
        expect(th.prefill(f, 1, { lang: 'english' })).toBe(false);
      }
    });

    test('comprehension: Urdu 0.90 (L24/CR-1: L23 found 0.70 only at the 73% floor; 0.90 → 86%), English 0.90 (58% at 0.70, 71% at 0.90)', () => {
      expect(th.barFor('questions', 'urdu')).toBe(0.9);
      expect(th.barFor('questions', 'english')).toBe(0.9);
      expect(th.prefill('questions', 0.9, { lang: 'urdu' })).toBe(true);
      expect(th.prefill('questions', 0.8, { lang: 'urdu' })).toBe(false);
      expect(th.prefill('questions', 0.8, { lang: 'english' })).toBe(false);
    });

    test('made-up words: Urdu 0.65 (synthetic 97%), English never (real 41–43% at any bar, floor 52%)', () => {
      expect(th.barFor('nonwords', 'urdu')).toBe(0.65);
      expect(th.barFor('nonwords', 'english')).toBe(th.NEVER);
    });

    test('written maths 0.85 (98.3% of 240 items vs 97.2% at 0.75); numbers stay 0.75 (98%, n 48)', () => {
      expect(th.FIELD_BARS['maths.written']).toBe(0.85);
      expect(th.FIELD_BARS['maths.numbers']).toBe(0.75);
      expect(th.prefill('maths.written', 0.8)).toBe(false);
      expect(th.prefill('maths.written', 0.9)).toBe(true);
    });

    test('the evidence behind each bar is exported with the bar', () => {
      for (const f of FIELDS) expect(typeof th.BAR_EVIDENCE[f]).toBe('string');
    });
  });

  test('storyConfidence: higher when Gemini and the STT alignment agree after the study bias, lower with protocol flags', () => {
    const agree = th.storyConfidence({ lang: 'english', geminiCorrect: 40, alignCorrect: 32, flags: [] });
    const disagree = th.storyConfidence({ lang: 'english', geminiCorrect: 40, alignCorrect: 0, flags: [] });
    const flagged = th.storyConfidence({ lang: 'english', geminiCorrect: 40, alignCorrect: 32, flags: ['prompting_during_timed_minute'] });
    expect(agree).toBeGreaterThanOrEqual(th.barFor('story.words_correct', 'english'));
    expect(disagree).toBeLessThan(th.barFor('story.words_correct', 'english'));
    expect(flagged).toBeLessThan(agree);
  });

  test('chipConfidence: more scorers agreeing means a higher chip confidence', () => {
    const one = th.chipConfidence({ gemini: true, alignment: false });
    const two = th.chipConfidence({ gemini: true, alignment: true });
    const three = th.chipConfidence({ gemini: true, alignment: true, speechace: true });
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });
});
